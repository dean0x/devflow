---
name: apply-decisions
description: Canonical algorithm for consuming DECISIONS_CONTEXT index — scan index, identify relevant entries, Read full bodies on demand, cite verbatim IDs in-session and state the rule in words in anything committed or posted.
user-invocable: false
allowed-tools: Read
---

# Apply Decisions

Canonical consumer algorithm for the `DECISIONS_CONTEXT` index passed by orchestrators. The index lists each active ADR/PF entry with its ID and title — plus a status tag and an area on a v1 line, or the entry's scope on a v2 line — not the full body. Use this skill to surface the right decisions and pitfalls for your task without loading the entire corpus.

## Iron Law

> **VERBATIM IDs ONLY — NEVER FABRICATE**
>
> Cite only IDs that appear verbatim in DECISIONS_CONTEXT. If an ADR/PF ID is not
> in the index, do not cite it. If an entry looks relevant but you haven't Read its
> full body, do not cite it. Fabricated citations are worse than no citations.

---

## 5-Step Algorithm

### Step 1: Scan the index

Read through all entries in `DECISIONS_CONTEXT`. The index lists active entries only, in two line kinds:

```
Decisions (N):
  ADR-NNN  Return Result types from every fallible operation  [Accepted]
  ADR-NNN  Claim the learning queue with an op, never with mv  —  src/assets/scripts/hooks/**, area:learning

Pitfalls (M):
  PF-NNN  Background hook god scripts  [Active]  —  src/assets/scripts/hooks/foo.cjs
  PF-NNN  A rename claims a shared file only while nothing re-creates it  —  area:hooks

ADR-NNN entries live in {worktree}/.devflow/learning/decisions.md
PF-NNN  entries live in {worktree}/.devflow/learning/pitfalls.md
Read the relevant file and locate the matching `## ADR-NNN:` or `## PF-NNN:` heading for the full body.
```

- **A v1 line** ends in a status tag — `[Accepted]` on a decision, `[Active]` on a pitfall — after a title cut to 60 characters, and a pitfall adds its area after `—`.
- **A v2 line** has no tag. Its title is whole, and after `—` comes its scope: the globs and `area:` tags the rule governs, cut to 80 characters.

### Step 2: Identify plausibly-relevant entries

From the index, identify entries whose title, area or scope plausibly overlaps with:
- The files you are modifying or reviewing — a v2 scope glob that matches one of them is a strong signal
- The category of issue you are addressing (e.g., error handling, hook scripts, JSON parsing)
- The architectural area of your change

A v1 title may be cut short — if a truncated title looks relevant, proceed to Step 3.

### Step 3: Read the full body

For each plausibly-relevant entry, use the Read tool to open the decisions file listed in the `DECISIONS_CONTEXT` footer and locate the matching `## ADR-NNN:` or `## PF-NNN:` heading. Read the full section to confirm relevance and understand the decision or pitfall completely.

A v2 body reads:

```
## ADR-NNN: {title}

- **Status**: Accepted · verified {date}
- **Scope**: `{glob}`, `area:{tag}`
- **Decision**: {the rule}
- **Why**: {why it holds}
- **Source**: {where it was learned}
```

A pitfall's Status is `Active` and its rule line is labelled `**Rule**`. The verified date is the day the entry was last confirmed true; a body without one has not been confirmed since it was written. A v1 body carries `**Date**`, `**Status**`, `**Context**`, `**Decision**` and `**Consequences**` for a decision, or `**Area**`, `**Issue**`, `**Impact**`, `**Resolution**` and `**Status**` for a pitfall.

**The footer is the single source of truth for file paths.** Never substitute hardcoded paths — the footer resolves to the correct worktree, which may differ from your cwd in multi-worktree flows.

```
Use the exact paths from the DECISIONS_CONTEXT footer, e.g.:
  {worktree-from-footer}/.devflow/learning/decisions.md   → find ## ADR-NNN: heading
  {worktree-from-footer}/.devflow/learning/pitfalls.md    → find ## PF-NNN: heading
```

Only cite an entry after you have read its full body and confirmed it applies.

### Step 4: Cite inline — in-session handoffs only

When applying a prior decision, cite as `applies ADR-NNN`. When avoiding a known pitfall, cite as `avoids PF-NNN`. Place these citations only where they stay in the session: your reasoning, decision tables, prompts to downstream agents, and your report back to the caller.

Anything committed, pushed or posted states the rule in words, never its ID: code, comments, tests, docs, KNOWLEDGE.md files, commit messages, PR and issue text, review and PR comments, resolution summaries — and any report a later step copies into one of those. The ledger is gitignored and numbered per machine, so no other clone can resolve an ID, and numbers get reused.

### Step 5: Use verbatim IDs only

Cite only IDs that appear verbatim in `DECISIONS_CONTEXT`. Do not guess at IDs that might exist. Do not construct IDs from memory. If no entry is clearly relevant, skip citation entirely — silence is correct when nothing applies.

---

## Worked Example

**Scenario**: Reviewing `src/assets/scripts/hooks/background-learning` for issues.

1. **Scan** — Index shows `PF-NNN  Background hook god scripts  [Active]  —  src/assets/scripts/hooks/foo.cjs`
2. **Identify** — Area field includes `src/assets/scripts/hooks/` which overlaps with the file under review
3. **Read** — Open the pitfalls file at the path given in the DECISIONS_CONTEXT footer (e.g., `<worktree>/.devflow/learning/pitfalls.md`), find `## PF-NNN:` section, read full body
4. **Cite** — If the file shows signs of the god-script pattern, note `avoids PF-NNN` in reasoning; a comment you commit for the fix says why in words ("hooks stay thin dispatchers"), never the ID
5. **Verbatim** — ID `PF-NNN` appeared in the index; citation is valid

---

## Skip Guard

When `DECISIONS_CONTEXT` is empty, `(none)`, or not provided: skip this skill entirely — unless your agent instructions tell you to read the decisions index yourself, in which case the index you read is your `DECISIONS_CONTEXT`. Do not otherwise load decisions files independently. Do not speculate about what decisions or pitfalls might exist.

---

## Citation Format Reference

| Situation | Citation |
|-----------|----------|
| Applying a prior architectural decision | `applies ADR-NNN` |
| Avoiding a known pitfall | `avoids PF-NNN` |
| Entry not in index | (no citation — silence is correct) |
| Entry in index but not read yet | (no citation — read first) |
| Text that is committed, pushed or posted | (no ID — state the rule in words) |
