# Commit Patterns

Correct commit practices for atomic, well-documented history.

---

## Message Format

```
<type>(<scope>): <short summary> (max 50 chars)

<optional body explaining what and why>
<wrap at 72 characters>

<optional footer with references>

Co-Authored-By: Claude <noreply@anthropic.com>
```

Always use HEREDOC for commit messages:

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

---

## Atomic Commit Examples

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

---

## Splitting Mixed Changes

```bash
# Check what's changed
git status
git diff --stat

# Stage only related files for first commit
git add src/auth/*.ts
git commit -m "feat(auth): add session management"

# Stage tests for that feature
git add tests/auth/*.ts
git commit -m "test(auth): add session management tests"

# Stage unrelated refactoring
git add src/utils/string-helpers.ts
git commit -m "refactor(utils): simplify string helper functions"
```
