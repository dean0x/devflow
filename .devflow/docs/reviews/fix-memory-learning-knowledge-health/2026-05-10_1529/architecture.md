# Architecture Review Report

**Branch**: fix/memory-learning-knowledge-health -> main
**Date**: 2026-05-10

## Issues in Your Changes (BLOCKING)

### CRITICAL

(none)

### HIGH

(none)

### MEDIUM

**Diagnostic marker creates transient filesystem state in `.memory/` without gitignore or cleanup** - `scripts/hooks/stop-update-memory:53-58`
**Confidence**: 82%
- Problem: The one-time diagnostic marker file `.stop-hook-diag-done` is created in `.memory/` but is not listed in the `.memory/.gitignore` entries managed by `ensure-memory-gitignore`. While `.memory/` itself is gitignored at the project root level (so this file will not be committed), the marker has no cleanup path -- it persists indefinitely after its diagnostic purpose is served. This is a minor modularity issue: the hook introduces persistent state for a transient debugging concern without documenting it alongside other transient markers in the `.memory/` directory structure (CLAUDE.md's `.memory/` listing).
- Fix: This is low-risk given the parent directory is gitignored. If the diagnostic is truly one-shot, consider removing the marker (and the diagnostic block) after the `response_text` field migration is confirmed working across projects. Alternatively, document it in the `.memory/` structure listing as a transient file.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Orphan queue auto-clean placement creates an implicit ordering dependency** - `scripts/hooks/stop-update-memory:61-68`
**Confidence**: 83%
- Problem: The orphan-clean logic runs inside the stop hook, which means it fires on every `end_turn` stop event. The logic checks whether the queue file contains any `"role":"assistant"` entries and truncates the entire file if none are found. Architecturally, this conflates two responsibilities in the stop hook: (1) capturing the current assistant response, and (2) garbage-collecting stale queue state from prior sessions. The stop hook already has a clear SRP -- capture assistant turns and spawn the background updater. Adding GC creates a second reason to change this module.

  That said, pragmatically this is the correct insertion point: the stop hook fires before the new assistant entry is appended, so it can detect and clean orphan state at the earliest safe moment. The alternative (a separate hook or a check in the background updater) would add more complexity than the SRP violation costs. The placement is defensible as "cleanup before write" rather than a separate concern.

- Fix: No code change recommended. The current placement is architecturally imperfect but pragmatically correct. If the stop hook grows further responsibilities, consider extracting queue maintenance into a sourced helper (following the `ensure-memory-gitignore` / `ensure-features-init` pattern).

## Pre-existing Issues (Not Blocking)

(none)

## Suggestions (Lower Confidence)

- **`ensure-features-init` could validate `$1` argument** - `scripts/hooks/ensure-features-init:6` (Confidence: 65%) -- The script uses `$1` directly without checking if it is non-empty or a valid directory. The caller (`session-end-knowledge-refresh`) does guard `$CWD` before calling, but the sourced script itself has no self-defense. Compare with `ensure-memory-gitignore` which also lacks this guard, so the omission is at least consistent with the established pattern.

- **`QUEUE_FILE` variable is declared in two separate scopes** - `scripts/hooks/stop-update-memory:62,82` (Confidence: 62%) -- `QUEUE_FILE` is first set at line 62 (orphan-clean block) and used again starting at line 82 (append block). The variable declaration at line 62 moved up from its previous location (line 84 in the old code). The current placement works correctly but creates a subtle dependency: the orphan-clean block must run before the append block, and both depend on the same path. A single declaration at the top of the "end_turn" processing section would make the data flow clearer.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 1 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Architecture Score**: 8/10
**Recommendation**: APPROVED

## Detailed Architecture Assessment

### 1. `ensure-features-init` -- Properly factored sourced script (applies ADR-001)

The new `ensure-features-init` script follows the exact same pattern as the existing `ensure-memory-gitignore`: a sourced bash script with idempotent lazy initialization, marker-based one-time setup, and `return 1` on failure (correct for `source`-ed scripts vs. `exit 1` for standalone). Key design virtues:

- **Consistent with existing convention**: Same structure, naming, and invocation pattern as `ensure-memory-gitignore`. A developer familiar with one immediately understands the other.
- **Idempotent**: Marker file `.gitignore-configured` prevents repeated grep scans after first run.
- **Lazy-init aligns with project philosophy** (applies ADR-001): Rather than requiring `devflow init` per-project or adding migration code, the hook self-heals by creating `.features/index.json` on demand. This is the clean-break approach -- no migration scaffolding needed.
- **SRP maintained**: The script does exactly one thing (ensure `.features/` is ready) and is sourced from exactly one caller.

### 2. Stop hook `assistant_message` to `response_text` -- Architectural simplification

The shift from `assistant_message` to `response_text` is a clear win:

- **Removes a leaky abstraction**: The old code had to handle `assistant_message` as either a string or a content-block array (with `type: "text"` and `type: "tool_use"` variants). This was infrastructure-layer complexity (Claude API response format) leaking into a shell hook. The new `response_text` field is pre-flattened by the Claude Code harness, eliminating 15 lines of jq/node parsing for content-array handling.
- **Reduces coupling**: The hook no longer needs to know the internal structure of Claude API content blocks. If the content-block format changes upstream, the hook is unaffected.
- **Consistent field extraction**: The three-field `cut` parsing (`cwd`, `stop_reason`, `response_text`) using SOH delimiter is cleaner than the previous two-field extraction that relied on bash parameter expansion (`${_FIELDS%%...}` / `${_FIELDS#...}`). The `cut` approach also scales better if a fourth field is ever needed.

### 3. Timeout increase (180s to 300s) -- Appropriate cross-cutting change

The timeout bump from 180s to 300s in both `learning-agent.ts` and `decisions-agent.ts` is applied consistently across both agent types. The value is not magic-numbered -- it appears exactly once in each function. Tests are updated to match.

### 4. Fence-stripping regex hardening -- Defensive improvement

The `_stripMarkdownFences` regex change from `^```json\n` to `^\s*```json\s*\n` handles whitespace-padded fences that upstream models may emit. This is boundary validation at the right layer (the agent response parser).

### 5. Test changes -- Clean and well-structured

- Removed `debug: false` from all test invocations, consistent with the field's removal from the type interfaces.
- Replaced the content-array test (`stop_reason end_turn -- content array: joins text blocks, excludes tool_use`) with two orphan-clean behavioral tests. This is correct -- the content-array parsing was the old architecture; the new tests validate the new architecture.
- New `ensure-features-init` tests cover creation, idempotency, gitignore behavior, and `.git`-absent guard.
- Queue overflow test updated to use mixed roles, avoiding false triggering of the new orphan-clean logic.
