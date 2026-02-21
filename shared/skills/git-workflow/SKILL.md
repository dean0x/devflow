---
name: git-workflow
description: Commit and PR patterns. Use when user asks to "commit", "create PR", "stage files", "prepare for review", or runs git add/commit/gh pr operations.
user-invocable: false
allowed-tools: Bash, Read, Grep, Glob
---

# Git Workflow

Atomic commits and honest PR descriptions. Complements git-safety with commit and PR-specific patterns.

## Iron Law

> **ATOMIC COMMITS WITH HONEST DESCRIPTIONS**
>
> Every commit MUST represent a single logical change. Every PR description MUST accurately
> reflect ALL changes, risks, and testing gaps. Mixed concerns, hidden limitations, and
> dishonest descriptions are violations. No exceptions.

---

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

1. **By Feature/Module**: Changes within same directory or module
2. **By Type**: Source code, tests, docs, config separately
3. **By Relationship**: Files that change together for single logical purpose

### Anti-Patterns

- **Grab-bag commits**: "Various fixes and updates" - VIOLATION
- **Mixed concerns**: Feature + refactor + fix in one commit - VIOLATION
- **Blind staging**: `git add .` without review - VIOLATION

---

## Pull Request

### PR Title Format

```
<type>(<scope>): <description>
```

**Rules**: Under 72 characters, imperative mood, specific but concise.

### PR Description Structure

Every PR description MUST include these sections:

| Section | Purpose |
|---------|---------|
| Summary | 2-3 sentences: what and why |
| Changes | Features, fixes, refactoring by category |
| Breaking Changes | User action required (or "None") |
| Testing | Coverage, manual steps, gaps |
| Related Issues | Closes/relates to links |

### Size Assessment

| Size | Lines Changed | Action |
|------|---------------|--------|
| Small | < 200 | Proceed normally |
| Medium | 200-500 | Consider splitting if unrelated changes |
| Large | 500-1000 | Recommend splitting |
| Very Large | > 1000 | **WARN**: Split into smaller PRs |

---

## Safety Checks

Before staging files, apply sensitive file detection and content scanning patterns from `git-safety` skill.

## Pre-Commit Checklist

- [ ] Changes are atomic (single logical change)
- [ ] No sensitive files included
- [ ] No secrets in file content
- [ ] Commit message follows format
- [ ] Message explains "what" and "why"
- [ ] Related files grouped together

## Description Quality Checklist

- [ ] Summary clearly explains what and why
- [ ] Breaking changes documented (or explicitly "None")
- [ ] Testing gaps honestly disclosed
- [ ] Related issues linked
- [ ] Size assessed and split recommended if needed

---

## Extended References

For extended examples and templates:

| Reference | Contents |
|-----------|----------|
| `references/commit-patterns.md` | Multi-commit flows, bug fix patterns, breaking changes |
| `references/commit-violations.md` | Grab-bag commits, blind staging, vague messages |
| `references/pr-patterns.md` | Full PR template, key change detection, pre-flight scripts |
| `references/pr-violations.md` | Vague descriptions, hidden breaking changes, massive PRs |

---

## Related Skills

| Skill | Use For |
|-------|---------|
| `git-safety` | Lock handling, sequential ops, sensitive file detection |
| `github-patterns` | GitHub API, rate limits, PR comments, releases |
