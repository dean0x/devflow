# Security Review Report

**Branch**: feat/ambient-mode -> main
**Date**: 2026-05-25

## Issues in Your Changes (BLOCKING)

### CRITICAL

(none)

### HIGH

(none)

## Issues in Code You Touched (Should Fix)

(none)

## Pre-existing Issues (Not Blocking)

### MEDIUM

**Broad catch swallows all errors in settings.json read** - `ambient.ts:217`
**Confidence**: 82%
- Problem: The `catch` block at line 217 (in the `--enable` path) catches *all* errors when reading `settings.json`, not just `ENOENT`. If the file exists but has incorrect permissions (EACCES) or is corrupted, the code silently creates `'{}'` and overwrites the file at line 255, potentially destroying existing configuration. This is the same pattern that the PR itself correctly fixed in `removeCommandsRule()` (line 107) by narrowing to ENOENT-only.
- Fix: Narrow the catch to only ENOENT, propagating permission and other I/O errors:
```typescript
} catch (err) {
  if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  if (options.status) {
    p.log.info('Ambient mode: disabled (no settings.json found)');
    return;
  }
  settingsContent = '{}';
}
```

**Broad catch swallows all errors in devflowDir resolution** - `ambient.ts:244`
**Confidence**: 80%
- Problem: The `catch` at line 244 swallows any error from `JSON.parse(settingsContent)` including unexpected corruption. Since `settingsContent` was already JSON.parsed successfully earlier in `addAmbientHook`/`removeAmbientHook`, this catch would only fire if the read succeeded but parsing failed on a second attempt with modified content (unlikely), or from `getDevFlowDirectory()` throwing. The fallback is benign (just uses default path), but silent error swallowing is a minor security concern — it could mask filesystem permission issues that indicate tampering.
- Fix: Log or narrow the catch:
```typescript
} catch {
  // Fallback is acceptable — devflowDir only controls script path prefix
  devflowDir = getDevFlowDirectory();
}
```
This is informational as the pre-existing fallback behavior is safe (the path is already bounded to a known location).

## Suggestions (Lower Confidence)

- **JSON.parse without schema validation** - `ambient.ts:118,163` (Confidence: 65%) — `addAmbientHook` and `removeAmbientHook` parse `settingsJson` with `JSON.parse()` and cast to `Settings` without runtime schema validation. Malformed input could lead to unexpected property access patterns. Low risk since callers control the input (internal CLI), but for defense-in-depth a Zod schema at the boundary would be preferable.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 0 | 0 |
| Should Fix | 0 | 0 | 0 | 0 |
| Pre-existing | 0 | 0 | 2 | 0 |

**Security Score**: 9/10
**Recommendation**: APPROVED

## Rationale

This PR makes security-positive changes:

1. **Narrowed ENOENT catch** in `removeCommandsRule()` (line 107) — previously the catch block swallowed all errors silently. Now only `ENOENT` is suppressed and other filesystem errors (permission denied, disk full) propagate correctly. This is a direct security improvement.

2. **Extracted helper functions** (`installCommandsRule`, `removeCommandsRule`) — improves auditability by isolating filesystem-writing operations into named, documented functions with clear contracts.

3. **No new attack surface** — the changes modify rule content (static string), add legacy skill names to a cleanup list (static data), and refine hook filtering logic. No new user input parsing, no new file paths derived from user input, no new network calls.

4. **File write paths are static** — `COMMANDS_RULE_PATH` is derived from `os.homedir()` + hardcoded path segments. The `devflowDir` parameter in `addAmbientHook` comes from either existing hook commands in settings or `getDevFlowDirectory()` — both controlled by the local user, not external input.

The two pre-existing MEDIUM issues (broad catch blocks) are informational and predate this PR. They don't introduce exploitable vulnerabilities in this context (CLI tool running as the local user with local files), but narrowing them would improve robustness.
