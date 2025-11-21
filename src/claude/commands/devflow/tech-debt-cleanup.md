---
description: Remove fixed items from tech debt backlog issue
allowed-tools: Bash, Read, Grep, Glob
---

## Your Task

Clean up the Tech Debt Backlog GitHub issue by removing items that have been fixed.

---

## Step 1: Find Tech Debt Issue

```bash
# Search for existing tech debt issue
TECH_DEBT_ISSUE=$(gh issue list \
    --label "tech-debt" \
    --state open \
    --json number,title \
    --jq '.[] | select(.title | contains("Tech Debt Backlog")) | .number' \
    | head -1)

if [ -z "$TECH_DEBT_ISSUE" ]; then
    echo "❌ No Tech Debt Backlog issue found"
    echo "Run /code-review first to create one"
    exit 1
fi

echo "✅ Found Tech Debt issue #$TECH_DEBT_ISSUE"

# Get issue body
gh issue view $TECH_DEBT_ISSUE --json body -q '.body'
```

---

## Step 2: Parse Items from Issue

Extract all tech debt items from the issue body. Items follow this format:

```
- [ ] **[audit-type]** `file:line` - description
  → [Review: date](path-to-doc)
```

Or checked items:
```
- [x] **[audit-type]** `file:line` - description
```

Create a list of all unchecked items with their:
- Audit type (e.g., security, performance)
- File path
- Line number (if present)
- Description

---

## Step 3: Verify Each Item

For each unchecked item, check if the issue still exists in the codebase:

### Verification Process

1. **Check if file exists:**
   ```bash
   if [ ! -f "$FILE_PATH" ]; then
       echo "File deleted: $FILE_PATH"
       mark_as_fixed "$item"
   fi
   ```

2. **Check if issue pattern still present:**
   - For each item, construct a search based on audit type and description
   - Use Grep to check if the problematic pattern still exists

**Verification by Audit Type:**

| Audit Type | What to Check |
|------------|---------------|
| security | Look for the vulnerable pattern (SQL concat, hardcoded secrets, etc.) |
| performance | Check for N+1 patterns, nested loops at location |
| architecture | Check for coupling/dependency issues |
| complexity | Check cyclomatic complexity at location |
| tests | Check if test coverage was added |
| dependencies | Check if package was updated/removed |
| documentation | Check if docs were added |
| typescript | Check if type issues were fixed |

### Example Verification

```bash
# Example: Security issue about SQL concatenation in auth.ts:45
FILE="src/auth.ts"
LINE=45

# Check if file exists
if [ ! -f "$FILE" ]; then
    echo "FIXED: File no longer exists"
    continue
fi

# Check if problematic pattern exists near that line
# Read lines around the reported location
CONTEXT=$(sed -n "$((LINE-5)),$((LINE+5))p" "$FILE" 2>/dev/null)

# Look for SQL concatenation patterns
if echo "$CONTEXT" | grep -qE '(SELECT|INSERT|UPDATE|DELETE).*\+.*\$|`\$\{'; then
    echo "STILL EXISTS: SQL concatenation found"
else
    echo "POSSIBLY FIXED: Pattern not found at location"
fi
```

---

## Step 4: Categorize Items

After verification, categorize items:

**Definitely Fixed:**
- File no longer exists
- Specific pattern no longer present at location
- Dependency was removed/updated

**Possibly Fixed:**
- Pattern not found but code changed significantly
- Line numbers shifted due to refactoring

**Still Present:**
- Pattern clearly still exists
- Issue unchanged

---

## Step 5: Update Issue

Remove definitely fixed items and mark possibly fixed items:

```bash
# Get current body
CURRENT_BODY=$(gh issue view $TECH_DEBT_ISSUE --json body -q '.body')

# Construct updated body:
# 1. Remove definitely fixed items entirely
# 2. Add "⚠️ possibly fixed" note to uncertain items
# 3. Keep unchanged items as-is
# 4. Update "Last updated" timestamp

# Update the issue
gh issue edit $TECH_DEBT_ISSUE --body "$UPDATED_BODY"
```

---

## Step 6: Report Results

Present cleanup summary:

```markdown
🧹 TECH DEBT CLEANUP COMPLETE

Issue: #${TECH_DEBT_ISSUE}

---

## Results

| Status | Count |
|--------|-------|
| ✅ Removed (fixed) | {count} |
| ⚠️ Marked possibly fixed | {count} |
| ⏳ Still present | {count} |
| ☑️ Already checked off | {count} |

---

## Removed Items

{List of items removed with reason}

1. **[security]** `src/old-auth.ts:45` - SQL injection
   → Removed: File no longer exists

2. **[performance]** `src/api/users.ts:120` - N+1 query
   → Removed: Pattern no longer present

---

## Possibly Fixed (Review Manually)

{Items marked as possibly fixed}

1. **[complexity]** `src/utils/parser.ts:89` - High cyclomatic complexity
   → Code significantly refactored, manual review recommended

---

## Still Present

{count} items remain in backlog.

---

## Next Steps

1. Review "possibly fixed" items manually
2. Check off items you've verified as fixed
3. Address remaining items in future PRs
```

---

## Key Principles

1. **Conservative removal** - Only remove items when confident they're fixed
2. **Preserve history** - Don't delete, just update issue body
3. **Clear reporting** - Show exactly what was removed and why
4. **Manual fallback** - Mark uncertain items for human review
5. **Line number tolerance** - Code shifts; check surrounding context, not exact line
