# Code Review Summary

**Branch**: feature/incremental-reviews-worktree-discovery -> main
**Date**: 2026-03-28_1148
**Reviewers**: Security, Architecture, Performance, Complexity, Consistency, Regression, Tests, Documentation

## Merge Recommendation: CHANGES_REQUESTED

The PR introduces well-designed incremental reviews and worktree auto-discovery features with thorough edge case handling. However, multiple reviewers (6 of 8) flagged critical regressions and blocking inconsistencies that must be resolved before merge. Most impactful: a synthesizer glob pattern regression that mirrors PF-001 (reviewed and fixed before), and worktree support duplication across 9 agent files creating a 9-way synchronization burden. Seven HIGH-severity blocking issues from 6+ reviewers require fixes.

---

## Issue Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW | Total |
|----------|----------|------|--------|-----|-------|
| Blocking | 0 | 7 | 7 | 0 | 14 |
| Should Fix | 0 | 0 | 10 | 0 | 10 |
| Pre-existing | 0 | 0 | 8 | 1 | 9 |

---

## Blocking Issues (MUST FIX)

### CRITICAL
_No critical issues found._

### HIGH (7 issues, 82-92% confidence)

**1. Synthesizer glob pattern regression** (92% confidence, 6 reviewers flagged as blocker)
- **File**: `shared/agents/synthesizer.md:139`
- **Problem**: Line 139 excludes `review-summary.*.md` but the new output filename is `review-summary.md` (line 164). The glob `*` requires ≥1 character, so it won't match the new filename. Means synthesizer will re-ingest its own previous output, corrupting aggregation. This is a re-emergence of PF-001.
- **Regression**: Mirrors PF-001 (pitfall already documented and supposedly fixed). Test: Regression agent explicitly flagged as HIGH.
- **Fix**: Change line 139 to: `Read all review reports from ${REVIEW_BASE_DIR}/*.md (exclude review-summary.md and resolution-summary.md)`

**2. Inconsistent DIFF_COMMAND between teams/non-teams** (88% confidence, 2 reviewers flagged)
- **Files**: `plugins/devflow-code-review/commands/code-review.md:120` vs `code-review-teams.md:125`
- **Problem**: Non-teams passes `DIFF_COMMAND: git diff {DIFF_RANGE}` (missing `-C {worktree_path}`). Teams variant correctly uses `git {-C worktree_path} diff`. In multi-worktree mode, non-teams reviewers will run diff in wrong directory (cwd instead of worktree), producing incorrect diffs.
- **Impact**: Silent correctness failure in multi-worktree reviews.
- **Fix**: Align non-teams to teams variant. Change `code-review.md:120` to include worktree prefix: `DIFF_COMMAND: git {-C worktree_path} diff {DIFF_RANGE}` (or document inline with fallback note).

**3. Path traversal via unsanitized `--path` parameter** (82% confidence, 1 reviewer flagged)
- **Files**: `plugins/devflow-code-review/commands/code-review.md:15`, `plugins/devflow-resolve/commands/resolve.md:15`
- **Problem**: `--path` flag is used directly in git commands and file paths without validating it's a legitimate worktree. Could accept `../../sensitive-dir` or paths outside the repo.
- **Scope**: Affects `git -C {worktree_path}`, file reads (`.docs/...`), and file writes.
- **Fix**: Add validation step after accepting `--path`:
  - Validate path exists and is a directory
  - Verify path appears in `git worktree list` output (confirms it is a legitimate worktree)
  - If validation fails, report error and stop

**4. Unsanitized SHA from `.last-review-head`** (80% confidence, 1 reviewer flagged)
- **Files**: `plugins/devflow-code-review/commands/code-review.md:59-63`, `code-review-teams.md:101-105`
- **Problem**: SHA read from `.last-review-head` is used directly in `git diff {last-review-sha}...HEAD` without format validation. File is plain-text and could be manually edited with shell metacharacters.
- **Fix**: Add SHA format validation before use:
  - Read SHA from file
  - Validate format: must match `^[0-9a-f]{7,40}$` (hex characters only, 7-40 chars)
  - If invalid, log warning and fallback to full diff
  - Then verify reachable: `git -C {worktree} cat-file -t {sha}`

**5. Worktree support boilerplate duplicated across 9 agent files** (85-90% confidence, 3 reviewers flagged)
- **Files**: `shared/agents/coder.md:25-31`, `git.md:20-24`, `resolver.md:19-25`, `reviewer.md:22-28`, `scrutinizer.md:18-23`, `shepherd.md:20-25`, `simplifier.md:18-23`, `synthesizer.md:19-25`, `validator.md:18-25`, `skimmer.md` (missing)
- **Problem**: Identical "Worktree Support (Optional)" block copy-pasted 9 times. When worktree path resolution logic changes, all 9 files must update in lockstep. Duplicates the existing PF-005 pattern (HookEntry/HookMatcher/Settings duplication).
- **Fix**: Extract to shared reference document (`shared/skills/worktree-support/SKILL.md` or reference in `docs-framework`). Have each agent reference it with one line: "See references/worktree-support.md for WORKTREE_PATH handling." This follows the existing pattern where skills are single source of truth.

**6. Worktree discovery logic duplicated across 4 command files** (88-90% confidence, 3 reviewers flagged)
- **Files**: `plugins/devflow-code-review/commands/code-review.md:22-33`, `code-review-teams.md:22-33`, `plugins/devflow-resolve/commands/resolve.md:22-33`, `resolve-teams.md:22-33`
- **Problem**: The 7-step worktree discovery algorithm is duplicated verbatim in all 4 command files. Protected branch list and filtering heuristics are embedded inline in each copy. Any change to discovery logic (e.g., new protected branch pattern) requires coordinated edits to 4 files.
- **Fix**: Extract discovery algorithm to a shared skill (`shared/skills/worktree-discovery/SKILL.md`) that defines discovery steps, filtering rules, and protected branch list in one place. Each command references it: "Follow worktree-discovery skill for Step 0a."

**7. Unbounded PR comment fetch O(n*m) API overhead** (85% confidence, 1 reviewer flagged)
- **File**: `shared/agents/git.md:190`
- **Problem**: The `comment-pr` process fetches existing PR review comments before each new comment creation to check for duplicates. No caching specified. Results in O(n) API calls for deduplication where single prefetch would suffice. Combined with 1-second rate-limit delay, a 20-comment review adds 20+ extra API round-trips.
- **Fix**: Restructure to fetch comments once before the creation loop:
  1. Get PR context (head SHA, changed files, diff)
  2. Read review reports
  3. Extract issues
  4. **Fetch existing comments once** via `gh api repos/{owner}/{repo}/pulls/{pr_number}/comments`. Build lookup set of `{file}:{line}` pairs.
  5. For each new comment, skip if `{file}:{line}` already exists in lookup set

---

## Should-Fix Issues (MEDIUM confidence, 82-90%, in code you touched)

These are not blockers but should be fixed while addressing blocking issues (they're in the same files):

**1. Inconsistent git command syntax in reviewer prompts** (92% confidence)
- **File**: `plugins/devflow-code-review/commands/code-review-teams.md:125,140,155,174`
- **Problem**: Template uses `git {-C worktree_path} diff {DIFF_RANGE}` (curly-brace-wrapping flag) vs established pattern `git -C {WORKTREE_PATH} ...`. Inconsistent with how other files in the PR express the same concept.
- **Fix**: Align with base variant's approach. Use `DIFF_COMMAND` parameter (matching `code-review.md:116`) or consistent conditional syntax.

**2. Missing backwards compatibility section in `resolve-teams.md`** (90% confidence)
- **File**: `plugins/devflow-resolve/commands/resolve-teams.md`
- **Problem**: Base variant `resolve.md` has `## Backwards Compatibility` section; teams variant is missing it entirely. All four command files should have this section since they all introduce the same directory layout change.
- **Fix**: Add to `resolve-teams.md` after Edge Cases table:
  ```markdown
  ## Backwards Compatibility

  - **Single worktree**: Auto-discovery finds only one worktree -> proceeds exactly as before. Zero behavior change.
  - **Legacy flat layout**: If `.docs/reviews/{branch-slug}/` contains flat `*.md` files (no timestamped subdirectories), reads from flat directory (existing behavior).
  ```

**3. Inconsistent edge case tables** (88% confidence)
- **Files**: `code-review.md:207-221` vs `code-review-teams.md:330-344`
- **Problem**: Three unnecessary differences between base and teams edge case tables:
  1. `code-review.md` has "Many worktrees (5+)" (line 220); teams doesn't
  2. "Duplicate PR comments" handling text differs
  3. Missing alignment of worktree-specific rows
- **Fix**: Synchronize tables. Add "Many worktrees (5+)" to teams variant. Align duplicate comment handling text.

**4. Inconsistent wording: "Prefix git commands" vs "Prefix all git commands"** (85% confidence)
- **File**: `shared/agents/git.md:21`
- **Problem**: Git agent says "Prefix **all** git commands" while other 8 agents say "Prefix git commands" (without "all").
- **Fix**: Use "Prefix all git commands" consistently across all 9 agents for explicitness.

**5. Missing `WORKTREE_PATH` in skimmer agent** (80% confidence)
- **File**: `shared/agents/skimmer.md`
- **Problem**: All 10 other shared agents received a Worktree Support section; skimmer is missing. `plan-orchestration` passes `WORKTREE_PATH` through to spawned agents but skimmer doesn't document how to handle it.
- **Fix**: Add standard Worktree Support section to `skimmer.md`.

**6. Timestamp parameter validation in `--review` flag** (83% confidence)
- **Files**: `plugins/devflow-resolve/commands/resolve.md:14`, `resolve-teams.md:11`
- **Problem**: `--review {timestamp}` parameter is used to construct directory path without format validation. Could theoretically traverse with crafted values like `../../etc`.
- **Fix**: Add format validation for timestamp parameter to match `YYYY-MM-DD_HHMM` or `YYYY-MM-DD_HHMMSS` pattern.

**7. Inconsistent column headers** (85% confidence)
- **File**: `plugins/devflow-code-review/commands/code-review-teams.md:72` vs `code-review.md:72`
- **Problem**: Phase 1 file-type detection table uses different headers. Teams says "Adds Perspective"; base says "Adds Review". Same content, different label.
- **Fix**: Align to "Adds Review" (more accurate).

**8. Synthesizer should exclude `resolution-summary.md`** (85% confidence)
- **File**: `shared/agents/synthesizer.md:139`
- **Problem**: Second part of synthesizer's self-exclusion. With timestamped directories, `resolution-summary.md` (written by `/resolve`) now lives in same directory. If user runs `/resolve` then re-runs `/code-review` on same timestamp, synthesizer would ingest the resolution summary as a review report (different structure, corrupts aggregation).
- **Fix**: Include in the exclusion fix above: `exclude review-summary.md and resolution-summary.md`

**9. No test coverage for MULTI_WORKTREE preamble line** (88% confidence)
- **File**: `tests/ambient.test.ts:260-298`
- **Problem**: Preamble drift detection test checks for keyword presence but doesn't verify the new `MULTI_WORKTREE:` classification line. Test was designed to catch exactly this kind of regression.
- **Fix**: Add assertion to preamble drift detection test:
  ```typescript
  expect(shellPreamble).toContain('MULTI_WORKTREE');
  ```

**10. Ambiguous git template syntax** (82% confidence)
- **File**: `plugins/devflow-code-review/commands/code-review-teams.md:125` (4 occurrences)
- **Problem**: Template `git {-C worktree_path} diff {DIFF_RANGE}` is ambiguous. Curly braces wrap entire flag, making it unclear whether `-C` itself is conditional. Inconsistent with how template variables are presented (`{DIFF_RANGE}` wraps just the value, not the flag).
- **Fix**: Use explicit conditional notation: `git [-C {worktree_path}] diff {DIFF_RANGE}` (omit -C if no WORKTREE_PATH).

---

## Pre-existing Issues (Informational, Not Blocking)

| Issue | Location | Severity | Count |
|-------|----------|----------|-------|
| Base/teams command duplication growing | plugins/devflow-code-review/, resolve/ | MEDIUM | 1 |
| Git commands use index.lock prefix convention | CLAUDE.md:196 | MEDIUM | 1 |
| Rate limit exhaustion in multi-worktree | code-review.md:131-138 | MEDIUM | 1 |
| PF-006 (per-line jq spawning) | session-start hooks | MEDIUM | 1 |
| Code-review-teams.md approaching length threshold | 361 lines | MEDIUM | 1 |
| Resolver batch prompts verbose templates | resolve-teams.md:119-167 | MEDIUM | 1 |
| Protected branch list should be centralized | 4 command files | MEDIUM | 1 |

---

## Reviewer Consensus

| Reviewer | Score | Recommendation | Blocking Count |
|----------|-------|-----------------|-----------------|
| Security | 8/10 | CHANGES_REQUESTED | 2 HIGH |
| Architecture | 6/10 | CHANGES_REQUESTED | 3 HIGH |
| Performance | 7/10 | CHANGES_REQUESTED | 1 HIGH |
| Complexity | 6/10 | APPROVED_WITH_CONDITIONS | 1 HIGH |
| Consistency | 7/10 | CHANGES_REQUESTED | 2 HIGH |
| Regression | 7/10 | CHANGES_REQUESTED | 2 HIGH |
| Tests | 5/10 | CHANGES_REQUESTED | 1 HIGH |
| Documentation | 8/10 | APPROVED_WITH_CONDITIONS | 1 MEDIUM |

**Consensus**: 6 of 8 reviewers recommend CHANGES_REQUESTED. 7 HIGH-severity issues across blocking categories require fixes. Confidence boosted by multiple reviewers flagging identical issues (synthesizer glob: 6 reviewers; worktree duplication: 3 reviewers; consistency issues: 2 reviewers each).

---

## Action Plan (Priority Order)

### Phase 1: Regressions (Fix First)
1. **Synthesizer glob pattern** - Fix line 139 to exclude `review-summary.md` and `resolution-summary.md`
2. **DIFF_COMMAND consistency** - Align non-teams code-review.md line 120 with teams variant (add worktree prefix)

### Phase 2: Security/Validation
3. **Path traversal fix** - Add path validation for `--path` flag in both code-review and resolve commands
4. **SHA validation** - Add format validation for `.last-review-head` SHA before use

### Phase 3: DRY Violations (Extract Shared Logic)
5. **Extract worktree discovery** - Create `shared/skills/worktree-discovery/SKILL.md` with the 7-step algorithm
6. **Extract worktree support** - Create reference document for `WORKTREE_PATH` handling; update all 9 agent files to reference it
7. **Fix performance** - Restructure `comment-pr` to fetch PR comments once before loop

### Phase 4: Consistency
8. **Align backwards compatibility sections** - Add to `resolve-teams.md` (copy from `resolve.md`)
9. **Sync edge case tables** - Add "Many worktrees (5+)" to teams variant
10. **Fix skimmer agent** - Add Worktree Support section (currently missing)
11. **Align wording** - Use "Prefix all git commands" consistently across all 9 agents

### Phase 5: Tests
12. **Add MULTI_WORKTREE assertion** - Update preamble drift detection test in `tests/ambient.test.ts`

---

## Summary

This PR delivers two valuable features (incremental reviews, worktree discovery) with thoughtful design and edge case handling. The main quality issues are regressions (synthesizer glob mirrors PF-001) and architectural duplication (worktree support + discovery logic duplicated across 4-9 files) that compound maintenance cost. Fixing the 7 HIGH-severity blocking issues (phases 1-2-3 above) requires ~2-3 hours of focused work and will bring the codebase into alignment with existing quality standards. The changes are safe to make in isolation — each fix is confined to the files flagged.

**Merge Timeline**: After these fixes, the PR will be merge-ready. All feedback from 8 domains is actionable and non-controversial.
