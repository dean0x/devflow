---
allowed-tools: Task, Bash
description: Fetch GitHub issue details and create a working branch for implementation
---

## Your task

Fetch a GitHub issue by number or description, display its details, and create an appropriately named branch for implementation.

This command orchestrates the `get-issue` sub-agent to:
1. Fetch issue details from GitHub (by number or search)
2. Display comprehensive issue information
3. Generate and create a branch named after the issue
4. Provide next steps for implementation

### Step 1: Parse Input

Extract the issue identifier from arguments:

```bash
# Get the issue input (number or search term)
ISSUE_INPUT="$ARGUMENTS"

if [ -z "$ISSUE_INPUT" ]; then
  echo "ERROR: No issue specified"
  echo ""
  echo "Usage:"
  echo "  /get-issue 123              # By issue number"
  echo "  /get-issue fix login bug    # By search term"
  echo ""
  echo "Examples:"
  echo "  /get-issue 42"
  echo "  /get-issue authentication"
  echo "  /get-issue add dark mode"
  exit 1
fi

echo "=== GET ISSUE: $ISSUE_INPUT ==="
echo ""
```

### Step 2: Verify GitHub CLI

Ensure gh is authenticated:

```bash
# Check gh authentication
if ! gh auth status &>/dev/null; then
  echo "ERROR: GitHub CLI not authenticated"
  echo ""
  echo "Run: gh auth login"
  exit 1
fi

# Verify we're in a GitHub repo
if ! gh repo view &>/dev/null; then
  echo "ERROR: Not in a GitHub repository"
  echo ""
  echo "Ensure you're in a directory with a GitHub remote."
  exit 1
fi

REPO_NAME=$(gh repo view --json nameWithOwner --jq '.nameWithOwner')
echo "Repository: $REPO_NAME"
echo ""
```

### Step 3: Launch Get-Issue Sub-Agent

Launch the `get-issue` sub-agent to fetch issue details and create the branch:

**IMPORTANT**: Pass the `ISSUE_INPUT` variable to the sub-agent.

Use the Task tool to launch the sub-agent with subagent_type="get-issue":

```
Launch get-issue sub-agent with:
- Issue input: {ISSUE_INPUT}

The sub-agent will:
1. Determine if input is an issue number or search term
2. Fetch complete issue details (title, body, labels, assignees, comments)
3. Generate a branch name following pattern: {type}/{number}-{slug}
4. Create and checkout the branch
5. Return a summary with issue details and next steps

Return the complete issue summary and confirmation of branch creation.
```

### Step 4: Display Results

After the sub-agent completes, display the results to the user:

```markdown
ISSUE FETCHED AND BRANCH CREATED

**Issue:** #{NUMBER} - {TITLE}
**Branch:** {BRANCH_NAME}
**State:** {open/closed}

{Issue description summary}

**Next Steps:**
1. Start implementing the feature/fix
2. Reference issue in commits: `closes #{NUMBER}`
3. When ready, run `/pull-request` to create PR
```

---

## Usage Examples

### By Issue Number
```bash
# Fetch issue #42
/get-issue 42

# Fetch issue #123
/get-issue 123
```

### By Search Term
```bash
# Search for authentication-related issues
/get-issue authentication

# Search for specific feature
/get-issue add dark mode toggle

# Search for bug reports
/get-issue login fails
```

---

## Command Behavior

### Pre-Flight Checks:
- Verifies GitHub CLI is authenticated
- Confirms current directory is a GitHub repository
- Validates issue input is provided

### Issue Resolution:
- Numbers → Direct issue lookup
- Text → Search across open issues first, then closed
- Multiple matches → Uses first result, shows alternatives

### Branch Creation:
- Derives type from labels (feature, fix, docs, refactor, chore)
- Sanitizes title for branch name slug
- Checks for existing branches (local and remote)
- Creates from up-to-date default branch

### Output Includes:
- Full issue metadata (title, body, labels, assignees)
- Recent comments for context
- Linked pull requests if any
- Ready-to-use git commands

---

## Error Handling

### Issue Not Found
If the issue number doesn't exist or search returns no results:
- Shows error message with suggestions
- Lists available issues if helpful

### Authentication Issues
If gh is not authenticated:
- Prompts to run `gh auth login`
- Provides link to GitHub CLI docs

### Branch Conflicts
If branch already exists:
- Offers to switch to existing branch
- Shows options for deletion/recreation

---

## Integration

Works seamlessly with other DevFlow commands:

1. **Get issue and start work:**
   ```bash
   /get-issue 42
   # ... implement feature ...
   /commit
   /pull-request
   ```

2. **Triage and implement:**
   ```bash
   /plan        # Review issues
   /get-issue 42  # Start on selected issue
   /implement   # Interactive implementation
   ```
