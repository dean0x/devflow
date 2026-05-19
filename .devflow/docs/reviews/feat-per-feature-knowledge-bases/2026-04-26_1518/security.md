# Security Review Report

**Branch**: feat/per-feature-knowledge-bases -> main
**Date**: 2026-04-26

## Issues in Your Changes (BLOCKING)

### CRITICAL

(none)

### HIGH

**Prompt injection surface via index.json content in background-kb-refresh** - `scripts/hooks/background-kb-refresh:116-139`
**Confidence**: 82%
- Problem: The `background-kb-refresh` script reads metadata fields (NAME, DIRS, CATEGORY, CHANGED) from `feature-kb.cjs refresh-context` and interpolates them directly into a prompt string that is passed as a CLI argument to `claude -p`. The `NAME` field originates from `index.json`, which is committed to the git repo. If an attacker (or a compromised contributor) crafts a malicious `index.json` entry with a specially constructed `name` value (e.g., containing prompt injection payloads like "Ignore previous instructions..."), that payload would be injected verbatim into the LLM prompt. While the `claude -p` call uses `--allowedTools 'Read,Grep,Glob,Write,Bash'` with `--dangerously-skip-permissions`, a successful prompt injection could cause the LLM to write arbitrary files or execute arbitrary bash commands within the worktree.
- Fix: Sanitize or escape metadata fields before interpolating into the prompt. At minimum, truncate NAME to a reasonable length and strip control characters. Alternatively, pass the prompt via a temporary file or stdin rather than as a CLI argument to avoid argument-level injection. The same concern applies to `kb.ts:484-507` (refresh command) where `featureName` and `kbDirectories` from the index are interpolated into the prompt, and `kb.ts:380-407` (create command) where user-provided `name` and `directories` are interpolated.

  Note: The `feature-kb.cjs` module correctly uses `execFileSync` with array args to prevent shell injection (line 134). However, the security boundary here is the LLM prompt itself, not the shell. The index.json content flows through `refresh-context` output into the bash script's PROMPT variable and then into the LLM as trusted instructions.

  Also note: The existing `background-learning` and `background-memory-update` hooks use a similar `--dangerously-skip-permissions` pattern, but their prompt content is derived from session transcripts (user-controlled anyway), not from committed repository files that could be modified by third-party contributors.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**`--dangerously-skip-permissions` grants Bash tool to background refresh agent** - `scripts/hooks/background-kb-refresh:142-147`
**Confidence**: 84%
- Problem: The background KB refresh agent is spawned with `--dangerously-skip-permissions` and `--allowedTools 'Read,Grep,Glob,Write,Bash'`. The Bash tool combined with skip-permissions means the refresh agent can execute arbitrary shell commands without user approval. While this is consistent with existing background hooks (`background-learning`, `background-memory-update`), the KB refresh agent operates on repository-committed data (`index.json`, `KNOWLEDGE.md`), making it a slightly broader attack surface than the memory updater which operates on ephemeral session data.
- Fix: Consider whether the `Bash` tool is strictly necessary for the refresh agent. The Knowledge agent's primary job is to Read changed files and Write updated KNOWLEDGE.md + run `node feature-kb.cjs update-index`. If `Bash` could be removed from `allowedTools`, the attack surface shrinks significantly. The agent definition at `shared/agents/knowledge.md:14` lists Bash as a tool, but the refresh prompt at line 133-134 only needs `node scripts/hooks/lib/feature-kb.cjs update-index` which could potentially be handled via a Write + a dedicated tool rather than Bash. If Bash is needed for `update-index`, consider restricting it to only that command pattern.

## Pre-existing Issues (Not Blocking)

(none)

## Suggestions (Lower Confidence)

- **Lock directory race window in background-kb-refresh** - `scripts/hooks/background-kb-refresh:86` (Confidence: 65%) -- The refresh timestamp is written to `.kb-last-refresh` immediately after acquiring the lock but before any actual refresh work is done. If the process crashes between writing the timestamp and completing the refresh, the next session-end will skip the refresh for 2 hours despite no work being done. This is a minor availability concern, not a security issue, but could mask stale KBs.

- **`session-start-memory` creates `.memory/knowledge/` directory without validation** - `scripts/hooks/session-start-memory:114-115` (Confidence: 62%) -- The heal path creates `.memory/knowledge/` via `mkdir -p` when `.memory/` exists but `.memory/knowledge/` does not. This is reasonable self-healing, but it runs on every session start and the error is silently swallowed. If the `.memory/` directory were somehow a symlink to a sensitive location (highly unlikely in practice), this could create a directory in an unexpected place.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 0 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Security Score**: 7/10
**Recommendation**: CHANGES_REQUESTED

The PR introduces solid defensive patterns: `validateSlug()` prevents path traversal (CWE-23), `execFileSync` with array args prevents command injection, and `mkdir`-based locks prevent concurrent corruption. The slug validation is thorough (rejects `..`, `/`, `\`, dot-prefixed, and non-kebab-case values) and is applied consistently at all entry points. The main security concern is the prompt injection surface where repository-committed `index.json` metadata is interpolated into LLM prompts that run with `--dangerously-skip-permissions` and Bash access. While the risk is bounded (attacker needs write access to the repo's `.features/index.json`), the impact of a successful prompt injection through this vector is significant given the unrestricted tool access.
