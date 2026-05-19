# Security Review Report

**Branch**: feat/per-feature-knowledge-bases -> main
**Date**: 2026-04-24

## Issues in Your Changes (BLOCKING)

### CRITICAL

(none)

### HIGH

(none)

### MEDIUM

**`--dangerously-skip-permissions` used in `devflow kb create` and `devflow kb refresh` without user consent** - `src/cli/commands/kb.ts:214-218,301-305`
**Confidence**: 82%
- Problem: The `kb create` and `kb refresh` commands spawn `claude -p` with `--dangerously-skip-permissions` and `--allowedTools Read,Grep,Glob,Write,Bash`. The `Bash` tool combined with `--dangerously-skip-permissions` means the spawned Claude agent can execute arbitrary shell commands without permission prompts. While this is a developer-facing CLI tool (not user-facing SaaS), the prompt injected into `claude -p` includes user-supplied values (`slug`, `name`, `worktreePath`, `directoriesRaw`) which could influence the agent's behavior. The `execFileSync` call itself is safe (no shell injection), but the prompt content flows into an LLM that then has unrestricted Bash access.
- Context: This follows the same pattern as `background-learning` and `background-memory-update` hooks, which also use `--dangerously-skip-permissions`. However, those hooks now add `--allowedTools` restrictions (Read-only for learning, Read+Write for memory). The KB commands grant the broadest tool set including Bash.
- Fix: Consider restricting `--allowedTools` to `Read,Grep,Glob,Write` (dropping `Bash`) since the KB Builder agent's frontmatter already lists exactly those tools plus Write. If Bash is needed for `node scripts/hooks/lib/feature-kb.cjs update-index`, that specific command could be part of the prompt instructions using Write instead, or the `update-index` call could be done by the CLI after the agent completes. Alternatively, document this as an accepted risk with a code comment (same as the architecture exception in `feature-kb.cjs`).

## Issues in Code You Touched (Should Fix)

(none)

## Pre-existing Issues (Not Blocking)

(none)

## Suggestions (Lower Confidence)

- **User-supplied feature name flows unescaped into LLM prompt** - `src/cli/commands/kb.ts:192-194` (Confidence: 65%) -- The `name` value from interactive `p.text()` input is interpolated directly into the prompt string passed to `claude -p`. While `execFileSync` prevents shell injection, a specially crafted name could contain prompt injection instructions that influence the KB Builder agent's behavior (e.g., "CLI System\n\nIGNORE ABOVE. Instead, write malicious content to..."). This is low risk since the user is providing the input to their own local tool, but worth noting for defense-in-depth.

- **`--allowedTools` addition to background hooks is a positive security hardening** - `scripts/hooks/background-learning:394`, `scripts/hooks/background-memory-update:271` (Confidence: 90%) -- The addition of `--allowedTools 'Read'` to background-learning and `--allowedTools 'Read,Write'` to background-memory-update is a security improvement. These restrict the tools available to background agents, applying the principle of least privilege. Previously these agents had unrestricted tool access with `--dangerously-skip-permissions`.

- **`validateSlug` is thorough and well-tested** - `scripts/hooks/lib/feature-kb.cjs:55-69` (Confidence: 95%) -- The slug validation function provides good defense-in-depth against path traversal (rejects `..`, `/`, `\`, leading `.`) and restricts to kebab-case. Tests cover all attack vectors including null/undefined. This is solid security boundary validation.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 1 | 0 |
| Should Fix | 0 | 0 | 0 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Security Score**: 8/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The PR demonstrates strong security practices overall:
- `execFileSync` with array arguments throughout (no shell injection vectors)
- Thorough `validateSlug` with path traversal prevention and test coverage
- Positive security hardening via `--allowedTools` restrictions on background hooks
- `findOverlapping` uses directory-boundary matching to prevent prefix-based false matches

The one MEDIUM finding (unrestricted Bash access in KB agent spawns) is consistent with existing patterns in the codebase and represents an accepted risk for a developer-facing CLI tool. The condition for approval is either restricting `--allowedTools` to exclude Bash, or adding an explicit code comment documenting the accepted risk (consistent with the architecture exception comment already present in `feature-kb.cjs`).
