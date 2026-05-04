---
name: apply-decisions
description: Canonical algorithm for consuming DECISIONS_CONTEXT index — scan index, identify relevant entries, Read full bodies on demand, cite verbatim IDs inline.
user-invocable: false
allowed-tools: Read
---

# Apply Decisions

Canonical consumer algorithm for the `DECISIONS_CONTEXT` index passed by orchestrators. The index lists each ADR/PF entry with ID, truncated title, status, and area — not the full body. Use this skill to surface the right decisions and pitfalls for your task without loading the entire corpus.

## Iron Law

> **VERBATIM IDs ONLY — NEVER FABRICATE**
>
> Cite only IDs that appear verbatim in DECISIONS_CONTEXT. If an ADR/PF ID is not
> in the index, do not cite it. If an entry looks relevant but you haven't Read its
> full body, do not cite it. Fabricated citations are worse than no citations.

---

## 5-Step Algorithm

### Step 1: Scan the index

Read through all entries in `DECISIONS_CONTEXT`. The index format is:

```
Decisions (N):
  ADR-001  Title truncated to 60 chars  [Active]
  ADR-002  Another decision             [Active]

Pitfalls (M):
  PF-004  Background hook god scripts  [Active]  —  scripts/hooks/foo.cjs
  PF-011  DECISIONS_CONTEXT fan-out    [Active]  —  plugins/devflow-resolve/...

ADR-NNN entries live in {worktree}/.memory/decisions/decisions.md
PF-NNN  entries live in {worktree}/.memory/decisions/pitfalls.md
Read the relevant file and locate the matching `## ADR-NNN:` or `## PF-NNN:` heading for the full body.
```

### Step 2: Identify plausibly-relevant entries

From the index, identify entries whose title or area plausibly overlaps with:
- The files you are modifying or reviewing
- The category of issue you are addressing (e.g., error handling, hook scripts, JSON parsing)
- The architectural area of your change

Titles are truncated to 60 characters — if a truncated title looks relevant, proceed to Step 3.

### Step 3: Read the full body

For each plausibly-relevant entry, use the Read tool to open the decisions file listed in the `DECISIONS_CONTEXT` footer and locate the matching `## ADR-NNN:` or `## PF-NNN:` heading. Read the full section to confirm relevance and understand the decision or pitfall completely.

**The footer is the single source of truth for file paths.** Never substitute hardcoded paths — the footer resolves to the correct worktree, which may differ from your cwd in multi-worktree flows.

```
Use the exact paths from the DECISIONS_CONTEXT footer, e.g.:
  {worktree-from-footer}/.memory/decisions/decisions.md   → find ## ADR-NNN: heading
  {worktree-from-footer}/.memory/decisions/pitfalls.md    → find ## PF-NNN: heading
```

Only cite an entry after you have read its full body and confirmed it applies.

### Step 4: Cite inline

When applying a prior decision, cite as `applies ADR-NNN` in your reasoning or output. When avoiding a known pitfall, cite as `avoids PF-NNN`. Place citations in the Reasoning column of decision tables, in inline comments, or in your structured output — wherever your agent's output format captures rationale.

### Step 5: Use verbatim IDs only

Cite only IDs that appear verbatim in `DECISIONS_CONTEXT`. Do not guess at IDs that might exist. Do not construct IDs from memory. If no entry is clearly relevant, skip citation entirely — silence is correct when nothing applies.

---

## Worked Example

**Scenario**: Reviewing `scripts/hooks/background-learning` for issues.

1. **Scan** — Index shows `PF-004  Background hook god scripts  [Active]  —  scripts/hooks/foo.cjs`
2. **Identify** — Area field includes `scripts/hooks/` which overlaps with the file under review
3. **Read** — Open the pitfalls file at the path given in the DECISIONS_CONTEXT footer (e.g., `<worktree>/.memory/decisions/pitfalls.md`), find `## PF-004:` section, read full body
4. **Cite** — If the file shows signs of the god-script pattern, note `avoids PF-004` in reasoning
5. **Verbatim** — ID `PF-004` appeared in the index; citation is valid

---

## Skip Guard

When `DECISIONS_CONTEXT` is empty, `(none)`, or not provided: skip this skill entirely. Do not attempt to load decisions files independently. Do not speculate about what decisions or pitfalls might exist.

---

## Citation Format Reference

| Situation | Citation |
|-----------|----------|
| Applying a prior architectural decision | `applies ADR-NNN` |
| Avoiding a known pitfall | `avoids PF-NNN` |
| Entry not in index | (no citation — silence is correct) |
| Entry in index but not read yet | (no citation — read first) |
