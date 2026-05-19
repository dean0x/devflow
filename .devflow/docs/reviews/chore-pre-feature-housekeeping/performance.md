# Performance Review Report

**Branch**: chore/pre-feature-housekeeping -> main
**Date**: 2026-03-20
**Commits reviewed**: 4 (bf5fe82, 86dbaf9, 6bfa550, 3953645)

## Issues in Your Changes (BLOCKING)

### MEDIUM

**`get_mtime()` calls `stat` twice on macOS (probe + read)** - `scripts/statusline.sh:15-22`
**Confidence**: 82%
- Problem: The `get_mtime()` helper first runs `stat -f %m` to probe if it works (discarding the output to `/dev/null`), then runs the exact same `stat -f %m` again to capture the value. This forks two processes per call when one would suffice. The function is called twice per statusline invocation (line 83 and line 203), so the statusline spawns 4 `stat` processes instead of 2 on macOS.
- Impact: Minor per-invocation cost (~4ms extra fork overhead). The statusline runs on every prompt render, so it adds up across a session, though each individual call is small.
- Fix: Capture the output on the first attempt and only re-run on failure:
```bash
get_mtime() {
    local result
    if result=$(stat -f %m "$1" 2>/dev/null); then
        echo "$result"
    elif result=$(stat -c %Y "$1" 2>/dev/null); then
        echo "$result"
    else
        echo 0
    fi
}
```

## Issues in Code You Touched (Should Fix)

_No issues found._

## Pre-existing Issues (Not Blocking)

_No CRITICAL pre-existing issues found._

## Suggestions (Lower Confidence)

- **`npm view` in background subshell has cold-start latency** - `scripts/statusline.sh:207-216` (Confidence: 65%) -- `npm view devflow-kit version` spawns a full Node.js process with npm registry lookup. On cold npm cache this can take 2-5 seconds. While correctly backgrounded and disowned, the subshell still consumes CPU/memory resources during the status line render. This is a reasonable tradeoff given the 24h cache TTL -- the cost is rare and non-blocking. No action needed unless users report sluggishness on machines with slow npm.

- **`sort -V` availability on older Linux minimal images** - `scripts/statusline.sh:192` (Confidence: 62%) -- `sort -V` (version sort) is a GNU coreutils extension. While available on macOS (via default sort) and all mainstream Linux distros, minimal Alpine/BusyBox images lack it. Since this is a developer workstation tool and not a CI image, this is unlikely to be hit in practice.

- **Skimmer agent token budget could be documented as configurable** - `shared/agents/skimmer.md:33` (Confidence: 60%) -- The hardcoded `--tokens 15000` budget is reasonable for most projects but could be expensive for very large monorepos where even structure mode produces massive output. Not a code performance issue, but a runtime cost consideration for users. The cascading mode selection in rskim mitigates this.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 1 | 0 |
| Should Fix | 0 | 0 | 0 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Performance Score**: 8/10
**Recommendation**: APPROVED_WITH_CONDITIONS

### Rationale

This PR is primarily a housekeeping/fix branch with well-considered performance characteristics:

1. **Version check is properly async** -- The npm registry lookup runs in a background subshell with `&` + `disown`, and results are cached for 24 hours. The statusline fast path reads only from a local cache file with zero network I/O. This is textbook async version checking.

2. **Skimmer agent enforces token budgets** -- The new `--tokens 15000` flag prevents unbounded rskim output, and the explicit warning against scanning repo root (`node_modules/` explosion) addresses the most critical performance pitfall.

3. **Platform tool restriction (`tools: ["Bash", "Read"]`)** -- Limiting the Skimmer agent to only Bash and Read prevents accidental Grep/Glob usage that could be slower than rskim for the orientation use case.

4. **One minor optimization available** -- The double `stat` call in `get_mtime()` is a small inefficiency that is straightforward to fix. Not blocking, but worth addressing since this function runs on every prompt render.

The single MEDIUM finding (double stat fork) is the only actionable condition. All other observations are low-confidence suggestions.
