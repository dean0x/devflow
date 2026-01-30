---
name: review-methodology
description: Standard review process for all DevFlow review agents. Load when performing code reviews to ensure consistent 6-step process with 3-category issue classification. This is the shared methodology used by the unified Reviewer agent across all focus areas.
user-invocable: false
allowed-tools: Read, Grep, Glob, Bash
---

# Review Methodology

The canonical review process for all DevFlow review agents. Ensures consistent, fair, and actionable code reviews.

## Iron Law

> **NEVER BLOCK FOR PRE-EXISTING ISSUES**
>
> Only issues in YOUR CHANGES can block a PR. Pre-existing issues are informational only.
> If you didn't add it, you don't own it. Fair reviews focus on the diff, not the codebase.

## Core Philosophy

1. **Focus on changed lines first** - Developer introduced these
2. **Context matters** - Issues near changes should be fixed together
3. **Be fair** - Don't block PRs for legacy code
4. **Be specific** - Exact file:line with examples
5. **Be actionable** - Clear fixes, not vague complaints

---

## 6-Step Review Process

### Step 1: Identify Changed Lines

Get the diff to understand what changed. Identify base branch and extract changed files/lines.

### Step 2: Categorize Issues

| Category | Scope | Priority | Action |
|----------|-------|----------|--------|
| **1. Issues in Your Changes** | Lines ADDED/MODIFIED in this branch | BLOCKING | Must fix before merge |
| **2. Issues in Code You Touched** | Same file/function, but not your line | HIGH | Should fix while here |
| **3. Pre-existing Issues** | Lines you didn't touch at all | INFORMATIONAL | Fix in separate PR |

### Step 3: Analyze with Domain Expertise

Apply your specialized lens (security, performance, tests, etc.) to each category:

- **Category 1** - Maximum scrutiny, any issue blocks PR
- **Category 2** - Should fix together with your changes
- **Category 3** - Note but don't block, suggest separate issues

### Step 4: Prioritize by Severity

| Severity | Description | Examples |
|----------|-------------|----------|
| **CRITICAL** | Immediate risk, must fix | Security vulnerabilities, data loss risks, breaking API changes |
| **HIGH** | Significant risk, should fix | Performance degradation, missing error handling |
| **MEDIUM** | Moderate risk, consider fixing | Style inconsistencies, missing documentation |
| **LOW** | Minor improvements | Naming suggestions, optional optimizations |

### Step 5: Create Actionable Comments

For each issue, provide:
1. **Location** - Exact file:line reference
2. **Problem** - Clear description
3. **Impact** - Why this matters
4. **Fix** - Specific code solution
5. **Category** - Which of the 3 categories

### Step 6: Generate Report

Create report with all three issue sections, summary counts, and merge recommendation.

---

## Key Principles Summary

| Principle | Description |
|-----------|-------------|
| **Diff-Aware** | Focus on actual changes, not pre-existing issues |
| **Fair** | Don't block PRs for legacy problems |
| **Specific** | Exact file:line, not vague complaints |
| **Actionable** | Show the fix, not just the problem |
| **Categorized** | Clear distinction between blocking and informational |
| **Prioritized** | Critical > High > Medium > Low |
| **Documented** | Reports saved for future reference |

---

## Extended References

For detailed implementation:

| Reference | Content |
|-----------|---------|
| `references/report-template.md` | Full report template with all sections |
| `references/pr-comments.md` | PR comment API integration details |
| `references/commands.md` | Bash commands for getting diffs and saving reports |

---

## Integration

This methodology is used by the **Reviewer** agent with different focus areas:

| Focus | Pattern Skill |
|-------|---------------|
| `security` | security-patterns |
| `performance` | performance-patterns |
| `architecture` | architecture-patterns |
| `tests` | tests-patterns |
| `consistency` | consistency-patterns |
| `complexity` | complexity-patterns |
| `regression` | regression-patterns |
| `dependencies` | dependencies-patterns |
| `documentation` | documentation-patterns |
| `typescript` | typescript |
| `database` | database-patterns |

The Reviewer agent loads all pattern skills and applies the relevant one based on the focus area specified in its invocation prompt.
