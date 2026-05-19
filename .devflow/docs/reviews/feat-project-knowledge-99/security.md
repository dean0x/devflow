# Security Review Report

**Branch**: feat/project-knowledge-99 -> main
**Date**: 2026-03-14
**PR**: #140 — feat: Wave 2 — project knowledge system (decisions + pitfalls)

## Issues in Your Changes (BLOCKING)

### CRITICAL

None.

### HIGH

None.

### MEDIUM

**Inconsistent lock specification across commands** - Multiple files
**Confidence**: 85%
- Locations:
  - `/Users/dean/Sandbox/devflow/plugins/devflow-code-review/commands/code-review.md:131`
  - `/Users/dean/Sandbox/devflow/plugins/devflow-code-review/commands/code-review-teams.md:230`
  - `/Users/dean/Sandbox/devflow/plugins/devflow-implement/commands/implement.md:357`
  - `/Users/dean/Sandbox/devflow/plugins/devflow-implement/commands/implement-teams.md:544`
  - `/Users/dean/Sandbox/devflow/plugins/devflow-debug/commands/debug.md:142`
  - `/Users/dean/Sandbox/devflow/plugins/devflow-debug/commands/debug-teams.md:202`
  - `/Users/dean/Sandbox/devflow/plugins/devflow-resolve/commands/resolve.md:104`
  - `/Users/dean/Sandbox/devflow/plugins/devflow-resolve/commands/resolve-teams.md:164`
- Problem: The lock specification for `.memory/.knowledge.lock` is inconsistent across commands. The `code-review` and `implement` commands specify `(30s timeout, 60s stale recovery)`, but `debug` and `resolve` commands say only `Use mkdir-based lock at .memory/.knowledge.lock if writing` without specifying timeout or stale recovery parameters. This creates a race condition risk where different commands may behave differently when contending for the lock. Without explicit stale recovery, a crashed `debug` or `resolve` session could leave an orphaned lock that blocks all future knowledge writes indefinitely.
- Fix: Add consistent timeout and stale recovery parameters to all lock specifications:
  ```markdown
  Do this inline. Use mkdir-based lock at `.memory/.knowledge.lock` (30s timeout, 60s stale recovery) if writing.
  ```
  Apply this exact wording to `debug.md`, `debug-teams.md`, `resolve.md`, and `resolve-teams.md`.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**No input sanitization on TL;DR content injected into session context** - `/Users/dean/Sandbox/devflow/scripts/hooks/session-start-memory:122-140`
**Confidence**: 80%
- Problem: The session-start hook reads the first line of `decisions.md` and `pitfalls.md`, strips the HTML comment markers via `sed`, and injects the content directly into the `CONTEXT` variable that becomes `additionalContext` in Claude's session. The `grep -qv '^#'` check on line 129 filters lines starting with `#` but does not sanitize the TL;DR content itself. If a knowledge file were to contain adversarial content in its TL;DR line (e.g., injected prompt instructions disguised as a TL;DR), it would be passed directly into the Claude session context. Since these files are written by Claude agents themselves (not external users), this is a limited-scope concern -- but it represents an indirect prompt injection surface if a malicious actor can write to `.memory/knowledge/`.
- Impact: An attacker with write access to `.memory/knowledge/` could inject arbitrary instructions into every new Claude session via the TL;DR line. This is mitigated by the fact that `.memory/` is a local directory within the project, and the attacker would already need filesystem access.
- Fix: Consider adding a length cap and character validation on the extracted TL;DR content:
  ```bash
  TLDR_LINE=$(head -1 "$kf" | sed 's/<!-- TL;DR: //;s/ -->//' | head -c 200)
  if [ -n "$TLDR_LINE" ] && echo "$TLDR_LINE" | grep -qv '^#' && echo "$TLDR_LINE" | grep -qE '^[0-9]+ (decisions|pitfalls)\.'; then
  ```
  This validates the TL;DR follows the expected format pattern (starts with a count followed by "decisions." or "pitfalls.") and caps length to 200 characters.

**Knowledge files lack integrity verification** - `/Users/dean/Sandbox/devflow/shared/agents/coder.md:38-39`
**Confidence**: 80%
- Problem: The Coder agent is instructed to read `decisions.md` and `pitfalls.md` and apply their contents as authoritative architectural guidance. There is no mechanism to verify that these files have not been tampered with. Since agents write to these files (append-only by convention), a compromised or buggy agent could write misleading entries that cause future agents to make incorrect architectural decisions. The append-only constraint is enforced only by instruction, not by any technical mechanism.
- Impact: A corrupted `decisions.md` could cause agents to follow incorrect architectural patterns across multiple sessions. The 50-entry cap limits blast radius, but each entry could contain misleading guidance.
- Fix: This is an acceptable risk for the current trust model (local CLI tool, same-user execution). Document the trust assumption explicitly. Consider adding a simple line-count or checksum in the TL;DR header that agents can validate before trusting file contents:
  ```markdown
  <!-- TL;DR: 3 decisions. Key: ADR-001 A, ADR-002 B, ADR-003 C. Lines: 45 -->
  ```

## Pre-existing Issues (Not Blocking)

### MEDIUM

**Shell command injection surface in execSync calls** - `/Users/dean/Sandbox/devflow/src/cli/utils/post-install.ts:147-151`
**Confidence**: 82%
- Problem: The `installManagedSettings` function uses `execSync` with string interpolation for `managedDir` and `managedPath` (lines 147, 151). While `managedDir` comes from `getManagedSettingsPath()` which returns a deterministic system path, and `managedPath` is similarly derived, these values are passed into shell commands via string interpolation inside single quotes. If a future refactor were to introduce user-controlled input into these paths, it would create a command injection vulnerability. The current code is safe because the paths are hardcoded system paths, but the pattern is fragile.
- Note: This is pre-existing code (not changed in this PR). The only change to `post-install.ts` in this PR is the addition of `await fs.mkdir(path.join(memoryDir, 'knowledge'), { recursive: true });` on line 481, which uses the safe `fs.mkdir` API.

### LOW

**Deduplication logic is string-based and fragile** - Described in multiple command files
**Confidence**: 70% (moved to Suggestions)

## Suggestions (Lower Confidence)

- **Deduplication bypass via minor wording changes** - Multiple command files (Confidence: 70%) -- The deduplication check for pitfalls (`skip if same Area + Issue already exists`) relies on exact string matching of Area and Issue fields. Minor variations in wording (e.g., "glob pattern" vs "Glob pattern mismatch") would bypass dedup and allow near-duplicate entries to accumulate. This could be tightened by normalizing comparisons.

- **No cap enforcement in session-start hook** - `/Users/dean/Sandbox/devflow/scripts/hooks/session-start-memory:122-140` (Confidence: 65%) -- The hook reads TL;DR from knowledge files without verifying the 50-entry cap is respected. If a buggy agent exceeds the cap, the TL;DR could grow very large. The command-level instructions enforce the cap, but there is no defense-in-depth check in the hook.

- **Lock contention between different command types** - Multiple command files (Confidence: 60%) -- Both `/code-review` and `/debug` write to `pitfalls.md` using the same lock path `.memory/.knowledge.lock`. If a user runs both commands concurrently (unlikely but possible), one will block for 30s. This is by design (the lock works correctly), but worth noting as a potential UX issue.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 1 | 0 |
| Should Fix | 0 | 0 | 2 | 0 |
| Pre-existing | 0 | 0 | 1 | 0 |

**Security Score**: 8/10
**Recommendation**: APPROVED_WITH_CONDITIONS

## Conditions

1. **Standardize lock parameters** across all 8 command files that reference `.memory/.knowledge.lock`. The inconsistency between files that specify `(30s timeout, 60s stale recovery)` and those that do not is a correctness concern that could lead to permanent lock-outs from orphaned locks in `debug` and `resolve` flows.

## Assessment

This PR introduces a project knowledge system that stores architectural decisions and known pitfalls as append-only markdown files in `.memory/knowledge/`. From a security perspective:

**Strengths:**
- Knowledge files are local to the project directory (no network exposure)
- The 50-entry cap limits unbounded growth
- Lock mechanism reuses the proven mkdir-based pattern from working memory
- Session-start hook only injects TL;DR summaries (low token cost, limited injection surface)
- Read-only access pattern for most agents (only specific command phases write)

**Concerns (minor):**
- The TL;DR injection into session context is an indirect prompt injection surface, but requires filesystem access to exploit
- Lock specification inconsistency across commands could cause orphaned locks in edge cases
- Append-only and deduplication constraints are enforced by agent instructions only, not by code

The trust model is appropriate for a local CLI tool where all agents run under the same user. No CRITICAL or HIGH blocking issues were found.
