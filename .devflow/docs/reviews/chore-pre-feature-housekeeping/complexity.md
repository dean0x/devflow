# Complexity Review Report

**Branch**: chore/pre-feature-housekeeping -> main
**Date**: 2026-03-20
**PR**: #153

## Issues in Your Changes (BLOCKING)

### HIGH

**statusline.sh total file length now 222 lines with growing nesting** - `scripts/statusline.sh`
**Confidence**: 85%
- Problem: The statusline script is now 222 lines of procedural bash with no function decomposition beyond the new `get_mtime()` helper. The version-check block (lines 173-218) adds a third major feature section (after git-info and context-usage) with 4 levels of nesting (`if > if > if > if/subshell`). The overall file has no separation of concerns -- git branch detection, diff stats, context usage, and version checking are all sequentially interleaved in global scope with shared mutable state (`STATUS_LINE`).
- Impact: Adding the next feature to this script will push it well past the 300-line warning threshold. Each section is already hard to test in isolation since everything shares global variables. The version-check block alone is ~46 lines with 4 nesting levels.
- Fix: Extract the version-check logic into a function (matching the pattern already started with `get_mtime()`):
```bash
# Version update badge (returns badge string or empty)
get_version_badge() {
    local manifest_file="${DEVFLOW_DIR}/manifest.json"
    local cache_dir="${HOME}/.cache/devflow"
    local cache_file="${cache_dir}/latest-version"

    [ -f "$manifest_file" ] && command -v jq &>/dev/null || return
    local local_version
    local_version=$(jq -r '.version // empty' "$manifest_file" 2>/dev/null)
    [ -z "$local_version" ] && return

    # Read cached latest version (fast path)
    local latest_version=""
    [ -f "$cache_file" ] && latest_version=$(cat "$cache_file" 2>/dev/null)

    # Compare
    if [ -n "$latest_version" ] && [ "$local_version" != "$latest_version" ]; then
        local lowest
        lowest=$(printf '%s\n%s' "$local_version" "$latest_version" | sort -V | head -n1)
        [ "$lowest" = "$local_version" ] && printf '  \033[35m⬆ %s\033[0m' "$latest_version"
    fi

    # Background refresh if stale
    local refresh=false
    if [ ! -f "$cache_file" ]; then
        refresh=true
    else
        local cache_age=$(($(date +%s) - $(get_mtime "$cache_file")))
        [ "$cache_age" -ge 86400 ] && refresh=true
    fi

    if [ "$refresh" = true ] && command -v npm &>/dev/null; then
        ( mkdir -p "$cache_dir" 2>/dev/null
          local fetched
          fetched=$(npm view devflow-kit version 2>/dev/null)
          [ -n "$fetched" ] && echo "$fetched" > "$cache_file"
        ) & disown 2>/dev/null
    fi
}
```
Then the main body becomes: `VERSION_BADGE=$(get_version_badge)` -- a single line replacing 46.

### MEDIUM

**Skimmer agent grew from ~55 to ~143 lines but complexity is appropriate** - `shared/agents/skimmer.md`
**Confidence**: 82%
- Problem: The skimmer agent nearly tripled in size (26 lines added, 6 deleted per diffstat, net 92 -> 143 lines in the file). The new 6-step sequential workflow is prescriptive with explicit step headings, fallback instructions, and a reference table. At 143 lines this is at the upper boundary of the 50-150 line target for agents documented in CLAUDE.md.
- Impact: Low -- the structure is well-organized with clear step boundaries. The growth is justified by the move from vague "skim key directories" instructions to an explicit, enforceable workflow. The reference table is a net clarity improvement. This is noted as informational rather than something requiring action.
- Fix: No action required. If future additions push this past 150 lines, consider extracting the rskim reference table into a separate reference file.

## Issues in Code You Touched (Should Fix)

_No issues found._

## Pre-existing Issues (Not Blocking)

### MEDIUM

**init.ts action handler is a 522-line function** - `src/cli/commands/init.ts:112-634`
**Confidence**: 90%
- Problem: The entire `initCommand.action()` callback (lines 112-634) is a single 522-line function. This significantly exceeds the CRITICAL threshold of >200 lines and >50 lines per function. The changes in this PR (lines 170-175) are minor filter adjustments, but the function they live in is a monolithic orchestration handler with 6+ sequential prompt sections, installation logic, cleanup loops, extras configuration, safe-delete installation, and manifest writing -- all in one function scope.
- Impact: Any future modification to the init flow requires understanding 500+ lines of sequential state. Testing individual sections requires running the entire flow. This is pre-existing and the PR changes are minimal (2 lines changed in a filter expression), so it does not block this PR.
- Fix: In a future PR, decompose into focused functions: `promptForScope()`, `promptForPlugins()`, `installPlugins()`, `configureExtras()`, `installSafeDelete()`, `writeManifest()`.

**statusline.sh base-branch detection has 4-layer nesting** - `scripts/statusline.sh:57-99`
**Confidence**: 85%
- Problem: The layered base-branch detection (lines 57-99) uses 4 sequential if-blocks with nested git commands, `cd` side-effects, and a cache file pattern. While each layer is clearly commented, the overall block is 42 lines of procedural logic with shared mutable state (`BASE_BRANCH`).
- Impact: Pre-existing complexity (not introduced by this PR). The PR only changed line 83 to use the new `get_mtime()` helper, which is a strict improvement. Not blocking.
- Fix: Extract to a `detect_base_branch()` function in a future PR.

## Suggestions (Lower Confidence)

- **Test coupling via shared mutable state** - `tests/skimmer-agent.test.ts:22-26` (Confidence: 65%) -- The `content` and `tools` variables are set in the first `it()` block and read in subsequent ones. If test ordering changes or the first test is skipped, all others fail silently. Consider using `beforeAll` instead.

- **Magic number 86400** - `scripts/statusline.sh:204` (Confidence: 70%) -- The 24-hour TTL is expressed as `86400` without a named constant. A comment explains it, but a `CACHE_TTL=86400` variable would be self-documenting. The same value appears in the CHANGELOG description, confirming intent.

- **Filter predicate duplication** - `src/cli/commands/init.ts:171` and `tests/plugins.test.ts:163` (Confidence: 72%) -- The 3-way exclusion filter (`!= core-skills && != ambient && != audit-claude`) is duplicated between init.ts and the test. If a fourth plugin needs exclusion, both must be updated. The test comment acknowledges this ("Mirrors the filter logic in init.ts") but a shared constant or helper would prevent drift.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 1 | 0 |
| Should Fix | 0 | 0 | 0 | 0 |
| Pre-existing | 0 | 0 | 2 | 0 |

**Complexity Score**: 7/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The PR is a housekeeping change with modest complexity additions. The one actionable item is extracting the version-check block in `statusline.sh` into a function to prevent the script from becoming an unmaintainable monolith. The skimmer agent growth is well-structured and within bounds. Pre-existing complexity in `init.ts` is noted but does not block.
