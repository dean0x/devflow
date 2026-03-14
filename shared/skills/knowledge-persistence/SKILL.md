---
name: knowledge-persistence
description: Canonical procedure for recording architectural decisions and pitfalls to project knowledge files
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

### Lock Protocol

When writing, use a mkdir-based lock:
- Lock path: `.memory/.knowledge.lock`
- Timeout: 30 seconds (fail if lock not acquired)
- Stale recovery: if lock directory is >60 seconds old, remove it and retry
- Release lock after write completes (remove lock directory)

### Operation Budget

Do this inline (no agent spawn). 2-3 Read/Write operations total.
