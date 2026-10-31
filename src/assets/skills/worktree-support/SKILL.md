---
name: worktree-support
description: Canonical worktree path resolution and discovery algorithm for agents and commands
user-invocable: false
allowed-tools: Bash, Read
---

# Worktree Support

## Iron Law

> **WORKTREE_PATH IS A PREFIX, NOT A FLAG**
>
> When WORKTREE_PATH is provided, it replaces cwd as the root of ALL paths and commands.

## Agent Path Resolution

| Operation | Without WORKTREE_PATH | With WORKTREE_PATH |
|-----------|----------------------|-------------------|
| Git commands | `git ...` | `git -C {WORKTREE_PATH} ...` |
| .devflow/docs/ paths | `.devflow/docs/...` | `{WORKTREE_PATH}/.devflow/docs/...` |
| Source files | `{file}` | `{WORKTREE_PATH}/{file}` |

## Protected Branches (Canonical List)

`main`, `master`, `develop`, `integration`, `trunk`, `release/*`, `staging`, `production`

Every protected-branch check uses this exact list.
The HUD mirrors it in `TRUNK_BRANCHES`/`TRUNK_BRANCH_PREFIXES`/`isTrunkBranch()` in `src/core/git.ts`: update both together.

## Extended References

- `references/discovery.md` — the 7-step discovery algorithm and multi-worktree mode
- `references/roots.md` — project data roots and detached HEAD
