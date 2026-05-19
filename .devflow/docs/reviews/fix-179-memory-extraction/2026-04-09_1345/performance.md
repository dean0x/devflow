# Performance Review Report

**Branch**: fix/179-memory-extraction -> main
**Date**: 2026-04-09
**Diff Range**: 33973c6..HEAD (2 commits: ada6344, 4ce11fd)

## Issues in Your Changes (BLOCKING)

### HIGH

**Per-prompt subprocess overhead in prompt-capture-memory hook** - `scripts/hooks/prompt-capture-memory:18,23`
**Confidence**: 85%
- Problem: The new `prompt-capture-memory` hook runs on every `UserPromptSubmit` event. It spawns 2 subprocess invocations per execution: one to extract `cwd` (line 18, `echo "$INPUT" | json_field "cwd"`) and one to extract `prompt` (line 23, `echo "$INPUT" | json_field "prompt"`). Each `json_field` call pipes through jq or node. This adds latency to every single user prompt submission.
- Impact: This is a synchronous hook on the critical path -- it executes before Claude processes the prompt. Two subprocess spawns (jq or node) add ~10-30ms each on warm systems, ~50-100ms on cold start. This runs on every prompt, not throttled like the stop hook.
- Fix: Combine both field extractions into a single jq/node invocation:
  ```bash
  # Single-pass extraction of both fields
  if [ "$_HAS_JQ" = "true" ]; then
    eval "$(echo "$INPUT" | jq -r '@sh "CWD=\(.cwd // "") PROMPT=\(.prompt // "")"' 2>/dev/null)"
  else
    eval "$(echo "$INPUT" | node -e "
      let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{
        try{const o=JSON.parse(d);
        console.log('CWD='+JSON.stringify(o.cwd||'')+ ' PROMPT='+JSON.stringify(o.prompt||''))
        }catch(e){console.log('CWD=\"\" PROMPT=\"\"')}
      })" 2>/dev/null)"
  fi
  ```

### MEDIUM

**Duplicate `get_mtime` function definition across two scripts** - `scripts/hooks/stop-update-memory:30-36`, `scripts/hooks/background-memory-update:47-53`
**Confidence**: 82%
- Problem: The `get_mtime()` function is defined identically in both `stop-update-memory` (new code) and `background-memory-update`. While not a runtime performance issue per se, duplicated utility functions increase maintenance risk and make it harder to optimize the mtime check in one place.
- Impact: Low runtime impact (function is called once per hook invocation), but a DRY violation that could lead to divergent behavior if only one copy is updated.
- Fix: Extract `get_mtime()` into a shared helper (similar to how `json-parse` is sourced), or inline the one-liner at each call site since it is only used once per script.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Two separate json_field calls in preamble hook** - `scripts/hooks/preamble:16,21`
**Confidence**: 80%
- Problem: The preamble hook calls `json_field` twice (once for `cwd`, once for `prompt`). While these calls existed before this PR, the PR modified the CWD validation (line 17: added `[ ! -d "$CWD" ]` check). The same single-pass optimization suggested for `prompt-capture-memory` applies here.
- Impact: Two jq/node subprocesses on every prompt submission. Combined with the new `prompt-capture-memory` hook, users now pay for 4 json_field subprocess calls per prompt (2 in preamble + 2 in prompt-capture-memory) instead of the previous 3 (which included the queue write).
- Fix: Apply the same single-pass jq extraction in preamble:
  ```bash
  if [ "$_HAS_JQ" = "true" ]; then
    eval "$(echo "$INPUT" | jq -r '@sh "CWD=\(.cwd // "") PROMPT=\(.prompt // "")"' 2>/dev/null)"
  else
    # ... node fallback
  fi
  ```

## Pre-existing Issues (Not Blocking)

### MEDIUM

**PF-006 reintroduction risk: json_field per-line pattern still present in hooks** - `scripts/hooks/stop-update-memory:44,50-67`
**Confidence**: 82%
- Problem: Known pitfall PF-006 documents per-line jq spawning as a latency concern. The `stop-update-memory` hook calls `json_field` twice (for `stop_reason` at line 44 and for `assistant_message` extraction at lines 50-67). However, the assistant_message extraction uses a single jq/node invocation with complex logic (array handling), which is correct. The `stop_reason` extraction at line 44 is a separate subprocess but runs only once per stop event (not in a loop), so this is acceptable.
- Impact: The background-memory-update script correctly replaced the per-line loop with single-pass TSV extraction (lines 157-172), which directly addresses PF-006. The remaining json_field calls in stop-update-memory are O(1), not O(n).
- Note: PF-006 resolution was properly applied in the background-memory-update changes. No regression.

## Suggestions (Lower Confidence)

- **Sequential queue file cleanup on disable** - `src/cli/commands/memory.ts:1817-1819` (Confidence: 65%) -- The two `fs.unlink` calls for queue cleanup during `--disable` run sequentially via `.then()`. Could use `Promise.all()` for marginal improvement, though these are one-time operations on small files so the impact is negligible.

- **Node fallback cold start in prompt-capture-memory** - `scripts/hooks/prompt-capture-memory:36-37` (Confidence: 62%) -- When jq is unavailable, the node fallback spawns a full Node.js process for a single JSON serialization. Node cold start is ~30-80ms. This is acceptable as a fallback path, but worth documenting that `brew install jq` is recommended for performance.

- **`addMemoryHooks` always re-serializes JSON even when no changes made** - `src/cli/commands/memory.ts` (Confidence: 70%) -- The removal of the `changed` tracking variable means `addMemoryHooks` now always calls `JSON.stringify` + returns new JSON even when all 4 hooks are already present. The previous code had an early return. This is a CLI-time concern only (not runtime), but the idempotent check in the command handler (`if (updated === settingsContent)`) relies on string equality, which now always differs due to formatting normalization.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 1 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 1 | 0 |

**Performance Score**: 7/10
**Recommendation**: CHANGES_REQUESTED

The key performance concern is the new `prompt-capture-memory` hook adding per-prompt subprocess overhead on the critical path. The background-memory-update changes are a clear performance win (single-pass TSV extraction replacing per-line subprocess spawning, directly addressing PF-006). The preamble was correctly stripped of queue I/O, but the net effect is that users now have two UserPromptSubmit hooks each spawning 2 subprocesses, totaling 4 subprocess invocations per prompt where previously there were 3 (preamble did capture + classification in one hook). Consolidating json_field calls into single-pass extractions in both hooks would bring the subprocess count down to 2 (one per hook), which is a meaningful improvement on the synchronous prompt path.
