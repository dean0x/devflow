---
name: devflow-git-safety
description: Git safety patterns and best practices. Load when performing git operations, creating commits, managing branches, or working with git history. Prevents common git mistakes and ensures clean history.
allowed-tools: Bash, Read
---

# Git Safety Patterns

Safe git operations and best practices. Used by Commit, PullRequest, and Coder agents.

## Iron Law

> **NEVER RUN GIT COMMANDS IN PARALLEL**
>
> All git operations MUST be sequential. Parallel git commands cause `.git/index.lock`
> conflicts. Use `&&` chains, never `&` backgrounding. Wait for each command to complete
> before starting the next.

## Critical Safety Rules

### Lock File Handling

**ALWAYS** check for lock file before git operations:

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

### Sequential Git Operations

**NEVER** run git commands in parallel - causes `.git/index.lock` conflicts.

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

---

## Commit Safety

### Never Commit Sensitive Files

**Dangerous patterns to block:**

```bash
SENSITIVE_PATTERNS=(
  ".env"
  ".env.local"
  ".env.*.local"
  "*.key"
  "*.pem"
  "*.p12"
  "*.pfx"
  "*secret*"
  "*password*"
  "*credential*"
  "id_rsa"
  "id_dsa"
  ".aws/credentials"
  ".npmrc"
  ".pypirc"
)

TEMP_PATTERNS=(
  "*.tmp"
  "*.temp"
  "*.log"
  "*.swp"
  "*.swo"
  "*~"
  ".DS_Store"
  "Thumbs.db"
  "*.bak"
  "*.orig"
  "*.rej"
)
```

### Content Scanning

```bash
# Check file content for secrets
check_for_secrets() {
    local file="$1"

    # API keys
    if grep -q 'api[_-]key.*=.*['\''"][a-zA-Z0-9]\{20,\}['\''"]' "$file" 2>/dev/null; then
        echo "WARNING: $file may contain API key"
        return 1
    fi

    # Passwords
    if grep -q 'password.*=.*['\''"][^'\''\"]\{8,\}['\''"]' "$file" 2>/dev/null; then
        echo "WARNING: $file may contain password"
        return 1
    fi

    # Private keys
    if grep -q 'BEGIN.*PRIVATE KEY' "$file" 2>/dev/null; then
        echo "BLOCK: $file contains private key"
        return 1
    fi

    return 0
}
```

---

## Commit Patterns

For commit message format, types, and atomic grouping patterns, see `devflow-commit` skill.

---

## Amend Safety

### When Amend is Safe

Only use `--amend` when ALL conditions are met:

1. User explicitly requested amend, OR commit SUCCEEDED but pre-commit hook auto-modified files
2. HEAD commit was created by you in this conversation
3. Commit has NOT been pushed to remote

### Verification

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

### When NOT to Amend

- If commit FAILED or was REJECTED by hook - create NEW commit
- If already pushed to remote (requires force push)
- If unsure about commit history

---

## Branch Safety

### Protected Branches

Never force push to main/master:

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

### Branch Naming

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

## Safe Patterns

### Complete Commit Flow

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

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"

# 6. Verify
git log -1 --stat
git status
```

### Safe Push

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

## Never Do

| Action | Why |
|--------|-----|
| `git push --force` to main/master | Destroys shared history |
| `git commit --no-verify` | Bypasses safety hooks |
| `git reset --hard` without backup | Loses work permanently |
| Parallel git commands | Causes lock conflicts |
| Commit secrets/keys | Security breach |
| Amend pushed commits | Requires force push |
| Interactive rebase (`-i`) | Requires user input |

---

## Recovery Patterns

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

---

## Integration

This skill is used by:
- **Coder agent**: Safe commits on feature branches
- **Release agent**: Safe tagging and pushing

Load this skill when performing any git operations.

## Related Skills

| Skill | Use For |
|-------|---------|
| `devflow-git-safety` | Lock handling, sequential ops, sensitive file detection |
| `devflow-github-patterns` | GitHub API, rate limits, PR comments, releases |
| `devflow-commit` | Commit message format, atomic grouping |
| `devflow-pull-request` | PR descriptions, size assessment, breaking changes |
