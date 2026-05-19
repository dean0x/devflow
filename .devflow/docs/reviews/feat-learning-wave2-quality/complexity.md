# Complexity Review Report

**Branch**: feat-learning-wave2-quality -> main
**Date**: 2026-03-25
**PR**: #162

## Issues in Your Changes (BLOCKING)

### HIGH

**`process_observations()` function exceeds complexity thresholds (128 lines, ~15 cyclomatic complexity, 5 nesting levels)** - `scripts/hooks/background-learning:445-573`
**Confidence**: 92%
- Problem: The `process_observations()` function spans 128 lines (threshold: 50 for "warning", 50+ for "critical") with approximately 15 decision points (for-loop, multiple if/else branches, nested conditionals for temporal spread, jq/node branching, existing vs new observation paths). Nesting reaches 4-5 levels inside the for-loop body (for -> if existing -> if status != created -> if spread). The function handles field extraction, validation, existence checks, confidence calculation, temporal spread checking, status determination, JSON construction, and file updates -- at least 8 distinct responsibilities in one function.
- Impact: Difficult to test any single behavior in isolation; a bug in temporal spread logic silently affects confidence calculation. This was flagged as PF-004 in known pitfalls ("Background hook scripts become untestable god scripts") and the function grew rather than shrank in this PR.
- Fix: Extract into focused helper functions. For example:
  ```bash
  # Extract these as separate functions:
  validate_observation()     # lines 469-480 (field validation + ID format check)
  calculate_confidence()     # lines 500-504 (confidence math)
  check_temporal_spread()    # lines 506-530 (spread logic, used twice in original)
  update_existing_obs()      # lines 488-552 (the "existing" branch)
  create_new_obs()           # lines 553-571 (the "new" branch)
  ```
  This would reduce `process_observations` to a ~30-line orchestrator loop.

**Duplicate temporal spread calculation within `process_observations()`** - `scripts/hooks/background-learning:508-517` and `scripts/hooks/background-learning:521-530`
**Confidence**: 95%
- Problem: The temporal spread epoch calculation (`date -j -f ... || date -d ... || echo "0"`) and comparison against 86400 appears twice in the same function, within ~20 lines of each other. The first block (lines 508-517) checks spread to set status to "observing" when insufficient. The second block (lines 521-530) checks spread again to set status to "ready". Both compute `FIRST_EPOCH` and `NOW_EPOCH` identically.
- Impact: Maintenance burden -- any fix to date parsing or threshold must be applied twice. Risk of the two copies diverging over time (a classic source of subtle bugs in shell scripts).
- Fix: Extract a single `check_temporal_spread()` function and call it once:
  ```bash
  check_temporal_spread() {
    local first_seen="$1"
    FIRST_EPOCH=$(date -j -f "%Y-%m-%dT%H:%M:%SZ" "$first_seen" +%s 2>/dev/null \
      || date -d "$first_seen" +%s 2>/dev/null \
      || echo "0")
    NOW_EPOCH=$(date +%s)
    SPREAD=$((NOW_EPOCH - FIRST_EPOCH))
  }
  ```
  Then use `SPREAD` in a single status-determination block.

### MEDIUM

**`reinforce_loaded_artifacts()` uses per-line JSON parsing in a while-read loop** - `scripts/hooks/session-end-learning:108-131`
**Confidence**: 85%
- Problem: The function iterates every line of `learning-log.jsonl`, spawning `json_field` subprocesses (2 calls per line minimum: `status` and `artifact_path`, plus conditionally `json_update_field`). This is the same pattern flagged in PF-006 (per-line jq spawning adds latency). While this runs in the SessionEnd hook (not background), it still executes synchronously before the session fully exits.
- Impact: At 50+ observations, this adds measurable latency to every session end. The function also has 4 nesting levels (while -> if status=created -> if grep commands -> if grep loaded).
- Fix: Use a single-pass `jq -s` or batch the `json_update_field` calls. Example with jq:
  ```bash
  reinforce_loaded_artifacts() {
    local learning_log="$MEMORY_DIR/learning-log.jsonl"
    [ ! -f "$learning_log" ] && return
    local loaded
    loaded=$(grep -oE 'self-learning[:/][a-z0-9-]+' "$TRANSCRIPT" 2>/dev/null | sort -u || true)
    [ -z "$loaded" ] && return
    local now_iso
    now_iso=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
    local slugs_regex
    slugs_regex=$(echo "$loaded" | tr '\n' '|' | sed 's/|$//')
    # Single jq pass
    jq -c --arg now "$now_iso" --arg pat "$slugs_regex" '
      if .status == "created" and .artifact_path and
         (.artifact_path | test($pat)) then .last_seen = $now
      else . end
    ' "$learning_log" > "${learning_log}.tmp" && mv "${learning_log}.tmp" "$learning_log"
  }
  ```

**`session-end-learning` main body is a 203-line procedural script with no function decomposition for the batching section** - `scripts/hooks/session-end-learning:142-203`
**Confidence**: 82%
- Problem: Lines 142-203 (the batching + daily cap + spawning section) are top-level imperative code, not wrapped in a function. The script has a clean function for reinforcement (`reinforce_loaded_artifacts`) but the equally complex batching logic (adaptive batch size, deduplication, daily cap check, file management, background spawn) is inline. This makes the script harder to reason about as a whole -- you need to read all 203 lines sequentially.
- Impact: Cannot test the batching logic independently from the guard clauses and reinforcement. Moderate readability concern since the flow comment at the top helps, but the code itself lacks structure.
- Fix: Extract a `run_batch_check()` function wrapping lines 142-201, keeping the top-level script as a linear sequence of function calls:
  ```bash
  # Main flow becomes:
  reinforce_loaded_artifacts
  run_batch_check   # encapsulates batching, cap check, spawn
  ```

**`build_sonnet_prompt()` embeds a 90-line heredoc string** - `scripts/hooks/background-learning:271-374`
**Confidence**: 80%
- Problem: The `build_sonnet_prompt()` function is ~103 lines, of which ~90 are a multi-line string assignment containing the full LLM prompt (instructions, templates, rules, JSON schema). While the logic itself is simple (build string), the sheer length makes the function hard to navigate and the prompt hard to edit independently.
- Impact: LOW on correctness (it is just string construction), but MEDIUM on maintainability -- editing the prompt template requires scrolling through the function and carefully managing shell quoting. The skill template and naming rules sections (added in this PR) made it longer.
- Fix: Move the prompt template to a separate file (e.g., `scripts/hooks/learning-prompt.txt`) and read it with parameter substitution, or at minimum add section comments within the heredoc.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**`background-learning` file length: 724 lines** - `scripts/hooks/background-learning`
**Confidence**: 88%
- Problem: The file is 724 lines (critical threshold: >500). It contains 15+ functions plus a main orchestration section. While individual functions are mostly reasonable in size (except `process_observations`), the total file complexity is high. This PR added ~60 net lines (batch extraction, skill template in prompt, early-return guards) pushing it further past the threshold.
- Impact: This is the same concern as PF-004. The script concentrates locking, config, transcript extraction, decay, LLM invocation, response processing, observation management, and artifact creation in one file.
- Fix: Per PF-004's resolution, move JSON-heavy logic to TypeScript. At minimum, the skill/command template strings could be externalized.

**`create_artifacts()` function: 85 lines with 4 nesting levels** - `scripts/hooks/background-learning:577-662`
**Confidence**: 83%
- Problem: The function is 85 lines with a for-loop body containing multiple if/else branches (type checks, status validation, file existence, content writing). Nesting reaches 4 levels (for -> if type=command/else -> if/else for writing).
- Impact: Moderately difficult to follow the branching; the command vs. skill path difference is small but spread across many lines.
- Fix: Extract `write_command_artifact()` and `write_skill_artifact()` helpers to reduce the for-loop body.

## Pre-existing Issues (Not Blocking)

### HIGH

**`learnCommand.action()` handler: 283 lines, ~25 cyclomatic complexity** - `src/cli/commands/learn.ts:267-550`
**Confidence**: 90%
- Problem: The `.action()` handler spans lines 267-550 (283 lines) with 7 top-level flag branches (`--status`, `--list`, `--configure`, `--purge`, `--clear`, `--enable`, `--disable`), each containing its own try/catch and async file operations. This is a minor echo of PF-002 (init handler monolith).
- Impact: While each branch is independently readable, the combined function exceeds all complexity thresholds. Testing requires mocking the entire CLI context.
- Fix: Extract each flag handler into a separate async function (e.g., `handleStatus()`, `handleList()`, `handleConfigure()`).

## Suggestions (Lower Confidence)

- **Magic number 86400 (seconds in a day) used in 3 places** - `scripts/hooks/background-learning:514,527` and `scripts/hooks/session-end-learning` prompt text (Confidence: 70%) -- Consider defining `SECONDS_PER_DAY=86400` as a named constant at the top of `background-learning`.

- **`extract_batch_messages()` has nested string-building conditionals** - `scripts/hooks/background-learning:179-187` (Confidence: 65%) -- The USER_MESSAGES concatenation uses an if/else to handle the separator differently for the first session vs subsequent sessions. A simpler pattern would initialize with a separator and trim the leading one.

- **`removeLearningHook` inner function uses non-null assertions (!)** - `src/cli/commands/learn.ts:110-111` (Confidence: 62%) -- `settings.hooks![event]!.length` uses two non-null assertions. While safe in context (checked above), it reduces type safety. Could restructure to avoid assertions.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 2 | 3 | 0 |
| Should Fix | 0 | 0 | 2 | 0 |
| Pre-existing | 0 | 1 | 0 | 0 |

**Complexity Score**: 5/10
**Recommendation**: CHANGES_REQUESTED

The PR meaningfully simplifies some areas (unified confidence thresholds for both types, deduplicated artifact naming via `artifactName()` helper, `removeLearningHook` refactored with `removeFromEvent()` inner function). However, the core `process_observations()` function remains the script's primary complexity hotspot and grew slightly in this PR. The duplicate temporal spread calculation is a clear complexity violation that should be fixed. The new `session-end-learning` script is reasonably structured but would benefit from function extraction for the batching section. The known pitfall PF-004 (god script) was not addressed and the file grew to 724 lines.
