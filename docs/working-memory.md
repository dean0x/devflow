# Working Memory

Devflow automatically preserves session context across restarts, `/clear`, and context compaction — zero ceremony required.

## How it works

A capture/spawn split across always-on hooks plus one detached worker run behind the scenes:

| Hook / Worker | When | What |
|---------------|------|------|
| **Stop** (`capture-turn`) | After each response | Appends the assistant turn to `.pending-turns.jsonl` (and, independently gated, to the sibling dream queue — see the Decisions pipeline in the project CLAUDE.md). Never spawns anything. |
| **Stop** (`memory-worker`, registered immediately after `capture-turn`) | After each response | After the 120s throttle (keyed by `.working-memory-last-trigger` mtime), touches `.working-memory-last-trigger` then spawns `background-memory-update` as a detached `nohup` worker (`claude -p --model haiku`). |
| **`background-memory-update`** (detached worker spawned by `memory-worker`) | Triggered by `memory-worker` after throttle expires | Drains `.pending-turns.jsonl` → renames to `.pending-turns.processing` (atomic claim) → calls `claude -p` (prompt on stdin) → rewrites `WORKING-MEMORY.md` with `<!-- memory-head: <sha> branch: <name> -->` on line 1. On success: removes `.processing` and touches `.last-refresh-ok`. On failure: leaves `.processing` for `session-start-memory` to recover at next SessionStart. User-only queues (no assistant turn) are truncated without an LLM run. |
| **SessionStart** (`session-start-memory`) | On startup, `/clear`, resume, compaction | Reads the already-fresh `WORKING-MEMORY.md` and injects it as `additionalContext` with a git-reconciled header. Uses the `<!-- memory-head: <sha> branch: <name> -->` stamp on line 1 to determine state: **A** in-sync (stamp SHA = HEAD), **B** drifted (stamp SHA is an ancestor of HEAD — shows commits since last write), or **C** refresh-failing banner (queue non-empty AND `.last-refresh-ok` missing or >600s old). Also recovers an orphaned `.pending-turns.processing` itself (self-contained cold path — no external helper dependency). |
| **SessionStart** (`session-start-context`) | On startup, `/clear`, resume, compaction | Injects the decisions TL;DR and, when present, the detached dream worker's optional `last-run-summary` (deleted after injection). |
| **PreCompact** | Before context compaction | Backs up git state + WORKING-MEMORY.md snapshot to `backup.json`. |

Working memory is **per-project** — scoped to each repo's `.devflow/` directory. Multiple sessions across different repos don't interfere.

## Enable / Disable

```bash
npx devflow-kit init --memory          # Enable during install
npx devflow-kit init --no-memory       # Disable during install
devflow memory --enable                # Toggle on
devflow memory --disable               # Toggle off
devflow memory --status                # Check current state
```

## File Structure

```
.devflow/
├── memory/
│   ├── WORKING-MEMORY.md             # Auto-maintained by background-memory-update worker (claude -p haiku)
│   │                                 # Line 1: <!-- memory-head: <sha> branch: <name> -->
│   ├── backup.json                   # Pre-compact git state snapshot
│   ├── .pending-turns.jsonl          # Queue of captured user/assistant turns (JSONL, ephemeral)
│   ├── .pending-turns.processing     # Atomic handoff during background processing (transient)
│   ├── .working-memory-last-trigger  # Mtime-keyed throttle for worker spawning (120s)
│   └── .last-refresh-ok              # Touched on successful worker run (State C detection)
└── decisions/
    ├── decisions.md              # Architectural decisions (ADR-NNN, append-only)
    └── pitfalls.md               # Known pitfalls (PF-NNN, area-specific gotchas)
```

Note: no marker files are involved anywhere in this flow — memory refresh is handled entirely by the queue + detached Stop-hook worker above. Decisions detection and curation follow the same pattern via a separate queue at `.devflow/dream/.pending-turns.jsonl` and a SessionStart-spawned detached worker (see the project CLAUDE.md's Decisions pipeline section).

Debug logs are stored at `~/.devflow/logs/{project-slug}/`.

## Working Memory Sections

The `background-memory-update` worker (detached `claude -p` process spawned by `memory-worker`) maintains these sections in `WORKING-MEMORY.md`:

| Section | Purpose |
|---------|---------|
| `## Now` | Current focus and immediate next steps |
| `## Progress` | What's done, what remains, blockers |
| `## Decisions` | Architectural and design decisions made this session |
| `## Context` | Repository state, build status, test results |
| `## Session Log` | Timestamped log of significant actions |

## Long-term Knowledge

Beyond session memory, Devflow persists architectural decisions and known pitfalls:

- **`decisions.md`** — ADR-numbered entries (append-only). Reviewers check if changes violate prior decisions.
- **`pitfalls.md`** — PF-numbered entries scoped by area. Reviewers check if changes reintroduce known pitfalls.

These files are read by reviewers automatically during `/code-review`.

## Documentation Structure

Devflow creates project documentation in `.devflow/docs/`:

```
.devflow/docs/
├── reviews/{branch-slug}/              # Review reports per branch
│   ├── .last-review-head              # HEAD SHA for incremental reviews
│   └── {timestamp}/                   # Timestamped review directory
│       ├── {focus}.md                 # Reviewer reports
│       ├── review-summary.md          # Synthesizer output
│       └── resolution-summary.md      # Written by /resolve
└── design/                            # Implementation plans
```
