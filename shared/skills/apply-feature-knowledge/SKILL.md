---
name: apply-feature-knowledge
description: Consumption algorithm for FEATURE_KNOWLEDGE variable — pre-computed feature context
user-invocable: false
allowed-tools: Read
---

# Apply Feature Knowledge

## Iron Law

> **Pre-computed context, not a cage. Verify against current code — always.**
>
> A feature knowledge captures patterns AS THEY WERE when last written. Code evolves.
> Use the feature knowledge as a starting point, not gospel truth. When something feels
> off, Read the actual files. Code is authoritative; feature knowledge is supplementary.

---

## 3-Step Algorithm

### Step 1: Read the Feature Knowledge

When `FEATURE_KNOWLEDGE` is provided and is not `(none)`:

1. Read each feature knowledge section (separated by `--- Feature knowledge: {slug} ---` headers)
2. Absorb: architecture, data flow, key patterns, anti-patterns, gotchas
3. Note integration points that relate to your current task

### Step 2: Apply to Current Task

1. **Patterns as defaults**: Follow documented patterns unless you have a specific reason not to
2. **Anti-patterns as warnings**: Check your work against documented anti-patterns
3. **Gotchas as checklists**: Verify each gotcha doesn't apply to your changes
4. **Integration points**: Ensure your changes respect documented boundaries
5. **Key files**: Use as starting points for exploration

### Step 3: Verify Against Current Code

The feature knowledge may not reflect recent changes:
- If the feature knowledge doesn't address your specific area, explore further
- **When an assertion seems outdated**: Read the relevant source files to confirm — code wins
- When you find a contradiction between the KB and actual code, trust the code
- Note discrepancies in your output when they matter for the task

---

## Skip Guard

When `FEATURE_KNOWLEDGE` is `(none)`, empty, or not provided — skip this skill entirely.
Do not mention feature knowledge or its absence in your output.

## Freshness Model

Feature knowledge uses **write-through + verify-on-read** for freshness:
- KBs are written at the point a documented area changes (not on a background schedule)
- Readers verify key assertions against current code rather than relying on staleness markers
- When in doubt, Read the file — that resolves any uncertainty immediately

## Concatenation Format

Multiple feature knowledge entries are concatenated with slug headers:
```
--- Feature knowledge: payments ---
[full KNOWLEDGE.md content]

--- Feature knowledge: auth ---
[full KNOWLEDGE.md content]
```
