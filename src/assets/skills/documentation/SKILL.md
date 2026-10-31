---
name: documentation
description: Use when reviewing for documentation drift or stale comments.
user-invocable: false
allowed-tools: Read, Grep, Glob
---

# Documentation Patterns

Detection patterns for documentation quality and alignment review. Use with `devflow:review-methodology`.

## Iron Law

> **Documentation must match reality.**
>
> Outdated documentation is worse than no documentation. It actively misleads. Every code
> change that affects behavior requires a documentation check. Comments that explain "what"
> instead of "why" are noise. The best documentation is code that doesn't need documentation.

## Documentation Categories

### 1. Code Documentation Issues

| Issue | Problem | Fix |
|-------|---------|-----|
| Missing docstrings | Complex functions without explanation | Add JSDoc with params, returns, throws |
| Outdated comments | Comments that contradict code | Update or remove |
| "What" comments | `// Loop through users` | Explain "why" instead |
| Magic algorithms | Complex logic without explanation | Document algorithm and rationale |
| Transition residue | "We no longer do X" notes, in-file changelogs, or refs to removed code/sections | Remove — git holds the history |
| Stale TODOs | TODO comments for completed work | Remove |

### 2. API Documentation Issues

| Issue | Problem | Fix |
|-------|---------|-----|
| Missing params | Callers don't know valid values | Document all params with types and constraints |
| Missing returns | Return shape unknown | Describe return structure and units |
| Missing errors | Callers don't know what to catch | List all thrown error types |

### 3. Alignment Issues

| Issue | Problem | Fix |
|-------|---------|-----|
| Code-comment drift | Comment says 3 retries, code does 5 | Update comment or use constant |
| Stale README | Examples use removed functions | Keep README in sync with code |
| Missing changelog | Breaking changes undocumented | Document all notable changes |

## Extended References

- `references/violations.md` - Extended violation examples with explanations
- `references/patterns.md` - Complete correct pattern examples
- `references/detection.md` - Bash commands for finding issues

## Severity Guidelines

| Severity | Description | Examples |
|----------|-------------|----------|
| **CRITICAL** | Actively misleading | Comments contradict code; API docs with wrong types; README with broken steps; Changelog missing breaking changes |
| **HIGH** | Significant gaps | Public APIs undocumented; Complex algorithms unexplained; Errors not documented; Migration guides missing |
| **MEDIUM** | Moderate issues | Some params undocumented; Examples could be clearer; "What" comments instead of "why" |
| **LOW** | Minor improvements | Could add more examples; Formatting inconsistencies; Typos |
