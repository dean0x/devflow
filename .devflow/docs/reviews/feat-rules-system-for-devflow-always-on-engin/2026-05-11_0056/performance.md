# Performance Review Report

**Branch**: feat/rules-system-for-devflow-always-on-engin -> main
**Date**: 2026-05-11

## Issues in Your Changes (BLOCKING)

### HIGH

**Sequential file I/O in rules install loop (rules --enable)** - `src/cli/commands/rules.ts:73-86`
**Confidence**: 85%
- Problem: The `--enable` path iterates rules sequentially with `for...of` + `await` inside the loop body. Each rule performs up to 3 sequential async operations: `isShadowed()` (fs.access), `fs.access(ruleSource)`, and `fs.copyFile()`. With 11 rules, this is 11 sequential iterations where each iteration could run independently -- classic sequential-when-parallel-possible anti-pattern [5].
- Impact: ~11 sequential I/O round-trips instead of parallel. At ~100us per SSD I/O, this adds ~1ms total -- negligible in absolute terms for a CLI command. However, it deviates from the parallel pattern already used elsewhere in the same file (e.g., `Promise.all` on lines 116 and 130 for `formatRuleRow`).
- Fix: Use `Promise.all` with `map` to parallelize independent file copy operations, matching the pattern already used in the `--status` and `--list` paths of the same file:
```typescript
const pluginsDir = path.join(path.resolve(__dirname, '../..'), 'plugins');

await Promise.all([...rulesMap].map(async ([ruleName, ownerPlugin]) => {
  const shadowFile = path.join(devflowDir, 'rules', `${ruleName}.md`);
  const targetFile = path.join(rulesTarget, `${ruleName}.md`);

  if (await isShadowed(devflowDir, ruleName)) {
    await fs.copyFile(shadowFile, targetFile);
  } else {
    const ruleSource = path.join(pluginsDir, ownerPlugin, 'rules', `${ruleName}.md`);
    try {
      await fs.access(ruleSource);
      await fs.copyFile(ruleSource, targetFile);
    } catch { /* skip missing */ }
  }
}));
```

**Sequential file I/O in installer rules section** - `src/cli/utils/installer.ts:265-283`
**Confidence**: 82%
- Problem: Same sequential `for...of` + `await` pattern in `installViaFileCopy`. Each rule iteration does `fs.access` (shadow check) then `fs.access` + `fs.copyFile` sequentially. This matches the pre-existing pattern used for skills (lines 229-256) and agents (lines 200-215), which are also sequential.
- Impact: Consistent with existing codebase patterns for skills and agents, so the inconsistency risk is low. However, with rules being flat file copies (no recursive directory copy like skills), this is the easiest place to parallelize.
- Fix: Same `Promise.all` pattern as above. Note: this is a "should match existing patterns" situation -- if the existing skill/agent loops are intentionally sequential, this should stay sequential too for consistency. If performance is a goal, all three loops (skills, agents, rules) should be parallelized together.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Module-level eager computation of allRulesMap** - `src/cli/commands/rules.ts:33`
**Confidence**: 83%
- Problem: `const allRulesMap = buildRulesMap(DEVFLOW_PLUGINS)` executes at module import time, not on-demand. When `rules.ts` is imported by `cli.ts` (line 18), `buildRulesMap` runs even when the user invokes a completely different command (e.g., `devflow list`, `devflow ambient --status`). The computation is pure in-memory iteration (O(n) over ~20 plugins), so the cost is trivial.
- Impact: Negligible for current 20 plugins with ~11 rules total. The `DEVFLOW_PLUGINS` array is a static constant, so this is fast. But it sets a precedent -- if rules grew to hundreds, this would become measurable. More importantly, it's a design concern: module-level side effects make lazy loading less effective if the CLI ever moves to dynamic imports for faster startup.
- Fix: Move inside the functions that use it, or use a lazy singleton pattern:
```typescript
let _allRulesMap: Map<string, string> | null = null;
function getAllRulesMap(): Map<string, string> {
  if (!_allRulesMap) _allRulesMap = buildRulesMap(DEVFLOW_PLUGINS);
  return _allRulesMap;
}
```

**O(n*m) lookup in rules --enable plugin filtering** - `src/cli/commands/rules.ts:67`
**Confidence**: 80%
- Problem: `DEVFLOW_PLUGINS.filter(pl => manifest.plugins.includes(pl.name))` -- `includes` on an array is O(m) per iteration, making the filter O(n*m) where n=20 plugins and m=installed plugins (~10). Total: ~200 comparisons.
- Impact: Completely negligible for current scale (20 plugins). This is a micro-optimization candidate and not actionable at current scale. Noting for completeness.
- Fix: Convert `manifest.plugins` to a Set before filtering:
```typescript
const installedSet = new Set(manifest.plugins);
const installedPlugins = DEVFLOW_PLUGINS.filter(pl => installedSet.has(pl.name));
```

## Pre-existing Issues (Not Blocking)

(No CRITICAL pre-existing performance issues found in the touched files.)

## Suggestions (Lower Confidence)

- **Build script uses sync I/O** - `scripts/build-plugins.ts:80-88` (Confidence: 65%) -- `getAvailableRules()` uses `fs.readdirSync` and `fs.existsSync`. The entire build script uses sync I/O consistently (inherited pattern from the existing `getAvailableSkills`/`getAvailableAgents`). This is acceptable for a build script that runs once during `npm run build`, not in the hot path.

- **Sequential legacy rule cleanup in init** - `src/cli/commands/init.ts:971-978` (Confidence: 60%) -- The `LEGACY_RULE_NAMES` cleanup loop is sequential with `await fs.rm` per rule. Currently the array is empty, so no actual I/O occurs. When rules are renamed in the future, this could be parallelized -- but it matches the existing pattern for `LEGACY_SKILL_NAMES` and `LEGACY_COMMAND_NAMES` cleanup.

- **Redundant fs.access before fs.copyFile in installer** - `src/cli/utils/installer.ts:279-281` (Confidence: 70%) -- The `fs.access(ruleSource)` check before `fs.copyFile` adds an extra I/O call. `fs.copyFile` will throw `ENOENT` if the source is missing, so the access check is redundant -- the `catch { continue }` would handle both cases. However, this follows the same defensive pattern used in `rules.ts:82-84`, so it is intentionally consistent. applies ADR-001 -- no migration compat overhead added.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 2 | 0 | - |
| Should Fix | - | 0 | 2 | - |
| Pre-existing | - | - | 0 | 0 |

**Performance Score**: 8/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The rules system adds minimal performance overhead. All new I/O paths handle ~11 small markdown files (10-15 lines each), so the absolute impact is sub-millisecond even with sequential patterns. The two HIGH findings are about consistency with the codebase's own use of `Promise.all` in the same file, not about measurable latency. The build script correctly uses sync I/O for its one-shot execution context. No memory leaks, no unbounded caches, no blocking I/O in hot paths. The code follows existing patterns from the skills and agents installer -- the sequential I/O is inherited, not introduced. avoids PF-001 -- no unnecessary migration or compat code was added.
