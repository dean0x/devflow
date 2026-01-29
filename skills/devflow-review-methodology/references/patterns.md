# Review Methodology Patterns

Correct patterns for effective code reviews:

## Patterns

### 6-Step Review Process

1. **Understand Context** - Read PR description, linked issues
2. **Get Diff** - Analyze changed files
3. **Review by Category** - Security, architecture, performance, etc.
4. **Classify Issues** - CRITICAL, HIGH, MEDIUM, LOW
5. **Write Report** - Structured format with file:line references
6. **Post Comments** - Use GitHub API for PR comments

### Issue Classification

| Category | Criteria |
|----------|----------|
| CRITICAL | Security vulnerabilities, data loss, crashes |
| HIGH | Bugs, significant performance issues |
| MEDIUM | Code quality, maintainability |
| LOW | Style, documentation, minor improvements |

## Quick Reference

See [report-template.md](report-template.md) for full report format and [pr-comments.md](pr-comments.md) for GitHub integration.
