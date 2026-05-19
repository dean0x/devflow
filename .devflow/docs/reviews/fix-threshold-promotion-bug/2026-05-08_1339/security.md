# Security Review Report

**Branch**: fix/threshold-promotion-bug -> main
**Date**: 2026-05-08

## Issues in Your Changes (BLOCKING)

_No blocking security issues found._

## Issues in Code You Touched (Should Fix)

_No should-fix security issues found._

## Pre-existing Issues (Not Blocking)

### MEDIUM

**`safePath` called without `allowedRoot` constraint throughout json-helper.cjs** - multiple locations (e.g., `json-helper.cjs:689`, `json-helper.cjs:907`, `json-helper.cjs:950`)
**Confidence**: 65%
- Problem: `safePath()` is called without the optional `allowedRoot` parameter across all CLI operations in json-helper.cjs. Without `allowedRoot`, the function merely resolves to an absolute path but does not enforce any directory boundary. A caller controlling the args (CLI arguments) could direct file reads/writes outside the project directory.
- Mitigating factor: This tool is invoked internally by hooks and the TypeScript CLI, not exposed to untrusted user input over a network. The arguments come from the dev's own session. This is informational only.
- Fix: Consider passing `process.cwd()` or the project root as `allowedRoot` where file operations target project-scoped files (log files, manifest files, decisions files).

## Suggestions (Lower Confidence)

- **Lock stale-check race window in async `acquireMkdirLock`** - `learn.ts:340-343` (Confidence: 60%) -- The async version in learn.ts catches the mkdir EEXIST but then does `stat` + `rmdir` in sequence. Between the stat check and rmdir, another process could acquire and release the lock. The CJS version has the same pattern. In practice, the `continue` loop re-attempts, so this is self-healing, but a narrow TOCTOU window exists.

- **Exported `acquireMkdirLock` widens API surface** - `learn.ts:333` (Confidence: 65%) -- Making `acquireMkdirLock` public is fine for internal reuse in `decisions.ts`, but the function now becomes part of the module's exported contract. If external consumers misuse it (e.g., forgetting the `finally` release), stale locks could accumulate. The change itself is a reasonable refactor; just noting the expanded surface.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 0 | - |
| Should Fix | - | 0 | 0 | - |
| Pre-existing | - | - | 1 | 0 |

**Security Score**: 9/10
**Recommendation**: APPROVED

### Analysis Notes

This PR is a clean refactoring that extracts duplicated logic into shared helpers (`tryImmediatePromotion`, `filterEligibleEntries`, `sortByLeastUsed`) and exports two previously-private functions (`acquireMkdirLock`, `formatStaleReason`) for reuse across modules.

**What was reviewed:**

1. **Input validation** -- `safePath` is used consistently at CLI operation boundaries in json-helper.cjs. The `anchorId` regex sanitization (`entry.anchorId.replace(/[^A-Z0-9-]/gi, '')`) in reconcile-manifest remains intact and prevents ReDoS. No new user-facing input surfaces were introduced.

2. **Lock safety** -- The lock acquisition in `decisions.ts:646` now uses the shared `acquireMkdirLock` (with stale-lock recovery) instead of a bare `fs.mkdir` that would fail permanently on a stale lock. This is a security *improvement* -- the old code could leave the review flow permanently locked after a crash. The `finally` block at line 729 properly releases the lock.

3. **File write safety** -- All file writes in the changed code continue to use `writeFileAtomic` / `writeJsonlAtomic` (rename-based atomicity). No new direct `fs.writeFileSync` calls were introduced in changed paths.

4. **No secrets or credentials** -- No hardcoded secrets, API keys, or sensitive data in any of the changed files.

5. **No injection vectors** -- The `tryImmediatePromotion` helper operates on in-memory objects only (no shell commands, no SQL, no user-controlled string interpolation). The extracted `filterEligibleEntries` and `sortByLeastUsed` are pure functions operating on typed data structures.

6. **`execFileSync` usage** -- The existing `execFileSync` call at `decisions.ts:886` (D-SEC3 comment) correctly uses an argv array rather than shell string interpolation, preventing command injection. This code was not modified in this PR but is in the touched vicinity.

The changes are behavioral-neutral refactors that reduce code duplication and improve lock robustness. No new security risks were introduced.
