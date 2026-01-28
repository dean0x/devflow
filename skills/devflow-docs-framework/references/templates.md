# Documentation Templates

Full templates for DevFlow documentation artifacts. Reference these when creating persistent documentation.

---

## Status Log Template

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

---

## Debug Session Template

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

---

## Index Files

### STATUS INDEX.md

```markdown
# Status Log Index

| Date | Summary | Branch |
|------|---------|--------|
| [2025-12-26_1430](./2025-12-26_1430.md) | Implemented auth | feat/auth |
| [2025-12-25_0900](./2025-12-25_0900.md) | Fixed login bug | fix/login |
```

### DEBUG KNOWLEDGE_BASE.md

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

## Review Report Template

See `devflow-review-methodology` skill for the complete review report template structure.
