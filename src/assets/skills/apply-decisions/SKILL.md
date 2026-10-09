---
name: apply-decisions
description: Consume the DECISIONS_CONTEXT index; cite IDs in-session only
user-invocable: false
allowed-tools: Read, Bash
---

# Apply Decisions

## Iron Law

> **VERBATIM IDs ONLY — NEVER FABRICATE**
>
> Cite only IDs that appear verbatim in DECISIONS_CONTEXT. If an ADR/PF ID is not
> in the index, do not cite it. If an entry looks relevant but you haven't Read its
> full body, do not cite it. Fabricated citations are worse than no citations.

## 5-Step Algorithm

### Step 1: Scan the index

One line per active entry: its ID (`ADR-NNN` or `PF-NNN`), a title, then a status tag and/or, after `—`, its area or scope. The footer names the decisions and pitfalls files.

### Step 2: Identify plausibly-relevant entries

Pick entries whose title, area or scope overlaps the files you touch (a matching scope glob is a strong signal), the kind of issue or the architectural area. Follow up a cut-short title that looks relevant.

### Step 3: Read the full body

Find the entry's heading line in the file the footer names, then Read only that section:

```bash
command grep -nF '## ADR-NNN:' "{worktree-from-footer}/.devflow/learning/decisions.md"
```

For a pitfall use `## PF-NNN:` and `pitfalls.md`. Read with `offset` at the printed line and a `limit` of about 25, stopping at the next `## `. The footer is the single source of truth for paths; the ledger is git-ignored, so only a shell search finds the line. A `verified` date is when the entry was last confirmed true; none means unconfirmed. Cite only after reading the body and confirming it applies.

### Step 4: Cite inline — in-session handoffs only

Cite `applies ADR-NNN` or `avoids PF-NNN` in-session only: your reasoning, prompts to downstream agents, your report back.

Anything committed, pushed or posted states the rule in words, never its ID (code, comments, tests, docs, commit messages, PR and issue text, review comments, and any report copied into those). IDs are numbered per machine, so no other clone can resolve one.

### Step 5: Use verbatim IDs only

Cite only IDs in `DECISIONS_CONTEXT`; never guess or rebuild one. When nothing clearly applies, cite nothing.

## Skip Guard

When `DECISIONS_CONTEXT` is empty, `(none)` or not provided, skip this skill — unless your instructions tell you to read the decisions index yourself; that index is then your `DECISIONS_CONTEXT`. Never load decisions files otherwise.
