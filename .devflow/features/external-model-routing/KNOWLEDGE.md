---
feature: external-model-routing
name: External Model Routing & Per-Agent Model Config
description: "Use when working on the proxy lifecycle (enable, disable, status, preflight), relay teardown, proxy.json or routing config. Keywords: devflow proxy, relay, ANTHROPIC_BASE_URL, dormancy."
category: architecture
directories: [src/core/proxy-state.ts, src/core/codex-auth-inspect.ts, src/cli/commands/proxy.ts]
created: 2026-07-24
updated: 2026-10-10
---

# External Model Routing & Per-Agent Model Config

## Rules

- **KB-AP-1** Never put the routing runtime's package name in a user-visible string, error, CLI output or injected context: say "external model routing" or "Devflow proxy". Code comments, logs, the health-body identity check and `SUBSWITCH_CONFIG` may name it.
- **KB-AP-2** Never compose the disable settings pass as `removeProxyHooks(s) || _stripProxyEnvFromObject(s, port)`: the short-circuit leaves `ANTHROPIC_BASE_URL` pointing at a disabled relay. Evaluate each operation into its own local, then combine.
- **KB-AP-3** Never gate on `doctor` before the relay is spawned: doctor probes the relay port, so a cold path always fails, and unit tests that mock doctor green hide it. Doctor runs post-spawn only.
- **KB-AP-4** Never mock the routing-runtime subprocess without a paired CI-executed real-binary test, and never put that test in `tests/integration/**`, which `npm test` excludes.
- **KB-AP-5** Never emit legacy or unknown routing-config keys or hand-build `proxy-routing.json`: build it only through `buildRoutingConfigJson`, because a legacy or unknown key is a hard relay startup error.
- **KB-AP-6** Never gate the env strip on `isProxyEnabled()` or `readProxyState()`: both return defaults on ENOENT. Gate it on `proxyJsonExists()`, or a foreign gateway is clobbered.
- **KB-AP-7** Never skip preflight check ④ (`checkSettingsEnv`) on the adopted-relay path: a healthy relay on the port does not exempt a foreign `ANTHROPIC_BASE_URL`.
- **KB-AP-8** Never spawn `binPath` directly: npm does not guarantee executable bits, so always `node <binPath>`.
- **KB-AP-9** Never leave stub relays that tests spawn unreaped on the failure path: orphans stretched the full run from seconds to tens of minutes and caused spurious failures in unrelated files.
- **KB-AP-10** Never treat `proxy.json` ENOENT as an error: `readProxyState()` returns the default disabled state, and an error there is a false negative on fresh installs.
- **KB-INV-1** `isProxyEnabled()` reads only `proxy.json` and is the sole dormancy authority; every path that forces the proxy off writes `proxy.json enabled:false` alongside manifest, hooks and env, or a later reapply writes GPT ids with no relay.
- **KB-INV-2** `reapplyAgentMapping` runs only after init preflight has resolved the final `proxyEnabled`.
- **KB-INV-3** Teardown always removes the hooks; it strips env only when `applyProxyTeardownToSettings` receives a managed port derived from an existing `proxy.json` (D-STRIP-1).
- **KB-INV-4** Verification failure kills only a relay this process spawned (`spawnedPid` defined): an adopted relay may serve live sessions.
- **KB-INV-5** `terminateRelay` (disable) signals only after the TCP probe, the health-body identity and the lsof PID-port binding all agree; unavailable or ambiguous lsof means no signal.
- **KB-INV-6** Every settings.json write is one atomic `writeSettingsFileAtomic`, and `installSettings` merges and never clobbers a file it cannot parse.
- **KB-INV-7** Hard CLI failures set `process.exitCode = 1` and return; never `process.exit()`, which skips pending `finally` cleanup.
- **KB-INV-8** Init never spawns the relay or runs doctor; a preflight failure warns and forces `proxyEnabled=false`, never aborting init. The first session's hook starts the relay.
- **KB-INV-9** `--port` has no commander default: omission means the remembered port in `proxy.json` wins.
- **KB-INV-10** The Codex JWT is decoded for display only: never signature-verified, no token material returned, the account id truncated.

## Overview

This feature routes Claude Code requests through a local relay so GPT models (via an OpenAI/Codex subscription) can be assigned per agent beside native Claude aliases. Four layers: a core state and mapping engine (`src/core/`), the proxy CLI (`src/cli/commands/proxy.ts`), a per-agent TUI, and the SessionStart/UserPromptSubmit `ensure-proxy` hook. This hub covers the lifecycle, preflight, routing config and settings handling; two focused knowledge bases cover the rest:

- `.devflow/features/external-model-routing-hook/KNOWLEDGE.md` — the `ensure-proxy` hook, relay spawn environment, binPath re-resolution, `proxy.log`
- `.devflow/features/external-model-routing-agent-config/KNOWLEDGE.md` — `agent-models.json`, dormancy predicate, frontmatter rewriting, agent state, the agents TUI, model discovery and cache, the memory worker's entry

Two authority sources govern the proxy at different points. `manifest.features.proxy` (a manifest-group field like `ambient`, `hud` and `rules`, never in `config.json`) controls whether `devflow init` configures proxy hooks and env; `~/.devflow/proxy.json` controls whether the hook actually activates at runtime. Both must agree, and `devflow proxy --status` surfaces drift between them.

## System Context

The routing runtime is an internal package (`subswitch`, exact-pinned in `package.json`). Its name is a hard branding constraint (KB-AP-1). The internal exceptions are the health-check body comparison (`body['name'] === 'subswitch'` against `/__subswitch/health`, in `isOurRelayBody`), the `SUBSWITCH_CONFIG` env var, hook log lines and comments.

## Proxy Lifecycle

### Authority files

| File | Role |
|------|------|
| `~/.devflow/proxy.json` | Runtime authority, tolerant-parsed by `readProxyState()`. ENOENT yields the default disabled state (KB-AP-10). Fields: `enabled`, `port`, `binPath`, `configPath`, `resolvedAt`, `devflowVersion`. |
| `~/.devflow/proxy-routing.json` | Routing config from `buildRoutingConfigJson(port, existingContent?)`, written before preflight on enable (contract below). |
| `manifest.features.proxy` | Init/uninstall authority. `resolveSeedFeatures` seeds it from `manifest?.features.proxy ?? FEATURE_DEFAULTS.proxy`; `--reset` seeds `false`. |
| `proxy.pid`, `logs/proxy.log`, `.proxy-spawn.lock` | Relay pid record (best-effort), relay log, spawn lock. Handled in the hook knowledge base. |

**`isProxyEnabled()` is the sole dormancy authority** (KB-INV-1): it reads only `proxy.json`, never the manifest. On preflight failure `init.ts` converges `proxy.json` to `enabled:false` alongside manifest, hooks and env; all four artifacts must agree, and a same-process `isProxyEnabled()` call afterwards returns false.

**`proxyJsonExists()` is the evidence discriminator** (D-STRIP-1): `readProxyState()` returns `Ok(defaultState)` on ENOENT and cannot tell "file absent" from "file present at `DEFAULT_PROXY_PORT`". Callers that gate on Devflow-managed evidence (init env strip, disable, uninstall cleanup) call `proxyJsonExists()` instead of inferring from `readProxyState()` (KB-AP-6).

### Enable path (crash-safe)

1. `resolvePort(portOption, priorPort)`: the remembered port from `proxy.json` unless `--port` is given (KB-INV-9).
2. Create `~/.devflow` and `logs/` (0700), run `rotateProxyLogIfLarge` (pre-spawn only; see the hook knowledge base), then write `proxy-routing.json` through `buildRoutingConfigJson(port, existingContent)`.
3. `runProxyPreflight()`: four ordered checks (see Preflight). Doctor is deliberately excluded (KB-AP-3).
4. Write `proxy.json enabled:true` with the freshly resolved `binPath`.
5. `spawnRelayAndWaitForPort()` (exported, injectable through `SpawnAndWaitDeps`): skipped when the relay was adopted. Otherwise it spawns `node <binPath> serve` detached with `{ ...scrubChildEnv(), SUBSWITCH_CONFIG }`, a log fd from `openProxyLog`, a best-effort pid file, then a bounded probe loop (`RELAY_SPAWN_MAX_PROBES` × `RELAY_SPAWN_PROBE_INTERVAL_MS`). If the child dies before the port comes up it probes once more (EADDRINUSE race: another session may now own the port); OS spawn errors arrive through `onError`, never as an uncaught exception. `SpawnRelayResult.spawnedPid` is set only when this process spawned. A relay that never accepts triggers the `rollbackProxyState` closure (`proxy.json enabled:false`) and an error.
6. `runPostSpawnVerification()` (exported, `PostSpawnDoctorDeps`, D-EFR-2): `node <binPath> doctor` against the live relay with the same scrubbed env, bounded by `DOCTOR_TIMEOUT_MS`. On failure: rollback, then SIGTERM and a SIGKILL escalation after a 2 s grace, **only when `spawnedPid` is defined** (KB-INV-4).
7. `applyEnableSettingsPass()` (internal): `removeProxyHooks`, `_stripProxyEnvFromObject(s, port)`, `addProxyHooks`, `_applyProxyEnvToObject` — **all four calls, then one atomic write**. `_applyProxyEnvToObject` sets `ANTHROPIC_BASE_URL` to `http://127.0.0.1:<port>` and `CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT=1`, each condition evaluated independently (D-P4-1). `addProxyHooks` registers `ensure-proxy` on `SessionStart` and `UserPromptSubmit` with a 15 s timeout, idempotently and repairing a half-registered state. A hook is Devflow's only when its command ends in `/scripts/hooks/run-hook ensure-proxy` (D-EXACT-HOOK-OWNER); removal takes single hooks, so others in a shared matcher group stay. A failed write rolls back.
8. Sync the manifest.
9. `reapplyAgentMapping({ proxyEnabled: true })` materializes GPT entries into agent frontmatter.
10. Cache warming: `discoverExternalModels(cacheDir, logPath).catch(() => {})`, awaited under the spinner so the wait is attributed and Node exits cleanly. Strictly non-fatal: a discovery failure never blocks the enable result.

Hard failures at any step set `process.exitCode = 1` and return (KB-INV-7). Enable also warns when `binPath` resolved from the npx cache (`npxWarning`) and tells the user the change applies to new sessions.

### Disable path

1. `proxyJsonExists()` and `readProxyState()` first, to get `managedPort` (falling back to `DEFAULT_PROXY_PORT`) before anything changes.
2. Settings: parse `settings.json` (a malformed file exits 1 before any change), run `applyProxyTeardownToSettings(parsed, proxyManaged ? managedPort : undefined)`, write atomically when changed.
3. Write `proxy.json enabled:false`, **keeping** `port`, `binPath` and `configPath` for the next enable.
4. Sync the manifest to `proxy: false`.
5. `revertExternalAgents()` rewrites installed agent files to shipped default models.
6. `terminateRelay(pidPath, spawnLockPath, port)` (exported; `TerminateRelayDeps` injects the lsof lookup): reads `proxy.pid`, checks liveness (signal 0), and requires **three identity signals** before signalling: a TCP probe, a health body passing `isOurRelayBody`, and `realResolveListeningPid` (lsof, darwin and linux) equal to the pid-file pid (D-EFR-5: a recycled pid can fool the first two together). Absent or ambiguous lsof is `identity-unconfirmed` with no signal. Then SIGTERM with a bounded poll, SIGKILL with a bounded poll, pid-file removal and a best-effort `rmdir` of the stale spawn lock. Outcomes `killed`, `not-running`, `identity-unconfirmed` and `kill-failed` each print a message; none aborts the disable (KB-INV-5).
7. Always warn that already-running Claude Code sessions captured `ANTHROPIC_BASE_URL` in their env and stay routed until restarted.

`devflow uninstall` only reports a still-running relay (PID and a manual `kill` hint); it never signals. `--status` always probes the relay, even when disabled, so it surfaces the case of a disabled feature with a relay still listening.

### Settings teardown

`applyProxyTeardownToSettings(settings, managedPort | undefined)` is the single teardown decision point for disable and uninstall. With `managedPort === undefined` it returns `removeProxyHooks(settings)` only; otherwise it delegates to `applyDisableToSettings`. The caller derives `managedPort` from an existing `proxy.json`, which is evidence that Devflow wrote the vars; with no file, passing `undefined` skips the env strip rather than clobber a foreign gateway (KB-INV-3).

**Uninstall** pre-captures `managedProxyPorts` per scope before any artifact removal, populating an entry only when `proxyJsonExists()`, because the full phase deletes `proxy.json` and a read afterwards would always yield `DEFAULT_PROXY_PORT`. Its cleanup phase passes the port when an entry exists and `undefined` when not.

**`applyDisableToSettings(settings, managedPort)` — both-operations invariant (KB-AP-2).** `removeProxyHooks(s)` and `_stripProxyEnvFromObject(s, port)` both always evaluate and their results are OR-ed afterwards. `_stripProxyEnvFromObject` removes `CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT` unconditionally (Devflow is its only producer, so there is no foreign value to protect) and removes `ANTHROPIC_BASE_URL` only when it exactly equals `http://127.0.0.1:<managedPort>`, so a user's own localhost gateway on another port survives. The unconditional window-var removal is safe only because the evidence gate (`proxyJsonExists()`, D-STRIP-1) is the outer guard, not the inner strip. The regression this guards: with `removeProxyHooks(s) || strip(s, port)`, present hooks short-circuit the strip and new sessions keep pointing at a disabled relay.

### Preflight

`runProxyPreflight(port, codexAuthPath, configPath, logPath, deps)` runs four ordered, hard-gated checks:

```
① resolveProxyBin()              — bin resolvable from devflow's node_modules
② fileExists(~/.codex/auth.json) — Codex auth present ("Sign in to the Codex CLI first")
③ tcpConnectable(port, PROBE_TIMEOUT_MS) — free, or our relay already running
   └── accepting: health check → adopted=true | port-conflict Err
④ checkSettingsEnv(deps, port)   — settings.json readable and parseable; ANTHROPIC_BASE_URL not 'foreign'; API-key warn (non-fatal)
```

**Check ④ is extracted as `checkSettingsEnv(deps, port)` (D-EFR-5)** and runs on both the adopted-relay and the free-port branches, before any early return on adoption (KB-AP-7). The earlier ordering ran it only on the free-port branch, so a healthy relay silently bought an exemption from the foreign-gateway refusal. Keeping it in one function also stops the two paths drifting on messages. `PreflightResult` carries `binPath`, `npxWarning` and `adopted`.

`spawnDoctor` sits on `ProxyPreflightDeps` and is built by `buildRealPreflightDeps(opts)` (exported, shared by `runEnable` and `init.ts`), so `runEnable` reuses the same instance for `runPostSpawnVerification`; preflight itself never calls it. Every check is injectable. `swallowSettingsReadError: true` is init's choice (init creates `settings.json` itself and must tolerate its absence, so `readSettingsJson()` resolves `'{}'` on I/O failure); `false` for `runEnable`, which propagates read errors. Production probes: `realTcpConnectable`, and `realHttpGet(url, timeoutMs)` with three bounds (wall-clock deadline, `BODY_CAP_BYTES` body cap, a `res.on('error')` handler).

### Init and uninstall

**Init never runs doctor and never spawns** (KB-INV-8). With routing wanted, it recovers the remembered port (init has no `--port`), writes the routing config through `buildRoutingConfigJson` (a write failure forces `proxyEnabled=false`), runs `runProxyPreflight` with `buildRealPreflightDeps({ swallowSettingsReadError: true })`, and on success writes `proxy.json enabled:true` with the freshly resolved `binPath` (the heal path for upgrades). On failure it warns, forces `proxyEnabled=false` and writes `proxy.json enabled:false` when the prior state was enabled; with the proxy off at entry, a prior enabled `proxy.json` is marked disabled the same way. Deeper diagnostics (doctor, spawn) live in `devflow proxy --enable` and `--status`.

`init.ts` gates the env strip on `proxyJsonExists()` (explicit `D-STRIP-1` comment): with no file on a machine that never had the proxy, no stripping runs; with the file, its port is passed to `_stripProxyEnvFromObject` as `managedPort`. The `reapplyAgentMapping` call comes after the preflight block (KB-INV-2) and is skipped only when the mapping has no agent entries and the proxy is off (see the agent-config knowledge base).

### Exported seams in proxy.ts

| Export | Purpose |
|--------|---------|
| `buildRealPreflightDeps(opts)`, `BuildRealPreflightDepsOptions` | Production `ProxyPreflightDeps`, shared by `runEnable` and `init.ts` |
| `runProxyPreflight`, `ProxyPreflightDeps`, `PreflightResult` | The preflight contract |
| `spawnRelayAndWaitForPort`, `SpawnAndWaitDeps`, `SpawnRelayResult` | Spawn plus bounded port wait; `spawnedPid?` absent on the adopted path |
| `runPostSpawnVerification`, `PostSpawnDoctorDeps` | Post-spawn doctor with rollback and conditional kill (D-EFR-2) |
| `terminateRelay`, `TerminateRelayDeps` | Identity-confirmed relay stop used by disable (D-EFR-5) |
| `resolvePort(portOption, priorPort)` | Port resolution with remembered-port fallback |
| `isOurRelayBody(body)` | Health-body identity check (`name === 'subswitch'`) |
| `applyProxyEnv`, `stripProxyEnv` | Pure settings-JSON-string transforms, no mutation |
| `applyDisableToSettings`, `applyProxyTeardownToSettings` | Both-operations invariant; unified teardown (D-STRIP-1) |
| `addProxyHooks`, `removeProxyHooks`, `hasProxyHooks` | Hook mutation helpers |
| `readProxyEnvState` | One of `ours`, `ours-other-port`, `foreign`, `absent`, for `--status` |
| `formatCodexAuthLine(state, path, now)` | `{ level, msg }`: `warn` when the state is `unreadable`, `info` otherwise; expiry is informational only because the relay refreshes tokens proactively; `AUTH_MODE_MAX_LEN` bounds the rendered auth mode (hostile `~/.codex/auth.json`) |
| `formatExternalModelsLine(catalog, logPath)` | Selectable model names, or `unavailable` with the log path |
| `realHttpGet(url, timeoutMs)` | Bounded HTTP GET |

Internal (not exported): `applyEnableSettingsPass`, `checkSettingsEnv`, `resolveProcessState`, `formatProcessLine`, `readPidFile`, `PROBE_TIMEOUT_MS`, `DOCTOR_TIMEOUT_MS`, `RELAY_SPAWN_*`.

### Codex auth inspection

`codex-auth-inspect.ts` re-derives the verdict rather than importing it, because the routing runtime ships no `exports` map. `inspectCodexAuth()` is a pure absent/unreadable/present verdict; `classifyCodexAuthReadError(err)` is exported so tests can feed it a synthetic error (ENOENT is `absent`, anything else `unreadable`) without mocking the filesystem. The JWT payload is decoded for display only (KB-INV-10).

## Routing Config Contract (D-EFR-4)

`buildRoutingConfigJson(port, existingContent?)` builds `proxy-routing.json` for the pinned relay, whose `FileConfigSchema` is a strict object. The relay accepts the top-level keys `port`, `logLevel`, `anthropic`, `providers`, `limits` and `codexIngress`; any other key is a hard startup error. Devflow carries only the first five (`ROUTING_CONFIG_ALLOWED_TOP_KEYS`). `codexIngress` is deliberately not carried: devflow's relay serves Claude Code only, and the ingress block would make it accept native Codex traffic and hold Claude credentials on devflow's behalf. `anthropic` and `limits` are themselves strict objects with `prefault({})`, so they may be partial.

A fresh write is **port-only**; no `anthropic` block is injected, and the relay's own defaults govern. A missing or malformed existing file falls back to port-only. User customisations (`logLevel`, `providers`, `anthropic` and `limits` sub-keys) are preserved so an upgrade from an older pinned version cannot leave the relay unable to boot. **`ROUTING_CONFIG_REJECTED_SUBKEYS`** lists the sub-keys stripped on the way, each a registered legacy key (a hard startup error naming its replacement) that was valid under a version devflow previously pinned and is therefore reachable in a real user's file:

- `anthropic.streamIdleTimeoutMs` (the relay no longer bounds the stream-idle phase on a connected client)
- `limits.connectTimeoutMs` (moved to `anthropic.connectTimeoutMs`; stripping loses nothing)
- `limits.maxConcurrentRequests` (admission gate removed)
- `limits.maxBodyBytes` (renamed `limits.maxBufferedBodyBytes`)
- `limits.maxUpstreamSockets` (moved to `anthropic.maxUpstreamSockets`)
- `limits.streamIdleTimeoutMs`, `limits.requestTimeoutMs`, `limits.maxSseEventBytes` (moved under `providers.codex.*`)

Keys retired before the earliest baseline are deliberately absent: only keys reachable in a config written by a previously pinned devflow belong on the list.

**`anthropic.connectTimeoutMs`** bounds only the DNS and TCP connect: armed on the socket, disarmed on the `'connect'` event. It never bounds the headers or stream phase, so it cannot cap a long request that has already connected (in an earlier relay generation it was an inactivity timeout that killed long requests). The relay's own default applies when the user set none, `buildRoutingConfigJson` injects no value, and a user-set value is preserved as is.

**Body handling**: bodies over the buffering window are streamed to Anthropic rather than rejected (route labels `anthropic:streamed` and `anthropic:streamed:unsniffed`, log field `bodyMode`). Only translated (Codex) routes still return 413 `request_too_large`. The old synthesized 503 `overloaded_error` no longer exists; devflow never depended on it.

## Settings Merge (D-SETTINGS-1)

`installSettings` in `src/targets/claude-code/post-install.ts` **merges** the Devflow template into an existing `settings.json`:

- **Fresh file**: write the template (through `writeSettingsFileAtomic`).
- **Existing file**: `mergeDevflowSettingsTemplate(existingParsed, templateParsed)` adds Devflow hook entries absent from the file (idempotent by exact command string) and sets `statusLine` only when the user has none. `attribution` is not touched: the flags pipeline owns it exclusively, and a second writer would race it. When nothing changed, no write happens.
- **Parse failure**: warn and skip; the file stays byte-identical, a broken `settings.json` is never clobbered.
- **Foreign hook shapes**: a `hooks` value or per-event value that is not the expected object or array is left untouched rather than overwritten or thrown on. Every shape check sits at the mutation sink; `mergeDevflowSettingsTemplate` is exported for unit testing.

There is no override-confirm prompt: the merge is purely additive (Devflow entries only), declining could not protect keys the merge never touches, and the prompt rendered on top of init's spinner.

## Atomic Settings Writes

`writeFileAtomicExclusive` (`src/core/fs-atomic.ts`) writes a PID-scoped sibling `.tmp.<pid>` with `O_EXCL` (a pre-existing or planted temp path is unlinked and retried once), copies the existing target's permission bits onto it (mask `0o777`, best-effort and non-fatal on ENOENT or any error), then `rename`s over the target. An optional `createMode` creates the temp owner-only from the start. A user who hardened `settings.json` to `0600` to protect `ANTHROPIC_API_KEY` is therefore not widened to the umask default on every enable or disable; write correctness is never sacrificed for mode preservation. `writeSettingsFileAtomic` (D-SETTINGS-ATOMIC) is the one entry for every Claude settings write and follows a symbolic-link `settings.json` to its resolved file, so a dotfiles-managed link keeps pointing where the user pointed it.

## Anti-Patterns

- **KB-AP-3** — Found during the first live enable: the relay's `doctor` probes the relay port, and a not-yet-started relay makes that probe exit 1, so a pre-spawn gate is unsatisfiable on a cold path (D-EFR-2). Doctor gates only after the relay is confirmed up, and only a self-spawned relay may be killed on failure.
- **KB-AP-4** — `tests/integration/**` is excluded from `npm test` by `vitest.config.ts`, and CI runs only `npm run build && npm test`, so a real-binary test placed there never executes in CI (D-EFR-3). Place real-binary tests in `tests/`.
- **KB-AP-6** — With `proxyJsonExists()` as the gate, a machine that never had the proxy is never touched; `readProxyState()` makes "absent" and "present at the default port" indistinguishable.

## Gotchas

- **KB-AP-8** — `resolveProxyBin()` uses `createRequire(import.meta.url)`, the ESM-safe way to resolve CommonJS package paths; `require.resolve('subswitch/package.json')` finds the package relative to devflow's own `node_modules`, not the user's project.
- **KB-AP-9** — Reap stub relays with `afterEach`/`onTestFinished`, SIGTERM then SIGKILL, and confirm death with `process.kill(pid, 0)`. The incident: orphaned stub relays accumulated over weeks and produced spurious failures in memory-pipeline and capture-hook tests that were repeatedly misdiagnosed as product defects.
- Non-fatal everywhere: artifact removal in uninstall and disable, `writeFileAtomicExclusive`'s chmod, and the hook's binPath re-resolution never abort their command.

## Key Files

- `src/core/proxy-state.ts` — `ProxyState` schema and read/write, `isProxyEnabled()`, `proxyJsonExists()`, `resolveProxyBin()` and `RUNTIME_VERSION_RE`, `buildRoutingConfigJson()`, `ROUTING_CONFIG_REJECTED_SUBKEYS`
- `src/core/codex-auth-inspect.ts` — `inspectCodexAuth()`, `classifyCodexAuthReadError()`
- `src/core/fs-atomic.ts` — `writeFileAtomicExclusive()` (mode-preserving), `writeSettingsFileAtomic()` (symlink-following)
- `src/cli/commands/proxy.ts` — `proxyCommand`, `runEnable`, `runDisable`, `runStatus` and the seams in the table above
- `src/targets/claude-code/post-install.ts` — `installSettings()`, `mergeDevflowSettingsTemplate()`
- `src/cli/commands/init.ts` — the proxy preflight block, `proxyJsonExists()`-gated env strip, `reapplyAgentMapping` after preflight, convergence writing `proxy.json enabled:false`
- `src/cli/commands/uninstall.ts` — `managedProxyPorts` pre-capture, `applyProxyTeardownToSettings`, proxy artifact paths, the still-running-relay notice
- `src/core/proxy-log.ts`, `src/assets/scripts/hooks/ensure-proxy` — see the hook knowledge base
- `src/core/agent-models.ts`, `src/core/model-discovery.ts`, `src/cli/commands/agents.ts` — see the agent-config knowledge base

## Related

- `.devflow/features/external-model-routing-hook/KNOWLEDGE.md` — the hook that starts the relay on SessionStart, the relay `env -i` allowlist and `scrubChildEnv()` it must stay in sync with
- `.devflow/features/external-model-routing-agent-config/KNOWLEDGE.md` — mapping engine, dormancy, agent state, TUI, discovery and cache; the proxy off-switch rules above feed its dormancy semantics
- `.devflow/features/installer-shadowing/KNOWLEDGE.md` — `resolveSeedFeatures`, manifest-group feature seeding and uninstall artifact cleanup patterns that the proxy extends
- `.devflow/features/learning-capture-system-memory-worker/KNOWLEDGE.md` — the memory worker's side of `agents.memory`
- `src/core/` and `src/cli/` — all state I/O and pure logic in core, CLI orchestration in cli; the proxy feature is the canonical multi-module example of the split
