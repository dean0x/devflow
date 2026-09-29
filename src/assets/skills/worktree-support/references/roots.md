# Project Roots and Detached HEAD

Where devflow keeps per-project data across checkouts, and what it does on a detached HEAD. Companion to the worktree discovery algorithm in `SKILL.md`.

## Which Root Holds What

Devflow's per-project data does not all live in the same checkout.

| Data | Root | Why |
|------|------|-----|
| Learning ledger and queue (`.devflow/learning/`) | The main worktree, when its `.devflow/` exists and the main worktree is not HOME; else this checkout's toplevel | One ledger per repository, so ADR/PF numbers never restart or collide in a linked worktree (D-LEDGER-MAIN-WORKTREE) |
| Working memory (`.devflow/memory/`) | This checkout's toplevel | Memory describes the branch in front of you |
| Feature knowledge bases (`.devflow/features/`) | This checkout's toplevel | They are committed per branch (D-PROMPT-ROOT) |
| Personal `.devflow/config.json` | This checkout's toplevel | Per-worktree by decision: a new worktree does not inherit the source checkout's personal settings |

Hooks and loaders resolve the root from git, never from cwd, so a session started in a subdirectory uses the repository root. Outside a git repository, and in a repository rooted at HOME, no hook creates `.devflow/` or a `.gitignore` (D-HOOKS-GIT-ONLY). A worktree that grew its own ledger before the main-worktree rule keeps it on disk; sessions there stop appending to it.

---

## Detached HEAD

A detached HEAD is a commit checked out without a branch (`git checkout <sha>`, `git bisect`, a rebase stop, `git worktree add --detach`, a CI checkout). Devflow treats it as follows (D-DETACHED-HEAD):

| Surface | Behaviour |
|---------|-----------|
| Knowledge commit | Skipped: a commit there becomes unreachable once HEAD moves. The Knowledge agent reports `KB_COMMIT: skipped (detached HEAD) — uncommitted: <paths>`, and the calling workflow names those paths to the user |
| Worktree discovery | Excluded from auto-review (discovery Step 3 in `SKILL.md`): there is no branch to review, compare or push |
| Memory bootstrap | The first compaction bootstraps `WORKING-MEMORY.md` stamped `branch: (detached)`, keyed on the HEAD commit; an unborn branch has no commit and still skips |
| Memory header | Renders `detached @ <short-sha>` instead of `on unknown` |
