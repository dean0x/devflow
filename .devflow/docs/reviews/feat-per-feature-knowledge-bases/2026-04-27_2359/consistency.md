# Consistency Review Report

**Branch**: feat/per-feature-knowledge-bases -> main
**Date**: 2026-04-27

## Issues in Your Changes (BLOCKING)

### CRITICAL

(none)

### HIGH

**Behavioral inconsistency between CJS and TS `readSidecar` implementations** - `scripts/hooks/json-helper.cjs:1813-1828` vs `src/cli/commands/kb.ts:26-45`
**Confidence**: 82%
- Problem: The CJS `read-sidecar` command does not filter non-string elements from the array field it returns (line 1823: `Array.isArray(value) ? JSON.stringify(value) : '[]'`), while the TS `readSidecar` function explicitly filters to strings only (line 37-39: `.filter((f): f is string => typeof f === 'string')`). If an LLM-generated sidecar JSON contains non-string array elements (e.g., numbers or nulls), the shell path via `background-kb-refresh` will pass them through to `update-index`, while the TS CLI path will strip them. This is a pattern mismatch between two implementations serving the same logical purpose.
- Fix: Add string filtering in the CJS `read-sidecar` handler:
```javascript
case 'read-sidecar': {
  if (!args[0] || !args[1]) {
    console.log('[]');
    break;
  }
  const sidecarFile = safePath(args[0]);
  const field = args[1];
  try {
    const data = JSON.parse(fs.readFileSync(sidecarFile, 'utf8'));
    const value = data[field];
    console.log(Array.isArray(value) ? JSON.stringify(value.filter(v => typeof v === 'string')) : '[]');
  } catch {
    console.log('[]');
  }
  break;
}
```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Inconsistent error-guard pattern on `source` commands across hooks** - `scripts/hooks/session-end-kb-refresh:20`, `scripts/hooks/session-end-learning:21`, `scripts/hooks/stop-update-memory:17`, `scripts/hooks/prompt-capture-memory:13`
**Confidence**: 85%
- Problem: This branch consistently adds the `|| { echo "..."; exit 1; }` error guard to `source` statements in the three `background-*` hooks, which is a good hardening pattern. However, other hooks in the same directory (`session-end-kb-refresh`, `session-end-learning`, `stop-update-memory`, `prompt-capture-memory`) still use bare `source "$SCRIPT_DIR/..."` without an error guard. Since this branch touched the `background-*` hooks and introduced this pattern as a convention, the remaining hooks in the same ecosystem should follow suit for consistency.
- Fix: Apply the same `|| { echo "hook-name: failed to source X" >&2; exit 1; }` pattern to all `source` statements in the remaining hooks.

## Pre-existing Issues (Not Blocking)

(none)

## Suggestions (Lower Confidence)

- **Missing `description` field support in CJS `read-sidecar`** - `scripts/hooks/json-helper.cjs:1813` (Confidence: 65%) -- The CJS `read-sidecar` command only supports extracting a single array field, returning `[]` for non-array values. The TS `readSidecar` extracts both `referencedFiles` and `description`. While the shell path currently only needs `referencedFiles`, if `description` refresh were ever needed from the shell, a second call or a richer extraction mode would be required. Not blocking since `updateIndex` preserves existing `description` via fallback.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 0 | - |
| Should Fix | - | 0 | 1 | - |
| Pre-existing | - | - | 0 | 0 |

**Consistency Score**: 8/10
**Recommendation**: CHANGES_REQUESTED

The branch demonstrates strong internal consistency: the `category` field removal is thorough across all layers (CJS, TS, agents, skills, tests, fixtures, shell hooks), all three copies of `knowledge.md` are identical, test fixtures and assertions are properly updated, and the `--model sonnet` addition to CLI `claude -p` calls aligns with the existing `background-kb-refresh` pattern. The `source` error-guard pattern is applied uniformly across all three `background-*` hooks. The one blocking issue is a behavioral divergence between the CJS and TS sidecar readers regarding non-string array filtering -- a minor but genuine pattern inconsistency that should be resolved before merge.
