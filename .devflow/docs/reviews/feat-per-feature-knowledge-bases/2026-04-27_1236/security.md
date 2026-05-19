# Security Review Report

**Branch**: feat/per-feature-knowledge-bases -> main
**Date**: 2026-04-27

## Issues in Your Changes (BLOCKING)

### HIGH

**Shell injection via unquoted sidecar path interpolation in inline Node script** - `scripts/hooks/background-kb-refresh:165`
**Confidence**: 85%
- Problem: The `$SIDECAR` variable is interpolated directly into a single-quoted Node.js string literal inside `node -e`. If the sidecar file path contains a single quote (which is possible if `$CWD` contains a single quote in the directory path), the inline Node script breaks out of the string boundary. While `$SLUG` is validated to be kebab-case, `$CWD` comes from the hook's first argument (the working directory) and has no path-character restrictions.
  ```bash
  REF_FILES=$(node -e "
    try {
      const d = JSON.parse(require('fs').readFileSync('$SIDECAR','utf8'));
      ...
  ```
  If `$CWD` is `/tmp/user's project`, then `$SIDECAR` becomes `/tmp/user's project/.features/slug/.refresh-result.json`, and the single quote breaks the Node string literal, causing either a syntax error or unintended code execution.
- Fix: Pass the sidecar path as a command-line argument or environment variable instead of interpolating into code:
  ```bash
  REF_FILES=$(SIDECAR_PATH="$SIDECAR" node -e "
    try {
      const d = JSON.parse(require('fs').readFileSync(process.env.SIDECAR_PATH,'utf8'));
      console.log(JSON.stringify(d.referencedFiles || []));
    } catch { console.log('[]'); }
  " 2>/dev/null || echo "[]")
  ```

### MEDIUM

**Removal of `set -e` weakens fail-fast behavior in background scripts** - `scripts/hooks/background-kb-refresh:8`, `scripts/hooks/background-learning:9`, `scripts/hooks/background-memory-update:9`
**Confidence**: 82%
- Problem: `set -e` was removed from three background hook scripts. While these scripts are designed to be resilient (they log errors and continue), removing `set -e` means intermediate command failures (e.g., `source "$SCRIPT_DIR/log-paths"`, `source "$SCRIPT_DIR/json-parse"`, `source "$SCRIPT_DIR/get-mtime"`) will silently proceed with undefined state. This could mask failures where critical setup steps (like sourcing helper libraries) fail, allowing the script to continue with missing functions, potentially leading to silent data corruption or writing to wrong paths.
- Fix: Either keep `set -e` with explicit error handling at points that should tolerate failure (using `|| true`), or add explicit guards after critical source commands:
  ```bash
  source "$SCRIPT_DIR/log-paths" || { echo "Failed to source log-paths" >&2; exit 1; }
  source "$SCRIPT_DIR/get-mtime" || { echo "Failed to source get-mtime" >&2; exit 1; }
  ```

**LLM-controlled sidecar JSON parsed without schema validation** - `src/cli/commands/kb.ts:421`, `src/cli/commands/kb.ts:532`
**Confidence**: 80%
- Problem: The sidecar JSON files (`.create-result.json`, `.refresh-result.json`) are written by the LLM agent (`claude -p`). Their contents are parsed with `JSON.parse` and fields are used directly: `sidecar.referencedFiles` is passed to `updateIndex` which writes it to `index.json`, and `sidecar.category` and `sidecar.description` are similarly forwarded. If the LLM writes unexpected types (e.g., `referencedFiles` as a string instead of an array, or `category` containing arbitrary long content), these values propagate into the persistent index without validation. The `updateIndex` function does validate the slug but does not validate the types of `referencedFiles`, `category`, or `description`.
- Fix: Add minimal schema validation before using sidecar data:
  ```typescript
  const rawSidecar = JSON.parse(await fs.readFile(sidecarPath, 'utf8'));
  const sidecar = {
    referencedFiles: Array.isArray(rawSidecar.referencedFiles)
      ? rawSidecar.referencedFiles.filter((f: unknown): f is string => typeof f === 'string')
      : [],
    category: typeof rawSidecar.category === 'string' ? rawSidecar.category : undefined,
    description: typeof rawSidecar.description === 'string' ? rawSidecar.description : undefined,
  };
  ```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**`--dangerously-skip-permissions` used without `--model` in `kb create`** - `src/cli/commands/kb.ts:412`
**Confidence**: 82%
- Problem: The `kb create` command invokes `claude -p` with `--dangerously-skip-permissions` but without specifying `--model`, unlike the background refresh which pins `--model sonnet`. This means the create command will use whatever model the user has configured as default. While `--allowedTools` restricts to `Read,Grep,Glob,Write` (a good security improvement in this PR, removing `Bash`), the missing `--model` pin means the cost and behavior could vary unexpectedly.
- Fix: Add `--model`, `sonnet` to the `execFileSync` arguments in the create command, matching the refresh command pattern.

## Pre-existing Issues (Not Blocking)

### MEDIUM

**`--dangerously-skip-permissions` grants full write access to the LLM agent** - `scripts/hooks/background-kb-refresh:140`, `src/cli/commands/kb.ts:412`
**Confidence**: 85%
- Problem: Both the background refresh and CLI create/refresh commands use `--dangerously-skip-permissions` when spawning the Knowledge agent. This means the LLM agent can write to any file accessible to the user, not just files under `.features/`. While `--allowedTools 'Read,Grep,Glob,Write'` limits the tool surface (and `Bash` was removed in this PR, which is a positive security change), the `Write` tool with skipped permissions still allows writing to arbitrary paths. A prompt injection in KB content could cause the agent to overwrite critical files.
- Impact: This is a pre-existing architectural decision that applies to all `claude -p` background agents in the project, not specific to this PR. The removal of `Bash` from `--allowedTools` in this PR is a meaningful improvement.

## Suggestions (Lower Confidence)

- **Unvalidated `referencedFiles` entries could reference paths outside worktree** - `scripts/hooks/lib/feature-kb.cjs:289` (Confidence: 65%) -- The sidecar's `referencedFiles` array is stored directly in `index.json`. If the LLM writes absolute paths or paths with `../` traversal, `checkStaleness` would execute `git log` against those paths. While `git log` is read-only, this could leak information about files outside the project.

- **`$STALE_SLUGS` passed as a single positional argument may word-split unexpectedly** - `scripts/hooks/session-end-kb-refresh:54` (Confidence: 70%) -- `$STALE_SLUGS` (multi-line, one slug per line) is passed as argument `$3` to `background-kb-refresh`. On line 90, `printf '%s' "$PRE_SLUGS" | head -3` preserves the format, and `for SLUG in $STALE_SLUGS` on line 101 word-splits correctly for kebab-case slugs. However, the slug validation in `stale-slugs` CLI handler does NOT validate individual slugs before outputting them -- it iterates `checkAllStaleness` keys which come from `index.json`. A manually crafted `index.json` with malicious keys could inject values, though `validateSlug` is called later via `refresh-context`.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 2 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 1 | 0 |

**Security Score**: 7/10
**Recommendation**: CHANGES_REQUESTED

The PR makes a positive security change by removing `Bash` from `--allowedTools` for the Knowledge agent, reducing the attack surface from LLM prompt injection. The sidecar pattern (having the LLM write a JSON file that the host script reads back) is architecturally sound and better than the previous approach of having the LLM execute shell commands to update the index. The main concerns are: (1) a shell injection vector in the inline `node -e` script where `$SIDECAR` path is interpolated, (2) the removal of `set -e` without compensating guards, and (3) missing schema validation on LLM-produced sidecar content.
