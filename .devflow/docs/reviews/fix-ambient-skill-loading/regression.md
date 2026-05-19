# Regression Review Report

**Branch**: fix/ambient-skill-loading -> main
**Date**: 2026-03-20
**PR**: #152

## Issues in Your Changes (BLOCKING)

### CRITICAL
(none)

### HIGH
(none)

### MEDIUM

**Dry-run silently skips multi-scope selection prompt** - `src/cli/commands/uninstall.ts:168`
**Confidence**: 82%
- Problem: The condition `if (scopesToUninstall.length > 1 && !dryRun)` bypasses the interactive scope-selection prompt during dry-run. When DevFlow is installed in both user and local scopes, `--dry-run` will always report both scopes without letting the user pick one. This is a behavior change from the non-dry-run path, where the user can select a single scope or both. The dry-run output may not accurately reflect what a real uninstall would do if the user would have picked just one scope.
- Fix: Consider either (a) documenting this as intentional (dry-run always shows all detected scopes), or (b) still presenting the scope selector during dry-run so the preview matches reality:
```typescript
if (scopesToUninstall.length > 1) {
  if (dryRun) {
    p.log.info('Found in multiple scopes; showing combined dry-run plan.');
  } else if (process.stdin.isTTY) {
    // existing interactive prompt...
  }
}
```

## Issues in Code You Touched (Should Fix)

(none)

## Pre-existing Issues (Not Blocking)

(none)

## Suggestions (Lower Confidence)

- **Dry-run does not show `.claudeignore`, managed settings, or safe-delete extras** - `src/cli/commands/uninstall.ts:201-208` (Confidence: 65%) -- The dry-run extras list includes `.docs/`, `.memory/`, hooks, and scripts, but omits `.claudeignore`, managed settings, and the safe-delete shell function that a full non-dry-run would also prompt about. This means the preview is incomplete for a full uninstall, though all omitted items are interactive confirm prompts that default to "no".

- **Integration tests acknowledge unreliable classification in `-p` mode** - `tests/integration/ambient-activation.test.ts:14-24` (Confidence: 62%) -- Two new integration tests (`loads skills for GUIDED classification`, `loads skills for ORCHESTRATED classification`) assert `hasClassification(output)` and `hasSkillLoading(output)`, but the inline docs acknowledge these may fail because `-p` mode does not reliably trigger ambient classification. These tests are not part of `npm test` (integration-only), but could produce false failures in CI if accidentally included.

## Regression Checklist

- [x] No exports removed without deprecation -- `allowed-tools` removed from SKILL.md frontmatter is intentional and documented
- [x] Return types backward compatible -- `runClaude` signature widened with optional `ambient` field (default `true`), fully backward compatible
- [x] Default values unchanged or documented -- `runClaude` defaults `ambient: true` which matches previous behavior (ambient preamble was not injected before, but the behavioral change is intentional per commit message)
- [x] Side effects preserved -- hook preamble text expanded but format unchanged; JSON output structure identical
- [x] All consumers of changed code updated -- all `runClaude` callers in integration tests work with new optional parameter
- [x] Migration complete across codebase -- `CLAUDE.md` and `docs/reference/skills-architecture.md` both updated to reflect `allowed-tools` removal
- [x] CLI options preserved or deprecated -- new `--dry-run` flag is additive only, no existing flags removed
- [x] Commit message matches implementation -- all three commits accurately describe their changes
- [x] No files deleted
- [x] No new TODOs introduced
- [x] All 265 tests pass (13 test files, 0 failures)
- [x] Known pitfall PF-001 (synthesizer glob) not reintroduced -- no overlap with changed files

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 1 | 0 |
| Should Fix | 0 | 0 | 0 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Regression Score**: 9/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The branch is well-structured across three focused commits. The core fix (removing `allowed-tools` from `ambient-router`) is correct and directly addresses the bug where skills could not load. The `runClaude` signature change is backward compatible. The `--dry-run` feature is additive with no impact on existing behavior. All 265 tests pass. The one MEDIUM finding (dry-run scope preview mismatch) is a minor UX inconsistency, not a functional regression -- address at your discretion before merge.
