# Consistency Review Report

**Branch**: feat/bug-analysis -> main
**Date**: 2026-05-24

## Issues in Your Changes (BLOCKING)

### HIGH

**Bug-analyzer summary table format diverges from reviewer agent pattern** - `shared/agents/bug-analyzer.md:188-196`
**Confidence**: 85%
- Problem: The bug-analyzer output template uses a flat `Severity | Count` summary table, while the reviewer agent (the established pattern for all per-focus report agents) uses a `Category | CRITICAL | HIGH | MEDIUM | LOW` matrix that cross-references category (Blocking / Should Fix / Pre-existing) against severity. Since the bug-analyzer was explicitly changed in this PR to adopt the reviewer's 3-category output structure (BLOCKING, Should Fix, Pre-existing), the summary table should follow the same matrix pattern for downstream parser consistency. The `/resolve` pipeline and Synthesizer parse these reports programmatically -- a different summary table shape creates a parsing inconsistency between review reports and bug-analysis reports.
- Fix: Replace the flat summary table in the bug-analyzer output template (lines 188-196) with the reviewer's matrix format:
```markdown
## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | {n} | {n} | - | - |
| Should Fix | - | - | {n} | - |
| Pre-existing | - | - | - | {n} |
| Suggestions | {n} | - | - | - |

**{Focus} Risk**: {CRITICAL | HIGH | MEDIUM | LOW | CLEAN}
```

**Bug-analyzer report omits `Recommendation` footer present in reviewer reports** - `shared/agents/bug-analyzer.md:197`
**Confidence**: 82%
- Problem: The reviewer agent's report template ends with both a `**{Focus} Score**: {1-10}` and `**Recommendation**: {BLOCK | CHANGES_REQUESTED | APPROVED_WITH_CONDITIONS | APPROVED}` line. The bug-analyzer has `**{Focus} Risk**: {CRITICAL | HIGH | MEDIUM | LOW | CLEAN}` instead. The `Risk` label is semantically appropriate for bug analysis (vs `Score` for reviews), but the missing `Recommendation` footer means the Synthesizer must handle two distinct footer schemas when aggregating reports across review and bug-analysis modes. This is a minor structural inconsistency that could cause the Synthesizer to skip the recommendation when processing bug-analysis reports.
- Fix: Add a recommendation line after the Risk line:
```markdown
**{Focus} Risk**: {CRITICAL | HIGH | MEDIUM | LOW | CLEAN}
**Recommendation**: {BLOCK | CHANGES_REQUESTED | APPROVED_WITH_CONDITIONS | APPROVED}
```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Bug-analysis plugin.json missing `apply-decisions` skill despite agent using it** - `plugins/devflow-bug-analysis/.claude-plugin/plugin.json:25-29`
**Confidence**: 85%
- Problem: The bug-analyzer agent's frontmatter declares `devflow:apply-decisions` as a skill dependency (line 12 of `shared/agents/bug-analyzer.md`), and the bug-analysis command passes `DECISIONS_CONTEXT` to every BugAnalyzer agent with explicit instructions to "Follow devflow:apply-decisions". However, the `plugin.json` skills array does not include `apply-decisions`. While skills are universally installed (per CLAUDE.md: "All skills from all plugins are always installed"), every other plugin that uses decisions follows the convention of NOT declaring `apply-decisions` in their plugin.json either -- so this is actually consistent with the existing pattern. The `devflow-code-review` plugin also omits `apply-decisions` from its plugin.json despite the reviewer agent declaring it in frontmatter.

  Upon closer inspection, this is NOT an inconsistency -- it follows the existing convention. Downgrading to informational.

**Resolve command and resolve:orch skill diverge on scan-limit documentation wording** - `plugins/devflow-resolve/commands/resolve.md:77`, `shared/skills/resolve:orch/SKILL.md:33`
**Confidence**: 80%
- Problem: Both surfaces now correctly specify the 10-directory scan limit for the bug-analysis fallback, but the wording differs slightly. The resolve command says "scan the 10 most recent directories only" while resolve:orch says "scan the 10 most recent directories only". These are actually identical. However, for the reviews path (non-bug-analysis), the resolve command's Step 0c line 71 says "sort directories by name [...] select the latest that contains review-summary.md" with no 10-directory scan limit, while resolve:orch Phase 1 line 29 says "scan the 10 most recent" for reviews too. This means resolve:orch applies the 10-directory limit to both reviews AND bug-analysis directories, but the resolve command only applies it to bug-analysis. This is an inconsistency between the two surfaces that could cause different behavior in ambient mode vs command mode.
- Fix: Either add the 10-directory scan limit to the resolve command's review directory scan (Step 0c, line 71) to match resolve:orch, or remove it from resolve:orch's review scan to match the command. The 10-directory limit is a reasonable optimization for both paths.

## Pre-existing Issues (Not Blocking)

(No pre-existing issues found at CRITICAL severity in unchanged code.)

## Suggestions (Lower Confidence)

- **Bug-analysis plugin.json omits `apply-decisions` from skills array** - `plugins/devflow-bug-analysis/.claude-plugin/plugin.json:25-29` (Confidence: 65%) -- While this matches the existing convention (no plugin explicitly declares `apply-decisions` in plugin.json), it could be argued that since skills are universally installed, the plugin.json skills array is really about documentation/intent rather than strict installation. Other plugins that load decisions (code-review, resolve) also omit it, so this is consistent-by-convention.

- **Bug-analysis command Phase 1 pre-flight uses different PR_DESCRIPTION_GUIDANCE pattern than code-review** - `plugins/devflow-bug-analysis/commands/bug-analysis.md:19-39` (Confidence: 70%) -- The code-review command's Phase 0b loads `PR_DESCRIPTION_GUIDANCE` from plan artifacts and passes it to the Git agent for PR description generation. The bug-analysis command's Phase 1 does not extract or pass `PR_DESCRIPTION_GUIDANCE`. This may be intentional (bug-analysis is a post-pipeline tool that runs after the PR already exists), but creates a minor behavioral difference in the Git agent's `ensure-pr-ready` operation between the two commands.

- **Bug-analyzer test file uses `loadFile`/`extractSection` from `../helpers` but resolve fallback tests import from same path** - `tests/bug-analysis/structural.test.ts:17`, `tests/resolve/bug-analysis-fallback.test.ts:13` (Confidence: 60%) -- Both new test files correctly use the shared `helpers.ts` utilities, consistent with the established pattern in `tests/resolve/decisions-citation.test.ts`. No issue here.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 2 | 0 | - |
| Should Fix | - | 0 | 1 | - |
| Pre-existing | - | - | 0 | 0 |

**Consistency Score**: 8
**Recommendation**: CHANGES_REQUESTED
