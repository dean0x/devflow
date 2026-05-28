# Reliability Review Report

**Branch**: feat-ambient-mode -> main
**Date**: 2026-05-25
**PR**: #227

## Issues in Your Changes (BLOCKING)

### HIGH

**Side-effect in pure-looking function: `addAmbientHook` writes files AND returns JSON** - `src/cli/commands/ambient.ts:126-127`
**Confidence**: 85%
- Problem: `addAmbientHook` performs two independent operations: (1) mutates settings JSON (pure transformation), (2) writes `COMMANDS_RULE_PATH` to the filesystem (side-effect). The early return on line 129 (`if (!changed) return settingsJson`) occurs AFTER the file write, meaning the rule file is always written even when the function signals "nothing changed" to the caller. This couples file I/O into a JSON transformation function and creates a confusing contract: callers checking `updated === settingsContent` to detect "nothing changed" (line 233) will get a false signal when the hook already exists but the rule file was just overwritten. The comment on line 234 acknowledges this oddity.
- Impact: No data loss, but the caller at line 233-236 prints "Ambient mode already enabled" and returns early without writing settings.json, which is correct for settings.json, but the rule file was silently written as a side-effect. This is a reliability smell — the function's contract is unclear about what "changed" means. If the rule file write fails (e.g., permission error), the exception propagates to the caller who did not expect file I/O from a "JSON transformation" function.
- Fix: Separate file writing from JSON transformation. Have `addAmbientHook` remain pure (return the modified JSON), and move the `fs.mkdir`/`fs.writeFile` calls to the caller (`ambientCommand.action` and `init.ts`) where the file I/O is explicit and can be error-handled appropriately.

```typescript
// ambient.ts — keep pure
export function addAmbientHook(settingsJson: string, devflowDir: string): string {
  // ... JSON transformation only, no fs calls ...
}

// Also export for callers:
export async function writeCommandsRule(): Promise<void> {
  await fs.mkdir(path.dirname(COMMANDS_RULE_PATH), { recursive: true });
  await fs.writeFile(COMMANDS_RULE_PATH, COMMANDS_RULE_CONTENT, 'utf-8');
}

// Caller in ambientCommand action:
if (options.enable) {
  const updated = addAmbientHook(settingsContent, devflowDir);
  await writeCommandsRule();  // explicit side-effect
  // ...
}
```

### MEDIUM

**`removeAmbientHook` swallows all `fs.unlink` errors without distinction** - `src/cli/commands/ambient.ts:148-152`
**Confidence**: 82%
- Problem: The empty `catch` block at line 150 swallows every error from `fs.unlink`, not just `ENOENT` (file not found). Permission errors (`EACCES`), filesystem errors, or path-too-long errors are silently eaten.
- Impact: If the rule file exists but cannot be deleted (e.g., read-only directory), the user receives "Ambient mode disabled" success message but the stale rule file remains active, silently injecting command awareness into every session despite the user believing ambient mode is off. This violates the "every operation must terminate AND report its outcome" principle.
- Fix: Only swallow `ENOENT`:

```typescript
try {
  await fs.unlink(COMMANDS_RULE_PATH);
} catch (err: unknown) {
  if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
    throw err;  // Re-throw permission/filesystem errors
  }
}
```

**Preamble hook has no guard against extremely large prompts in pattern matching** - `scripts/hooks/preamble:25`
**Confidence**: 80%
- Problem: The preamble hook performs three bash `[[ "$PROMPT" == *"..."* ]]` substring checks against the entire prompt content. While bash pattern matching is efficient, there is no upper bound on `$PROMPT` size. The old preamble had a `wc -w` word count check that provided an implicit lower bound (skipping short prompts). This PR removes that check but does not add an upper bound. For extremely large prompts (e.g., pasting an entire file), the string matching still runs.
- Impact: Low practical risk since bash glob matching is O(n) and the hook has a 5-second timeout (line 119 in ambient.ts). However, applying `applies ADR-001` (clean break philosophy), the old word-count filter was removed as part of simplification, which is consistent. The 5-second hook timeout provides an implicit bound. Severity is MEDIUM because the timeout is the only safety net.
- Fix: Consider adding a size guard if this hook ever processes truly large inputs:

```bash
# Skip prompts larger than 64KB — no real plan would be this long
if [ "${#PROMPT}" -gt 65536 ]; then exit 0; fi
```

## Issues in Code You Touched (Should Fix)

(none)

## Pre-existing Issues (Not Blocking)

(none)

## Suggestions (Lower Confidence)

- **Dual-source for commands rule content** - `src/cli/commands/ambient.ts:26-52` and `shared/rules/commands.md` (Confidence: 70%) — The `COMMANDS_RULE_CONTENT` string literal in ambient.ts is a copy of `shared/rules/commands.md`. If either is updated without the other, they will drift. Consider reading the rule from the shared source at build time or generating it from a single source of truth.

- **File write race between concurrent `devflow init` and `devflow ambient --enable`** - `src/cli/commands/ambient.ts:126-127` (Confidence: 65%) — Both `init.ts` and `ambientCommand` can write `COMMANDS_RULE_PATH` concurrently without locking. In practice, both write the same content so the outcome is correct, but the lack of coordination is worth noting as the codebase grows.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 2 | 0 |
| Should Fix | 0 | 0 | 0 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Reliability Score**: 7/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The PR is a significant simplification — removing ~1200 lines, 17 skill directories, and the entire 4-layer classification pipeline in favor of a focused plan-detection hook and a static rules file. From a reliability perspective, this is overwhelmingly positive: fewer moving parts, fewer hooks to fire per prompt, and a narrower failure surface. The deleted `session-start-classification` hook, `router` skill, 7 triage skills, and 7 guided skills were all additional runtime code paths with their own failure modes.

The conditions for approval are minor: (1) narrow the error swallowing in `removeAmbientHook` to `ENOENT` only, so permission errors surface instead of silently leaving stale rule files; (2) consider separating the file I/O side-effect from the JSON transformation in `addAmbientHook` for clearer error boundaries.
