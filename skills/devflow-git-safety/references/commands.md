# Git Safety - Command Reference

Extended command examples and workflows for safe git operations.

---

## Lock File Handling - Full Implementation

```bash
# Function to wait for lock file release
wait_for_lock_release() {
    local max_wait=10
    local waited=0
    while [ -f .git/index.lock ]; do
        if [ $waited -ge $max_wait ]; then
            echo "ERROR: .git/index.lock still exists after ${max_wait}s"
            echo "Another git process may be running, or a process crashed."
            echo "Check: ps aux | grep git"
            return 1
        fi
        echo "Waiting for git lock to be released... (${waited}s)"
        sleep 1
        waited=$((waited + 1))
    done
    return 0
}

# Always call before git operations
wait_for_lock_release || exit 1
```

---

## Complete Commit Flow

```bash
# 1. Wait for lock
wait_for_lock_release || exit 1

# 2. Check what's changing
git status --porcelain

# 3. Review changes
git diff HEAD --stat

# 4. Stage specific files (not blind 'git add .')
git add src/specific-file.ts

# 5. Create commit with proper message
git commit -m "$(cat <<'EOF'
type(scope): summary

Description

EOF
)"

# 6. Verify
git log -1 --stat
git status
```

---

## Safe Push Workflow

```bash
# Check remote status first
git fetch origin
git status

# If behind, pull first
if git status | grep -q "behind"; then
    git pull --rebase origin $(git branch --show-current)
fi

# Push
git push -u origin $(git branch --show-current)
```

---

## Protected Branch Check

```bash
PROTECTED_BRANCHES="main master develop"

check_protected_branch() {
    local branch="$1"
    for protected in $PROTECTED_BRANCHES; do
        if [ "$branch" = "$protected" ]; then
            echo "ERROR: Cannot force push to $branch"
            return 1
        fi
    done
    return 0
}
```

---

## Pre-commit Hook Handling

### If Hook Modifies Files

```bash
# Run commit
git commit -m "message"

# If hook modified files, amend to include them
git add .
git commit --amend --no-edit
```

### If Hook Rejects Commit

```bash
# DO NOT amend - fix the issue and create new commit

# Fix the issue
eslint --fix src/

# Stage and commit fresh
git add .
git commit -m "fix: resolve linting issues"
```

---

## Amend Verification

```bash
# Check if commit is pushed
if git status | grep -q "Your branch is ahead"; then
    echo "Safe to amend - not pushed"
else
    echo "DANGER: May be pushed - do NOT amend"
fi

# Verify commit author
git log -1 --format='%an %ae'
```

---

## Recovery Workflows

### Undo Last Commit (not pushed)

```bash
# Keep changes staged
git reset --soft HEAD~1

# Keep changes unstaged
git reset HEAD~1

# Discard changes (DANGEROUS)
git reset --hard HEAD~1
```

### Recover Deleted Branch

```bash
# Find the commit
git reflog

# Recreate branch
git checkout -b recovered-branch <commit-sha>
```

### Fix Wrong Branch

```bash
# If committed to wrong branch
git reset --soft HEAD~1
git stash
git checkout correct-branch
git stash pop
git commit -m "message"
```

### Stash Handling

```bash
# Save work temporarily
git stash push -m "description of changes"

# List stashes
git stash list

# Apply most recent stash (keep in stash list)
git stash apply

# Apply and remove from list
git stash pop

# Apply specific stash
git stash apply stash@{2}

# Drop specific stash
git stash drop stash@{0}

# Clear all stashes (DANGEROUS)
git stash clear
```

### Interactive Stash Recovery

```bash
# Show stash contents
git stash show -p stash@{0}

# Create branch from stash
git stash branch new-branch stash@{0}
```

---

## Branch Naming Examples

```bash
# Feature branches
git checkout -b feat/short-description

# Bug fixes
git checkout -b fix/issue-123-description

# Releases
git checkout -b release/v1.2.0

# Hotfixes
git checkout -b hotfix/critical-fix
```

---

## Sequential Operation Patterns

```bash
# WRONG - parallel execution
git add . &
git status &
wait

# CORRECT - sequential with && chains
wait_for_lock_release && \
git add . && \
git status && \
echo "Done"
```
