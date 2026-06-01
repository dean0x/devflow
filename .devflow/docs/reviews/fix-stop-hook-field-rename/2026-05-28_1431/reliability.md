# Reliability Review Report

**Branch**: fix/stop-hook-field-rename -> main
**Date**: 2026-05-28
**PR**: #228

## Issues in Your Changes (BLOCKING)

### HIGH

**Node fallback in `load_existing_ids` reads entire JSONL file into memory unbounded** - `scripts/hooks/eval-helpers:53-57`
**Confidence**: 85%
- Problem: The Node fallback path in `load_existing_ids()` calls `fs.readFileSync(process.argv[1],'utf8')` and then `.trim().split('\n')`, loading the entire `learning-log.jsonl` (or `decisions-log.jsonl`) into a single string. These log files are append-only JSONL that grow over the project lifetime. While the jq path streams line-by-line (line 50), the Node fallback has no size guard. A log file that has accumulated thousands of observations over months of use would be fully materialized as a string, then split into an array, then mapped, then filtered -- 4x the memory of the file itself. This is the same issue flagged in prior review cycles as "Node fallback unbounded read -- pre-existing, bounded upstream." However, the function is newly introduced in this PR (extracted into `eval-helpers`), so it is now a changed-code issue.
- Fix: Add a size guard or streaming approach in the Node fallback. The simplest fix is a line-count cap matching the jq path's behavior, or use `readline` for streaming:
  ```bash
  node -e "
    const rl=require('readline');
    const ids=[];
    const rs=require('fs').createReadStream(process.argv[1]);
    rl.createInterface({input:rs}).on('line',l=>{
      try{const o=JSON.parse(l);if(o.id)ids.push(o.id)}catch{}
    }).on('close',()=>process.stdout.write(JSON.stringify(ids)));
  " -- "$log_file" 2>/dev/null || echo "[]"
  ```

### MEDIUM

**`eval-reinforce` Node fallback reads entire JSONL into memory unbounded** - `scripts/hooks/eval-reinforce:53-77`
**Confidence**: 82%
- Problem: Same pattern as `load_existing_ids`: the Node fallback in `eval-reinforce` calls `fs.readFileSync(process.argv[1], 'utf8').trim().split('\n')` on the learning log, materializing the full file. The jq path (line 29) processes line-by-line. The learning log is append-only and grows over the project lifetime. While practical file sizes are currently small (tens to hundreds of lines), the code provides no explicit upper bound on memory consumption for the fallback path.
- Fix: Stream lines instead of slurping, or add a line-count cap consistent with the jq path's implicit streaming behavior.

**`session-start-context` reads full `WORKING-MEMORY.md` via `cat` without size bound** - `scripts/hooks/session-start-memory:59`
**Confidence**: 80%
- Problem: `MEMORY_CONTENT=$(cat "$MEMORY_FILE")` reads the entire working memory file into a shell variable. While the memory agent truncates this file during writes, there is no defensive size guard at the read site. If the memory agent were to malfunction or the file were corrupted (e.g., by a concurrent write race), an unexpectedly large file would be fully materialized in the shell process. The same pattern exists in `pre-compact-memory:75` with `MEMORY_SNAPSHOT=$(cat "$MEMORY_DIR/WORKING-MEMORY.md")`.
- Fix: Add a defensive size cap at the read site:
  ```bash
  MEMORY_CONTENT=$(head -c 65536 "$MEMORY_FILE")
  ```
  This bounds the shell variable to 64KB regardless of upstream failures.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**`sidecar-evaluate` transcript glob fallback uses `ls -t` with unbounded glob** - `scripts/hooks/sidecar-evaluate:77`
**Confidence**: 82%
- Problem: When `session_id` is missing or invalid, the fallback `ls -t "$PROJECTS_DIR"/*.jsonl 2>/dev/null | head -1` globs all JSONL files in the projects directory and sorts them by time. On a machine with many sessions (e.g., 500+ transcripts accumulated over months), `ls -t` must stat and sort all of them. While `head -1` limits the output, `ls` still pays the full sort cost. This is pre-existing logic that was not introduced in this PR but lives in the same function block as the changed `session_id` validation guard.
- Fix: Consider `find` with `-maxdepth 1` and `-newer` or a timestamp-based approach rather than sorting all files. Alternatively, accept the cost as bounded by filesystem limits and add a comment documenting the assumption.

## Pre-existing Issues (Not Blocking)

No CRITICAL pre-existing issues identified.

## Suggestions (Lower Confidence)

- **`sidecar-dispatch` stale retry loop processes up to 10 `.processing` files with `get_mtime` calls** - `scripts/hooks/sidecar-dispatch:121-155` (Confidence: 65%) -- The `PROC_LIMIT=10` bound is present, which is good, but the loop body calls `get_mtime` (which spawns `stat`), reads `.retries` files, and performs `mv` operations. Each iteration is I/O-heavy. In practice, stale processing files should be rare, and the `compgen` guard prevents entering the loop when none exist.

- **`eval-knowledge` stale-slug check spawns Node without a timeout** - `scripts/hooks/eval-knowledge:40` (Confidence: 62%) -- `node "$_KNOW_FEATURE_LIB" stale-slugs "$CWD"` could hang if the Node process encounters a pathological `index.json`. The `2>/dev/null || true` catches failures but not hangs. A `timeout 5` prefix would add a termination bound.

- **EXIT trap string in `eval-reinforce` and `eval-learning` references variable by value at trap-set time** - `scripts/hooks/eval-reinforce:25`, `scripts/hooks/eval-learning:76` (Confidence: 70%) -- The trap `'_eval_release_lock "$SIDECAR_DIR/.reinforce.lock"'` uses single quotes, so `$SIDECAR_DIR` is expanded at trap execution time, not at trap-set time. This is correct for the current code since `SIDECAR_DIR` is never reassigned, but it relies on the invariant that the orchestrator namespace variable is stable. The shared `_eval_release_lock` helper (applies ADR-007) mitigates the risk of per-module trap string divergence (avoids PF-006-style silent failures).

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 2 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Reliability Score**: 7/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The PR demonstrates strong reliability practices overall: bounded log growth via `_devflow_dbg_size_guard` (5MB cap with 2.5MB tail truncation), bounded queue overflow (200-line cap with locked truncation to 100), PID-unique temp files for atomicity, `|| true` fail-safe on all debug/log writes, explicit `set -e` per hook, fail-fast `VAR:?` guards on all module inputs, bounded lock acquisition timeouts (3s), stale marker retry limits (MAX_RETRIES=3 with `.failed` promotion), and 24h marker expiration. The debug tracing system follows a disciplined fail-safe design where missing `debug-trace` never causes hook failure (applies ADR-007).

The blocking HIGH issue (Node fallback unbounded read in `load_existing_ids`) should be addressed before merge. The MEDIUM issues are defense-in-depth improvements that would strengthen an already well-bounded system.
