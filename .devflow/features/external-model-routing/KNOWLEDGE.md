---
feature: external-model-routing
name: External Model Routing & Per-Agent Model Config
description: "Use when working on the proxy lifecycle (enable/disable/status/preflight), the ensure-proxy hook, per-agent model mapping, agent frontmatter rewriting, or the agents TUI. Keywords: proxy, external-model-routing, GPT, agent-models, ensure-proxy, frontmatter, devflow proxy, devflow agents, subswitch, ANTHROPIC_BASE_URL, dormancy, reapplyAgentMapping."
category: architecture
directories: [src/core/proxy-state.ts, src/core/external-models.ts, src/core/agent-models.ts, src/core/agent-frontmatter.ts, src/cli/commands/proxy.ts, src/cli/commands/agents.ts, src/cli/agents-view, src/assets/scripts/hooks/ensure-proxy]
created: 2026-07-24
updated: 2026-07-24
---

# External Model Routing & Per-Agent Model Config

## Overview

This feature routes Claude Code requests through a local relay so GPT models (via an OpenAI/Codex subscription) can be assigned per-agent alongside native Claude aliases. The feature has four layers: a **core state/mapping engine** (`src/core/`), a **proxy CLI command** (`src/cli/commands/proxy.ts`), a **per-agent TUI** (`src/cli/commands/agents.ts` + `src/cli/agents-view/`), and a **SessionStart/UserPromptSubmit hook** (`src/assets/scripts/hooks/ensure-proxy`).

Two authority sources govern the proxy at different points in its lifecycle. `manifest.features.proxy` (manifest-group field, same as `ambient`, `hud`, `rules`) controls whether `devflow init` configures proxy-related hooks and env; `~/.devflow/proxy.json` controls whether the `ensure-proxy` hook actually activates at runtime. Both must agree for the feature to be fully operational. A drift between the two is surfaced by `devflow proxy --status`.

## System Context

The routing runtime is an internal package (`subswitch@0.1.0`, exact-pinned in `package.json`). Its name is a **hard branding constraint** — it must never appear in user-visible strings, error messages, CLI output, or agent context injections. User-facing vocabulary is always "external model routing" / "Devflow proxy". The one exception is internal code: health-check body comparisons (`body['name'] === 'subswitch'`), `SUBSWITCH_CONFIG` env var, and hook log lines are fine.

## Proxy Lifecycle

### Authority files

| File | Role |
|------|------|
| `~/.devflow/proxy.json` | Runtime authority. Tolerant-parsed by `readProxyState()`. ENOENT → default disabled state (not an error). Fields: `enabled`, `port`, `binPath`, `configPath`, `models[]`, `resolvedAt`, `devflowVersion`. |
| `~/.devflow/proxy-routing.json` | Routing config written by `buildRoutingConfigJson(port, models)`. Shape: `{port, codex:{models:[]}}`. Written before preflight runs on enable. |
| `manifest.features.proxy` | Init/uninstall authority. Seeds from prior manifest on re-init (ADR-014). Never in `config.json` — manifest-group by design, same as `ambient`/`hud`/`rules`. |

### Enable path (crash-safe)

1. Write `proxy-routing.json` with all external model IDs.
2. Run `runProxyPreflight()` (5 ordered checks — see Preflight section).
3. On success: write `proxy.json` `enabled:true`, spawn relay with bounded wait.
4. Spawn wait: 80×100ms probe loop (8s maximum, well within the hook's 15s timeout).
5. If relay never accepts: write `proxy.json` `enabled:false` (rollback), return error.
6. Settings pass: `removeProxyHooks` + `_stripProxyEnvFromObject` + `addProxyHooks` + `_applyProxyEnvToObject` — **all four calls in one atomic JSON write** to `~/.claude/settings.json`.
7. Sync manifest.
8. `reapplyAgentMapping({ proxyEnabled: true })` — materializes GPT model entries into agent frontmatter.

### Disable path (never kills relay)

The relay process is intentionally left running on `--disable` for any live Claude Code sessions. The disable path:
1. `applyDisableToSettings(parsedSettings)` — removes hooks AND strips `ANTHROPIC_BASE_URL` (see invariant below).
2. Writes `proxy.json` `enabled:false` — **keeps** `port`, `binPath`, `configPath`, `models` for the next enable.
3. Syncs manifest to `proxy: false`.
4. `revertExternalAgents()` — rewrites installed agent files to shipped default models.
5. Emits a note with the relay PID and a manual `kill` command; **never calls `kill` programmatically**.

### `applyDisableToSettings` — both-operations invariant

```typescript
// CORRECT — both operations run unconditionally:
export function applyDisableToSettings(settings: Settings): boolean {
  const removedHooks = removeProxyHooks(settings);
  const strippedEnv = _stripProxyEnvFromObject(settings);
  return removedHooks || strippedEnv;
}
```

The regression that this guards against: `removeProxyHooks(s) || _stripProxyEnvFromObject(s)` short-circuits when hooks are present — `_stripProxyEnvFromObject` never runs, leaving `ANTHROPIC_BASE_URL` pointing at a disabled relay in new sessions. Both calls must always evaluate regardless of the other's return value.

### Preflight checks (5 in order, hard-gated)

```
① resolveProxyBin()           — bin resolvable from devflow's node_modules
② fileExists(~/.codex/auth.json) — Codex auth present
③ tcpConnectable(port, 2000ms) — port free or our relay already running
   └── if accepting: health check → adopted=true | port-conflict Err
④ readSettingsJson parseable; ANTHROPIC_BASE_URL not 'foreign'; API key warn (non-fatal)
⑤ spawnDoctor(binPath, SUBSWITCH_CONFIG=configPath, 10s) — doctor exits 0
```

All five are injectable via `ProxyPreflightDeps`, making every branch unit-testable without filesystem access.

## ensure-proxy Hook Contract

The hook is registered on **both** `SessionStart` and `UserPromptSubmit` with a 15-second timeout. A single bash script handles both events:

```bash
# Event detection — UUIDs cannot contain '"prompt"' with both quotes
HOOK_EVENT="SessionStart"
case "$INPUT" in
  *'"prompt"'*) HOOK_EVENT="UserPromptSubmit" ;;
esac
```

| Event | Port state | Behavior |
|-------|-----------|---------|
| UserPromptSubmit | UP | exit 0, no output (fast path) |
| UserPromptSubmit | DOWN | exit 0, no output (silent — SessionStart already warned) |
| SessionStart | UP + correct identity | exit 0, no output |
| SessionStart | UP + wrong identity | exit 0 + `json_session_output` warning ("port occupied by another application") |
| SessionStart | DOWN + missing bin/config | exit 0 + `json_session_output` warning ("relay binary not found" / "routing config not found") |
| SessionStart | DOWN + prerequisites ok | acquire spawn lock → nohup spawn → wait 80×0.1s → exit 0 [+warning if never up] |

The hook is **not git-gated** (unlike `preamble` and `session-start-orchestrator`). Proxy is a user-scope global feature — no `source git-marker` check.

Port value is digit-validated via `case` pattern before interpolation into `/dev/tcp` and context strings (avoids PF-001). The spawn lock (`$DEVFLOW_DIR/.proxy-spawn.lock`, 2s acquire timeout, 30s stale break) uses the shared `learning-lock` helper to prevent concurrent sessions from double-spawning the relay. `SUBSWITCH_CONFIG` is exported into the relay's environment before the `nohup` spawn.

## Mapping Engine (agent-models.json)

`~/.devflow/agent-models.json` is a **deviations-only** mapping: agents that use their shipped defaults are omitted entirely. There is **no `previousModel` field** — shipped defaults are read live from `src/assets/agents/` source files at convergence time via `loadShippedDefaults()`.

### Dormancy semantics

A mapping entry whose `model` is a GPT ID (in `externalModelIds()`) materializes into installed agent frontmatter **only while the proxy is enabled**. When the proxy is off, `resolveEffective()` returns the shipped default instead. The mapping entry itself is preserved on disk.

Effort is orthogonal to dormancy — it always applies regardless of proxy state.

```typescript
// resolveEffective — pure function, no I/O
function resolveEffective(agentName, mapping, shippedDefaults, proxyEnabled): EffectiveConfig {
  const entry = mapping.agents[agentName];
  const isGpt = entry?.model !== undefined && gptIds.includes(entry.model);

  let model: string | undefined;
  if (isGpt && !proxyEnabled) {
    model = shippedDefaults[agentName];  // dormant — use shipped default
  } else {
    model = entry?.model ?? shippedDefaults[agentName];
  }
  // effort always from entry regardless of proxy state:
  return { model, effort: entry?.effort };
}
```

### `reapplyAgentMapping` idempotent convergence

Walks ALL installed agent files (registry names ∪ mapping keys) and calls `rewriteAgentFrontmatter()` for each. `RewriteResult.changed` is a byte-level check — files already in the desired state are untouched. Missing installed files are recorded as `skippedMissing` (not errors). Malformed frontmatter generates a warning and skips.

**Must run AFTER preflight resolves the final `proxyEnabled` value.** In `devflow init`, the proxy preflight block can force `proxyEnabled=false` on failure. If `reapplyAgentMapping` runs before that resolution, a preflight failure leaves GPT model identifiers written into agent frontmatter files (dormancy violation — GPT lines materialize for a disabled proxy).

## agent-frontmatter Surgical Rewrite Invariants

`rewriteAgentFrontmatter()` in `src/core/agent-frontmatter.ts` is a pure, zero-I/O function. Key invariants that callers depend on:

- **First-block-scoped**: the regex `FM_RE = /^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/` matches only the first `---...---` block. A `model:` or `effort:` line in the document body is never touched.
- **CRLF-safe**: EOL style (`\r\n` or `\n`) is detected from the opening delimiter line and threaded through all replacements. Output preserves the file's original line-ending style byte-for-byte.
- **Body bytes untouched**: `afterClose` (everything after the closing `---`) is appended unchanged.
- **`RewriteResult.changed`** is a byte-level comparison (`newContent !== content`), not a semantic one. A no-op rewrite returns `changed: false` — callers use this for cheap idempotency checks.

For error returns (`no-frontmatter`, `unterminated-frontmatter`), `reapplyAgentMapping` warns and records the agent as `skippedMissing`.

## Agents TUI Architecture

The TUI follows a pure-reducer / pure-renderer / thin-terminal-shell split (applies ADR-013):

- **`state.ts`** — pure keypress reducer. `reduce(state, key) → {state, intent}`. `buildRow()` initializes dormancy state. All types and dirty helpers exported. No I/O.
- **`render.ts`** — pure renderer. `renderFrame(state, dims) → string[]`. Returns one string per terminal line with no embedded newlines.
- **`terminal.ts`** — impure shell. Manages alt-screen, raw mode, SIGINT/SIGTERM handlers, SIGWINCH resize. All cleanup wired via `resolve()` inside the Promise constructor — never `process.exit()` inside a finally-guarded scope (avoids PF-014).

Two TUI-specific invariants:

**`MAX_KEYPRESSES = 50_000`**: Hard upper bound on the event loop — if the TUI receives 50,000 keypresses it resolves with `action: 'cancel'`. Satisfies the project reliability rule requiring all loops to have a fixed bound.

**`stdin.pause()` in cleanup**: The `runAgentsTui` function calls `stdin.resume()` at startup and `stdin.pause()` in cleanup. Without `stdin.pause()`, the resumed stdin TTY handle keeps the Node event loop alive after the TUI resolves, and the CLI process hangs. This is the regression guard.

**Lazy-import of `terminal.ts`** in `agents.ts`: `import('../agents-view/terminal.js')` is deferred until the interactive path runs. `--list`, `--set`, `--reset`, and non-TTY calls never load readline/tty machinery.

## Anti-Patterns

- **Naming the internal routing runtime in user-visible strings**: use "external model routing" or "Devflow proxy". "subswitch" is acceptable only in code comments, logs, health-check body comparisons, and env var names.
- **Short-circuiting the disable settings pass with `||`**: `removeProxyHooks(s) || _stripProxyEnvFromObject(s)` leaves `ANTHROPIC_BASE_URL` set when hooks are present. Both operations must run unconditionally — see `applyDisableToSettings`.
- **Running `reapplyAgentMapping` before proxy preflight completes**: preflight can force `proxyEnabled=false`, and the dormancy logic depends on the final resolved value. In init, the comment at line 1344 in `init.ts` is the canonical placement anchor.
- **Calling `process.exit()` inside a finally-guarded scope in the TUI**: cleanup must be wired via Promise `resolve()`. Any `process.exit()` inside `finally` terminates without running cleanup and causes event-loop issues (avoids PF-014).
- **Using previousModel in agent-models.json**: The mapping has no `previousModel` field. Shipped defaults are always read live from `agentsDir()` source files. Caching a previousModel creates stale drift when source agent files are updated.

## Gotchas

- **`proxy.json` ENOENT is not an error**: `readProxyState()` returns a default disabled state when the file is missing. Callers that treat ENOENT as an error will get a false negative on fresh installs.
- **Port adoption path**: if a relay is already accepting connections on the target port and the health check confirms our identity (`name === 'subswitch'`), preflight returns `adopted: true` and `runEnable` skips spawning. The enable path then writes `proxy.json` and proceeds — the existing relay is adopted as-is.
- **`stripProxyEnv` only removes our relay's URL**: it matches `^http://127\.0\.0\.1:\d+$`. A user's own custom `ANTHROPIC_BASE_URL` (e.g., a corporate gateway) is never touched. `readProxyEnvState` distinguishes: `'ours'`, `'ours-other-port'`, `'foreign'`, `'absent'`.
- **Dormant TUI rows**: when proxy is off and an agent has a saved GPT model, `buildRow()` sets `configuredModel='default'` and stores the GPT name in `dormantModel`. On save, `applyTuiSave` checks `isDirtyModel` — if the user didn't touch the dormant row, the original GPT mapping entry is preserved byte-identical (not overwritten with 'default').
- **`binPath` must be spawned with `node <path>`**: npm does not guarantee executable bits on installed package binaries. Always spawn as `node <binPath>`, never `<binPath>` directly.
- **`resolveProxyBin()` uses `createRequire(import.meta.url)`**: ESM-safe way to resolve CommonJS package paths. The `require.resolve('subswitch/package.json')` approach finds the package relative to devflow's own `node_modules`, not the user's project.

## Key Files

- `src/core/proxy-state.ts` — ProxyState schema, read/write, `isProxyEnabled()`, `resolveProxyBin()`, `buildRoutingConfigJson()`
- `src/core/external-models.ts` — `EXTERNAL_GPT_MODELS` registry and `externalModelIds()` (leaf module, no project imports)
- `src/core/agent-frontmatter.ts` — pure frontmatter rewriter, `readFrontmatterModel()`, `rewriteAgentFrontmatter()`
- `src/core/agent-models.ts` — `readAgentMapping()`, `saveAgentMapping()`, `resolveEffective()`, `reapplyAgentMapping()`, `revertExternalAgents()`, `loadShippedDefaults()`
- `src/cli/commands/proxy.ts` — `proxyCommand`, `runProxyPreflight()`, `applyProxyEnv()`, `stripProxyEnv()`, `applyDisableToSettings()`, `addProxyHooks()`, `removeProxyHooks()`, `hasProxyHooks()`
- `src/cli/commands/agents.ts` — `agentsCommand`, `validateSetArgs()`, `applySetMapping()`, `buildListRows()`
- `src/cli/agents-view/state.ts` — pure reducer, `buildRow()`, `isDirtyModel()`, `isDirtyEffort()`, `unsavedCount()`
- `src/cli/agents-view/render.ts` — pure frame renderer
- `src/cli/agents-view/terminal.ts` — impure TUI shell, `runAgentsTui()`
- `src/assets/scripts/hooks/ensure-proxy` — SessionStart + UserPromptSubmit hook
- `src/cli/commands/init.ts` — proxy preflight block (lines ~1233–1360), `reapplyAgentMapping` after preflight (line ~1344)

## Related

- **ADR-013**: src/core vs src/cli boundary — all state I/O and pure logic in `src/core/`; CLI orchestration and user-facing action handlers in `src/cli/`. The proxy feature is the canonical multi-module example of this split.
- **ADR-014**: state-aware re-init — `proxy` is seeded from `manifest?.features.proxy ?? FEATURE_DEFAULTS.proxy` in `resolveSeedFeatures`. On `--reset`, seeds as `false`. Never read from `config.json`.
- **PF-009**: all proxy artifact removals in uninstall/disable are non-fatal; preflight failure warns but never aborts `devflow init` — `proxyEnabled` is simply forced to `false`.
- **PF-014**: no `process.exit()` inside finally-guarded scopes — TUI cleanup wired via Promise `resolve()`; `applyDisableToSettings` does not call exit on partial state.
- **PF-001**: port digit-validated before /dev/tcp interpolation in `ensure-proxy`.
- Feature knowledge: `installer-shadowing` — covers `resolveSeedFeatures`, manifest-group feature seeding, and uninstall artifact cleanup patterns that proxy extends.
