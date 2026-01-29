---
name: devflow-git-safety
description: Git safety patterns and best practices. Load when performing git operations, creating commits, managing branches, or working with git history. Prevents common git mistakes and ensures clean history.
user-invocable: false
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

---

## Core Safety Rules

### Lock File Handling

Check for lock before git operations. If `.git/index.lock` exists, wait or abort.

```bash
[ -f .git/index.lock ] && echo "Lock exists - wait" && exit 1
```

See `references/commands.md` for full `wait_for_lock_release()` implementation.

### Sequential Operations

```bash
# WRONG: git add . & git status &
# CORRECT:
git add . && git status && echo "Done"
```

---

## Sensitive File Detection

### Never Commit These Patterns

| Category | Patterns |
|----------|----------|
| Secrets | `.env`, `.env.*`, `*secret*`, `*password*`, `*credential*` |
| Keys | `*.key`, `*.pem`, `*.p12`, `id_rsa*`, `id_ed25519*` |
| Cloud | `.aws/credentials`, `.npmrc`, `.pypirc`, `.netrc` |
| Temp | `*.tmp`, `*.log`, `*.swp`, `.DS_Store`, `*~` |

### Quick Content Check

Block commits containing:
- `BEGIN.*PRIVATE KEY` - Private key material
- `AKIA[0-9A-Z]{16}` - AWS access key
- `gh[pousr]_[A-Za-z0-9_]{36,}` - GitHub token
- Database URIs with credentials: `postgres://user:pass@`

See `references/detection.md` for full `check_for_secrets()` function.

---

## Amend Safety

Only use `--amend` when ALL conditions are met:
1. User explicitly requested amend, OR commit succeeded but hook auto-modified files
2. HEAD commit was created by you in this conversation
3. Commit has NOT been pushed to remote

**Never amend**: If commit failed/rejected by hook, if pushed, or if unsure.

---

## Branch Safety

Never force push to: `main`, `master`, `develop`

**Branch naming**: `feat/`, `fix/`, `release/`, `hotfix/` prefixes with short descriptions.

---

## Forbidden Operations

| Action | Risk |
|--------|------|
| `git push --force` to main/master | Destroys shared history |
| `git commit --no-verify` | Bypasses safety hooks |
| `git reset --hard` without backup | Loses work permanently |
| Parallel git commands | Causes lock conflicts |
| Commit secrets/keys | Security breach |
| Amend pushed commits | Requires force push |
| Interactive rebase (`-i`) | Requires user input |

---

## Quick Recovery

```bash
git reset --soft HEAD~1  # Undo commit, keep staged
git reset HEAD~1         # Undo commit, keep unstaged
```

See `references/commands.md` for extended recovery and stash workflows.

---

## Related Skills

| Skill | Use For |
|-------|---------|
| `devflow-commit` | Commit message format, atomic grouping |
| `devflow-pull-request` | PR descriptions, size assessment |
| `devflow-github-patterns` | GitHub API, rate limits, releases |

## Extended References

- `references/commands.md` - Extended command examples, recovery workflows, stash handling
- `references/detection.md` - Sensitive file detection patterns and functions
