# TypeScript Review Report

**Branch**: feat/v2-skills-overhaul -> main
**Date**: 2026-03-31_1217

## Issues in Your Changes (BLOCKING)

### HIGH

**Race condition in `migrateShadowOverrides` with many-to-one SHADOW_RENAMES** - `src/cli/commands/init.ts:68-90`
**Confidence**: 90%
- Problem: The refactored `migrateShadowOverrides` uses `Promise.all` to process all `SHADOW_RENAMES` entries concurrently. Three entries now map to the same target (`git-safety -> git`, `git-workflow -> git`, `github-patterns -> git`). When multiple old shadows exist simultaneously, the concurrent `shadowExists(newShadow)` checks race: two or more entries can see `newShadow` as non-existent and all attempt `fs.rename` to the same target, causing one to silently overwrite the other's rename result. The original sequential `for...of` loop was immune to this because each rename completed before the next check.
- Impact: Data loss -- a user's shadow override from `git-safety/` could be silently overwritten by `github-patterns/` (or vice versa) depending on timing. Only one shadow survives, and the user receives no warning.
- Fix: Either revert to sequential processing for entries sharing a target, or group SHADOW_RENAMES by target and process each group sequentially:
```typescript
// Option A: Revert to sequential (simplest, correctness-first)
export async function migrateShadowOverrides(devflowDir: string): Promise<{ migrated: number; warnings: string[] }> {
  const shadowsRoot = path.join(devflowDir, 'skills');
  let migrated = 0;
  const warnings: string[] = [];

  for (const [oldName, newName] of SHADOW_RENAMES) {
    const oldShadow = path.join(shadowsRoot, oldName);
    const newShadow = path.join(shadowsRoot, newName);

    if (!(await shadowExists(oldShadow))) continue;

    if (await shadowExists(newShadow)) {
      warnings.push(`Shadow '${oldName}' found alongside '${newName}' — keeping '${newName}', old shadow at ${oldShadow}`);
      continue;
    }

    await fs.rename(oldShadow, newShadow);
    migrated++;
  }

  return { migrated, warnings };
}
```

### MEDIUM

**Non-null assertions after truthy check in new test** - `tests/build.test.ts:55-56`
**Confidence**: 85%
- Problem: The new `skill frontmatter integrity` test uses `match![1]` (non-null assertion) on lines 55-56 after an `expect(...).toBeTruthy()` check on line 53. This same pattern was explicitly improved elsewhere in this PR (`skill-references.test.ts:895-899`) by replacing `expect(x).toBeTruthy()` + `x!` with `if (!x) expect.unreachable(...)` which enables TypeScript's control flow narrowing. The new test introduces the old anti-pattern that this PR itself is correcting elsewhere.
- Fix: Use the same `expect.unreachable` guard pattern used in the rest of this PR:
```typescript
it('every SKILL.md frontmatter name matches its directory name', async () => {
  const allSkills = getAllSkillNames();
  for (const skill of allSkills) {
    const skillMd = path.join(ROOT, 'shared', 'skills', skill, 'SKILL.md');
    const content = await fs.readFile(skillMd, 'utf-8');
    const match = content.match(/^name:\s*(.+)$/m);
    if (!match) {
      expect.unreachable(`shared/skills/${skill}/SKILL.md should have a name: field in frontmatter`);
    }
    expect(
      match[1].trim(),
      `shared/skills/${skill}/SKILL.md frontmatter name '${match[1].trim()}' does not match directory name '${skill}'`,
    ).toBe(skill);
  }
});
```

## Issues in Code You Touched (Should Fix)

_No issues found._

## Pre-existing Issues (Not Blocking)

_No issues found._

## Suggestions (Lower Confidence)

- **`shadowExists` helper could use a more descriptive name** - `src/cli/commands/init.ts:57` (Confidence: 60%) -- The function name `shadowExists` reads as "does a shadow exist" but it is actually a generic `pathExists` check. Naming it `pathExists` or `fileExists` would better convey its general purpose since it simply wraps `fs.access`.

- **`findStaleNameOccurrences` creates regex per old name inside loop** - `tests/skill-references.test.ts:103` (Confidence: 65%) -- The `new RegExp(...)` on line 103 is created once per `[oldName, pattern]` entry (outer loop), not per line (inner loop), so performance is fine. However, the comment says "Precompute ... per old name (not per line)" which is accurate but the regex is not escaped (`oldName` contains hyphens which are literal in character classes but harmless outside brackets). No real bug, just a defensive concern.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 1 | 0 |
| Should Fix | 0 | 0 | 0 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**TypeScript Score**: 8/10
**Recommendation**: CHANGES_REQUESTED

The core TypeScript changes are well-structured: proper type annotations, consistent use of `Promise.all` + `flatMap`/`reduce` for result aggregation, good use of tuple types (`[string, string][]`), and disciplined removal of `any`-adjacent `catch {}` blocks. The `expect.unreachable` narrowing pattern applied in `skill-references.test.ts` is a genuine improvement over non-null assertions.

The one blocking issue is the `Promise.all` race condition in `migrateShadowOverrides` where many-to-one renames (3 old git skills -> 1 `git` target) can silently overwrite each other. The sequential loop it replaced was correct-by-construction for this case. The inconsistent test pattern (`match!` vs `expect.unreachable`) is a minor consistency gap within this same PR.
