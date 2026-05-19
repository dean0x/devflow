# Code Review Summary

**Branch**: feature/triage-layer-ci-gate -> main
**Date**: 2026-05-14_1424
**Reviewers**: 9 (security, architecture, performance, complexity, consistency, regression, testing, reliability, typescript)

## Merge Recommendation: CHANGES_REQUESTED

The triage layer and CI status gate are architecturally sound features that reduce unnecessary orchestration and provide a safety valve for CI failures. However, **3 BLOCKING issues must be fixed before merge**: (1) shell injection vulnerability in triage skill validation, (2) unbounded CI fix chains without scope constraints, and (3) stale phase numbering in 4 files that break sequential orchestration.

---

## Issue Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 5 | 1 | - |
| Should Fix | - | 2 | 7 | - |
| Pre-existing | - | - | 2 | 0 |
| **Total** | **0** | **7** | **10** | **0** |

---

## Blocking Issues (Must Fix Before Merge)

### CRITICAL/HIGH Severity

**1. Shell injection via unvalidated issue number in triage skills** — 82% confidence
- **Files**: `shared/skills/implement:triage/SKILL.md:23`, `shared/skills/plan:triage/SKILL.md:23`
- **Problem**: Both triage skills instruct the model to run `gh issue view NNN --json ...` where `NNN` is extracted from the user's prompt via pattern matching. If the model extracts a malformed value (containing shell metacharacters like `; rm -rf /` or `$(command)`), this leads to command injection. While `gh` validates issue numbers as integers, the instruction does not specify that extracted values must be validated as numeric-only strings before shell interpolation, and model regex extraction from natural language is not guaranteed clean.
- **Impact**: Security vulnerability — arbitrary shell command execution possible
- **Fix**: Add explicit validation: "Extract the issue number as digits only (strip non-numeric characters). Validate: extracted value must match `^[0-9]+$`. If not, skip this check and default to GUIDED."

**2. CI Status Gate bypasses quality gates via unscoped Coder agent** — 80% confidence (security) + 85% confidence (architecture)
- **Files**: `shared/skills/implement:orch/SKILL.md:162`, `shared/skills/resolve:orch/SKILL.md:126`, `plugins/devflow-resolve/commands/resolve.md:261`, `plugins/devflow-resolve/commands/resolve-teams.md:261`
- **Problem**: Phase 7 spawns a Coder agent to fix CI failures with instruction "fix CI failures based on check names and failure context" but no scope constraints. The Coder could modify security-critical files, disable tests, or weaken configurations. Additionally, the fix bypasses Phase 6 quality gates (Simplifier, Validator) — after the Coder pushes, no review validates the CI fix before it reaches main.
- **Impact**: Security risk (unbounded Coder scope, bypassed quality gates) + architectural violation (fix-loop logic duplicated verbatim across 4 files with no single source of truth)
- **Fix**: Add scope constraints to Coder spawn and require validation gate:
  ```markdown
  5. **If FAILING** → Spawn `Agent(subagent_type="Coder")` with constraints:
     - ONLY modify files directly related to failing checks
     - Do NOT disable tests, skip lint rules, or weaken configurations
     - Run `Agent(subagent_type="Validator")` on the fix before pushing
     Max 2 fix attempts.
  ```

**3. Stale phase cross-references break sequential orchestration** — 95% confidence (consistency) + 92% confidence (regression)
- **Files**: `plugins/devflow-resolve/commands/resolve.md:184`, `plugins/devflow-resolve/commands/resolve-teams.md:231,383`, `shared/skills/implement:orch/SKILL.md:223`
- **Problem**: Phase numbering shifted when CI Status Gate was inserted as Phase 7 (Phases 8→9, 7→8). Four cross-references in resolve commands and implement:orch still reference the old phase numbers:
  - `resolve.md:184` — "Phase 8" should be "Phase 9"
  - `resolve-teams.md:231` — "Phase 8" should be "Phase 9"
  - `resolve-teams.md:383` — "Phase 8" should be "Phase 9"
  - `implement:orch:223` — "Phase 7" should be "Phase 8"
- **Impact**: Orchestrators will announce incorrect phase counts and reference wrong phases, breaking sequential execution logic
- **Fix**: Update all 4 references to use correct phase numbers

**4. CI Status Gate polling lacks total wall-clock timeout** — 92% confidence (reliability)
- **Files**: `shared/skills/implement:orch/SKILL.md:161`, `shared/skills/resolve:orch/SKILL.md:125`, `plugins/devflow-resolve/commands/resolve.md:214`, `plugins/devflow-resolve/commands/resolve-teams.md:261`
- **Problem**: Spec defines "poll every 60 seconds, max 10 iterations" for PENDING state but does not account for FAILING fix-and-recheck cycles. After 10 polls, if status becomes FAILING, a Coder fixes and pushes. The re-check after fix could enter PENDING again, creating unbounded chain: PENDING (10 polls) → FAILING → fix → PENDING (10 more polls?). No total budget specified across both cycles.
- **Impact**: Reliability concern — potential unbounded wall-clock delay, matches PF-001 (unbounded loops)
- **Fix**: Specify total CI gate budget: "Max 10 poll iterations combined across all check/fix cycles. After fix-then-recheck, if PENDING, treat as 'CI still running, verify manually.'"

**5. CI classification order allows FAILING to mask PENDING state** — 85% confidence (reliability)
- **Files**: `shared/agents/git.md:292`
- **Problem**: Status classification is: "all SUCCESS → PASSING, any FAILURE → FAILING, any IN_PROGRESS/PENDING → PENDING". If checks have both FAILURE and PENDING simultaneously (one failed, another running), status is FAILING. Coder fixes the failing check, but the pending check may fail after fix, wasting a fix attempt. Classification should handle mixed-state explicitly.
- **Impact**: Reliability/predictability — speculative fix attempts on partial results
- **Fix**: Add mixed-state classification: "If any FAILURE AND any IN_PROGRESS/PENDING → `PARTIAL_FAILURE` — wait for pending checks to complete." Or document that FAILING takes priority and accept speculative fixes.

---

## Should-Fix Issues (High Priority, Recommend Fixing)

### Architecture Issues

**6. CI Status Gate logic duplicated verbatim in 4 locations** — 88% confidence
- **Files**: `shared/skills/implement:orch/SKILL.md:153-162`, `shared/skills/resolve:orch/SKILL.md:113-126`, `plugins/devflow-resolve/commands/resolve.md:201-214`, `plugins/devflow-resolve/commands/resolve-teams.md:248-261`
- **Problem**: Same polling/fix logic (60s intervals, 10 iterations, branching on PASSING/FAILING/PENDING/NO_PR/NO_CI, max 2 fix attempts) duplicated near-verbatim across 4 files. Any change to CI gate behavior requires updating all 4 in lockstep. Already has minor inconsistencies: `implement:orch` passes PR_NUMBER from PR_URL, `resolve:orch` omits it, resolve commands pass WORKTREE_PATH.
- **Recommendation**: Add `<!-- SYNC: CI Status Gate logic — also in {3 other locations} -->` marker at top of each section per project's SYNC pattern (see `scripts/hooks/preamble` line 36) to make drift detectable during maintenance.

**7. Unvalidated PR_NUMBER in check-ci-status operation** — 80% confidence (security)
- **Files**: `shared/agents/git.md:290`
- **Problem**: `check-ci-status` operation discovers or accepts `PR_NUMBER` parameter, but there is no validation that it matches `^[0-9]+$` before interpolation into `gh pr checks {number}`. While Git agent receives PR_NUMBER from orchestrator (not direct user input), orchestrator extracts it from conversation context which is untrusted.
- **Recommendation**: Add validation: "If PR_NUMBER provided, validate it matches `^[0-9]+$`. If not, output status `NO_PR`, stop."

### Performance Issues

**8. CI polling re-spawns full Git agent without backoff** — 82% confidence
- **Files**: `shared/skills/implement:orch/SKILL.md:161`, `shared/skills/resolve:orch/SKILL.md:125`
- **Problem**: Each poll re-spawns a full Git agent (heavyweight operation) with no exponential backoff. If GitHub API is rate-limited, this creates 10 spawns with 10 API calls and no awareness of rate limits. Git agent has rate-limit awareness for PR comments (check X-RateLimit-Remaining) but check-ci-status operation lacks it.
- **Recommendation**: Add rate-limit awareness to check-ci-status operation or note that if `gh pr checks` fails (rate limit), poll should stop early rather than retry all 10 iterations.

### Testing Issues

**9. Missing negative tests for old INTENT/DEPTH format** — 85% confidence
- **Files**: `tests/integration/helpers.ts:5-6`, `tests/ambient.test.ts:414-417`
- **Problem**: `extractDepth` refactored from `CLASSIFICATION_PATTERN` (matching `INTENT/DEPTH`) to `SCOPE_PATTERN` (matching `Scope: GUIDED|ORCHESTRATED`). Test only validates positive case. No test verifies old format is **not** parsed — confirming the intentional breaking change per ADR-001 (clean break).
- **Recommendation**: Add negative assertion: `expect(extractDepth(textResult('Devflow: IMPLEMENT/GUIDED'))).toBeNull();`

**10. Missing negative test for old CLASSIFICATION_PATTERN format** — 83% confidence
- **Files**: `tests/ambient.test.ts:424-433`
- **Problem**: `CLASSIFICATION_PATTERN` changed from `INTENT/DEPTH` (with `/`) to `INTENT.` (with `.`). Pattern variation tests validate new format but do not verify old format is rejected. Regex changed fundamentally, so should have at least one negative test.
- **Recommendation**: Add to pattern test: `expect(hasClassification(textResult('Devflow: IMPLEMENT/GUIDED'))).toBe(false);`

**11. Integration tests lack diagnostic for triage-only failures** — 82% confidence
- **Files**: `tests/integration/ambient-activation.test.ts:67-151`
- **Problem**: All GUIDED-tier integration tests require three skills in sequence: `['router', '{intent}:triage', '{intent}:guided']`. If test fails (missing skill), no diagnostic shows whether triage ran but routed differently. ORCHESTRATED tests have fallback diagnostic but GUIDED tests don't.
- **Recommendation**: Add diagnostic when `passed` is false — log which required skills were present/absent.

---

## Regression Issues (Should Fix)

**12. Stale INTENT/DEPTH format references in test-driven-development skill** — 85% confidence
- **Files**: `shared/skills/test-driven-development/SKILL.md:154,193-201`
- **Problem**: TDD skill documents old `IMPLEMENT/GUIDED`, `IMPLEMENT/ORCHESTRATED` classification format throughout "Ambient Mode Integration" section. Not directly touched by PR but in skill ecosystem restructured by it. Creates confusion for agents loading this skill — described format doesn't match router/triage output.
- **Recommendation**: Update to new format: replace `IMPLEMENT/GUIDED` with `IMPLEMENT (GUIDED scope)` or simplify to just intent names.

**13. Stale pipeline:orch phase references after implement:orch growth** — 92% confidence
- **Files**: `shared/skills/pipeline:orch/SKILL.md:35,39,78`
- **Problem**: Pipeline:orch line 35 says "Phases 1-7" but implement:orch now has 9 phases. Line 39 references "Phase 7" for cleanup (now Phase 8). Line 78 says resolve:orch has "Phases 1-7" but it now has 8 phases.
- **Recommendation**: Update line 35 to "Phases 1-9", line 39 to "Phase 8", line 78 to "Phases 1-8".

**14. Stale pipeline:orch cost communication template** — 90% confidence
- **Files**: `shared/skills/pipeline:orch/SKILL.md:27`
- **Problem**: Cost template says `PIPELINE/ORCHESTRATED` but router now emits `PIPELINE.` without `/DEPTH` suffix. Template was not updated for classification format change.
- **Recommendation**: Update to `Devflow: PIPELINE. Loading: devflow:pipeline:orch. This runs implement -> review -> resolve (15+ agents across stages).`

### TypeScript Issues

**15. Dead CHAT variant in CLASSIFICATION_PATTERN** — 82% confidence
- **Files**: `tests/integration/helpers.ts:5`
- **Problem**: Pattern includes `CHAT` in alternation but CHAT intent is QUICK-only per classification-rules.md (line 20). QUICK intents never emit `Devflow: {INTENT}.` marker, so CHAT pattern variant is unreachable dead code, misleading readers.
- **Recommendation**: Remove `CHAT` from pattern.

---

## Pre-existing Issues (Not Blocking)

**16. resolve:orch grows to 8 phases without phase count limit** — 80% confidence
- **Problem**: Skill now has 8 phases (higher than typical). Implements:orch has 9. No maximum phase count documented. More phases → more context for model to track.
- **Note**: Pre-existing architectural concern, not new with this PR.

**17. Integration test helper uses hardcoded model names** — 80% confidence
- **Files**: `tests/integration/helpers.ts:183-193`
- **Problem**: `runClaudeStreamingWithRetry` hardcodes `'haiku'`, `'sonnet'` as model names. If naming changes, will silently fail.
- **Note**: Pre-existing pattern, not introduced by this PR.

---

## Key Insights

1. **Triage layer reduces orchestration costs** — Default-to-GUIDED bias correctly inverts prior behavior; scope assessment before agent spawn prevents expensive unnecessary orchestration
2. **CI Status Gate needs scoping constraints** — Coder agent spawned for CI fixes must be constrained to files related to failing checks and must pass through quality gates (Validator) before pushing
3. **DRY violation in CI gate** — 4-way verbatim duplication across skills/commands creates maintenance burden; SYNC markers recommended as pragmatic solution given markdown-only codebase
4. **Clean-break validation missing** — Tests don't explicitly verify old INTENT/DEPTH format is rejected; important for ADR-001 philosophy
5. **Phase numbering cascading** — Phase shift on new CI gate insertion propagated to 4 cross-references; indicates need for phase-numbering convention in CLAUDE.md

---

## Action Plan

**Priority 1 — Fix before commit:**
1. Add shell injection validation to implement:triage and plan:triage (`^[0-9]+$` check on extracted issue number)
2. Add scope constraints and Validator gate to Coder spawn in all 4 CI gate locations
3. Update stale phase references in resolve.md (1), resolve-teams.md (2), implement:orch (1)
4. Add total wall-clock timeout spec to CI polling (combined budget across PENDING + fix cycles)
5. Clarify CI classification order for mixed FAILURE+PENDING state

**Priority 2 — Should fix:**
6. Add SYNC markers to 4 CI Status Gate locations
7. Add validation to check-ci-status PR_NUMBER parameter
8. Add rate-limit awareness or early-exit strategy to CI polling
9. Add negative test assertions for old format non-matching (2 tests)
10. Add diagnostic logging to GUIDED integration tests
11. Update test-driven-development.md stale format references
12. Update pipeline:orch stale phase references (3 locations)
13. Remove dead CHAT variant from CLASSIFICATION_PATTERN

**Priority 3 — Nice to have:**
14. Extract CI gate polling logic to dedicated reference document or shared skill
15. Document phase count limits in CLAUDE.md

---

## Confidence & Quality

- **Blocking issues**: 5 HIGH-severity findings across security, architecture, and reliability domains
- **Should-fix issues**: 9 issues flagged by 2+ reviewers (boosted confidence via deduplication)
- **Recommendation basis**: Blocking CRITICAL/HIGH issues in security (shell injection), architecture (duplication), and reliability (unbounded cycles) require fixes; clean-break testing gaps should be addressed
