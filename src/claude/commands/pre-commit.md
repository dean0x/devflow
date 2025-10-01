---
allowed-tools: Task
description: Review uncommitted changes before committing using specialized sub-agents
---

## Your task

Launch the `pre-commit` sub-agent to perform a comprehensive review of uncommitted changes, then synthesize the results for the user.

### Next: Synthesize Results

After the sub-agent completes, present a concise summary to the user:

```markdown
🔍 PRE-COMMIT REVIEW COMPLETE

{Brief summary of findings from sub-agent}

📋 KEY FINDINGS:
{Highlight critical/high priority issues}

📄 Full analysis available from sub-agent output above

💡 Next: Address critical issues before committing
```
