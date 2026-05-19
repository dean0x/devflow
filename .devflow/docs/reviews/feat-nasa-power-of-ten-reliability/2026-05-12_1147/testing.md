# Testing Review Report

**Branch**: feat-nasa-power-of-ten-reliability -> main
**Date**: 2026-05-12_1147

## Issues in Your Changes (BLOCKING)

### CRITICAL

(none)

### HIGH

**Test suite regression: `review orchestration core reviewers exist in reviewer Focus Areas` fails** - `shared/skills/review:orch/SKILL.md:106-107`
**Confidence**: 95%
- Problem: The `review:orch/SKILL.md` line 106 still reads `**7 core reviewers**` but line 107 now lists 8 reviewers (security, architecture, performance, complexity, consistency, testing, regression, reliability). The existing test at `tests/skill-references.test.ts:943` parses this line, extracts the comma-separated list, and asserts `expect(coreReviewers.length).toBe(7)`. This test now fails because the count is 8 but the label says 7. This is a confirmed regression -- the test fails when run against the branch.
- Fix: Update the label in `shared/skills/review:orch/SKILL.md` from `**7 core reviewers**` to `**8 core reviewers**`, AND update the test assertion at `tests/skill-references.test.ts:943` from `.toBe(7)` to `.toBe(8)`. Alternatively, make the test derive the expected count from the label text (more resilient to future additions).

**Missing `reliability` row in `/code-review` command focus table** - `plugins/devflow-code-review/commands/code-review.md:134-155`
**Confidence**: 92%
- Problem: The `/code-review` command at line 134 says "Always run 7 core reviews" and its focus table (lines 136-155) does not include a `reliability` row. However, `review:orch` was updated to list reliability as a core reviewer, the reviewer agent's Focus Areas and Conditional Activation tables were updated, and the `devflow-code-review` plugin.json and plugins.ts both register the `reliability` skill. The `/code-review` command is the other entry point for code reviews (alongside `review:orch`) and is inconsistent with the rest of the PR. Without this row, the `/code-review` command will not spawn a reliability reviewer.
- Fix: Add `| reliability | ✓ | devflow:reliability |` to the focus table and update the text from "7 core reviews" to "8 core reviews":
```markdown
Spawn Reviewer agents **in a single message**. Always run 8 core reviews; conditionally add more based on changed file types:

| Focus | Always | Pattern Skill |
|-------|--------|---------------|
| security | ✓ | devflow:security |
| architecture | ✓ | devflow:architecture |
| performance | ✓ | devflow:performance |
| complexity | ✓ | devflow:complexity |
| consistency | ✓ | devflow:consistency |
| regression | ✓ | devflow:regression |
| testing | ✓ | devflow:testing |
| reliability | ✓ | devflow:reliability |
```

**No test coverage for the `reliability` rule being part of core-skills** - `tests/rules.test.ts:99-105`
**Confidence**: 85%
- Problem: The existing test `core-skills has security, engineering, quality rules` validates the three original core rules but does not assert that `reliability` is now also a core rule (it was added to `devflow-core-skills.rules` in this PR). While `build.test.ts` validates that the rule file exists in `shared/rules/` (via `getAllRuleNames()`), there is no test that confirms `reliability` belongs to the core-skills plugin specifically. A future refactor could accidentally move `reliability` to an optional plugin without any test catching it.
- Fix: Update the test name and add an assertion:
```typescript
it('core-skills has security, engineering, quality, reliability rules', () => {
    const coreSkills = DEVFLOW_PLUGINS.find(p => p.name === 'devflow-core-skills')!;
    const map = buildRulesMap([coreSkills]);
    expect(map.get('security')).toBe('devflow-core-skills');
    expect(map.get('engineering')).toBe('devflow-core-skills');
    expect(map.get('quality')).toBe('devflow-core-skills');
    expect(map.get('reliability')).toBe('devflow-core-skills');
});
```

### MEDIUM

**Stale count in `rules.test.ts` test name** - `tests/rules.test.ts:120-121`
**Confidence**: 82%
- Problem: The test `includes the three core rules` at line 120 only checks for `security`, `engineering`, and `quality`. With `reliability` added to `devflow-core-skills`, there are now four core rules but the test name says "three" and does not verify `reliability` is present in `getAllRuleNames()`.
- Fix: Update the test:
```typescript
it('includes the four core rules', () => {
    const names = getAllRuleNames();
    expect(names).toContain('security');
    expect(names).toContain('engineering');
    expect(names).toContain('quality');
    expect(names).toContain('reliability');
});
```

## Issues in Code You Touched (Should Fix)

### HIGH

**`code-review-teams.md` missing reliability in core perspectives** - `plugins/devflow-code-review/commands/code-review-teams.md:125-174`
**Confidence**: 88%
- Problem: The Teams variant of code-review lists 4 "Core perspectives (always)" -- Security, Architecture, Performance, Quality. The Quality reviewer loads `devflow:complexity`, `devflow:consistency`, `devflow:testing`, `devflow:regression` skill paths. The new `devflow:reliability` skill is not included in any core perspective. Since the teams variant combines multiple skills into the Quality reviewer, `reliability` should either be added to the Quality reviewer's skill paths or be given its own core perspective entry.
- Fix: Add `~/.claude/skills/devflow:reliability/SKILL.md` to the Quality reviewer's SKILL_PATHS in the teams table, or add a dedicated reliability perspective row.

### MEDIUM

**Stale count in `CLAUDE.md`: "57 skills" should be "58 skills"** - `CLAUDE.md:75`
**Confidence**: 90%
- Problem: `CLAUDE.md` line 75 says `# 57 skills (single source of truth)` but `shared/skills/` now contains 58 directories (reliability was added).
- Fix: Update the comment to `# 58 skills (single source of truth)`.

**Stale count in `CLAUDE.md`: "11 rules: 3 core + 8 language/UI"** - `CLAUDE.md:60`
**Confidence**: 90%
- Problem: `CLAUDE.md` line 60 says "Currently 11 rules: 3 core + 8 language/UI" but with the new `reliability` rule there are now 12 rules: 4 core + 8 language/UI.
- Fix: Update to "Currently 12 rules: 4 core + 8 language/UI". Also update the rules line reference from `core rules (security, engineering, quality from devflow-core-skills)` to include `reliability`.

**Stale count in `CLAUDE.md`: "# 11 rules"** - `CLAUDE.md:77`
**Confidence**: 90%
- Problem: `CLAUDE.md` line 77 says `# 11 rules (single source of truth; flat .md files)` but there are now 12.
- Fix: Update to `# 12 rules`.

**`skills-architecture.md` missing `reliability` skill entry** - `docs/reference/skills-architecture.md`
**Confidence**: 85%
- Problem: The reference documentation `docs/reference/skills-architecture.md` lists all specialized skills in its tables but does not include the new `reliability` skill. While not a test file, this documentation is validated by existing tests (Format 10) that check table entries against the canonical skill set. If a backtick-quoted `reliability` entry is added to the table, the test would validate it; currently the omission is invisible to tests because the test only validates that listed entries ARE canonical, not that all canonical entries ARE listed.
- Fix: Add a `| reliability |` row to the relevant tier table in `docs/reference/skills-architecture.md`.

## Pre-existing Issues (Not Blocking)

(none)

## Suggestions (Lower Confidence)

- **Missing completeness test for code-review command focus table vs review:orch core list** - `tests/skill-references.test.ts` (Confidence: 70%) -- There is a completeness test that verifies `reviewer.md Focus Areas` covers all skills in the `code-review plugin.json`, and another that checks `review:orch` core reviewers exist in reviewer Focus Areas. But there is no test ensuring the `/code-review` command's focus table is in sync with `review:orch`'s core reviewer list. This is the gap that allowed `reliability` to be added to `review:orch` but missed in `code-review.md`.

- **Consider making the "7 core reviewers" test derive count from the label rather than hardcoding** - `tests/skill-references.test.ts:943` (Confidence: 65%) -- The test currently parses `**7 core reviewers**` and asserts `.toBe(7)`. A more resilient approach would be to extract the number from the label text and compare it against the actual parsed list length, catching label-count mismatches automatically.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 3 | 1 | 0 |
| Should Fix | 0 | 1 | 4 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Testing Score**: 4/10
**Recommendation**: CHANGES_REQUESTED

The PR introduces a new reliability skill and rule but has incomplete integration across the review pipeline:
1. An existing test (`skill-references.test.ts:943`) fails on this branch due to the "7 core reviewers" label not being updated to 8.
2. The `/code-review` command's focus table was not updated to include `reliability`, creating a runtime behavior gap where the ambient `review:orch` path spawns a reliability reviewer but the `/code-review` command path does not.
3. Several documentation counts are stale (skills: 57->58, rules: 11->12, core rules: 3->4).
4. The test for core rules in `rules.test.ts` does not verify the new `reliability` rule membership.
