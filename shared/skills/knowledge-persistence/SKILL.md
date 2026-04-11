---
name: knowledge-persistence
description: >-
  Format specification for on-disk knowledge files (.memory/knowledge/decisions.md
  and pitfalls.md). Used by commands that read knowledge for context. Writing is
  performed exclusively by the background extractor.
user-invocable: false
allowed-tools: Read, Grep, Glob
---

<!--
@devflow-design-decision D9
This skill is a format spec documenting the on-disk format and lock protocol.
It is NOT invoked by commands. The only writer is scripts/hooks/background-learning
via json-helper.cjs (render-ready → knowledge-append operation).
Commands that previously used this skill to write knowledge (implement Phase 10,
code-review Phase 5, debug Phase 6, resolve Phase 6) were removed in v2 because
agent-summaries produced low-signal entries. Knowledge is now extracted from user
transcripts by the background learning system.
-->

# Knowledge Persistence — Format Specification

On-disk format for project knowledge files. This is the canonical reference for the
entry format, capacity limit, lock protocol, and status field semantics.

**Invocation note**: This skill is a format spec. Rendering is performed by the
background extractor at `scripts/hooks/background-learning` via
`json-helper.cjs render-ready`. Commands do not invoke this skill to write.

## Iron Law

> **SINGLE SOURCE OF FORMAT TRUTH**
>
> All knowledge entries follow this exact format. The background extractor
> writes entries atomically using the lock protocol below. Commands that read
> knowledge for context do so without a lock (read-only is safe).

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
- **Source**: {session ID or command identifier}
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
- **Source**: {session ID or command identifier}
```

---

## Capacity Limit

Maximum 50 entries per file (`## ADR-` or `## PF-` headings). The background
extractor checks capacity before writing. At capacity: new entries are skipped and
`softCapExceeded` is set on the corresponding observation for HUD review.

## Status Field Semantics

The `Status:` field in ADR entries accepts:
- `Accepted` — active decision, enforced
- `Superseded` — replaced by a newer ADR (reference successor)
- `Deprecated` — no longer applicable (set by `devflow learn --review`)
- `Proposed` — under consideration (rare, set manually)

## Lock Protocol

When writing, the background extractor uses a mkdir-based lock:
- Lock path: `.memory/.knowledge.lock`
- Timeout: 30 seconds (fail if lock not acquired)
- Stale recovery: if lock directory is >60 seconds old, remove it and retry
- Release lock after write completes (remove lock directory)

---

## Extended References

- `references/examples.md` — Full decision and pitfall entry examples
