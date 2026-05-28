# TypeScript Review Report

**Branch**: feat-ambient-mode -> main
**Date**: 2026-05-25

## Issues in Your Changes (BLOCKING)

### HIGH

**`removeAmbientHook` silently drops stale classification hook cleanup when no ambient prompt hook exists** - `src/cli/commands/ambient.ts:141-155`
**Confidence**: 92%
- Problem: `filterHookEntries(settings, 'SessionStart', isClassification)` on line 145 mutates the `settings` object by removing stale classification hooks. However, when `removedPrompt` is `false` (line 154), the function returns the original `settingsJson` string rather than the serialized `settings` — discarding the classification cleanup. This affects upgrading users who disabled ambient mode before this change but still have the stale `session-start-classification` hook registered.
- Fix: Track the classification removal result and include it in the return condition:
```typescript
export async function removeAmbientHook(settingsJson: string): Promise<string> {
  const settings: Settings = JSON.parse(settingsJson);
  const removedPrompt = filterHookEntries(settings, 'UserPromptSubmit', isAmbient);
  const removedClassification = filterHookEntries(settings, 'SessionStart', isClassification);

  try {
    await fs.unlink(COMMANDS_RULE_PATH);
  } catch {
    // File may not exist — not an error
  }

  if (!removedPrompt && !removedClassification) return settingsJson;
  return JSON.stringify(settings, null, 2) + '\n';
}
```
Add a test case: settings with only a stale classification hook and no ambient UserPromptSubmit hook. Verify the classification hook is removed in the output.

## Issues in Code You Touched (Should Fix)

(none)

## Pre-existing Issues (Not Blocking)

(none)

## Suggestions (Lower Confidence)

- **`addAmbientHook` performs filesystem I/O (write rule file) as a side effect inside a function that also returns a JSON string** - `src/cli/commands/ambient.ts:125-127` (Confidence: 65%) — Mixing JSON transformation with filesystem writes makes the function harder to test in isolation (tests must mock `fs` or accept real writes). The idempotency comment on line 234 of `ambientCommand` acknowledges this coupling. Consider separating rule file management from settings JSON mutation if this grows further.

- **14 agents still declared in `devflow-ambient` plugin despite ambient mode now being only plan detection + command awareness** - `src/cli/plugins.ts:149` (Confidence: 62%) — The agents list (coder, validator, simplifier, scrutinizer, evaluator, tester, skimmer, reviewer, git, synthesizer, resolver, designer, knowledge, researcher) was carried over from the old classification-based ambient system. If ambient mode now only detects plans and writes a rule file, it may not need to declare all these agents (they are still needed by the slash commands that execute plans, but those are separate plugins). This is architectural rather than a TypeScript issue.

- **`COMMANDS_RULE_CONTENT` as a template literal constant may drift from `shared/rules/commands.md`** - `src/cli/commands/ambient.ts:26-52` (Confidence: 70%) — There are now two sources for the commands rule: the template literal in `ambient.ts` (written at enable-time) and `shared/rules/commands.md` (distributed at build-time). The JSDoc `D1` comment marks the intent, but there is no structural guard preventing drift between them.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 0 | - |
| Should Fix | - | 0 | 0 | - |
| Pre-existing | - | - | 0 | 0 |

**TypeScript Score**: 8/10
**Recommendation**: CHANGES_REQUESTED

The PR is a well-executed simplification. The sync-to-async migration of `addAmbientHook`/`removeAmbientHook` is clean, type signatures are correct (`Promise<string>` return types, `await` at all call sites), and the removed code (router, triage, guided skills, classification helpers) is thorough. No `any` types, no unsafe assertions, no missing null checks in new code. Tests were updated comprehensively to match the new async signatures.

The single blocking issue (`removeAmbientHook` silently discarding stale classification hook cleanup) is a real bug that affects the upgrade path for users who have the old classification hook but no ambient prompt hook. The fix is a one-line change to the return condition.
