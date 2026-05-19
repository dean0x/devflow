# Security Review Report

**Branch**: feat/per-feature-knowledge-bases -> main
**Date**: 2026-04-27

## Issues in Your Changes (BLOCKING)

### CRITICAL

(none)

### HIGH

(none)

## Issues in Code You Touched (Should Fix)

(none)

## Pre-existing Issues (Not Blocking)

(none)

## Suggestions (Lower Confidence)

(none)

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 0 | - |
| Should Fix | - | 0 | 0 | - |
| Pre-existing | - | - | 0 | 0 |

**Security Score**: 9/10
**Recommendation**: APPROVED

## Detailed Analysis

### Positive Security Changes

This PR contains several changes that **improve** the security posture:

1. **Shell injection fix (inline `node -e` elimination)** -- `scripts/hooks/background-kb-refresh:163-168`
   The old code interpolated `$SIDECAR` directly into a JavaScript string passed to `node -e`:
   ```bash
   REF_FILES=$(node -e "
     try {
       const d = JSON.parse(require('fs').readFileSync('$SIDECAR','utf8'));
       ...
   ")
   ```
   If `$SIDECAR` contained single quotes or other shell/JS metacharacters, this could break out of the JS string context. The new code passes `$SIDECAR` as a CLI argument to `json-helper.cjs read-sidecar`, where `safePath()` resolves and validates it. This is a meaningful injection defense improvement.

2. **Bash tool removed from Knowledge agent** -- `shared/agents/knowledge.md`, `plugins/devflow-*/agents/knowledge.md`, `shared/skills/feature-kb/SKILL.md`
   Removing `Bash` from the Knowledge agent's allowed tools list reduces the agent's attack surface. The agent now uses only `Read`, `Grep`, `Glob`, and `Write`, following the principle of least privilege. The `KB_AGENT_TOOLS` constant in `src/cli/commands/kb.ts` (line 63) was already set to `'Read,Grep,Glob,Write'` without `Bash`, so this brings the frontmatter declarations in sync.

3. **Fail-fast on source failures** -- `background-kb-refresh`, `background-learning`, `background-memory-update`
   All `source` statements now include `|| { echo ... >&2; exit 1; }` guards. Previously, a failed `source` (e.g., missing `get-mtime` file) would silently continue with undefined functions, leading to unpredictable behavior in lock management and stale-lock recovery. Failing fast prevents the script from operating in a degraded state where security-relevant functions (like lock acquisition) might silently malfunction.

4. **Sidecar parsing hardened** -- `src/cli/commands/kb.ts:26-45` (`readSidecar`)
   The new `readSidecar` function validates structure at every level: checks for valid JSON, confirms the parsed value is an object (not null), checks `referencedFiles` is an array before using it, and filters array elements to strings only. The old code (`JSON.parse(await fs.readFile(...))`) did no type validation beyond the try/catch. This follows the boundary validation pattern (parse, don't validate).

5. **`json-helper.cjs` `read-sidecar` uses `safePath`** -- `scripts/hooks/json-helper.cjs:1818`
   The file path argument goes through `safePath()` which calls `path.resolve()` and rejects paths containing `..` after resolution. This is consistent with all other file operations in `json-helper.cjs`.

### Areas Reviewed (No Issues Found)

- **`--dangerously-skip-permissions` usage**: Present in both `kb.ts` (create/refresh commands) and `background-kb-refresh`. This flag is required for non-interactive `claude -p` invocations in background processes. The allowed tools are restricted to `Read,Grep,Glob,Write` (no Bash/shell), and the agent is constrained to `.features/` writes. Pre-existing pattern, not introduced by this PR.

- **Shell variable handling in prompts**: `$SLUG`, `$NAME`, `$DIRS`, `$CHANGED` are interpolated into the `PROMPT` variable in `background-kb-refresh`. `$SLUG` is validated by `validateSlug()` (kebab-case only). `$NAME`, `$DIRS`, and `$CHANGED` come from `feature-kb.cjs refresh-context` which reads from the project's own `index.json`. These are developer-controlled inputs, not external user inputs.

- **`field` parameter in `read-sidecar`** (`json-helper.cjs:1819`): Used as a JavaScript property accessor (`data[field]`). Since `field` comes from a CLI argument (always `"referencedFiles"` in current usage), and property access on a parsed JSON object cannot cause code execution, this is safe.

- **Category field removal**: Removing the `category` field from `FeatureEntry`, `updateIndex`, `refresh-context`, and all related code paths is a clean removal with no security implications. The field was informational only.
