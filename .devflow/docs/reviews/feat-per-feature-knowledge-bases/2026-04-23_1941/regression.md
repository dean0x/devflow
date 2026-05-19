# Regression Review Report

**Branch**: feat-per-feature-knowledge-bases -> main
**Date**: 2026-04-23

## Issues in Your Changes (BLOCKING)

### HIGH

**`updateIndex` will throw if `.features/` directory does not exist** - `scripts/hooks/lib/feature-kb.cjs:227`
**Confidence**: 90%
- Problem: `updateIndex()` calls `acquireLock(lockPath)` where `lockPath = path.join(featuresDir, '.kb.lock')`, but never ensures `featuresDir` (`.features/`) exists before calling `fs.mkdirSync(lockPath)` inside `acquireLock`. If the `.features/` directory has not been created yet (e.g., user runs `devflow kb create` on a project that never ran `devflow init`, or the KB Builder agent is spawned in a worktree without `.features/`), `mkdirSync` will throw `ENOENT` because it cannot create a subdirectory inside a non-existent parent.
- Fix: Add `fs.mkdirSync(featuresDir, { recursive: true });` before `acquireLock(lockPath)` in `updateIndex()`:
```javascript
function updateIndex(worktreePath, entry) {
  validateSlug(entry.slug);
  const featuresDir = path.join(worktreePath, '.features');
  fs.mkdirSync(featuresDir, { recursive: true }); // ensure parent exists
  const lockPath = path.join(featuresDir, '.kb.lock');
  // ...
}
```

**`removeEntry` will throw if `.features/` directory does not exist** - `scripts/hooks/lib/feature-kb.cjs:291`
**Confidence**: 85%
- Problem: Same issue as `updateIndex` -- `removeEntry()` calls `acquireLock(lockPath)` without ensuring `.features/` exists. The `catch` block on line 300 for `JSON.parse(fs.readFileSync(...))` handles a missing `index.json` gracefully (returns early), but the `acquireLock` call on line 291 happens BEFORE this early return, so the lock acquisition will fail if `.features/` itself is missing.
- Fix: Add `fs.mkdirSync(featuresDir, { recursive: true })` before `acquireLock`, or add an early existence check: `if (!fs.existsSync(featuresDir)) return;`

### MEDIUM

**`FEATURE_KNOWLEDGE` not passed to SEQUENTIAL_CODERS and PARALLEL_CODERS strategies** - `plugins/devflow-implement/commands/implement.md:117-141` and `plugins/devflow-implement/commands/implement-teams.md:110-134`
**Confidence**: 85%
- Problem: In both `/implement` command variants, the `FEATURE_KNOWLEDGE` variable is added to the SINGLE_CODER invocation template (line 106) but is missing from the SEQUENTIAL_CODERS and PARALLEL_CODERS Coder invocation templates. The diff shows `FEATURE_KNOWLEDGE: {feature_knowledge}` added only to the SINGLE_CODER block. Sequential Phase 1 Coder, Phase 2+ Coders, and Parallel Coder templates do not include `FEATURE_KNOWLEDGE`. This means feature knowledge context is silently lost for ~20% of implementation tasks (those using sequential/parallel strategies).
- Fix: Add `FEATURE_KNOWLEDGE: {feature_knowledge}` to all Coder invocation templates in both `implement.md` and `implement-teams.md`, matching the SINGLE_CODER pattern.

**`plan:orch` Phase 0.5 renumbered existing Phase 0.5 to Phase 0.6 -- potential reference breakage** - `shared/skills/plan:orch/SKILL.md:71-94`
**Confidence**: 80%
- Problem: The existing "Requirements Discovery" phase was `Phase 0.5` and is now renumbered to `Phase 0.6` to make room for the new "Load Feature Knowledge" phase. The Phase Completion Checklist on line 301-302 is updated, but any external references to "Phase 0.5" in documentation, working memory, or user mental models will now point to a different phase. The skip examples on lines 109-110 still reference "Phase 0.5" for the Requirements Discovery phase, which is the OLD numbering.
- Fix: Update the skip/discover examples on lines 109-110 to reference "Phase 0.6" instead of "Phase 0.5":
  ```
  **Discover examples** (run Phase 0.6):
  ```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**`markStale` only detects overlap but does not persist staleness** - `scripts/hooks/lib/feature-kb.cjs:263-276`
**Confidence**: 80%
- Problem: The `markStale` function returns an array of slugs with overlapping referenced files, but does not actually modify the index to mark them as stale. The function name `markStale` implies mutation (compare to `removeEntry` which mutates), but it only performs read-only overlap detection. Callers in `implement.md` (line 404) and `implement:orch` (line 147) invoke `mark-stale` expecting it to signal staleness for the next plan cycle, but the staleness is only detected via `checkStaleness` (git-based) at load time. The `markStale` function's output (printed to stdout) is not consumed by the orchestrator instructions. This is a functional regression relative to the documented behavior: "This signals staleness for the next plan cycle."
- Fix: Either rename to `detectStaleOverlap` to clarify it's read-only, or actually persist a staleness flag in the index (e.g., `staleAt: ISO timestamp`) that `checkStaleness` can use as a secondary signal.

## Pre-existing Issues (Not Blocking)

_No critical pre-existing issues found._

## Suggestions (Lower Confidence)

- **`explore:orch` Phase numbering starts at 0.5** - `shared/skills/explore:orch/SKILL.md:32` (Confidence: 65%) -- The new Phase 0.5 in explore:orch is added before Phase 1, which is consistent with other orch skills, but the existing Phase numbering in the checklist (line 108) could confuse agents that use sequential phase counting.

- **`kb create` always uses `--referencedFiles='[]'`** - `src/cli/commands/kb.ts:195` (Confidence: 70%) -- The `devflow kb create` command always passes an empty `referencedFiles` array to the prompt, meaning the KB Builder agent must populate this via `update-index`. If the agent fails to do so, the KB will have no staleness tracking. Consider having the CLI detect key files from the directories.

- **`removeEntry` lock is acquired even when nothing to remove** - `scripts/hooks/lib/feature-kb.cjs:286-313` (Confidence: 65%) -- The function acquires the lock, reads the index, and only then discovers the slug doesn't exist (returns early on line 300). This holds the lock unnecessarily. Could check index existence before acquiring lock.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 2 | 2 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Regression Score**: 7/10
**Recommendation**: CHANGES_REQUESTED
