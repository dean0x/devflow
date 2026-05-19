# Complexity Review Report

**Branch**: feat/v2-skills-overhaul -> main
**Date**: 2026-03-30

## Issues in Your Changes (BLOCKING)

### HIGH

**Nested try/catch flow control in `migrateShadowOverrides`** - `src/cli/commands/init.ts:69-83`
**Confidence**: 85%
- Problem: The function uses nested `try { await fs.access() } catch {}` blocks (3 levels of nesting: for-loop > try > try) to determine file existence. The `catch` blocks carry semantic meaning (old shadow absent vs. new shadow absent) but are empty or use the catch pathway as the "success" branch, which inverts the reader's expectations. Cyclomatic complexity is moderate (~6 paths) but the nesting depth and inverted control flow reduce readability.
- Fix: Replace `fs.access` + try/catch with an explicit existence check helper that returns a boolean, flattening the control flow:
```typescript
async function exists(p: string): Promise<boolean> {
  try { await fs.access(p); return true; } catch { return false; }
}

export async function migrateShadowOverrides(devflowDir: string): Promise<{ migrated: number; warnings: string[] }> {
  const shadowsRoot = path.join(devflowDir, 'skills');
  let migrated = 0;
  const warnings: string[] = [];

  for (const [oldName, newName] of SHADOW_RENAMES) {
    const oldShadow = path.join(shadowsRoot, oldName);
    const newShadow = path.join(shadowsRoot, newName);

    if (!await exists(oldShadow)) continue;
    if (await exists(newShadow)) {
      warnings.push(`Shadow '${oldName}' found alongside '${newName}' -- keeping '${newName}', old shadow at ${oldShadow}`);
      continue;
    }
    await fs.rename(oldShadow, newShadow);
    migrated++;
  }

  return { migrated, warnings };
}
```

### MEDIUM

**`OLD_SKILL_NAMES` regex array with per-line triple-nested loop** - `tests/skill-references.test.ts:677-730`
**Confidence**: 82%
- Problem: The "no old V2-renamed skill names" test case iterates files x old-names x lines (triple nested loop), applies 8 allowlist regex checks per line, and constructs a new `RegExp` on each match hit. The cyclomatic complexity of the inner body is ~8 (file filter, basename allowlist, allowlist patterns, regex test, devflow-prefix re-check, unreachable assertion). While acceptable for a test utility, this is the most complex single test case in the PR and could become brittle if the allowlist grows.
- Fix: Consider extracting the line-scanning logic into a named helper function (e.g., `findStaleNameOccurrences(content, fileName)`) that returns `{file, line, name}[]` violations, then assert on the result. This separates the scanning concern from the assertion concern and makes the triple loop easier to reason about.

## Issues in Code You Touched (Should Fix)

_No issues found._

## Pre-existing Issues (Not Blocking)

### MEDIUM

**PF-002: Init command action handler monolith** - `src/cli/commands/init.ts`
**Confidence**: 90%
- Problem: The `migrateShadowOverrides` function was correctly extracted as a testable pure function (good pattern), but it was added to `init.ts` which is already flagged as an ~877-line monolith in PF-002. The pitfall's recommended resolution (extract into `collectInitChoices()`, `executeInstallation()`, `printSummary()`) has not been applied. The new function is well-structured on its own but adds to the file's overall length.
- This is informational only -- the monolith is a pre-existing architectural issue.

## Suggestions (Lower Confidence)

- **950-line test file with 11 describe blocks and 10+ utility functions** - `tests/skill-references.test.ts` (Confidence: 65%) -- The file is large but well-organized with clear section separators and focused utility functions (all under 15 lines). Each describe block tests a distinct "format" of skill reference. The file length is driven by thoroughness rather than poor structure. Consider splitting into 2-3 files only if the file continues to grow significantly.

- **LEGACY_SKILL_NAMES list growing unbounded** - `src/cli/plugins.ts:288-303` (Confidence: 60%) -- The legacy names list grew by 14 entries (7 prefixed old names + 7 bare new names). Each future rename cycle will add more entries that are never pruned. This is not a complexity issue today but could become one over multiple major version cycles.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 1 | 0 |
| Should Fix | 0 | 0 | 0 | 0 |
| Pre-existing | 0 | 0 | 1 | 0 |

**Complexity Score**: 8/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The PR is predominantly a large-scale rename operation across skill files, plugin manifests, agent frontmatter, and tests. The structural complexity of the changes is low -- most diffs are mechanical string replacements. The two new code additions (`migrateShadowOverrides` and `tests/skill-references.test.ts`) are well-factored with clear single-responsibility boundaries. The nested try/catch in `migrateShadowOverrides` is the only meaningful complexity concern and should be flattened before merge. The new 950-line test file is large but justified by its comprehensive coverage of 11 distinct reference formats, and individual functions remain short and focused. No functions exceed 30 lines. No cyclomatic complexity exceeds 10. No nesting exceeds 4 levels (except the flagged try/catch pattern).
