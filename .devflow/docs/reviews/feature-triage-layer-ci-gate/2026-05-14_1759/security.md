# Security Review Report

**Branch**: feature/triage-layer-ci-gate -> main
**Date**: 2026-05-14

## Issues in Your Changes (BLOCKING)

No blocking security issues found.

## Issues in Code You Touched (Should Fix)

No should-fix security issues found.

## Pre-existing Issues (Not Blocking)

No pre-existing security issues found at CRITICAL severity in reviewed files.

## Suggestions (Lower Confidence)

- **CI status gate poll/fix loop could be exploited via CI spoofing** - `shared/skills/implement:orch/SKILL.md:159`, `shared/skills/resolve:orch/SKILL.md:123` (Confidence: 65%) -- The CI Status Gate spawns a Coder agent to fix CI failures based on "check names and failure context." If an attacker controlled CI check names or failure messages (e.g., via a malicious PR check or GitHub App), they could inject misleading context into the Coder agent prompt. However, this is mitigated by the fact that Coder agents operate within the local repo sandbox and the check data comes from GitHub's API (trusted channel). The attack surface is narrow and requires pre-existing repo compromise. Noted for awareness rather than action.

- **`--dangerously-skip-permissions` in test helper** - `tests/integration/helpers.ts:259` (Confidence: 60%) -- The `runClaudeAndWait` helper uses `--dangerously-skip-permissions` when spawning Claude processes. This is pre-existing (not introduced in this PR) and limited to the test suite, but worth noting: if test infrastructure were ever exposed or run outside controlled CI environments, this flag disables Claude's permission model. The file was touched in this PR (CLASSIFICATION_PATTERN change on line 5), placing it in the "code you touched" scope, but the flag itself was not introduced by this change.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 0 | - |
| Should Fix | - | 0 | 0 | - |
| Pre-existing | - | - | 0 | 0 |

**Security Score**: 9/10
**Recommendation**: APPROVED

## Analysis Notes

### What was reviewed

This PR modifies 10 files across markdown skill/agent definitions, one TypeScript test file, and one TypeScript test helper. The changes fall into these categories:

1. **CI Status Gate insertion** (`implement:orch`, `resolve:orch`, `resolve.md`, `resolve-teams.md`): Adds a new Phase 7 with poll/fix loop logic and a total budget cap (max 10 polls, max 2 fix attempts). Introduces `<!-- SYNC: ci-status-gate -->` markers for cross-file consistency.

2. **Phase number corrections** (`pipeline:orch`, `plan:orch`, `resolve.md`, `resolve-teams.md`): Updates stale phase references after the CI gate insertion shifted downstream phases.

3. **Git agent classification fix** (`git.md`): Changes CI check classification to priority-order (PENDING > FAILING > PASSING) instead of the previous order that could misclassify mixed states.

4. **Format migration** (`test-driven-development`): Updates INTENT/DEPTH notation from slash format (`IMPLEMENT/ORCHESTRATED`) to parenthetical format (`IMPLEMENT (ORCHESTRATED)`). Applies ADR-001 (clean break philosophy -- old format is replaced without backward compatibility).

5. **Test improvements** (`ambient.test.ts`, `helpers.ts`): Removes dead CHAT variant from classification regex, adds negative test for old INTENT/DEPTH format. Applies ADR-001 (adds explicit verification that old format is rejected).

### Security-specific observations

- **No secrets, credentials, or tokens** are introduced or exposed in any changed file.
- **No user-facing input handling** is added or modified -- all changes are to internal skill definitions (markdown) and test infrastructure.
- **No new shell command execution** patterns are introduced. The CI status gate references existing agent-mediated `gh` commands that already go through the Git agent's controlled interface.
- **No new file system access patterns** are introduced.
- **The CI poll/fix budget cap** (point 6 in each CI gate) is a positive security/reliability addition -- it bounds the loop to prevent unbounded resource consumption.
- **The `<!-- SYNC: ci-status-gate -->` markers** ensure the three copies of the CI gate logic stay synchronized, reducing drift-related security inconsistencies.
- **The classification regex change** (`helpers.ts:5`) removes CHAT from the pattern -- this is a tightening change that reduces the accepted input space, which is security-positive.
