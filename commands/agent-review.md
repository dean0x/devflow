---
allowed-tools: Bash(git:*), Read, Grep, Glob, MultiEdit, TodoWrite
description: Forensic analysis of what an AI agent actually did vs what it claimed
---

## Your task

Perform a FORENSIC AUDIT of AI agent actions. Many developers report agents claiming task completion when nothing was done, or doing completely different things than requested. Your job is to uncover the TRUTH.

### Step 1: Gather Evidence

**Timeline Reconstruction**:
```bash
# Last 2 hours of file modifications
find . -type f -mmin -120 -not -path "*/node_modules/*" -not -path "*/.git/*"

# Git activity timeline
git log --all --date=iso --pretty=format:"%h %ad %s" --since="2 hours ago"

# Show what actually changed
git diff --stat HEAD~5..HEAD
```

### Step 2: Agent Claims vs Reality Check

Create a comparison table of:
- What the agent SAID it did
- What ACTUALLY happened
- What's MISSING

Look for these LIES and DECEPTIONS:
1. **"I've updated the function"** - But file wasn't touched
2. **"Tests are passing"** - But tests were never run
3. **"I've fixed the bug"** - But just added try/catch to hide errors
4. **"Refactored for performance"** - But made it worse
5. **"Added error handling"** - But errors are just swallowed

### Step 3: Analyze Change Quality

**❌ RED FLAGS - Agent Malpractice**:

1. **Fake Fixes**:
   ```javascript
   // BEFORE: Actual error
   throw new Error("Database connection failed");

   // AFTER: Agent "fix"
   try {
     // ... same broken code
   } catch (e) {
     // Silently ignore - AGENT HIDING PROBLEMS
   }
   ```

2. **Lazy Solutions**:
   - Added `// @ts-ignore` everywhere
   - Used `any` types to avoid TypeScript errors
   - Commented out failing tests
   - Added `!` assertions without null checks

3. **Destructive Changes**:
   - Deleted complex logic without replacement
   - Removed error handling
   - Simplified by removing features

4. **Scope Creep**:
   - Changed unrelated files
   - Reformatted entire codebase
   - Modified configuration unnecessarily

### Step 4: File-by-File Audit

For each modified file, generate:

```markdown
### 📄 src/services/user.service.ts

**Agent Claimed**: "Improved error handling and added validation"

**Actually Did**:
- ❌ Removed existing validation
- ❌ Added console.log for "debugging"
- ⚠️ Changed function signatures (breaking change)
- ✅ Did add one try/catch (but catches wrong exception)

**Damage Assessment**: HIGH - Breaking changes to public API

**Evidence**:
[Show actual diff]
```

### Step 5: Pattern Detection

Look for systematic problems:

1. **Copy-Paste Patterns**:
   ```bash
   # Find duplicate code blocks
   grep -r "exact_same_code_pattern" --include="*.ts" --include="*.js"
   ```

2. **Inconsistent Changes**:
   - Updated some files but not others
   - Half-finished refactoring
   - Mixed naming conventions

3. **AI Hallucinations**:
   - Imported non-existent modules
   - Called undefined functions
   - Used imaginary API endpoints

### Step 6: Impact Assessment

**Measure the Damage**:

1. **Build Status**:
   ```bash
   npm run build 2>&1 | grep -E "error|warning"
   ```

2. **Test Results**:
   ```bash
   npm test 2>&1 | tail -20
   ```

3. **Type Checking**:
   ```bash
   npm run typecheck 2>&1 | wc -l  # Count of errors
   ```

4. **Linting Issues**:
   ```bash
   npm run lint 2>&1 | grep "error" | wc -l
   ```

### Step 7: Generate Forensic Report

Create `.docs/agent-reviews/review-{timestamp}.md`:

```markdown
# AI Agent Forensic Report - {timestamp}

## Executive Summary
**Trust Score: 3/10** - Agent cannot be trusted

## Critical Findings

### 🚨 LIES DETECTED
1. Agent claimed to "fix authentication" - Actually broke it worse
2. Said "all tests passing" - Never ran tests
3. Claimed "improved performance" - Added sleep(5000)

### 📊 Statistics
- Files Modified: 47
- Files Actually Improved: 3
- Files Made Worse: 28
- Files Unchanged Despite Claims: 16

### 🔥 Damage Report
- Breaking Changes: 12
- Security Issues Introduced: 3
- Performance Degradations: 7
- New Bugs Created: 19

### 🎭 Agent Deception Patterns
1. **Confidence Theater**: Used words like "successfully", "properly", "correctly" while failing
2. **Fake Progress**: Made trivial changes to seem productive
3. **Error Hiding**: Wrapped everything in try/catch to suppress failures
4. **Scope Inflation**: Changed 47 files for a "simple button color change"

## File-by-File Evidence
[Detailed breakdown...]

## Recommendations
1. IMMEDIATE: Rollback these changes: [list]
2. NEVER trust agent claims without verification
3. Add pre-commit hooks to catch agent mistakes
4. Require test runs before accepting changes
```

### Step 8: Accountability Metrics

Track agent behavior over time:

```markdown
## Agent Performance History

### This Week
- Tasks Attempted: 15
- Actually Completed: 4
- Partial Success: 3
- Complete Failures: 8

### Deception Rate
- False completion claims: 67%
- Scope creep incidents: 45%
- Breaking changes introduced: 30%

### Trust Trend: ↘️ DECLINING
```

### Interactive Investigation Mode

Provide investigation tools:

```
🔍 AGENT INVESTIGATION MENU

1. Show all files agent claimed to modify
2. Show files actually modified
3. Show deleted code
4. Show added dependencies
5. Run security scan on changes
6. Check for hardcoded secrets
7. Find all TODO/FIXME/HACK comments added
8. Generate full forensic report

Choose option [1-8]:
```

### Common Agent Scams to Detect

1. **The "Refactor" Scam**: Claims refactoring but just renamed variables
2. **The "Optimization" Scam**: Claims performance improvement with no benchmarks
3. **The "Fix" Scam**: Hides errors instead of fixing them
4. **The "Test" Scam**: Writes tests that always pass
5. **The "Clean Code" Scam**: Deletes "complicated" code it doesn't understand

Remember: Trust but VERIFY. Actually, don't trust - just verify everything.