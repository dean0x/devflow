# Security Review Report

**Branch**: feature/triage-layer-ci-gate -> main
**Date**: 2026-05-16

## Issues in Your Changes (BLOCKING)

### CRITICAL

(none)

### HIGH

(none)

### MEDIUM

(none)

## Issues in Code You Touched (Should Fix)

(none)

## Pre-existing Issues (Not Blocking)

### MEDIUM

**Sentinel files writable by any local user** - `.memory/.working-memory-disabled`, `.memory/.learning-disabled`
**Confidence**: 65%
- Problem: Sentinel files are created with default permissions (typically 0644 on most systems) rather than restricted permissions (0600). Since these sentinels gate whether hooks execute (memory capture, learning agent, decisions scanner), a local attacker with write access to the project directory could create or remove sentinel files to silently disable or enable features without the user's knowledge. However, this requires the attacker to already have write access to the project directory, which significantly limits exploitability.
- Fix: This is a defense-in-depth concern only. The files live inside the user's project `.memory/` directory where the attacker would already need write access to the entire project. Low practical risk for a developer tool.

## Suggestions (Lower Confidence)

- **Sentinel creation via `fs.writeFile` without explicit mode** - `src/cli/commands/memory.ts:355`, `src/cli/commands/learn.ts:956`, `src/cli/commands/init.ts:1256-1267` (Confidence: 60%) -- The `fs.writeFile(sentinel, '', 'utf-8')` calls do not specify a `mode` option. While 0644 is acceptable for most developer tooling, the queue file creation in `prompt-capture-memory` (line 40-41) and `stop-update-memory` (line 77-78) already uses `umask 077` to restrict permissions. Consider matching that pattern for sentinel files as well for consistency, though the security impact is minimal since these are empty marker files in a user-owned directory.

- **`--dangerously-skip-permissions` in background-memory-update** - `scripts/hooks/background-memory-update:270` (Confidence: 65%) -- The background memory updater spawns `claude -p --dangerously-skip-permissions`. This is a pre-existing pattern (not introduced in this PR) but is adjacent to the sentinel guard changes. The flag grants the background Haiku process unrestricted tool access (Read + Write only via `--allowedTools`, but the dangerous flag overrides the interactive permission system). The `--allowedTools 'Read,Write'` restriction mitigates this, and the process runs as the same user. Noting for awareness only.

- **No path traversal guard on `CWD` in new session-start-context hook** - `scripts/hooks/session-start-context:20-22` (Confidence: 62%) -- The `CWD` value comes from Claude Code's JSON input (trusted source) and is used to construct paths for sentinel checks and file reads. The `decisions-usage-scan.cjs` has an explicit `path.isAbsolute(rawCwd)` check (line 20), but the shell hooks trust the `CWD` from stdin JSON without validation. This is consistent with all other shell hooks (session-start-memory, stop-update-memory, etc.) which also trust `CWD` from Claude's JSON. Since the input source is the Claude Code runtime (not user-controlled), this is very low risk.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 0 | - |
| Should Fix | - | 0 | 0 | - |
| Pre-existing | - | - | 1 | 0 |

**Security Score**: 9/10
**Recommendation**: APPROVED

## Analysis

This PR introduces sentinel-based disable guards for memory and learning hooks, extracts cross-feature context injection into a new always-on `session-start-context` hook, and fixes a gap where the decisions usage scanner ran even when decisions were disabled.

From a security perspective, the changes are well-structured:

1. **Sentinel guard pattern is sound**: The sentinel check (`[ -f "$CWD/.memory/.working-memory-disabled" ] && exit 0`) is a simple, race-condition-resistant pattern. File existence checks in bash are atomic at the syscall level. The guards are placed early in each hook, before any data processing or file writes occur. This follows the defense-in-depth principle -- hooks now have both registration-level control (settings.json) and runtime-level control (sentinel files).

2. **No new attack surface**: The `session-start-context` hook reads from the same trusted paths as the existing `session-start-memory` hook. All file operations are within the user's own `.memory/` directory. No new external inputs are processed. The hook's output is a JSON envelope injected as `additionalContext` -- the same trusted channel used by other SessionStart hooks.

3. **Decisions scanner gating is correct** (avoids PF-001 philosophy): The `stop-update-memory` hook now gates the decisions scanner invocation on `decisions/.disabled` sentinel (line 104), and the scanner itself independently checks the same sentinel (line 30 of `decisions-usage-scan.cjs`). This is defense-in-depth -- two independent checks prevent the scanner from running when disabled.

4. **Uninstall cleanup is complete**: The `removeContextHook` call was added to uninstall.ts (line 417), and `removeDecisionsHook` was also added (line 414 -- fixing a pre-existing gap). Both follow the existing idempotent remove-then-check pattern.

5. **No secrets or credentials exposed**: Empty sentinel files contain no sensitive data. No new environment variables, API keys, or tokens are introduced.

6. **CLI sentinel management follows existing patterns** (applies ADR-001 -- clean break): The enable/disable paths in `memory.ts` and `learn.ts` were refactored to always manage the sentinel regardless of whether the hook registration changed. This ensures consistent state: `--enable` always removes the sentinel, `--disable` always creates it.

The only items noted are very low-risk defense-in-depth suggestions around file permissions for empty sentinel files, all below the 80% confidence threshold.
