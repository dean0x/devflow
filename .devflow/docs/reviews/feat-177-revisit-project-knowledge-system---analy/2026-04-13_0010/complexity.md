# Complexity Review Report

**Branch**: feat/177-revisit-project-knowledge-system---analy -> main
**Date**: 2026-04-13 00:10
**PR**: #181

## Scope

Focus areas from orchestrator:
1. Cyclomatic complexity in `migrations.ts` `runMigrations`
2. Function length / nesting in `legacy-knowledge-purge.ts` and `shadow-overrides-migration.ts`
3. `init.ts` insertion complexity — does the new migration block pollute the command handler?
4. HUD refactor: complexity improved or worsened?
5. `learn.ts` after `--purge-legacy-knowledge` removal — any stale branches / dead paths?

## Issues in Your Changes (BLOCKING)

_None at CRITICAL or HIGH severity._

The newly-added migration code is well-decomposed with single-responsibility helpers. Metrics stay inside the Good / Warning bands defined in the complexity skill (function length < 50, cyclomatic < 10, nesting ≤ 3).

### MEDIUM

**`runMigrations` inner-loop nesting reaches 4 levels with duplicated persistence logic** — Confidence: 85%
- `src/cli/utils/migrations.ts:161-223`
- Problem: The per-migration loop has two full branches (global vs per-project) each with their own try/catch or allSettled handling, inline failure-mapping for-loops, and an identical `writeAppliedMigrations(homeDevflowDir, [...applied, ...newlyApplied])` persistence call. Nesting sits at `for migration → if scope → try → (no inner loop)` for globals and `for migration → else → for result → if rejected` for per-project. The function is 79 lines with cyclomatic complexity ~9 (for, if-applied, if-scope, try/catch, for-results, if-rejected, every-check, error-instanceof ×2). It is explainable in under 5 minutes, but the two branches would be easier to read as extracted helpers.
- Fix: Extract two helpers with a shared signature so the loop body becomes a dispatch:
  ```typescript
  for (const migration of registry) {
    if (applied.includes(migration.id)) continue;

    const outcome = migration.scope === 'global'
      ? await runGlobalMigration(migration, ctx)
      : await runPerProjectMigration(migration, ctx, discoveredProjects);

    failures.push(...outcome.failures);
    if (outcome.applied) {
      newlyApplied.push(migration.id);
      await writeAppliedMigrations(homeDevflowDir, [...applied, ...newlyApplied]);
    }
  }
  ```
  Each helper returns `{ applied: boolean; failures: MigrationFailure[] }` and owns its own error mapping. The outer loop stops touching `failures`/`newlyApplied` arrays directly and becomes trivially auditable.

**`runMigrations` reads home dir via `os.homedir()` internally while also accepting `ctx.devflowDir`** — Confidence: 80%
- `src/cli/utils/migrations.ts:148-156`
- Problem: The signature takes `ctx: Omit<MigrationContext, 'memoryDir' | 'projectRoot'>` which includes `devflowDir`. But line 155 re-computes `homeDevflowDir = path.join(os.homedir(), '.devflow')` for state persistence, ignoring `ctx.devflowDir` for that purpose while still passing `ctx.devflowDir` to the migration `run()` calls. Two sources of truth for "where does ~/.devflow live" in one function. Test harness works around this by overriding `process.env.HOME` (tests/migrations.test.ts:137), which confirms the coupling. D30 justifies the home-dir choice, but that decision could be expressed as "take a single `homeDevflowDir` parameter", not "ignore ctx and call os.homedir internally".
- Fix: Either remove `devflowDir` from the ctx type (since state always lives at home) and let the two migrations that need `devflowDir` receive it explicitly, or accept `homeDevflowDir` as a named parameter and let `init.ts` be the sole resolver:
  ```typescript
  export async function runMigrations(
    opts: { homeDevflowDir: string; claudeDir: string },
    discoveredProjects: string[],
    registryOverride?: readonly Migration[],
  ): Promise<{...}> {
    const applied = await readAppliedMigrations(opts.homeDevflowDir);
    // ...
  }
  ```
  Callers then pass a single path and tests don't need env-var redirection.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**`purgeLegacyKnowledgeEntries` has 3-level nested try/catch around the main work** — Confidence: 82%
- `src/cli/utils/legacy-knowledge-purge.ts:117-168`
- Problem: The main try-finally wraps a `for` loop containing another try/catch for `readFile`, which contains a `for` loop for regex replacement, followed by another `try/catch` block for the PROJECT-PATTERNS unlink, and a final `try/catch` inside `finally` for the `rmdir`. Nesting reaches depth 4 (`try → for → try → for`). Cyclomatic complexity ~8. Length is 55 lines — just over the 50-line warning line from the complexity skill.
- Fix: Extract the per-file cleanup into a helper so the main function becomes a lock-acquire + orchestration layer:
  ```typescript
  async function purgeSectionsFromFile(filePath: string, prefix: 'ADR' | 'PF'): Promise<{ removed: number; modified: boolean }> {
    let content: string;
    try { content = await fs.readFile(filePath, 'utf-8'); }
    catch { return { removed: 0, modified: false }; }

    const legacyInFile = LEGACY_IDS.filter(id => id.startsWith(prefix));
    let removed = 0;
    let updatedContent = content;

    for (const legacyId of legacyInFile) {
      const sectionRegex = new RegExp(
        `\\n## ${escapeRegExp(legacyId)}:[^\\n]*(?:\\n(?!## )[^\\n]*)*`, 'g');
      const before = updatedContent;
      updatedContent = updatedContent.replace(sectionRegex, '');
      if (updatedContent !== before) removed++;
    }

    if (updatedContent === content) return { removed, modified: false };

    const count = (updatedContent.match(/^## (ADR|PF)-/gm) ?? []).length;
    const label = prefix === 'ADR' ? 'decisions' : 'pitfalls';
    updatedContent = updatedContent.replace(
      /<!-- TL;DR: \d+ (decisions|pitfalls)[^>]*-->/,
      `<!-- TL;DR: ${count} ${label}. Key: -->`);
    await writeFileAtomic(filePath, updatedContent);
    return { removed, modified: true };
  }
  ```
  The outer `purgeLegacyKnowledgeEntries` shrinks to ~25 lines and depth stays at 2.

## Pre-existing Issues (Not Blocking)

### HIGH

**`initCommand.action` handler is a ~932-line god function; the PR adds another 25 lines to it** — Confidence: 95%
- `src/cli/commands/init.ts:114-1045`
- Problem: The `.action(async (options) => { ... })` callback spans lines 114-1045 (932 lines total). This is already flagged as `PF-002` in `.memory/knowledge/pitfalls.md`: _"Init command action handler is a monolith… Single `.action(async ...)` handler is ~877 lines."_ The new migration block at lines 888-912 (25 lines) is a reasonable well-commented self-contained scope (wrapped in `{ ... }` for block-level `let` shadowing). The block itself is not complex (cyclomatic ~4: for-failures, if-newlyApplied, if-verbose, for-id). The block is NOT the root cause of the problem — but it does grow the monolith further, in direct conflict with the pitfalls.md Resolution ("Extract into `collectInitChoices()`, `executeInstallation()`, `printSummary()` in a dedicated refactoring PR").
- Impact: Informational. The PR does not make this materially worse than it already is. Blocking this PR on PF-002 would be unfair per the Iron Law.
- Fix (separate PR): Extract `applyMigrations(discoveredProjects, gitRoot, claudeDir, verbose)` helper in `init.ts` to move those 25 lines out, mirroring the pattern used for `classifySafeDeleteState`. Deferring to the PF-002 resolution PR.

**`learnCommand.action` handler has 10 top-level option branches across ~797 lines** — Confidence: 93%
- `src/cli/commands/learn.ts:494-1290`
- Problem: The action handler is a long dispatch over `options.status | --list | --configure | --purge | --reset | --clear | --review | --dismissCapacity | --enable | --disable`. Each branch is 5-250 lines inline. The `--review` branch alone is 330 lines (lines 881-1211) with nested `mode === 'observations'` and `mode === 'capacity'` sub-branches, the latter containing 6+ levels of nesting (for-entries → allEntries → try → regex exec → if status → etc.). The `--reset` branch is 135 lines with nested try/finally around dry-run + removal logic.
- Impact: This PR **added significant length** to the handler (particularly `--review --capacity` and `--dismiss-capacity`), but most of it is new behaviour for new features, not bloat. The handler was already a dispatch god-function; the pattern wasn't introduced by this PR. `--purge-legacy-knowledge` removal is clean — no stale branches or dead paths remain (grep confirms no references).
- Fix (separate PR): Split the handler so each option is its own exported function (`statusAction`, `listAction`, `reviewObservationsAction`, `reviewCapacityAction`, etc.) and the `.action()` callback becomes a thin 10-case dispatch. This is architectural debt out of scope for this review.

### MEDIUM

**`json-helper.cjs` grew from 632 to 1690 lines (+168%)** — Confidence: 88%
- `scripts/hooks/json-helper.cjs`
- Problem: The script now concentrates decision/pitfall/workflow/procedural rendering, reconciliation, count-active, capacity checks, and many helpers in a single 1690-line JS file. Pre-existing PF-004 pitfall (`scripts/hooks/background-learning (560 lines)`) already called out the same pattern — untestable god scripts. The js-helper is test-covered (unlike background-learning), but 1690 lines is past the 500-line file-length Critical threshold.
- Impact: Not in focus scope (focus areas do not include json-helper.cjs). Reported per step 2 of the review methodology because the PR authored substantial growth here.
- Fix (separate PR): Split by command-verb, one file per operation (`render-workflow.cjs`, `render-decision.cjs`, `reconcile-manifest.cjs`, `count-active.cjs`, etc.) sharing a small `lib/` of common helpers.

### LOW

**Suggestion-oriented issues from focus review:**
- **Migration IDs are stringly-typed** — `migrations.ts:50-69`. Adding a migration means typing a fresh string literal; typos would silently mean "never marked applied". A `const MIGRATION_IDS = { SHADOW_V2: 'shadow-overrides-v2-names', PURGE_V2: 'purge-legacy-knowledge-v2' } as const` would tighten this. Confidence: 70% (noted in Suggestions).
- **`getActiveNotification` sort-via-tracking-variable** — `src/cli/hud/notifications.ts:42-53`. The "worst" accumulator pattern works but would read cleaner as `Object.entries(data).filter(...).map(...).sort(...)[0] ?? null`. Confidence: 65%.

## Suggestions (Lower Confidence)

- **`MIGRATION_IDS` const map** — `src/cli/utils/migrations.ts:50` (Confidence: 70%) — introduce a typed ID constant to prevent typo-based silent re-runs.
- **`getActiveNotification` functional style** — `src/cli/hud/notifications.ts:42` (Confidence: 65%) — sort-first-take-max reads cleaner than an accumulator with compound comparator.
- **`learningCounts` component duplicates the `needReview > 0` ternary** — `src/cli/hud/components/learning-counts.ts:35-38` (Confidence: 62%) — the string `  \u26A0 ${needReview} need review` is built twice (once for `raw`, once for colored `text`). Store in a local const and reuse.

## Focus-area Findings Summary

| Focus Area | Verdict |
|------------|---------|
| 1. `runMigrations` cyclomatic complexity | ~9, acceptable but improvable. MEDIUM. Extract per-scope helpers. |
| 2. `legacy-knowledge-purge` nesting/length | 55 lines, nesting depth 4. MEDIUM. Extract per-file helper. |
| 2. `shadow-overrides-migration` nesting/length | 45 lines, nesting depth 3. **Clean**, no findings. |
| 3. Does the migration block pollute `init.ts`? | Block itself is clean (25 lines, cyclomatic ~4). Handler was already a 907-line monolith (PF-002); this adds ~3% growth. No new pollution pattern. |
| 4. HUD refactor complexity | **Improved surface area**. 2 new components (`learningCounts`, `notifications`) added with ~36 and ~31 lines respectively. `render.ts` grew 6 lines, `index.ts` 16 lines, `types.ts` 29 lines. Pattern is consistent with existing component architecture. Pluggable, gracefully null-returning, non-invasive. |
| 5. `learn.ts` stale branches from `--purge-legacy-knowledge` | **None**. All references removed — `grep` confirms zero `purgeLegacy\|purge-legacy-knowledge\|LEGACY_IDS` matches in `learn.ts`. Clean removal. Pre-existing `--reset` path still references `LEGACY_HOOK_MARKER` but that's unrelated (old Stop hook cleanup). |

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 2 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 2 | 1 | 0 |

**Complexity Score**: 7 / 10

**Recommendation**: APPROVED_WITH_CONDITIONS

Rationale: The PR adds real, well-decomposed complexity for new migration infrastructure. The new files (`migrations.ts`, `legacy-knowledge-purge.ts`, `shadow-overrides-migration.ts`) are all under 230 lines with clear single responsibilities. `runMigrations` has moderate nesting but is explainable in under 5 minutes. HUD refactor is a clean additive extension. `--purge-legacy-knowledge` removal is complete with no stale branches. The only blockers are two MEDIUM-severity refactors in new code (`runMigrations` scope-branch extraction and `os.homedir()` coupling) — both are easy wins that can land in the same PR or a follow-up without architectural upheaval. The pre-existing `initCommand`/`learnCommand` monoliths are out of scope per the Iron Law but should be tracked in the existing PF-002 resolution backlog.
