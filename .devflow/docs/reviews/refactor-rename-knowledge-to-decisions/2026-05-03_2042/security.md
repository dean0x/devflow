# Security Review Report

**Branch**: refactor/rename-knowledge-to-decisions -> main
**Date**: 2026-05-03

## Issues in Your Changes (BLOCKING)

### CRITICAL

(none)

### HIGH

**Migration renames lock directory without holding it** - `src/cli/utils/migrations.ts:177-189`
**Confidence**: 85%
- Problem: The `rename-knowledge-to-decisions` migration renames `.knowledge.lock` to `.decisions.lock` (and similarly `.knowledge-usage.lock` to `.decisions-usage.lock`) using `fs.rename()` without first acquiring the lock. If the background learning pipeline or a concurrent CLI session is holding `.knowledge.lock` at migration time, the rename could cause the holder to fail on lock release (it attempts `rmdir` on the old path which no longer exists), and a second concurrent process could create a *new* `.knowledge.lock` that the migration already believes it has handled. This creates a window where the lock serialization guarantee is violated and two writers could corrupt `decisions.md` or `pitfalls.md`.
- Fix: Acquire each lock before renaming it, or skip active (non-stale) lock directories entirely and let them expire naturally. The stale detection threshold for `.knowledge.lock` is 60 seconds, so the safest approach is to check `mtime` and skip if the lock is fresh:
```typescript
for (const [oldName, newName] of lockRenames) {
  const oldPath = path.join(memoryDir, oldName);
  const newPath = path.join(memoryDir, newName);
  try {
    const stat = await fs.stat(oldPath);
    // Only rename lock dirs that are stale (>60s old) — live locks
    // will expire and the new name will be used next time.
    if (oldName.endsWith('.lock')) {
      const age = Date.now() - stat.mtimeMs;
      if (age < 60_000) continue; // live lock — skip
    }
    await fs.rename(oldPath, newPath);
  } catch { /* does not exist — skip */ }
}
```

### MEDIUM

(none)

## Issues in Code You Touched (Should Fix)

(none)

## Pre-existing Issues (Not Blocking)

(none)

## Suggestions (Lower Confidence)

- **Migration does not acquire `.decisions.lock` during manifest/log rewrite** - `src/cli/utils/migrations.ts:191-209` (Confidence: 70%) -- The migration rewrites `.learning-manifest.json` and `learning-log.jsonl` with `writeFileAtomicExclusive` (which is safe against TOCTOU) but without acquiring the `.learning.lock` that serializes against `background-learning`. If the background pipeline is writing to the log at the same moment the migration reads and rewrites it, the migration's view may be stale. The atomic-write prevents corruption, but the migration could overwrite a just-appended observation line. In practice the migration runs during `devflow init` when no background pipeline should be active, but the serialization gap exists in theory.

- **Broad regex replacement in learning-log.jsonl** - `src/cli/utils/migrations.ts:204` (Confidence: 65%) -- The regex `.memory/knowledge/` is applied globally across the entire JSONL file as a raw string replacement rather than parsing each JSON line and updating `artifact_path` fields specifically. If a user-authored `pattern` or `details` field happens to contain the literal string `.memory/knowledge/`, it would be incorrectly rewritten. The probability is very low (these are natural language fields, not filesystem paths), but a JSON-aware approach would be more precise.

- **Renaming `.knowledge-usage.json` to `.decisions-usage.json` without migration of inner format** - `src/cli/utils/migrations.ts:179` (Confidence: 60%) -- The migration renames the file but does not inspect or update its contents. Currently the file's inner structure uses ADR/PF IDs as keys (which are unchanged), so this is fine. However, if any field names or markers inside the file reference "knowledge" rather than "decisions", they would not be migrated. A quick grep confirms the current format uses only `version`, `entries`, `cites`, and `last_cited` keys, so no action is needed now, but this is worth noting for future format changes.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 0 | - |
| Should Fix | - | 0 | 0 | - |
| Pre-existing | - | - | 0 | 0 |

**Security Score**: 8/10
**Recommendation**: CHANGES_REQUESTED

The vast majority of this PR is a mechanical rename refactor (knowledge -> decisions) that preserves all existing security properties: path traversal guards, O_EXCL atomic writes, mkdir-based locks, `execFileSync` with array args, input validation on `decisions-usage-scan.cjs`, and ReDoS-safe regex sanitization in `sliceDecisionsSection`. These are all correctly carried forward with only name changes.

The single HIGH finding concerns the migration renaming lock directories without serialization, which could cause data corruption in a narrow race window when the migration coincides with an active background learning pipeline. The fix is straightforward (skip fresh locks or acquire before renaming). The three lower-confidence suggestions are defensive improvements rather than exploitable vulnerabilities.
