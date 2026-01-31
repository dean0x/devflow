---
name: pull-request
description: PR quality patterns. Use when user asks to "create PR", "generate PR description", "prepare for review", or runs gh pr create.
user-invocable: false
allowed-tools: Bash, Read, Grep, Glob
---

# Pull Request Best Practices

Comprehensive PR analysis and honest, actionable descriptions.

## Iron Law

> **HONEST DESCRIPTIONS OR NO PR**
>
> PR descriptions MUST accurately reflect ALL changes, risks, and testing gaps.
> Hiding limitations, understating risks, or omitting breaking changes is a violation.
> If you cannot be honest, do not create the PR.

## When to Activate

Auto-activates when:
- Creating a pull request
- Generating PR title or description
- Analyzing commits for PR summary
- Running `gh pr create`
- Preparing branch for review

---

## PR Title Format

```
<type>(<scope>): <description>
```

**Rules**: Under 72 characters, imperative mood, specific but concise.

**Examples**:
- `feat(auth): add JWT-based authentication middleware`
- `fix(api): resolve memory leak in data processing`
- `refactor(db): migrate to connection pooling`

---

## PR Description Structure

Every PR description MUST include these sections:

| Section | Purpose |
|---------|---------|
| Summary | 2-3 sentences: what and why |
| Changes | Features, fixes, refactoring by category |
| Breaking Changes | User action required (or "None") |
| Testing | Coverage, manual steps, gaps |
| Security/Performance | Impact assessment |
| Deployment Notes | Special instructions |
| Related Issues | Closes/relates to links |
| Reviewer Focus Areas | Files needing attention |

---

## Size Assessment

| Size | Lines Changed | Action |
|------|---------------|--------|
| Small | < 200 | Proceed normally |
| Medium | 200-500 | Consider splitting if unrelated changes |
| Large | 500-1000 | Recommend splitting |
| Very Large | > 1000 | **WARN**: Split into smaller PRs |

---

## Extended References

For detailed templates and examples:

- `references/templates.md` - Full PR description template, key change detection, split recommendations, pre-flight scripts

---

## Description Quality Checklist

- [ ] Summary clearly explains what and why
- [ ] Breaking changes documented (or explicitly "None")
- [ ] Testing gaps honestly disclosed
- [ ] Manual testing steps provided
- [ ] Related issues linked
- [ ] Reviewer focus areas identified
- [ ] Size assessed and split recommended if needed
- [ ] No hidden limitations or risks

---

## Related Skills

| Skill | Use For |
|-------|---------|
| `git-safety` | Lock handling, sequential ops, sensitive file detection |
| `github-patterns` | GitHub API, rate limits, PR comments, releases |
| `commit` | Commit message format, atomic grouping |
| `pull-request` | PR descriptions, size assessment, breaking changes |
