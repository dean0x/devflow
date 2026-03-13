---
name: search-first
description: >-
  This skill should be used when the user asks to "add a utility", "create a helper",
  "implement parsing", "build a wrapper", or writes infrastructure/utility code that
  may already exist as a well-maintained package. Enforces research before building.
user-invocable: false
allowed-tools: Read, Grep, Glob
---

# Search-First

Research before building. Check if a battle-tested solution exists before writing custom utility code.

## Iron Law

> **RESEARCH BEFORE BUILDING**
>
> Never write custom utility code without first checking if a battle-tested solution
> exists. The best code is code you don't write. A maintained package with thousands
> of users will always beat a hand-rolled utility in reliability, edge cases, and
> long-term maintenance.

## When This Skill Activates

**Triggers** — creating or modifying code that:
- Parses, formats, or validates data (dates, URLs, emails, UUIDs, etc.)
- Implements common algorithms (sorting, diffing, hashing, encoding)
- Wraps HTTP clients, retries, rate limiting, caching
- Handles file system operations beyond basic read/write
- Implements CLI argument parsing, logging, or configuration
- Creates test utilities (mocking, fixtures, assertions)

**Does NOT trigger** for:
- Domain-specific business logic unique to this project
- Glue code connecting existing components
- Trivial operations (< 5 lines, single-use)
- Code that intentionally avoids external dependencies (e.g., zero-dep libraries)

---

## Research Process

### Phase 1: Need Analysis

Before searching, define what you actually need:

```
Need: {one-sentence description of the capability}
Constraints: {runtime, bundle size, license, zero-dep requirement}
Must-haves: {non-negotiable requirements}
Nice-to-haves: {optional features}
```

### Phase 2: Search

Delegate research to an Explore subagent to keep main session context clean.

**Spawn an Explore agent** with this prompt template:

```
Task(subagent_type="Explore"):
"Research existing solutions for: {need description}

Search for:
1. npm/PyPI/crates packages that solve this (check package.json/requirements.txt for ecosystem)
2. Existing utilities in this codebase (grep for related function names)
3. Framework built-ins that already handle this

For each candidate, find:
- Package name and weekly downloads (if applicable)
- Last publish date and maintenance status
- Bundle size / dependency count
- API surface relevant to our need
- License compatibility

Return top 3 candidates with pros/cons, or confirm nothing suitable exists."
```

### Phase 3: Evaluate

Score each candidate against evaluation criteria. See `references/evaluation-criteria.md` for the full matrix.

Quick checklist:
- [ ] Last published within 12 months
- [ ] Weekly downloads > 1,000 (npm) or equivalent traction
- [ ] No known vulnerabilities (check Snyk/npm audit)
- [ ] API fits the use case without heavy wrapping
- [ ] License compatible with project (MIT/Apache/BSD preferred)
- [ ] Bundle size acceptable for the project context

### Phase 4: Decide

Choose one of four outcomes:

| Decision | When | Action |
|----------|------|--------|
| **Adopt** | Exact match, well-maintained, good API | Install and use directly |
| **Extend** | Partial match, needs thin wrapper | Install + write minimal adapter |
| **Compose** | No single package fits, but 2-3 small ones combine well | Install multiple, write glue code |
| **Build** | Nothing fits, or dependency cost exceeds value | Write custom, document why |

**Document the decision** in a code comment at the usage site:

```typescript
// search-first: Adopted date-fns for date formatting (2M weekly downloads, 30KB)
// search-first: Built custom — no package handles our specific wire format
```

---

## Anti-Patterns

| Anti-Pattern | Correct Approach |
|-------------|-----------------|
| Adding a dependency for 5 lines of trivial code | Build — dependency overhead exceeds value |
| Choosing the most popular package without checking fit | Evaluate API fit, not just popularity |
| Wrapping a package so heavily it obscures the original | If wrapping > 50% of original API, reconsider |
| Skipping research because "I know how to build this" | Research anyway — maintenance cost matters more than initial build |
| Installing a massive framework for one utility function | Look for focused, single-purpose packages |

## Scope Limiter

This skill concerns **utility and infrastructure code** only:
- Data transformation, validation, formatting
- Network operations, retries, caching
- CLI tooling, logging, configuration
- Test utilities and helpers

It does NOT apply to **domain-specific business logic** where:
- The logic encodes unique business rules
- No generic solution could exist
- The code is inherently project-specific
