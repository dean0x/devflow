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
> When WORKTREE_PATH is provided, it changes how you resolve ALL paths — git commands,
> file reads, .devflow/docs/ paths. It's not a toggle; it's a coordinate system shift.

## Agent Path Resolution

When `WORKTREE_PATH` is provided to an agent:

| Operation | Without WORKTREE_PATH | With WORKTREE_PATH |
|-----------|----------------------|-------------------|
| Git commands | `git ...` | `git -C {WORKTREE_PATH} ...` |
| .devflow/docs/ paths | `.devflow/docs/...` | `{WORKTREE_PATH}/.devflow/docs/...` |
| Source files | `{file}` | `{WORKTREE_PATH}/{file}` |
| Default | Use cwd | Use WORKTREE_PATH as root |

If `WORKTREE_PATH` is omitted, behavior is unchanged (use cwd). This is the common case.

## Protected Branches (Canonical List)

`main`, `master`, `develop`, `integration`, `trunk`, `release/*`, `staging`, `production`

All components (agents, commands, skills) must use this exact list when checking for protected branches.
The HUD mirrors this list in `TRUNK_BRANCHES`/`TRUNK_BRANCH_PREFIXES`/`isTrunkBranch()` in `src/core/git.ts` — update both together.

## Extended References

- `references/discovery.md` — the 7-step discovery algorithm and multi-worktree mode
- `references/roots.md` — project data roots and detached HEAD
