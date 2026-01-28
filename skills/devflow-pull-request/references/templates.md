# Pull Request Templates

Reference templates for PR creation. See main SKILL.md for core patterns.

---

## Full PR Description Template

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

---

## Key Change Detection

Check for and highlight these patterns:

| Change Type | Detection | Action |
|-------------|-----------|--------|
| Breaking Changes | `grep -i "BREAKING CHANGE" commits` | **MANDATORY** section |
| Database Migrations | `migration\|schema` in file names | Highlight + deployment notes |
| Dependency Changes | `package.json`, `Cargo.toml`, etc. | List versions changed |
| Config Changes | `.config.`, `.yml`, `.toml` | Note configuration impact |
| Missing Tests | Source changed, no test files | **WARN** in Testing Gaps |

---

## Split Recommendation Format

When PR is too large, recommend splitting:

```markdown
PR SIZE WARNING

This PR changes {X} files and {Y} lines. Consider splitting:

1. PR 1: {Component A} - {files}
2. PR 2: {Component B} - {files}
3. PR 3: {Tests} - {files}

Rationale: Smaller PRs are easier to review, safer to merge.
```

---

## Creating the PR with HEREDOC

Use HEREDOC for multi-line descriptions:

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

---

## Pre-Flight Check Script

Run before creating PR:

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
