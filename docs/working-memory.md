# Working Memory

Devflow automatically preserves session context across restarts, `/clear`, and context compaction — zero ceremony required.

## How it works

Three shell hooks plus one detached worker run behind the scenes:

| Hook / Worker | When | What |
|---------------|------|------|
| **Stop** (`dream-capture`) | After each response | Captures the user/assistant turns to `.pending-turns.jsonl`. After the 120s throttle (keyed by `.working-memory-last-trigger` mtime), touches `.working-memory-last-trigger` then spawns `background-memory-update` as a detached `nohup` worker (`claude -p --model haiku`). No `memory.json` dream marker is written — memory refresh happens directly via the detached worker, not via the Dream subagent. |
| **`background-memory-update`** (detached worker spawned by Stop) | Triggered by `dream-capture` after throttle expires | Drains `.pending-turns.jsonl` → renames to `.pending-turns.processing` (atomic claim) → calls `claude -p` (prompt on stdin) → rewrites `WORKING-MEMORY.md` with `<!-- memory-head: <sha> branch: <name> -->` on line 1. On success: removes `.processing` and touches `.last-refresh-ok`. On failure: leaves `.processing` for `dream-recover` to recover at next SessionStart. User-only queues (no assistant turn) are truncated without an LLM run. |
| **SessionStart** (`session-start-memory`) | On startup, `/clear`, resume, compaction | Reads the already-fresh `WORKING-MEMORY.md` and injects it as `additionalContext` with a git-reconciled header. Uses the `<!-- memory-head: <sha> branch: <name> -->` stamp on line 1 to determine state: **A** in-sync (stamp SHA = HEAD), **B** drifted (stamp SHA is an ancestor of HEAD — shows commits since last write), or **C** refresh-failing banner (queue non-empty AND `.last-refresh-ok` missing or >600s old). Memory refresh is **not** a Dream task — `session-start-memory` only reads and injects. |
| **SessionStart** (`session-start-context`) | On startup, `/clear`, resume, compaction | Emits the DREAM MAINTENANCE directive (throttled to 120s) when pending Dream markers are present (decisions/knowledge/curation). Also injects decisions TL;DR + learned behaviors. Memory is NOT a Dream task — the Dream agent handles only decisions/knowledge/curation. |
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

Note: `dream/memory.{session}.json` markers no longer exist — memory refresh is handled by the detached Stop-hook worker, not the Dream subagent. Decisions, knowledge, and curation still use Dream markers.

Debug logs are stored at `~/.devflow/logs/{project-slug}/`.

## Working Memory Sections

The `background-memory-update` worker (detached `claude -p` process spawned by `dream-capture`) maintains these sections in `WORKING-MEMORY.md`:

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
