# Security Review Report

**Branch**: feat/phase5-devflow-dir -> main
**Date**: 2026-05-19

## Issues in Your Changes (BLOCKING)

### CRITICAL

(none)

### HIGH

(none)

### MEDIUM

**TOCTOU in .devflow/.gitignore creation (ensure-devflow-init)** - `scripts/hooks/ensure-devflow-init:39-88`
**Confidence**: 80%
- Problem: The `.gitignore` write at line 40 (`cat > "$_DEVFLOW_DIR/.gitignore"`) is not atomic. A concurrent hook invocation could read a partially written file between the `cat >` redirect (which truncates) and the write completion. The `index.json` bootstrap (lines 32-33) was correctly converted to atomic temp+mv in this PR, but the `.gitignore` write was not given the same treatment.
- Impact: In concurrent-session scenarios (multiple Claude sessions on same project), a hook could read a truncated `.gitignore`, causing transient files to be committed to git. Low practical impact since the `.gitignore-configured` marker prevents re-entry after the first successful write, but the race window exists on first init.
- Fix: Apply the same temp+mv pattern used for `index.json`:
```bash
cat > "$_DEVFLOW_DIR/.gitignore.tmp" << 'EOF'
...
EOF
mv "$_DEVFLOW_DIR/.gitignore.tmp" "$_DEVFLOW_DIR/.gitignore"
touch "$_DEVFLOW_DIR/.gitignore-configured"
```

## Issues in Code You Touched (Should Fix)

(none)

## Pre-existing Issues (Not Blocking)

(none)

## Suggestions (Lower Confidence)

- **Non-atomic .gitignore write in migration** - `src/cli/utils/migrations.ts:358-359` (Confidence: 65%) -- The migration writes `.devflow/.gitignore` via `fs.writeFile` (line 359) preceded by an `fs.access` existence check (line 358). This is a mild TOCTOU: the file could be created between the access check and the writeFile. The migration uses `writeFileAtomicExclusive` elsewhere but not here. Low impact since migrations are run-once operations unlikely to race.

- **Cross-device copy+delete is not atomic** - `src/cli/utils/migrations.ts:29-30` (Confidence: 60%) -- The EXDEV fallback does `fs.cp` then `fs.rm`. If the process crashes between these calls, both source and dest will exist, duplicating data. The `moveFile` function is idempotent on re-run (EEXIST returns early), so the next migration run would skip the dest and the stale src would remain. No data loss risk, but stale files could linger.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 1 | 0 |
| Should Fix | 0 | 0 | 0 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Security Score**: 9/10
**Recommendation**: APPROVED_WITH_CONDITIONS

### Conditions
1. Consider making the `.gitignore` write in `ensure-devflow-init` atomic (temp+mv pattern) for consistency with the `index.json` write in the same file.

### Positive Observations

- **TOCTOU fix in moveFile is well-executed**: The removal of the access(src)+access(dest) pre-checks in favor of handling ENOENT/EEXIST from the rename syscall directly (lines 18-35 of migrations.ts) is the correct security-conscious approach. This eliminates the race window that existed in the previous implementation.
- **Atomic index.json bootstrap**: The new temp+mv pattern for `features/index.json` (ensure-devflow-init:32-33) prevents partial reads.
- **No hardcoded secrets or credentials** introduced.
- **No new user-controlled input paths**: All path construction uses centralized `project-paths` getters with `path.join`, preventing path traversal. The `safePath` function in `json-helper.cjs` already handles untrusted CLI arguments.
- **Lock protocols preserved**: The migration correctly maintains mkdir-based locking for concurrent access to decisions files and learning state.
- **gitignore content centralized**: The `getDevflowGitignoreContent()` extraction into `project-paths.ts/.cjs` reduces the risk of gitignore drift causing sensitive files to be committed. The heredoc in `ensure-devflow-init` has a canonical-source comment pointing to the function.
- **DRY skip-set derivation**: Computing `memSkipFiles` from `memMap.map(([name]) => name)` (line 344-347) eliminates the previous manual duplication where new memMap entries could be forgotten in the skip set, reducing the risk of accidentally moving legacy files.
