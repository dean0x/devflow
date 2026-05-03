# Decisions Format Examples

## Decision Entry Example

```markdown
## ADR-001: Use mkdir-based locks for concurrent session serialization

- **Date**: 2026-03-03
- **Status**: Accepted
- **Context**: Multiple Claude Code sessions can run on the same project simultaneously (different terminals, SSH, etc.). Memory writes must serialize to prevent corruption.
- **Decision**: Use `mkdir` as an atomic lock primitive. Lock directory at `.memory/.decisions.lock`. 30-second timeout with 60-second stale recovery.
- **Consequences**: Simple, cross-platform, no external dependencies. Cannot detect holder PID if lock is stale — relies on age-based recovery. Sufficient for low-contention writes.
- **Source**: `/implement #99`
```

## Pitfall Entry Example

```markdown
## PF-001: Orphaned teams variants silently skipped

- **Area**: plugins/devflow-*/commands/*-teams.md, src/cli/installer
- **Issue**: The installer iterates base `.md` files and looks up matching `-teams.md` variants. A `-teams.md` file without a corresponding base `.md` is silently ignored during installation.
- **Impact**: Teams variant appears committed but never installs. Users on `--teams` mode silently get no command.
- **Resolution**: Always create the base `.md` file first. CI should validate that every `-teams.md` has a matching base file.
- **Source**: `/code-review feat/agent-teams`
```

## Status Lifecycle (Decisions Only)

Decisions support status transitions:
- `Accepted` — current, in effect
- `Superseded by ADR-NNN` — replaced by a newer decision
- `Deprecated` — no longer relevant, kept for history

Pitfalls have no status field — they remain until manually removed.

## Deduplication Logic (Pitfalls Only)

Before appending a new pitfall, check existing entries:
1. Extract `Area` and `Issue` from the new entry
2. Compare against all existing `PF-*` entries
3. If both Area AND Issue match an existing entry (case-insensitive substring), skip

This prevents recording the same gotcha from multiple review cycles.
