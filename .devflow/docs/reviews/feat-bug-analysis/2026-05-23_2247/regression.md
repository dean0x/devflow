# Regression Review Report

**Branch**: feat/bug-analysis -> main
**Date**: 2026-05-23

## Issues in Your Changes (BLOCKING)

### HIGH

**Bug-analysis report format incompatible with Resolver issue extraction** - `shared/skills/resolve:orch/SKILL.md:65-69`, `plugins/devflow-resolve/commands/resolve.md:120-128`
**Confidence**: 88%
- Problem: Both resolve:orch Phase 3 and /resolve Phase 1 extract issues with `category: blocking/should-fix/pre-existing` fields. The bug-analyzer agent (`shared/agents/bug-analyzer.md`) produces a flat `## Bugs Found` report with severity subsections (CRITICAL/HIGH/MEDIUM/LOW) but NO category classification (blocking/should-fix/pre-existing). The resolve:orch claims "Resolver agents parse the same per-focus `.md` format" (line 37) but the formats are structurally different: reviewer reports use `## Issues in Your Changes (BLOCKING)` / `## Issues in Code You Touched (Should Fix)` / `## Pre-existing Issues (Not Blocking)` headers, while bug-analyzer reports use `## Bugs Found` / `### CRITICAL` / `### HIGH` headers. The Resolver agent input contract (`shared/agents/resolver.md:22`) expects each issue to have a `category` field. When resolving bug-analysis reports, the orchestrator will attempt to extract `category` from a report that does not contain categories, likely defaulting all issues to an undefined category or failing silently.
- Fix: Either (a) update the resolve:orch and /resolve Phase 1/Parse Issues to handle bug-analysis format explicitly -- mapping all bugs to `blocking` category since they are all in changed code, or (b) add a note in the bug-analysis fallback sections that all bug-analysis issues should be treated as `blocking` category since the bug-analyzer only analyzes changed code (diff-first approach).

**Resolve Parse Issues phase does not exclude bug-analysis-specific files** - `shared/skills/resolve:orch/SKILL.md:65`, `plugins/devflow-resolve/commands/resolve.md:112-114`
**Confidence**: 90%
- Problem: When `/resolve` or resolve:orch targets a bug-analysis directory, Phase 3 / Phase 1 reads all `{focus}.md` files and excludes only `review-summary.md` and `resolution-summary.md`. Bug-analysis directories also contain `static-findings.md` and `bug-analysis-summary.md`. The `static-findings.md` file contains raw SARIF-parsed tool output in a table format that is not structured as issues with file:line/severity/category fields. The `bug-analysis-summary.md` is the synthesizer output (analogous to `review-summary.md`). Neither should be parsed as issue sources. The resolve:orch exclusion list at line 65 says `exclude review-summary.md and resolution-summary.md` but does not mention `bug-analysis-summary.md` or `static-findings.md`. The /resolve command exclusion list at lines 112-114 similarly only excludes `review-summary.md` and `resolution-summary.md`.
- Fix: Update the exclusion lists in both `resolve:orch/SKILL.md` Phase 3 and `/resolve` command Phase 1 to also exclude `bug-analysis-summary.md` and `static-findings.md` when parsing a bug-analysis directory. Example: "Read all `{focus}.md` files in the timestamped directory (exclude `review-summary.md`, `resolution-summary.md`, `bug-analysis-summary.md`, and `static-findings.md`)."

### MEDIUM

**Bug-analysis not integrated into ambient mode agent/skill registry** - `src/cli/plugins.ts:135-186`
**Confidence**: 82%
- Problem: The `devflow-ambient` plugin's agents list does not include `bug-analyzer`, and its skills list does not reference any bug-analysis-specific skill. While `devflow-bug-analysis` is a standalone plugin with its own command, the ambient mode's resolve:orch skill now contains bug-analysis fallback logic (checking `.devflow/docs/bug-analysis/` directories). If a user runs `/resolve` through ambient mode and it falls back to a bug-analysis directory, the orchestrator needs the Resolver to understand bug-analysis report format, which works. However, the ambient mode cannot invoke `/bug-analysis` itself because `bug-analyzer` is not in its agents list. This means the ambient router cannot dispatch a BUG_ANALYSIS intent even if one were added. This is not a blocking regression since ambient mode was never expected to trigger bug-analysis, but it is an incomplete integration that could surprise users who expect ambient parity.
- Fix: Add `'bug-analyzer'` to the `devflow-ambient` agents array if ambient dispatch of bug-analysis is planned. If not planned, this is acceptable as-is but should be documented as a known gap.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**resolve:orch Phase 1 previously searched all `.devflow/docs/reviews/` — now scoped to branch slug** - `shared/skills/resolve:orch/SKILL.md:27-29`
**Confidence**: 85%
- Problem: The old resolve:orch Phase 1 said "Find the latest timestamped directory under `.devflow/docs/reviews/`" (searching across all branches). The new version scopes it to `.devflow/docs/reviews/{BRANCH_SLUG}/` by first deriving `BRANCH_SLUG` from the current branch name. This is actually a behavior change that narrows the search scope. In the old behavior, if a user was on branch `feat/foo` but had reviews from a different branch name in `.devflow/docs/reviews/`, the old code could potentially pick up reviews from other branches. The new behavior is arguably more correct (matches the `/resolve` command behavior which always scoped to branch slug) but is a silent behavior change. Since the old behavior was arguably a bug (resolving reviews from wrong branches), this is more of a fix than a regression.
- Fix: No action needed -- this is a correctness improvement. Noting for awareness only.

## Pre-existing Issues (Not Blocking)

(none)

## Suggestions (Lower Confidence)

- **Missing `-teams.md` variant for bug-analysis command** - `plugins/devflow-bug-analysis/commands/bug-analysis.md` (Confidence: 65%) -- CLAUDE.md documents "Every `-teams.md` command variant must have a matching base `.md` file" and 8 commands use Agent Teams. The bug-analysis command has no `-teams.md` variant, which is consistent with `devflow-self-review` (also No teams variant). However, the PR description doesn't mention whether teams support was intentionally excluded.

- **Resolver agent does not reference bug-analysis skills** - `shared/agents/resolver.md` (Confidence: 62%) -- The Resolver references `devflow:software-design`, `devflow:git`, `devflow:patterns`, etc. but not `devflow:security` or `devflow:reliability` which the BugAnalyzer references. When resolving bug-analysis security findings, the Resolver may lack domain context. However, this is pre-existing -- the Resolver was designed to be domain-agnostic and validates by reading code directly.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 2 | 1 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Regression Score**: 6/10
**Recommendation**: CHANGES_REQUESTED

The two HIGH blocking issues represent genuine format mismatches between the bug-analyzer output and the Resolver's expected input contract. When `/resolve` falls back to a bug-analysis directory, the Resolver will encounter reports that lack `category` fields and the orchestrator will attempt to parse `static-findings.md` and `bug-analysis-summary.md` as issue sources. These are not theoretical -- they are structural incompatibilities in the documented formats. The fix is straightforward: update the exclusion lists and add category mapping guidance in the resolve fallback sections.
