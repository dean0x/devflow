# Code Review Summary

**Branch**: fix/ambient-skill-loading → main
**Date**: 2026-03-20
**Reviewers**: 8 (architecture, complexity, consistency, documentation, performance, regression, security, tests)

## Merge Recommendation: CHANGES_REQUESTED

Multiple reviewers have identified blocking and critical issues that must be addressed before merge. While the core fix (removing `allowed-tools` from ambient-router) is sound and well-tested, documentation gaps and flaky tests prevent approval.

---

## Issue Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW | Total |
|----------|----------|------|--------|-----|-------|
| **Blocking** | 0 | 2 | 4 | 0 | **6** |
| **Should Fix** | 0 | 0 | 3 | 0 | **3** |
| **Pre-existing** | 0 | 1 | 4 | 2 | **7** |

---

## Blocking Issues (Must Fix Before Merge)

### CRITICAL

None.

### HIGH

1. **Flaky integration tests for GUIDED/ORCHESTRATED classifications** — `tests/integration/ambient-activation.test.ts:72-91`
   - **Confidence**: 85%
   - **Problem**: Tests assert skill loading happens for GUIDED/ORCHESTRATED tiers, but the file's own KNOWN LIMITATION comments acknowledge `claude -p` mode does not reliably trigger classification. Tests use hard `expect(...).toBe(true)` with no conditional skip, producing non-deterministic CI failures.
   - **Impact**: Flaky tests erode CI confidence. Anyone running `npm run test:integration` will get unreliable failures.
   - **Fix**: Either skip these tests with explanation, or restructure to conditional assertions that accept classification may be absent in `-p` mode:
   ```typescript
   it('loads skills for GUIDED classification', () => {
     const output = runClaude('add a login form...');
     if (hasClassification(output)) {
       expect(hasSkillLoading(output)).toBe(true);
     }
     // In -p mode, classification may be skipped — not a failure
   });
   ```

2. **Removal of `allowed-tools` restriction widens ambient-router attack surface** — `shared/skills/ambient-router/SKILL.md:1-5`
   - **Confidence**: 82%
   - **Problem**: The `allowed-tools` frontmatter was removed, making ambient-router the only skill with completely unrestricted tool access. While documented as intentional (orchestrator), this creates a privilege escalation path if other skills load ambient-router. No other skill in the codebase omits `allowed-tools`.
   - **Impact**: Defense-in-depth concern. If the Claude plugin framework supports bounded tool lists, prefer a list like `Read, Grep, Glob, Bash, Edit, Write, Skill, Agent` over complete absence.
   - **Fix**: Add a bounded `allowed-tools` list rather than omitting the field entirely. If omission is required, add a comment explaining why:
   ```markdown
   # allowed-tools: unrestricted (orchestrator -- no restriction)
   ```

### MEDIUM (4 issues)

1. **README "Uninstall Options" table missing `--dry-run`, `--plugin`, `--verbose` flags** — `README.md:252-257`
   - **Confidence**: 95%
   - **Problem**: Three flags were added (`--dry-run` in this PR, `--plugin` and `--verbose` previously), but the README table only documents `--scope` and `--keep-docs`. Users cannot discover these capabilities.
   - **Fix**: Update the table to include all four flags with descriptions.

2. **CHANGELOG [Unreleased] section is empty** — `CHANGELOG.md:8-9`
   - **Confidence**: 85%
   - **Problem**: Three user-facing changes in this branch (ambient fix, test helpers, `--dry-run` flag) warrant CHANGELOG entries before merge, but the section is empty.
   - **Fix**: Add entries:
   ```markdown
   ## [Unreleased]

   ### Added
   - **Uninstall `--dry-run` flag** — preview what would be removed without deleting

   ### Fixed
   - **Ambient skill loading** — removed `allowed-tools` restriction from ambient-router
   - **Ambient hook preamble** — added explicit instruction for GUIDED/ORCHESTRATED tiers
   ```

3. **Preamble string duplicated between hook script and TypeScript test helper** — `scripts/hooks/ambient-prompt:42`, `tests/integration/helpers.ts:18-19`
   - **Confidence**: 85% (consistent across 4 reviewers: architecture, consistency, documentation, tests)
   - **Problem**: The ambient preamble text is defined identically in two places without any sync mechanism. Changes to one may not propagate to the other. This already nearly happened in this PR.
   - **Impact**: If preamble drifts, integration tests inject stale instructions, producing unreliable results.
   - **Fix**: Extract to shared source or add cross-reference comments. At minimum:
   ```bash
   # SYNC: must match tests/integration/helpers.ts AMBIENT_PREAMBLE
   PREAMBLE="..."
   ```

4. **Dry-run silently skips multi-scope selection prompt** — `src/cli/commands/uninstall.ts:168`
   - **Confidence**: 82%
   - **Problem**: When DevFlow is installed in both user and local scopes, `--dry-run` always shows both without prompting the user to pick one. Non-dry-run path lets user select. This means the dry-run preview may not match what a real uninstall would do.
   - **Fix**: Document this as intentional, or restructure to still present the scope selector during dry-run:
   ```typescript
   if (scopesToUninstall.length > 1) {
     if (!dryRun && process.stdin.isTTY) {
       // existing prompt...
     } else if (dryRun) {
       p.log.info('Showing plan for all detected scopes.');
     }
   }
   ```

---

## Should-Fix Issues (Improve Code Quality)

### MEDIUM (3 issues)

1. **Missing test for `formatDryRunPlan` deduplication behavior** — `tests/uninstall-logic.test.ts:68-106`
   - **Confidence**: 82%
   - **Problem**: The function explicitly deduplicates inputs, but no test verifies this. If dedup were removed, no test would fail.
   - **Fix**: Add test case verifying deduplication of repeated asset names.

2. **Missing test coverage for EXPLORE and CHAT intents** — `tests/ambient.test.ts:200-205`
   - **Confidence**: 80%
   - **Problem**: The regex supports six intents, but `extractIntent` is only tested with four (IMPLEMENT, DEBUG, REVIEW, PLAN). EXPLORE and CHAT are untested.
   - **Fix**: Add test cases for both.

3. **Duplicated AMBIENT_PREAMBLE across hook and test helper** — (Same as blocking MEDIUM #3 above)
   - Add a test that reads the hook script and verifies the preamble substring matches.

---

## Pre-existing Issues (Informational, Not Blocking)

### HIGH

1. **`uninstall.ts` is a 610-line monolith combining 7+ responsibilities** — `src/cli/commands/uninstall.ts`
   - **Confidence**: 85%
   - **Problem**: God-method with scope detection, CLI interaction, dry-run, asset removal, hook cleanup, settings, shell profile management all in one action handler.
   - **Fix**: Refactoring task for separate PR. Extract cleanup phases into named functions.

### MEDIUM (4 issues)

1. **`formatDryRunPlan` inlined in command action instead of extracted to utility** — `src/cli/commands/uninstall.ts:58-79`
   - **Confidence**: 82%
   - **Problem**: Pure formatting function co-located in 600+ line command file. Should move to `src/cli/utils/assets.ts`.

2. **Shell variable expansion in echo pipes could use printf instead** — `scripts/hooks/ambient-prompt:28,34,37`
   - **Confidence**: 80%
   - **Problem**: Using `echo "$PROMPT"` can misinterpret flags like `-n` or `-e`. Replace with `printf '%s'` for robustness.

3. **`execSync` with string interpolation in `uninstallPluginViaCli`** — `src/cli/commands/uninstall.ts:87`
   - **Confidence**: 85%
   - **Problem**: Pre-existing pattern; use `execFileSync` instead to avoid shell invocation.

4. **CLAUDE.md scope description slightly out of date** — `CLAUDE.md:130`
   - **Confidence**: 82%
   - **Problem**: Wording is ambiguous between "field is empty" and "field is missing." Clarify: "omits `allowed-tools` entirely (unrestricted)."

### LOW (2 issues)

1. **Integration test known-limitation comment references removed prerequisite** — `tests/integration/ambient-activation.test.ts:28`
   - **Confidence**: 80%
   - **Problem**: Comment removed old prerequisite but didn't note that preamble is now injected via `--append-system-prompt`.

2. **`isClaudeAvailable()` uses synchronous execSync** — `tests/integration/helpers.ts:11`
   - **Confidence**: 80%
   - **Problem**: Blocks event loop. Acceptable for test setup but shouldn't propagate to production.

---

## Reviewer Scores

| Reviewer | Score | Recommendation |
|----------|-------|-----------------|
| Architecture | 8/10 | APPROVED_WITH_CONDITIONS |
| Complexity | 9/10 | APPROVED |
| Consistency | 8/10 | APPROVED_WITH_CONDITIONS |
| Documentation | 6/10 | CHANGES_REQUESTED |
| Performance | 9/10 | APPROVED |
| Regression | 9/10 | APPROVED_WITH_CONDITIONS |
| Security | 8/10 | APPROVED_WITH_CONDITIONS |
| Tests | 7/10 | APPROVED_WITH_CONDITIONS |

---

## Action Plan (Priority Order)

1. **[BLOCKING]** Fix flaky integration tests for GUIDED/ORCHESTRATED (HIGH severity, 85% confidence)
   - Skip or restructure conditional assertions for `-p` mode limitation

2. **[BLOCKING]** Add `allowed-tools` defense-in-depth (HIGH severity, 82% confidence)
   - Prefer bounded tool list over complete unrestriction

3. **[BLOCKING]** Update README Uninstall Options table (HIGH severity, 95% confidence)
   - Add `--dry-run`, `--plugin`, `--verbose` with descriptions

4. **[BLOCKING]** Populate CHANGELOG [Unreleased] section (MEDIUM severity, 85% confidence)
   - Add entries for ambient fix, test helpers, `--dry-run` feature

5. **[BLOCKING]** Resolve preamble duplication (MEDIUM severity, 85% confidence)
   - Extract to shared constant or add cross-reference comments

6. **[BLOCKING]** Document or fix dry-run scope selection behavior (MEDIUM severity, 82% confidence)
   - Either clarify that all scopes are shown by design, or make preview match reality

7. **[SHOULD-FIX]** Add test for `formatDryRunPlan` deduplication (82% confidence)
8. **[SHOULD-FIX]** Add test for EXPLORE and CHAT intents (80% confidence)
9. **[SHOULD-FIX]** Update CLAUDE.md wording for clarity (82% confidence)

---

## Summary

The core ambient skill loading fix is architecturally sound and addresses a real bug. Tests are well-structured for new code. However, **documentation gaps** (README, CHANGELOG), **flaky integration tests**, and **security defense-in-depth concerns** must be addressed before merge.

The 6 blocking issues are all actionable and straightforward to fix. Once addressed, this PR will be a solid improvement to DevFlow's ambient mode reliability and UX.
