---
name: complexity
description: Use when reviewing code for deep nesting or long functions.
user-invocable: false
allowed-tools: Read, Grep, Glob
---

# Complexity Patterns

Detection patterns for complexity and maintainability review. Use with `devflow:review-methodology`.

## Iron Law

> **If you can't understand it in 5 minutes, it's too complex.**
>
> Every function should be explainable to a colleague in under 5 minutes. If you need a
> diagram to understand control flow, refactor. If you need comments to explain what
> (not why), the code is too clever. Simplicity is a feature, complexity is a bug.

## Complexity Categories

1. **Cyclomatic complexity**: many decision paths, deep nesting (5+ levels). Fix: early returns and extracted functions.
2. **Readability**: magic values (`status === 3`, `86400000`). Fix: named constants.
3. **Maintainability**: long parameter lists (5+). Fix: one typed object parameter.
4. **Boolean complexity**: long compound conditions (5+ terms). Fix: extract a named predicate with early returns.
5. **Reliability patterns**: operations that risk non-termination or resource exhaustion. Unbounded loops add decision paths and make termination hard to reason about. `devflow:reliability` covers bounded iteration, assertion density, allocation discipline and indirection limits.

## Extended References

| Reference | Content |
|-----------|---------|
| `references/violations.md` | Extended violation examples for all categories |
| `references/patterns.md` | Detailed refactoring solutions |
| `references/detection.md` | Bash commands and static analysis setup |

## Severity Guidelines

| Severity | Criteria |
|----------|----------|
| **CRITICAL** | Functions > 200 lines, complexity > 20, nesting > 6, duplication in 5+ places, unbounded loop on external I/O |
| **HIGH** | Functions 50-200 lines, complexity 10-20, nesting 4-6, 5+ boolean conditions, 5+ parameters, retry with no max |
| **MEDIUM** | Functions 30-50 lines, complexity 5-10, magic values, minor duplication |
| **LOW** | Could be more readable, naming improvements, comments would help |

## Metrics Quick Reference

| Metric | Good | Warning | Critical |
|--------|------|---------|----------|
| Function length | < 30 | 30-50 | > 50 |
| Cyclomatic complexity | < 5 | 5-10 | > 10 |
| Nesting depth | < 3 | 3-4 | > 4 |
| Parameters | < 3 | 3-5 | > 5 |
| File length | < 300 | 300-500 | > 500 |
| Loop bound | explicit | implicit | unbounded |
