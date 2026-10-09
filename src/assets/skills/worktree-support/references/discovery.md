# Worktree Discovery

How commands that auto-discover worktrees (`/code-review`, `/resolve`) find them, and how the count found sets the flow. The protected-branch list lives only in the skill's `## Protected Branches (Canonical List)`; this file points to it and copies none of it.

## Algorithm

### Step 1: List Worktrees

Run `git worktree list --porcelain`

### Step 2: Parse Each Entry

Extract: `worktree {path}`, `HEAD {sha}`, `branch refs/heads/{name}`

### Step 3: Filter

Exclude:
- **Bare worktrees** (no branch)
- **Detached HEAD** (no named branch; roots and detached HEAD: `roots.md`)
- **Protected branches**: every branch in the skill's `## Protected Branches (Canonical List)`
- **Mid-rebase or mid-merge**: check `git -C {path} status` for "rebase in progress" or "merging"

### Step 4: Check for Work

Each worktree must have commits ahead of base branch. Skip those that are clean/up-to-date.

### Step 5: Deduplicate

If two worktrees are on the same branch, use only the first worktree's path.

### Step 6: Sort

Sort by last commit date (most recent first).

### Step 7: Return

Return list of reviewable worktrees with path, branch, HEAD SHA.

## Multi-Worktree Mode

| Condition | Behavior |
|-----------|----------|
| 0 reviewable worktrees | Error: no reviewable branches found |
| 1 worktree (common case) | Single-worktree flow, zero behavior change |
| 2+ worktrees | Report count, process worktrees **sequentially** (one at a time) |
| 5+ worktrees | Report count and proceed — user manages their worktree count |
| `--path` flag provided | Use only that worktree, skip discovery |
| Same branch in 2 worktrees | Deduplicate — review once using first worktree's path |
