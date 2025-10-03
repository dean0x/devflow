---
allowed-tools: Bash, Read, Write, Edit, Grep, Glob, TodoWrite
description: Systematic debugging workflow with issue tracking - use '/debug [issue description]'
---

## Your task

Guide a systematic debugging session for the issue: `$ARGUMENTS`

If no arguments provided, prompt for issue description. Otherwise, use the provided description as the problem to debug.

### Step 1: Capture the Problem

```bash
# Create debug session tracking
DEBUG_SESSION="debug-$(date +%Y%m%d-%H%M%S)"
mkdir -p .docs/debug

# Use provided arguments or default
ISSUE_DESC="${ARGUMENTS:-No issue description provided}"

echo "=== DEBUG SESSION STARTED ==="
echo "Session ID: $DEBUG_SESSION"
echo "Issue: $ISSUE_DESC"
echo "Branch: $(git branch --show-current)"
echo "Time: $(date)"
echo ""
```

### Step 2: Document the Issue

Create debug log at `.docs/debug/{DEBUG_SESSION}.md`:

```markdown
# Debug Session - {DEBUG_SESSION}

## Problem Statement
**Issue**: $ARGUMENTS
**Reported**: {timestamp}
**Branch**: {current_branch}

## Expected vs Actual Behavior
**Expected**: {What should happen - analyze from issue description}
**Actual**: {What's happening instead}

## Error Details
```
{If error message in $ARGUMENTS, extract and display}
```

## Initial Assessment
{Quick analysis of the issue based on the description}
```

### Step 3: Smart Investigation Based on Issue Type

Analyze `$ARGUMENTS` to determine investigation strategy:

```bash
# Parse issue type from arguments
ISSUE_LOWER=$(echo "$ARGUMENTS" | tr '[:upper:]' '[:lower:]')

# Determine investigation type
if echo "$ISSUE_LOWER" | grep -q "error\|exception\|crash\|fail"; then
    echo "🔍 ERROR INVESTIGATION MODE"
    # Search for error patterns in logs
    find . -name "*.log" -type f -exec grep -l "ERROR\|EXCEPTION\|FAIL" {} \; 2>/dev/null | head -5

    # Check recent error outputs
    grep -r "ERROR\|Exception\|Failed" --include="*.log" --include="*.txt" . 2>/dev/null | tail -10

elif echo "$ISSUE_LOWER" | grep -q "slow\|performance\|timeout\|lag"; then
    echo "⚡ PERFORMANCE INVESTIGATION MODE"
    # Look for performance bottlenecks
    echo "Checking for large files that might cause issues:"
    find . -type f -size +10M 2>/dev/null | head -5

    echo "Recent changes to critical paths:"
    git diff HEAD~5 --name-only | grep -E "\.(js|ts|py|go|rs)$" | head -10

elif echo "$ISSUE_LOWER" | grep -q "test\|spec\|unit\|integration"; then
    echo "🧪 TEST FAILURE INVESTIGATION MODE"
    # Focus on test files and recent test changes
    echo "Recent test file changes:"
    git diff HEAD~5 --name-only | grep -E "(test|spec)\." | head -10

    # Run tests if possible
    npm test 2>&1 | tail -20 || echo "Test command not available"

elif echo "$ISSUE_LOWER" | grep -q "build\|compile\|webpack\|bundle"; then
    echo "🔨 BUILD ISSUE INVESTIGATION MODE"
    # Check build configurations and recent changes
    echo "Build configuration files:"
    ls -la | grep -E "(webpack|rollup|vite|tsconfig|babel|eslint)"

    echo "Recent config changes:"
    git diff HEAD~5 --name-only | grep -E "\.(json|config\.|rc)" | head -10

else
    echo "🔍 GENERAL INVESTIGATION MODE"
    # General investigation for unspecified issues
    echo "Recent changes that might be related:"
    git log --oneline -10
    echo ""
    echo "Modified files (uncommitted):"
    git status --short
fi
```

### Step 4: Generate Targeted Hypotheses

Based on the issue type detected, use TodoWrite to create specific debugging tasks:

```markdown
## Debugging Tasks for: $ARGUMENTS

Based on the issue description, here are targeted hypotheses to investigate:

- [ ] Check if issue is reproducible consistently
- [ ] Verify issue occurs in clean environment
- [ ] {Specific hypothesis based on issue type}
- [ ] {Another specific hypothesis}
- [ ] Review recent changes in related files
```

### Step 5: Interactive Debugging Process

Guide through systematic testing of each hypothesis:

```bash
echo "=== HYPOTHESIS TESTING ==="
echo "Testing each hypothesis systematically..."

# For each hypothesis, provide specific commands and checks
# based on the issue type identified from $ARGUMENTS
```

### Step 6: Track Solution

Once issue is identified and fixed:

```markdown
## Solution Found

### Root Cause
{Identified from investigation}

### Fix Applied
```{language}
{Code changes made}
```

### Verification
- [ ] Issue no longer reproduces with: $ARGUMENTS
- [ ] Related tests pass
- [ ] No new issues introduced

### Prevention
{How to prevent similar issues}

### Time Analysis
- Detection to Fix: {time}
- Debugging approach: {what worked}
```

### Step 7: Create Fix Commit

```bash
# If files were modified during debugging
if [ -n "$(git status --porcelain)" ]; then
    echo "=== CREATING FIX COMMIT ==="
    echo "Files modified during debugging:"
    git status --short

    # Suggested commit message based on the issue
    echo ""
    echo "Suggested commit message:"
    echo "fix: $ARGUMENTS"
    echo ""
    echo "Debug session: $DEBUG_SESSION"
    echo "Root cause: {identified cause}"
    echo "Solution: {applied fix}"
fi
```

### Step 8: Learning Documentation

Append to `.docs/debug/KNOWLEDGE_BASE.md`:

```markdown
## Issue: $ARGUMENTS
**Date**: {date}
**Category**: {error/performance/test/build/other}
**Solution**: {brief solution}
**Key Learning**: {what to remember}
**Keywords**: {searchable terms}
---
```

This creates a searchable knowledge base of debugging sessions for future reference.

### Final Output

```markdown
## 🔍 Debug Session Complete

**Issue**: $ARGUMENTS
**Session**: $DEBUG_SESSION
**Status**: {Resolved/Partially Resolved/Needs More Investigation}

### Summary
{Brief summary of what was found and fixed}

### Files Changed
{List of modified files if any}

### Next Steps
{Any follow-up actions needed}

📄 Full debug log: .docs/debug/$DEBUG_SESSION.md
📚 Knowledge base updated: .docs/debug/KNOWLEDGE_BASE.md
```

💡 **Usage Examples**:
- `/debug "TypeError: Cannot read property 'name' of undefined"`
- `/debug tests failing after npm update`
- `/debug app crashes on startup`
- `/debug slow performance in search feature`