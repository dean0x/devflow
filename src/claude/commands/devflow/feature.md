---
allowed-tools: Bash, Read, Write, Edit, Grep, Glob, TodoWrite
description: Complete feature development lifecycle from branch to PR
---

## Your task

Guide the complete feature development workflow from initial branch creation to PR readiness.

### Step 1: Create Feature Branch

```bash
# Get feature name from context or prompt
echo "=== CREATING FEATURE BRANCH ==="

# Ensure we're on main/master and up to date
git checkout main || git checkout master
git pull origin $(git branch --show-current)

# Create feature branch with descriptive name
FEATURE_NAME="${1:-new-feature}"  # Use provided name or default
FEATURE_BRANCH="feature/$(date +%Y%m%d)-$FEATURE_NAME"
git checkout -b $FEATURE_BRANCH

echo "✅ Created feature branch: $FEATURE_BRANCH"
```

### Step 2: Set Up Feature Todos

Use TodoWrite to create feature development checklist:
- [ ] Implement core functionality
- [ ] Add unit tests
- [ ] Add integration tests
- [ ] Update documentation
- [ ] Add error handling
- [ ] Performance optimization
- [ ] Code review prep

### Step 3: Track Feature Progress

Create feature tracking document at `.docs/features/{FEATURE_NAME}.md`:

```markdown
# Feature: {FEATURE_NAME}

## Overview
**Branch**: {FEATURE_BRANCH}
**Started**: {DATE}
**Status**: In Development

## Objective
{What this feature accomplishes}

## Requirements
- [ ] {Requirement 1}
- [ ] {Requirement 2}
- [ ] {Requirement 3}

## Implementation Plan
1. {Step 1}
2. {Step 2}
3. {Step 3}

## Technical Decisions
- {Decision 1}: {Rationale}
- {Decision 2}: {Rationale}

## Testing Strategy
- Unit tests: {approach}
- Integration tests: {approach}
- Edge cases: {list}

## Progress Log
- {DATE}: Initial branch created
- {DATE}: {Progress update}
```

### Step 4: Development Guidelines

Provide development best practices:
- Make atomic commits with clear messages
- Write tests alongside implementation
- Document complex logic
- Regular commits to track progress
- Use `/pre-commit` before each commit

### Step 5: Feature Completion Checklist

Before marking feature complete:

```bash
echo "=== FEATURE COMPLETION CHECK ==="

# Check for uncommitted changes
git status --short

# Run tests
npm test || echo "⚠️ Fix failing tests"

# Check test coverage
npm run coverage 2>/dev/null || echo "ℹ️ No coverage script"

# List all feature commits
echo -e "\n=== Feature Commits ==="
git log main..HEAD --oneline

# Check for console.logs or debugging code
echo -e "\n=== Debug Code Check ==="
grep -r "console.log\|debugger\|TODO\|FIXME" --include="*.js" --include="*.ts" . || echo "✅ No debug code found"
```

### Step 6: Prepare for PR

```markdown
## Ready for PR Checklist
- [ ] All requirements implemented
- [ ] All tests passing
- [ ] Documentation updated
- [ ] No debug code
- [ ] Code review with `/pre-pr`
- [ ] Squash commits if needed
- [ ] Update feature document with completion

💡 Next: Run `/pre-pr` for comprehensive review before creating pull request
```