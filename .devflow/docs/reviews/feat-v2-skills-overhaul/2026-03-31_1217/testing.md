# Testing Review Report

**Branch**: feat/v2-skills-overhaul -> main
**Date**: 2026-03-31

## Issues in Your Changes (BLOCKING)

### CRITICAL

(none)

### HIGH

**Missing test coverage for many-to-one SHADOW_RENAMES race condition** - `src/cli/commands/init.ts:68-90`
**Confidence**: 90%
- Problem: `migrateShadowOverrides` was refactored from sequential `for...of` to `Promise.all`, but `SHADOW_RENAMES` now contains three entries that map to the same target: `['git-safety', 'git']`, `['git-workflow', 'git']`, `['github-patterns', 'git']`. When two or more of these old shadow directories exist simultaneously, the concurrent `Promise.all` creates a TOCTOU race: all three check `shadowExists(newShadow)` for `git` at roughly the same time, all get `false`, and all attempt `fs.rename(oldShadow, newShadow)`. The second and third renames will either fail (ENOTEMPTY) or silently overwrite the first rename's result, depending on the OS. The existing test "migrates multiple shadows in one pass" only covers entries with distinct targets (`core-patterns -> software-design`, `security-patterns -> security`, `frontend-design -> ui-design`), so it does not catch this.
- Fix: Add a test that creates two or more of `git-safety`, `git-workflow`, `github-patterns` shadow directories and calls `migrateShadowOverrides`. Assert that exactly one is migrated and the others produce warnings (or the function handles the conflict). The underlying production code likely also needs a fix — either serialize entries that share a target, or detect collisions after `Promise.all` resolves. Example test:
```typescript
it('handles many-to-one renames (git-safety + git-workflow both → git)', async () => {
  for (const oldName of ['git-safety', 'git-workflow']) {
    const dir = path.join(devflowDir, 'skills', oldName);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'SKILL.md'), `# ${oldName}`);
  }

  const result = await migrateShadowOverrides(devflowDir);

  // First rename succeeds, second should detect conflict and warn
  expect(result.migrated).toBe(1);
  expect(result.warnings).toHaveLength(1);
  // Target must exist
  await expect(fs.access(path.join(devflowDir, 'skills', 'git'))).resolves.toBeUndefined();
});
```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Non-null assertion `match![1]` in new `build.test.ts` frontmatter test** - `tests/build.test.ts:55-56`
**Confidence**: 82%
- Problem: Line 55-56 use `match![1].trim()` twice after a `toBeTruthy()` assertion. If `match` is `null` (assertion fails but execution continues in some test runners or future refactors), the non-null assertion will throw a cryptic `TypeError` instead of the descriptive test failure message. The same PR improved `skill-references.test.ts` by replacing this exact pattern with `if (!match) expect.unreachable(...)` for proper type narrowing.
- Fix: Apply the same `expect.unreachable` pattern used in the `skill-references.test.ts` changes:
```typescript
const match = content.match(/^name:\s*(.+)$/m);
if (!match) {
  expect.unreachable(`shared/skills/${skill}/SKILL.md should have a name: field in frontmatter`);
}
expect(
  match[1].trim(),
  `shared/skills/${skill}/SKILL.md frontmatter name '${match[1].trim()}' does not match directory name '${skill}'`,
).toBe(skill);
```

## Pre-existing Issues (Not Blocking)

### MEDIUM

**`findStaleNameOccurrences` hardcodes `tests/` prefix in violation messages** - `tests/skill-references.test.ts:113`
**Confidence**: 80%
- Problem: The extracted helper function hardcodes `tests/` as a prefix in the violation message string. If this function is ever reused for scanning non-test files (e.g., `shared/` or `plugins/`), the paths in violations will be misleading. The function's signature takes a generic `relFile` parameter, suggesting it was designed for reuse, but the message format couples it to the `tests/` directory.
- Fix: Remove the hardcoded `tests/` prefix from the violation string and let the caller provide the full relative path, or pass a `baseDir` label parameter.

## Suggestions (Lower Confidence)

- **No test for `runClaudeWithRetry` error rethrow behavior** - `tests/integration/helpers.ts:98-101` (Confidence: 65%) -- The new behavior (rethrow on final attempt) is untested. A unit test exercising the final-attempt rethrow vs. earlier-attempt swallow would validate the change, but this is an integration helper so the omission is not critical.

- **SHADOW_RENAMES consistency test does not validate uniqueness of old names** - `tests/plugins.test.ts:231-253` (Confidence: 70%) -- The new `SHADOW_RENAMES consistency` tests verify old names appear in `LEGACY_SKILL_NAMES` and new names are valid skills, but do not check for duplicate old-name entries. Since `git-safety`, `git-workflow`, and `github-patterns` all map to `git`, it would be valuable to assert that either (a) old names are unique, or (b) many-to-one mappings are explicitly handled by the migration logic.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 0 | - |
| Should Fix | - | 0 | 1 | - |
| Pre-existing | - | - | 1 | 0 |

**Testing Score**: 7/10
**Recommendation**: CHANGES_REQUESTED

The test changes are well-structured overall: good use of `expect.unreachable` for type narrowing, clean extraction of `findStaleNameOccurrences` into a helper, and strong new consistency tests for `SHADOW_RENAMES`/`LEGACY_SKILL_NAMES` alignment. The blocking issue is that the `migrateShadowOverrides` refactoring to `Promise.all` introduces a race condition for many-to-one rename entries (`git-safety`, `git-workflow`, `github-patterns` all targeting `git`), and no test covers this scenario. This is both a missing test and an underlying production bug in `init.ts`.
