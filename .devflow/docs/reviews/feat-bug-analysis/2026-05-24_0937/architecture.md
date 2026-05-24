# Architecture Review Report

**Branch**: feat/bug-analysis -> main
**Date**: 2026-05-24

## Issues in Your Changes (BLOCKING)

### MEDIUM

**BugAnalyzer severity-to-category mapping conflates code location with severity** - `shared/agents/bug-analyzer.md:113-116`
**Confidence**: 82%
- Problem: The BugAnalyzer maps severity directly to Reviewer-style categories: CRITICAL/HIGH to "Issues in Your Changes (BLOCKING)", MEDIUM to "Issues in Code You Touched (Should Fix)", LOW to "Pre-existing Issues (Not Blocking)". This conflation misuses the 3-category model. In the Reviewer agent, categories are based on *where* the issue appears relative to the diff (lines you added, same function, pre-existing code). In the BugAnalyzer, all findings come from the same diff, so category should always be "Issues in Your Changes" with varying severity. Mapping LOW bugs to "Pre-existing Issues" is semantically incorrect when the BugAnalyzer only examines changed code (per its own Step 3 and Consolidation Rule 3: "Diff-first: Only report bugs in changed code, unless CRITICAL severity"). The result is that `/resolve` may misclassify bug-analysis findings as pre-existing and give them lower resolution priority than they deserve. (applies ADR-004 -- separation from the Reviewer is correct, but the output format should not force an ill-fitting category model onto a different agent)
- Fix: Use severity headers directly within a single "Issues Found" section, or if `/resolve` compatibility requires the 3-category format, base category on the BugAnalyzer's own diff-position analysis rather than severity. An alternative is to map all bugs to "Issues in Your Changes (BLOCKING)" with the severity sub-headers (CRITICAL/HIGH/MEDIUM/LOW) since all BugAnalyzer findings are in changed code by design.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Bug-analysis plugin.json missing `apply-decisions` skill** - `plugins/devflow-bug-analysis/.claude-plugin/plugin.json:26-28`
**Confidence**: 85%
- Problem: The BugAnalyzer agent frontmatter declares `devflow:apply-decisions` as a required skill (line 12 of `bug-analyzer.md`), and Phase 5 of `bug-analysis.md` instructs agents to "Follow devflow:apply-decisions to Read full ADR/PF bodies on demand." However, the `plugin.json` skills array is `["agent-teams", "worktree-support", "apply-feature-knowledge"]` -- missing `apply-decisions`. The code-review plugin declares 15 skills including `security`, `architecture`, etc. While the CLAUDE.md states "Universal Skill Installation: All skills from all plugins are always installed, regardless of plugin selection", this means the skill will be present at runtime. However, the `plugin.json` manifest should declare its dependencies for correctness and discoverability. The code-review plugin declares all its skill dependencies; the resolve plugin does not declare `apply-decisions` either, but that pattern predates the bug-analysis addition. Consistency with code-review is the better pattern.
- Fix: Add `"apply-decisions"` to the `skills` array in `plugins/devflow-bug-analysis/.claude-plugin/plugin.json`.

**Bug-analysis plugin.json missing focus-specific skills declared in agent frontmatter** - `plugins/devflow-bug-analysis/.claude-plugin/plugin.json:26-28`, `shared/agents/bug-analyzer.md:6-10`
**Confidence**: 80%
- Problem: The BugAnalyzer agent frontmatter declares 5 focus-specific skills: `devflow:security`, `devflow:reliability`, `devflow:regression`, `devflow:consistency`, `devflow:complexity`. None of these appear in the plugin.json skills array. The code-review plugin declares all its pattern skills (security, architecture, complexity, consistency, etc.). While Universal Skill Installation ensures they are present at runtime regardless, the manifest gap means the plugin's declared dependencies are incomplete -- a developer inspecting `plugin.json` would not see the full dependency surface.
- Fix: Add `"security"`, `"reliability"`, `"regression"`, `"consistency"`, and `"complexity"` to the skills array in the `plugin.json` manifest, matching the pattern used by `devflow-code-review`.

## Pre-existing Issues (Not Blocking)

No pre-existing architectural issues found at CRITICAL severity.

## Suggestions (Lower Confidence)

- **Resolve fallback scans 10 most recent directories but bug-analysis has no scan limit** - `plugins/devflow-bug-analysis/commands/bug-analysis.md` (Confidence: 70%) -- The resolve command (both `resolve.md` and `resolve:orch`) bounds the bug-analysis fallback scan to "10 most recent directories only." But the `/bug-analysis` command itself has no equivalent bound when listing directories in Step 2a (it checks `.last-analysis-head` but if that were corrupted, directory enumeration is unbounded). Low risk since branch-scoped directories are typically few, but asymmetric bounds between the two commands could cause confusion.

- **BugAnalyzer agent loaded with skills it cannot use per focus** - `shared/agents/bug-analyzer.md:6-10` (Confidence: 65%) -- The agent frontmatter loads `devflow:regression`, `devflow:consistency`, and `devflow:complexity` for all focus types (security, functional, integration, usability), but these pattern skills are most relevant to the functional focus. The usability and integration focuses have no documented use for regression or complexity patterns. This adds token overhead from skill loading without clear benefit for non-functional focuses. However, Claude may still benefit from these patterns for edge-case detection.

- **CodeQL cleanup race: results parsed after rm -rf in prose but code shows rm after parse** - `plugins/devflow-bug-analysis/commands/bug-analysis.md:121` (Confidence: 65%) -- The prose instruction says "Parse SARIF output... immediately after the codeql database analyze step and before the rm -rf cleanup" but the code block shows `rm -rf "${CODEQL_TMP}"` directly after capturing the exit status. An executor following the code block literally would delete before parsing. The prose clarification is correct but the code block order creates ambiguity. Markdown command files are instructions for LLM agents (not executed scripts), so the prose takes precedence, but the inconsistency could lead to misinterpretation.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 1 | 0 |
| Should Fix | 0 | 0 | 2 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Architecture Score**: 8/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The architecture of the bug-analysis plugin is well-designed and follows established Devflow patterns (applies ADR-004 -- complete separation from the Evaluator is correct; applies ADR-006 -- hybrid static+LLM architecture implemented faithfully; avoids PF-005 -- the Evaluator overlap is acknowledged and handled via the separation decision). The 7-phase command structure mirrors `/code-review` appropriately, the BugAnalyzer agent follows the Reviewer agent's contract pattern, and the `/resolve` fallback integration is cleanly layered. The blocking issue (severity-to-category conflation) is a semantic mapping concern that should be addressed but does not break the pipeline. The plugin.json manifest gaps are consistency issues -- the system works due to Universal Skill Installation, but the manifest should be complete for discoverability.
