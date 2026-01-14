---
name: devflow-pull-request
description: PR quality patterns, description generation, and review preparation. Auto-activate when creating PRs, generating descriptions, or analyzing branch changes for review.
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

## Pre-Flight Checks

Before creating PR:

```bash
# 1. Verify commits exist
COMMITS_AHEAD=$(git rev-list --count main..HEAD)
[ "$COMMITS_AHEAD" -eq 0 ] && echo "ERROR: No commits to review" && exit 1

# 2. Check for existing PR
PR_EXISTS=$(gh pr list --head "$(git branch --show-current)" --json number --jq '.[0].number')
[ -n "$PR_EXISTS" ] && echo "PR #$PR_EXISTS already exists" && exit 1

# 3. Ensure branch is pushed
git ls-remote --exit-code --heads origin "$(git branch --show-current)" || git push -u origin "$(git branch --show-current)"
```

## PR Title Format

```
<type>(<scope>): <description>
```

**Rules**:
- Under 72 characters
- Imperative mood ("add" not "adds" or "added")
- Specific but concise
- Matches primary commit type

**Examples**:
- `feat(auth): add JWT-based authentication middleware`
- `fix(api): resolve memory leak in data processing`
- `refactor(db): migrate to connection pooling`

## PR Description Template

```markdown
## Summary

{2-3 sentence overview of what this PR does and why}

## Changes

### Features
- Feature 1 with brief description
- Feature 2 with brief description

### Bug Fixes
- Fix 1 with impact description
- Fix 2 with impact description

### Refactoring
- Refactor 1 with rationale

## Breaking Changes

{List breaking changes that require user action, or "None"}

## Testing

### Test Coverage
- {N} test files modified/added
- {What's tested}

### Manual Testing
1. Test scenario 1: steps
2. Test scenario 2: steps

### Testing Gaps
{Honest assessment of what's NOT tested}

## Security Considerations

{Security-relevant changes, or "No security impact"}

## Performance Impact

{Expected performance changes, or "No performance impact expected"}

## Deployment Notes

{Special deployment instructions, or "No special deployment steps"}

## Related Issues

Closes #{issue}
Related to #{issue}

## Reviewer Focus Areas

1. {file:line} - {why this needs attention}
2. {file:line} - {why this needs attention}

---

Generated with [Claude Code](https://claude.com/claude-code)
```

## Size Assessment

| Size | Lines Changed | Action |
|------|---------------|--------|
| Small | < 200 | Proceed normally |
| Medium | 200-500 | Consider splitting if unrelated changes |
| Large | 500-1000 | Recommend splitting |
| Very Large | > 1000 | **WARN**: Split into smaller PRs |

### Split Recommendation Format

```markdown
PR SIZE WARNING

This PR changes {X} files and {Y} lines. Consider splitting:

1. PR 1: {Component A} - {files}
2. PR 2: {Component B} - {files}
3. PR 3: {Tests} - {files}

Rationale: Smaller PRs are easier to review, safer to merge.
```

## Key Change Detection

Check for and highlight:

| Change Type | Detection | Action |
|-------------|-----------|--------|
| Breaking Changes | `grep -i "BREAKING CHANGE" commits` | **MANDATORY** section |
| Database Migrations | `migration\|schema` in file names | Highlight + deployment notes |
| Dependency Changes | `package.json`, `Cargo.toml`, etc. | List versions changed |
| Config Changes | `.config.`, `.yml`, `.toml` | Note configuration impact |
| Missing Tests | Source changed, no test files | **WARN** in Testing Gaps |

## Creating the PR

Use HEREDOC for description:

```bash
gh pr create \
  --base main \
  --title "feat(auth): add authentication middleware" \
  --body "$(cat <<'EOF'
## Summary

Implements JWT-based authentication...

[Full description content]

Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

## Description Quality Checklist

- [ ] Summary clearly explains what and why
- [ ] Breaking changes documented (or explicitly "None")
- [ ] Testing gaps honestly disclosed
- [ ] Manual testing steps provided
- [ ] Related issues linked
- [ ] Reviewer focus areas identified
- [ ] Size assessed and split recommended if needed
- [ ] No hidden limitations or risks

## Integration

This skill works with:
- **devflow-commit**: Atomic commits feeding into PR
- **devflow-git-safety**: Safe push and branch operations
