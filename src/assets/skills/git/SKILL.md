---
name: git
description: This skill should be used when the user asks to "commit changes", "create a pull request", "rebase safely", "manage branches", "fix merge conflicts", "undo a commit", "comment on a PR", "create a release", or performs any git/GitHub operations. Provides safety patterns, atomic commit formatting, PR descriptions, sensitive file detection, and GitHub API usage.
user-invocable: false
allowed-tools: Bash, Read, Grep, Glob
---

# Git & GitHub Patterns

Unified skill for safe git operations, atomic commits, honest PR descriptions, and GitHub API interactions. Used by the Code agent and Git agent.

## Iron Law

> **EVERY COMMIT TELLS AN HONEST, ATOMIC STORY** [1][3]
>
> Each commit captures one logical change with a message that explains *what* changed
> and *why*, not just *how*. Atomic commits make history reviewable, bisectable, and
> revertable. Never bundle unrelated changes. Never write vague messages.

---

## When This Skill Activates

Any `git` or `gh` operation: staging, commits, branches, pull requests, rebases, merge conflicts, PR comments, issues, releases.

---

## Safety

### Lock File Handling

Check for lock before git operations. If `.git/index.lock` exists, wait or abort.

```bash
[ -f .git/index.lock ] && echo "Lock exists - wait" && exit 1
```

### Sequential Operations

```bash
# WRONG: git add . & git status &
# CORRECT:
git add . && git status && echo "Done"
```

### Forbidden Operations

| Action | Risk |
|--------|------|
| `git push --force` to main/master | Destroys shared history |
| `git commit --no-verify` | Bypasses safety hooks |
| `git reset --hard` without backup | Loses work permanently |
| Parallel git commands | Causes lock conflicts |
| Commit secrets/keys | Security breach |
| Amend pushed commits | Requires force push |
| Interactive rebase (`-i`) | Requires user input |

### Amend Safety

Only use `--amend` when ALL conditions are met:
1. User explicitly requested amend, OR commit succeeded but hook auto-modified files
2. HEAD commit was created by you in this conversation
3. Commit has NOT been pushed to remote

**Never amend**: If commit failed/rejected by hook, if pushed, or if unsure.

### Branch Safety

Never force push to a protected branch — `devflow:worktree-support` holds the canonical list.

**Branch naming**: `feat/`, `fix/`, `release/`, `hotfix/` prefixes with short descriptions.

### Quick Recovery

```bash
git reset --soft HEAD~1  # Undo commit, keep staged
git reset HEAD~1         # Undo commit, keep unstaged
```

See `references/patterns.md` for extended recovery and stash workflows.

---

## Commits

> **ATOMIC COMMITS WITH HONEST DESCRIPTIONS** — single logical change per commit, accurate messages.

### Message Format

```
<type>(<scope>): <short summary> (max 50 chars)

<optional body explaining what and why>

<optional footer with references>
```

### Types

| Type | Use When |
|------|----------|
| `feat` | New feature or capability |
| `fix` | Bug fix |
| `docs` | Documentation only changes |
| `style` | Code style/formatting (no logic change) |
| `refactor` | Code change that neither fixes nor adds |
| `test` | Adding or updating tests |
| `chore` | Build, dependencies, tooling |
| `perf` | Performance improvements |

### HEREDOC Format (Required)

Compose the issue/PR reference line BEFORE the heredoc. The heredoc delimiter is single-quoted; unquoting it makes every interpolated value a command.

```bash
git commit -m "$(cat <<'EOF'
feat(auth): add JWT token validation

Implement token validation middleware with:
- Signature verification
- Expiration checking

Closes #123
EOF
)"
```

### Atomic Grouping

1. **By Feature/Module**: Changes within same directory or module
2. **By Type**: Source code, tests, docs, config separately
3. **By Relationship**: Files that change together for single logical purpose

---

## Pull Requests

### Title Format

`<type>(<scope>): <description>` — under 72 characters, imperative mood.

### Description Sections

| Section | Purpose |
|---------|---------|
| Summary | 2-3 sentences: what and why |
| Changes | Features, fixes, refactoring by category |
| Breaking Changes | User action required (or "None") |
| Testing | Coverage, manual steps, gaps |
| Related Issues | `Closes {ISSUE_REF}` / relates-to links |

### Size Assessment

| Size | Lines Changed | Action |
|------|---------------|--------|
| Small | < 200 | Proceed normally |
| Medium | 200-500 | Consider splitting if unrelated |
| Large | 500-1000 | Recommend splitting |
| Very Large | > 1000 | **WARN**: Split into smaller PRs |

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
- `BEGIN.*PRIVATE KEY` — Private key material
- `AKIA[0-9A-Z]{16}` — AWS access key
- `gh[pousr]_[A-Za-z0-9_]{36,}` — GitHub token
- Database URIs with credentials: `postgres://user:pass@`

See `references/detection.md` for full `check_for_secrets()` function.

---

## GitHub API

> **RESPECT RATE LIMITS OR FAIL GRACEFULLY** — at `X-RateLimit-Remaining` < 10 STOP the fan-out and report `THROTTLED` (D4); 1-2s between calls. Throttling, PR-comment rules and releases live in `references/github-api.md`.

Naming conventions: `learn-conventions` writes `.devflow/conventions.md` from a bounded scan (≤50 branches, ≤20 tags, ≤30 PR titles) and is its single authority.

---

## Extended References

| Reference | Contents |
|-----------|----------|
| `references/sources.md` | Bibliography and citations |
| `references/patterns.md` | Safety flows, commit patterns, PR templates |
| `references/violations.md` | Safety, commit, and PR anti-patterns |
| `references/detection.md` | Sensitive file regex patterns and check functions |
| `references/github-api.md` | Rate limiting, CLI commands, GraphQL, releases, review thread GraphQL |
| `references/tracker/{provider}/{op}.md` | Generated per-op tracker mechanics (incl. the D3 template) |

## Checklist

- [ ] All git commands sequential (`&&` chains)
- [ ] No lock file conflicts
- [ ] No sensitive files staged
- [ ] Commit is atomic (single logical change)
- [ ] Message follows conventional format with HEREDOC
- [ ] PR description includes all required sections
- [ ] Rate limits checked before batch API operations
