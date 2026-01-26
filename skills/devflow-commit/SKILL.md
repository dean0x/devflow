---
name: devflow-commit
description: Commit best practices, atomic grouping, and message conventions. Auto-activate when staging files, creating commits, or generating commit messages. Ensures clean, safe, atomic git history.
disable-model-invocation: true
allowed-tools: Bash, Read, Grep, Glob
---

# Commit Best Practices

Safe, atomic, and well-documented commit creation. Complements devflow-git-safety with commit-specific patterns.

## Iron Law

> **ATOMIC COMMITS OR NO COMMITS**
>
> Every commit MUST represent a single logical change. Mixed concerns, unrelated files,
> or grab-bag commits are violations. If changes cannot be grouped logically, they must
> be split. No exceptions.

## When to Activate

Auto-activates when:
- Preparing to commit changes
- Staging files with `git add`
- Generating commit messages
- Grouping changes into commits
- Creating multiple commits from mixed changes

## Commit Message Format

### Structure

```
<type>(<scope>): <short summary> (max 50 chars)

<optional body explaining what and why>
<wrap at 72 characters>

<optional footer with references>

Co-Authored-By: Claude <noreply@anthropic.com>
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

Always use HEREDOC for commit messages to handle special characters:

```bash
git commit -m "$(cat <<'EOF'
feat(auth): add JWT token validation

Implement token validation middleware with:
- Signature verification
- Expiration checking
- Role-based access control

Closes #123

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

## Atomic Commit Grouping

### Grouping Strategy

1. **By Feature/Module**: Changes within same directory or module
2. **By Type**: Source code, tests, docs, config separately
3. **By Relationship**: Files that change together for single logical purpose

### Example Grouping

```bash
# Commit 1: Source code changes
git add src/auth/*.ts && git commit -m "feat(auth): implement login handler"

# Commit 2: Tests for the feature
git add tests/auth/*.ts && git commit -m "test(auth): add login handler tests"

# Commit 3: Documentation updates
git add docs/auth.md && git commit -m "docs(auth): document login flow"
```

### Anti-Patterns

- **Grab-bag commits**: "Various fixes and updates" - VIOLATION
- **Mixed concerns**: Feature + refactor + fix in one commit - VIOLATION
- **Blind staging**: `git add .` without review - VIOLATION

## Safety Checks

Before staging files, apply sensitive file detection and content scanning patterns from `devflow-git-safety` skill.

## Pre-Commit Checklist

Before every commit:
- [ ] Changes are atomic (single logical change)
- [ ] No sensitive files included
- [ ] No secrets in file content
- [ ] Commit message follows format
- [ ] Message explains "what" and "why"
- [ ] Related files grouped together
- [ ] Co-author attribution included

## Related Skills

| Skill | Use For |
|-------|---------|
| `devflow-git-safety` | Lock handling, sequential ops, sensitive file detection |
| `devflow-github-patterns` | GitHub API, rate limits, PR comments, releases |
| `devflow-commit` | Commit message format, atomic grouping |
| `devflow-pull-request` | PR descriptions, size assessment, breaking changes |
