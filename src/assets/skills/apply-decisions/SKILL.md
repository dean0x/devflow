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
> Cite only an ID that appears verbatim in DECISIONS_CONTEXT, and only after you Read its full body.
> A fabricated citation is worse than none.
>
> DECISIONS_CONTEXT may be a slice; read the full index at the named path only when your work leaves the slice's scope.

## 5-Step Algorithm

### Step 1: Scan the index

One line per active entry: its ID (`ADR-NNN` or `PF-NNN`), a title, then a status tag and/or, after `—`, its area or scope. A slice leads with `(slice: N of M entries — full index: <path>)`.

### Step 2: Identify plausibly-relevant entries

Pick entries whose title, area or scope overlaps the files you touch (a matching scope glob is a strong signal), the kind of issue or the architectural area. Follow up a cut-short title that looks relevant.

### Step 3: Read the full body

Find the entry's heading in the file the footer names:

```bash
command grep -nF '## ADR-NNN:' "{worktree-from-footer}/.devflow/curation/decisions.md"
```

For a pitfall use `## PF-NNN:` and `pitfalls.md`. Read with `offset` at the printed line and a `limit` of about 25, stopping at the next `## `. Search all chosen entries in one call, then Read their bodies in one turn. The footer is the single source of truth for paths; the ledger is git-ignored, so search by shell. A `verified` date is the last confirmation; none means unconfirmed.

### Step 4: Cite inline — in-session handoffs only

Cite `applies ADR-NNN` or `avoids PF-NNN` in-session only: your reasoning, prompts to downstream agents, your report back.

Anything committed, pushed or posted states the rule in words, never its ID (code, comments, tests, docs, commit messages, PR and issue text, review comments, and any report copied into those). IDs are numbered per machine, so no other clone can resolve one.

### Step 5: Use verbatim IDs only

Never guess or rebuild an ID. When nothing clearly applies, cite nothing.

## Skip Guard

When `DECISIONS_CONTEXT` is empty, `(none)` or not provided, skip this skill. Never load decisions files otherwise.
