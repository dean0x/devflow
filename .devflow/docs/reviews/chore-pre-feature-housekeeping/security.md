# Security Review Report

**Branch**: chore/pre-feature-housekeeping -> main
**Date**: 2026-03-20
**PR**: #153

## Issues in Your Changes (BLOCKING)

### CRITICAL

(none)

### HIGH

(none)

### MEDIUM

**Unsanitized npm registry output written to cache and displayed in terminal** - `scripts/statusline.sh:210-212,194`
**Confidence**: 82%
- Problem: The output of `npm view devflow-kit version` is captured into `$FETCHED` and written to `~/.cache/devflow/latest-version` without validation. On a subsequent run, this cached value is read and interpolated directly into an ANSI escape sequence displayed in the terminal (`VERSION_BADGE="  \033[35m... ${LATEST_VERSION}\033[0m"`). If the npm registry were to return unexpected content (e.g., a compromised package with a malicious version string containing terminal escape sequences), this could result in terminal injection. The `npm view` command itself can return arbitrary strings if the package metadata is tampered with.
- Fix: Validate the fetched version matches a semver pattern before writing to cache:
  ```bash
  FETCHED=$(npm view devflow-kit version 2>/dev/null)
  if [[ "$FETCHED" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.]+)?$ ]]; then
      echo "$FETCHED" > "$VERSION_CACHE_FILE"
  fi
  ```
  Similarly, validate `LATEST_VERSION` after reading from cache before interpolating into the status line.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Predictable /tmp cache path without ownership check (pre-existing, touched by this PR)** - `scripts/statusline.sh:82-88`
**Confidence**: 80%
- Problem: The pre-existing `/tmp/devflow-base-${REPO_NAME}-${GIT_BRANCH}` cache file path is predictable and located in the world-writable `/tmp` directory. While the only change in this PR (line 83) was replacing `stat -f %m` with `get_mtime()`, the surrounding code reads and writes this file without checking ownership. On a shared system, another user could create a symlink at this path pointing to an arbitrary file, and the `echo "$PR_BASE" > "$CACHE_FILE"` write (line 88) would follow the symlink. Additionally, `cat "$CACHE_FILE"` (line 84) reads untrusted content into `$BASE_BRANCH` which is used in `git rev-list` and `git diff` commands.
- Fix: Use a user-private cache directory instead of `/tmp`, or at minimum check that the file is a regular file (not a symlink) and is owned by the current user:
  ```bash
  CACHE_DIR="${HOME}/.cache/devflow"
  mkdir -p "$CACHE_DIR" 2>/dev/null
  CACHE_FILE="${CACHE_DIR}/base-${REPO_NAME}-${GIT_BRANCH}"
  ```
  Note: The new version-check cache (lines 176-177) correctly uses `${HOME}/.cache/devflow/` -- applying the same pattern here would be consistent.

## Pre-existing Issues (Not Blocking)

(none identified at CRITICAL severity in unchanged code)

## Suggestions (Lower Confidence)

- **Cache file race condition during write** - `scripts/statusline.sh:211-212` (Confidence: 65%) -- The background subshell writes to `VERSION_CACHE_FILE` without atomic write semantics (write-to-temp + rename). If the statusline runs concurrently in two sessions, one could read a partially-written file. Low practical risk given the file contains only a short version string.

- **LATEST_VERSION displayed without length check** - `scripts/statusline.sh:194` (Confidence: 60%) -- If the cache file somehow contains a very long string, it would be displayed verbatim in the status line. A truncation guard (e.g., reject versions longer than 20 chars) would add defense in depth.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 1 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Security Score**: 8/10
**Recommendation**: APPROVED_WITH_CONDITIONS

### Conditions

1. Validate the `npm view` output against a semver regex before caching and displaying it (MEDIUM blocking issue).

### Positive Security Observations

- The new version cache is stored in `${HOME}/.cache/devflow/` (user-private directory) -- good practice compared to the pre-existing `/tmp` pattern.
- The `npm view` call runs in a background subshell with `disown`, preventing it from blocking the status line or leaking errors to the user.
- The skimmer agent's new `tools: ["Bash", "Read"]` restriction is a positive security measure -- platform-enforced tool restrictions are far more reliable than prompt-level prohibitions, reducing the attack surface of the agent.
- No hardcoded secrets, no command injection vectors, no path traversal risks in the new code.
- The `get_mtime()` helper properly handles the cross-platform stat difference without introducing any new attack surface.
