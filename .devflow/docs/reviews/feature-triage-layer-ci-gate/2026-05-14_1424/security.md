# Security Review Report

**Branch**: feature/triage-layer-ci-gate -> main
**Date**: 2026-05-14

## Issues in Your Changes (BLOCKING)

### CRITICAL

(none)

### HIGH

**Shell injection via unvalidated issue number in triage skill** - `shared/skills/implement:triage/SKILL.md:23`
**Confidence**: 82%
- Problem: The implement:triage skill instructs the model to run `gh issue view NNN --json body,labels --jq '{body: .body[0:500], labels: [.labels[].name]}' 2>/dev/null` where `NNN` is extracted from the user's prompt via pattern matching on `#NNN`. If the model extracts a malformed value (e.g., containing shell metacharacters like `; rm -rf /` or `$(command)`), this could lead to command injection. While `gh` itself validates issue numbers as integers, the instruction does not specify that the extracted value must be validated as a numeric-only string before interpolation into the shell command, and the model's regex extraction from natural language is not guaranteed to produce a clean integer.
- Fix: Add explicit validation instruction: "Extract the issue number as digits only (strip any non-numeric characters). If the extracted value is not a valid integer, skip this check and default to GUIDED." For example:
  ```markdown
  2. **Complex GitHub issue** — If prompt references an issue (`#NNN`), extract digits only.
     Validate: the extracted value must match `^[0-9]+$`. If not, skip this check.
     Peek at body: `gh issue view NNN --json body,labels ...`
  ```
  The same pattern appears in `shared/skills/plan:triage/SKILL.md:23` with an identical `gh issue view NNN` instruction and needs the same fix.

### MEDIUM

(none)

## Issues in Code You Touched (Should Fix)

### HIGH

**CI status gate poll loop spawns Coder agent on CI failure without sandboxing scope** - `shared/skills/implement:orch/SKILL.md:162`, `shared/skills/resolve:orch/SKILL.md:126`, `plugins/devflow-resolve/commands/resolve.md:261`, `plugins/devflow-resolve/commands/resolve-teams.md:261`
**Confidence**: 80%
- Problem: The new Phase 7 (CI Status Gate) in all four orchestration documents instructs: "If FAILING, spawn Agent(subagent_type='Coder') to fix CI failures based on check names and failure context." The Coder agent receives CI failure details and is given authority to modify code and push changes. However, there is no constraint on what the Coder can modify -- it could change security-critical files, disable tests, or weaken configurations to make CI pass. The instruction also says "After fix, push and re-check" which means the Coder pushes directly without any quality gate review of the CI fix itself. This creates a bypass path around the quality gates that normally protect the codebase (Phase 6 in implement:orch).
- Fix: Add scope constraints to the Coder invocation in the CI fix path. At minimum: (1) Restrict the Coder to only modifying files related to the failing check (e.g., test files for test failures, config files for lint failures). (2) Require the Coder's CI fix to pass through the Validator agent before pushing. (3) Prohibit the Coder from disabling or skipping tests/lint rules to make CI pass. Example addition:
  ```markdown
  5. **If FAILING** → report failing checks. Spawn `Agent(subagent_type="Coder")` with constraints:
     - ONLY modify files directly related to the failing check
     - Do NOT disable tests, skip lint rules, or weaken configurations to make CI pass
     - Run `Agent(subagent_type="Validator")` on the fix before pushing
     After fix, push and re-check. Max 2 fix attempts.
  ```

### MEDIUM

**`check-ci-status` operation uses `gh pr checks {number}` with unsanitized PR number** - `shared/agents/git.md:290`
**Confidence**: 80%
- Problem: The new `check-ci-status` operation in the Git agent discovers the PR number via `gh pr view --json number --jq '.number'` or accepts it as a parameter. When passed as a parameter (`PR_NUMBER`), there is no validation that it is a numeric value before interpolation into `gh pr checks {number}`. While the Git agent receives `PR_NUMBER` from the orchestrator (not directly from user input), the orchestrator extracts it from conversation context. The `2>/dev/null` suffix suppresses error output that could leak information.
- Fix: Add validation to the Process steps:
  ```markdown
  1. If `PR_NUMBER` provided, validate it matches `^[0-9]+$`. If not, output status `NO_PR`, stop.
  2. If `PR_NUMBER` not provided, discover it: ...
  ```

## Pre-existing Issues (Not Blocking)

(none)

## Suggestions (Lower Confidence)

- **Orchestration hint keywords could be weaponized in PR descriptions** - `shared/skills/implement:triage/SKILL.md:16` (Confidence: 65%) -- The triage skills check the user's prompt for keywords like "orchestrate", "full pipeline", "deep", "thorough" to force ORCHESTRATED mode. Since PR descriptions are untrusted user input and flow into conversation context, a malicious PR description containing these keywords could influence triage decisions for subsequent operations on that PR. The containment markers mitigate this, but the keyword matching is broad.

- **CI poll loop has no jitter or backoff** - `shared/skills/implement:orch/SKILL.md:161` (Confidence: 60%) -- The CI status gate polls every 60 seconds for max 10 iterations. While bounded (avoids PF-001 concern about unbounded loops), the fixed interval without jitter could cause thundering herd issues if multiple concurrent sessions are polling the same CI system. Not a direct security vulnerability but could trigger GitHub API rate limiting.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 0 | - |
| Should Fix | - | 1 | 1 | - |
| Pre-existing | - | - | 0 | 0 |

**Security Score**: 8/10
**Recommendation**: CHANGES_REQUESTED

The triage layer is architecturally sound from a security perspective -- triage skills are non-user-invocable, default to GUIDED (lower privilege), and fail-safe to GUIDED on errors. The main concerns are: (1) shell command construction from model-extracted values without explicit numeric validation (blocking), and (2) the CI fix path bypasses quality gates that normally protect the codebase (should-fix). The changes do not introduce any hardcoded secrets, authentication bypasses, or data exposure risks. The `check-ci-status` operation uses `gh` CLI with proper error suppression and bounded retry loops.
