# Regression Review Report

**Branch**: feat/per-feature-knowledge-bases -> main
**Date**: 2026-04-26

## Issues in Your Changes (BLOCKING)

### CRITICAL

(none)

### HIGH

(none)

### MEDIUM

**`background-kb-refresh` does not recheck `.disabled` sentinel before refreshing** - `scripts/hooks/background-kb-refresh`
**Confidence**: 82%
- Problem: `session-end-kb-refresh` checks `.features/.disabled` at line 30 and spawns the background process. After a 3-second `sleep`, `background-kb-refresh` begins work without rechecking `.disabled`. If a user runs `devflow kb --disable` in the narrow window between the session-end hook and the background process starting, the refresh still proceeds.
- Impact: Minor TOCTOU gap. The refresh would run once even though KBs were just disabled. The background process follows the `background-learning` pattern which also does not recheck its disable sentinel, so this is consistent with the project convention, but it is worth documenting as an accepted risk.
- Fix: Add a guard in `background-kb-refresh` after `sleep 3`:
  ```bash
  [ -f "$CWD/.features/.disabled" ] && { log "KBs disabled — aborting"; exit 0; }
  ```

## Issues in Code You Touched (Should Fix)

(none)

## Pre-existing Issues (Not Blocking)

(none)

## Suggestions (Lower Confidence)

- **`background-kb-refresh` `set -e` interacts with watchdog pattern** - `scripts/hooks/background-kb-refresh:8,150-163` (Confidence: 65%) — `set -e` could cause early exit if any command in the refresh loop fails unexpectedly (e.g., `IFS` read parsing on malformed `refresh-context` output). The `background-learning` script uses the same `set -e` + watchdog pattern, so this is project-consistent, but `set -euo pipefail` or removing `set -e` and checking errors explicitly would be more robust for a long-running loop.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 1 | 0 |
| Should Fix | 0 | 0 | 0 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Regression Score**: 9/10
**Recommendation**: APPROVED_WITH_CONDITIONS

---

## Regression Checklist

- [x] No exports removed without deprecation — `checkStaleness` and all public API preserved; internal `checkEntryFiles` extracted as private helper
- [x] Return types backward compatible — `checkStaleness` still returns `{ stale: boolean, changedFiles: string[] }`
- [x] Default values unchanged — new `kb` manifest field defaults to `false` for old manifests (line 59 of `manifest.ts`)
- [x] Side effects preserved — `removeEntry` now preserves corrupt `index.json` instead of overwriting (improved behavior, not a regression)
- [x] All consumers of changed code updated — `kb-builder` renamed to `knowledge` across all 4 locations: `shared/agents/`, `plugins/devflow-plan/`, `plugins/devflow-ambient/`, plugin manifests
- [x] Migration complete across codebase — zero remaining references to `kb-builder` or `KB Builder`
- [x] CLI options preserved — `devflow kb` gains `--enable`/`--disable`/`--status` (additive, no removal)
- [x] Commit message matches implementation — agent rename, toggleability, auto-refresh hooks all present
- [x] Breaking changes documented — CLAUDE.md updated with toggleability, SessionEnd hook, `.disabled` sentinel

## Detailed Analysis

### Agent Rename: `kb-builder` to `knowledge`

The rename is complete and consistent:

| Location | Old | New | Status |
|----------|-----|-----|--------|
| `shared/agents/kb-builder.md` | `kb-builder.md` | `knowledge.md` | Renamed |
| `plugins/devflow-plan/.claude-plugin/plugin.json` | `kb-builder` | `knowledge` | Updated |
| `plugins/devflow-ambient/.claude-plugin/plugin.json` | `kb-builder` | `knowledge` | Updated |
| `src/cli/plugins.ts` (devflow-plan agents) | `kb-builder` | `knowledge` | Updated |
| `src/cli/plugins.ts` (devflow-ambient agents) | `kb-builder` | `knowledge` | Updated |
| All `subagent_type` references | `"KB Builder"` | `"Knowledge"` | Updated |
| Agent frontmatter `name:` | `KB Builder` | `Knowledge` | Updated |
| Test file | `kb-builder-agent.test.ts` | `knowledge-agent.test.ts` | Renamed |
| CLAUDE.md shared agents list | `kb-builder` | `knowledge` | Updated |
| `file-organization.md` agent count | 12 | 13 | Updated |

No remaining references to the old name were found.

### Manifest Backward Compatibility

The `readManifest` function correctly defaults `kb` to `false` when reading old manifests that lack the field (line 59 of `manifest.ts`). Test coverage added at `tests/manifest.test.ts:107-120`.

### KB Toggleability

The new `--enable`/`--disable`/`--status` options on `devflow kb` and `--kb`/`--no-kb` on `devflow init` are additive. The `.disabled` sentinel is properly checked in:
- `session-end-kb-refresh` (line 30)
- `plan:orch` Phase 12 (SKILL.md line 258)

The `devflow uninstall` flow correctly calls `removeKbHook` during cleanup.

### `removeEntry` Fix

The change from initializing a fresh empty index to bailing out on parse failure is a correctness improvement. Previously, if `index.json` was corrupt, `removeEntry` would silently overwrite it with `{ version: 1, features: {} }`, losing all index data. Now it returns early, preserving the corrupt file for manual recovery. Test coverage added.

### Feature Knowledge in `implement` and `implement:orch`

New `KNOWLEDGE_CONTEXT` is now loaded and passed to Coder and Scrutinizer agents. `FEATURE_KNOWLEDGE` is also newly passed to the Evaluator agent. These are additive enhancements that do not change existing behavior paths.

### `explore:orch` Asymmetric Pattern

The change to keep both `KNOWLEDGE_CONTEXT` and `FEATURE_KNOWLEDGE` orchestrator-local (not passed to Explore sub-agents) is an intentional behavior change documented in the skill. Previously, `FEATURE_KNOWLEDGE` was passed to Explore agents. The new pattern is documented as: "Do NOT pass to Explore sub-agents (same asymmetric pattern as KNOWLEDGE_CONTEXT)." This is a behavioral change but is explicitly intentional, consistent with `debug:orch`'s existing approach, and documented in the skill.
