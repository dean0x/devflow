---
allowed-tools: Task
description: Comprehensive branch review using specialized sub-agents for PR readiness
---

## Your task

Launch the `pre-pr` sub-agent to perform a comprehensive review of the entire feature branch, then synthesize the results for the user.

### Next: Synthesize Results

After the sub-agent completes, present a concise summary to the user:

```markdown
🔍 PRE-PR REVIEW COMPLETE

{Brief summary of branch analysis from sub-agent}

🚦 PR READINESS: {Status}

📋 KEY FINDINGS:
{Highlight blocking/critical issues}

📄 Full analysis available from sub-agent output above

💡 Next: {Address blockers / Create PR / Review recommendations}
```
