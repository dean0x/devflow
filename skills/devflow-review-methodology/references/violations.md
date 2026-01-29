# Review Methodology Violations

Common code review anti-patterns:

## Violations

| Violation | Problem | Fix |
|-----------|---------|-----|
| Blocking for pre-existing issues | Unfair to author | Only flag issues in changed code |
| Missing severity classification | Unclear priority | Use CRITICAL/HIGH/MEDIUM/LOW |
| No file:line references | Hard to locate | Always include specific locations |
| Vague feedback | Not actionable | Provide concrete fixes |
| Mixing concerns | Confusing review | Separate by category |
| Opinion as requirement | Overreach | Distinguish style from correctness |

## Quick Reference

See [report-template.md](report-template.md) for proper review format and [commands.md](commands.md) for diff analysis commands.
