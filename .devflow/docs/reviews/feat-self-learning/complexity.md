# Complexity Review Report

**Branch**: feat/self-learning -> main
**Date**: 2026-03-23
**PR**: #160

## Issues in Your Changes (BLOCKING)

### CRITICAL

**`background-learning` is a 560-line monolithic bash script with a 397-line "Main" section** - `scripts/hooks/background-learning:164-560`
**Confidence**: 95%
- Problem: The script's main execution block (lines 164-560) is nearly 400 lines of inline logic. While the utility functions at the top (lines 19-162) are reasonably factored, the main section combines temporal decay processing, LLM invocation, observation loop processing (110 lines, lines 365-474), artifact creation (77 lines, lines 479-555), and counter management into one unstructured flow. The overall 560-line file far exceeds the 300-line file-length warning threshold and the 500-line critical threshold.
- Fix: Extract the main section into named functions: `apply_temporal_decay()`, `invoke_model()`, `process_observations()`, `create_artifacts()`. Each becomes independently testable and comprehensible. The main section becomes a ~20-line orchestration sequence calling these functions in order.

**`session-start-memory` Section 1.75 reaches nesting depth 10** - `scripts/hooks/session-start-memory:131-237`
**Confidence**: 95%
- Problem: The "Learned Behaviors" section added at lines 131-237 (106 new lines) contains two `while IFS= read` loops that iterate the same JSONL file. The second loop (new-artifact notification, lines 193-215) reaches nesting depth 10: `if > while > if > if > if > if > if > if > if > if`. This is double the critical threshold of 5. The logic at depth 10 (lines 206-212) is choosing between workflow/skill artifact notification text, buried beneath layers of status checks, date parsing, and epoch comparisons.
- Fix: Extract the two loops into functions: `build_learned_summary()` and `detect_new_artifacts()`. Each function reads the JSONL once, returns a string, and operates at max depth 3-4. The calling code becomes:
  ```bash
  LEARNED_SUMMARY=$(build_learned_summary "$LEARNING_LOG")
  NEW_ARTIFACTS=$(detect_new_artifacts "$LEARNING_LOG" "$NOTIFIED_MARKER")
  ```

### HIGH

**`learn.ts` action handler is a 233-line single function with 26 decision points** - `src/cli/commands/learn.ts:231-463`
**Confidence**: 90%
- Problem: The `.action(async (options) => { ... })` handler spans lines 231-463 (233 lines) with 26 decision points (cyclomatic complexity ~26). It handles 6 distinct sub-commands (`--status`, `--list`, `--configure`, `--clear`, `--enable`, `--disable`) all in one closure via early-return `if` chains. Each sub-command block duplicates `process.cwd()` resolution (4 times), `learning-log.jsonl` path construction (3 times), and `parseLearningLog()` calls (2 times). This is a known anti-pattern for this codebase -- PF-002 documents the same monolith problem in `init.ts`.
- Fix: Extract each sub-command into a named async function: `handleStatus()`, `handleList()`, `handleConfigure()`, `handleClear()`, `handleEnable()`, `handleDisable()`. Hoist shared values (`cwd`, `logPath`, `settingsPath`, `settingsContent`) to the action handler top-level before dispatching. The action handler becomes a ~20-line dispatcher.

**Observation processing loop has 5 nesting levels with duplicated temporal-spread logic** - `scripts/hooks/background-learning:365-474`
**Confidence**: 88%
- Problem: The observation processing `for` loop (110 lines) contains the temporal-spread check duplicated at two locations (lines 399-408 and lines 413-425). Both blocks compute `FIRST_EPOCH` from `$FIRST_SEEN` using the same cross-platform `date` fallback pattern (lines 400-402 and 415-417). The combined if-chain for determining `STATUS` (lines 399-426) has 5 nesting levels and interleaves two separate concerns: temporal-spread validation and confidence-based promotion.
- Fix: Extract a `compute_status()` function that takes `$OBS_TYPE`, `$CONF_RAW`, `$FIRST_SEEN`, and current `$STATUS` and returns the new status. The temporal-spread calculation appears once inside that function. Call it from the loop: `STATUS=$(compute_status "$OBS_TYPE" "$CONF_RAW" "$FIRST_SEEN" "$STATUS")`.

### MEDIUM

**Cross-platform date parsing is duplicated 3 times across `background-learning`** - `scripts/hooks/background-learning:212-214,400-402,415-417`
**Confidence**: 85%
- Problem: The pattern `date -j -f "%Y-%m-%dT%H:%M:%SZ" "$VAR" +%s 2>/dev/null || date -d "$VAR" +%s 2>/dev/null || echo "fallback"` appears 3 times in `background-learning` and once more in `session-start-memory:200-202`. This is a maintenance risk -- if the date format changes or a third platform needs support, 4 locations need updating.
- Fix: Extract to a reusable function:
  ```bash
  parse_iso_epoch() {
    date -j -f "%Y-%m-%dT%H:%M:%SZ" "$1" +%s 2>/dev/null \
      || date -d "$1" +%s 2>/dev/null \
      || echo "${2:-0}"
  }
  ```
  Place it in `background-learning` near the other utility functions and source it from `session-start-memory`, or add it to a shared helpers file.

**5 repeated `p.isCancel()` guard blocks in `learn.ts` configure sub-command** - `src/cli/commands/learn.ts:295-376`
**Confidence**: 82%
- Problem: The `--configure` section (lines 295-376, 82 lines) contains 5 nearly identical cancel-guard blocks:
  ```typescript
  if (p.isCancel(value)) {
    p.cancel('Configuration cancelled.');
    return;
  }
  ```
  Each prompt (`maxRuns`, `throttle`, `model`, `scope`) is followed by the same 3-line block. This inflates the function length and adds visual noise.
- Fix: Create a helper that wraps prompt calls:
  ```typescript
  async function promptOrCancel<T>(prompt: Promise<T | symbol>): Promise<T> {
    const result = await prompt;
    if (p.isCancel(result)) { p.cancel('Configuration cancelled.'); throw new CancelError(); }
    return result as T;
  }
  ```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**`session-start-memory` reads `learning-log.jsonl` twice in separate while-loops** - `scripts/hooks/session-start-memory:140-171,193-215`
**Confidence**: 85%
- Problem: The added section iterates the entire JSONL file once to build the learned summary (lines 140-171), then iterates it again to detect new artifacts (lines 193-215). Both loops perform the same `jq -e .` validation and `jq -r '.status'` extraction. For a 100-entry log file (the cap), this means 200 `jq` invocations in two passes.
- Fix: Merge into a single pass that collects both the summary strings and the new-artifact notifications simultaneously.

## Pre-existing Issues (Not Blocking)

### MEDIUM

**`init.ts` action handler remains a monolith (PF-002)** - `src/cli/commands/init.ts`
**Confidence**: 90%
- Problem: The PR adds ~30 more lines (learning prompt + hook wiring) to the already-765-line action handler documented in PF-002. The handler now manages 5 feature toggles (teams, ambient, memory, learn, hud) each with their own prompt/flag/default logic. This is informational only per PF-002's deferred resolution.

## Suggestions (Lower Confidence)

- **Embedded 48-line LLM prompt string** - `scripts/hooks/background-learning:255-301` (Confidence: 70%) -- The prompt template is inlined as a bash heredoc-style string. If the prompt needs iteration (likely for a learning system), editing a bash-escaped multi-line string is error-prone. Consider moving it to a separate template file.

- **Magic numbers in confidence/threshold calculations** - `scripts/hooks/background-learning:388-396,405,420,491,498` (Confidence: 65%) -- Values like `70` (confidence threshold), `86400` (24h in seconds), `95` (confidence cap), `100` (max entries) are scattered throughout. Named constants at the top would improve readability.

- **`learn.ts` devflowDir resolution heuristic** - `src/cli/commands/learn.ts:408-421` (Confidence: 65%) -- The enable/disable path resolves `devflowDir` by parsing the first Stop hook's command path and walking up 3 parent directories. This is fragile if hook command format changes.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 2 | 2 | 2 | - |
| Should Fix | - | - | 1 | - |
| Pre-existing | - | - | 1 | - |

**Complexity Score**: 3/10
**Recommendation**: CHANGES_REQUESTED

The two CRITICAL findings -- a 560-line shell script with a 397-line unstructured main section, and nesting depth reaching 10 levels -- represent significant maintainability risk for a system that will need ongoing tuning (learning thresholds, prompt iteration, new artifact types). The `learn.ts` action handler repeats the exact anti-pattern documented in PF-002 for `init.ts`. Extracting named functions in both the bash scripts and the TypeScript CLI would bring all files within acceptable complexity thresholds without changing any behavior.
