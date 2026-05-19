# Security Review Report

**Branch**: fix-suppress-quick-classification -> main
**Date**: 2026-04-19
**PR**: #185

## Issues in Your Changes (BLOCKING)

### CRITICAL

No CRITICAL issues found.

### HIGH

No HIGH issues found.

## Issues in Code You Touched (Should Fix)

No issues found.

## Pre-existing Issues (Not Blocking)

No issues found.

## Suggestions (Lower Confidence)

No suggestions.

## Analysis Notes

### Changes Reviewed

This PR makes four categories of changes:

1. **Preamble wording change** (`scripts/hooks/preamble:37`): The preamble now reads "If GUIDED or ORCHESTRATED, load devflow:router via Skill tool" instead of unconditionally instructing router loading. This is a prompt instruction change with no security implications -- it narrows when the router skill is loaded, reducing unnecessary tool invocations for QUICK/CHAT classifications.

2. **Classification rules file relocation** (`shared/skills/router/references/classification-rules.md` -> `shared/skills/router/classification-rules.md`): A pure file rename moving the classification rules up one directory level. No content change.

3. **Fallback path update** (`scripts/hooks/session-start-classification:18-23`): The hook now tries the new path first, then falls back to the legacy `references/` path. The old fallback that parsed `SKILL.md` via `awk` is replaced with a simpler `cat` of the legacy path. Both paths are under `$HOME/.claude/skills/devflow:router/` which is a user-controlled directory -- no path traversal or injection risk. The 4096-byte size guard (line 28) remains intact. The `set -e` at the top ensures the hook fails cleanly on errors.

4. **Test updates** (`tests/ambient.test.ts`, `tests/integration/ambient-activation.test.ts`, `tests/integration/helpers.ts`, `tests/skill-references.test.ts`): Path references updated to match the new file location. The `hasClassification` function (already exported in helpers.ts) is newly imported in the integration test to assert that QUICK-tier prompts produce no classification output -- this strengthens test coverage of the "suppress QUICK announcement" behavior.

### Security-Specific Analysis

- **Shell injection**: The `session-start-classification` hook reads `$HOME` for path construction. `$HOME` is set by the OS, not user input. The `CWD` value from JSON input is only used in an emptiness check (`-z`), never interpolated into file paths or commands. No injection vectors.
- **File read from user-controlled paths**: The hook reads from `$HOME/.claude/skills/` which is the user's own skill directory. This is by design -- the user controls their own skill files. The 4096-byte size guard prevents reading excessively large files into memory.
- **No secrets or credentials**: No hardcoded secrets, API keys, or credentials introduced.
- **No new dependencies**: No package changes.
- **No new network access**: No HTTP requests, URLs, or external service calls added.
- **No auth/authz changes**: No authentication or authorization logic modified.

### Knowledge Check (PF-001)

PF-001 warns about renaming Promise resolver params in `tests/integration/helpers.ts`. This PR modifies `helpers.ts` but only changes a file path string and a preamble string -- no Promise resolver parameters are touched. All `resolve` params in Promise callbacks remain correctly named. PF-001 is not violated.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 0 | - |
| Should Fix | - | 0 | 0 | - |
| Pre-existing | - | - | 0 | 0 |

**Security Score**: 10
**Recommendation**: APPROVED
