---
name: apply-feature-knowledge
description: Consumption algorithm for FEATURE_KNOWLEDGE variable — pre-computed feature context
user-invocable: false
allowed-tools: Read
---

# Apply Feature Knowledge

## Iron Law

> **Pre-computed context, not a cage. Verify against current code when assumptions seem outdated.**
>
> A feature KB captures patterns AS THEY WERE when last updated. Code evolves.
> Use the KB as a starting point, not gospel truth.

---

## 3-Step Algorithm

### Step 1: Read the KB

When `FEATURE_KNOWLEDGE` is provided and is not `(none)`:

1. Read each KB section (separated by `--- Feature KB: {slug} ---` headers)
2. Absorb: architecture, data flow, key patterns, anti-patterns, gotchas
3. Note integration points that relate to your current task

### Step 2: Apply to Current Task

1. **Patterns as defaults**: Follow documented patterns unless you have a specific reason not to
2. **Anti-patterns as warnings**: Check your work against documented anti-patterns
3. **Gotchas as checklists**: Verify each gotcha doesn't apply to your changes
4. **Integration points**: Ensure your changes respect documented boundaries
5. **Key files**: Use as starting points for exploration

### Step 3: Supplement as Needed

The KB may not cover everything:
- If the KB doesn't address your specific area, explore further
- If the KB seems outdated (marked `[STALE]`), verify against current code
- If you discover new patterns, note them — they may become KB updates

---

## Skip Guard

When `FEATURE_KNOWLEDGE` is `(none)`, empty, or not provided — skip this skill entirely.
Do not mention feature knowledge or its absence in your output.

## Staleness Handling

KBs marked with `[STALE — referenced files changed since last update. Verify against current code.]`:
- Treat as **lower-confidence** context
- Verify key assertions against current code before relying on them
- Don't assume anti-patterns or gotchas are still valid
- Still use as a starting point — stale context is better than no context

## Concatenation Format

Multiple KBs are concatenated with slug headers:
```
--- Feature KB: payments ---
[full KNOWLEDGE.md content]

--- Feature KB: auth ---
[full KNOWLEDGE.md content]
```
