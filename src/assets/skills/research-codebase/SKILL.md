---
name: research-codebase
description: Local codebase research — find patterns, trace flows, map dependencies without browsing the web
user-invocable: false
allowed-tools: Read, Grep, Glob
---

# Codebase Research

Local codebase research for finding patterns, tracing call flows, and mapping module dependencies. No external web access — all evidence comes from the local codebase.

## Iron Law

> **CITE CODE, NOT ASSUMPTIONS**
>
> Every claim about the codebase must have file:line evidence. Patterns require 3+
> examples to count as patterns. "I believe this is the pattern" without citation is
> a research failure. If you can't find the evidence, say so — don't invent it.

## Trust Tier

**trusted** — Local code is the authoritative source. All findings carry maximum confidence.

## When This Activates

Loaded by Researcher agent when `RESEARCH_TYPE` is `codebase`. Covers:
- Finding existing patterns before implementing new features
- Tracing call chains to understand data flow
- Mapping module boundaries and dependencies
- Identifying conventions used across the codebase

---

## Methodology

### Step 1: Define Scope

Before reading anything, define the scope:
- Target area (directory, module, or concept)
- What you are looking for (patterns, functions, conventions, dependencies)
- What files are likely NOT relevant (test fixtures, generated files)

### Step 2: Structural Scan

Use Glob and Grep to build a map before reading:

```
Glob: Find all files matching the area (e.g., src/auth/**/*.ts)
Grep: Search for key terms, function names, type names
```

Use this to build a candidate file list. Do not read more than 15 files total.

### Step 3: Deep Read (Targeted)

Read only the files that the structural scan identified as relevant. Read targeted ranges — not entire files — unless the file is under 50 lines.

### Step 4: Pattern Extraction

For each observed pattern:
- Record the first 3 occurrences with file:line
- Describe the pattern in one sentence
- Note any deviations from the pattern

Only declare a pattern after finding 3+ consistent examples.

### Step 5: Cross-Reference

Before finalizing findings:
- Check if patterns conflict with each other
- Identify exceptions to patterns you found
- Note if something appears in tests vs production code

### Step 6: Structured Output

Produce findings in the Output Format below. Every claim cites file:line.

---

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

---

## Anti-Patterns

| Anti-Pattern | Correct Approach |
|-------------|-----------------|
| Reading entire files when only a section is needed | Read targeted line ranges |
| Claiming a pattern from 1-2 examples | Require 3+ consistent occurrences |
| Browsing without a defined question | Define scope in Step 1 first |
| Asserting file structure without Glob verification | Run Glob before claiming structure |
| Treating test code as production patterns | Note which context examples come from |
