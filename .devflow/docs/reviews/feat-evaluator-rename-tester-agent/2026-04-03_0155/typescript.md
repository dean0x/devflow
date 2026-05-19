# TypeScript Review Report

**Branch**: feat/evaluator-rename-tester-agent -> main
**Date**: 2026-04-03_0155

## Issues in Your Changes (BLOCKING)

### CRITICAL

No critical issues found.

### HIGH

No high-severity issues found.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Variable shadowing: `agentsTarget` declared in two scopes** - `src/cli/utils/installer.ts:215`
**Confidence**: 82%
- Problem: `agentsTarget` is declared at line 196 inside the `for (const plugin of plugins)` loop body, and again at line 215 outside the loop. Both resolve to the same `path.join(claudeDir, 'agents', 'devflow')` value. While TypeScript allows this because they are in different block scopes, it creates a maintenance hazard: a future developer may rename one without realizing the other exists, or may incorrectly assume line 215 references the loop-scoped variable.
- Fix: Hoist `agentsTarget` before the loop and reuse it in both the loop body and the legacy cleanup block:
```typescript
// Before the for-loop (around line 167):
const agentsTarget = path.join(claudeDir, 'agents', 'devflow');

// Inside the for-loop (line 196): remove the declaration, just use agentsTarget
// After the for-loop (line 215): remove the declaration, just use agentsTarget
```

## Pre-existing Issues (Not Blocking)

No pre-existing TypeScript issues identified in reviewed files.

## Suggestions (Lower Confidence)

- **Legacy cleanup runs on partial installs even when agents dir was just wiped** - `src/cli/utils/installer.ts:214-220` (Confidence: 65%) -- The legacy agent cleanup block at lines 214-220 runs unconditionally after agent installation. On full installs, the entire `agents/devflow` directory was already removed at line 139-144 and rebuilt from scratch, making the legacy cleanup redundant. On partial installs the cleanup is useful. Consider gating with `if (isPartialInstall)` for clarity, though the current behavior is not harmful (just a no-op `fs.rm` with `{ force: true }`).

- **`LEGACY_PLUGIN_NAMES` typed as `Record<string, string>` without `as const`** - `src/cli/plugins.ts:201` (Confidence: 62%) -- The `LEGACY_PLUGIN_NAMES` map uses `Record<string, string>` which allows any string key lookup without type narrowing. A `satisfies` pattern with a const assertion would provide better compile-time guarantees for known legacy names, but the current typing is adequate for the lookup use case (`LEGACY_PLUGIN_NAMES[p] ?? p`).

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 0 | - |
| Should Fix | - | 0 | 1 | - |
| Pre-existing | - | - | 0 | 0 |

**TypeScript Score**: 9/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The TypeScript changes in this PR are well-structured. No `any` types, no unsafe type assertions, no non-null assertions introduced. The `LEGACY_PLUGIN_NAMES`, `LEGACY_AGENT_NAMES`, and `LEGACY_PLUGIN_NAMES` exports are properly typed. The `resolvePluginList` migration logic correctly maps legacy names before merging. Test coverage is solid with dedicated test cases for legacy plugin name remapping in both `init-logic.test.ts` and `manifest.test.ts`. The single condition for merge is addressing the variable shadowing in `installer.ts`.
