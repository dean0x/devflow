# Security Review Report

**Branch**: fix/ambient-skill-loading -> main
**Date**: 2026-03-20
**Commits reviewed**: 7630bad, 8800f7b, e7aa588

## Issues in Your Changes (BLOCKING)

### CRITICAL

No critical security issues found.

### HIGH

**Removal of `allowed-tools` restriction from ambient-router skill widens attack surface** - `shared/skills/ambient-router/SKILL.md:1-5`
**Confidence**: 82%
- Problem: The `allowed-tools` frontmatter was removed from the ambient-router skill, making it the only skill in the entire codebase with unrestricted tool access (all other 34 skills explicitly declare `allowed-tools`). While the SKILL.md comment at line 91-93 explains this is intentional because ambient-router runs in the main session as an orchestrator, this creates a privilege escalation path: any future skill or hook that loads ambient-router inherits unrestricted capabilities. The CLAUDE.md and skills-architecture docs were updated to document this exception, which is good, but the exception itself is the concern.
- Fix: If the Claude plugin framework supports it, consider using a broader but still bounded `allowed-tools` list (e.g., `Read, Grep, Glob, Bash, Edit, Write, Skill, Agent`) rather than omitting the field entirely. This preserves the orchestrator's ability to function while establishing an upper bound. If the framework treats "no field" as "unrestricted," this is a defense-in-depth concern rather than a blocking vulnerability, but it should be a conscious architectural decision with a comment in the frontmatter explaining why it is absent.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Shell variable expansion in `echo "$PROMPT"` pipes** - `scripts/hooks/ambient-prompt:28,34,37`
**Confidence**: 80%
- Problem: The `$PROMPT` variable (extracted from hook JSON input via `jq -r`) is passed through `echo "$PROMPT" | wc -w` and `echo "$PROMPT" | tr ...` and `echo "$PROMPT_LOWER" | grep ...`. While `jq` safely extracts the value and the variable is double-quoted (preventing word splitting), `echo` with arbitrary user input can still produce unexpected behavior if the prompt starts with `-n`, `-e`, or `-E` (echo flags). This is a minor robustness issue rather than an exploitable vulnerability, since the hook input comes from the Claude runtime (not direct user shell input), and the output is only used for flow control (skip/inject preamble).
- Fix: Replace `echo "$PROMPT"` with `printf '%s' "$PROMPT"` in lines 28, 34, and 37 to avoid flag interpretation:
  ```bash
  WORD_COUNT=$(printf '%s' "$PROMPT" | wc -w | tr -d ' ')
  PROMPT_LOWER=$(printf '%s' "$PROMPT" | tr '[:upper:]' '[:lower:]')
  if printf '%s' "$PROMPT_LOWER" | grep -qE '...'; then
  ```

## Pre-existing Issues (Not Blocking)

### MEDIUM

**`execSync` with string interpolation in `uninstallPluginViaCli`** - `src/cli/commands/uninstall.ts:87`
**Confidence**: 85%
- Problem: `execSync(\`claude plugin uninstall devflow --scope ${cliScope}\`, ...)` uses template literal string concatenation with `cliScope`. While `cliScope` is derived from a controlled value (`scope === 'local' ? 'project' : 'user'`) making injection impossible in practice, using `execSync` with string interpolation is a pattern that should be avoided in favor of `execFileSync` which does not invoke a shell. This is pre-existing code (not introduced in this PR).
- Fix: Use `execFileSync('claude', ['plugin', 'uninstall', 'devflow', '--scope', cliScope], { stdio: 'inherit' })` to avoid shell invocation entirely.

### LOW

**Test helper uses `execFileSync` with user-provided prompt** - `tests/integration/helpers.ts:37-45`
**Confidence**: 80%
- Problem: The `runClaude` helper passes `prompt` directly as a CLI argument to `execFileSync('claude', args)`. Because `execFileSync` does not invoke a shell, this is not a command injection risk. The prompt is test-only input, not production user input. No action needed -- this is noted for completeness only.

## Suggestions (Lower Confidence)

- **Ambient preamble injection could be manipulated by crafted prompts** - `scripts/hooks/ambient-prompt:42` (Confidence: 65%) -- A user could craft a prompt containing "AMBIENT MODE ACTIVE:" text to potentially confuse the classification flow. This is a prompt-injection-adjacent concern, but the impact is limited to misclassification within the user's own session.

- **Dry-run path probing reveals directory existence** - `src/cli/commands/uninstall.ts:204-207` (Confidence: 60%) -- The dry-run feature uses `fs.access` to check for `.docs/` and `.memory/` existence. In a CLI tool running locally with user permissions, this is not a meaningful security concern, but in a different deployment context it could be an information disclosure vector.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 0 | - |
| Should Fix | - | 0 | 1 | - |
| Pre-existing | - | 0 | 1 | 1 |

**Security Score**: 8/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The primary change -- removing `allowed-tools` from ambient-router -- is an intentional design decision that is well-documented in CLAUDE.md and skills-architecture.md. The HIGH finding is about defense-in-depth: if the framework supports a bounded but broad tool list, prefer that over completely unrestricted. The shell script `echo` concern is low-impact but trivially fixable. The `execSync` string interpolation is pre-existing and not blocking. Overall, this PR introduces no exploitable vulnerabilities and the security posture is sound for a local-only CLI tool.
