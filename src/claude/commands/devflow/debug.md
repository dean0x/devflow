---
allowed-tools: Bash, Read, Write, Edit, Grep, Glob, TodoWrite
description: Systematic debugging workflow for tracking and solving issues
---

## Your task

Guide a systematic debugging session with hypothesis tracking and solution documentation.

### Step 1: Capture the Problem

Document the issue being debugged:

```bash
# Create debug session tracking
DEBUG_SESSION="debug-$(date +%Y%m%d-%H%M%S)"
mkdir -p .docs/debug
echo "Debug session: $DEBUG_SESSION"

# Capture current git state for reference
echo "=== ENVIRONMENT STATE ==="
echo "Branch: $(git branch --show-current)"
echo "Last commit: $(git log -1 --oneline)"
echo "Uncommitted changes: $(git status --short | wc -l) files"
```

### Step 2: Document the Issue

Create debug log at `.docs/debug/{DEBUG_SESSION}.md`:

```markdown
# Debug Session - {TIMESTAMP}

## Problem Statement
**What's broken**: {Description of issue}
**Expected behavior**: {What should happen}
**Actual behavior**: {What actually happens}
**Error message**: {If applicable}

## Reproduction Steps
1. {Step to reproduce}
2. {Step to reproduce}
3. {Step to reproduce}

## Environment
- Branch: {branch}
- OS: {system}
- Node/Python/etc version: {version}
- Recent changes: {relevant commits}
```

### Step 3: Generate Hypotheses

Use TodoWrite to track debugging hypotheses:
- [ ] Hypothesis 1: {potential cause}
- [ ] Hypothesis 2: {potential cause}
- [ ] Hypothesis 3: {potential cause}

### Step 4: Systematic Investigation

```bash
# Check recent changes that might be related
echo "=== RECENT CHANGES ==="
git diff HEAD~3 --name-only

# Search for error patterns
echo -e "\n=== ERROR PATTERN SEARCH ==="
grep -r "ERROR\|FAIL\|Exception" --include="*.log" . 2>/dev/null || echo "No error logs found"

# Check for recent modifications to related files
echo -e "\n=== RECENTLY MODIFIED RELATED FILES ==="
find . -type f -name "*.{js,ts,py}" -mtime -1 2>/dev/null | head -10
```

### Step 5: Test Hypotheses

For each hypothesis, document:
- What you're testing
- How you're testing it
- Result of the test
- Next steps based on result

```markdown
## Investigation Log

### Hypothesis 1: {description}
**Test**: {what you did}
**Result**: {what happened}
**Conclusion**: ✅ Confirmed / ❌ Ruled out

### Hypothesis 2: {description}
**Test**: {what you did}
**Result**: {what happened}
**Conclusion**: ✅ Confirmed / ❌ Ruled out
```

### Step 6: Document Solution

Once issue is resolved:

```markdown
## Root Cause
{Technical explanation of what was wrong}

## Solution
{What was changed to fix it}

## Code Changes
\`\`\`{language}
{show the fix}
\`\`\`

## Verification
- [ ] Issue no longer reproduces
- [ ] Tests pass
- [ ] No regression in other areas

## Prevention
{How to prevent this in the future}

## Time Spent
- Total: {duration}
- Investigation: {time}
- Implementation: {time}
- Testing: {time}
```

### Step 7: Create Fix Commit

```bash
# Stage and commit the fix
git add -A
git commit -m "fix: {concise description}

Problem: {what was broken}
Solution: {what was fixed}
Debug session: $DEBUG_SESSION"

echo "✅ Fix committed. Debug session documented at .docs/debug/$DEBUG_SESSION.md"
```

### Step 8: Update Knowledge Base

Add key learnings to `.docs/debug/README.md`:
- Common error patterns
- Debugging techniques that worked
- Tools or commands that helped
- Prevention strategies