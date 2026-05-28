# Complexity Review Report

**Branch**: fix/stop-hook-field-rename -> main
**Date**: 2026-05-27

## Issues in Your Changes (BLOCKING)

### HIGH

**Repetitive debug instrumentation boilerplate across 7 hooks (pattern duplication)** - `scripts/hooks/sidecar-capture:8-18`, `scripts/hooks/sidecar-dispatch:8-22`, `scripts/hooks/sidecar-evaluate:7-21`, `scripts/hooks/session-start-memory:7-17`, `scripts/hooks/session-start-context:11-22`, `scripts/hooks/pre-compact-memory:10-19`, `scripts/hooks/preamble:7-17`
**Confidence**: 85%
- Problem: Every hook now includes an identical 4-line preamble (no-op `dbg`, source debug-trace, `devflow_debug_init`, `dbg "=== HOOK START ==="`) plus a near-identical 4-line logging setup block (source log-paths, compute LOG_DIR, LOG_FILE, define `log()`). This is 8-10 lines of boilerplate duplicated 7 times. While the debug-trace sourcing itself is correctly factored out, the initialization ceremony in each consumer is not. The logging setup block (lines 40-44 in `pre-compact-memory`, lines 46-50 in `session-start-context`, lines 37-41 in `session-start-memory`, lines 58-61 in `sidecar-capture`, lines 44-48 in `sidecar-dispatch`) follows the exact same pattern with only the hook name differing.
- Fix: Consider a single `init-hook` sourced helper that accepts the hook name and CWD, sets up both debug tracing and normal logging in one call:
```bash
# In each hook, replace 8-10 lines with:
source "$SCRIPT_DIR/init-hook" "sidecar-capture" "$CWD"
```
This would collapse the repeated ceremony into the helper while keeping the no-op `dbg()` fallback (which must remain before the source for set -e safety).

## Issues in Code You Touched (Should Fix)

### MEDIUM

**sidecar-evaluate at 496 lines exceeds critical file length threshold** - `scripts/hooks/sidecar-evaluate`
**Confidence**: 90%
- Problem: `sidecar-evaluate` is now 496 lines (was 465 on main). The complexity skill flags files over 500 lines as CRITICAL and 300-500 as WARNING. This file handles 4 major concerns (artifact reinforcement, learning evaluation, decisions evaluation, knowledge evaluation) in a single script. The 31 new `dbg` lines pushed it closer to the critical threshold. Each section has deep nesting (reinforcement: 7 levels, learning: 6 levels, decisions: 4 levels, knowledge: 5 levels). The reinforcement section alone (lines 167-241) contains a jq pipeline with 15+ lines of inline jq code and a node fallback of similar length. This is a pre-existing structural issue that the PR's debug instrumentation exacerbates.
- Fix: The four evaluation sections are already separated by comment banners. Each could be extracted into sourced helper scripts (e.g., `sidecar-eval-learning`, `sidecar-eval-decisions`, `sidecar-eval-knowledge`, `sidecar-eval-reinforce`), reducing the main script to a dispatcher. This is a larger refactor best done in a follow-up PR. Applies PF-004 thinking (avoids PF-004 -- migration complexity) by not changing behavior, only file organization.

**Dual logging systems (dbg + log) in every hook increase cognitive load** - `scripts/hooks/sidecar-capture:61,71-79`, `scripts/hooks/session-start-memory:41,149-155`
**Confidence**: 82%
- Problem: After this PR, every hook now has TWO parallel logging paths: `dbg()` for debug tracing (gated by `DEVFLOW_HOOK_DEBUG=1`) and `log()` for normal logging (always-on, writes to per-project log files). Many exit points and state transitions now have BOTH a `dbg` and a `log` call with nearly identical messages (e.g., sidecar-capture lines 136-137: `log "Queue overflow..."` + `dbg "Queue overflow..."`; lines 150-151: `log "Throttled..."` + `dbg "EXIT: memory.processing exists"`). This dual-call pattern adds cognitive overhead for future maintainers who must remember to update both when modifying control flow.
- Fix: Consider having `log()` automatically call `dbg()` with the same message (or vice versa), so only one call site is needed. When debug mode is active, `dbg()` is already writing to a separate file, so having `log()` proxy to `dbg()` provides unified tracing without duplicate call sites.

## Pre-existing Issues (Not Blocking)

### HIGH

**sidecar-evaluate reinforcement section nesting depth reaches 7 levels** - `scripts/hooks/sidecar-evaluate:167-241`
**Confidence**: 92%
- Problem: The artifact reinforcement block has 7 levels of nesting: `if LEARNING_ENABLED` > `if LEARNING_LOG exists` > `if LOADED_SLUGS non-empty` > `if lock acquired` > `if _HAS_JQ` > `if jq succeeded` > `if files differ`. This exceeds the critical threshold of 4+ levels per the complexity skill. The node fallback path mirrors this depth.
- Fix: Apply early-return/early-continue pattern. Guard clauses at the top of each section can flatten 2-3 nesting levels. For example:
```bash
# Instead of if/fi wrapping 75 lines:
[ "$LEARNING_ENABLED" != "true" ] && skip to next section
[ ! -f "$LEARNING_LOG" ] && skip
LOADED_SLUGS=... ; [ -z "$LOADED_SLUGS" ] && skip
sidecar_lock_acquire ... || { log "skipped"; skip; }
# Now core logic runs at 3 levels instead of 7
```

## Suggestions (Lower Confidence)

- **Conditional jq key dump in sidecar-capture** - `scripts/hooks/sidecar-capture:33` (Confidence: 65%) -- Line 33 re-checks `DEVFLOW_HOOK_DEBUG` inside the script body despite `devflow_debug_init` already gating `dbg()`. This is technically correct (the jq call should only run when debugging) but introduces a second debug-gating pattern alongside the `dbg()` no-op approach, adding mild cognitive complexity.

- **PROMPT_LENGTH logged twice in sidecar-dispatch** - `scripts/hooks/sidecar-dispatch:34,66` (Confidence: 70%) -- `PROMPT_LENGTH` is logged at line 34 and again at line 66 with identical content. The second instance adds `MEMORY_ENABLED` context but could be consolidated.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 0 | 0 |
| Should Fix | 0 | 0 | 2 | 0 |
| Pre-existing | 0 | 1 | 0 | 0 |

**Complexity Score**: 7/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The core changes (field rename from `response_text`/`stop_reason` to `last_assistant_message`, removal of dead `stop_reason` filter) are clean simplifications that reduce complexity. The debug tracing system (`debug-trace` helper) is well-designed -- zero overhead when disabled, two-phase logging, and proper no-op fallback. The CLI command (`debug.ts`) is concise at 73 lines with clear control flow.

The main complexity concern is the boilerplate multiplication: 7 hooks each gained ~15-20 lines of nearly identical initialization and dual-logging calls. This is manageable now but creates a maintenance surface area that grows with each new hook. Extracting the initialization ceremony into a shared helper would reduce this before it compounds further. The sidecar-evaluate file size (496 lines, 4 major sections, nesting up to 7 levels) is approaching the critical threshold and warrants attention in a follow-up.
