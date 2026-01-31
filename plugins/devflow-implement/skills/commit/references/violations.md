# Commit Violations

Common commit anti-patterns to avoid.

---

## Grab-Bag Commits

Commits with unrelated changes mixed together:

```bash
# VIOLATION: Multiple unrelated changes
git add . && git commit -m "Various fixes and updates"

# VIOLATION: Feature + refactor + fix mixed
git add . && git commit -m "Add login, fix button color, refactor utils"
```

**Fix**: Split into atomic commits by concern:

```bash
git add src/auth/*.ts && git commit -m "feat(auth): add login handler"
git add src/components/button.tsx && git commit -m "fix(ui): correct button color"
git add src/utils/*.ts && git commit -m "refactor(utils): simplify helpers"
```

---

## Blind Staging

Staging all files without reviewing changes:

```bash
# VIOLATION: No review of what's being committed
git add .
git add -A
git add --all
```

**Fix**: Review and stage specific files:

```bash
# Review what changed
git status
git diff

# Stage specific related files
git add src/services/user.ts src/models/user.ts
```

---

## Vague Messages

Messages that don't explain the change:

```bash
# VIOLATION: No context
git commit -m "Fix bug"
git commit -m "Update code"
git commit -m "WIP"
git commit -m "Changes"
git commit -m "stuff"
```

**Fix**: Describe what and why:

```bash
git commit -m "fix(auth): prevent session timeout during active use

Sessions were expiring while users were actively working due to
missing heartbeat refresh. Add client-side keepalive mechanism.

Fixes #234"
```

---

## Missing Context

Messages that describe the file but not the purpose:

```bash
# VIOLATION: What file, but not why
git commit -m "Update user.ts"
git commit -m "Modify config"
git commit -m "Change API endpoint"
```

**Fix**: Explain the purpose:

```bash
git commit -m "feat(users): add email validation to user creation

Validate email format and domain before creating user account.
Prevents invalid emails from entering the system."
```

---

## Sensitive Files

Committing secrets or credentials:

```bash
# VIOLATION: Sensitive files committed
git add .env                    # Contains secrets
git add config/credentials.json # Contains API keys
git add id_rsa                  # Private key
git add .aws/credentials        # Cloud credentials
```

**Fix**: Add to `.gitignore` and use environment variables:

```bash
# .gitignore
.env
.env.*
*.key
*.pem
credentials.json
.aws/

# Commit example config instead
git add .env.example
```

---

## Mixed Concerns

Single commit with multiple unrelated purposes:

```bash
# VIOLATION: Feature + fix + chore in one commit
git commit -m "Add user profile, fix date bug, update deps"
```

**Files changed:**
- `src/features/profile.tsx` (new feature)
- `src/utils/date.ts` (bug fix)
- `package.json` (dependency update)

**Fix**: Three separate commits:

```bash
git add src/features/profile.tsx
git commit -m "feat(profile): add user profile page"

git add src/utils/date.ts
git commit -m "fix(dates): correct timezone handling"

git add package.json package-lock.json
git commit -m "chore(deps): update dependencies"
```

---

## No Type Prefix

Messages without conventional commit type:

```bash
# VIOLATION: Missing type
git commit -m "Add login functionality"
git commit -m "Fixed the bug"
git commit -m "Updated tests"
```

**Fix**: Use conventional commit types:

```bash
git commit -m "feat(auth): add login functionality"
git commit -m "fix(users): resolve null pointer exception"
git commit -m "test(auth): add login integration tests"
```

---

## Force Push to Shared Branches

Rewriting history on shared branches:

```bash
# VIOLATION: Force push to main/master
git push --force origin main
git push -f origin master

# VIOLATION: Amending already-pushed commits
git commit --amend
git push --force
```

**Fix**: Create new commits for fixes:

```bash
# If you made a mistake, add a fix commit
git commit -m "fix(auth): correct typo in previous commit"
git push  # Normal push, no force
```

---

## Summary Table

| Violation | Example | Impact |
|-----------|---------|--------|
| Grab-bag commits | "Various fixes and updates" | Hard to review, revert, bisect |
| Blind staging | `git add .` | Accidental sensitive file commits |
| Vague messages | "Fix bug" | Lost context, unclear history |
| Missing context | "Update user.ts" | No explanation of why |
| Sensitive files | Committing .env | Security breach |
| Mixed concerns | Feature + fix + chore | Impossible atomic reverts |
| No type prefix | "Add login" | Inconsistent changelog |
| Force push shared | `--force` to main | Team work destroyed |
