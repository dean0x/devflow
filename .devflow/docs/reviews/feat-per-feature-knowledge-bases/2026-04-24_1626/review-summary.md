# Code Review Summary

**Branch**: feat/per-feature-knowledge-bases -> main
**Date**: 2026-04-24_1626

## Merge Recommendation: BLOCK MERGE

The PR contains 4 HIGH blocking issues in documentation (phase numbering consistency across orchestration skills) and 1 HIGH blocking issue in testing (untested behavior change in `removeEntry`). While the core feature implementation is solid and most changes are well-executed, these must be resolved before merge.

---

## Issue Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 5 | 1 | 0 |
| Should Fix | 0 | 0 | 5 | 0 |
| Pre-existing | 0 | 0 | 3 | 1 |

---

## Blocking Issues

### CRITICAL
None.

### HIGH

**1. plan:orch GUIDED section step numbering duplicated** - `shared/skills/plan:orch/SKILL.md:27-31`
**Confidence**: 95% (3 reviewers: consistency, regression, documentation)
- **Problem**: Steps renumbered from `0, 0.5, 1, 2, 3` to `1, 2, 1, 2, 3` — the first two were updated but steps 3-5 restarted at 1. This produces duplicate step numbers that will confuse agents following the GUIDED flow.
- **Impact**: Agents parsing the GUIDED section will encounter ambiguous step references. Breaking change in orchestration documentation.
- **Fix**: Renumber remaining steps to `3, 4, 5`:
  ```markdown
  1. **Discover** — ...
  2. **Load Feature KBs** — ...
  3. **Spawn Skimmer** — ...
  4. **Design** — ...
  5. **Present** — ...
  ```

**2. pipeline:orch still says "Phases 1-6" for sub-orchestrators now at 7 phases (3 locations)** - `shared/skills/pipeline:orch/SKILL.md:35,56,78`
**Confidence**: 95% (3 reviewers: consistency, regression)
- **Problem**: All three sub-orchestrator descriptions say "Phases 1-6" but implement:orch, review:orch, and resolve:orch now have 7 phases each (fractional phases promoted to integers). The descriptions also omit the new knowledge-loading phase. Lines 35, 56, 78 are all stale.
- **Impact**: Agents following pipeline:orch will skip Phase 7 (Completion/Report/Finalize) if they rely on these documented ranges. Critical for orchestration correctness.
- **Fix**: Update all three references:
  - Line 35: `(Phases 1-7: pre-flight → load feature knowledge → plan synthesis → Coder → FILES_CHANGED detection → quality gates → completion)`
  - Line 56: `(Phases 1-7: pre-flight → incremental detection → load knowledge index → file analysis → parallel reviewers → synthesis → finalize)`
  - Line 78: `(Phases 1-7: target review directory → load project knowledge → parse issues → analyze & batch → parallel resolvers → collect & simplify → report)`

**3. review:orch "Phase 3" reference should be "Phase 4" after renumbering** - `shared/skills/review:orch/SKILL.md:99`
**Confidence**: 92% (2 reviewers: consistency, regression)
- **Problem**: Line 99 says "Conditional reviewers (from Phase 3 file analysis)" but file analysis was renumbered to Phase 4. Other references in the same file were correctly updated (line 62 says "Phase 4", lines 107-108 say "Phase 3" for knowledge loading).
- **Impact**: Incomplete phase renumbering within the same file creates inconsistency for agents.
- **Fix**: Change to `**Conditional reviewers** (from Phase 4 file analysis):`

**4. `checkAllStaleness` duplicates staleness logic instead of delegating to `checkStaleness`** - `scripts/hooks/lib/feature-kb.cjs:166-199`
**Confidence**: 85% (3 reviewers: architecture, complexity, regression)
- **Problem**: The refactored `checkAllStaleness` inlines the staleness algorithm (git-log call, `parseGitChangedFiles`, error handling) rather than calling `checkStaleness` per slug. While this eliminates N+1 overhead on `git rev-parse --git-dir`, it duplicates core logic that must stay in sync. If staleness semantics change, two code paths diverge.
- **Impact**: Violation of DRY; future maintainers must patch both paths independently. Architecture anti-pattern.
- **Fix**: Extract the per-entry computation into a shared helper (e.g., `checkEntryStaleness(worktreePath, entry)`) that both `checkStaleness` and `checkAllStaleness` call. Hoist only the git-dir check in the batch function.

**5. `removeEntry` behavior changed (silent overwrite of corrupt index) with no test coverage** - `scripts/hooks/lib/feature-kb.cjs:355` and `tests/feature-kb/feature-kb.test.ts`
**Confidence**: 90% (1 reviewer: testing)
- **Problem**: The old code returned early when `index.json` parse failed. The new code catches silently and falls through, writing an empty `{ version: 1, features: {} }` to disk. This is a behavior change (overwriting corrupt but recoverable data) with no test to document or validate it.
- **Impact**: HIGH -- functional behavior changed without coverage. If `index.json` becomes corrupt, the new code silently wipes it instead of preserving it.
- **Fix**: Either restore the early-return (preserving old behavior), or add a test documenting the new behavior:
  ```typescript
  it('overwrites corrupt index.json with empty index on remove', () => {
    const tmp = makeTmpFeatureWorktree();
    writeFileSync(path.join(tmp, '.features', 'index.json'), 'not-valid-json');
    removeEntry(tmp, 'nonexistent');
    const index = loadIndex(tmp);
    expect(index).toEqual({ version: 1, features: {} });
  });
  ```

### MEDIUM

**Security: `--dangerously-skip-permissions` with Bash tool in KB spawns** - `src/cli/commands/kb.ts:214-218,301-305`
**Confidence**: 82% (1 reviewer: security)
- **Problem**: KB `create` and `refresh` commands spawn `claude -p` with `--dangerously-skip-permissions --allowedTools Read,Grep,Glob,Write,Bash`. The `Bash` tool combined with unrestricted permissions means the agent can execute arbitrary shell commands. User-supplied values (slug, name) flow into the prompt.
- **Impact**: MEDIUM -- follows existing pattern in background hooks, but this grants broadest tool set including Bash.
- **Fix**: Restrict `--allowedTools` to `Read,Grep,Glob,Write` (dropping `Bash`), or document as accepted risk with code comment matching the architecture exception comment already in `feature-kb.cjs`.

---

## Should-Fix Issues

**1. `removeEntry` early-return on parse error now continues instead** - `scripts/hooks/lib/feature-kb.cjs:340-365`
**Confidence**: 82% (1 reviewer: architecture)
- **Problem**: The early-return guard was moved before the lock, but in the locked section, the `catch` block after `JSON.parse` now continues instead of returning. This writes an empty `index.json` where none existed before (behavior change).
- **Fix**: Restore the early return in the catch block:
  ```javascript
  try {
    index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  } catch {
    releaseLock(lockPath);
    return; // nothing to remove
  }
  ```

**2. Lock failure test slow at 515ms** - `tests/feature-kb/feature-kb.test.ts:221-239`
**Confidence**: 82% (1 reviewer: testing)
- **Problem**: T1 test uses 500ms timeout resulting in ~515ms wall-clock time. While acceptable, this is 3x slower than other tests. Risks suite degradation if more lock tests added.
- **Fix**: Reduce timeout to 200ms (still gives 2 retry cycles at 100ms sleep).

**3. `checkAllStaleness` positive path untested after refactoring** - `scripts/hooks/lib/feature-kb.cjs:166-199` and `tests/feature-kb/feature-kb.test.ts:382-395`
**Confidence**: 85% (1 reviewer: testing)
- **Problem**: The refactored `checkAllStaleness` inlined git-log logic but has no test in a real git repo. Only covers missing-index and non-repo paths. Since the function no longer delegates to `checkStaleness`, the two code paths should each have coverage.
- **Fix**: Add a positive-staleness test matching the pattern of T2 (real git repo with changed tracked files).

**4. file-organization.md shared agents count is 12, should be 13** - `docs/reference/file-organization.md:18,141`
**Confidence**: 95% (2 reviewers: documentation, consistency)
- **Problem**: PR modified file-organization.md but left stale agent count (omits `kb-builder`).
- **Fix**: Update line 18 and line 141 to list 13 agents and add `kb-builder` to the list.

**5. TypeScript non-null assertions on `loadIndex` returns** - `tests/feature-kb/feature-kb.test.ts:179,195,214,258,275,285`
**Confidence**: 82% (1 reviewer: typescript)
- **Problem**: Multiple test lines use `index!.features[...]` after `loadIndex()` (which returns `| null`). Non-null assertions bypass safety. If `loadIndex` ever returns null due to race, error would be opaque.
- **Fix**: Replace with explicit assertion:
  ```typescript
  const index = loadIndex(tmp);
  expect(index).not.toBeNull();
  // TypeScript now knows index is non-null
  ```

---

## Suggestions (Lower Confidence)

**Pre-existing Issues**

- **`acquireLock` fallback comment says "busy-wait" but has empty catch** - `scripts/hooks/lib/feature-kb.cjs:232-248` (Confidence: 82%, 2 reviewers) — The catch block for `Atomics.wait` is empty with comment "Node < 16 fallback" but no actual fallback. On old runtimes, loop spins at 100% CPU. Since Node 16+ is minimum, consider dropping the comment or adding `spawnSync('sleep')` fallback.

- **`tryBreakStaleLock` extracted but not directly tested** - `scripts/hooks/lib/feature-kb.cjs:210-221` (Confidence: 80%, 1 reviewer) — The new helper is only exercised indirectly through lock-failure test (only hits `return false` path). The stale-lock-breaking paths are untested.

- **CONTRIBUTING.md shared agents count is 12, should be 13** - `CONTRIBUTING.md:28` (Confidence: 95%, 1 reviewer) — Pre-existing, not touched by this PR but worth noting for follow-up.

- **`findOverlapping` uses O(n*m) nested loop** - `scripts/hooks/lib/feature-kb.cjs:317-330` (Confidence: 65%, 1 reviewer) — Quadratic complexity; acceptable for small index but could be Set-based if it grows.

---

## Architecture & Quality Notes

**Strengths:**
- Well-structured refactoring across 7 orchestration skills (fractional → integer phases is cleaner)
- Excellent security hardening: `execFileSync` with array args throughout, thorough `validateSlug` with path traversal prevention, `--allowedTools` restrictions on background hooks
- Good extractions: `NOT_STALE` sentinel, `parseGitChangedFiles`, `parseGitChangedFiles`, dispatch table in CLI, `exitOnInvalidSlug` helper all reduce duplication
- Directory-boundary matching fix in `findOverlapping` is correct (prevents `src/cli` matching `src/clitools`)
- Comprehensive test coverage (31 tests, T1-T6 adding lock failure, staleness, boundary, CLI edge cases)
- KB Builder agent properly typed, tool restrictions clear

**Concerns:**
- Phase renumbering volume (~250 lines across 7 files) increased review burden; cross-reference sites partially missed
- `checkAllStaleness` duplicates logic instead of sharing — violates DRY
- `removeEntry` behavior silently changed (corrupt index handling) without test coverage

---

## Action Plan

1. **Fix blocking phase references** (5 minutes):
   - Fix plan:orch GUIDED steps 3-5 numbering
   - Fix pipeline:orch three phase ranges (lines 35, 56, 78)
   - Fix review:orch Phase 3 → Phase 4 reference

2. **Extract shared staleness helper** (10 minutes):
   - Create `checkEntryStaleness(worktreePath, entry)` helper
   - Call from both `checkStaleness` and `checkAllStaleness`
   - Hoist git-dir check in batch function only

3. **Add test coverage for `removeEntry` behavior** (5 minutes):
   - Document whether new behavior (overwrite corrupt index) is intended
   - Add test to cover the chosen behavior

4. **Update file-organization.md agent count** (2 minutes):
   - Change 12 → 13, add `kb-builder` to list

5. **Address should-fix items** (optional for this PR, can be follow-up):
   - Reduce lock test timeout
   - Add `checkAllStaleness` positive test
   - Fix TypeScript non-null assertions in tests
   - Document `--allowedTools` restriction decision or add tool restriction

---

## Summary

This PR demonstrates strong engineering on the feature KB system itself: the KB Builder agent, index management, lock handling, and staleness detection are well-designed. The phase renumbering across 7 orchestration skills was executed thoroughly but incompletely — three cross-reference sites were missed, creating a risk that agents following phase numbers will silently skip Phase 7. The `checkAllStaleness` refactoring duplicates logic that should be shared. The `removeEntry` behavior change (corrupt index handling) is untested and undocumented. These are all straightforward to fix once identified. With corrections to the blocking issues, this PR is ready to merge.
