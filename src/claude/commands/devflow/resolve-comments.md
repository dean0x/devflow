---
description: Systematically address PR review comments with implementation and resolution tracking
---

Address PR review comments systematically.

## Usage

```
/resolve-comments        # Auto-detect PR for current branch
/resolve-comments 123    # Specific PR number
```

---

## Your Task

Invoke the `ResolveComments` agent:

```
Task(subagent_type="ResolveComments"):

"Resolve review comments for PR #${PR_NUMBER_OR_AUTO}.

If no PR number provided, detect PR for current branch.

Workflow:
1. Fetch all PR comments (reviews + general)
2. Categorize: change requests, questions, nitpicks, approvals
3. Present comments to user grouped by category
4. Triage with user (AskUserQuestion) - which to address now
5. For each selected comment:
   - Show context (file, code, comment)
   - Implement the change
   - Generate appropriate reply
   - Post reply to PR
6. Commit all changes with descriptive message
7. Report summary: resolved, deferred, files changed

Handle special cases:
- Out of scope → suggest creating separate issue
- Conflicting comments → ask user which approach
- Questions only → answer without code change

Report back with:
- Comments resolved vs deferred
- Files modified
- Next steps (re-review request if done)"
```
