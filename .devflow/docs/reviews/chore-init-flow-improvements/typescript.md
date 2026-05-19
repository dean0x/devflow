# TypeScript Review Report

**Branch**: chore/init-flow-improvements -> main
**Date**: 2026-03-22

## Issues in Your Changes (BLOCKING)

### CRITICAL

No critical issues found.

### HIGH

No high-severity issues found.

### MEDIUM

**Untyped `JSON.parse` result in `discoverProjectGitRoots`** - `src/cli/utils/post-install.ts:442`
**Confidence**: 82%
- Problem: `JSON.parse(line)` returns `any`, and the subsequent property access `entry.project` is unchecked beyond `typeof === 'string'`. The variable `entry` itself is implicitly `any`, which violates the TypeScript skill Iron Law ("Unknown over Any"). While the runtime guard (`typeof entry.project === 'string'`) prevents crashes, the `entry` variable silently carries `any` through the scope.
- Fix: Use `unknown` with a type guard or inline assertion:
  ```typescript
  const entry: unknown = JSON.parse(line);
  if (
    typeof entry === 'object' &&
    entry !== null &&
    'project' in entry &&
    typeof (entry as Record<string, unknown>).project === 'string'
  ) {
    projects.add((entry as Record<string, unknown>).project as string);
  }
  ```
  Alternatively, define a minimal type guard:
  ```typescript
  function hasProject(v: unknown): v is { project: string } {
    return typeof v === 'object' && v !== null && 'project' in v && typeof (v as any).project === 'string';
  }
  ```
  Note: This is a pre-existing pattern throughout `post-install.ts` (lines 35, 49, 74, 106, etc. all use untyped `JSON.parse`), so this is not unique to the new code. The existing codebase does not enforce typed parsing. The runtime guard at line 443 (`typeof entry.project === 'string'`) mitigates the practical risk.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Type assertions on `@clack/prompts` return values (4 occurrences)** - Confidence: 80%
- `src/cli/commands/init.ts:259` (`pluginSelection as string[]`)
- `src/cli/commands/init.ts:286` (`teamsChoice as boolean`)
- `src/cli/commands/init.ts:314` (`ambientChoice as boolean`)
- `src/cli/commands/init.ts:388` (`securityChoice as SecurityMode`)
- Problem: These are unsafe type assertions (`as T`) rather than type-narrowing guards. If `@clack/prompts` changes its return types or returns an unexpected value, these assertions will silently bypass TypeScript's type checking. This is a pre-existing pattern (all four existed on `main`), but the code was reorganized in this PR so it is within the touched scope.
- Fix: Not blocking because `@clack/prompts` returns symbol for cancellation (handled by `p.isCancel` checks above each assertion) and the asserted types match the `value` properties in the `options` arrays. The assertions are pragmatically safe given the library's API contract. Consider adding a comment noting why each assertion is safe.

## Pre-existing Issues (Not Blocking)

### MEDIUM

**Untyped `JSON.parse` throughout `post-install.ts` (10 occurrences)** - Confidence: 85%
- Lines: 35, 49, 74, 106, 197, 203, 317, 318, 351, 442
- Problem: All `JSON.parse` calls return `any` and the results are used without type narrowing. This is a codebase-wide pattern, not introduced by this PR.
- Fix: Introduce a typed parse helper (e.g., using Zod schemas or a `safeParse` wrapper) in a separate PR. Low priority given the defensive coding already present.

## Suggestions (Lower Confidence)

- **`pluginHints` could be derived from plugin definitions** - `src/cli/commands/init.ts:218-233` (Confidence: 65%) -- The hardcoded `Record<string, string>` mapping plugin names to hints will drift if plugins are added or renamed. Consider adding a `shortHint` property to `PluginDefinition` to keep hints co-located with their source of truth.

- **`discoveredProjects` used before spinner starts** - `src/cli/commands/init.ts:428` (Confidence: 62%) -- `discoverProjectGitRoots()` performs filesystem I/O (reads `history.jsonl`, checks `.git` existence for each project) during the prompt phase without any progress indicator. For users with many projects in history, this could appear to hang briefly. Consider wrapping it in a brief spinner or adding a log message.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 1 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 1 | 0 |

**TypeScript Score**: 8/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The changes are well-structured and TypeScript-safe. The compiler passes with zero errors under `strict: true`. No `any` types are explicitly declared in the changed files. The one blocking MEDIUM finding (untyped `JSON.parse` in the new `discoverProjectGitRoots` function) follows the same pattern as the rest of the codebase and has adequate runtime guards, making it a low-risk issue that can be addressed in a follow-up. The removal of `buildExtrasOptions` and `ExtraId` simplifies the type surface. New tests are thorough with 7 test cases covering edge cases for `discoverProjectGitRoots` and 2 for the `installClaudeignore` return type change.

Conditions for approval:
1. Acknowledge the untyped `JSON.parse` pattern in `discoverProjectGitRoots` -- acceptable if there is a plan to introduce typed parsing across `post-install.ts` in a future PR.
