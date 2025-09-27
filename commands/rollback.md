---
allowed-tools: Bash(git:*), Read, Grep, MultiEdit, TodoWrite
description: Rollback AI agent changes from the last session with surgical precision
---

## Your task

**CRITICAL**: Provide a safe way to undo AI agent changes when things go wrong. Be the safety net developers desperately need.

### Step 1: Analyze Recent Changes

First, determine the scope of damage:
```bash
git status
git diff
git log --oneline -20
```

### Step 2: Identify AI Agent Changes

Look for patterns that indicate AI-generated changes:
- Multiple files changed in rapid succession
- Similar timestamp patterns
- Commit messages with AI signatures (🤖, "Generated with", "Claude", "Cursor", etc.)
- Bulk file modifications
- Pattern-based changes across many files

### Step 3: Present Rollback Options

Give user CLEAR choices:

**Option A: Unstaged Changes Only**
```bash
git status --short
# Show exactly what will be reverted
git checkout -- .
```

**Option B: Last N Commits**
```bash
git log --oneline -10
# Let user pick the commit to rollback to
git reset --hard <commit-hash>
```

**Option C: Selective File Rollback**
```bash
# Show changed files with line counts
git diff --stat
# Let user choose specific files
git checkout HEAD -- path/to/file
```

**Option D: Time-based Rollback**
```bash
# Find commits from last hour/day
git log --since="1 hour ago" --oneline
```

### Step 4: Safety Checks Before Rollback

**MANDATORY CHECKS**:
1. **Backup Current State**
   ```bash
   git stash push -m "backup-before-rollback-$(date +%s)"
   ```

2. **Check for Uncommitted Work Worth Keeping**
   - Scan for TODO comments
   - Look for manual fixes
   - Check for configuration changes

3. **Verify No Mixed Changes**
   - Ensure we're not rolling back human changes
   - Look for different author patterns

### Step 5: Execute Rollback

Based on user choice:

1. **Create safety branch first**:
   ```bash
   git branch backup-$(date +%Y%m%d-%H%M%S)
   ```

2. **Perform rollback**

3. **Verify state**:
   ```bash
   git status
   git diff
   ```

### Step 6: Recovery Report

Generate report at `.docs/rollbacks/rollback-{timestamp}.md`:

```markdown
## Rollback Report - {timestamp}

### What Was Rolled Back
- Files affected: X
- Lines removed: Y
- Commits reverted: Z

### Backup Location
- Branch: backup-YYYYMMDD-HHMMSS
- Stash: {stash-ref}

### Preserved Items
- [List any files/changes that were preserved]

### Recovery Instructions
If you need to recover:
git stash pop {stash-ref}
# or
git cherry-pick {commit-hash}
```

### Special Cases to Handle

**❌ DANGER ZONES**:
1. **Database Migrations** - NEVER auto-rollback migrations
2. **Node Modules** - Don't rollback package.json without warning
3. **Environment Files** - .env changes need special handling
4. **Generated Files** - Distinguish between source and generated

**⚠️ WARNING SIGNS**:
- More than 50 files changed
- Binary files modified
- Configuration files touched
- Test files deleted

### Interactive Mode

Always ask before proceeding:

```
🔄 ROLLBACK ANALYSIS COMPLETE

Changes detected:
- 23 files modified by AI agent
- 2 files with mixed human/AI changes
- 450 lines added, 120 removed

Rollback options:
1. Full rollback to 30 minutes ago (recommended)
2. Selective rollback (keep tests, revert src/)
3. Stash everything and reset
4. Custom rollback...

Choose option [1-4]:
```

### Post-Rollback Actions

1. **Run tests** to ensure nothing broke
2. **Check build** still works
3. **Verify dependencies** are intact
4. **Document what went wrong** for future reference

### Emergency Commands

Include these for panic situations:

```bash
# EMERGENCY: Rollback everything to last known good state
git reset --hard origin/main

# EMERGENCY: Save everything before nuclear option
git stash push --all -m "emergency-backup"
git clean -fd

# EMERGENCY: Recover from stash
git stash list
git stash apply stash@{n}
```

Remember: The goal is to give developers CONFIDENCE that they can experiment with AI agents knowing there's a reliable escape hatch when things go wrong.