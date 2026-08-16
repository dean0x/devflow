---
feature: external-model-routing
name: External Model Routing & Per-Agent Model Config
description: "Use when working on the proxy lifecycle (enable/disable/status/preflight), the ensure-proxy hook, per-agent model mapping, agent frontmatter rewriting, or the agents TUI. Keywords: proxy, external-model-routing, GPT, agent-models, ensure-proxy, frontmatter, devflow proxy, devflow agents, subswitch, ANTHROPIC_BASE_URL, dormancy, reapplyAgentMapping."
category: architecture
directories: [src/core/proxy-state.ts, src/core/external-models.ts, src/core/agent-models.ts, src/core/agent-frontmatter.ts, src/core/codex-auth-inspect.ts, src/core/model-discovery.ts, src/core/cache.ts, src/core/proxy-log.ts, src/cli/commands/proxy.ts, src/cli/commands/agents.ts, src/cli/agents-view, src/assets/scripts/hooks/ensure-proxy]
created: 2026-07-24
updated: 2026-08-14
---

# External Model Routing & Per-Agent Model Config

## Overview

This feature routes Claude Code requests through a local relay so GPT models (via an OpenAI/Codex subscription) can be assigned per-agent alongside native Claude aliases. The feature has four layers: a **core state/mapping engine** (`src/core/`), a **proxy CLI command** (`src/cli/commands/proxy.ts`), a **per-agent TUI** (`src/cli/commands/agents.ts` + `src/cli/agents-view/`), and a **SessionStart/UserPromptSubmit hook** (`src/assets/scripts/hooks/ensure-proxy`).

Two authority sources govern the proxy at different points in its lifecycle. `manifest.features.proxy` (manifest-group field, same as `ambient`, `hud`, `rules`) controls whether `devflow init` configures proxy-related hooks and env; `~/.devflow/proxy.json` controls whether the `ensure-proxy` hook actually activates at runtime. Both must agree for the feature to be fully operational. A drift between the two is surfaced by `devflow proxy --status`.

## System Context

The routing runtime is an internal package (`subswitch@0.2.0`, exact-pinned in `package.json`). Its name is a **hard branding constraint** — it must never appear in user-visible strings, error messages, CLI output, or agent context injections. User-facing vocabulary is always "external model routing" / "Devflow proxy". The one exception is internal code: health-check body comparisons (`body['name'] === 'subswitch'`), `SUBSWITCH_CONFIG` env var, and hook log lines are fine.

## Proxy Lifecycle

### Authority files

| File | Role |
|------|------|
| `~/.devflow/proxy.json` | Runtime authority. Tolerant-parsed by `readProxyState()`. ENOENT → default disabled state (not an error). Fields: `enabled`, `port`, `binPath`, `configPath`, `resolvedAt`, `devflowVersion`. |
| `~/.devflow/proxy-routing.json` | Routing config written by `buildRoutingConfigJson(port)`. Shape: bare `{port}` plus trailing newline. 0.2.0 rejects unrecognised keys — including a `codex` block breaks the runtime. Written before preflight runs on enable. |
| `manifest.features.proxy` | Init/uninstall authority. Seeds from prior manifest on re-init (ADR-014). Never in `config.json` — manifest-group by design, same as `ambient`/`hud`/`rules`. |

### Enable path (crash-safe)

1. Read `proxy.json` for the remembered port; `resolvePort(portOption, priorPort)` picks the effective port. `--port` has **no commander default** — omission leaves `portOption` as `undefined` and the remembered port from `proxy.json` wins (TS-1 fix).
2. Write `proxy-routing.json` with the effective port (bare `{port}` JSON, no model list).
3. Run `runProxyPreflight()` (4 ordered checks — ①–④: bin, codex auth, port probe/adoption, settings — see Preflight section). Doctor excluded: a pre-spawn gate is always unsatisfiable on a cold path (D-EFR-2; see Anti-Patterns).
4. On success: write `proxy.json` `enabled:true`.
5. Spawn relay via `spawnRelayAndWaitForPort()` (exported): bounded ≤50×100ms probe loop (5s max). `SpawnRelayResult.spawnedPid` is set when this process spawned the relay; absent on the adopted path. If relay never accepts, rollback `proxy.json` to `enabled:false` and return error.
6. **Post-spawn doctor verification** via `runPostSpawnVerification()` (exported, D-EFR-2): runs `node <binPath> doctor` against the live relay. On failure: rollback `proxy.json` to `enabled:false`; SIGTERM then 2s SIGKILL escalation the relay — **only when `spawnedPid` is defined** (self-spawned). An adopted relay may be serving live sessions and must never be killed.
7. Settings pass via `applyEnableSettingsPass()` (internal named function, not exported): `removeProxyHooks` + `_stripProxyEnvFromObject(s, port)` + `addProxyHooks` + `_applyProxyEnvToObject` — **all four calls, then one atomic write** to `~/.claude/settings.json`.
8. Sync manifest.
9. `reapplyAgentMapping({ proxyEnabled: true })` — materializes GPT model entries into agent frontmatter.
10. **Cache warming (fire-and-forget)**: `void discoverExternalModels(cacheDir, logPath).catch(() => {})` — pre-populates the model cache so the next `--status` and agents TUI load instantly. Strictly non-fatal per PF-009 — a discovery failure must never block the enable result or surface an error to the user.

Hard failures at any step (steps 1–9) set `process.exitCode = 1` and return — never `process.exit()` (avoids PF-014).

### Disable path (never kills relay)

The relay process is intentionally left running on `--disable` for any live Claude Code sessions. The disable path:
1. Read `proxy.json` first to determine `managedPort` for the URL strip.
2. `applyDisableToSettings(parsedSettings, managedPort)` — removes hooks AND strips `ANTHROPIC_BASE_URL` (see invariant below).
3. Writes `proxy.json` `enabled:false` — **keeps** `port`, `binPath`, `configPath`, `resolvedAt`, `devflowVersion` for the next enable.
4. Syncs manifest to `proxy: false`.
5. `revertExternalAgents()` — rewrites installed agent files to shipped default models.
6. Emits relay PID info with kill hint **only after cross-checking relay identity** (TCP probe + health check confirms `isOurRelayBody` before printing). Never calls `kill` programmatically.

Hard failures (e.g., malformed `settings.json`) set `process.exitCode = 1` and return early.

### `applyDisableToSettings` — both-operations invariant

```typescript
// CORRECT — both operations run unconditionally; managedPort scopes the URL strip:
export function applyDisableToSettings(settings: Settings, managedPort: number): boolean {
  const removedHooks = removeProxyHooks(settings);
  const strippedEnv = _stripProxyEnvFromObject(settings, managedPort);
  return removedHooks || strippedEnv;
}
```

The regression that this guards against: `removeProxyHooks(s) || _stripProxyEnvFromObject(s)` short-circuits when hooks are present — `_stripProxyEnvFromObject` never runs, leaving `ANTHROPIC_BASE_URL` pointing at a disabled relay in new sessions. Both calls must always evaluate regardless of the other's return value.

### Preflight checks (4 in order, hard-gated)

```
① resolveProxyBin()           — bin resolvable from devflow's node_modules
② fileExists(~/.codex/auth.json) — Codex auth present
③ tcpConnectable(port, 2000ms) — port free or our relay already running
   └── if accepting: health check → adopted=true | port-conflict Err
④ readSettingsJson parseable; ANTHROPIC_BASE_URL not 'foreign'; API key warn (non-fatal)
```

`spawnDoctor` is on `ProxyPreflightDeps` and built by `buildRealPreflightDeps` so `runEnable` can pass it into `runPostSpawnVerification` (step 6) via the same deps instance (`spawnDoctor: preflightDeps.spawnDoctor`). Preflight itself never calls `spawnDoctor`.

**Init never runs doctor and never spawns.** `devflow init` calls `runProxyPreflight` (the same 4-check function) then writes `proxy.json enabled:true`. The relay is started by the first session's `ensure-proxy` hook. Deeper diagnostics (doctor, spawn) live in `devflow proxy --enable` and `devflow proxy --status`.

All four checks are injectable via `ProxyPreflightDeps`. **`buildRealPreflightDeps(opts)`** (exported) builds the production implementation and is shared between `runEnable` and `init.ts`. Key option: `swallowSettingsReadError: true` for init.ts (which writes `settings.json` itself); `false` for `runEnable` (propagates read errors to the user).

### Exported seams in proxy.ts

| Export | Purpose |
|--------|---------|
| `buildRealPreflightDeps(opts)` | Production `ProxyPreflightDeps` factory — shared by `runEnable` and `init.ts` |
| `spawnRelayAndWaitForPort(...)` | Spawn relay + bounded 50×100ms TCP wait; injectable via `SpawnAndWaitDeps`. Success variant carries `spawnedPid?: number` (set when self-spawned; absent on adopted path) |
| `runPostSpawnVerification(...)` | Doctor against the live relay post-spawn; injectable via `PostSpawnDoctorDeps`. Rollback + conditional kill on non-zero exit (D-EFR-2) |
| `resolvePort(portOption, priorPort)` | Port resolution with remembered-port fallback |
| `isOurRelayBody(body)` | Health-check identity check (`name === 'subswitch'`) |
| `applyProxyEnv`, `stripProxyEnv` | Settings JSON string transforms (pure, no mutation) |
| `applyDisableToSettings` | Unconditional hooks-remove + URL-strip on parsed Settings object |
| `addProxyHooks`, `removeProxyHooks`, `hasProxyHooks` | Hook mutation helpers |
| `runProxyPreflight`, `ProxyPreflightDeps`, `PreflightResult` | Preflight contract (4 checks) |
| `PostSpawnDoctorDeps` | Injectable interface for post-spawn doctor verification |
| `SpawnAndWaitDeps`, `SpawnRelayResult`, `BuildRealPreflightDepsOptions` | Injectable interfaces |
| `readProxyEnvState` | Returns `'ours'|'ours-other-port'|'foreign'|'absent'` for `--status` display |
| `formatCodexAuthLine(state, path, now)` | Codex auth `--status` line; `unreadable` renders at warn level, expiry is informational only |
| `formatExternalModelsLine(catalog, logPath)` | External models `--status` line; renders selectable model names or `unavailable` with the log path |

Internal named functions (not exported): `applyEnableSettingsPass`, `resolveProcessState`, `formatProcessLine`, `readPidFile`, `PROBE_TIMEOUT_MS`, `DOCTOR_TIMEOUT_MS`, `RELAY_SPAWN_*` constants.

## ensure-proxy Hook Contract

The hook is registered on **both** `SessionStart` and `UserPromptSubmit` with a 15-second timeout. A single bash script handles both events:

```bash
HOOK_EVENT="SessionStart"
case "$INPUT" in
  *'"prompt"'*) HOOK_EVENT="UserPromptSubmit" ;;
esac
```

| Event | Port state | Behavior |
|-------|-----------|---------|
| UserPromptSubmit | any | **immediate exit 0** (before TCP probe — silent; SessionStart handles all state) |
| SessionStart | UP + correct identity | exit 0, no output |
| SessionStart | UP + wrong identity | exit 0 + `json_session_output` warning ("port occupied by another application") |
| SessionStart | DOWN + missing bin/config | exit 0 + `json_session_output` warning ("relay binary not found" / "routing config not found") |
| SessionStart | DOWN + prerequisites ok | acquire spawn lock → nohup spawn → write `proxy.pid` (best-effort) → wait 80×0.1s = 8s → exit 0 [+warning if never up] |

**`proxy.pid` is written immediately after spawn (best-effort)**, mirroring the CLI enable path. `devflow proxy --status` reads this file to display the process line for hook-started relays. A stale pid from a relay that never came up is harmless — `--status` liveness-checks it before display (`process.kill(pid, 0)`).

**UserPromptSubmit fast exit happens before any TCP probe or log I/O** — enabled/port check from `proxy.json` is the only work done, then the hook exits. This keeps the hot path at near-zero subprocess cost.

**binPath/configPath are read only in the SessionStart-down branch** — deferred so the enabled+port check path (UserPromptSubmit and SessionStart-port-up) pays zero additional json_field_file cost.

**curl is guarded** with `command -v curl >/dev/null 2>&1` before the health-check identity call. When curl is absent, the hook assumes the relay is ours and exits 0 (no spurious warning). The CLI `--status` command is the authoritative identity check.

**Health body parsed via `json_field`** — key-order-independent. The old substring match `*'"name":"subswitch"'*` was order-dependent; the current code pipes `$HEALTH_BODY` into `json_field "name" ""` (sourced from json-parse) and compares the extracted value. `json_field` is always available at this call site because line 33 exits the hook if `_JSON_AVAILABLE=false`.

**json-parse source failure** emits a named stderr diagnostic (`echo "ensure-proxy: failed to source json-parse" >&2`) and exits 0.

**Log guard literals are named**: `_LOG_MAX_BYTES=2097152` (2MB) and `_LOG_TAIL_BYTES=1048576` (1MB) are named variables, matching the hook-log-init guard pattern.

The hook is **not git-gated** (unlike `preamble` and `session-start-orchestrator`). Proxy is a user-scope global feature.

The spawn wait uses **80×0.1s = 8s** (hook) vs the CLI's **50×100ms = 5s**. This difference is intentional: the hook fires inside a 15-second platform timeout and needs a wider cold-start window; the CLI user is waiting interactively.

**Hook spawn path is covered by tests** (tests/shell-hooks.test.ts): a stub relay reads `SUBSWITCH_CONFIG` and binds the port, asserting silent exit (exit 0, no stdout/stderr), a live pid recorded in `proxy.pid`, and spawn lock released. The failure branch (full 8s wait) is intentionally not unit-tested for duration reasons.

## Model Discovery (model-discovery.ts)

`src/core/model-discovery.ts` provides live model catalog access via the relay.

| Function | Mode | Cost |
|----------|------|------|
| `discoverExternalModels(cacheDir, logPath, deps?)` | Async, spawns subprocess | Writes a versioned cache entry `external-models-v1-<version>.json` under `cacheDir` |
| `getExternalModelsCached(cacheDir)` | Sync, zero spawns | Reads the newest cache entry regardless of TTL; returns `{ known: false }` on miss. Sets `source: 'cache'` when within TTL, `'stale-cache'` when expired. |

**Cache dir convention**: `path.join(devflowDir, 'cache', 'models')` — `cacheDir` in all callers.

**Cache key format**: `external-models-v1-<runtimeVersion>`. `resolveProxyBin()` validates the version string against `RUNTIME_VERSION_RE = /^[A-Za-z0-9.+-]{1,32}$/` before it becomes a path component (path-traversal prevention). When validation fails, the version field is absent from the result and callers must treat the cache as unavailable.

**Cache permissions**: directory created at mode 0700 (owner-only); each entry hardened to 0600 after atomic write. Both enforced in `src/core/cache.ts`.

**Stale-cache fallback**: when a live spawn fails, `findStaleFallback()` scans for the newest existing entry by embedded envelope timestamp (not file mtime — mtime is trivially spoofable). Stale entries serve as the fallback; `source` field of `ExternalModelCatalog` is `'stale-cache'` in that case.

**Cache prune**: after each successful live write, `pruneOldEntries()` keeps at most 3 entries (`CACHE_PRUNE_KEEP`) by embedded timestamp, deleting older ones. Non-fatal.

**`ExternalModelCatalog` discriminated union**:
```typescript
{ known: true; models; aliasToId; selectableNames; source }
| { known: false }
```

**When to use which**:
- `discoverExternalModels` in the interactive TUI — async, spawns the runtime, gated on `proxyEnabled` (proxy-off sessions resolve immediately to `{ known: false }`); shows a spinner when catalog takes more than 250 ms.
- `getExternalModelsCached` in `--set` — sync, zero spawns; accepts any model name on cache miss (configure-first-then-enable flow preserved).
- `discoverExternalModels` fire-and-forget after enable (cache warming, strict non-fatal per PF-009).
- `--list`, `--reset` — never touch model discovery. `--status` reads the cached model registry via `getExternalModelsCached` (sync, zero spawns — no live fetch).

**Uninstall**: `cache/models` is in `proxyArtifacts` in `uninstall.ts` — removed with `isDir:true` on `devflow uninstall`. The `cache/` parent directory is not removed (the HUD shares it).

## Mapping Engine (agent-models.json)

`~/.devflow/agent-models.json` is a **deviations-only** mapping: agents that use their shipped defaults are omitted entirely. There is **no `previousModel` field** — shipped defaults are read live from `src/assets/agents/` source files at convergence time via `loadShippedDefaults()`.

### isDormantExternalModel — single dormancy predicate

`isDormantExternalModel(model, proxyEnabled)` is exported from `src/core/external-models.ts` (leaf module, no project imports — avoids cycles). It is the **single source of truth** for the dormancy predicate, consumed by:
- `resolveEffective()` in agent-models.ts
- `buildRow()` in agents-view/state.ts
- `buildListRows()` and the `--set` warning in agents.ts

```typescript
// Returns true when model is an external (non-Claude) model AND proxy is disabled.
// Classification by COMPLEMENT: not Claude ↔ external. Discovery-independent.
export function isDormantExternalModel(model: string | undefined, proxyEnabled: boolean): boolean {
  if (model === undefined || proxyEnabled) return false;
  return model !== 'default' && !isClaudeModelName(model);
}
```

Callers that previously duplicated this check inline have been replaced with this export. The complement approach (`isClaudeModelName` as the gate) makes dormancy independent of runtime discovery — a discovery failure cannot degrade the safety property by returning an empty external set.

### Dormancy semantics

A mapping entry whose `model` is a GPT ID materializes into installed agent frontmatter **only while the proxy is enabled**. When the proxy is off, `resolveEffective()` returns the shipped default instead. The mapping entry itself is preserved on disk.

Effort is orthogonal to dormancy — it always applies regardless of proxy state.

### `loadShippedDefaults` and `reapplyAgentMapping` — parallel execution

Both use `Promise.all` for parallel I/O:
- `loadShippedDefaults()` reads all agent `.md` files from `agentsDir()` concurrently.
- `reapplyAgentMapping()` processes all agent files concurrently via `Promise.all` over the agent name list.

Warning collection is **deterministic**: each parallel task returns its local warnings alongside its bucket result; the outer loop aggregates in `allNamesList` insertion order. Warnings are emitted to `opts.onWarning` immediately for live feedback and also collected for the returned `ReapplyResult.warnings` array.

**init.ts guard**: `reapplyAgentMapping` is skipped when mapping is empty AND proxy is off (optimization: all agents already have shipped defaults from the file copy; skips ~34 reads that would produce zero writes). Callers on the disable/revert path always run the full walk.

**Must run AFTER preflight resolves the final `proxyEnabled` value.** In `devflow init`, the proxy preflight block can force `proxyEnabled=false` on failure. Running `reapplyAgentMapping` earlier would leave GPT model identifiers in agent frontmatter files when preflight fails (dormancy violation).

## agent-frontmatter Surgical Rewrite Invariants

`rewriteAgentFrontmatter()` in `src/core/agent-frontmatter.ts` is a pure, zero-I/O function. Key invariants:

- **First-block-scoped**: `FM_RE = /^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/` matches only the first `---...---` block. A `model:` or `effort:` line in the document body is never touched.
- **CRLF-safe**: EOL style (`\r\n` or `\n`) is detected from the opening delimiter line and threaded through all replacements.
- **Body bytes untouched**: `afterClose` (everything after the closing `---`) is appended unchanged.
- **`RewriteResult.changed`** is a byte-level comparison (`newContent !== content`), not a semantic one.

**D-EFR-1: Surgical effort-line removal** (`effort: null`): removes only the matched effort line plus exactly one adjacent EOL — no global `\n{2,}` collapse. The adjacent EOL consumed depends on position:
- effort is last line → swallow the preceding `\r?\n` (no trailing EOL in fmBody)
- effort is mid-body → swallow the trailing `\r?\n` after the line
- effort is first and only line → clear fmBody to `''`

This prevents silent corruption of multi-line YAML values that legitimately contain blank lines.

## Agents TUI Architecture

The TUI follows a pure-reducer / pure-renderer / thin-terminal-shell split (applies ADR-013):

- **`state.ts`** — pure keypress reducer. `reduce(state, key) → {state, intent}`. `buildRow()` calls `isDormantExternalModel()` (from external-models) to initialize dormancy state. All types and dirty helpers exported. No I/O.
- **`render.ts`** — pure renderer. `renderFrame(state, dims) → string[]`. Exports `FIXED_ROWS` and `computeViewportHeight` — consumed by `terminal.ts` (single source of truth for viewport constants).
- **`terminal.ts`** — impure shell. Manages alt-screen, raw mode, SIGINT/SIGTERM handlers, SIGWINCH resize. All cleanup wired via `resolve()` inside the Promise constructor — never `process.exit()` inside a finally-guarded scope (avoids PF-014).

**`TuiIO` injectable seam** (`terminal.ts`): `runAgentsTui(initialState, io?)` accepts an optional `TuiIO` override with fake `stdin`/`stdout` for testing. The default is `process.stdin`/`process.stdout`. Tests pass `PassThrough` streams to drive the TUI without a real TTY.

**`MAX_KEYPRESSES = 50_000`**: Exported constant — hard upper bound on the event loop. Resolves with `action: 'cancel'` on exhaustion. Tests pin this value directly (agents-terminal.test.ts).

**`stdin.pause()` in cleanup**: `runAgentsTui` calls `stdin.resume()` at startup and `stdin.pause()` in cleanup. Without `stdin.pause()`, the resumed stdin TTY handle keeps the Node event loop alive after the TUI resolves and the CLI hangs.

**`FIXED_ROWS`/`computeViewportHeight` single-sourced from `render.ts`**: `terminal.ts` imports both from render.ts — no duplication.

**Lazy-import of `terminal.ts`** in `agents.ts`: `import('../agents-view/terminal.js')` is deferred until the interactive path runs. `--list`, `--set`, `--reset`, and non-TTY calls never load readline/tty machinery.

**Model list source**: `buildTuiState()` calls `discoverExternalModels` (async, spawns, gated on `proxyEnabled`) to get the catalog, then calls `buildModelCycle(proxyEnabled, catalog)` once to build the picker cycle. `buildRow()` receives the pre-built `modelCycle` as a parameter — it performs no discovery I/O. Off-cycle pins (aliases whose current generation is not in the live cycle) are appended at the end of the cycle with `(unavailable)` annotation.

## writeFileAtomicExclusive — Mode Preservation

`writeFileAtomicExclusive` (in `src/core/fs-atomic.ts`) now preserves the target file's permission mode across atomic replace:

1. Write to `.tmp` with O_EXCL (crash-safe).
2. `stat(filePath)` to read the existing mode (permission bits only, masked with `0o777`).
3. `chmod(tmp, mode)` — best-effort, non-fatal on ENOENT (fresh file) or any other error.
4. `rename(tmp, filePath)` — POSIX atomic.

A user who hardened `settings.json` to `0600` (to protect `ANTHROPIC_API_KEY`) no longer has it silently widened to the umask default on every proxy enable/disable. The chmod step is non-fatal (avoids PF-009) — write correctness is never sacrificed for mode preservation.

## Anti-Patterns

- **Naming the internal routing runtime in user-visible strings**: use "external model routing" or "Devflow proxy". "subswitch" is acceptable only in code comments, logs, health-check body comparisons, and env var names.
- **Short-circuiting the disable settings pass with `||`**: `removeProxyHooks(s) || _stripProxyEnvFromObject(s, port)` leaves `ANTHROPIC_BASE_URL` set when hooks are present. Both operations must run unconditionally — see `applyDisableToSettings`.
- **Running `reapplyAgentMapping` before proxy preflight completes**: preflight can force `proxyEnabled=false`, and the dormancy logic depends on the final resolved value. In init, the guard is placed immediately after the proxy preflight block.
- **Calling `process.exit()` inside a finally-guarded scope in the TUI**: cleanup must be wired via Promise `resolve()`. Any `process.exit()` inside `finally` terminates without running cleanup and causes event-loop issues (avoids PF-014).
- **Using previousModel in agent-models.json**: The mapping has no `previousModel` field. Shipped defaults are always read live from `agentsDir()` source files. Caching a previousModel creates stale drift when source agent files are updated.
- **Duplicating the dormancy predicate**: `isDormantExternalModel(model, proxyEnabled)` from `external-models.ts` is the single source of truth. Do not inline `!isClaudeModelName(model) && !proxyEnabled` at call sites.
- **Pre-spawn doctor gating (chicken-and-egg)**: The relay's `doctor` subcommand probes the relay port to confirm it is running — a not-yet-started relay makes that probe fail (exit 1). A pre-spawn gate is therefore always unsatisfiable on a cold path and invisible to unit tests that mock doctor exit 0 (found during the first live enable). Doctor must gate post-spawn only, after the relay is confirmed up (D-EFR-2).
- **D-EFR-3: Never mock the routing-runtime subprocess without a paired real-binary test**: any test that mocks the routing-runtime subprocess must be paired with at least one CI-executed test that does not. The specific trap (PF-016 reproduced exactly): `tests/integration/**` is excluded from `npm test` by `vitest.config.ts` while CI runs only `npm run build && npm test` — a real-binary test placed in `tests/integration/` would never execute in CI. Place real-binary tests in `tests/` (not `tests/integration/`).

## Gotchas

- **`proxy.json` ENOENT is not an error**: `readProxyState()` returns a default disabled state when the file is missing. Callers that treat ENOENT as an error will get a false negative on fresh installs.
- **Port adoption path**: if a relay is already accepting connections on the target port and the health check confirms our identity (`name === 'subswitch'`), preflight returns `adopted: true` and `spawnRelayAndWaitForPort` skips spawning. `spawnedPid` will be absent from `SpawnRelayResult` on this path — `runPostSpawnVerification` must never kill an adopted relay.
- **`stripProxyEnv` is port-scoped (REG-1)**: `stripProxyEnv(settingsJson, managedPort)` removes `ANTHROPIC_BASE_URL` **only when its value exactly matches `http://127.0.0.1:<managedPort>`**. A localhost URL on any other port classifies as `'ours-other-port'` or `'foreign'` and is never touched. Callers must pass the port Devflow owns (from `proxy.json.port` or `DEFAULT_PROXY_PORT`). `readProxyEnvState` uses the pattern `^http://127\.0\.0\.1:\d+$` to classify any localhost URL as `'ours-other-port'` for display purposes only — the strip never uses that broad pattern.
- **Remembered port on re-enable**: `--port` has no commander default. When `--port` is omitted, `portOption` is `undefined` and `resolvePort(undefined, priorPort)` returns the remembered port from `proxy.json`.
- **Dormant TUI rows**: when proxy is off and an agent has a saved GPT model, `buildRow()` calls `isDormantExternalModel()` and sets `configuredModel='default'` with the GPT name in `dormantModel`. On save, if `isDirtyModel` is false, the original GPT mapping entry is preserved byte-identical.
- **`binPath` must be spawned with `node <path>`**: npm does not guarantee executable bits on installed package binaries. Always spawn as `node <binPath>`, never `<binPath>` directly.
- **Leaked stub relays**: proxy tests that spawn stub relays must reap them on the failure path too — not only the happy path. Use `afterEach`/`onTestFinished` with SIGTERM→SIGKILL escalation and confirm death via `process.kill(pid, 0)`. Real incident: three orphaned stub relays accumulated over ~3 weeks; a full run stretched from ~24 seconds to 40+ minutes and produced 13–21 spurious failures in unrelated files (memory pipeline, capture hooks) that were repeatedly misdiagnosed as product defects.
- **`resolveProxyBin()` uses `createRequire(import.meta.url)`**: ESM-safe way to resolve CommonJS package paths. The `require.resolve('subswitch/package.json')` approach finds the package relative to devflow's own `node_modules`, not the user's project.

## Key Files

- `src/core/proxy-state.ts` — ProxyState schema, read/write, `isProxyEnabled()`, `resolveProxyBin()`, `buildRoutingConfigJson()`
- `src/core/external-models.ts` — `CLAUDE_MODEL_ALIASES`, `isClaudeModelName()`, `isDormantExternalModel()` (leaf module, no project imports)
- `src/core/agent-frontmatter.ts` — pure frontmatter rewriter, `readFrontmatterModel()`, `rewriteAgentFrontmatter()`
- `src/core/agent-models.ts` — `readAgentMapping()`, `saveAgentMapping()`, `resolveEffective()`, `reapplyAgentMapping()`, `revertExternalAgents()`, `loadShippedDefaults()`
- `src/core/codex-auth-inspect.ts` — `inspectCodexAuth()` — pure `absent | unreadable | present` verdict on `~/.codex/auth.json` for `--status`. Re-derived rather than imported from the routing runtime, which ships no `exports` map (importing would pin an internal dist path across a pinned-dependency bump). Decodes the JWT payload for display only — never signature-verified, no token material returned, account id truncated to a 6-char suffix
- `src/core/model-discovery.ts` — `discoverExternalModels(cacheDir, logPath, deps?)` (async, spawns runtime, cache-warming after enable), `getExternalModelsCached(cacheDir)` (sync, reads newest cache entry regardless of TTL)
- `src/core/cache.ts` — cache read/write with 0700/0600 permissions, `parseRawEnvelope()`, `pruneOldEntries()` (keeps 3 entries by timestamp)
- `src/core/proxy-log.ts` — `scrubChildEnv()` (allowlist-based env for relay spawn), `openProxyLog()`, `rotateProxyLogIfLarge()`
- `src/core/fs-atomic.ts` — `writeFileAtomicExclusive()` — mode-preserving atomic write
- `src/cli/commands/proxy.ts` — `proxyCommand`; exported seams: `buildRealPreflightDeps`, `spawnRelayAndWaitForPort`, `runPostSpawnVerification`, `resolvePort`, `isOurRelayBody`, `runProxyPreflight`, `applyProxyEnv`, `stripProxyEnv`, `applyDisableToSettings`, `addProxyHooks`, `removeProxyHooks`, `hasProxyHooks`, `readProxyEnvState`, `formatCodexAuthLine`, `PostSpawnDoctorDeps`
- `src/cli/commands/agents.ts` — `agentsCommand`, `validateSetArgs()`, `applySetMapping()`, `buildListRows()`
- `src/cli/agents-view/state.ts` — pure reducer, `buildRow()`, `isDirtyModel()`, `isDirtyEffort()`, `unsavedCount()`
- `src/cli/agents-view/render.ts` — pure frame renderer; exports `FIXED_ROWS`, `computeViewportHeight`
- `src/cli/agents-view/terminal.ts` — impure TUI shell, `runAgentsTui()`, `TuiIO`, `MAX_KEYPRESSES`
- `src/assets/scripts/hooks/ensure-proxy` — SessionStart + UserPromptSubmit hook; writes `proxy.pid` after spawn
- `src/cli/commands/init.ts` — proxy preflight block (4-check, no doctor, no spawn); `reapplyAgentMapping` guard after preflight

## Related

- **ADR-013**: src/core vs src/cli boundary — all state I/O and pure logic in `src/core/`; CLI orchestration and user-facing action handlers in `src/cli/`. The proxy feature is the canonical multi-module example of this split.
- **ADR-014**: state-aware re-init — `proxy` is seeded from `manifest?.features.proxy ?? FEATURE_DEFAULTS.proxy` in `resolveSeedFeatures`. On `--reset`, seeds as `false`. Never read from `config.json`.
- **PF-009**: all proxy artifact removals in uninstall/disable are non-fatal; preflight failure warns but never aborts `devflow init` — `proxyEnabled` is simply forced to `false`.
- **PF-014**: no `process.exit()` inside finally-guarded scopes — TUI cleanup wired via Promise `resolve()`; hard failures in CLI commands set `process.exitCode = 1` and return.
- **PF-001**: port digit-validated before /dev/tcp interpolation in `ensure-proxy`.
- Feature knowledge: `installer-shadowing` — covers `resolveSeedFeatures`, manifest-group feature seeding, and uninstall artifact cleanup patterns that proxy extends.
