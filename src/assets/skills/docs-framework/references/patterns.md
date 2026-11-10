# Documentation Framework Patterns

Correct patterns for Devflow documentation artifacts with templates and helper functions.

---

## Directory Structure

### Standard Layout

```
.devflow/docs/
├── reviews/{branch-slug}/          # Code review reports per branch
│   ├── {timestamp}/                # Timestamped review directory
│   │   ├── {focus}.md              # Review agent reports (security.md, architecture.md, etc.)
│   │   ├── review-summary.md       # Synthesize agent output
│   │   └── resolution-summary.md   # Written by /resolve (if run)
│   └── {timestamp}/                # Incremental review
│       └── ...
├── design/                         # Implementation plans
│   └── {ISSUE_ID}-{topic-slug}.{timestamp}.md   # /plan (multi-{topic-slug} / {topic-slug} without an issue)
└── CATCH_UP.md                     # Latest summary (overwritten)
```

The incremental head markers (`.last-review-head`, `.last-analysis-head`) are not part of this tree. They live at `<git dir>/devflow/{reviews|bug-analysis}/{branch-slug}/<marker>`, where `<git dir>` is the path that `git rev-parse --absolute-git-dir` prints. Each worktree has its own markers.

### Setup Variations

**Minimal (new project):**
```
.devflow/docs/
└── CATCH_UP.md
```

**With Reviews (single review):**
```
.devflow/docs/
├── reviews/feat-auth/
│   └── 2025-01-05_1430/
│       ├── security.md
│       ├── architecture.md
│       ├── performance.md
│       ├── complexity.md
│       ├── consistency.md
│       ├── regression.md
│       ├── tests.md
│       └── review-summary.md
└── CATCH_UP.md
```

**With Multiple Reviews (incremental):**
```
.devflow/docs/
├── reviews/feat-auth/
│   ├── 2025-01-05_1430/
│   │   ├── security.md
│   │   ├── ...
│   │   ├── review-summary.md
│   │   └── resolution-summary.md
│   └── 2025-01-06_0900/
│       ├── security.md
│       ├── ...
│       └── review-summary.md
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

# With seconds (a run directory that already exists: a second run in the same minute)
TIMESTAMP_SEC=$(date +%Y-%m-%d_%H%M%S)
# Output: 2025-01-05_143025
```

### Branch Slugs

Replace `/` with `-`, provide fallback for detached HEAD.

```bash
BRANCH_SLUG=$(b=$(git branch --show-current 2>/dev/null); echo "${b:-standalone}" | sed 's/\//-/g')

# Examples:
# feature/auth          -> feature-auth
# fix/issue-123         -> fix-issue-123
# hotfix/critical-bug   -> hotfix-critical-bug
# release/v2.0.0        -> release-v2.0.0
# (detached HEAD)       -> standalone
```

### Topic Slugs

Lowercase, each run of characters outside `a-z0-9` becomes one dash, no leading or trailing dash, max 50 chars, `untitled` when nothing is left. The command makes the slug in prose; no shell call takes the topic. It uses the slug only when it matches `^[a-z0-9-]{1,50}$`, else `untitled`.

```
# "JWT Authentication"       -> jwt-authentication
# "Fix User Login Bug"       -> fix-user-login-bug
# "OAuth 2.0 Integration"    -> oauth-2-0-integration
# "Database Migration v2"    -> database-migration-v2
```

---

## File Naming Rules

### Special Index Files (UPPERCASE)

Always UPPERCASE, overwritten or appended:

- `CATCH_UP.md` - Latest context summary
- `INDEX.md` - Chronological log index
- `KNOWLEDGE_BASE.md` - Searchable debug solutions

### Artifact Files (lowercase)

Always lowercase:

- `2025-01-05_1430.md` - Status log
- `security.md` - Review report (in timestamped directory)
- `review-summary.md` - Combined summary (in timestamped directory)
- `resolution-summary.md` - Resolution summary (in timestamped directory)
- `.last-review-head` - SHA marker for incremental reviews, kept under the worktree's git directory
- `jwt-authentication.2025-01-05_1430.md` - Design doc

---

## Helper Functions

Full implementations, defined inline in the Bash call that needs them. `.devflow/docs/` lives at the checkout's toplevel, never under a subdirectory the session started in:

```bash
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
```

### Run Folders

Make a run folder, or the `design/` folder, only with the shared script, never with `mkdir -p`. It applies the shared folder checks, and it adds seconds to the stamp on a same-minute clash:

```bash
# Run in the checkout. One line on stdout: RUN_DIR=<path>, or DIR=<path> for design.
node "$HOME/.devflow/scripts/plan-files.cjs" claim reviews '<branch-slug>'
node "$HOME/.devflow/scripts/plan-files.cjs" claim research '<topic-slug>'
node "$HOME/.devflow/scripts/plan-files.cjs" claim design
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
# .devflow/docs/reviews/standalone/security-report.2025-01-05_1430.md
```

### Special Characters in Topics

Every run of special characters becomes one dash:

```
"Bug: User can't login (v2.0)" -> bug-user-can-t-login-v2-0
```

### Long Topic Names

Truncated at 50 characters:

```
"This is a very long topic name that exceeds the maximum allowed length"
  -> this-is-a-very-long-topic-name-that-exceeds-the-m
```

---

## Quick Reference

For violation examples and detection patterns, see [violations.md](violations.md).
