# Consistency Review Report

**Branch**: feat-nasa-power-of-ten-reliability -> main
**Date**: 2026-05-12_1147

## Issues in Your Changes (BLOCKING)

### HIGH

**Core reviewer count label says "7" but list has 8 items** - `shared/skills/review:orch/SKILL.md:106`
**Confidence**: 95%
- Problem: Line 106 reads `**7 core reviewers** (always):` but the list on line 107 now contains 8 entries (security, architecture, performance, complexity, consistency, testing, regression, reliability). The label is stale after adding reliability.
- Fix: Change "7 core reviewers" to "8 core reviewers":
```markdown
**8 core reviewers** (always):
- security, architecture, performance, complexity, consistency, testing, regression, reliability
```

**Insertion position of `reliability` differs between plugins.ts and plugin.json** - `src/cli/plugins.ts:156`, `plugins/devflow-ambient/.claude-plugin/plugin.json:59`
**Confidence**: 90%
- Problem: In `plugins.ts` (the authoritative source), `reliability` appears between `consistency` and `regression`. In `devflow-ambient/plugin.json`, `reliability` appears between `regression` and `testing`. The two representations of the same list have different insertion points. Build distributes from `plugins.ts`, so `plugin.json` will be overwritten — but the committed `plugin.json` snapshot is out of sync, indicating the build was not run after the change to `plugins.ts`.
- Fix: Run `npm run build` to regenerate `plugin.json` files from the authoritative `plugins.ts`. Or align the `plugin.json` to match `plugins.ts` ordering:
```json
    "consistency",
    "reliability",
    "regression",
    "testing",
```

### MEDIUM

**Reliability row appended to end of Focus Areas table instead of with core reviewers** - `shared/agents/reviewer.md:51`
**Confidence**: 85%
- Problem: The Focus Areas table groups core reviewers (security through testing, rows 33-39) then conditional reviewers (typescript through rust, rows 40-50). The new `reliability` row was appended after `rust` (line 51), placing a core/always-on reviewer in the conditional section. This violates the table's implicit grouping convention.
- Fix: Move the `reliability` row to sit with the other core reviewers (e.g., after `regression` on line 38):
```markdown
| `regression` | `devflow:regression` |
| `reliability` | `devflow:reliability` |
| `testing` | `devflow:testing` |
```

## Issues in Code You Touched (Should Fix)

### HIGH

**Count mismatches in CLAUDE.md not updated (3 occurrences)** - `CLAUDE.md:60`, `CLAUDE.md:75`, `CLAUDE.md:183`
**Confidence**: 92%
- `CLAUDE.md:183`: Says "7-11 Reviewer agents" — should be "8-12" now that reliability is the 8th core reviewer.
- `CLAUDE.md:60`: Says "Currently 11 rules: 3 core + 8 language/UI" — should be "12 rules: 4 core + 8 language/UI" after adding the reliability rule.
- `CLAUDE.md:75`: Says "# 57 skills" — should be "# 58 skills" after adding the reliability skill.
- Problem: When adding a new core reviewer, rule, and skill, the project's central documentation (CLAUDE.md) was not updated to reflect the new counts. This creates drift between the documented architecture and the actual codebase.
- Fix: Update the three count references:
```
Line 60: ... Currently 12 rules: 4 core + 8 language/UI. ...
Line 75: ├── shared/skills/          # 58 skills (single source of truth)
Line 77: ├── shared/rules/           # 12 rules (single source of truth; flat .md files)
Line 183: - `/code-review` — 8-12 Reviewer agents + Git + Synthesizer; ...
```

**`/code-review` command not updated with reliability reviewer** - `plugins/devflow-code-review/commands/code-review.md:134`
**Confidence**: 92%
- Problem: The `/code-review` command says "Always run 7 core reviews" (line 134), its table (lines 136-155) does not include a `reliability` row, and the multi-worktree note says "7-18 reviewers" (line 173). The `review:orch` skill was updated but the equivalent `/code-review` command was not.
- Fix: Add `reliability` to the table as a core reviewer and update the counts:
```markdown
Spawn Reviewer agents **in a single message**. Always run 8 core reviews; conditionally add more based on changed file types:

| Focus | Always | Pattern Skill |
|-------|--------|---------------|
| security | ✓ | devflow:security |
| ...existing rows... |
| testing | ✓ | devflow:testing |
| reliability | ✓ | devflow:reliability |
```
And update line 173: "spawning 8-19 reviewers per worktree"

## Pre-existing Issues (Not Blocking)

No pre-existing issues found.

## Suggestions (Lower Confidence)

- **`/code-review-teams` does not reference reliability perspective** - `plugins/devflow-code-review/commands/code-review-teams.md:121` (Confidence: 65%) — The teams variant groups reviewers into 4 broad perspectives (Security, Architecture, Performance, Quality) rather than individual focus areas, so reliability coverage may be implicit under Quality. However, the new reliability patterns (bounded iteration, assertion density) are distinct enough that they may warrant explicit mention. Evaluate whether the Quality perspective's scope description should be expanded.

- **CLAUDE.md core rules parenthetical does not list `reliability`** - `CLAUDE.md:60` (Confidence: 70%) — The sentence says "core rules (`security`, `engineering`, `quality` from `devflow-core-skills`)" — after adding `reliability` to core-skills, this parenthetical list is incomplete. Consider adding `reliability` to the parenthetical.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 2 | 1 | 0 |
| Should Fix | 0 | 2 | 0 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Consistency Score**: 5/10
**Recommendation**: CHANGES_REQUESTED

The new reliability skill, rule, and reviewer integration follow existing structural patterns well (frontmatter format, reference directory layout, rule line counts, bullet counts). However, the change was not fully propagated across all documentation and configuration surfaces. Five separate locations still reference the old "7 core reviewers" count or omit reliability from their lists. The `plugin.json` ordering mismatch with `plugins.ts` suggests the build was not re-run after the final edit. These are all straightforward fixes — no architectural issues.
