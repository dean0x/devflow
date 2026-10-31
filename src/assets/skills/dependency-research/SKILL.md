---
name: dependency-research
description: This skill should be used when the user asks to "add a utility", "create a helper", "build a wrapper", or writes utility code a maintained package may already provide.
user-invocable: false
allowed-tools: Read, Grep, Glob
---

# Research

Research before building. Check if a battle-tested solution exists before writing custom utility code.

## Iron Law

> **RESEARCH BEFORE BUILDING**
>
> Never write custom utility code without first checking if a battle-tested solution
> exists. The best code is code you don't write. A maintained package with thousands
> of users will always beat a hand-rolled utility in reliability, edge cases, and
> long-term maintenance.

## When This Skill Activates

**Triggers** — creating or modifying utility or infrastructure code that:
- Parses, formats, or validates data (dates, URLs, emails, UUIDs, etc.)
- Implements common algorithms (sorting, diffing, hashing, encoding)
- Wraps HTTP clients, retries, rate limiting, caching
- Handles file system operations beyond basic read/write
- Implements CLI argument parsing, logging, or configuration
- Creates test utilities (mocking, fixtures, assertions)

**Does not trigger** for:
- Domain-specific business logic unique to this project, where no generic solution could exist
- Glue code connecting existing components
- Trivial operations (< 5 lines, single-use)
- Code that intentionally avoids external dependencies (e.g., zero-dep libraries)

## Research Process

### Phase 1: Need Analysis

Before searching, write the need in one sentence, with its constraints (runtime, bundle size, license, zero-dep requirement), its must-haves and its nice-to-haves.

### Phase 2: Search

Spawn an Explore subagent when you can spawn agents, to keep main session context clean; otherwise search directly. Search for packages in the project's ecosystem (npm/PyPI/crates; check package.json/requirements.txt), existing utilities in this codebase, and framework built-ins. For each candidate, find weekly downloads, last publish date and maintenance status, bundle size and dependency count, the API surface relevant to the need, and license. Return the top 3 candidates with pros and cons, or confirm nothing suitable exists.

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

**Document the decision** in a code comment at the usage site, for example `// research: Adopted date-fns for date formatting (2M weekly downloads, 30KB)` or `// research: Built custom — no package handles our specific wire format`.

## Anti-Patterns

- Choosing the most popular package without checking fit: evaluate API fit, not just popularity.
- Wrapping a package so heavily it obscures the original: if wrapping > 50% of the original API, reconsider.
- Installing a massive framework for one utility function: look for focused, single-purpose packages.
