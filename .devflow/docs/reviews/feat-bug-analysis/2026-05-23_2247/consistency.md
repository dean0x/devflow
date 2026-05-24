# Consistency Review Report

**Branch**: feat/bug-analysis -> main
**Date**: 2026-05-23

## Issues in Your Changes (BLOCKING)

### HIGH

**Resolve exclusion list incomplete for bug-analysis directories** - `plugins/devflow-resolve/commands/resolve.md:112-114`, `shared/skills/resolve:orch/SKILL.md:65`
**Confidence**: 95%
- Problem: The resolve command's Phase 1 (Parse Issues) excludes only `review-summary.md` and `resolution-summary.md` when reading `{TARGET_DIR}/*.md`. After the new bug-analysis fallback (Step 0c-5b), `TARGET_DIR` can now point to a bug-analysis directory which also contains `bug-analysis-summary.md` (Synthesizer output) and `static-findings.md` (raw tool output). Neither file is excluded from issue extraction, so the Resolver will attempt to parse them as focus reports, producing garbage issues or parse failures.
- Fix: Update the exclusion list in both `resolve.md:112-114` and `resolve:orch/SKILL.md:65` to also exclude `bug-analysis-summary.md` and `static-findings.md`:
```markdown
**Exclude from issue extraction:**
- `review-summary.md` (synthesizer output, not individual findings)
- `resolution-summary.md` (if it exists from a previous partial run)
- `bug-analysis-summary.md` (bug-analysis synthesizer output)
- `static-findings.md` (raw static analysis tool output)
```

**Bug-analyzer output format differs from reviewer output format — breaks resolve parsing** - `shared/agents/bug-analyzer.md:127-182`
**Confidence**: 85%
- Problem: The bug-analyzer uses a flat `## Bugs Found` structure with severity subsections (`### CRITICAL`, `### HIGH`, etc.), a `## Acceptance Criteria Coverage` section, and a different Summary table format. The reviewer agent uses `## Issues in Your Changes (BLOCKING)`, `## Issues in Code You Touched (Should Fix)`, and `## Pre-existing Issues (Not Blocking)` with severity subsections within each category. The resolve command states (Step 0c-5b) that "Resolver agents parse the same per-focus `.md` format," but the formats are structurally different. The Resolver extracts `category` (blocking/should-fix/pre-existing) from each issue, which does not exist in the bug-analyzer output. This means resolve will either fail to parse bug-analysis reports or misclassify every finding.
- Fix: Either (a) align the bug-analyzer output format to match the reviewer's 3-category structure, or (b) document in the resolve command that bug-analysis reports use a different format and specify how the Resolver should map `## Bugs Found` entries to categories (e.g., treat all as "blocking"). Option (a) is more consistent with the existing pattern.

### MEDIUM

**Plugin skills list includes `agent-teams` without a Teams variant** - `plugins/devflow-bug-analysis/.claude-plugin/plugin.json:26`
**Confidence**: 82%
- Problem: The `devflow-bug-analysis` plugin declares `agent-teams` in its skills array, but has no `-teams.md` command variant. Every other plugin that includes `agent-teams` in skills has a corresponding Teams variant (`code-review-teams.md`, `implement-teams.md`, etc.), except `devflow-debug` which uses Agent Teams for its core competing-hypothesis mechanism. `devflow-self-review`, the closest analog (no Teams variant, analysis-only), does NOT include `agent-teams`. Including the skill without a Teams variant installs unnecessary skill content.
- Fix: Remove `agent-teams` from the skills array unless a `-teams.md` variant is planned:
```json
"skills": [
    "worktree-support",
    "apply-feature-knowledge"
]
```

## Issues in Code You Touched (Should Fix)

### HIGH

**Resolve command error messages inconsistent between Step 0c-5b and Phase 1** - `plugins/devflow-resolve/commands/resolve.md:81`, `plugins/devflow-resolve/commands/resolve.md:52`
**Confidence**: 83%
- Problem: Step 0c-5b says "No unresolved review or bug analysis found. Run `/code-review` or `/bug-analysis` first." but the pre-flight Step 0b still only says "suggest `/code-review` first" (line 52) without mentioning `/bug-analysis`. These error messages should be consistent throughout the command.
- Fix: Update line 52 to also suggest `/bug-analysis`:
```markdown
If no reviews found, suggest `/code-review` or `/bug-analysis` first.
```

### MEDIUM

**Bug-analysis command missing multi-worktree support pattern** - `plugins/devflow-bug-analysis/commands/bug-analysis.md:11-15`
**Confidence**: 80%
- Problem: The `/code-review` and `/resolve` commands both support `--path /path/to/worktree` and multi-worktree auto-discovery (Phase 0). The bug-analysis command has no worktree discovery or `--path` flag, despite listing `worktree-support` as a skill. While this can be considered a V1 simplification, it creates an inconsistency in the command interface pattern. Users who run `bug-analysis` in a multi-worktree setup will be surprised to find it only analyzes the current worktree.
- Fix: Add `--path` flag support to the usage section and note that multi-worktree discovery is deferred to a future version, or remove `worktree-support` from the plugin skills if the feature is not used.

## Pre-existing Issues (Not Blocking)

(none)

## Suggestions (Lower Confidence)

- **Bug-analysis not integrated into ambient mode router** - `shared/skills/router/SKILL.md` (Confidence: 70%) -- The router skill and ambient plugin do not reference `bug-analysis` as an intent target or include the `bug-analyzer` agent. If ambient mode should eventually route BUG_ANALYSIS intents, this integration is missing. May be intentional for V1.

- **CLAUDE.md Agent Teams count unchanged** - `CLAUDE.md:222` (Confidence: 65%) -- The Agent Teams line says "8 commands use Agent Teams" but bug-analysis includes `agent-teams` in skills. If bug-analysis should be counted (unlikely given no Teams variant), the count needs updating. More likely the skill should be removed (see MEDIUM finding above).

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 2 | 1 | 0 |
| Should Fix | 0 | 1 | 1 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Consistency Score**: 6/10
**Recommendation**: CHANGES_REQUESTED
