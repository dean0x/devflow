# Pre-Release Review: feat/working-memory

**Branch**: feat/working-memory -> main
**Date**: 2026-02-11
**Commits**: 3 (19c7191, 051bd20, 788b15b)
**Files Changed**: 8 (+348 / -16)

---

## Issues in Your Changes (BLOCKING)

### HIGH

**H1: Hard dependency on `jq` in stop and session-start hooks — silent failure produces no output** - `/Users/dean/Sandbox/devflow/scripts/hooks/stop-update-memory.sh:13` and `/Users/dean/Sandbox/devflow/scripts/hooks/session-start-memory.sh:12`

- Problem: Both `stop-update-memory.sh` and `session-start-memory.sh` use `jq` to parse input JSON (lines 13, 19 in stop; lines 12 in session-start) and to produce output JSON (line 70 in stop; line 69 in session-start). If `jq` is not installed, the `set -euo pipefail` at line 8 will cause the script to exit with a non-zero status on the very first `jq` call, because `2>/dev/null` redirects stderr but does not prevent the non-zero exit code under `set -e`. This means the hook crashes silently rather than gracefully degrading.
- Impact: On a system without `jq`, every Stop hook invocation will error out. Claude Code may surface this as a hook failure. The pre-compact hook (line 40) correctly checks `command -v jq` before using it and has a fallback path — but the other two hooks do not. This is inconsistent: `pre-compact-memory.sh` handles missing `jq` for its JSON *output*, but still uses bare `jq` for *input parsing* at line 13 without a guard.
- Fix: Either (a) guard all three scripts with an early `command -v jq` check and `exit 0` if missing, or (b) provide a fallback parser for input (e.g., `grep`/`sed` to extract `.cwd` from known-structure JSON). Option (a) is simpler and honest — jq is a real dependency. Document it in README.md under Working Memory requirements. Option (b) is fragile. Recommend option (a): add a guard at the top of each script:
  ```bash
  if ! command -v jq &>/dev/null; then
    exit 0  # jq required for Working Memory hooks
  fi
  ```

**H2: `pre-compact-memory.sh` fallback JSON is vulnerable to injection from git branch names** - `/Users/dean/Sandbox/devflow/scripts/hooks/pre-compact-memory.sh:59-67`

- Problem: The no-jq fallback path writes variables directly into a JSON heredoc without escaping:
  ```bash
  cat > "$BACKUP_FILE" <<ENDJSON
  {
    "timestamp": "$TIMESTAMP",
    "trigger": "pre-compact",
    "git": {
      "branch": "$GIT_BRANCH"
    }
  }
  ENDJSON
  ```
  If `GIT_BRANCH` contains characters like `"`, `\`, or newlines (e.g., a branch named `feat/"test`), the resulting JSON will be malformed or could inject arbitrary JSON keys.
- Impact: Malformed `working-memory-backup.json`. Any downstream consumer that parses this file will fail. While unlikely with typical branch names, it is a correctness defect in the fallback path that exists specifically for environments without `jq` (the tool that would do proper escaping).
- Fix: If keeping the fallback, sanitize the variable: `GIT_BRANCH_SAFE=$(echo "$GIT_BRANCH" | tr -d '"\\\n')`. Or, since H1 recommends requiring `jq` anyway, remove the fallback entirely and use the `jq` path unconditionally (after the guard from H1 ensures `jq` exists).

**H3: `session-start-memory.sh` stat version detection is incorrect on macOS** - `/Users/dean/Sandbox/devflow/scripts/hooks/session-start-memory.sh:27`

- Problem: The macOS/Linux stat detection uses:
  ```bash
  if stat --version &>/dev/null 2>&1; then
  ```
  The `2>&1` is redundant since `&>` already redirects both stdout and stderr. More critically, this pattern appears on lines 27-31 of session-start and lines 27-31 of the stop hook. On macOS, `stat --version` exits with status 1, so the `else` branch runs correctly. However, if a future macOS coreutils install (e.g., via Homebrew) provides GNU stat, the detection silently switches behavior. This is acceptable but the redundant redirect (`&>/dev/null 2>&1`) should be cleaned up for clarity.
- Impact: Functional on current macOS/Linux. Cosmetic redundancy.
- Severity downgrade: This is actually LOW since behavior is correct. Listed here for completeness.

### MEDIUM

**M1: Stop hook `timeout: 10` in settings.json may be too short for Claude to write the file** - `/Users/dean/Sandbox/devflow/src/templates/settings.json:14`

- Problem: The Stop hook has `"timeout": 10` (seconds). The hook blocks and instructs Claude to write `.docs/WORKING-MEMORY.md`. If Claude's write takes more than 10 seconds (large context, slow disk, network latency for API call), the hook times out.
- Impact: Working memory silently not updated. The throttle logic means it will retry on the next response (after 2 min), but repeated timeouts could mean memory is never written in slow environments.
- Fix: Consider increasing to 15-20 seconds, or document the timeout trade-off. The PreCompact hook also has `timeout: 10` which is less concerning since it only writes a small JSON file locally.

**M2: `session-start-memory.sh` does not guard against `.docs/` directory check** - `/Users/dean/Sandbox/devflow/scripts/hooks/session-start-memory.sh:17-21`

- Problem: The session-start hook checks `[ ! -f "$MEMORY_FILE" ]` but does NOT check `[ ! -d "$CWD/.docs" ]` like the other two hooks do. It relies on the file existence check alone. This means if someone creates a `.docs/WORKING-MEMORY.md` outside a DevFlow project (unlikely but possible), the hook would activate.
- Impact: Low probability. The hook would inject stale/wrong context.
- Fix: Add the same `.docs/` directory guard used in the other two hooks for consistency:
  ```bash
  if [ ! -d "$CWD/.docs" ]; then
    exit 0
  fi
  ```

**M3: `STALE_WARNING` uses `\n` literal in variable, relies on implicit `echo -e` behavior** - `/Users/dean/Sandbox/devflow/scripts/hooks/session-start-memory.sh:38`

- Problem: `STALE_WARNING="... ${HOURS}h old. Verify before relying on it.\n\n"` embeds literal `\n` characters. When this variable is interpolated into `CONTEXT` and then passed to `jq -n --arg`, jq treats `\n` as literal backslash-n, not a newline. So the output JSON will contain the literal string `\n\n` rather than actual newline characters.
- Impact: The staleness warning will appear as `... Verify before relying on it.\n\n--- WORKING MEMORY ...` instead of having proper line breaks. Claude will likely interpret it correctly anyway, but it is a formatting bug.
- Fix: Use actual newlines:
  ```bash
  STALE_WARNING="Warning: This working memory is ${HOURS}h old. Verify before relying on it.

  "
  ```
  Or use `printf`: `STALE_WARNING=$(printf "Warning: ... %dh old.\n\n" "$HOURS")`

**M4: Subshell piping in `pre-compact-memory.sh` loses output from `while read` loop** - `/Users/dean/Sandbox/devflow/scripts/hooks/pre-compact-memory.sh:82-84` and lines 87-89

- Problem: The pattern `echo "$GIT_LOG" | head -3 | while IFS= read -r line; do ... done` runs the `while` loop in a subshell due to the pipe. The output is captured by the outer `{ ... } > "$MEMORY_FILE"` command group, so in *this specific case* stdout is correctly redirected. However, this relies on the subtle behavior that `echo` inside the subshell writes to the inherited stdout. If someone refactors this to use variables instead of stdout, the subshell trap will silently lose data.
- Impact: Currently functional. Fragility risk on future refactoring.
- Severity: LOW (informational, no current bug).

---

## Issues in Code You Touched (Should Fix)

### MEDIUM

**S1: `init.ts` hooks check warns but does not offer to merge hooks into existing settings** - `/Users/dean/Sandbox/devflow/src/cli/commands/init.ts:425-432`

- Problem: When settings.json exists without hooks, the code warns:
  ```
  Settings exist without hooks. Working Memory requires hooks.
  Run with --override-settings to enable, or manually add hooks to settings.json
  ```
  But `--override-settings` replaces the ENTIRE settings.json, which will overwrite any user customizations (custom permissions, env vars, etc.). There is no merge option.
- Impact: Users upgrading from v1 (which had settings.json without hooks) must either manually merge hooks or lose their customizations. This is a poor upgrade experience.
- Fix: Add a `--merge-hooks` option or implement a JSON merge that only adds the `hooks` key to existing settings. At minimum, the warning message should explicitly state that `--override-settings` will REPLACE all settings, not just add hooks.

**S2: `chmodRecursive` does not handle symlinks** - `/Users/dean/Sandbox/devflow/src/cli/commands/init.ts:576-586`

- Problem: `entry.isFile()` returns false for symlinks. If the hooks directory contains symlinks (unlikely in current codebase but possible), they would silently not be made executable.
- Impact: Low. No symlinks exist today.
- Fix: Add `entry.isSymbolicLink()` check if needed in the future.

---

## Pre-existing Issues (Not Blocking)

### MEDIUM

**P1: `statusline.sh` has no `set -euo pipefail`** - `/Users/dean/Sandbox/devflow/scripts/statusline.sh:1-8`

- Problem: The pre-existing statusline.sh does not use `set -euo pipefail`, while all three new hook scripts do. This is an inconsistency in defensive shell scripting across the `scripts/` directory.
- Impact: statusline.sh errors are silently swallowed, which may be intentional for a status line (cosmetic only), but it sets a bad precedent.

### LOW

**P2: `statusline.sh` `jq` fallback is a degraded experience** - `/Users/dean/Sandbox/devflow/scripts/statusline.sh:18-23`

- Problem: statusline.sh has a `jq` fallback that shows `"claude"` and `$(pwd)` — a degraded but functional experience. The new hook scripts do not follow this pattern (they will crash under `set -e`). This is an inconsistency in the `jq` handling philosophy.

---

## Correctness Deep-Dive: Edge Cases

### macOS vs Linux `stat`

The `stat --version` detection pattern (used in stop-update-memory.sh:27 and session-start-memory.sh:27) works correctly:
- **Linux (GNU coreutils)**: `stat --version` exits 0, uses `stat -c %Y`
- **macOS (BSD stat)**: `stat --version` exits 1, uses `stat -f %m`
- **Edge case**: Homebrew GNU coreutils on macOS would change behavior. Acceptable risk.

### Non-git repos

All three hooks handle non-git repos correctly:
- stop-update-memory.sh: Does not check for git (it only blocks Claude to write a file, git state is irrelevant)
- session-start-memory.sh:46: `git rev-parse` guard with `|| echo ""` fallbacks
- pre-compact-memory.sh:32: Same pattern

### Empty variables

- `GIT_BRANCH=""`, `GIT_STATUS=""`, `GIT_LOG=""` are initialized before the git block in all scripts. If git commands fail, empty strings are used. This is correct.
- `CWD` is checked for empty immediately after extraction. Correct.

### `set -euo pipefail` interactions

- The `|| echo ""` and `|| echo "unknown"` patterns correctly prevent `set -e` from triggering on git command failures.
- `head -20`, `head -30` on empty input produce no output and exit 0. Correct.
- `echo "$INPUT" | jq ...` with `2>/dev/null`: if `jq` is missing, the exit code is non-zero and `set -e` WILL terminate the script. This is the root of issue H1.

---

## Documentation Drift Analysis

### CLAUDE.md

- **Accurate**: Working Memory description, hook names, file paths, `.docs/` structure all match implementation.
- **Minor gap**: CLAUDE.md says "Stop hook -> Claude writes `.docs/WORKING-MEMORY.md` after every response" but the throttle means it skips if updated <2 min ago. Should say "after every response (throttled to 2min intervals)".

### README.md

- **Accurate**: Hook table correctly describes all three hooks with accurate trigger descriptions.
- **Good**: Throttle behavior mentioned in Stop hook description.
- **Good**: SessionStart staleness warning documented.
- **Good**: "per-project" scoping documented.

### docs/reference/file-organization.md

- **Accurate**: Hook table, flow description, and install paths all correct.
- **Good**: `stop_hook_active` re-entry flow documented accurately.
- **Minor**: Says "All hooks are no-ops in projects without `.docs/`" but session-start-memory.sh checks for the MEMORY_FILE, not `.docs/` directory (see M2).

---

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 3 | 1 | 0 |
| Should Fix | 0 | 0 | 2 | 0 |
| Pre-existing | 0 | 0 | 1 | 1 |

### Issue Breakdown

| ID | Severity | Category | File | Summary |
|----|----------|----------|------|---------|
| H1 | HIGH | Blocking | stop-update-memory.sh, session-start-memory.sh | `jq` hard dependency crashes under `set -e` |
| H2 | HIGH | Blocking | pre-compact-memory.sh:59-67 | JSON injection in no-jq fallback |
| H3 | HIGH->LOW | Blocking | session-start-memory.sh:27 | Redundant redirect (cosmetic) |
| M1 | MEDIUM | Blocking | settings.json:14 | 10s timeout may be too short |
| M2 | MEDIUM | Should Fix | session-start-memory.sh:17-21 | Missing `.docs/` directory guard |
| M3 | MEDIUM | Should Fix | session-start-memory.sh:38 | `\n` literal in stale warning |
| M4 | LOW | Informational | pre-compact-memory.sh:82-89 | Subshell pipe fragility |
| S1 | MEDIUM | Should Fix | init.ts:425-432 | No merge option for hooks into existing settings |
| S2 | LOW | Informational | init.ts:576-586 | `chmodRecursive` ignores symlinks |
| P1 | MEDIUM | Pre-existing | statusline.sh:1-8 | No `set -euo pipefail` |
| P2 | LOW | Pre-existing | statusline.sh:18-23 | Inconsistent jq fallback philosophy |

### Regression Risk Assessment

| Area | Risk | Reason |
|------|------|--------|
| Existing commands (review, implement, etc.) | NONE | No changes to any command, agent, or skill files |
| Settings.json for existing users | LOW | New `hooks` key is additive; only affects fresh installs or `--override-settings` |
| init.ts `chmodRecursive` | LOW | Replaces flat `readdir`+`chmod` with recursive version; strictly more capable |
| init.ts hooks warning | NONE | Only adds a warning message; no behavior change for existing settings |
| `.docs/` structure | NONE | New files (`WORKING-MEMORY.md`, `working-memory-backup.json`) are additive |

**Overall Regression Risk**: LOW. The branch is additive. No existing behavior is modified. The only risk is the hooks misbehaving in edge cases (missing `jq`), which only affects the new Working Memory feature, not existing functionality.

---

**Pre-Release Score**: 7/10
**Recommendation**: CHANGES_REQUESTED

**Rationale**: The core design is sound and well-documented. The three HIGH issues (H1, H2) are straightforward fixes: add a `jq` guard to the top of each script and either remove or fix the fallback JSON path. M2 and M3 are quick consistency/correctness fixes. S1 (merge option for existing settings) is the most impactful UX issue for users upgrading from v1 but is not a blocking defect for initial release. After addressing H1 and H2, this branch is ready to merge.
