# Security Review Report

**Branch**: feat-phase-3-decouple-decisions-agent -> main
**Date**: 2026-05-06

## Issues in Your Changes (BLOCKING)

### CRITICAL

(none)

### HIGH

**Temp file created in world-readable location with predictable name** - `src/cli/utils/decisions-agent.ts:112`, `src/cli/utils/learning-agent.ts:64`
**Confidence**: 82%
- Problem: Both agent runners write model response JSON to `os.tmpdir()` with names like `.decisions-response-<timestamp>-<random>.tmp`. While the random suffix provides some protection, the file is created with default permissions in `/tmp` (typically world-readable). The file contains session-derived content (dialog pairs, user signals, and model observations). Between creation and cleanup, another process on the same machine could read this content.
- Impact: Information disclosure of session content if a local attacker is watching the temp directory. The threat model is limited to multi-user systems or compromised local processes, but the data may contain user dialog about architecture, decisions, and code patterns.
- Fix: Use `fs.mkdtemp` to create a per-invocation temp directory with restricted permissions, or write the temp file with mode `0o600`:
  ```typescript
  import { constants } from 'fs';
  // ...
  await fs.writeFile(responseFile, responseJson, { encoding: 'utf-8', mode: 0o600 });
  ```

### MEDIUM

(none)

## Issues in Code You Touched (Should Fix)

### HIGH

(none)

### MEDIUM

**Unvalidated `--cwd` flag passed to filesystem operations** - `src/cli/commands/decisions.ts:170`, `src/cli/commands/learn.ts:518`
**Confidence**: 80%
- Problem: The `--cwd <path>` option is passed directly from the CLI to filesystem operations without validation. While the calling hook (`session-end-decisions`, `session-end-learning`) normally provides a trustworthy CWD, the CLI subcommand is also directly invocable by the user. A malicious `--cwd` value (e.g., `--cwd /etc`) could cause the agent to write lock directories, log files, and batch ID files into arbitrary locations. The `split-migration.cjs` does use `safePath()` with root validation, but the TypeScript callers do not validate that `cwd` is a reasonable project root before constructing paths like `path.join(cwd, '.memory', ...)`.
- Impact: Low in practice because the attacker would need to be the local user running devflow, but the principle of defense-in-depth recommends validating the path. An accidental typo or automation misconfiguration could also cause unexpected filesystem writes.
- Fix: Add a basic sanity check that `cwd` resolves to a directory that exists and contains a `.memory` subdirectory (or at least is a plausible project root):
  ```typescript
  const resolvedCwd = path.resolve(options.cwd ?? process.cwd());
  if (!fs.existsSync(path.join(resolvedCwd, '.memory'))) {
    console.error('--cwd does not point to a devflow project (no .memory/ directory)');
    process.exit(1);
  }
  ```

## Pre-existing Issues (Not Blocking)

### MEDIUM

**`--dangerously-skip-permissions` flag in agent invocations** - `src/cli/utils/decisions-agent.ts:121`, `src/cli/utils/learning-agent.ts:72`
**Confidence**: 85%
- Problem: Both agent runners invoke `claude -p` with `--dangerously-skip-permissions`. This is documented as intentional (non-interactive `claude -p` requires it) and the tool allowlist is restricted to `Read` only, which limits the blast radius. However, this is worth noting as a security-relevant design choice. The agents process user session content and pass it as a prompt to a subprocess.
- Impact: Minimal given the `--allowedTools Read` restriction, but worth flagging for awareness. If the tool allowlist were accidentally broadened, the implications would be significant.

**Regex-based ReDoS surface sanitized in reconcile-manifest** - `scripts/hooks/json-helper.cjs:1558-1560`
**Confidence**: 90%
- This is a positive finding. The diff adds `entry.anchorId.replace(/[^A-Z0-9-]/gi, '')` before embedding the anchor ID into a regex, eliminating a potential ReDoS vector from untrusted manifest data. This is good security hygiene.

## Suggestions (Lower Confidence)

- **Session ID validation could be stricter** - `scripts/hooks/session-end-decisions:106` (Confidence: 65%) -- The session ID is validated with `^[a-zA-Z0-9_-]+$` which is reasonable but permissive. Claude session IDs appear to be UUIDs; tightening to UUID format would reduce the attack surface if the transcript directory is ever used in a shell context. Low risk since the ID is only used in `path.join()` calls.

- **Notification file path override not validated** - `scripts/hooks/json-helper.cjs:1183-1189` (Confidence: 70%) -- The `--notifications-path` and `--manifest-path` overrides are passed through `safePath()` which resolves to an absolute path but does not constrain the write target to within the project. A malicious caller could write notification JSON to any writable path. In practice, callers are internal TypeScript code, not user input.

- **Background process spawned with CWD in nohup command** - `scripts/hooks/session-end-decisions:120-121` (Confidence: 62%) -- The CWD is passed as a `--cwd` flag to the background process. The CWD originates from the hook JSON input, which is provided by Claude Code itself and should be trustworthy. However, the value is not sanitized before use in the command line.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 0 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 2 | 0 |

**Security Score**: 8/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The PR introduces a well-structured decoupling of the decisions agent from the learning agent. Security posture is good overall:

- Path traversal defense is present in `split-migration.cjs` via `safePath()` with root constraints.
- The anchor ID regex sanitization in `reconcile-manifest` is a positive security improvement.
- Lock management uses POSIX-atomic `mkdir` with stale-lock breaking -- correct and safe.
- Session ID validation is present in the hook script.
- Notification/manifest file writes use atomic write patterns (tmp + rename).

The one blocking issue (temp file permissions) is straightforward to fix. The `--cwd` validation suggestion is a defense-in-depth improvement that would be good to address. The `--dangerously-skip-permissions` usage is a known design tradeoff with appropriate mitigations (Read-only tool allowlist).

No migration code concerns apply here -- the split-migration is a data partitioning operation, not a backward-compat layer (applies ADR-001: clean break philosophy). The migration uses an idempotent sentinel (`.migration-split-done`) which avoids PF-001's pitfall of over-engineering compat layers.
