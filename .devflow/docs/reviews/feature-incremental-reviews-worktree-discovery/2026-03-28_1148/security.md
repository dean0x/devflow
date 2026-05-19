# Security Review Report

**Branch**: feature/incremental-reviews-worktree-discovery -> main
**Date**: 2026-03-28_1148

## Issues in Your Changes (BLOCKING)

### CRITICAL

_No critical issues found._

### HIGH

**Path Traversal via Unsanitized `--path` Parameter** - `plugins/devflow-code-review/commands/code-review.md:15`, `plugins/devflow-resolve/commands/resolve.md:15`
**Confidence**: 82%
- Problem: The `--path` flag accepts an arbitrary filesystem path from the user and is used directly in `git -C {worktree_path}`, file reads (`{worktree_path}/.docs/...`), and file writes (`Write to {worktree_path}/.docs/reviews/...`). There is no validation that the provided path is actually a valid git worktree, is within the expected repository, or doesn't contain path traversal sequences (e.g., `../../sensitive-dir`). While the agents operate within Claude Code's sandbox, the instructions do not specify that the path must be validated as a legitimate worktree before use.
- Fix: Add an explicit validation step after accepting `--path`. Before using the path, verify it is a valid git worktree by checking it appears in `git worktree list` output, or at minimum validate it resolves to a directory under the repository root. Example addition to Step 0a:
  ```markdown
  4. **If `--path` flag provided:**
     - Validate path exists and is a directory
     - Verify path appears in `git worktree list` output (confirms it is a legitimate worktree)
     - If validation fails, report error and stop
     - Use only that worktree, skip discovery
  ```

**Unsanitized SHA from `.last-review-head` Used in Git Commands** - `plugins/devflow-code-review/commands/code-review.md:59-63`, `plugins/devflow-code-review/commands/code-review-teams.md:101-105`
**Confidence**: 80%
- Problem: The SHA read from `.last-review-head` is used directly in `git diff {last-review-sha}...HEAD`. While `git cat-file -t {sha}` provides a reachability check, it does not validate the format of the SHA itself. If the `.last-review-head` file is tampered with or corrupted (e.g., contains shell metacharacters or a maliciously crafted string), it could be injected into the git command. The file is written by the orchestrator itself, but it is a plain-text file in the worktree that could be manually edited.
- Fix: Add SHA format validation before use. A git SHA is always a 40-character hex string (or abbreviated form). Add a validation step:
  ```markdown
  - Read the SHA from the file
  - Validate format: must match `^[0-9a-f]{7,40}$` (hex characters only, 7-40 chars)
  - If format invalid, log warning and fallback to full diff
  - Verify reachable: `git -C {worktree} cat-file -t {sha}`
  ```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**No Validation of `--review` Timestamp Parameter** - `plugins/devflow-resolve/commands/resolve.md:14`, `plugins/devflow-resolve/commands/resolve-teams.md:11`
**Confidence**: 83%
- Problem: The `--review {timestamp}` parameter is used to construct a directory path (`{worktree}/.docs/reviews/{branch-slug}/{timestamp}/`). The timestamp is taken directly from user input without format validation. A crafted timestamp value like `../../etc` could theoretically traverse to unintended directories. While this is constrained by the `.docs/reviews/` prefix and the agents operate in a sandboxed context, defense-in-depth recommends validating the format.
- Fix: Add format validation for the timestamp parameter:
  ```markdown
  2. **If `--review {timestamp}` provided:**
     - Validate format: must match `YYYY-MM-DD_HHMM` or `YYYY-MM-DD_HHMMSS` pattern
     - If format invalid, report error and stop
     - Use that specific directory
  ```

**Branch-Slug Derivation Lacks Character Restriction** - `shared/agents/git.md:52`, `shared/agents/git.md:84`
**Confidence**: 80%
- Problem: Branch slugs are derived by replacing `/` with `-`, but no additional sanitization is described. Branch names can contain characters like `..`, spaces (if created via API), or other special characters that could affect path construction (e.g., `{worktree}/.docs/reviews/{branch-slug}/`). While git itself restricts some characters, the slug derivation rule is minimal.
- Fix: Strengthen the branch-slug derivation to strip or replace dangerous characters:
  ```markdown
  - Derive branch-slug: replace `/` with `-`, strip `..` sequences,
    remove characters outside `[a-zA-Z0-9._-]`, collapse consecutive dashes
  ```

## Pre-existing Issues (Not Blocking)

### MEDIUM

**Git Commands Use `rm -f .git/index.lock` Prefix (CLAUDE.md Convention)** - `CLAUDE.md:196`
**Confidence**: 85%
- Problem: The CLAUDE.md convention instructs agents to prefix git operations with `rm -f .git/index.lock &&`. While this is a pragmatic workaround for stale lock files, in a multi-worktree context it could interfere if multiple worktrees share state. The lock file path would need to be `{WORKTREE_PATH}/.git/index.lock` for linked worktrees, but linked worktrees use a `.git` file pointing to the main repository's `worktrees/` directory. This convention was not updated for multi-worktree support.
- Note: This is pre-existing convention in CLAUDE.md. Not blocking for this PR.

## Suggestions (Lower Confidence)

- **Rate Limit Exhaustion in Multi-Worktree Mode** - `plugins/devflow-code-review/commands/code-review.md:131-138` (Confidence: 70%) -- When multiple worktrees each trigger PR comment creation, the 1-second delay between API calls may not be sufficient to avoid GitHub API rate limits. Sequential pitfall recording (Phase 5/6) helps, but the parallel reviewer spawning across all worktrees could generate a large burst of API calls.

- **Write Permission Scope for Worktree Paths** - `shared/agents/coder.md:27-31`, `shared/agents/resolver.md:21-24` (Confidence: 65%) -- The Coder and Resolver agents can now write to arbitrary worktree paths via `{WORKTREE_PATH}/{file}`. This expands the write surface area beyond the current working directory. While agents are sandboxed, the instructions don't explicitly constrain writes to only the `.docs/` subtree of worktrees.

- **Duplicate Comment Detection May Miss Edge Cases** - `shared/agents/git.md:190` (Confidence: 62%) -- The dedup logic checks for existing comments at the same file and line. However, if code moves between incremental reviews (e.g., a function shifts by 5 lines after new commits), the same logical issue could get duplicate comments at different line numbers. This is a correctness concern more than a security one.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 2 | 0 | - |
| Should Fix | - | 0 | 2 | - |
| Pre-existing | - | - | 1 | 0 |

**Security Score**: 8/10
**Recommendation**: CHANGES_REQUESTED

The PR introduces no runtime code -- all changes are to markdown instruction files (agent prompts, command orchestration docs, and skill definitions). This significantly limits the exploitability of the identified issues, since the "code" is natural language instructions interpreted by LLM agents rather than executed code. However, the instruction files direct agents to construct shell commands and file paths from user-supplied inputs (`--path`, `--review`, `.last-review-head` contents), and defense-in-depth best practices recommend adding explicit input validation instructions for these values. The two HIGH-severity blocking issues (path traversal via `--path` and unsanitized SHA) should be addressed with format/membership validation steps before merge.
