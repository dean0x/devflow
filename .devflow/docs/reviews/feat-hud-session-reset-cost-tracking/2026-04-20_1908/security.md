# Security Review Report

**Branch**: feat/hud-session-reset-cost-tracking -> main
**Date**: 2026-04-20

## Issues in Your Changes (BLOCKING)

### HIGH

**Unsanitized `cwd` stored in session cost files** - `src/cli/hud/cost-history.ts:56`
**Confidence**: 82%
- Problem: The `cwd` parameter passed to `persistSessionCost` originates from `stdin.cwd || process.cwd()` (index.ts:74) and is stored verbatim in the JSON session file (line 56). While `cwd` is not used to construct file paths (the `sessionId` is), the stored `cwd` value comes from untrusted stdin JSON. If a consumer later uses this stored `cwd` as a path (e.g., in future UI or analytics features), it could enable path traversal. The `sessionId` field already has a path-traversal guard (line 45), but `cwd` does not.
- Fix: This is defense-in-depth. The `cwd` field is currently display-only, so the risk is limited. If it is ever used as a path in future, add validation:
```typescript
// In persistSessionCost, after sessionId check:
if (cwd && typeof cwd !== 'string') return;
// Or normalize: const safeCwd = path.resolve(cwd);
```

**Debug dump writes arbitrary stdin JSON to user-controlled path** - `src/cli/hud/index.ts:67-68`
**Confidence**: 85%
- Problem: When `DEVFLOW_HUD_DEBUG` env var is set, the full stdin payload is written to whatever path that env var contains (line 68: `fs.writeFileSync(process.env.DEVFLOW_HUD_DEBUG, ...)`). The stdin payload includes `session_id`, `cost`, `rate_limits`, `transcript_path`, and `cwd`. An attacker who can set environment variables could direct the dump to arbitrary filesystem locations (e.g., overwriting config files). This is pre-existing code (not introduced in this PR), but the new `rate_limits.resets_at` and `cost` fields expand the data surface written.
- Fix: This is a debug-only path and requires env var control, so exploitation requires local access. However, the expanded data surface is worth noting. Consider restricting the debug path:
```typescript
if (process.env.DEVFLOW_HUD_DEBUG) {
  const debugPath = path.resolve(process.env.DEVFLOW_HUD_DEBUG);
  const devflowDir = process.env.DEVFLOW_DIR || path.join(homedir(), '.devflow');
  // Only allow debug output within devflow directory
  if (debugPath.startsWith(path.resolve(devflowDir))) {
    fs.writeFileSync(debugPath, JSON.stringify(stdin, null, 2));
  }
}
```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**JSON.parse with type assertion on untrusted file content** - `src/cli/hud/cost-history.ts:121,146,178,196`
**Confidence**: 83%
- Problem: Multiple locations in `cost-history.ts` use `JSON.parse(raw) as SessionEntry` without runtime validation of the parsed shape. While each parse is wrapped in try/catch (malformed JSON is handled), a file containing valid JSON with unexpected shape (e.g., `{"session_id": 123, "cost_usd": "not-a-number"}`) would pass JSON.parse but produce type-unsafe values. Lines 179 and 197 do partial validation (`typeof entry.session_id === 'string' && typeof entry.cost_usd === 'number'`) in `aggregateCosts`, but `runCleanup` (line 121) and `trimArchive` (line 146) do not validate the parsed shape before using `entry.timestamp`.
- Fix: Add minimal runtime guards in `runCleanup` and `trimArchive`:
```typescript
// In runCleanup, line 121-122:
const entry = JSON.parse(raw) as SessionEntry;
if (typeof entry.timestamp !== 'number') continue;

// In trimArchive, line 146:
const entry = JSON.parse(line) as SessionEntry;
return typeof entry.timestamp === 'number' && entry.timestamp >= cutoff;
```

## Pre-existing Issues (Not Blocking)

### MEDIUM

**stdin JSON parsed with unchecked type assertion** - `src/cli/hud/stdin.ts:15`
**Confidence**: 80%
- Problem: `readStdin` casts `JSON.parse(data)` directly to `StdinData` without runtime validation. Since stdin comes from Claude Code (a trusted source in normal operation), this is low risk. However, the data surface has expanded with `rate_limits` and `cost` fields, increasing the impact of malformed input.
- Fix: Consider adding a lightweight schema validation or at minimum document that `StdinData` is a trusted boundary.

## Suggestions (Lower Confidence)

- **TOCTOU in atomic write retry** - `src/cli/hud/cost-history.ts:68-69` (Confidence: 65%) -- The unlink-then-retry pattern for stale `.tmp` files has a small race window where another process could create the `.tmp` between unlink and the second `writeFileSync`. The `flag: 'wx'` on the retry mitigates this (it will throw EEXIST again, caught by the outer try/catch), so no data corruption is possible, but the operation silently fails for that invocation.

- **Archive append is not atomic** - `src/cli/hud/cost-history.ts:125` (Confidence: 70%) -- `appendFileSync` to `archive.jsonl` during cleanup is not atomic. A crash mid-write could produce a truncated line. Since the archive reader already skips malformed lines (line 148), this is self-healing, but worth noting.

- **`trimArchive` non-atomic rewrite** - `src/cli/hud/cost-history.ts:153` (Confidence: 68%) -- `writeFileSync` overwrites `archive.jsonl` in place. A crash during the write could lose all archived data. Consider write-to-tmp-then-rename (same pattern used for session files).

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 2 | 0 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 1 | 0 |

**Security Score**: 8/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The new `cost-history.ts` module demonstrates good security awareness -- the `sessionId` path-traversal guard (line 45) is a strong defense-in-depth measure, and the atomic write pattern with `wx` flag prevents race-condition overwrites. The deletion of `credentials.ts` and `usage-api.ts` (which handled OAuth tokens and API calls) is a significant security improvement, reducing the attack surface by eliminating credential handling and external API calls entirely. The remaining issues are defense-in-depth improvements for JSON parsing validation and the debug dump path restriction.
