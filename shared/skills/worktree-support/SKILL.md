---
name: worktree-support
description: Canonical worktree path resolution and discovery algorithm for agents and commands
user-invocable: false
allowed-tools: Bash, Read
---

# Worktree Support

Canonical patterns for worktree-aware agents and multi-worktree discovery in commands.

## Iron Law

> **WORKTREE_PATH IS A PREFIX, NOT A FLAG**
>
> When WORKTREE_PATH is provided, it changes how you resolve ALL paths — git commands,
> file reads, .docs/ paths. It's not a toggle; it's a coordinate system shift.

---

## Agent Path Resolution

When `WORKTREE_PATH` is provided to an agent:

| Operation | Without WORKTREE_PATH | With WORKTREE_PATH |
|-----------|----------------------|-------------------|
| Git commands | `git ...` | `git -C {WORKTREE_PATH} ...` |
| .docs/ paths | `.docs/...` | `{WORKTREE_PATH}/.docs/...` |
| Source files | `{file}` | `{WORKTREE_PATH}/{file}` |
| Default | Use cwd | Use WORKTREE_PATH as root |

If `WORKTREE_PATH` is omitted, behavior is unchanged (use cwd). This is the common case.

---

## Worktree Discovery Algorithm (Commands)

For commands that auto-discover worktrees (`/code-review`, `/resolve`):

### Step 1: List Worktrees

Run `git worktree list --porcelain`

### Step 2: Parse Each Entry

Extract: `worktree {path}`, `HEAD {sha}`, `branch refs/heads/{name}`

### Step 3: Filter

Exclude:
- **Bare worktrees** (no branch)
- **Detached HEAD** (no named branch)
- **Protected branches**: `main`, `master`, `develop`, `release/*`, `staging`, `production`
- **Mid-rebase or mid-merge**: check `git -C {path} status` for "rebase in progress" or "merging"

### Step 4: Check for Work

Each worktree must have commits ahead of base branch. Skip those that are clean/up-to-date.

### Step 5: Deduplicate

If two worktrees are on the same branch, use only the first worktree's path.

### Step 6: Sort

Sort by last commit date (most recent first).

### Step 7: Return

Return list of reviewable worktrees with path, branch, HEAD SHA.

---

## Protected Branches (Canonical List)

`main`, `master`, `develop`, `release/*`, `staging`, `production`

All components (agents, commands, skills) must use this exact list when checking for protected branches.

---

## Multi-Worktree Mode

| Condition | Behavior |
|-----------|----------|
| 0 reviewable worktrees | Error: no reviewable branches found |
| 1 worktree (common case) | Single-worktree flow, zero behavior change |
| 2+ worktrees | Report count, process all in parallel where possible |
| 5+ worktrees | Report count and proceed — user manages their worktree count |
| `--path` flag provided | Use only that worktree, skip discovery |
| Same branch in 2 worktrees | Deduplicate — review once using first worktree's path |
