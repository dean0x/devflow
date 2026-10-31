---
name: review-methodology
description: Use when performing a code review (the 6-step process).
user-invocable: false
allowed-tools: Read, Grep, Glob, Bash
---

# Review Methodology

The review process for Devflow review agents: consistent, fair and actionable reviews.

## Iron Law

> **Never block for pre-existing issues**
>
> Only issues in your changes can block a PR. Pre-existing issues are informational only.
> If you did not add it, you do not own it. Fair reviews focus on the diff, not the codebase.

## Core Philosophy

1. **Focus on changed lines first** - Developer introduced these
2. **Context matters** - Issues near changes should be fixed together
3. **Be fair** - Don't block PRs for legacy code
4. **Be specific** - Exact file:line with examples
5. **Be actionable** - Clear fixes, not vague complaints

## 6-Step Review Process

### Step 1: Identify Changed Lines

Get the diff to understand what changed. Identify base branch and extract changed files/lines.

### Step 2: Categorize Issues

| Category | Scope | Priority | Action |
|----------|-------|----------|--------|
| **1. Issues in Your Changes** | Lines ADDED/MODIFIED in this branch | BLOCKING | Must fix before merge |
| **2. Issues in Code You Touched** | Same file/function, but not your line | HIGH | Should fix while here |
| **3. Pre-existing Issues** | Lines you didn't touch at all | INFORMATIONAL | Fix in separate PR |

**Note:** All categories and severities — including suggestions — are reported for resolution. Categories affect PR merge-blocking, not whether issues get resolved. The resolve workflow evaluates everything.

### Step 3: Analyze with Domain Expertise

Apply your focus lens to each category. Category 1 gets the most scrutiny.

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

## Extended References

- `references/report-template.md`: full report template with all sections
- `references/patterns.md`: diff commands, report file naming, and where PR publication happens
- `references/violations.md`: review process anti-patterns and violations

The Review agent loads one focus skill for each spawn, for example `devflow:security`, `devflow:performance`, `devflow:architecture`, `devflow:testing`, `devflow:consistency`, `devflow:complexity`, `devflow:regression`, `devflow:dependencies`, `devflow:documentation`, `devflow:typescript` or `devflow:database`.
