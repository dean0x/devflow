# Security Review Report

**Branch**: feat/v2-skills-overhaul -> main
**Date**: 2026-03-31

## Issues in Your Changes (BLOCKING)

### CRITICAL

(none)

### HIGH

**Race condition in parallel shadow migration -- multiple old names target same destination** - `src/cli/commands/init.ts:68-90`
**Confidence**: 85%
- Problem: `migrateShadowOverrides` was refactored from sequential `for...of` to parallel `Promise.all`. Three entries in `SHADOW_RENAMES` map different old names (`git-safety`, `git-workflow`, `github-patterns`) to the same new name (`git`). When run in parallel, all three check `shadowExists(newShadow)` concurrently -- if none of them sees the target yet, multiple `fs.rename` calls race to create the same destination directory. On most filesystems the last rename wins, silently overwriting whichever shadow was renamed first. This means a user who had shadow overrides for both `git-safety` and `git-workflow` could lose the content of one without any warning.
- Fix: Either revert to sequential iteration for entries sharing the same `newName`, or group by `newName` and process each group sequentially (first-one-wins, warn on rest):

```typescript
// Group SHADOW_RENAMES by newName, process each group sequentially
const byTarget = new Map<string, [string, string][]>();
for (const entry of SHADOW_RENAMES) {
  const group = byTarget.get(entry[1]) ?? [];
  group.push(entry);
  byTarget.set(entry[1], group);
}

const results: { migrated: number; warning: string | null }[] = [];
// Groups with different targets can run in parallel
await Promise.all(
  [...byTarget.values()].map(async (group) => {
    // Within a group (same target), process sequentially
    for (const [oldName, newName] of group) {
      const oldShadow = path.join(shadowsRoot, oldName);
      const newShadow = path.join(shadowsRoot, newName);
      if (!(await shadowExists(oldShadow))) {
        results.push({ migrated: 0, warning: null });
        continue;
      }
      if (await shadowExists(newShadow)) {
        results.push({ migrated: 0, warning: `Shadow '${oldName}' found alongside '${newName}' -- keeping '${newName}', old shadow at ${oldShadow}` });
        continue;
      }
      await fs.rename(oldShadow, newShadow);
      results.push({ migrated: 1, warning: null });
    }
  }),
);
```

## Issues in Code You Touched (Should Fix)

(none)

## Pre-existing Issues (Not Blocking)

(none)

## Suggestions (Lower Confidence)

- **LEGACY_SKILL_NAMES contains bare generic names like `git`, `database`, `security`** - `src/cli/plugins.ts:297-310` (Confidence: 65%) -- These bare names in the legacy cleanup list could unintentionally delete user-created skills with common names if the uninstall logic ever operates on non-prefixed paths. Low risk since the installer uses `devflow:` prefixed install targets, but the bare names have no namespace protection and could collide in edge cases.

- **Shadow migration does not validate directory content before rename** - `src/cli/commands/init.ts:87` (Confidence: 60%) -- `fs.rename` on a directory that is not a valid skill shadow (e.g., an unrelated directory the user placed in `~/.devflow/skills/`) would silently move it. A lightweight check (e.g., verifying a `SKILL.md` exists inside) could prevent accidental data relocation.

- **Hardcoded example token in violation documentation** - `shared/skills/git/references/github-api.md` (new file, line with `ghp_xxxxxxxxxxxx`) (Confidence: 70%) -- While this is clearly a placeholder in documentation (all x's), some secret scanners flag patterns like `ghp_` followed by alphanumeric characters. Consider using a more obviously fake token like `ghp_EXAMPLE_NOT_REAL_TOKEN` to avoid scanner false positives in downstream repos that consume these skill files.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 0 | - |
| Should Fix | - | 0 | 0 | - |
| Pre-existing | - | - | 0 | 0 |

**Security Score**: 8/10
**Recommendation**: CHANGES_REQUESTED

The PR is a largely mechanical rename/consolidation of skills (removing `-patterns` suffixes, merging 3 git-related skills into one). No new external inputs, no new auth logic, no new network calls, and no secrets are introduced. The single blocking finding is a race condition in the parallelized shadow migration function where three old skill names (`git-safety`, `git-workflow`, `github-patterns`) all target the same new name (`git`). Running their existence checks and renames concurrently creates a TOCTOU window that can silently lose user shadow override content. The fix is straightforward: serialize operations within groups that share a target name.
