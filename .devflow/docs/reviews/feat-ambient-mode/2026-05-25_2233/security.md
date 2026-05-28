# Security Review Report

**Branch**: feat-ambient-mode -> main
**Date**: 2026-05-25

## Issues in Your Changes (BLOCKING)

### CRITICAL

(none)

### HIGH

(none)

## Issues in Code You Touched (Should Fix)

(none)

## Pre-existing Issues (Not Blocking)

(none)

## Suggestions (Lower Confidence)

- **Plan marker detection could match unintended content** - `scripts/hooks/preamble:25` (Confidence: 65%) — The preamble hook triggers on any prompt containing `## Goal`, `## Steps`, and `## Files` as substrings via bash `[[ == *pattern* ]]`. A user composing a message that happens to contain all three markdown headings (e.g., pasting documentation, discussing a plan format, or quoting a template) would trigger the `EXECUTION_PLAN detected` directive unintentionally. The markers are relatively common markdown headings. However, this is a prompt injection of the *user's own prompt into their own session* — the consequence is invoking `devflow:implement` which the user can decline or cancel, so the impact is limited to an unwanted skill invocation, not a privilege escalation or data exposure. The previous classification system also operated on user prompt content and had similar surface area.

- **COMMANDS_RULE_CONTENT hardcoded as string literal may drift from shared/rules/commands.md** - `src/cli/commands/ambient.ts:26-52` (Confidence: 60%) — The commands awareness rule content is duplicated: once as a const string in `ambient.ts` and once in `shared/rules/commands.md`. If only one is updated, they diverge. This is not a security vulnerability per se, but content drift could cause confusion about which commands are available — an integrity concern. The comment `D1` and the build system's separate rule distribution pipeline make this a design trade-off rather than an oversight.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 0 | 0 |
| Should Fix | 0 | 0 | 0 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Security Score**: 9/10
**Recommendation**: APPROVED

## Analysis Notes

This PR is a significant simplification that *reduces* security surface area. Key observations:

**Attack surface reduction (applies ADR-001)**:
- Deletes ~1200 lines including the 4-layer classification pipeline (session-start-classification hook, router skill, 7 triage skills, 7 guided skills, classification-rules.md)
- The old preamble hook processed every user prompt through classification logic and injected a directive on every non-slash, non-short message. The new preamble only fires when all three plan markers are present — most prompts produce zero output
- Removal of the `session-start-classification` hook eliminates a file-read operation (`cat "$CLASSIFICATION_RULES"`) that ran on every session start, along with its 4096-byte content length guard

**Hook script security properties preserved**:
- The preamble hook continues to source `json-parse` with proper error handling and `set -e`
- Input validation (`CWD` check, directory existence check) remains intact
- The hook still exits cleanly (exit 0) when json parsing is unavailable

**File system write safety**:
- `addAmbientHook` creates `COMMANDS_RULE_PATH` directory with `recursive: true` and writes the rule file — this is writing to `~/.claude/rules/devflow/` which is the expected install location for devflow rules
- `removeAmbientHook` properly handles missing file with try/catch on `fs.unlink`
- Both functions are now async (previously sync), which is the correct pattern for I/O operations

**Clean break from legacy (applies ADR-001)**:
- Stale `session-start-classification` hooks are cleaned up from previous installs during both enable and disable paths
- Legacy `ambient-prompt` hook marker continues to be cleaned up
- `LEGACY_HOOK_FILES` array in init.ts includes `session-start-classification` for cleanup

**No new secret handling, authentication, or authorization logic introduced**. The changes are purely structural — replacing a classification pipeline with a simpler pattern-matching hook and a static rules file.
