---
name: devflow-docs-framework
description: Documentation conventions for DevFlow artifacts. Load when creating status logs, debug sessions, review reports, or any persistent documentation in .docs/ directory. Ensures consistent naming, structure, and organization.
allowed-tools: Read, Bash, Glob
---

# Documentation Framework

The canonical source for documentation conventions in DevFlow. All agents that persist artifacts must follow these standards.

## Iron Law

> **ALL ARTIFACTS FOLLOW NAMING CONVENTIONS**
>
> Timestamps are `YYYY-MM-DD_HHMM`. Branch slugs replace `/` with `-`. Topic slugs are
> lowercase alphanumeric with dashes. No exceptions. Inconsistent naming breaks tooling,
> searching, and automation. Follow the pattern or fix the pattern for everyone.

## Directory Structure

All generated documentation lives under `.docs/` in the project root:

```
.docs/
├── reviews/{branch-slug}/              # Code review reports per branch
│   ├── {type}-report-{timestamp}.md
│   └── review-summary-{timestamp}.md
├── status/                             # Development logs
│   ├── {timestamp}.md
│   ├── compact/{timestamp}.md
│   └── INDEX.md
├── swarm/                              # Swarm operation state
│   ├── state.json
│   └── plans/
└── CATCH_UP.md                         # Latest summary (overwritten)
```

---

## Naming Conventions

### Timestamps

Format: `YYYY-MM-DD_HHMM` (sortable, readable)

```bash
TIMESTAMP=$(date +%Y-%m-%d_%H%M)
# Example: 2025-12-26_1430
```

### Branch Slugs

Replace `/` with `-`, sanitize special characters:

```bash
BRANCH_SLUG=$(git branch --show-current 2>/dev/null | sed 's/\//-/g' || echo "standalone")
# feature/auth → feature-auth
# fix/issue-123 → fix-issue-123
```

### Topic Slugs

Lowercase, dashes, alphanumeric only, max 50 chars:

```bash
TOPIC_SLUG=$(echo "$TOPIC" | tr '[:upper:]' '[:lower:]' | tr ' ' '-' | sed 's/[^a-z0-9-]//g' | cut -c1-50)
# "JWT Authentication" → jwt-authentication
# "Fix User Login Bug" → fix-user-login-bug
```

### File Naming Patterns

| Type | Pattern | Example |
|------|---------|---------|
| Special indexes | `UPPERCASE.md` | `CATCH_UP.md`, `INDEX.md`, `KNOWLEDGE_BASE.md` |
| Reports | `{type}-report.{timestamp}.md` | `security-report.2025-12-26_1430.md` |
| Status logs | `{timestamp}.md` | `2025-12-26_1430.md` |

---

## Helper Functions

Standard helpers for consistent naming:

```bash
# Source helpers if available
source .devflow/scripts/docs-helpers.sh 2>/dev/null || {
    # Inline fallback if script not found
    get_timestamp() { date +%Y-%m-%d_%H%M; }
    get_branch_slug() { git branch --show-current 2>/dev/null | sed 's/\//-/g' || echo "standalone"; }
    get_topic_slug() { echo "$1" | tr '[:upper:]' '[:lower:]' | tr ' ' '-' | sed 's/[^a-z0-9-]//g' | cut -c1-50; }
    ensure_docs_dir() { mkdir -p ".docs/$1"; }
}

# Usage
TIMESTAMP=$(get_timestamp)
BRANCH_SLUG=$(get_branch_slug)
ensure_docs_dir "reviews/$BRANCH_SLUG"
```

---

## Agent Persistence Rules

### Agents That Persist Artifacts

| Agent | Output Location | Behavior |
|-------|-----------------|----------|
| CatchUp | `.docs/CATCH_UP.md` | Overwrites (latest summary) |
| Devlog | `.docs/status/{timestamp}.md` | Creates new + updates `INDEX.md` |
| *Review | `.docs/reviews/{branch-slug}/{type}-report.{timestamp}.md` | Creates new |

### Agents That Don't Persist

- GetIssue (read-only)
- Comment (only creates PR comments)
- Coder (commits to git, no .docs/ output)

---

## Document Templates

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

### Review Report Template

See `devflow-review-methodology` skill for complete template.

---

## Index Files

### INDEX.md (Status)

```markdown
# Status Log Index

| Date | Summary | Branch |
|------|---------|--------|
| [2025-12-26_1430](./2025-12-26_1430.md) | Implemented auth | feat/auth |
| [2025-12-25_0900](./2025-12-25_0900.md) | Fixed login bug | fix/login |
```

### KNOWLEDGE_BASE.md (Debug)

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

## Implementation Checklist

When creating or modifying persisting agents:

- [ ] Use standard timestamp format (`YYYY-MM-DD_HHMM`)
- [ ] Sanitize branch names (replace `/` with `-`)
- [ ] Sanitize topic names (lowercase, dashes, alphanumeric)
- [ ] Create directory with `mkdir -p .docs/{subdir}`
- [ ] Document output location in agent's final message
- [ ] Follow special file naming (UPPERCASE for indexes)
- [ ] Use helper functions when possible
- [ ] Update relevant index files

---

## Integration

This framework is used by:
- **Devlog**: Creates status logs
- **Debug**: Creates debug sessions and knowledge base
- **CatchUp**: Reads status logs, creates summary
- **Review agents**: Creates review reports

All persisting agents should load this skill to ensure consistent documentation.
