# Git Patterns

Correct patterns for safe git operations, atomic commits, and pull requests.

---

## Safety Patterns

### Sequential Operations

```bash
# Always chain git commands with &&
git add file.ts && git commit -m "message" && git push

# Never run in parallel - use sequential execution
```

### Lock Handling

```bash
# Full implementation: wait for lock file release
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

### Safe Amend

```bash
# Only amend if not pushed
if ! git log origin/$(git branch --show-current)..HEAD | grep -q .; then
  git commit --amend  # Safe - not pushed
fi
```

### Protected Branch Check

```bash
PROTECTED_BRANCHES="main master develop integration trunk staging production"

check_protected_branch() {
    local branch="$1"
    for protected in $PROTECTED_BRANCHES; do
        if [ "$branch" = "$protected" ]; then
            echo "ERROR: Cannot force push to $branch"
            return 1
        fi
    done
    case "$branch" in
        release/*) echo "ERROR: Cannot force push to $branch"; return 1 ;;
    esac
    return 0
}
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
eslint --fix src/
git add .
git commit -m "fix: resolve linting issues"
```

---

## Commit Patterns

### Feature Implementation (Multi-Commit Flow)

```bash
# Step 1: Core implementation
git add src/services/user-service.ts src/models/user.ts && \
git commit -m "feat(users): add user service with CRUD operations"

# Step 2: Tests for the feature
git add tests/services/user-service.test.ts && \
git commit -m "test(users): add comprehensive user service tests"

# Step 3: API endpoint
git add src/routes/users.ts src/middleware/user-validation.ts && \
git commit -m "feat(api): add user API endpoints"

# Step 4: Documentation
git add docs/api/users.md && \
git commit -m "docs(api): document user endpoints"
```

### Bug Fix (Isolated Change)

```bash
git add src/utils/date-parser.ts tests/utils/date-parser.test.ts && \
git commit -m "$(cat <<'EOF'
fix(dates): handle timezone offset in ISO date parsing

Previous implementation assumed UTC, causing off-by-one errors
for dates near midnight in non-UTC timezones.

Fixes #456

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

### Breaking Changes

```bash
git commit -m "$(cat <<'EOF'
feat(api)!: change response format to JSON:API spec

BREAKING CHANGE: API responses now follow JSON:API specification.
All clients must update to handle new response structure.

Migration guide: docs/migration/v2-response-format.md

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

### Splitting Mixed Changes

```bash
git add src/auth/*.ts
git commit -m "feat(auth): add session management"

git add tests/auth/*.ts
git commit -m "test(auth): add session management tests"

git add src/utils/string-helpers.ts
git commit -m "refactor(utils): simplify string helper functions"
```

---

## PR Patterns

### Full PR Description Template

```markdown
## Summary
{2-3 sentence overview}

## Changes
### Features
- Feature 1 with brief description
### Bug Fixes
- Fix 1 with impact description

## Breaking Changes
{List or "None"}

## Testing
### Test Coverage
- {N} test files modified/added
### Testing Gaps
{Honest assessment}

## Related Issues
Closes #{issue}

## Reviewer Focus Areas
1. {file:line} - {why this needs attention}
```

### Creating PR with HEREDOC

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

### Key Change Detection

| Change Type | Detection | Action |
|-------------|-----------|--------|
| Breaking Changes | `grep -i "BREAKING CHANGE" commits` | **MANDATORY** section |
| Database Migrations | `migration\|schema` in file names | Highlight + deployment notes |
| Dependency Changes | `package.json`, `Cargo.toml`, etc. | List versions changed |
| Config Changes | `.config.`, `.yml`, `.toml` | Note configuration impact |
| Missing Tests | Source changed, no test files | **WARN** in Testing Gaps |

### Pre-Flight Check

```bash
COMMITS_AHEAD=$(git rev-list --count main..HEAD)
[ "$COMMITS_AHEAD" -eq 0 ] && echo "ERROR: No commits to review" && exit 1

PR_EXISTS=$(gh pr list --head "$(git branch --show-current)" --json number --jq '.[0].number')
[ -n "$PR_EXISTS" ] && echo "PR #$PR_EXISTS already exists" && exit 1

git ls-remote --exit-code --heads origin "$(git branch --show-current)" || git push -u origin "$(git branch --show-current)"
```

---

## Recovery Workflows

### Undo Last Commit (not pushed)

```bash
git reset --soft HEAD~1  # Keep changes staged
git reset HEAD~1         # Keep changes unstaged
git reset --hard HEAD~1  # Discard changes (DANGEROUS)
```

### Recover Deleted Branch

```bash
git reflog
git checkout -b recovered-branch <commit-sha>
```

### Fix Wrong Branch

```bash
git reset --soft HEAD~1
git stash
git checkout correct-branch
git stash pop
git commit -m "message"
```

### Stash Handling

```bash
git stash push -m "description of changes"
git stash list
git stash apply          # Keep in stash list
git stash pop            # Apply and remove
git stash apply stash@{2}
git stash drop stash@{0}
```
