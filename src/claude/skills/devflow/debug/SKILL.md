---
name: debug
description: Automatically initiate systematic debugging when errors, test failures, or unexpected behavior occur. Use when encountering exceptions, build failures, performance issues, or broken functionality.
allowed-tools: Bash, Read, Grep, Glob, TodoWrite
---

# Debug Skill

## Purpose

Provide systematic debugging methodology when issues arise:
1. **Capture problem** - Document issue clearly
2. **Classify issue** - Determine investigation strategy
3. **Generate hypotheses** - Create targeted theories
4. **Test systematically** - Validate each hypothesis
5. **Document solution** - Record findings for future reference

## When This Skill Activates

Automatically triggers when:
- Error messages or exceptions mentioned
- Tests fail during implementation
- Build or compilation errors occur
- Performance issues reported
- Unexpected behavior described
- "Not working" or "broken" mentioned

## Debug Process

### Step 1: Capture the Problem

Create debug session tracking:

```bash
# Initialize debug session
DEBUG_SESSION="debug-$(date +%Y%m%d-%H%M%S)"
mkdir -p .docs/debug

echo "=== DEBUG SESSION STARTED ==="
echo "Session ID: $DEBUG_SESSION"
echo "Issue: {issue description}"
echo "Branch: $(git branch --show-current)"
echo "Time: $(date)"
echo ""
```

### Step 2: Document the Issue

Create structured debug log at `.docs/debug/{DEBUG_SESSION}.md`:

```markdown
# Debug Session - {DEBUG_SESSION}

## Problem Statement
**Issue**: {issue description}
**Reported**: {timestamp}
**Branch**: {current_branch}
**Context**: {what user was doing when issue occurred}

## Expected vs Actual Behavior
**Expected**: {what should happen}
**Actual**: {what's happening instead}

## Error Details
```
{error message or stack trace if available}
```

## Environment
- Node version: {check if relevant}
- Dependencies: {recently updated?}
- Configuration: {any env changes?}

## Initial Assessment
{quick analysis based on error/issue type}
```

### Step 3: Classify Issue Type

Determine investigation strategy based on issue characteristics:

#### Error/Exception Investigation

```bash
# Search for error patterns
echo "🔍 ERROR INVESTIGATION MODE"

# Find recent error logs
find . -name "*.log" -type f -mtime -1 -exec grep -l "ERROR\|Exception" {} \; 2>/dev/null

# Check for similar errors in code
rg "Error|Exception" --type ts --type js -A 3

# Review recent changes that might have introduced error
git diff HEAD~5 --name-only
```

**Key questions:**
- What's the exact error message?
- Where in the stack trace did it originate?
- What changed recently in that area?
- Is this a new error or existing one?

#### Test Failure Investigation

```bash
echo "🧪 TEST FAILURE INVESTIGATION MODE"

# Find which tests are failing
npm test 2>&1 | grep -E "FAIL|✗|Error"

# Check recent test file changes
git diff HEAD~5 --name-only | grep -E "\.(test|spec)\."

# Review test output for patterns
npm test 2>&1 | tail -50
```

**Key questions:**
- Which specific tests are failing?
- Did they pass before? When did they start failing?
- What was changed in production code?
- Are test dependencies up to date?

#### Performance Issue Investigation

```bash
echo "⚡ PERFORMANCE INVESTIGATION MODE"

# Look for large files
find . -type f -size +10M 2>/dev/null | grep -v node_modules

# Check for performance-critical changes
git diff HEAD~10 --name-only | grep -E "\.(js|ts)$"

# Look for obvious bottlenecks
rg "while.*true|for.*1000|recursive" --type ts --type js
```

**Key questions:**
- What operation is slow?
- How slow (metrics)?
- When did it become slow?
- What data volume is involved?

#### Build/Compile Issue Investigation

```bash
echo "🔨 BUILD ISSUE INVESTIGATION MODE"

# Check build configuration
ls -la | grep -E "package.json|tsconfig|webpack|vite"

# Review recent config changes
git diff HEAD~5 --name-only | grep -E "\.(json|config|rc)"

# Verify dependencies
npm list --depth=0 2>&1 | grep -E "ERROR|WARN|missing"
```

**Key questions:**
- What's the exact build error?
- Did build work before? What changed?
- Are all dependencies installed?
- Any configuration file changes?

### Step 4: Generate Targeted Hypotheses

Based on issue classification, create specific theories:

```markdown
## Debugging Hypotheses

### Hypothesis 1: {Most Likely Cause}
**Theory**: {why you think this is the cause}
**Test**: {how to verify}
**Evidence for**: {supporting indicators}
**Evidence against**: {contradicting indicators}

### Hypothesis 2: {Second Most Likely}
**Theory**: {explanation}
**Test**: {verification method}
**Priority**: {high/medium/low based on likelihood}

### Hypothesis 3: {Third Possibility}
**Theory**: {explanation}
**Test**: {verification method}
**Priority**: {high/medium/low}
```

Use TodoWrite to track testing:

```typescript
TodoWrite({
  todos: [
    {
      content: "Test Hypothesis 1: {description}",
      activeForm: "Testing hypothesis 1",
      status: "pending"
    },
    {
      content: "Test Hypothesis 2: {description}",
      activeForm: "Testing hypothesis 2",
      status: "pending"
    }
  ]
});
```

### Step 5: Test Hypotheses Systematically

For each hypothesis, perform targeted testing:

```bash
echo "=== TESTING HYPOTHESIS: {description} ==="

# Specific tests based on hypothesis
# Example for "recent dependency update broke something":
npm list package-name
git log --oneline -10 -- package.json
npm install package-name@previous-version

# Document results
echo "Result: {passed/failed/inconclusive}"
echo "Findings: {what was learned}"
```

**Testing principles:**
- Test one thing at a time
- Document results immediately
- Move to next hypothesis if current one disproven
- Stop when root cause found

### Step 6: Root Cause Analysis

Once issue identified:

```markdown
## Root Cause Identified

### The Problem
{clear explanation of what's wrong}

### Why It Happened
{sequence of events or conditions that led to issue}

### Why It Wasn't Caught Earlier
{what allowed this to slip through}

### Evidence
```
{code snippet, error log, or test output proving root cause}
```

### Impact Assessment
- Severity: {critical/high/medium/low}
- Scope: {how widespread is the issue}
- Data risk: {any data corruption or loss}
- User impact: {who is affected}
```

### Step 7: Implement Fix

Apply solution following project patterns:

```markdown
## Solution Implementation

### Fix Strategy
{approach to resolving the issue}

### Code Changes
{files that need modification}

### Fix Applied
```{language}
{actual code changes}
```

### Testing the Fix
- [ ] Issue no longer reproduces
- [ ] Related tests pass
- [ ] No regressions introduced
- [ ] Edge cases covered
```

```bash
# Apply fix
# Run relevant tests only (not entire suite)
npm test -- path/to/affected.test.ts

# Verify fix
echo "Fix verification:"
git diff
git status --short
```

### Step 8: Prevent Recurrence

Document prevention strategy:

```markdown
## Prevention Strategy

### Immediate Prevention
{what will stop this specific issue from recurring}

### Long-term Prevention
{architectural or process changes to prevent similar issues}

### Detection Improvement
{how to catch this earlier in future}

### Tests Added
- [ ] Test for original issue
- [ ] Test for edge cases discovered
- [ ] Integration test if needed

### Documentation Updated
- [ ] Code comments added
- [ ] README updated if needed
- [ ] Architecture decision recorded if relevant
```

### Step 9: Knowledge Base Update

Append to `.docs/debug/KNOWLEDGE_BASE.md`:

```markdown
---
## Issue: {brief description}
**Date**: {date}
**Session**: {DEBUG_SESSION}
**Category**: {error/test/performance/build}
**Time to Resolve**: {duration}

**Symptoms**:
- {observable symptom 1}
- {observable symptom 2}

**Root Cause**: {one-line explanation}

**Solution**: {one-line fix description}

**Detection**: How to spot this issue in future
**Keywords**: {searchable terms for future reference}

**Related Files**: {files involved}
**Prevention**: {what was added to prevent recurrence}

---
```

## Debug Output Format

Present results clearly:

```markdown
🔍 DEBUG SESSION COMPLETE

**Issue**: {original issue description}
**Session**: {DEBUG_SESSION}
**Duration**: {time spent}
**Status**: ✅ Resolved | ⚠️ Partially Resolved | 🔄 Needs More Investigation

## 📊 Summary

**Root Cause**: {what was actually wrong}

**Fix Applied**: {what was changed to fix it}

**Files Modified**:
- `path/to/file1.ts` - {change description}
- `path/to/file2.ts` - {change description}

**Tests Updated**:
- Added test for {scenario}
- Fixed test for {scenario}

## 🎓 Lessons Learned

**What Worked**:
- {debugging approach that helped}

**What Didn't**:
- {dead ends or false leads}

**Key Insight**:
{most important learning from this debug session}

## 🛡️ Prevention

**Immediate**:
- {test/check added}

**Long-term**:
- {architectural improvement if needed}

## 📄 Documentation

- Debug log: `.docs/debug/{DEBUG_SESSION}.md`
- Knowledge base updated: `.docs/debug/KNOWLEDGE_BASE.md`

## 🔄 Next Steps

{any follow-up actions needed, or "None - issue fully resolved"}
```

## Integration with Quality Gates

Debug skill coordinates with:

**pattern-check**: Ensures fix doesn't violate architectural patterns
**test-design**: Verifies tests for fix are well-designed
**code-smell**: Catches workarounds in fix implementation

## Red Flags During Debugging

Stop and reassess if:
- Fix requires extensive workarounds
- Multiple unrelated issues discovered
- Root cause keeps changing
- Fix breaks other functionality
- Tests become more complex

These indicate deeper architectural issues.

## Success Criteria

Debug session successful when:
- ✅ Root cause clearly identified and documented
- ✅ Fix applied following project patterns
- ✅ Tests prove issue is resolved
- ✅ No regressions introduced
- ✅ Prevention strategy in place
- ✅ Knowledge base updated for future

## Example Scenarios

### Scenario 1: Test Failure
```
Tests fail after dependency update
→ debug skill activates
→ Classifies as: test failure
→ Hypothesis: breaking change in dependency
→ Tests: npm list, check changelog
→ Confirms: API changed in minor version (semver violation)
→ Fix: pin version, report to maintainer
→ Prevention: add semver check to CI
```

### Scenario 2: Runtime Error
```
"TypeError: Cannot read property 'name' of undefined"
→ debug skill activates
→ Classifies as: error/exception
→ Reviews stack trace
→ Hypothesis: missing null check after refactor
→ Finds: recent refactor removed validation
→ Fix: add Result type error handling
→ Prevention: pattern-check skill would have caught this
```

### Scenario 3: Performance Issue
```
API response time increased from 100ms to 5000ms
→ debug skill activates
→ Classifies as: performance
→ Hypothesis: N+1 query problem
→ Profiles database queries
→ Confirms: added feature triggers loop of queries
→ Fix: batch queries
→ Prevention: add query count monitoring
```

## Philosophy Alignment

This skill enforces:
- **Fix root causes**: Don't patch symptoms
- **Document decisions**: Record what was learned
- **Evidence-driven**: Test hypotheses systematically
- **No workarounds**: Fix properly, not quick hacks

Systematic debugging prevents accumulating hidden issues.
