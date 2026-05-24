# Performance Review Report

**Branch**: feat/bug-analysis -> main
**Date**: 2026-05-24

## Issues in Your Changes (BLOCKING)

### HIGH

**Snyk Code invoked per-file via xargs -I{} -- O(n) tool invocations instead of batch** - `plugins/devflow-bug-analysis/commands/bug-analysis.md:106`
**Confidence**: 85%
- Problem: The Snyk Code invocation uses `xargs -d '\n' -I{} timeout 300 snyk code test --sarif --file={} 2>/dev/null`, which spawns one `snyk code test` process per changed file. Snyk Code startup includes project initialization, rule loading, and authentication -- each invocation pays that fixed cost. On a branch with 20+ changed files, this means 20+ sequential snyk processes at up to 300 seconds timeout each. In contrast, the Semgrep invocation correctly batches all files into a single `semgrep scan` call.
- Impact: Total static analysis wall-clock time scales linearly with file count -- O(n) tool starts instead of O(1). A 20-file branch could spend 20x the tool startup overhead compared to a single batched invocation. The 300-second timeout per file means worst-case total timeout is 300s * n rather than 300s.
- Fix: Snyk Code's `--include` flag accepts multiple patterns in a single invocation. Replace the per-file `xargs -I{}` pattern with a batched invocation:
  ```bash
  # Build include patterns from changed files and pass to a single snyk invocation
  INCLUDE_ARGS=$(git diff --name-only {DIFF_RANGE} | sed 's/^/--include=/' | tr '\n' ' ')
  timeout 300 snyk code test --sarif ${INCLUDE_ARGS} 2>/dev/null
  ```
  Alternatively, if `--include` does not support this syntax, use `--file` with comma-separated paths or pipe the file list once. The key invariant is one snyk process per analysis run, not one per file.

**Redundant `git diff --name-only` invocations across phases -- same diff computed 3+ times** - `plugins/devflow-bug-analysis/commands/bug-analysis.md:66,99,106,166`
**Confidence**: 82%
- Problem: `git diff --name-only {DIFF_RANGE}` is executed independently in Step 2b (line 66), piped to Semgrep (line 99), piped to Snyk (line 106), and again in Phase 4 (line 166). Each invocation walks the same git object graph. While `git diff --name-only` is fast for typical branches, this is a command markdown template that orchestrators follow literally -- four separate subprocess spawns for identical output.
- Impact: Minor per-invocation cost (git is fast), but the pattern is wasteful and could become noticeable on large monorepo branches with thousands of changed files. More importantly, it creates a consistency risk -- if the working tree changes between invocations (e.g., a parallel process commits), different phases could see different file lists.
- Fix: Compute the changed file list once in Step 2b and reference it as a variable throughout subsequent steps:
  ```bash
  # Step 2b: compute once, reuse everywhere
  CHANGED_FILES=$(git diff --name-only {DIFF_RANGE})
  if [ -z "$CHANGED_FILES" ]; then echo "No changes to analyze."; exit 0; fi
  ```
  Then reference `$CHANGED_FILES` in Steps 2d (Semgrep, Snyk) and Phase 4 instead of re-running the git command.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Static analysis tools run sequentially (semgrep then snyk then codeql) instead of in parallel** - `plugins/devflow-bug-analysis/commands/bug-analysis.md:96-121`
**Confidence**: 80%
- Problem: Step 2d runs Semgrep, Snyk Code, and CodeQL sequentially. Semgrep and Snyk operate on independent input (file list) and produce independent output (SARIF). They could run in parallel to reduce total wall-clock time. CodeQL has a conditional dependency on Semgrep/Snyk results (only runs if HIGH/CRITICAL findings found or `--full`), so it legitimately needs to wait, but Semgrep and Snyk are fully independent.
- Impact: On a system with both Semgrep and Snyk available, the total static analysis time is `semgrep_time + snyk_time` instead of `max(semgrep_time, snyk_time)`. Semgrep typically runs in 10-30 seconds; Snyk Code in 15-60 seconds. Parallelizing could save 15-30 seconds per analysis run (applies ADR-006 -- hybrid architecture should maximize the speed advantage of static tools).
- Fix: Document that Semgrep and Snyk should be run in parallel (background the first, wait for both):
  ```bash
  # Run semgrep and snyk in parallel
  echo "$CHANGED_FILES" | xargs -d '\n' timeout 300 semgrep scan --config auto --sarif --quiet 2>/dev/null > semgrep.sarif &
  SEMGREP_PID=$!
  echo "$CHANGED_FILES" | xargs -d '\n' timeout 300 snyk code test --sarif 2>/dev/null > snyk.sarif &
  SNYK_PID=$!
  wait $SEMGREP_PID $SNYK_PID
  # Then conditionally run CodeQL based on combined results
  ```

## Pre-existing Issues (Not Blocking)

(No pre-existing performance issues identified in unchanged code at CRITICAL severity.)

## Suggestions (Lower Confidence)

- **Feature knowledge staleness checks are sequential per-slug** - `plugins/devflow-bug-analysis/commands/bug-analysis.md:147` (Confidence: 65%) -- Phase 3 checks staleness for each matched feature knowledge slug sequentially via `node ~/.devflow/scripts/hooks/lib/feature-knowledge.cjs stale`. If many slugs match, this spawns N node processes. Low impact in practice since most projects have fewer than 5 knowledge bases.

- **CodeQL timeout budget is 1200s total (600s create + 600s analyze)** - `plugins/devflow-bug-analysis/commands/bug-analysis.md:114-115` (Confidence: 70%) -- The two sequential `timeout 600` commands for CodeQL database creation and analysis sum to a 20-minute worst case. This is appropriate for CodeQL's computational cost, but worth noting as the dominant latency contributor when CodeQL is active. No change needed -- CodeQL is already gated behind `--full` or HIGH/CRITICAL findings.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 2 | 0 | - |
| Should Fix | - | 0 | 1 | - |
| Pre-existing | - | - | 0 | 0 |

**Performance Score**: 7/10
**Recommendation**: CHANGES_REQUESTED

The two HIGH blocking issues -- per-file Snyk invocation and redundant git diff executions -- should be addressed before merge. The per-file Snyk pattern (line 106) is the most impactful: it turns an O(1) tool invocation into O(n) with high per-invocation fixed cost. The sequential static tool execution (MEDIUM) is a worthwhile optimization but not blocking. Overall, the pipeline architecture is sound -- parallel BugAnalyzer agents, incremental diffing, bounded static findings (top 50, 200-char truncation) -- demonstrating good performance awareness in the design.
