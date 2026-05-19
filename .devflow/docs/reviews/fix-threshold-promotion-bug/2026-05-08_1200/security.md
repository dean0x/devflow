# Security Review Report

**Branch**: fix-threshold-promotion-bug -> main
**Date**: 2026-05-08

## Issues in Your Changes (BLOCKING)

### CRITICAL

(none)

### HIGH

(none)

## Issues in Code You Touched (Should Fix)

(none)

## Pre-existing Issues (Not Blocking)

(none)

## Suggestions (Lower Confidence)

- **`safePath` called without `allowedRoot` constraint** - `scripts/hooks/json-helper.cjs:929,930` (Confidence: 65%) -- The `safePath()` calls on `process-observations` args resolve paths to absolute but do not enforce an `allowedRoot`, meaning a crafted CLI argument could target arbitrary filesystem locations. However, this is a local-only CLI tool invoked by hooks (not user-facing over network), so exploitability is very low.

- **`JSON.parse` on untrusted `args[2]` in `merge-observation`** - `scripts/hooks/json-helper.cjs:1670` (Confidence: 60%) -- The `merge-observation` op parses `args[2]` as JSON directly from the command line. In the changed code path (new entry with `isImmediateType`), the parsed object drives promotion logic. The existing error handling (`catch` + `process.exit(1)`) mitigates malformed input, and the caller is always a trusted internal pipeline (decisions-agent.ts), so the real risk is negligible.

- **`usageData` cast after shape validation could be tighter** - `src/cli/commands/decisions.ts:775` (Confidence: 62%) -- After validating `parsed.entries` is a non-null, non-array object, the code casts it via `as typeof usageData`. Individual entry values within `entries` are not validated per-field (e.g., `cites` could be a string). The sort logic uses `||` fallback to `{ cites: 0 }` which provides resilience, and this is a local CLI reading its own files, so the practical risk is minimal. applies ADR-001

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 0 | - |
| Should Fix | - | 0 | 0 | - |
| Pre-existing | - | - | 0 | 0 |

**Security Score**: 9/10
**Recommendation**: APPROVED

## Analysis Notes

### What was reviewed

This PR makes three categories of changes:

1. **Threshold/promotion bug fix** (`json-helper.cjs`): Decision and pitfall observation types now promote to `ready` status on first creation (when `quality_ok=true`), rather than requiring a second reinforcement observation. The `process-observations` and `merge-observation` ops both gain an `isImmediateType` check with inline promotion logic for `decision`/`pitfall` types.

2. **Capacity review migration** (`decisions.ts`, `learn.ts`): The capacity review mode (interactive deprecation of least-used decisions/pitfalls) moves from `devflow learn --review` to `devflow decisions --review`, and `learn --review` is simplified to only show workflow/procedural flagged observations.

3. **Test coverage** (4 test files): New tests for immediate promotion, merge-observation promotion, capacity review parsing logic, and simplified learn --review filtering.

### Security assessment

**Input validation**: The changed code in `json-helper.cjs` introduces no new external input vectors. The `isImmediateType` check is a pure boolean comparison on `obs.type` which is already validated against `VALID_TYPES` before reaching the new code path. The `THRESHOLDS` lookup uses `||` fallback, preventing undefined access.

**Command injection**: The `decisions.ts` capacity review mode uses `execFileSync('node', [...])` with argv-array invocation (D-SEC3 comment at line 864), correctly avoiding shell interpolation. This is a pre-existing secure pattern that the PR preserves. avoids PF-001

**ReDoS**: The `headingRe` regex in the new capacity review block (`new RegExp('^## (${prefix}-\\d+):\\s*(.+)$', 'gm')`) uses only literal prefix strings (`ADR` or `PF`) with no user-controlled components, so ReDoS is not a concern. The pre-existing `safeAnchorId` sanitization in `reconcile-manifest` (line 1174) continues to protect against regex injection.

**File system access**: The `updateDecisionsStatus` function imported by `decisions.ts` acquires a mkdir-based lock and reads/writes decisions files. The file paths are derived from `process.cwd()` + known subdirectories (`.memory/decisions/`), not from user input. The `--cwd` flag in `--run-background` mode validates the target directory contains `.memory/` before proceeding (line 195).

**Race conditions**: The capacity review block in `decisions.ts` does not acquire the `.decisions.lock` because each `updateDecisionsStatus` call acquires it internally. The comment at line 827-828 documents this is intentional (sequential calls, no reentrancy). This is correct -- the calls are sequential within the `for` loop.

**`isCountActiveResult` guard**: The D-SEC2 runtime guard was moved from `learn.ts` to `decisions.ts` (with a local copy comment). The guard correctly validates the JSON result shape before accessing `.count`. This maintains the existing security posture.

**No secrets or credentials**: No hardcoded secrets, API keys, or credentials were introduced.
