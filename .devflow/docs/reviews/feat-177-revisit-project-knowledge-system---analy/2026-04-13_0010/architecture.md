# Architecture Review Report

**Branch**: feat/177-revisit-project-knowledge-system---analy -> main
**PR**: #181
**Date**: 2026-04-13 00:10
**Diff command**: `git diff main...HEAD`

## Summary of review scope

Reviewed the new migration registry (`src/cli/utils/migrations.ts`, `legacy-knowledge-purge.ts`, `shadow-overrides-migration.ts`), its coupling with `init.ts`, and the HUD refactor (`hud/learning-counts.ts`, `hud/notifications.ts`, plus `components/` render counterparts). Also verified against known pitfall PF-002 (init.ts monolith).

**Overall finding**: The extraction is a net architectural improvement. The migration registry cleanly decouples `init.ts` from the legacy-purge + shadow-overrides logic, shrinks init.ts by 42 net lines (reducing PF-002), and establishes a single append-only extension point for future one-time changes. However, three MEDIUM-severity concerns remain around interface design (MigrationContext), code duplication of lock/atomic-write helpers, and HUD layering inconsistency.

---

## Issues in Your Changes (BLOCKING)

### CRITICAL
None.

### HIGH
None — the blocking bar is that changes do not introduce new SOLID/layering violations that break the install flow. All HIGH candidates downgraded once I verified the registry is opt-in and migrations short-circuit cleanly on missing data.

---

## Issues in Code You Touched (Should Fix)

### MEDIUM

**`MigrationContext` is an unsegregated interface — ISP violation** — Confidence: 88%
- `src/cli/utils/migrations.ts:15-20` (definition) and `src/cli/utils/migrations.ts:173` (construction site)
- Problem: `MigrationContext` declares four required fields (`memoryDir`, `projectRoot`, `devflowDir`, `claudeDir`) but each migration uses only a subset:
  - `shadow-overrides-v2-names` (global) uses only `devflowDir`.
  - `purge-legacy-knowledge-v2` (per-project) uses only `memoryDir`.
  - `claudeDir` is threaded through init.ts → runMigrations → MigrationContext but never read by any migration (`grep ctx.claudeDir` in migrations.ts / shadow-overrides-migration.ts / legacy-knowledge-purge.ts returns zero matches). It's a dead parameter.
  - The runner papers over the mismatch by passing `memoryDir: '', projectRoot: ''` for global migrations at line 173 — using the type system to document "absent but typed as string" is the giveaway.
- Impact: New migration authors must inspect the runner to learn which ctx fields are actually populated for their scope. Empty-string sentinels invite silent bugs if a global migration ever reads `ctx.memoryDir`. Violates ISP (Martin, 2002) — clients forced to depend on fields they don't use.
- Fix (minimal, preserves existing API for tests):
  ```ts
  // Narrower per-scope contexts
  export interface GlobalMigrationContext { devflowDir: string }
  export interface PerProjectMigrationContext {
    devflowDir: string; memoryDir: string; projectRoot: string
  }

  export type Migration =
    | { id: string; description: string; scope: 'global';
        run(ctx: GlobalMigrationContext): Promise<void> }
    | { id: string; description: string; scope: 'per-project';
        run(ctx: PerProjectMigrationContext): Promise<void> };
  ```
  This removes `claudeDir` entirely (it's unused) and the empty-string sentinel in the runner (line 173). Tests update to the narrower contexts — trivial because they already pass arbitrary fields.

**Duplicated `acquireMkdirLock` + `writeFileAtomic` helpers across three modules** — Confidence: 92%
- `src/cli/utils/legacy-knowledge-purge.ts:45-78` (new)
- `src/cli/commands/learn.ts:336-386` (existing)
- `scripts/hooks/json-helper.cjs:140,...` (existing, .cjs — separate module system)
- Problem: `legacy-knowledge-purge.ts` defines its own `acquireMkdirLock` and `writeFileAtomic` whose comments explicitly say "Mirrors writeFileAtomic in learn.ts" and "Matches acquireMkdirLock in learn.ts so all lock holders use identical staleness semantics." The comments acknowledge that the *contract* MUST match — which is the textbook indicator that the code should be centralized. Three identical implementations with coupled timeouts (30_000 / 60_000) mean that tuning one requires hunting for the siblings. `json-helper.cjs` is stuck on CommonJS and can't easily import from `.ts`, but `learn.ts` and `legacy-knowledge-purge.ts` are both ESM and could share.
- Impact: DRY violation; divergence is only a matter of time. A bug fix or timeout tweak applied to one forgets the other, silently breaking the "identical semantics" invariant the comments claim.
- Fix: Extract a new `src/cli/utils/fs-lock.ts` with `acquireMkdirLock` and `writeFileAtomic` and import from both `learn.ts` and `legacy-knowledge-purge.ts`. Keep `json-helper.cjs` as-is (separate module system, identical contract preserved by test coverage). Add a test that asserts both TS modules reference the shared helper. This also helps any future per-project migration that needs the same primitives.

**Runner derives `homeDevflowDir` independently of `ctx.devflowDir` — hidden coupling to `os.homedir()`** — Confidence: 85%
- `src/cli/utils/migrations.ts:155` (runner) and `src/cli/commands/init.ts:894` (caller)
- Problem: The runner takes `ctx.devflowDir` as a parameter but then ignores it for state-file location purposes and re-derives `path.join(os.homedir(), '.devflow')` at line 155. init.ts also computes the same path at line 894 and passes it in. So there are two independent derivations of the same value. If the caller ever passed a different `ctx.devflowDir` (e.g., a local-scope install), the migration code (shadow-overrides.run) would run against *that* dir while the state file would still live at `~/.devflow/migrations.json` — a split-brain bug.
- Impact: The runner's behavior no longer follows its signature. Violates the Dependency Inversion Principle — runMigrations depends directly on `os.homedir()` (a concrete, global side-effect) rather than depending on the abstraction (`ctx.devflowDir`). The test suite already works around this by setting `process.env.HOME` (tests/migrations.test.ts:137), which is an obvious test smell.
- Fix: Either (a) remove the internal re-derivation and use `ctx.devflowDir` directly (caller is already responsible for resolving home-scope), or (b) drop `devflowDir` from the ctx and accept the home dir as a separate explicit parameter:
  ```ts
  export async function runMigrations(
    ctx: { claudeDir: string },
    discoveredProjects: string[],
    stateDir: string = path.join(os.homedir(), '.devflow'),
    registryOverride?: readonly Migration[],
  )
  ```
  This removes the duplicated derivation and makes the state location testable without env-var hacks.

---

## Pre-existing Issues (Not Blocking)

### MEDIUM

**PF-002 init.ts monolith still large at 1046 lines** — Confidence: 95%
- `src/cli/commands/init.ts` (entire file)
- The pitfalls registry (PF-002) documents a 877-line init.ts; it is now 1046 lines despite this PR *removing* 42 net lines via the migration extraction. The growth comes from unrelated features (two-mode init, flags registry) that landed before this branch. This PR moves in the right direction but the `.action(async ...)` handler remains a deep orchestration function.
- Impact: Informational. This PR does not introduce the issue; it slightly alleviates it.
- Fix: The pitfall's prescribed fix (`collectInitChoices()`, `executeInstallation()`, `printSummary()` extraction) remains the correct follow-up in a dedicated PR. **Do not block this PR** on that refactor (PF-002 explicitly says "deferred — pre-existing architectural issue, major refactor").

**HUD layering inconsistency between `config-counts.ts` and `learning-counts.ts` / `notifications.ts`** — Confidence: 80%
- `src/cli/hud/components/config-counts.ts:45` (gather colocated with render)
- `src/cli/hud/learning-counts.ts` + `src/cli/hud/components/learning-counts.ts` (split)
- `src/cli/hud/notifications.ts` + `src/cli/hud/components/notifications.ts` (split)
- Problem: The codebase established two incompatible layerings for HUD data modules:
  1. Dominant pattern (followed by `git.ts`, `transcript.ts`, `usage-api.ts`, and now the new `learning-counts.ts` + `notifications.ts`): data-gathering lives at `hud/<name>.ts`, rendering at `hud/components/<name>.ts`.
  2. Exception: `config-counts.ts` bundles both `gatherConfigCounts()` and the `configCounts` component in a single file under `components/`.
- The new additions follow the dominant pattern — that's the right call. But because the existing exception (config-counts) is not harmonized, every future reviewer has to decide which convention to apply. And the same filename exists in two directories (`hud/notifications.ts` vs `hud/components/notifications.ts`), which can confuse tooling and file-search results.
- Impact: Informational. Not a regression introduced by this PR — the PR aligns with the correct pattern.
- Fix (follow-up PR, optional): Move `gatherConfigCounts` out of `components/config-counts.ts` into a new `src/cli/hud/config-counts.ts` so all gather functions consistently live at the root. Leave the render component in `components/`.

---

## Suggestions (Lower Confidence)

- **Unnecessary dynamic imports inside `MIGRATIONS` entries** - `src/cli/utils/migrations.ts:56,65` (Confidence: 70%) — The registry uses `await import('./shadow-overrides-migration.js')` inside each `run`. Since the module is already dynamically imported by init.ts and has no circular-dependency hazard, a static top-of-file `import { migrateShadowOverridesRegistry } from './shadow-overrides-migration.js'` would be cleaner and pay the import cost exactly once (now paid on every `migration.run()` call). Minor.

- **`Promise.all` in `migrateShadowOverridesRegistry` fails fast; runner expects allSettled semantics** - `src/cli/utils/shadow-overrides-migration.ts:44` (Confidence: 65%) — The inner `Promise.all` over group results rejects on first error. Since the runner wraps the call in try/catch (migrations.ts:172-184), this is caught and recorded as a single global failure — partial success within groups is lost. For a global migration this is likely fine (the whole migration re-runs), but `Promise.allSettled` + aggregating `warnings[]` would give better diagnostics. Low priority.

- **D37 vacuous-truth edge case is surprising behavior** - `src/cli/utils/migrations.ts:216` (Confidence: 60%) — `results.every(r => r.status === 'fulfilled')` returns true on an empty array, so per-project migrations are marked applied on machines with zero discovered projects. The test locks this in (`tests/migrations.test.ts:278`). This is documented as D37 but means a user who runs `devflow init` once with zero projects and then later adds projects will *not* get the migration applied to those new projects. The design is arguably correct (fresh-install-safety over retroactivity), but a comment in the caller warning future readers would help.

---

## Summary Table

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | - | - |
| Should Fix | - | 0 | 3 | - |
| Pre-existing | - | - | 2 | - |

**Architecture Score**: 8/10

The extraction of `migrateShadowOverrides` + `purgeLegacyKnowledgeEntries` + the registry pattern is sound. Separation of concerns improved, init.ts coupling reduced, layering respected. Three medium-severity improvements remain — all within scope (the new migrations module) and all straightforward fixes. The HUD refactor follows the dominant convention correctly.

**Recommendation**: APPROVED_WITH_CONDITIONS

Conditions (non-blocking — recommended to fix in this PR if the author agrees, otherwise follow-up):
1. Narrow `MigrationContext` per scope (ISP fix) — removes dead `claudeDir` param.
2. Extract `acquireMkdirLock` + `writeFileAtomic` to a shared util (DRY).
3. Stop re-deriving `homeDevflowDir` inside `runMigrations` — use `ctx.devflowDir` or accept explicit state-dir (DIP).

If the author prefers to land these as a follow-up, the PR should still merge — the current code is correct, just not as clean as it could be.
