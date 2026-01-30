# Documentation Framework Patterns

Correct patterns for DevFlow documentation artifacts with templates and helper functions.

---

## Directory Structure

### Standard Layout

```
.docs/
├── reviews/{branch-slug}/          # Code review reports per branch
│   ├── {type}-report.{timestamp}.md
│   └── review-summary.{timestamp}.md
├── design/                         # Implementation plans
│   └── {topic-slug}.{timestamp}.md
├── status/                         # Development logs
│   ├── {timestamp}.md
│   ├── compact/{timestamp}.md
│   └── INDEX.md
└── CATCH_UP.md                     # Latest summary (overwritten)
```

### Setup Variations

**Minimal (new project):**
```
.docs/
├── status/
│   └── INDEX.md
└── CATCH_UP.md
```

**With Reviews:**
```
.docs/
├── reviews/feat-auth/
│   ├── security-report.2025-01-05_1430.md
│   └── review-summary.2025-01-05_1430.md
├── status/
│   ├── 2025-01-05_1430.md
│   └── INDEX.md
└── CATCH_UP.md
```

---

## Naming Conventions

### Timestamps

Format: `YYYY-MM-DD_HHMM` (sortable, readable)

```bash
# Standard format
TIMESTAMP=$(date +%Y-%m-%d_%H%M)
# Output: 2025-01-05_1430

# With seconds (only if needed for uniqueness)
TIMESTAMP_SEC=$(date +%Y-%m-%d_%H%M%S)
# Output: 2025-01-05_143025
```

### Branch Slugs

Replace `/` with `-`, provide fallback for detached HEAD.

```bash
BRANCH_SLUG=$(git branch --show-current 2>/dev/null | sed 's/\//-/g' || echo "standalone")

# Examples:
# feature/auth          -> feature-auth
# fix/issue-123         -> fix-issue-123
# hotfix/critical-bug   -> hotfix-critical-bug
# release/v2.0.0        -> release-v2.0.0
# (detached HEAD)       -> standalone
```

### Topic Slugs

Lowercase, dashes, alphanumeric only, max 50 chars.

```bash
TOPIC_SLUG=$(echo "$TOPIC" | tr '[:upper:]' '[:lower:]' | tr ' ' '-' | sed 's/[^a-z0-9-]//g' | cut -c1-50)

# Examples:
# "JWT Authentication"       -> jwt-authentication
# "Fix User Login Bug"       -> fix-user-login-bug
# "OAuth 2.0 Integration"    -> oauth-20-integration
# "Database Migration v2"    -> database-migration-v2
```

---

## File Naming Rules

### Special Index Files (UPPERCASE)

Always UPPERCASE, overwritten or appended:

- `CATCH_UP.md` - Latest context summary
- `INDEX.md` - Chronological log index
- `KNOWLEDGE_BASE.md` - Searchable debug solutions

### Artifact Files (lowercase + timestamp)

Always lowercase with timestamp:

- `2025-01-05_1430.md` - Status log
- `security-report.2025-01-05_1430.md` - Review report
- `review-summary.2025-01-05_1430.md` - Combined summary
- `jwt-authentication.2025-01-05_1430.md` - Design doc

---

## Helper Functions

Full implementation for `.devflow/scripts/docs-helpers.sh`:

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

### Usage Example

```bash
# Source helpers
source .devflow/scripts/docs-helpers.sh 2>/dev/null || {
    # Inline fallback if script not found
    get_timestamp() { date +%Y-%m-%d_%H%M; }
    get_branch_slug() { git branch --show-current 2>/dev/null | sed 's/\//-/g' || echo "standalone"; }
    get_topic_slug() { echo "$1" | tr '[:upper:]' '[:lower:]' | tr ' ' '-' | sed 's/[^a-z0-9-]//g' | cut -c1-50; }
    ensure_docs_dir() { mkdir -p ".docs/$1"; }
}

# Use helpers
TIMESTAMP=$(get_timestamp)
BRANCH_SLUG=$(get_branch_slug)
ensure_docs_dir "reviews/$BRANCH_SLUG"

# Create output path
OUTPUT=$(get_review_path "security")
echo "Writing to: $OUTPUT"
```

---

## Templates

### Status Log Template

```markdown
# Status Update - {TIMESTAMP}

## Session Summary
{Brief 2-3 sentence summary of what was accomplished}

## Branch Context
- **Branch**: {current_branch}
- **Base**: {base_branch}
- **Status**: {ahead/behind/clean}

## Work Completed
- {Task 1 completed}
- {Task 2 completed}

## Files Changed
- `path/to/file1.ts` - {description}
- `path/to/file2.ts` - {description}

## Decisions Made
- **{Decision}**: {Rationale}

## Next Steps
- [ ] {Next task 1}
- [ ] {Next task 2}

## Notes
{Any additional context for future sessions}
```

### Debug Session Template

```markdown
# Debug Session - {DEBUG_SESSION_ID}

## Problem Statement
**Issue**: {description}
**Reported**: {timestamp}
**Branch**: {branch}

## Expected vs Actual
**Expected**: {what should happen}
**Actual**: {what's happening}

## Hypotheses Tested
### Hypothesis 1: {description}
- **Test**: {how tested}
- **Result**: {confirmed/refuted}
- **Evidence**: {what was observed}

## Root Cause
**Location**: {file:line}
**Issue**: {precise description}
**Why It Happened**: {chain of events}

## Solution Applied
**Fix**: {description}
**Files Changed**: {list}
**Verification**: {how verified}

## Prevention
- {How to prevent in future}
```

### STATUS INDEX.md Template

```markdown
# Status Log Index

| Date | Summary | Branch |
|------|---------|--------|
| [2025-01-05_1430](./2025-01-05_1430.md) | Implemented auth | feat/auth |
| [2025-01-04_0900](./2025-01-04_0900.md) | Fixed login bug | fix/login |
```

### DEBUG KNOWLEDGE_BASE.md Template

```markdown
# Debug Knowledge Base

Searchable record of debugging sessions and solutions.

---

## Issue: {description}
**Date**: {date}
**Session**: {session_id}
**Category**: {error/performance/test/build}
**Root Cause**: {brief}
**Solution**: {brief}
**Keywords**: {searchable terms}

[Full details](./debug-{session_id}.md)

---
```

---

## Edge Cases

### Detached HEAD State

Branch slug falls back to "standalone":

```bash
# In detached HEAD
get_branch_slug  # Returns: standalone

# Review path becomes:
# .docs/reviews/standalone/security-report.2025-01-05_1430.md
```

### Special Characters in Topics

All special characters stripped:

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

---

## Quick Reference

For violation examples and detection patterns, see [violations.md](violations.md).
