# Security Review Report

**Branch**: chore/init-flow-improvements -> main
**Date**: 2026-03-22
**Reviewer Focus**: Security patterns (injection, auth, secrets, path traversal, input validation)

## Issues in Your Changes (BLOCKING)

### HIGH

**Unvalidated paths from history.jsonl used as file write targets** - `src/cli/utils/post-install.ts:443-455`, `src/cli/commands/init.ts:745-746`
**Confidence**: 82%
- Problem: `discoverProjectGitRoots()` reads `~/.claude/history.jsonl`, parses project paths from JSON entries, and returns them directly. These paths are then passed to `installClaudeignore(root, rootDir, verbose)` which writes a file at `path.join(gitRoot, '.claudeignore')`. The `history.jsonl` file is user-local and written by Claude Code itself, so it is not an externally-attacker-controlled input. However, the paths are not validated or normalized (no `path.resolve()`, no check for path traversal sequences like `../`, no allowlisting). If `history.jsonl` were corrupted or hand-edited to contain a path like `/etc` or `/tmp/../../etc`, `installClaudeignore` would attempt to write `.claudeignore` there. The `wx` flag prevents overwriting existing files, which limits the blast radius, but it could still create unexpected files in arbitrary directories.
- Impact: An attacker with write access to `~/.claude/history.jsonl` (same threat level as the user themselves) could cause file creation in unexpected directories. Risk is mitigated by the `wx` flag (no overwrite) and the `.git` directory existence check, which acts as an implicit validation gate -- arbitrary paths like `/etc` would not have a `.git` subdirectory.
- Fix: Add `path.resolve()` normalization and optionally validate that discovered paths are under the user's home directory or other reasonable boundaries:
  ```typescript
  for (const project of projects) {
    const resolved = path.resolve(project);
    try {
      await fs.access(path.join(resolved, '.git'));
      gitRoots.push(resolved);
    } catch {
      // Not a git repo or doesn't exist -- skip
    }
  }
  ```

## Issues in Code You Touched (Should Fix)

_No issues found._

## Pre-existing Issues (Not Blocking)

### MEDIUM

**Shell command injection via path interpolation in sudo commands** - `src/cli/utils/post-install.ts:148,152,268,272`
**Confidence**: 85%
- Problem: The `installManagedSettings` and `removeManagedSettings` functions use `execSync` with string interpolation inside single-quoted shell arguments: `execSync(\`sudo mkdir -p '${managedDir}'\`)`. While single-quoting defends against most injection, a path containing a literal single quote (`'`) would break out of the quoting and enable command injection. The `managedDir` comes from `getManagedSettingsPath()` which returns platform-specific system paths (e.g., `/etc/claude/`) that are unlikely to contain single quotes, but the pattern is fragile.
- Impact: A crafted `managedDir` value containing `'` could execute arbitrary commands as root via sudo. The practical attack surface is very low because `getManagedSettingsPath()` returns hardcoded platform paths, but the pattern violates defense-in-depth.
- Fix: Use array-form `execFileSync` or escape single quotes in the interpolated values:
  ```typescript
  import { execFileSync } from 'child_process';
  execFileSync('sudo', ['mkdir', '-p', managedDir], { stdio: 'inherit' });
  execFileSync('sudo', ['cp', tmpFile, managedPath], { stdio: 'inherit' });
  ```

## Suggestions (Lower Confidence)

- **Large history.jsonl could cause memory pressure** - `src/cli/utils/post-install.ts:433` (Confidence: 65%) -- The entire `history.jsonl` file is read into memory at once. If this file grows very large (e.g., thousands of sessions over months), it could briefly spike memory usage. Consider streaming line-by-line with `readline` for very large files, though this is unlikely to be a practical concern for a CLI tool.

- **No path length or count bounds on discovered projects** - `src/cli/commands/init.ts:745` (Confidence: 62%) -- The loop over `discoveredProjects` has no upper bound. A `history.jsonl` with thousands of unique project entries would cause the init command to attempt `.claudeignore` creation in all of them. This is a denial-of-service risk against the user's own time, not a security vulnerability per se.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 0 | - |
| Should Fix | - | 0 | 0 | - |
| Pre-existing | - | 0 | 1 | 0 |

**Security Score**: 8/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The changes are primarily a UX refactor of the init flow, moving prompts earlier (prompt-then-act pattern) and adding a new `discoverProjectGitRoots()` function. The security posture is solid overall:

1. The `.claudeignore` write uses the `wx` flag, preventing overwrites of existing files.
2. The `.git` directory check in `discoverProjectGitRoots` acts as an implicit validation gate against arbitrary paths.
3. The `managedSettingsConfirmed` boolean correctly gates the sudo operation behind explicit user consent, and the sudo confirmation prompt was moved to the prompt phase (pre-spinner) -- a good UX improvement that does not weaken security.
4. No new secret handling, no new network calls, no new `execSync` calls were introduced.

The one blocking HIGH finding (unvalidated paths from history.jsonl) is mitigated by the `.git` check and `wx` flag, but adding `path.resolve()` normalization would strengthen defense-in-depth. The pre-existing shell injection pattern in sudo commands is inherited from prior code and should be addressed separately.
