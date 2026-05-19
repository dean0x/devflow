# Architecture Review Report

**Branch**: feat/177-revisit-project-knowledge-system---analy -> main
**Date**: 2026-04-13 22:08
**Scope**: Incremental review of 10 commits (0dd9e24..HEAD)
**Commits**: 95ecd00, d5b879f, cf593b3, 8435914, 299dacf, ab20b47, 74166ce, cdec1cd, 595d1a9, 6c9cc88

---

## Scope Notes

This review focuses on architectural concerns across the 10 resolution commits:
- `src/cli/utils/migrations.ts` (D30–D38 decisions: discriminated union, pooled helper, scope exhaustiveness)
- `src/cli/commands/init.ts` (install-ordering fix: migrations now run BEFORE `installViaFileCopy`)
- `scripts/hooks/lib/staleness.cjs` (extracted from shell into shared Node module)
- `src/cli/utils/legacy-knowledge-purge.ts` (D34 extraction, fs-lock duplication)
- `knowledge-persistence` skill removal from `devflow-plan`, `devflow-debug`, `devflow-ambient` + skimmer.md + command phases

Cross-checked against known pitfalls in `.memory/knowledge/pitfalls.md`. **PF-007** (migrations-after-installer) is directly addressed by the install-ordering fix. **PF-008** (teams-variant drift) and **PF-009** (busy-wait in per-turn hooks) are also consistent with observed fixes. **PF-010** (unvalidated JSON.parse) is partially addressed by new `D-SEC1`/`D-SEC2` guards but not resolved end-to-end.

---

## Issues in Your Changes (BLOCKING)

*(none at CRITICAL / HIGH severity — the architecture resolution commits represent a net-positive architectural trajectory)*

---

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Contract drift between `ctx.devflowDir` parameter and internal state file location** — Confidence: 88%
- `src/cli/utils/migrations.ts:237-243`
- Problem: `runMigrations(ctx: { devflowDir: string }, ...)` accepts a `devflowDir` for migration **bodies** (lines 267, 309), but `readAppliedMigrations`/`writeAppliedMigrations` internally ignore `ctx.devflowDir` and re-derive `homeDevflowDir = path.join(os.homedir(), '.devflow')`. A caller can pass `ctx.devflowDir = '/some/other/dir'` and silently get migration state tracked in `~/.devflow/migrations.json` instead. D30 explains *why* state is home-scoped, but the asymmetry is a latent contract trap — the next maintainer who reads `ctx.devflowDir` will reasonably assume it controls **all** dir-scoped behavior in the function.
- Fix: Either (a) collapse the asymmetry by removing `ctx.devflowDir` from the public signature and letting the function derive the single dir from `os.homedir()`, with an optional `homeOverride?: string` for tests; or (b) rename the field to `migrationTargetDevflowDir` and add a sibling `stateDevflowDir` so both are explicit. Option (a) is simpler and aligned with D30's "state is machine-wide":
  ```ts
  // Before
  export async function runMigrations(
    ctx: { devflowDir: string },
    discoveredProjects: string[],
    registryOverride?: readonly Migration[],
  ): Promise<RunMigrationsResult>

  // After
  export async function runMigrations(
    discoveredProjects: string[],
    options?: { registryOverride?: readonly Migration[]; homeOverride?: string },
  ): Promise<RunMigrationsResult> {
    const homeDevflowDir = options?.homeOverride ?? path.join(os.homedir(), '.devflow');
    // ... pass homeDevflowDir to both readApplied and migration runs
  }
  ```

**`writeFileAtomic` duplicated 4× with identical EEXIST-retry logic** — Confidence: 85%
- `src/cli/commands/learn.ts:395-407`, `src/cli/utils/legacy-knowledge-purge.ts:50-61`, `src/cli/utils/migrations.ts:167-179` (inline in `writeAppliedMigrations`), `scripts/hooks/json-helper.cjs` (`writeExclusive`)
- Problem: The wx-flag + EEXIST-retry + rename pattern now exists in 4 places with identical semantics. D34 documents the `legacy-knowledge-purge` extraction rationale (avoid pulling in `@clack/prompts` into the registry path) but stops short of extracting the write primitive itself. Each copy is 8-12 lines of security-critical code — any security fix must touch all 4 copies, and drift is easy to introduce silently (in fact, `migrations.ts:167-179` inlines the pattern inside `writeAppliedMigrations` rather than using the existing helper, indicating the duplication is already not a *deliberate boundary* but an organic accretion).
- Fix: Extract `src/cli/utils/fs-atomic.ts` exporting `writeFileAtomic(path, content, { encoding?: string })` with the wx+retry+rename semantics. Have `learn.ts`, `legacy-knowledge-purge.ts`, and `migrations.ts` import it. The CJS copy in `json-helper.cjs` can stay (CJS boundary is a legitimate reason to duplicate) but add a D-comment pointing at the TS source-of-truth so any future security change propagates both ways consciously. This resolves the *substance* of "fs-lock duplication as documented D34 contract" — D34 justified one extraction; a second extraction is warranted for the atomic-write primitive.

**Hardcoded `os.homedir()` inside `runMigrations` hurts testability** — Confidence: 82%
- `src/cli/utils/migrations.ts:243`
- Problem: `runMigrations` calls `os.homedir()` directly. `tests/init-logic.test.ts:18-114` (new in this PR) has to mutate `process.env.HOME` in `beforeEach`/`afterEach` to isolate state, which is a known-fragile pattern (parallel test runners, leaked state between test files). DIP violation: the function depends on the process environment rather than an injected abstraction.
- Fix: Introduce an optional override parameter in the same refactor as the contract-drift fix above:
  ```ts
  runMigrations(discoveredProjects, { homeOverride: fakeHomeDir });
  ```
  Tests inject `homeOverride` directly; production code omits it. Removes the need for `process.env.HOME` manipulation entirely.

---

## Pre-existing Issues (Not Blocking)

### MEDIUM

**`knowledge-persistence` skill — format-spec-in-skill-system is a category error** — Confidence: 78%
- `shared/skills/knowledge-persistence/SKILL.md`, `tests/build.test.ts:13-17` (new `FORMAT_SPEC_SKILLS` exception)
- Problem: D8/D9 correctly identified that commands shouldn't invoke the skill to write knowledge (moved to background extractor). The resolution keeps `knowledge-persistence` as a "format spec" skill that is intentionally excluded from plugin distribution via a new `FORMAT_SPEC_SKILLS = new Set(['knowledge-persistence'])` exception in the build test. This is a *smell*: the skill taxonomy doesn't have a first-class "format spec" tier, and adding a set-based exception is the kind of workaround that compounds. The skill frontmatter still claims `allowed-tools: Read, Grep, Glob` as if an agent would invoke it — but no agent does. The actual reader is human engineers maintaining `json-helper.cjs render-ready`.
- Fix (separate PR — scope beyond this branch): Move the format spec out of `shared/skills/` into `docs/reference/knowledge-format.md` and delete the skill entirely. Commands that previously referenced it for the *read* side can link directly to the doc. The build-test exception disappears. The `devflow:` skill namespace stays semantically coherent as "things agents activate."

### LOW

**Migration ordering comment in `init.ts:762-767` is informative but brittle** — Confidence: 80%
- `src/cli/commands/init.ts:762-767`
- Problem: The comment "Runs BEFORE installViaFileCopy so V1→V2 shadow renames are complete before the installer looks for V2-named directories" encodes an ordering constraint that is enforceable only by convention. PF-007 itself notes "Registries are order-dependent and the ordering is not obvious from read-order in the source file" and suggests "Consider a two-phase migration registry (pre-install/post-install) if both orderings are legitimate."
- Fix (separate refactor, MEDIUM-term): If/when a second migration needs to run *after* the installer, add a `phase: 'pre-install' | 'post-install'` field to the `Migration` interface and run each phase at the appropriate call site. Until then, the ordering comment is sufficient — but adding a runtime assertion in `runMigrations` that logs "running {n} pre-install migrations" would make the phase commitment more visible.

---

## Suggestions (Lower Confidence)

- **`pooled<T, R>` helper could be a shared utility** — `src/cli/utils/migrations.ts:200-212` (Confidence: 65%) — Same concurrency-capped `Promise.allSettled` pattern appears at `init.ts:962-974` for `.claudeignore` installs (referenced by D35 comment). Two callers is borderline for extraction; three would mandate it. Keep local for now, revisit when a third caller appears.
- **`normaliseRunResult` accepts `void` purely for test stubs** — `src/cli/utils/migrations.ts:214-218` (Confidence: 60%) — The `Migration.run` return type `Promise<MigrationRunResult | void>` is softened specifically to let test migrations omit the return value. Cleaner to require `MigrationRunResult` from the interface and have tests return `{ infos: [], warnings: [] }` explicitly — one line of ceremony in tests for a tighter production contract. Minor, and the current comment documents the intent clearly.

---

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 0 | - |
| Should Fix | - | 0 | 3 | 0 |
| Pre-existing | - | - | 1 | 1 |

**Architecture Score**: 8/10

The resolution commits demonstrate solid architectural judgment:
- **Install ordering fix (PF-007 resolution)**: Moved migrations BEFORE `installViaFileCopy`. This is the primary architectural correctness win — it fixes silent data loss of user shadow overrides during upgrade. The D32 always-run-unapplied semantics are correct and simpler than a fresh-vs-upgrade branch.
- **Discriminated union for `MigrationContext` (D38)**: `GlobalMigrationContext | PerProjectMigrationContext` with the `run(ctx: S extends 'global' ? ... : ...)` conditional return type is a textbook fix for the ISP violation where per-project fields were forced into global migrations. This is correctly applied.
- **Exhaustiveness check at `migrations.ts:336-337`**: `const _exhaustive: never = migration.scope` makes adding a third scope a compile-time TODO rather than a silent fallthrough. Good defensive design.
- **Pooled concurrency helper**: Small, pure, correct. `Promise.allSettled` in chunks of 16 matches the `.claudeignore` multi-project pattern and prevents EMFILE at scale.
- **`staleness.cjs` extraction**: Moving the staleness algorithm from inline shell + node one-liners into a proper Node module with direct test imports is a large testability and correctness win. The old shell version spawned a separate `node -e ...` per log entry with inline JavaScript — extremely slow and un-reviewable. The new module is ~100 lines, testable, and the shell wrapper is a thin delegate.
- **`knowledge-persistence` skill removal from plugin.json + skimmer + command phases**: D8/D9 architecturally coherent — write-side is centralized in the background extractor, commands no longer pretend to write. However, keeping the skill as a "format spec" with a build-test exception (`FORMAT_SPEC_SKILLS` set) is a taxonomic wart that should be revisited in a follow-up (see Pre-existing issues).

The remaining issues are refinements, not structural problems:
1. Contract asymmetry in `runMigrations(ctx)` (medium priority cleanup)
2. `writeFileAtomic` is now in 4 places (time to extract)
3. Testability coupling to `os.homedir()` (small DIP improvement)

**Recommendation**: `APPROVED_WITH_CONDITIONS`

The three MEDIUM Should-Fix items are cleanup that would ideally land in this PR or the immediate follow-up, but none are blocking. The architectural direction is correct, PF-007 is resolved, the new discriminated union is well-designed, and the skill-system cleanup is coherent post-D8. Ship it, and schedule a small follow-up PR for the `fs-atomic.ts` extraction + `runMigrations` signature cleanup.
