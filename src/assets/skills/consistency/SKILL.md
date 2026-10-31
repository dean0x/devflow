---
name: consistency
description: Use when reviewing code for naming or pattern inconsistencies.
user-invocable: false
allowed-tools: Read, Grep, Glob
---

# Consistency Patterns

Detection patterns for consistency and unnecessary simplification review. Use with `devflow:review-methodology`.

## Iron Law

> **Match existing patterns or justify deviation.**
>
> New code should look like existing code. If the codebase uses camelCase, use camelCase.
> If errors return Result types, return Result types. Consistency trumps personal preference.
> Deviation requires explicit justification and team agreement. One codebase, one style.

## Consistency Categories

1. **Unnecessary simplification**: user-facing content shortened (detailed error messages cut to "Not found"), configuration options silently removed, error context stripped.
2. **Pattern violations**: naming conventions, error-handling style (a new function throws where the codebase returns `Result`), import organization and export style that differ from existing modules.
3. **Feature regression**: CLI options or flags removed without deprecation, return types changed, event emissions removed (listeners stop firing). Every removed function needs explicit justification.
4. **Style inconsistency**: brace style, quote style, trailing commas, naming case (`Process_Payment` among camelCase functions).

## Extended References

- `references/violations.md` - Extended violation examples by category
- `references/patterns.md` - Extended correct pattern examples
- `references/detection.md` - Bash commands for detecting issues

## Severity Guidelines

| Severity | Description | Examples |
|----------|-------------|----------|
| **CRITICAL** | Breaking changes or significant content loss | API return types changed, CLI options removed, events removed |
| **HIGH** | Inconsistency requiring attention | Error handling pattern mismatch, naming violations, export pattern change |
| **MEDIUM** | Style inconsistency | Import organization, brace/quote style, formatting differences |
| **LOW** | Minor observations | Personal preference territory, linter should catch |
