# Architecture Review Report

**Branch**: feat/bug-analysis -> main
**Date**: 2026-05-24

## Issues in Your Changes (BLOCKING)

(No CRITICAL or HIGH issues found)

## Issues in Code You Touched (Should Fix)

### MEDIUM

**BugAnalyzer severity-to-category mapping conflates location-based categories with severity** - `shared/agents/bug-analyzer.md:113-118`
**Confidence**: 82%
- Problem: The Reviewer agent uses a location-based 3-category system (lines you added, lines you touched, pre-existing lines) while the BugAnalyzer approximates this with a severity-based mapping (CRITICAL/HIGH -> Blocking, MEDIUM -> Should Fix, LOW -> Pre-existing). The inline note at line 118 acknowledges this is an approximation, but the mapping creates a semantic mismatch: a LOW-severity bug in newly-added code gets classified as "Pre-existing Issues (Not Blocking)" even though the developer just wrote that code. This breaks the Iron Law of the review methodology: "If you didn't add it, you don't own it" -- here the developer DID add it, but the category says otherwise.
- Impact: The `/resolve` pipeline consumes these categories to determine fix priority. A LOW-severity bug in freshly-written code (e.g., a minor off-by-one) would be classified as "Pre-existing (Not Blocking)" and deprioritized, when it should be in the developer's responsibility bucket. This could lead to newly-introduced minor bugs slipping through resolution.
- Fix: Consider retaining severity for priority but using the diff location for category assignment, which is what the BugAnalyzer already has access to (it runs `DIFF_COMMAND`). Alternatively, document explicitly in the Resolver's issue parsing that BugAnalyzer categories should be treated differently from Reviewer categories -- all BugAnalyzer findings in the diff are effectively "in your changes."

## Pre-existing Issues (Not Blocking)

### MEDIUM

**Bug-analysis command lacks Phase Completion Checklist unlike peer orchestration skills** - `plugins/devflow-bug-analysis/commands/bug-analysis.md`
**Confidence**: 82%
- Problem: The `resolve:orch` SKILL.md has a `## Phase Completion Checklist` section (lines 161-174) that verifies all phases were executed before reporting. The `code-review` command has an analogous pattern. The `bug-analysis.md` command has no such checklist despite having a 7-phase pipeline. This is a consistency gap with the established orchestration command pattern. (applies ADR-004 -- separate workflow, but it should still follow the project's established orchestration conventions)
- Impact: Without a phase completion checklist, the orchestrating model could skip phases (e.g., Phase 3 context loading) without detection, leading to degraded analysis quality. This is a reliability concern in prompt-driven pipelines.
- Fix: Add a `## Phase Completion Checklist` section after `## Principles` in `bug-analysis.md`:
```markdown
## Phase Completion Checklist

Before reporting results, verify every phase was announced:

- [ ] Phase 1: Pre-flight -> BRANCH_INFO captured
- [ ] Phase 2: Static Analysis -> DIFF_RANGE, ANALYSIS_DIR, STATIC_FINDINGS captured
- [ ] Phase 3: Context Loading -> DECISIONS_CONTEXT, FEATURE_KNOWLEDGE, PLAN_CONTEXT loaded
- [ ] Phase 4: File Analysis -> ACTIVE_FOCUSES determined
- [ ] Phase 5: Bug Analysis -> ANALYZER_OUTPUTS captured per focus
- [ ] Phase 6: Synthesis -> BUG_ANALYSIS_SUMMARY captured
- [ ] Phase 7: Finalize -> .last-analysis-head written, results displayed

If any phase is unchecked, execute it before proceeding.
```

**Plugin manifest skills list diverges from code-review pattern by omitting review-methodology** - `plugins/devflow-bug-analysis/.claude-plugin/plugin.json:25-35`
**Confidence**: 80%
- Problem: The `devflow-code-review` plugin.json includes `review-methodology` in its skills array (the canonical review process skill). The `devflow-bug-analysis` plugin.json was updated to include 6 analysis skills (`apply-decisions`, `complexity`, `consistency`, `regression`, `reliability`, `security`) but omits `review-methodology`. While the BugAnalyzer agent has its own 5-step methodology rather than the 6-step review process, the Resolver agents that consume BugAnalyzer output rely on the review-methodology format. The omission is minor since skills are installed universally, but the manifest should reflect the plugin's actual skill dependencies for discoverability.
- Impact: Cosmetic -- skills are universally installed regardless of plugin selection. However, the manifest is the canonical declaration of what a plugin needs. If the universal installation policy changes, this gap would become functional.
- Fix: No action needed given universal skill installation. Document the divergence as intentional if it is.

## Suggestions (Lower Confidence)

- **Snyk single-project scan may produce findings for unchanged files that are expensive to filter** - `plugins/devflow-bug-analysis/commands/bug-analysis.md:109-113` (Confidence: 68%) -- The switch from per-file `snyk code test` to project-level scan (applies ADR-006 hybrid architecture) trades N invocations for one scan plus post-filtering. For large monorepos, the project-level scan could be significantly slower than targeted file scanning. The SARIF-to-CHANGED_FILES filter step is documented but the performance tradeoff is unaddressed.

- **Phase 4 Requires annotation says DIFF_RANGE but the implementation uses CHANGED_FILES** - `plugins/devflow-bug-analysis/commands/bug-analysis.md:168` (Confidence: 72%) -- Phase 4 declares `**Requires:** DIFF_RANGE` in its annotation but the actual body says "using `CHANGED_FILES` (already computed in Step 2b -- do not re-run `git diff`)". The Requires annotation should list `CHANGED_FILES` (derived from DIFF_RANGE) for accuracy, or list both. This is a documentation-implementation mismatch in the Phase Protocol annotations.

- **resolve:orch Phase 2 hardcodes "." for feature-knowledge staleness but uses "{worktree}" for decisions** - `shared/skills/resolve:orch/SKILL.md:53,61` (Confidence: 75%) -- Line 53 was updated to use `{worktree}` for the decisions-index call (good), but line 61 still hardcodes `"."` for the feature-knowledge staleness check. In a worktree context these would diverge, though resolve:orch is documented as excluding multi-worktree flow.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 0 | - |
| Should Fix | - | - | 1 | - |
| Pre-existing | - | - | 2 | - |

**Architecture Score**: 8/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The bug-analysis plugin follows established architectural patterns well. It correctly implements the orchestration-only command pattern (applies ADR-004), uses the same agent spawning conventions as code-review, properly separates static analysis from semantic reasoning (applies ADR-006), and integrates cleanly with the existing /resolve pipeline. The BugAnalyzer agent appropriately references existing domain skills via frontmatter rather than duplicating content (avoids PF-005 by building on existing agent patterns rather than assuming capabilities don't exist).

The primary architectural concern is the severity-to-category mapping approximation in the BugAnalyzer agent, which inverts the location-based category semantics used by the Reviewer agent. This is documented with an inline note but could cause the Resolver to misclassify newly-introduced LOW-severity bugs as pre-existing. The missing Phase Completion Checklist is a consistency gap with peer orchestration commands that should be addressed to maintain reliability across the pipeline.
