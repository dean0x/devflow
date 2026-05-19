# Performance Review Report

**Branch**: feat/evaluator-rename-tester-agent -> main
**Date**: 2026-04-03

## Issues in Your Changes (BLOCKING)

### CRITICAL

(none)

### HIGH

**Additional agent spawn in /implement pipeline increases wall-clock time** - `plugins/devflow-implement/commands/implement.md:283-319`, `plugins/devflow-implement/commands/implement-teams.md:797-834`
**Confidence**: 85%
- Problem: The new Phase 13 (QA Testing) adds a mandatory Tester agent spawn to every `/implement` run. The Tester is assigned model `sonnet` and executes 5-8 Bash scenarios sequentially. With the retry loop (up to 2 retries), the worst case adds 3 Tester spawns + 2 Coder spawns + 2 Validator spawns = 7 additional agent invocations. Before this PR, the pipeline had 13-15 phases; now it has 16. Each Tester invocation involves scenario design, execution, and evidence collection, which on a Sonnet model could add 30-90 seconds per invocation.
- Fix: This is an intentional design decision for quality gates, so the cost is justified. However, consider adding an early exit in the Tester agent for simple/trivial changes. The testability assessment (Responsibility 1 in `tester.md:25`) does handle doc-only changes by reporting PASS immediately, which mitigates the cost for non-code changes. No code change needed -- this is a "should-be-aware" finding rather than a bug.

### MEDIUM

**Dev server polling loop uses fixed 30s timeout with no early-success optimization** - `shared/agents/tester.md:96-98`
**Confidence**: 82%
- Problem: The dev server readiness check polls `curl` every 2 seconds for up to 15 attempts (30s total). This is a fixed polling interval with no exponential backoff or early-success shortcut. Most dev servers start in 2-5 seconds, so the 2-second interval is reasonable, but the agent will always wait the full interval even if the server responds on the first try within the same iteration.
- Fix: The polling design is adequate for the use case. The 2-second fixed interval is simple and avoids the complexity of backoff. The `curl` check per iteration does provide early success detection within each poll cycle. No change needed.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Shell pipeline change in background-memory-update removes `tail -3` pre-filter, potentially processing more lines** - `scripts/hooks/background-memory-update:3-9`
**Confidence**: 83%
- Problem: The old code used `tail -3` to limit grep output to the last 3 JSON lines before piping through the `while` loop with `json_extract_messages`. The new code removes `tail -3` and instead pipes the full `grep` output through the while loop, adding `awk 'NF'` (skip blank lines) and then `tail -1`. For large transcript files (thousands of lines), this means the `while` loop spawns a `printf` + `json_extract_messages` subprocess for every matching line instead of just the last 3. Each iteration spawns a subshell with `json_extract_messages` (which internally calls jq or node).
- Fix: Re-add the `tail -3` pre-filter before the while loop to bound the number of subprocess invocations:
  ```bash
  last_user=$(grep '"type":"user"' "$transcript" 2>/dev/null \
    | tail -3 \
    | while IFS= read -r line; do printf '%s\n' "$line" | json_extract_messages; done \
    | awk 'NF' \
    | tail -1)
  ```
  This preserves the `echo` → `printf` fix and the `awk 'NF'` blank-line filter while bounding the loop to 3 iterations. The same pattern applies to the `last_assistant` extraction below it.

## Pre-existing Issues (Not Blocking)

### MEDIUM

**Per-line jq spawning in session-start hooks (PF-006)** - Known pitfall
**Confidence**: 95%
- Problem: PF-006 in `.memory/knowledge/pitfalls.md` documents that while-read loops in session-start hooks spawn 3-6 jq subprocesses per JSONL line, adding 1-3s latency at 100 entries. The resolution (single-pass `jq -s` slurp operations) has not been applied in this PR.
- Fix: This is a pre-existing issue tracked as PF-006. Not introduced by this PR. The `background-memory-update` changes in this PR actually make the pattern slightly worse by removing the `tail -3` pre-filter (see Should-Fix above).

## Suggestions (Lower Confidence)

- **Tester agent lacks `tools` frontmatter restriction** - `shared/agents/tester.md` (Confidence: 72%) -- The Tester agent does not declare a `tools` frontmatter field. Per CLAUDE.md convention, agents should "Use `tools` frontmatter to platform-restrict agent tool access." Without it, the Tester has access to all tools including Write and Edit, which it should never use per its own Boundaries section. While not a performance issue per se, unrestricted tool access means the model may waste tokens attempting tool calls that violate its own contract.

- **Legacy cleanup loops are O(n) per legacy name but bounded** - `src/cli/utils/installer.ts:81-87`, `src/cli/plugins.ts` (Confidence: 65%) -- The new `LEGACY_AGENT_NAMES` cleanup loop iterates over legacy agent names and calls `fs.rm` for each. Currently the array has 1 entry (`shepherd`), so cost is negligible. As legacy lists grow over versions, each `fs.rm` attempt on a non-existent file is a syscall that returns ENOENT. This is a micro-concern with no practical impact at current scale.

- **Tester browser scenarios depend on Chrome MCP availability at runtime** - `shared/agents/tester.md:112-125` (Confidence: 68%) -- Browser scenario execution requires Chrome MCP tools which involve network round-trips to a browser instance. The graceful degradation (skip if unavailable) is well-designed, but when Chrome MCP IS available, each browser scenario involves multiple tool calls (navigate, read, find, interact, assert, check console) -- potentially 6+ tool calls per scenario. For 5-8 scenarios, that is 30-48 tool calls for the browser subset alone. This is inherent to browser testing and the design handles it correctly with fallback to curl.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 1 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 1 | 0 |

**Performance Score**: 8/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The PR adds one new agent phase (Tester) to the `/implement` pipeline, which is an intentional quality gate with bounded cost. The main actionable finding is the removal of `tail -3` in `background-memory-update` which unbounds the subprocess loop for large transcripts. This should be restored to maintain the previous O(1) behavior for the common case. The `echo` → `printf` fix and `awk 'NF'` additions are correct and welcome improvements. The new Tester agent and QA skill are well-designed with proper graceful degradation for missing infrastructure and non-testable changes.
