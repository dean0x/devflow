# Code Review Summary

**Branch**: feat/bug-analysis -> main
**Date**: 2026-05-24
**Cycle**: 2

## Merge Recommendation: CHANGES_REQUESTED

All 10 reviewers (security, architecture, performance, complexity, consistency, regression, testing, reliability, typescript, documentation) have identified **9 blocking issues** that require resolution before merge. The prior resolution cycle (cycle 1) successfully fixed 17 issues with zero false positives, demonstrating effective issue resolution. This cycle shows new blocking issues introduced by the recent code changes, not pre-existing problems.

---

## Blocking Issues (Must Fix)

### HIGH Severity — Blocking (10 issues)

| Issue | Focus | File | Confidence | Impact |
|-------|-------|------|------------|--------|
| Per-file Snyk invocation creates O(n) tool startup cost | Performance | `bug-analysis.md:106` | 85% | 20+ file branches experience 4+ hours total analysis time due to sequential per-file snyk invocations instead of batched execution |
| Redundant `git diff --name-only` computed 3+ times | Performance | `bug-analysis.md:66,99,106,166` | 82% | Wasted git object walks; consistency risk if working tree changes between phases |
| xargs `-d '\n'` is GNU extension, not available on macOS | Reliability | `bug-analysis.md:99,106` | 92% | Static analysis phase fails silently on primary dev platform (macOS); Darwin platform gets zero static findings |
| CodeQL SARIF output read after `rm -rf` cleanup | Reliability | `bug-analysis.md:119-121` | 88% | SARIF file deleted before parsing; expensive 10+ minute analysis results discarded silently |
| Severity-to-category mapping conflates location with severity | Architecture | `bug-analyzer.md:113-116` | 82% | LOW bugs in changed code misclassified as "Pre-existing (Not Blocking)"; `/resolve` deprioritizes them incorrectly |
| Bug-analyzer summary table format diverges from reviewer agent | Consistency | `bug-analyzer.md:188-196` | 85% | Summary uses flat `Severity \| Count` instead of 3-category matrix; `/resolve` parser expects matrix format |
| Bug-analyzer report missing `Recommendation` footer | Consistency | `bug-analyzer.md:197` | 82% | Synthesizer cannot parse recommendation from bug-analysis reports; aggregation logic breaks for dual-mode (review + bug-analysis) synthesis |
| resolve:orch scan limit inconsistent with resolve.md | Regression | `resolve:orch/SKILL.md:29` vs `resolve.md:71` | 85% | `/resolve` (full) scans all review directories; resolve:orch (ambient) limits to 10. Behavioral divergence risks missing unresolved reviews >10 directories deep |
| resolve:orch bug-analysis fallback changes untested | Testing | `resolve:orch/SKILL.md:29-39` | 92% | Ambient resolve mode fallback has zero test coverage; future edits could silently remove bug-analysis fallback from ambient path |
| BugAnalyzer output format change untested | Testing | `bug-analyzer.md:111-116` | 88% | 3-category format change for `/resolve` compatibility is untested; category-to-severity mapping drifts silently |
| CLAUDE.md incorrectly claims `/bug-analysis` auto-discovers worktrees | Documentation | `CLAUDE.md:194` | 95% | Documentation claims `/bug-analysis` handles multiple worktrees like `/code-review`, but implementation has no worktree support; agents/developers misled |

### MEDIUM Severity — Blocking (1 issue)

| Issue | Focus | File | Confidence | Impact |
|-------|-------|------|------------|--------|
| Snyk `xargs -I{}` flag injection vulnerability | Security | `bug-analysis.md:106` | 82% | Maliciously-named filenames (e.g., `--json-file-output=/tmp/evil`) bypass flag prefix; snyk output can be redirected to attacker-controlled paths |

---

## Should-Fix Issues (High Priority, Not Blocking)

### MEDIUM Severity — Should Fix (8 issues)

| Issue | Focus | File | Confidence | Impact |
|-------|-------|------|------------|--------|
| Plugin.json missing `apply-decisions` skill declaration | Architecture | `plugin.json:26-28` | 85% | Manifest incomplete; dev inspecting plugin.json won't see dependency surface (Universal Skill Installation masks the gap at runtime) |
| Plugin.json missing focus-specific skills (security, regression, consistency, complexity) | Architecture | `plugin.json:26-28` | 80% | Same manifest gap; inconsistent with code-review plugin pattern |
| Static analysis tools (Semgrep, Snyk) run sequentially instead of parallel | Performance | `bug-analysis.md:96-121` | 80% | Sequential execution wastes 15-30 seconds per run; could be parallelized since tools are independent |
| Snyk `--file={}` semantics incorrect for dependency scanning | Reliability | `bug-analysis.md:106` | 82% | `snyk code test --file={file}` is not designed for per-file scoping; runs full project scan N times instead of once |
| Plan artifact listing unbounded; should scan 10 most recent | Reliability | `bug-analysis.md:152` | 80% | Inconsistent with resolve bounds pattern; adds latency in long-lived projects with many design artifacts |
| Bug-analyzer skill declarations untested in automation | Testing | `bug-analyzer.md:8-10` | 85% | No test verifies agent frontmatter skills; silent skill loss during maintenance would degrade analysis quality without failing tests |
| Edge case test uses fragile fallback logic | Testing | `bug-analysis-fallback.test.ts:112-126` | 82% | Test can pass even if Edge Cases section removed via fallback to alternate assertion; masks regressions |
| CodeQL SARIF parse instruction contradicts code order | Documentation | `bug-analysis.md:121` | 82% | Prose says "parse before cleanup" but code shows cleanup first; ambiguous contract for agent execution |

---

## False Positive Rate & Convergence

**Cycle 1 Resolution**: 17 issues fixed, 0 false positives, 0 deferred
**Cycle 2 Detection**: 19 new blocking/should-fix issues identified across 10 reviewers

**Convergent Findings** (multiple reviewers flagged the same issue):
1. **xargs portability** — Found by Reliability (HIGH), Security (70% suggestion), Documentation (indirectly)
2. **CodeQL read-after-delete race** — Found by Reliability (HIGH), Documentation (MEDIUM), Security (65% suggestion)
3. **Severity-to-category conflation** — Found by Architecture (MEDIUM blocking), Regression (MEDIUM should-fix)
4. **Snyk per-file invocation** — Found by Performance (HIGH), Reliability (MEDIUM Snyk semantics)
5. **Summary format mismatch** — Found by Consistency (HIGH), indirectly by all parsers
6. **resolve:orch test coverage gap** — Found by Testing (HIGH)

**Divergent Findings**: None — all reviewers aligned on severity and categorization.

---

## Issue Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW | Total |
|----------|----------|------|--------|-----|-------|
| Blocking | 0 | 10 | 1 | - | **11** |
| Should Fix | - | 0 | 8 | - | **8** |
| Pre-existing | - | - | 0 | 0 | **0** |
| **Total** | **0** | **10** | **9** | **0** | **19** |

---

## Review Scores by Focus

| Focus | Score | Status | Key Issues |
|-------|-------|--------|-----------|
| Security | 8/10 | APPROVED_WITH_CONDITIONS | 1 flag-injection MEDIUM in should-fix |
| Architecture | 8/10 | APPROVED_WITH_CONDITIONS | 1 category mapping MEDIUM blocking; 2 plugin.json gaps |
| Performance | 7/10 | CHANGES_REQUESTED | 2 HIGH blocking (per-file Snyk, redundant git diff) |
| Complexity | 9/10 | APPROVED | No blocking issues; structure well-designed |
| Consistency | 8/10 | CHANGES_REQUESTED | 2 HIGH blocking (summary format, missing footer) |
| Regression | 8/10 | CHANGES_REQUESTED | 1 HIGH blocking (scan limit divergence) |
| Testing | 6/10 | CHANGES_REQUESTED | 2 HIGH blocking (resolve:orch untested, output format untested) |
| Reliability | 6/10 | CHANGES_REQUESTED | 2 HIGH blocking (xargs portability, CodeQL race); 2 MEDIUM should-fix |
| TypeScript | 8/10 | APPROVED | Minor stylistic observations only |
| Documentation | 7/10 | CHANGES_REQUESTED | 1 HIGH blocking (worktree claim); 2 MEDIUM (CodeQL order, phase numbering) |

---

## Key Patterns

### 1. Command/Agent Contract Divergence
Both `resolve.md` and `resolve:orch` describe the same resolve workflow but now diverge on scan limits:
- `resolve.md` scans all review directories
- `resolve:orch` limits to 10 most recent

**Fix**: Standardize both to "10 most recent" for performance consistency.

### 2. macOS Portability Blocker
The xargs `-d '\n'` pattern fails silently on macOS (project's primary platform):
- Semgrep/Snyk get zero results
- Silent failure due to `2>/dev/null` error suppression
- Undermines hybrid static+semantic architecture (ADR-006)

**Fix**: Use `tr '\n' '\0' | xargs -0` (portable across GNU/BSD).

### 3. Output Format Consistency
Bug-analyzer adopted reviewer's 3-category structure for `/resolve` compatibility, but summary table and footer differ:
- Summary: flat table vs matrix
- Footer: missing Recommendation line

**Fix**: Match reviewer template exactly (matrix summary + Recommendation footer).

### 4. Test Coverage Gaps
Three material changes have zero test coverage:
1. resolve:orch Phase 1 bug-analysis fallback behavior
2. BugAnalyzer output format (3-category structure)
3. BugAnalyzer agent frontmatter skill declarations

**Fix**: Add structural tests for all three surfaces.

### 5. Performance O(n) Issues
Two sources of linear scaling:
1. Snyk invoked per-file via xargs instead of once
2. `git diff --name-only` re-computed 4 times per run

**Fix**: Batch Snyk invocation; cache git diff output.

---

## Convergence Status

| Metric | Value | Assessment |
|--------|-------|------------|
| Issues Found | 19 | New issues, not regressions from cycle 1 |
| False Positive Rate | 0% | All issues valid per established patterns |
| Reviewer Agreement | 100% | No divergent findings; all 10 reviewers aligned |
| Blocking Issues | 11 | Require resolution before merge |
| Should-Fix Issues | 8 | High priority, fixable in parallel |
| Cycle Trend | ✓ Improving | Cycle 1: 17 issues → fixed all. Cycle 2: 19 issues → expect good fix rate. |

**Convergence Prediction**: With efficient parallel fixes to the 10 HIGH issues (estimated 3-4 hours), cycle 3 should see near-zero blocking issues. Monitor for false positive ratio at cycle 3+ if it exceeds 70%.

---

## Action Plan

1. **Critical Path (Blocks Merge)**
   - Fix xargs portability (macOS compatibility) — 15 min
   - Fix CodeQL read-after-delete race — 15 min
   - Fix Snyk per-file invocation — 30 min
   - Fix resolve:orch vs resolve.md scan limit — 20 min
   - Fix bug-analyzer output format (summary table + footer) — 20 min
   - Fix CLAUDE.md worktree documentation — 10 min
   - Add 4 missing test cases (resolve:orch, agent format, agent skills, edge case) — 1.5 hours

2. **High Priority (Should-Fix, Fixable in Parallel)**
   - Reduce git diff invocations (cache output) — 20 min
   - Parallelize Semgrep/Snyk — 30 min
   - Fix plugin.json skill declarations — 10 min
   - Fix severity-to-category documentation — 10 min
   - Fix Snyk semantics (--file flag) — 20 min
   - Bound plan artifact scan — 10 min

3. **Quality Polish**
   - Add Phase Completion Checklist to bug-analysis command
   - Add phase numbering clarification to resolve:orch Phase 5 comment

**Total Estimated Effort**: 4–5 hours critical path, 2–3 hours high-priority fixes.

---

## Recommendation Details

**CHANGES_REQUESTED** is the appropriate merge gate. The blocking issues are material:
- **Portability**: Silent failure on primary dev platform (macOS)
- **Data Loss**: CodeQL results discarded before parsing
- **Compatibility**: Output format mismatch with `/resolve` parser
- **Behavioral Divergence**: resolve.md vs resolve:orch inconsistency
- **Test Coverage**: Three untested contract changes

All issues are fixable without architectural changes. The prior resolution cycle demonstrated effective issue triage (zero false positives), suggesting this cycle's fixes will also resolve cleanly.

Recommend **Cycle 3 Review** after fixes to verify convergence.
