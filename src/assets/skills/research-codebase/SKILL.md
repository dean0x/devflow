---
name: research-codebase
description: Local codebase research — find patterns, trace flows, map dependencies
user-invocable: false
allowed-tools: Read, Grep, Glob
---

# Codebase Research

All evidence comes from the local codebase. No web access.

## Iron Law

> **CITE CODE, NOT ASSUMPTIONS**
>
> Every claim about the codebase must have file:line evidence. Patterns require 3+
> examples to count as patterns. "I believe this is the pattern" without citation is
> a research failure. If you can't find the evidence, say so — don't invent it.

## Trust Tier

**trusted** — Local code is the authoritative source. All findings carry maximum confidence.

## Methodology

### Step 1: Define Scope

Before reading, define the target area (directory, module or concept), what you look for (patterns, functions, conventions, dependencies), and which files are not relevant (test fixtures, generated files).

### Step 2: Structural Scan

Before reading, map the area with Glob (file patterns, e.g. `src/auth/**/*.ts`) and Grep (key terms, function and type names), and build a candidate file list. Run Glob before claiming file structure. Do not read more than 15 files total.

### Step 3: Deep Read (Targeted)

Read only the files the scan marked relevant, and only targeted ranges unless the file is under 50 lines.

### Step 4: Pattern Extraction

For each pattern, record the first 3 occurrences with file:line, describe it in one sentence, and note deviations. Only declare a pattern after finding 3+ consistent examples.

### Step 5: Cross-Reference

Before finalizing, check whether patterns conflict, identify exceptions, and note whether each example comes from tests or production code.

### Step 6: Structured Output

Produce findings in the Output Format below. Every claim cites file:line.

## Output Format

```markdown
<!-- trust: trusted -->
# Codebase Research: {RESEARCH_QUESTION}

**Date**: {timestamp}
**Trust**: trusted
**Files Examined**: {n}

## Key Findings

1. {Finding with file:line evidence}
2. {Finding with file:line evidence}

## Evidence

| Claim | File | Lines |
|-------|------|-------|
| {pattern or fact} | `path/to/file.ts` | `45-52` |

## Pattern Table

| Pattern | Example | Occurrences |
|---------|---------|-------------|
| {name} | `file:line` | {n} instances |

## Dependency Map

| Module | Depends On | Notes |
|--------|-----------|-------|
| {mod} | `{dep}` | {relationship} |

## Confidence Assessment

| Finding | Confidence | Basis |
|---------|-----------|-------|
| {finding} | High | 3+ examples at file:line |

## Limitations

- {What was not investigated}
- {Scope boundaries}
```
