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

Split feature changes logically:

```bash
# Step 1: Core implementation
git add src/services/user-service.ts src/models/user.ts && \
git commit -m "$(cat <<'EOF'
feat(users): add user service with CRUD operations

Implement UserService with:
- create, read, update, delete methods
- Result type error handling
- Repository pattern for data access

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"

# Step 2: Tests for the feature
git add tests/services/user-service.test.ts tests/fixtures/users.ts && \
git commit -m "$(cat <<'EOF'
test(users): add comprehensive user service tests

Cover all CRUD operations with:
- Happy path scenarios
- Error handling cases
- Edge cases (empty input, invalid IDs)

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"

# Step 3: API endpoint
git add src/routes/users.ts src/middleware/user-validation.ts && \
git commit -m "$(cat <<'EOF'
feat(api): add user API endpoints

Expose user operations via REST API:
- POST /api/users - create user
- GET /api/users/:id - get user
- PUT /api/users/:id - update user
- DELETE /api/users/:id - delete user

Includes Zod validation middleware.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"

# Step 4: Documentation
git add docs/api/users.md && \
git commit -m "$(cat <<'EOF'
docs(api): document user endpoints

Add API reference for user operations including:
- Request/response schemas
- Error codes
- Example requests

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Bug Fix (Isolated Change)

Bug fixes should be atomic and focused:

```bash
git add src/utils/date-parser.ts tests/utils/date-parser.test.ts && \
git commit -m "$(cat <<'EOF'
fix(dates): handle timezone offset in ISO date parsing

Previous implementation assumed UTC, causing off-by-one errors
for dates near midnight in non-UTC timezones.

Solution: Parse timezone offset explicitly, default to local when absent.

Fixes #456

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Refactoring (No Behavior Change)

Refactoring commits should explicitly state no behavior change:

```bash
git add src/services/*.ts && \
git commit -m "$(cat <<'EOF'
refactor(services): extract common validation logic

Move repeated validation patterns to shared module.
No functional changes - only code organization.

Reduces duplication across 5 service files.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Configuration Changes

Keep config changes separate from code changes:

```bash
git add tsconfig.json && \
git commit -m "$(cat <<'EOF'
chore(config): enable strict null checks

Enable strictNullChecks in TypeScript config.
Prepares for null safety improvements.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Dependency Updates

Group related dependency changes:

```bash
git add package.json package-lock.json && \
git commit -m "$(cat <<'EOF'
chore(deps): update zod to v3.22.0

Update Zod schema validation library.
Includes performance improvements and new z.pipe() method.

No breaking changes in our usage.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Breaking Changes

Document breaking changes clearly:

```bash
git add src/api/*.ts && \
git commit -m "$(cat <<'EOF'
feat(api)!: change response format to JSON:API spec

BREAKING CHANGE: API responses now follow JSON:API specification.
All clients must update to handle new response structure.

Before:
  { "user": { "id": "1", "name": "John" } }

After:
  { "data": { "type": "user", "id": "1", "attributes": { "name": "John" } } }

Migration guide: docs/migration/v2-response-format.md

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Multi-File Feature (Same Commit)

Files that MUST change together belong in one commit:

```bash
# Interface + Implementation + Type updates = one commit
git add \
  src/interfaces/repository.ts \
  src/repositories/user-repository.ts \
  src/types/user.ts && \
git commit -m "$(cat <<'EOF'
feat(repository): add generic repository interface

Implement Repository<T> interface with:
- Type-safe CRUD operations
- Consistent error handling
- UserRepository as first implementation

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Splitting Mixed Changes

When you have mixed changes, split them before committing:

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

---

## Pre-PR Verification

Before creating a PR, verify commit history:

```bash
# Review all commits on this branch
git log --oneline main..HEAD

# Verify each commit is atomic
git log --stat main..HEAD
```
