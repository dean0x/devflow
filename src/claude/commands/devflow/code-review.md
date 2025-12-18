---
description: Comprehensive branch review using specialized sub-agents for PR readiness
---

Run a comprehensive code review on the current branch.

**Invoke the CodeReview agent** to orchestrate the full review workflow:

```
Task tool with subagent_type="CodeReview":

"Run comprehensive code review on the current branch.

1. Pre-flight: Ensure changes are committed, pushed, and PR exists
2. Analyze: Determine which audits to run based on changed files
3. Review: Spawn relevant audit agents in parallel
4. Comment: Create PR line comments for issues found
5. Summarize: Generate review summary with merge recommendation

Report back with:
- PR number and URL
- Merge recommendation (BLOCK/REVIEW/APPROVED)
- Issues found by category (blocking/should-fix/pre-existing)
- Comments created on PR"
```

The CodeReview agent handles all orchestration internally, including:
- Spawning Commit agent if uncommitted changes
- Spawning PullRequest agent if no PR exists
- Spawning only relevant audit agents based on file types
- Creating PR line comments directly
- Managing tech debt tracking
