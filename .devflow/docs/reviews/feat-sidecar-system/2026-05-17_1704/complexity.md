# Complexity Review Report

**Branch**: feat/sidecar-system -> main
**Date**: 2026-05-17

## Issues in Your Changes (BLOCKING)

### HIGH

**sidecar-evaluate is a 415-line monolithic shell script** - `scripts/hooks/sidecar-evaluate:1-415`
**Confidence**: 92%
- Problem: The file contains four independent evaluation domains (artifact reinforcement, learning, decisions, knowledge) concatenated into a single sequential script. Each domain is self-contained with its own config loading, daily cap checking, transcript extraction, marker writing, and logging. The file exceeds the 300-line warning threshold and approaches the >500-line critical threshold for shell scripts, where debuggability degrades sharply (no stack traces, no structured error contexts). The preamble (lines 1-90) handles config, transcript finding, and two utility functions, followed by four sections of ~65-95 lines each.
- Fix: Each evaluation section (lines 128-196, 198-295, 297-357, 359-413) is already delimited by `=====` banners and gated by independent `*_ENABLED` flags. Extract each into a sourced helper function or separate evaluator script. The preamble (transcript resolution, config loading, `read_daily_cap`, `load_existing_ids`) becomes a shared module. Example decomposition:
  ```bash
  # sidecar-evaluate (orchestrator, ~60 lines)
  source "$SCRIPT_DIR/sidecar-evaluate-lib"
  [ "$LEARNING_ENABLED" = "true" ] && source "$SCRIPT_DIR/evaluate-reinforcement"
  [ "$LEARNING_ENABLED" = "true" ] && [ "$SESSION_DEEP" = "true" ] && source "$SCRIPT_DIR/evaluate-learning"
  [ "$DECISIONS_ENABLED" = "true" ] && [ "$SESSION_DEEP" = "true" ] && source "$SCRIPT_DIR/evaluate-decisions"
  [ "$KNOWLEDGE_ENABLED" = "true" ] && source "$SCRIPT_DIR/evaluate-knowledge"
  ```

**Artifact reinforcement section has 5-level nesting depth** - `scripts/hooks/sidecar-evaluate:132-196`
**Confidence**: 90%
- Problem: The reinforcement block nests 5 levels deep: `if LEARNING_ENABLED` > `if log exists` > `if slugs found` > `if _HAS_JQ` > `if grep reinforced`. The jq path (lines 143-163) and node fallback path (lines 164-193) each contain their own additional nesting. The deepest shell indentation reaches 8 spaces (4 levels inside the outer `if`), and the embedded jq script has its own 3-level `if/then/else` nesting (lines 145-156). Combined cognitive load of shell + jq nesting makes this the hardest section to follow.
- Fix: Flatten with early returns by extracting to a function:
  ```bash
  reinforce_artifacts() {
    [ "$LEARNING_ENABLED" = "true" ] || return 0
    [ -n "$TRANSCRIPT" ] && [ -f "$TRANSCRIPT" ] || return 0
    local log_file="$MEMORY_DIR/learning-log.jsonl"
    [ -f "$log_file" ] || return 0
    local slugs=$(grep -oE 'self-learning[:/][a-z0-9-]+' "$TRANSCRIPT" 2>/dev/null | \
      sed 's|self-learning[:/]||' | sort -u || true)
    [ -n "$slugs" ] || return 0
    # Now at depth 0 — proceed with jq/node reinforcement
  }
  ```

**11 jq/node dual-path branches across the three hooks** - `sidecar-capture:26,98,143` `sidecar-dispatch:61,142` `sidecar-evaluate:70,115,143,266,332,390`
**Confidence**: 85%
- Problem: Every JSON construction or extraction operation requires an `if _HAS_JQ / else node` branch, doubling the code surface for each operation. sidecar-evaluate alone has 6 such branches, contributing ~60 extra lines. Each branch pair must be kept semantically identical during maintenance, but there is no test that verifies jq and node produce the same output for given inputs. The pattern is inherited from the previous hook design, but the consolidation into fewer files makes the repetition more visible.
- Fix: The `json-parse` library already provides `json_construct`, `json_field`, and `json_field_file` abstractions that hide the jq/node branch. For the marker-writing operations that use inline `jq -n` / `node -e`, add a `json_write_marker` helper to `json-parse`:
  ```bash
  # json-parse addition
  json_write_marker() {
    local output_file="$1"; shift
    json_construct "$@" > "$output_file"
  }
  ```
  This would eliminate 6 of the 11 dual-path branches (the marker-writing ones in sidecar-evaluate lines 266-281, 332-347, 390-403, plus sidecar-capture lines 143-160).

### MEDIUM

**Queue-append logic duplicated between sidecar-capture and sidecar-dispatch** - `sidecar-capture:90-104` `sidecar-dispatch:53-67`
**Confidence**: 88%
- Problem: Both hooks contain identical patterns for: (1) defining `QUEUE_FILE`, (2) `umask 077 && touch` for first-time creation, (3) jq/node dual-path JSON line construction with `{role, content, ts}`, (4) appending to the queue file. The only difference is the `role` value ("assistant" vs "user") and the content variable name. If the queue format changes, both sites must be updated in lockstep.
- Fix: Extract an `append_to_queue` function into a shared sourced library:
  ```bash
  # scripts/hooks/queue-append (new sourced helper)
  append_to_queue() {
    local queue_file="$1" role="$2" content="$3" ts="$4"
    if [ ! -f "$queue_file" ]; then
      (umask 077 && touch "$queue_file") 2>/dev/null || true
    fi
    if [ "$_HAS_JQ" = "true" ]; then
      jq -n -c --arg role "$role" --arg content "$content" --argjson ts "$ts" \
        '{role: $role, content: $content, ts: $ts}' >> "$queue_file"
    else
      node -e "process.stdout.write(JSON.stringify({role:process.argv[1],content:process.argv[2],ts:parseInt(process.argv[3])})+'\n')" \
        -- "$role" "$content" "$ts" >> "$queue_file"
    fi
  }
  ```

**9 magic numbers with no named constants** - `sidecar-capture:62,109,110,135` `sidecar-dispatch:98,146` `sidecar-evaluate:75,224,378`
**Confidence**: 82%
- Problem: The following inline literals lack named constants: `2000` (truncation limit, appears twice across capture and dispatch), `200`/`100` (queue overflow thresholds), `120` (memory throttle seconds), `300` (stale processing timeout seconds), `86400` (marker expiry seconds), `3` (min user turns for deep session), `15` (adaptive batch threshold), `7200` (knowledge refresh throttle seconds). Some values like `MAX_DAILY` and `BATCH_SIZE` are properly named, making the inconsistency more noticeable.
- Fix: Add a constants block near the top of each hook or in a shared sourced file:
  ```bash
  # Constants
  TRUNCATE_CHARS=2000
  QUEUE_OVERFLOW_LIMIT=200
  QUEUE_OVERFLOW_KEEP=100
  MEMORY_THROTTLE_SECS=120
  STALE_PROCESSING_SECS=300
  MARKER_EXPIRY_SECS=86400
  MIN_SESSION_TURNS=3
  ADAPTIVE_BATCH_THRESHOLD=15
  KNOWLEDGE_THROTTLE_SECS=7200
  ```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Learning and decisions evaluation sections follow near-identical structural pattern** - `scripts/hooks/sidecar-evaluate:202-295` `scripts/hooks/sidecar-evaluate:301-357`
**Confidence**: 80%
- Problem: Both sections follow the same skeleton: (1) load config with daily max, (2) sanitize with `tr -dc '0-9'`, (3) check daily cap via `read_daily_cap`, (4) extract signals/pairs from transcript, (5) load existing IDs via `load_existing_ids`, (6) write marker with jq/node dual-path, (7) update daily cap. The learning section has additional batch counting logic (lines 236-253) and the field names differ, but the structural duplication means a change to the cap-check-extract-write-update sequence must be applied twice. This is not a blocking concern because the two sections do differ in meaningful ways (batching, field names, no batching for decisions), but it adds ~30 lines that could be shared.
- Fix: A parameterized `evaluate_feature` function could accept the feature name, config file path, filter command, log file, and marker output path. The learning-specific batch counting would remain as a pre-check before calling the shared function.

## Pre-existing Issues (Not Blocking)

### MEDIUM

**Feedback loop guard is repeated identically 3 times** - `sidecar-capture:11-13` `sidecar-dispatch:11-13` `sidecar-evaluate:10-12`
**Confidence**: 80%
- Problem: All three hooks check the same three `DEVFLOW_BG_*` environment variables. If a new background agent type is added, all three files must be updated. The guard is 3 lines per file (9 total), each checking the same set of variables with the same exit behavior.
- Fix: Extract to a shared `sidecar-guard` library:
  ```bash
  # scripts/hooks/sidecar-guard
  [ "${DEVFLOW_BG_UPDATER:-}" = "1" ] && exit 0
  [ "${DEVFLOW_BG_LEARNER:-}" = "1" ] && exit 0
  [ "${DEVFLOW_BG_KNOWLEDGE_REFRESH:-}" = "1" ] && exit 0
  ```
  Then each hook: `source "$SCRIPT_DIR/sidecar-guard"`.

## Suggestions (Lower Confidence)

- **Stale-retry loop in sidecar-dispatch could be extracted** - `scripts/hooks/sidecar-dispatch:88-122` (Confidence: 72%) -- The stale `.processing` recovery loop (lines 88-122) is a 35-line block nested 3-4 levels deep with retry counter logic, `JUST_RECOVERED` tracking, and failure marking. It is the most complex section in sidecar-dispatch and could be a separate `recover_stale_markers` function.

- **Transcript-finding block in sidecar-evaluate uses mixed early-exit patterns** - `scripts/hooks/sidecar-evaluate:55-83` (Confidence: 65%) -- The transcript resolution (lines 55-83) uses an `if/else` for session_id presence, then a separate `if/else` for session depth checking. The fallback path (line 60-62) chains `ls -t | head -1` with two emptiness checks on the same line, which is dense. Extracting this to `find_transcript()` with early returns would flatten the nesting.

- **Embedded Node.js scripts in sidecar-evaluate are untestable** - `scripts/hooks/sidecar-evaluate:165-189` (Confidence: 70%) -- The inline `node -e` blocks (reinforcement fallback path, 25 lines of JavaScript embedded in bash) cannot be unit-tested independently. If the jq path is the primary code path, consider dropping the node fallback for the reinforcement operation specifically, or moving the logic to `json-helper.cjs`.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 3 | 2 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 1 | 0 |

**Complexity Score**: 5/10
**Recommendation**: CHANGES_REQUESTED

The sidecar system consolidates 8 hooks into 3, which is a net positive for architectural simplicity. However, sidecar-evaluate at 415 lines pushes against the maintainability boundary for shell scripts. The four evaluation domains are cleanly separated by banner comments and could be extracted into sourced helpers with minimal effort. The most pressing complexity issue is the 11 jq/node dual-path branches -- 6 of which could be eliminated by extending the existing `json-parse` abstraction layer with a `json_write_marker` helper. The queue-append duplication between capture and dispatch is straightforward to extract. None of these issues are critical, but addressing the HIGH items would bring all three hooks comfortably within the "understand in 5 minutes" standard.
