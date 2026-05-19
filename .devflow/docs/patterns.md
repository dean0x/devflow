# DevFlow Patterns

Recurring patterns and conventions observed in ambient mode and memory implementation.

## Install/Uninstall Patterns

- **Flag overrides interactive prompt**: CLI flags (--flag/--no-flag) fully determine behavior in non-TTY mode; interactive prompt used only in TTY with no flag set. Defaults to false (discovered: 2026-03-01).

- **Setup order dependency**: Ambient hook installation happens AFTER core settings installation, ensuring settings.json exists before mutation (discovered: 2026-03-01).

- **Unconditional idempotent cleanup**: Cleanup functions like `removeAmbientHook()` are safe to call unconditionally because they return unchanged JSON if target not found (discovered: 2026-03-01).

- **Specific cleanup before blanket prompts**: In full uninstall, always remove specific hooks (ambient) before asking user about general categories (all hooks), preventing dangling hooks from blanket "preserve" answer (discovered: 2026-03-01).

## Testing Patterns

- **Pure function re-export**: Utility functions are re-exported from command files for test access, avoiding test-specific mutations of command logic (discovered: 2026-03-01).

- **Idempotence test coverage**: Functions that are called unconditionally are tested for idempotence (calling twice with same input produces same output) (discovered: 2026-03-01).

## Code Organization

- **Settings manipulation in command files**: JSON string manipulation functions (`addAmbientHook`, `removeAmbientHook`, `hasAmbientHook`) live in their own command module and are imported by other commands that need to manipulate settings (discovered: 2026-03-01).

- **Group hook management with partial-state detection**: When managing multiple related hooks (e.g., Stop, SessionStart, PreCompact), declare them in a config object and implement countHooks() for partial-state status display (e.g., "enabled (2/3 hooks)") to guide users toward full enablement (discovered: 2026-03-01).

## Feature Design Patterns

- **Default behavior based on foundational vs opt-in**: Foundational features (memory preservation) default to enabled (true); opt-in enhancements (ambient mode) default to disabled (false). Non-TTY defaults set automatically; TTY prompts use these defaults (discovered: 2026-03-01).

- **Feature prerequisites must be guaranteed during enablement**: When a feature requires runtime resources (e.g., `.docs/` for memory hooks, settings.json for hooks), ensure those resources are created as part of feature activation, not as separate optional steps. Prevents silent no-op failures where hooks register but can't execute (discovered: 2026-03-01).

## Documentation Patterns

- **User-facing descriptions must be concrete**: Replace technical jargon ("proportional quality enforcement") with concrete, action-oriented descriptions ("auto-loads relevant skills based on each prompt"). Users encounter descriptions in CLI output (`devflow list`), init prompts, and help text — clarity matters for discoverability and onboarding (discovered: 2026-03-02).

## Git Patterns

- **Successful commits don't re-run in && chains**: When `git commit && git push` runs, if commit succeeds but then push is examined, the "nothing to commit" message is a status check, not a failed commit. The commit happened on the first command; push operates independently (discovered: 2026-03-02).

## Hook & Session Patterns

- **Hook staleness detection guides user action**: SessionStart hook warns if working memory is >1h old, enabling users to decide whether to refresh or proceed. Prevents silent usage of stale context without explicit operator choice (discovered: 2026-03-02).

- **Hooks write structured sections for readability**: Stop hook writes memory in consistent sections (Now, Progress, Decisions, Modified Files, Context, Session Log) to support scanning and merging across concurrent sessions. Enables SessionStart to inject multi-session context accurately (discovered: 2026-03-02).

- **Memory system overview requires lifecycle perspective**: Understanding automatic hook behavior demands explaining all three hooks together with their triggers — Stop (session end), SessionStart (session start/clear/compact), PreCompact (pre-compression). Users need "when" and "why" to trust the system. Architecture clarity prevents misconceptions (e.g., "does Stop auto-commit?") (discovered: 2026-03-02).

## Memory Model Patterns

- **Line-budget enforcement for memory files**: Cap working memory at 200 lines with SessionStart truncation to prevent bloat. Different sections (Now, Progress, Decisions) shrink proportionally when truncating. Preserves recent context while maintaining session-to-session readability (discovered: 2026-03-03).

- **Volatile vs accumulative memory split**: Two-file model separates concerns — WORKING-MEMORY.md rewritten each session (volatile/ephemeral), PROJECT-PATTERNS.md merged with new patterns (accumulative/durable). Different write semantics prevent forced choices between tight context and pattern preservation (discovered: 2026-03-03).

- **Merge-not-replace for pattern accumulation**: Pattern files grow through intelligent merging — new patterns merge with existing, contradicted patterns auto-prune, duplicates collapse. One LLM call per session, no separate file reads needed (discovered: 2026-03-03).

## Architectural Patterns

- **Infrastructure-level vs application-level memory**: DevFlow injects memory via hooks BEFORE the prompt (zero session overhead, decoupled from workflows). Alternative: application-level workflows load/save memory explicitly (transparent but tokens + coupling). DevFlow's approach favors zero overhead; application-level favors explicitness (discovered: 2026-03-03).

- **Single-file vs multi-file memory model**: DevFlow uses one WORKING-MEMORY.md with 6 sections; cc10x uses three files (patterns.md, activeContext.md, progress.md). Three-file separation enables targeted reads, auto-pruning, and parallel section updates. Single-file is simpler but requires full-file rewrites and heavier merging logic for concurrent sessions (discovered: 2026-03-03).

- **Async background writes vs in-session writes**: DevFlow spawns background `claude --resume` to write memory (zero token cost during work, full conversation context, but requires process management). cc10x writes via Edit/Write tools in-session (token cost, transparent, familiar, simpler process model). Different tradeoffs: DevFlow prioritizes work time; cc10x prioritizes simplicity (discovered: 2026-03-03).

- **Dedicated pre-compaction snapshot vs session-only reload**: DevFlow has a PreCompact hook that snapshots memory before context compression, enabling SessionStart to reinject pre-compaction state. cc10x relies only on SessionStart reload from disk. PreCompact is a robustness pattern for long sessions where compaction timing is unpredictable (discovered: 2026-03-03).

- **Multi-session concurrency via locks vs intra-session parallelism via notes**: DevFlow uses mkdir-based locks + 2-min throttling to serialize concurrent sessions (different machines/terminals on same project). cc10x uses "Memory Notes" pattern — parallel agents collect notes without editing, then serialize edits in final phase (handles intra-session parallelism only). Different concurrency scopes (discovered: 2026-03-03).
