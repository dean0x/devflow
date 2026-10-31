---
name: regression
description: This skill should be used when reviewing changes that may break existing behavior.
user-invocable: false
allowed-tools: Read, Grep, Glob
---

# Regression Patterns

Detection patterns for functionality regressions and implementation intent. Use with `devflow:review-methodology`.

## Iron Law

> **What worked before must work after.**
>
> Every change carries regression risk. Removed exports break consumers. Changed signatures
> break callers. Modified behavior breaks expectations. The burden of proof is on the change:
> demonstrate no regression, or document the intentional breaking change.

## Regression Categories

### 1. Lost Functionality

Features, exports, or capabilities that existed before but are missing after.

| Type | Risk | Detection |
|------|------|-----------|
| Removed exports | Breaks consumers | Compare `export` statements |
| Removed CLI options | Breaks scripts | Compare option definitions |
| Removed API endpoints | Breaks clients | Compare route handlers |
| Removed event handlers | Breaks integrations | Compare `.on()` calls |

### 2. Broken Behavior

Code still exists but behaves differently in breaking ways.

| Type | Risk | Detection |
|------|------|-----------|
| Changed return types | Null dereference | Compare function signatures |
| Changed defaults | Unexpected behavior | Compare default values |
| Removed side effects | Missing events/logs | Compare emit/log calls |
| Changed error handling | Uncaught errors | Compare throw/return patterns |

### 3. Intent vs Reality Mismatch

Commit message promises one thing, code does another.

| Type | Risk | Detection |
|------|------|-----------|
| Commit says X, code does Y | False confidence | Compare message to diff |
| Partial implementation | Incomplete feature | Check all stated changes |
| Missing edge cases | Fragile code | Verify claimed coverage |

### 4. Incomplete Migrations

Old API deprecated but not all consumers updated.

| Type | Risk | Detection |
|------|------|-----------|
| Some call sites updated | Mixed behavior | Search for old API usage |
| Consumers not updated | Type errors | Check all importers |
| Tests not updated | False passes | Compare test coverage |

## Quick Detection

In the diff: removed `export` lines (`^-export`), deleted files, new `TODO` lines. In the tree: grep for call sites of the old API.

## Extended References

- `references/violations.md` - Detailed violation examples for each category
- `references/patterns.md` - Correct patterns for regression-safe changes
- `references/detection.md` - Comprehensive bash commands for detection

## Severity Guidelines

| Severity | Criteria | Examples |
|----------|----------|----------|
| **CRITICAL** | Breaking changes without migration | Public exports removed, return types incompatible, required params added |
| **HIGH** | Significant behavior changes | Defaults changed, error handling changed, side effects removed |
| **MEDIUM** | Moderate regression risk | Internal APIs changed, logging reduced, performance changed |
| **LOW** | Minor concerns | Documentation drift, internal refactoring |
