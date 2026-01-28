# Extended Examples

Detailed examples and edge cases for documentation conventions.

---

## Naming Convention Examples

### Timestamp Examples

```bash
# Standard format
TIMESTAMP=$(date +%Y-%m-%d_%H%M)
# Output: 2025-12-26_1430

# With seconds (not recommended - use only if needed for uniqueness)
TIMESTAMP_SEC=$(date +%Y-%m-%d_%H%M%S)
# Output: 2025-12-26_143025
```

### Branch Slug Examples

```bash
BRANCH_SLUG=$(git branch --show-current 2>/dev/null | sed 's/\//-/g' || echo "standalone")

# Examples:
# feature/auth          -> feature-auth
# fix/issue-123         -> fix-issue-123
# feat/user-profile     -> feat-user-profile
# hotfix/critical-bug   -> hotfix-critical-bug
# release/v2.0.0        -> release-v2.0.0
# (detached HEAD)       -> standalone
```

### Topic Slug Examples

```bash
TOPIC_SLUG=$(echo "$TOPIC" | tr '[:upper:]' '[:lower:]' | tr ' ' '-' | sed 's/[^a-z0-9-]//g' | cut -c1-50)

# Examples:
# "JWT Authentication"       -> jwt-authentication
# "Fix User Login Bug"       -> fix-user-login-bug
# "API Rate Limiting"        -> api-rate-limiting
# "OAuth 2.0 Integration"    -> oauth-20-integration
# "Database Migration v2"    -> database-migration-v2
```

---

## Helper Function Full Implementation

```bash
#!/bin/bash
# .devflow/scripts/docs-helpers.sh

# Get current timestamp in standard format
get_timestamp() {
    date +%Y-%m-%d_%H%M
}

# Get sanitized branch slug
get_branch_slug() {
    local branch
    branch=$(git branch --show-current 2>/dev/null)
    if [ -z "$branch" ]; then
        echo "standalone"
    else
        echo "$branch" | sed 's/\//-/g'
    fi
}

# Convert topic to slug format
get_topic_slug() {
    local topic="$1"
    echo "$topic" | \
        tr '[:upper:]' '[:lower:]' | \
        tr ' ' '-' | \
        sed 's/[^a-z0-9-]//g' | \
        cut -c1-50
}

# Ensure docs directory exists
ensure_docs_dir() {
    local subdir="$1"
    mkdir -p ".docs/$subdir"
}

# Get full output path for a document
get_doc_path() {
    local subdir="$1"
    local filename="$2"
    ensure_docs_dir "$subdir"
    echo ".docs/$subdir/$filename"
}

# Create timestamped status log path
get_status_path() {
    local timestamp
    timestamp=$(get_timestamp)
    get_doc_path "status" "${timestamp}.md"
}

# Create review report path
get_review_path() {
    local type="$1"
    local branch_slug
    local timestamp
    branch_slug=$(get_branch_slug)
    timestamp=$(get_timestamp)
    get_doc_path "reviews/$branch_slug" "${type}-report.${timestamp}.md"
}
```

---

## Directory Structure Variations

### Minimal Setup
```
.docs/
├── status/
│   └── INDEX.md
└── CATCH_UP.md
```

### Standard Project
```
.docs/
├── reviews/{branch-slug}/
│   └── {type}-report.{timestamp}.md
├── status/
│   ├── {timestamp}.md
│   ├── compact/{timestamp}.md
│   └── INDEX.md
└── CATCH_UP.md
```

### Full Setup with Swarm
```
.docs/
├── reviews/{branch-slug}/
│   ├── {type}-report.{timestamp}.md
│   └── review-summary.{timestamp}.md
├── status/
│   ├── {timestamp}.md
│   ├── compact/{timestamp}.md
│   └── INDEX.md
├── swarm/
│   ├── state.json
│   └── plans/
└── CATCH_UP.md
```

---

## File Type Examples

### Special Index Files (UPPERCASE)
- `CATCH_UP.md` - Latest context summary (overwritten each time)
- `INDEX.md` - Chronological log of status updates
- `KNOWLEDGE_BASE.md` - Searchable debug solutions

### Report Files (lowercase with timestamp)
- `security-report.2025-12-26_1430.md`
- `architecture-report.2025-12-26_1430.md`
- `performance-report.2025-12-26_1430.md`
- `review-summary.2025-12-26_1430.md`

### Status Files (timestamp only)
- `2025-12-26_1430.md`
- `2025-12-26_0900.md`

---

## Edge Cases

### Detached HEAD State
When git is in detached HEAD state, branch slug falls back to "standalone":
```bash
# In detached HEAD
get_branch_slug  # Returns: standalone
```

### Special Characters in Topics
All special characters are stripped:
```bash
get_topic_slug "Bug: User can't login (v2.0)"
# Returns: bug-user-cant-login-v20
```

### Long Topic Names
Truncated at 50 characters:
```bash
get_topic_slug "This is a very long topic name that exceeds the maximum allowed length"
# Returns: this-is-a-very-long-topic-name-that-exceeds-the-m
```
