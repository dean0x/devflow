---
allowed-tools: Task
description: Create intelligent atomic commits with safety checks and clean git history
---

## Your task

Launch the `commit` sub-agent to analyze changes, detect safety issues, group into atomic commits, and help maintain clean git history.

### Next: Synthesize Results

After the sub-agent completes, present a concise summary to the user:

```markdown
📦 COMMIT ASSISTANT COMPLETE

{Brief summary of proposed commits from sub-agent}

🚨 SAFETY ISSUES:
{Any dangerous files or secrets detected}

📋 PROPOSED COMMITS:
{Summary of atomic commit groups}

📄 Full commit plan available from sub-agent output above

💡 Next: {Review and confirm commits / Address safety issues first}
```
