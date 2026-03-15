---
name: knowledge-persistence
description: >-
  This skill should be used when recording architectural decisions or pitfalls
  to project knowledge files, or when loading prior decisions and known pitfalls
  for context during investigation, specification, or review.
user-invocable: false
allowed-tools: Read, Write, Bash
---

# Knowledge Persistence

Record architectural decisions and pitfalls to `.memory/knowledge/` files. This is the single source of truth for the extraction procedure — commands reference this skill instead of inlining the steps.

## Iron Law

> **SINGLE SOURCE OF TRUTH**
>
> All knowledge extraction follows this procedure exactly. Commands never inline
> their own extraction steps — they read this skill and follow it.

---

## File Locations

```
.memory/knowledge/
├── decisions.md    # ADR entries (append-only)
└── pitfalls.md     # PF entries (area-specific gotchas)
```

## File Formats

### decisions.md (ADR entries)

**Template header** (create if file missing):
```
<!-- TL;DR: 0 decisions. Key: -->
# Architectural Decisions

Append-only. Status changes allowed; deletions prohibited.
```

**Entry format**:
```markdown
## ADR-{NNN}: {Title}

- **Date**: {YYYY-MM-DD}
- **Status**: Accepted
- **Context**: {Why this decision was needed}
- **Decision**: {What was decided}
- **Consequences**: {Tradeoffs and implications}
- **Source**: {command and identifier, e.g. `/implement TASK-123`}
```

### pitfalls.md (PF entries)

**Template header** (create if file missing):
```
<!-- TL;DR: 0 pitfalls. Key: -->
# Known Pitfalls

Area-specific gotchas, fragile areas, and past bugs.
```

**Entry format**:
```markdown
## PF-{NNN}: {Short description}

- **Area**: {file paths or module names}
- **Issue**: {What goes wrong}
- **Impact**: {Consequences if hit}
- **Resolution**: {How to fix or avoid}
- **Source**: {command and identifier, e.g. `/code-review branch-name`}
```

---

## Extraction Procedure

Follow these steps when recording decisions or pitfalls:

1. **Read** the target file (`.memory/knowledge/decisions.md` or `.memory/knowledge/pitfalls.md`). If it doesn't exist, create it with the template header above.
2. **Check capacity** — count `## ADR-` or `## PF-` headings. If >=50, log "Knowledge base at capacity — skipping new entry" and stop.
3. **Find next ID** — find highest NNN via regex (`/^## ADR-(\d+)/` or `/^## PF-(\d+)/`), default to 0. Increment by 1.
4. **Deduplicate** (pitfalls only) — skip if an entry with the same Area + Issue already exists.
5. **Append** the new entry using the format above.
6. **Update TL;DR** — rewrite the `<!-- TL;DR: ... -->` comment on line 1 to reflect the new count and key topics.

## Lock Protocol

When writing, use a mkdir-based lock:
- Lock path: `.memory/.knowledge.lock`
- Timeout: 30 seconds (fail if lock not acquired)
- Stale recovery: if lock directory is >60 seconds old, remove it and retry
- Release lock after write completes (remove lock directory)

## Loading Knowledge for Context

When a command needs prior knowledge as input (not recording):

1. Read `.memory/knowledge/decisions.md` if it exists
2. Read `.memory/knowledge/pitfalls.md` if it exists
3. Pass content as context to downstream agents — prior decisions constrain scope, known pitfalls inform investigation

If neither file exists, skip silently. No error, no empty-file creation.

## Operation Budget

Recording: do inline (no agent spawn), 2-3 Read/Write operations total.
Loading: 1-2 Read operations, pass as context string.

---

## Extended References

For entry examples and status lifecycle details:
- `references/examples.md` - Full decision and pitfall entry examples

---

## Success Criteria

- [ ] Entry appended with correct sequential ID
- [ ] No duplicate pitfalls (same Area + Issue)
- [ ] TL;DR comment updated with current count
- [ ] Lock acquired before write, released after
- [ ] Capacity limit (50) respected
