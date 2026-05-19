# Security Review Report

**Branch**: track3/ambient-refinements -> main
**Date**: 2026-04-05

## Issues in Your Changes (BLOCKING)

### CRITICAL

No critical security issues found.

### HIGH

No high-severity security issues found.

## Issues in Code You Touched (Should Fix)

No should-fix security issues found.

## Pre-existing Issues (Not Blocking)

### MEDIUM

**Unvalidated JSON.parse on external input** - `src/cli/commands/ambient.ts:17,51,92,124,186`
**Confidence**: 82%
- Problem: Multiple `JSON.parse(settingsJson)` calls in `removeLegacyAmbientHook`, `addAmbientHook`, `removeAmbientHook`, `hasAmbientHook`, and the ambient CLI action handler parse JSON without try/catch protection. If `settings.json` is corrupted or contains non-JSON content, these throw unhandled exceptions. While the action handler at line 186 has surrounding error handling, the exported pure functions (lines 17, 51, 92, 124) do not — they propagate uncaught exceptions to callers. This pattern pre-dates this PR (the prior `addAmbientHook`/`removeAmbientHook` had the same issue), but the refactoring introduces two additional parse sites (`removeLegacyAmbientHook` at line 17, second parse in `addAmbientHook` at line 51).
- Fix: Wrap JSON.parse in each exported function with try/catch and return the input unchanged on parse failure, or use a shared safe-parse utility. This prevents a corrupted `settings.json` from crashing the CLI.

**Shell variable expansion in preamble hook** - `scripts/hooks/preamble:16,21`
**Confidence**: 80%
- Problem: `CWD` and `PROMPT` are extracted from JSON stdin via `json_field` and used in conditionals. While these values are not interpolated into commands (the PREAMBLE is a static string), the `PROMPT` variable is passed through `printf '%s' "$PROMPT" | wc -w` at line 29. If `json_field` returns a value containing shell metacharacters, the double-quoting protects against word splitting and globbing, but `printf '%s'` is safe here. This is a pre-existing pattern from the deleted `ambient-prompt` script, carried forward unchanged. The risk is LOW in practice because the hook only reads stdin JSON and outputs static content.
- Fix: No immediate fix needed — the pattern is safe as-is due to double-quoting and `printf '%s'`. Flagged for awareness.

## Suggestions (Lower Confidence)

- **Hook marker string collision risk** - `src/cli/commands/ambient.ts:9-10` (Confidence: 65%) — The markers `'preamble'` and `'ambient-prompt'` are matched via `String.includes()`. The word "preamble" is generic enough that a user-defined hook command path containing "preamble" would be incorrectly matched and removed by `removeAmbientHook`. A more specific marker like `'devflow-preamble'` or path-based matching would reduce false-positive risk.

- **Removed ambient skill injection from SessionStart creates behavior change** - `scripts/hooks/session-start-memory` (Confidence: 62%) — The diff removes the Section 2 "Ambient Skill Injection" block that previously injected `ambient-router SKILL.md` content into session context at startup. This is intentional (router is now loaded via Skill tool on demand), but means the first prompt of a session no longer has router skill content pre-loaded in context. If the Skill tool call fails or is slow, the first prompt could miss classification. This is a design trade-off, not a vulnerability.

- **`devflowDir` derivation from hook path is fragile** - `src/cli/commands/ambient.ts:190-191` (Confidence: 60%) — When enabling ambient mode, `devflowDir` is derived by splitting a Stop hook command on spaces and resolving `../../..` from the first segment. A path with spaces in it would break this heuristic. Pre-existing pattern.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 0 | 0 |
| Should Fix | 0 | 0 | 0 | 0 |
| Pre-existing | 0 | 0 | 2 | 0 |

**Security Score**: 9/10
**Recommendation**: APPROVED

## Analysis Summary

This PR is primarily a rename/refactoring effort — renaming skills (`ambient-router` to `router`, `implementation-patterns` to `patterns`, `search-first` to `research`, `*-orchestration` to short names) and restructuring the ambient preamble hook from inline skill mappings to a detection-only preamble that loads the router skill on demand.

From a security perspective:

1. **Shell hook (preamble)**: The new `preamble` script is simpler than the old `ambient-prompt` — it injects a static string and does not interpolate user input into commands. All variable usage is properly double-quoted. The script correctly uses `set -e` and graceful fallbacks. No injection vectors.

2. **Legacy hook cleanup**: The `init.ts` changes properly clean up the old `ambient-prompt` hook file from disk (`LEGACY_HOOK_SCRIPTS` array) and migrate settings entries from `ambient-prompt` to `preamble`. The `removeAmbientHook` function now removes both legacy and current markers, preventing orphaned hooks.

3. **CLI settings manipulation**: The `addAmbientHook` function correctly removes legacy hooks before adding the new one, preventing duplicate entries. The `removeLegacyAmbientHook` function is clean and idempotent. JSON parse calls lack defensive wrapping but this is pre-existing.

4. **New skill files**: The added orchestration skills (`debug`, `explore`, `implement`, `pipeline`, `plan`, `resolve`, `review`, `router`) and renamed skills (`patterns`, `research`) are markdown instruction files with no executable code. Their `allowed-tools` declarations follow established patterns. The router skill correctly has no `allowed-tools` restriction (as documented in CLAUDE.md for orchestrator skills).

5. **No secrets, no credentials, no auth changes**: This PR introduces no new API keys, tokens, credential handling, or authentication changes.

6. **Known pitfall check**: Reviewed `.memory/knowledge/pitfalls.md`. PF-005 (HookEntry interface duplication) is relevant — the `ambient.ts` changes now import `HookMatcher` and `Settings` from the extracted `utils/hooks.ts` module, which addresses this pitfall. No pitfall regressions detected.
