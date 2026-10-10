---
feature: external-model-routing-agent-config
name: External Model Routing — Per-Agent Model Config, Agents TUI & Model Discovery
description: "Use when working on agent-models.json, frontmatter rewriting, dormancy, the agents TUI, model discovery or agents.memory. Keywords: devflow agents, reapplyAgentMapping."
category: architecture
directories: [src/core/external-models.ts, src/core/agent-models.ts, src/core/agent-state.ts, src/core/agent-frontmatter.ts, src/core/model-discovery.ts, src/core/cache.ts, src/cli/commands/agents.ts, src/cli/agents-view, src/cli/tui]
created: 2026-10-10
updated: 2026-10-10
---

# External Model Routing — Per-Agent Model Config, Agents TUI & Model Discovery

## Rules

- **KB-AP-1** Never store a `previousModel` in `agent-models.json`: shipped model and effort are read live (`loadShippedAgentDefaults`), and a cached copy drifts when agent files change.
- **KB-AP-2** Never inline the dormancy test: call `isDormantExternalModel`, which classifies by complement (not Claude means external) so a discovery failure cannot weaken it.
- **KB-AP-3** Never put agent-state classification in `external-models.ts`: that leaf module has one job (dormancy predicate and Claude alias set); the classifier lives in `agent-state.ts`.
- **KB-AP-4** Never call model discovery from `validateSetArgs`, `--list` or `--reset`: validation is the pure `isValidModelName`, zero spawns is pinned by spy tests, and configure-first-then-enable must keep working.
- **KB-AP-5** Never name a model at an `Agent` spawn or workflow `agent()` call: a spawn-level model outranks the frontmatter where `devflow agents` overrides land (`tests/guards/spawn-no-hardcoded-model.test.ts`).
- **KB-AP-6** Never call `process.exit()` inside a `finally`-guarded TUI scope: it skips cleanup and wedges the event loop; resolve the Promise instead.
- **KB-AP-7** Never read or write `tools:`, `disallowedTools:`, `omitClaudeMd:` or `skills:` from the rewriter: only `model:` and `effort:` are managed.
- **KB-AP-8** Never collapse blank lines when removing an `effort:` line (D-EFR-1): remove the line plus exactly one adjacent EOL, or multi-line YAML values are corrupted.
- **KB-AP-9** Never look up `LEGACY_AGENT_KEYS` with `in` or bracket access: use `Object.hasOwn` on its null-prototype map (`__proto__` pollution).
- **KB-AP-10** Never let discovery see a user-level routing config: it runs with `XDG_CONFIG_HOME` pointed at the cache dir and `SUBSWITCH_CONFIG` unset (D-EFR-6).
- **KB-AP-11** Never trust a mapping key as a path: `reapplyAgentMapping` skips any key that resolves outside the install dir (`isContainedIn`).
- **KB-AP-12** Never let `getExternalModelsCached` or `discoverExternalModels` throw into callers; both degrade to `{ known: false }`.
- **KB-INV-1** `agent-models.json` holds deviations only; an absent mapping `effort` falls back to the shipped effort, `inherit` yields no `effort:` line and never falls back, `--effort default` deletes the key.
- **KB-INV-2** A GPT mapping reaches installed frontmatter only while the proxy is enabled; the mapping entry itself always survives on disk, and effort applies whatever the proxy state.
- **KB-INV-3** `reapplyAgentMapping` runs only after init preflight has resolved the final `proxyEnabled`; any path forcing the proxy off has already written `proxy.json enabled:false`.
- **KB-INV-4** `memory` is a settable worker entry (`WORKER_AGENTS`), not an agent: held to the worker domain by `validateWorkerValue`, reached only through `agentOnlyMapping`, never counted as an agent.
- **KB-INV-5** The memory-worker literals in `background-memory-update` stay equal to `WORKER_AGENTS`, `CLAUDE_MODEL_ALIASES`, `EFFORT_LEVELS` and `MODEL_NAME_RE` (`tests/agent-models-worker.test.ts`); change them together.
- **KB-INV-6** One vocabulary: `agent-state.ts` labels the STATE column and the EFFORT cell for both `--list` and the TUI; color is applied at the call site.
- **KB-INV-7** `persistedModelFor` and `persistedEffortFor` decide what the TUI saves and shows, so an untouched dormant row writes its GPT mapping back byte-identical.
- **KB-INV-8** The TUI reducer and renderer are pure; `terminal.ts` is a thin adapter over the shared `runTui` driver, and its event loop is bounded by `MAX_KEYPRESSES`.
- **KB-INV-9** The model cache path comes only from `modelCacheDir()`, entries are 0600 in a 0700 directory, and every envelope parse goes through `parseRawEnvelope`.
- **KB-INV-10** `reapplyAgentMapping` degrades, never throws: bad entries, missing files and a registry gap become warnings and result buckets.

## Overview

`~/.devflow/agent-models.json` records per-agent model and effort overrides (and the memory worker's). `reapplyAgentMapping` materializes them into installed agent frontmatter under `~/.claude/agents/devflow/`; `devflow agents` (`--list`, `--set`, `--reset` and an interactive TUI) edits them; `model-discovery.ts` supplies the live external model catalog from the relay runtime. The proxy lifecycle that decides dormancy is in `.devflow/features/external-model-routing/KNOWLEDGE.md`.

## Mapping Engine

### Shipped defaults

The mapping is **deviations-only**: an agent on its shipped defaults is omitted. There is no `previousModel` (KB-AP-1). `loadShippedAgentDefaults(dirs = agentSourceDirs(), opts?)` reads shipped defaults live. `agentSourceDirs()` names `compiledAgentsDir()` (`dist/agents/`) first and `agentsDir()` (`src/assets/agents/`) second, so a generator host's compiled artifact is the default for the agents it produces. The directories are read concurrently (`readDirDefaults` under `Promise.all`) and merged **first-wins on the whole `{ model, effort? }` record**, so an agent's effort never comes from a different file than its model. A shipped `effort:` outside `EFFORT_LEVELS` is dropped with a warning naming the agent, only for the file that won the merge. A missing directory yields an empty map.

**Registry gap**: after the merge it compares the resolved names with `getAllAgentNames()` and emits ONE aggregate `onWarning` naming every registry agent no directory supplied, pointing at `npm run build:mds` (the installer throws on the same invariant). It does not throw, because `devflow agents --list` must still render. The warning discloses a real silent failure: in a `build:cli`-only tree `dist/agents/` is absent and a generated agent has no `.md` source, so `resolveEffective` returns `model === undefined`, `reapplyAgentMapping` buckets the agent `unchanged`, and **disabling the proxy leaves a GPT-pinned agent unreverted**. `devflow agents` passes `p.log.warn` as the channel and `reapplyAgentMapping` routes it into `ReapplyResult.warnings`.

### Effort (D-SHIPPED-EFFORT)

A mapping effort level wins; a mapping `inherit` is a stored value that yields no `effort:` line and does not fall back; an absent effort falls back to the shipped effort, so a reapply never strips an effort an agent ships. `inherit` is effort-only (`--model inherit` is a separate matter). Learning and Tracker ship no `effort:` line; every other agent ships one (Git ships a medium effort). An unconfigured agent runs at its shipped effort and its EFFORT cell reads `default (<effort>)`; one that ships none follows the session and reads plain `default`; `inherit` is the only stored value that makes an effort-shipping agent follow the session. The shipped table is `tests/fixtures/agent-config.ts` (Tracker is listed as exempt), and each row moves with the frontmatter line it describes.

### Workers (D-WORKER-AGENTS)

`memory` is a settable entry in the same `agents` map (`WORKER_AGENTS`, shipping `claude-sonnet-5-5` at `high`) although it is not an agent and has no installed file. The worker domain is `default`, a Claude alias or a full `claude-` id for the model, and `default` or a level for the effort: no external model, no `inherit`. One function (`validateWorkerValue`) holds it for both `devflow agents --set` and `readAgentMapping`. Every agent-only path (the reapply walk, the init reapply gate, `countExternalMappedAgents`, the TUI orphan rows) goes through `agentOnlyMapping`; `hasAgentMappingEntries` counts agent entries only, so a mapping holding just `agents.memory` keeps the init reapply gate closed. `devflow agents` lists the entry after the agents with state `worker` and leaves it out of the agent counts.

**The memory worker reads the entry at run time (D-MEMORY-WORKER-LEAN).** `background-memory-update` reads `agents.memory.model` and `agents.memory.effort` from `~/.devflow/agent-models.json` in bash, outside `readAgentMapping`, and checks each field against the same domain on its own, so a bad model keeps a good effort and the reverse. A field it cannot use takes the `WORKER_AGENTS.memory` row. The bash copy re-spells the domain (shipped defaults, alias list, effort levels, the `claude-` prefix, the `MODEL_NAME_RE` charset and length cap), so `tests/agent-models-worker.test.ts` holds each hook literal equal to its TypeScript source (KB-INV-5). The effort reaches the run only on the lean argv that a bounded CLI-version probe selects; an older or unreadable CLI runs the model alone. The argv, the probe and the staged-file precondition are in `.devflow/features/learning-capture-system-memory-worker/KNOWLEDGE.md`.

### No spawn names a model

Claude Code ranks a model passed at an Agent spawn above the agent's frontmatter, and the frontmatter is where this mapping is materialized, so a spawn that pins a tier (`model="haiku"` on a Validate spawn) silently defeats a user's `devflow agents` override. No `Agent(subagent_type=…)` spawn or workflow `agent()` call in commands, agents, skills or reference modules carries a model (`tests/guards/spawn-no-hardcoded-model.test.ts`). Hook directives sit outside the guard by design: the Learning directive passes a model only when it resolved the value from user configuration, and the Tracker directive's tier is a constant pinned equal to the Tracker agent's frontmatter. The memory worker is not an Agent spawn: its `claude -p` names the model it resolved from `agents.memory` by variable, with no model literal in either argv.

### Reading and canonicalising the mapping

- **`readAgentMapping`** routes through `parseAgentMappingEnvelope`, so it and the `canonicalise-agent-keys-v1` migration share BOM and whitespace tolerance and JSON-error handling. It validates per entry: a model failing `isValidModelName` is dropped with a warning (a bad entry must not poison an agent on every reapply), an effort that is not a level (or `inherit`, for agents only) is dropped with a warning, and worker keys are held to `validateWorkerValue`. When the envelope warns "non-object agents field" (for example `agents: []`) it returns `Ok({ version: 1, agents: {} })` for backward compatibility; the migration treats the same case as a tolerated warn. It applies `canonicaliseAgentKeys` inline on every read, covering every call site.
- **`parseAgentMappingEnvelope(filePath)`** (exported discriminated parser) returns `{ kind: 'skip' }` (file absent, empty or BOM-only, or `agents` absent: caller no-ops), `{ kind: 'warn', message }` (I/O error, invalid JSON, non-object structure: caller records the message) or `{ kind: 'ok', envelope, rawAgents }`.
- **`LEGACY_AGENT_KEYS`** is a `Readonly<Record<string, string>>` built via `Object.assign(Object.create(null))`, always accessed with `Object.hasOwn` (KB-AP-9).
- **`canonicaliseAgentKeys<T>`** is generic over the entry value type and returns `{ agents, didMutate, renamed, dropped, guardDropped }`: `renamed` (legacy keys renamed), `dropped` (legacy key dropped on canonical-key collision, new value wins), `guardDropped` (old or new key was `__proto__`). Callers persist iff `didMutate`; a second call on a migrated map mutates nothing.
- **`readInstalledAgentNames(installDir)`** returns an empty `Set<string>` on **any** readdir failure (bare `catch {}`: EPERM, ENOTDIR and every other OS error as well as ENOENT), so a misconfigured path cannot stop the TUI or `--list`. One `readdir` replaces a per-name `fs.access` loop.
- **Types**: `EFFORT_LEVELS` (agent-models.ts) and `CLAUDE_MODEL_ALIASES` (external-models.ts) are `as const`, so `EffortLevel` and `ClaudeModelAlias` are literal unions. They flow through `EffectiveConfig.effort` and `ShippedAgentDefault.effort`; the stored forms (`AgentMapping.effort`, `AgentRow.configuredEffort`/`originalEffort`) are `StoredEffort` (a level or `inherit`). `readAgentMapping` narrows with `isEffortLevel`, with no cast.

### Convergence

`reapplyAgentMapping(opts)` is idempotent: it walks every registry agent plus any mapped name, computes `resolveEffective`, and rewrites installed frontmatter with `writeFileAtomicExclusive` only when bytes differ.

- **Parallel and deterministic**: the walk runs under `Promise.all`; each task returns its local warnings with its bucket, and the outer loop aggregates in name-list insertion order. Warnings reach `opts.onWarning` immediately and are also collected into `ReapplyResult.warnings`. It accepts an injectable `agentSourceDirs` and passes its warning channel to `loadShippedAgentDefaults`; `revertExternalAgents` forwards both.
- **Buckets**: `updated`, `unchanged`, `skippedMissing` (also malformed frontmatter and containment skips), `invalidMapping` (a model name in `agent-models.json` failed validation; the warning names that file, not the installed one), and write errors, which warn and land in no bucket.
- **Containment guard (KB-AP-11)**: before any read or write it checks `isContainedIn(opts.installDir, mdFileName(agentName))` from `src/core/paths.ts`; a traversal key such as `../../etc/passwd` from a corrupted file is skipped with a warning.
- **Init gating**: `init.ts` skips the reapply when the mapping has no agent entries (`hasAgentMappingEntries`) and the proxy is off, since every agent already has shipped defaults from the file copy and the walk would write nothing. Disable and revert paths always run the full walk. It must run **after** preflight resolves the final `proxyEnabled` (KB-INV-3): running earlier would leave GPT ids in frontmatter when preflight fails.
- **`carryAgentOverrides(source, installed)`** (D-AGENT-OVERRIDE-CARRY, used by the learning-variant converge in `learning-install.ts`): the installed text for an agent is the variant source wearing the installed copy's `model:` and `effort:`, so a converge never opens a window with default models and a no-op converge writes nothing. It is an optimization, never the authority: `reapplyAgentMapping` reads `agent-models.json` afterwards and wins on disagreement. It returns the source unchanged when either side lacks well-formed frontmatter, the installed model is empty or fails the charset, or its effort is not an `EFFORT_LEVELS` member.

## Dormancy

`isDormantExternalModel(model, proxyEnabled)` in `src/core/external-models.ts` (a leaf module, no project imports) is the single dormancy predicate, used by `resolveEffective()`, `buildRow()` (agents-view/state.ts), and `buildListRows()` plus the `--set` warning in agents.ts:

```typescript
// True when the model is external (not Claude, not 'default') AND the proxy is off.
// Classification by COMPLEMENT: not Claude means external, independent of discovery.
export function isDormantExternalModel(model: string | undefined, proxyEnabled: boolean): boolean {
  if (model === undefined || proxyEnabled) return false;
  return model !== 'default' && !isClaudeModelName(model);
}
```

Because the gate is `isClaudeModelName`, a discovery failure that returns an empty external set cannot degrade the safety property. With the proxy off, `resolveEffective()` returns the shipped default for a dormant entry while the mapping entry stays on disk. Effort is orthogonal and always applies (KB-INV-2).

## Agent State (`agent-state.ts`)

A core leaf module (no CLI or adapter imports, imports only `external-models.ts`) gives `devflow agents --list` and the TUI one vocabulary:

- **`AgentState`**: `'active' | 'saved-inactive' | 'not-installed' | 'unknown' | 'worker'`. `classifyAgentState` returns only the first four; `'worker'` marks a background worker's row (no installed file) and bypasses classification.
- **`AGENT_STATE_LABELS`**: `Readonly<Record<AgentState, string>>` of bare display text with no color, shared by the TUI STATE column and `formatListOutput` so they cannot drift.
- **`classifyAgentState(opts)`**: pure, evaluated in order: `!inRegistry` is `unknown` (orphan rows from `agent-models.json`), `!installed` is `not-installed`, `isDormantExternalModel(configured, proxyEnabled)` is `saved-inactive`, otherwise `active`.
- **`formatEffortDisplay(configured, shippedEffort)`** is the one text of an EFFORT cell: a configured level or `inherit` as is; unconfigured shows `default (<shipped effort>)` when the source carries an effort (the MODEL cell's convention) and plain `default` otherwise.
- `--list` appends ` (proxy off)` to the `saved-inactive` label for report-surface context; the TUI column stays bare (`COL_STATE` fits `saved-inactive` exactly).

## Frontmatter Rewrite Invariants (`agent-frontmatter.ts`)

`rewriteAgentFrontmatter()` is pure with zero I/O:

- **First-block-scoped**: `FM_RE = /^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/` matches only the first block; a `model:` or `effort:` line in the body is never touched.
- **CRLF-safe**: EOL style is detected from the opening delimiter and threaded through every replacement. Everything after the closing `---` is appended unchanged.
- **`RewriteResult.changed`** is a byte comparison (`newContent !== content`), not a semantic one.
- **Charset gate**: the model name must pass `MODEL_NAME_RE` before the file is touched; an invalid name is the `invalid-model` error, which `reapplyAgentMapping` reports as an `invalidMapping`.
- **Only `model:` and `effort:`** are rewritten (KB-AP-7); an agent holds an allowlist or a denylist, never both, and those ship from its source file.
- **D-EFR-1, surgical effort removal** (`effort: null`): removes the matched line plus exactly one adjacent EOL, with no global `\n{2,}` collapse. If effort is the last line it swallows the preceding EOL; mid-body it swallows the trailing one; first and only line, it clears the front-matter body to `''`.

## Agents TUI

A pure-reducer, pure-renderer, thin-shell split:

- **`state.ts`**: `reduce(state, key) → { state, intent }` with no I/O. `buildRow()` calls `isDormantExternalModel()`; `rowState()` delegates to `classifyAgentState()`. The effort cycle `EFFORT_CYCLE` is `default → low → medium → high → xhigh → max → inherit → default`. A worker row (`row.worker`) cycles only `WORKER_MODEL_CYCLE` (default plus Claude aliases) and `WORKER_EFFORT_CYCLE` (default plus levels); its off-cycle pin is judged against the worker cycle and the renderer does not mark it off-cycle against the catalog. `persistedModelFor` and `persistedEffortFor` are consumed by both `rowState` and `mergeTuiRowsIntoMapping` (KB-INV-7). All types and dirty helpers are exported.
- **`render.ts`**: `renderFrame(state, dims) → string[]`. Exports `FIXED_ROWS` and `computeViewportHeight` for `terminal.ts`, the single source for viewport constants. The row budget is 80 characters: a two-character prefix plus `COL_AGENT`, `COL_MODEL`, `COL_EFFORT` and `COL_STATE`. `COL_STATE` is sized so `saved-inactive` renders unclipped at 80 columns; `COL_EFFORT` holds `‹ default (medium) ● ›`, the longest unconfigured cell inside the cursor wrapper with the dirty marker, so the shipped effort and the unsaved mark are never clipped on the cursor row. Agent names must fit `COL_AGENT`.
- **`terminal.ts`**: a thin adapter over the generic `runTui<S,A,C>` driver in `src/cli/tui/terminal.ts` (`RunTuiSpec`: `signalAction`, `continueIntent`, `screen?: 'alt'|'inline'`). The agents view passes `signalAction: 'cancel'`, `continueIntent: 'none'` and an `onResize` that updates `viewportHeight`, using the default alt screen; the flags view passes `signalAction: 'abort'` with the `'inline'` screen. The driver owns alt-screen, raw mode, SIGINT/SIGTERM, SIGWINCH and cleanup.

**`TuiIO` seam**: `runAgentsTui(initialState, io?)` takes optional fake `stdin`/`stdout`; tests pass `PassThrough` streams to drive the TUI without a TTY. **`MAX_KEYPRESSES`** (exported, pinned by `agents-terminal.test.ts`) is the hard bound on the event loop and resolves `action: 'cancel'` on exhaustion. The driver calls `stdin.resume()` at startup and **`stdin.pause()` in cleanup**: without the pause the resumed TTY handle keeps the event loop alive and the CLI hangs. `agents.ts` lazy-imports `terminal.ts` (`import('../agents-view/terminal.js')`) so `--list`, `--set`, `--reset` and non-TTY calls never load readline/tty machinery.

**Model list source**: the catalog comes from `selectCatalog(proxyEnabled, cacheDir)` and the live path. Proxy-on, `discoverExternalModels` runs async, and a spinner appears only if it exceeds `DISCOVERY_SPINNER_DELAY_MS`; proxy-off, `selectCatalog` serves `getExternalModelsCached` (cache-only, the same source as `--set`), so dormant GPT mappings keep their picker names. `buildTuiState()` calls `buildModelCycle(catalog)` once for the picker cycle and `buildPickerNameMap(catalog)` to normalize stored canonical ids to picker names in `buildRow()`. The catalog is a local: **not stored on `AgentsViewState`**. Only the derived `modelCycle` is carried, prebuilt once and read by the pure reducer on every keypress, never reallocated. Off-cycle pins (stored models absent from the current picker cycle) are appended to the row's cycle with an `(unavailable)` annotation.

## Model Discovery and Cache

`src/core/model-discovery.ts` gives live catalog access through the relay runtime:

| Function | Mode | Cost |
|----------|------|------|
| `discoverExternalModels(cacheDir, logPath, deps?)` | async | runs the runtime's `models --json` (`DISCOVERY_ARGV`) from `os.tmpdir()`; writes a versioned entry `external-models-v1-<version>.json` |
| `getExternalModelsCached(cacheDir)` | sync | zero spawns; newest entry regardless of TTL; `{ known: false }` on miss; `source` is `'cache'` within TTL, `'stale-cache'` past it |

**Flow of `discoverExternalModels`** (never throws; catch-all returns `{ known: false }`): resolve the bin live with `resolveProxyBin()` (never `proxy.json.binPath`), return a fresh cache hit, start the stale-entry lookup concurrently with the spawn (awaited only on failure, so the failure path costs no extra latency), run the live spawn, then parse, write and prune. The spawn is bounded by `SPAWN_TIMEOUT_MS`, SIGTERM then SIGKILL after `SIGKILL_GRACE_MS`, stdout capped at `STDOUT_CAP`, zero retries (the stale cache is the retry). The entry TTL is `CACHE_TTL_MS`; a runtime version change is what really invalidates the cache, because the model registry ships inside the runtime package.

**D-EFR-6, discovery reads the runtime's built-in registry, never a user config.** Every implicit config load merges the runtime's user-level file (`$XDG_CONFIG_HOME/subswitch/config.json`, else `~/.config/subswitch/config.json`) under the project file. Devflow's relay never sees that file because it always starts with an explicit `SUBSWITCH_CONFIG`, which bypasses the merge. A user alias leaking into discovery would be offered in the picker yet never routed, and a malformed file would fail every discovery; the cache key also assumes the catalog depends on the runtime version alone. So discovery's env is `{ ...scrubChildEnv(), NO_COLOR: '1', XDG_CONFIG_HOME: cacheDir }`: the cache dir never holds a `subswitch/config.json`, so the lookup is a clean ENOENT. `SUBSWITCH_CONFIG` stays unset, because an explicit path that is missing is a hard error.

**Cache layout**
- `modelCacheDir(devflowDir)` in `src/core/cache.ts` is the single path for the model cache (`<devflowDir>/cache/models`); the write site and the removal site both route through it. `hudCacheDir(devflowDir)` is the `cache/` parent the HUD also uses. Uninstall removes that whole `cache/` directory via `hudCacheDir`, with `modelCacheDir` beneath it.
- **Key**: `external-models-v1-<runtimeVersion>`. `resolveProxyBin()` validates the version against `RUNTIME_VERSION_RE` (in `proxy-state.ts`) before it becomes a path component (path-traversal prevention); on failure the version is absent and callers treat the cache as unavailable.
- **Permissions**: the directory is created 0700, each entry hardened to 0600 after the atomic write (both in `cache.ts`).
- **`parseRawEnvelope`** (exported from `cache.ts`) is the one envelope parser, used by `readCacheEntry` (which adds the expiry check) and by the stale-fallback and prune sorters. It rejects non-finite `ttl`. There is no `ignoreExpiry` parameter: callers wanting stale data use `findStaleFallback()`, which scans entries directly.
- **Stale fallback**: when a live spawn fails, `findStaleFallback()` picks the newest entry by embedded envelope timestamp, not file mtime (mtime is trivially spoofable), and the catalog `source` is `'stale-cache'`.
- **Prune**: after each successful live write `pruneOldEntries()` keeps `CACHE_PRUNE_KEEP` entries by embedded timestamp and reaps orphaned `.json.tmp.*` files from a crashed write. Non-fatal.
- **Log hygiene**: runtime-derived strings (model ids, parse errors) have control characters (`/[\x00-\x1f\x7f]/g`) stripped in the discovery pipeline, not the parser, before they reach log lines, and each message is capped (`LOG_WRITE_CAP`).
- **Test seams**: `Result<T,E>`, `ParsedCatalog`, `SPAWN_TIMEOUT_MS` and `SIGKILL_GRACE_MS` are exported; tests derive timing bounds from the constants rather than mirroring literals.
- **`ExternalModelCatalog`** is a discriminated union: `{ known: true; models; aliasToId; selectableNames; source } | { known: false }`.

**Who calls which**: the interactive TUI uses `discoverExternalModels` when the proxy is on and the cache otherwise. `--set` uses `getExternalModelsCached` (zero spawns; any model name is accepted on a cache miss, preserving configure-first-then-enable). `--status` reads `getExternalModelsCached`. `devflow proxy --enable` warms the cache with `discoverExternalModels`, awaited under the spinner and strictly non-fatal. `--list` and `--reset` never touch discovery.

## Anti-Patterns

- **KB-AP-3** — Classifier logic in `external-models.ts` would give it a second reason to change and break its leaf-module contract.
- **KB-AP-4** — Importing or calling `discoverExternalModels`/`getExternalModelsCached` in the validation path breaks the module-boundary spy tests in `tests/agents-command.test.ts` and the configure-first-then-enable flow.
- **KB-AP-6** — The TUI's cleanup is wired through Promise `resolve()`; an exit in `finally` terminates before the generic driver restores the terminal.

## Gotchas

- **KB-INV-7** — Dormant TUI rows: with the proxy off and a saved GPT model, `buildRow()` sets `configuredModel='default'` and keeps the GPT name in `dormantModel`. `persistedModelFor(row)` returns `dormantModel` for an untouched dormant row, so `mergeTuiRowsIntoMapping` preserves the mapping entry on save even though the row shows `default`.

## Key Files

- `src/core/external-models.ts` — `CLAUDE_MODEL_ALIASES`, `ClaudeModelAlias`, `isClaudeModelName()`, `isDormantExternalModel()` (leaf module)
- `src/core/agent-state.ts` — `AgentState`, `AGENT_STATE_LABELS`, `classifyAgentState()`, `formatEffortDisplay()`
- `src/core/agent-frontmatter.ts` — `rewriteAgentFrontmatter()`, `readFrontmatterModel()`, `readFrontmatterEffort()`, `isValidModelName()` / `MODEL_NAME_RE`
- `src/core/agent-models.ts` — `EFFORT_LEVELS`, `StoredEffort` / `EFFORT_INHERIT`, `WORKER_AGENTS` / `isWorkerAgent()` / `validateWorkerValue()`, `agentOnlyMapping()`, `hasAgentMappingEntries()`, `LEGACY_AGENT_KEYS`, `canonicaliseAgentKeys()`, `parseAgentMappingEnvelope()`, `readAgentMapping()`, `saveAgentMapping()`, `resolveEffective()`, `loadShippedAgentDefaults()`, `carryAgentOverrides()`, `reapplyAgentMapping()`, `revertExternalAgents()`, `countExternalMappedAgents()`
- `src/assets/scripts/hooks/background-memory-update` — the only runtime reader of `agents.memory`: validates each field, falls back to the `WORKER_AGENTS.memory` row, passes effort on the lean argv only
- `src/core/model-discovery.ts` — `discoverExternalModels()`, `getExternalModelsCached()`, `parseModelsJson()`, exported test constants
- `src/core/cache.ts` — `modelCacheDir()`, `hudCacheDir()`, `parseRawEnvelope()`, `readCache()`, `writeCache()`
- `src/cli/commands/agents.ts` — `agentsCommand`, `validateSetArgs()` (takes the agent name so a worker is held to `validateWorkerValue`; `--effort` accepts a level, `default` or `inherit`), `applySetMapping()`, `buildListRows()`, `buildWorkerListRows()`, `selectCatalog()`, `buildTuiState()`, `mergeTuiRowsIntoMapping()`
- `src/cli/agents-view/state.ts` — reducer, `buildRow()`, `buildModelCycle()`, `buildPickerNameMap()`, `isDirtyModel()`, `isDirtyEffort()`, `persistedModelFor()`, `persistedEffortFor()`, `rowState()`, `unsavedCount()`
- `src/cli/agents-view/render.ts` — frame renderer, column constants, `FIXED_ROWS`, `computeViewportHeight`
- `src/cli/agents-view/terminal.ts` — `runAgentsTui()`, re-exports `TuiIO` and `MAX_KEYPRESSES`
- `src/cli/tui/terminal.ts` — generic `runTui` driver, `normalizeKey`, `TuiIO`, `MAX_KEYPRESSES`, `RenderDims`, `INLINE_MARGIN`; `src/cli/tui/cells.ts` — shared cell helpers
- `tests/fixtures/agent-config.ts` — the shipped agent configuration table

## Related

- `.devflow/features/external-model-routing/KNOWLEDGE.md` — hub: proxy lifecycle, `isProxyEnabled()` as the dormancy authority, init ordering (preflight before reapply), settings teardown
- `.devflow/features/external-model-routing-hook/KNOWLEDGE.md` — the relay spawn environment that discovery's `scrubChildEnv()` shares
- `.devflow/features/learning-capture-system-memory-worker/KNOWLEDGE.md` — the memory worker's side of `agents.memory`: the version probe, the lean and legacy `claude -p` argv, the staged-file precondition, and the Learning directive's model precedence over the `devflow agents` Learning mapping
- `.devflow/features/installer-shadowing/KNOWLEDGE.md` — `resolveSeedFeatures` and uninstall artifact cleanup
- `src/core/` and `src/cli/` — state I/O and pure logic in core, CLI orchestration in cli; `agent-state.ts` is a core leaf so the classifier keeps one responsibility
