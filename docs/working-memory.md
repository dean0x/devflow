# Working Memory

Devflow automatically preserves session context across restarts, `/clear`, and context compaction — zero ceremony required.

## How it works

A capture/spawn split across always-on hooks plus one detached worker run behind the scenes:

| Hook / Worker | When | What |
|---------------|------|------|
| **Stop** (`capture-turn`) | After each response | Appends the assistant turn to `.pending-turns.jsonl` (and, independently gated, to the sibling learning queue — see the Learning pipeline in the project CLAUDE.md). Never spawns anything. |
| **Stop** (`memory-worker`, registered immediately after `capture-turn`) | After each response | After the 120s throttle (keyed by `.working-memory-last-trigger` mtime), touches `.working-memory-last-trigger` then spawns `background-memory-update` as a detached `nohup` worker (`claude -p --model claude-sonnet-4-6`). |
| **`background-memory-update`** (detached worker spawned by `memory-worker`) | Triggered by `memory-worker` after throttle expires | Drains `.pending-turns.jsonl` → renames to `.pending-turns.processing` (atomic claim) → snapshots `WORKING-MEMORY.md` checksum (PRE_RUN_CKSUM; "ABSENT" sentinel when file is missing) → calls `claude -p` (prompt on stdin — never naming the real file path) with a reconciliation-aware prompt (bounded git evidence since last stamp, reconciliation/expiry guidance, DONE definition) → model writes to `WORKING-MEMORY.md.new` only. **CAS verify-and-swap**: re-checksums `WORKING-MEMORY.md`; if unchanged (`PRE == POST`) and staged file exists and is stamped: renames `.new` → `WORKING-MEMORY.md` (UPDATED), removes `.processing`, touches `.last-refresh-ok`. If `WORKING-MEMORY.md` changed during the run (human edit): CONFLICT path — keeps human's version, unlinks `.new`, leaves `.processing` for retry on next run. If staged file absent or un-stamped: FAIL path — leaves `.processing` for crash recovery at next SessionStart. User-only queues (no assistant turn) are truncated without an LLM run. ms-scale TOCTOU between the pre-run read and the post-run CAS is accepted; the CAS catches mid-run clobber precisely because it verifies the baseline before swapping. |
| **SessionStart** (`session-start-memory`) | On startup, `/clear`, resume, compaction | Reads the already-fresh `WORKING-MEMORY.md` and injects it as `additionalContext` with a git-reconciled header. Uses the `<!-- memory-head: <sha> branch: <name> -->` stamp on line 1 to determine state: **A** in-sync (stamp SHA = HEAD), **B** drifted (stamp SHA is an ancestor of HEAD — shows commits since last write), or **C** refresh-failing banner (queue non-empty AND `.last-refresh-ok` missing or >600s old; State C queue depth counts both `.pending-turns.jsonl` lines and any orphaned `.pending-turns.processing` lines). Also recovers an orphaned `.pending-turns.processing` itself (self-contained cold path — no external helper dependency). |
| **SessionStart** (`session-start-context`) | On startup, `/clear`, resume, compaction | Injects the decisions TL;DR and, when the learning queue has pending turns, the Learning maintenance directive (spawns the background Learning agent). |
| **PreCompact** | Before context compaction | Backs up git state + WORKING-MEMORY.md snapshot to `backup.json`. When WORKING-MEMORY.md is absent, bootstraps it with a `<!-- memory-head: <40-hex sha> branch: <name> -->` stamp on line 1 and the five canonical sections; requires both a non-empty branch name and a 40-hex HEAD sha, so detached HEAD and unborn branches skip bootstrap. An existing file is never re-stamped here. |

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
│   ├── WORKING-MEMORY.md             # Auto-maintained by background-memory-update worker (claude -p sonnet 4.6)
│   │                                 # Line 1: <!-- memory-head: <sha> branch: <name> -->
│   ├── WORKING-MEMORY.md.new         # Staged file: model writes here; CAS renames to WORKING-MEMORY.md on success (transient)
│   ├── backup.json                   # Pre-compact git state snapshot (plain JSON — no stamp)
│   ├── .pending-turns.jsonl          # Queue of captured user/assistant turns (JSONL, ephemeral)
│   ├── .pending-turns.processing     # Atomic handoff during background processing (transient)
│   │                                 # CONFLICT path leaves .processing for retry; FAIL path leaves for crash recovery
│   ├── .working-memory-last-trigger  # Mtime-keyed throttle for worker spawning (120s)
│   └── .last-refresh-ok              # Touched on successful CAS swap (State C detection)
└── learning/
    ├── decisions.md              # Architectural decisions (ADR-NNN, append-only)
    └── pitfalls.md               # Known pitfalls (PF-NNN, area-specific gotchas)
```

Note: no marker files are involved anywhere in this flow — memory refresh is handled entirely by the queue + detached Stop-hook worker above. Decisions detection and curation follow the same pattern via a separate queue at `.devflow/learning/.pending-turns.jsonl` and a SessionStart-spawned detached worker (see the project CLAUDE.md's Learning pipeline section).

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

- **`decisions.md`** — ADR-numbered entries (append-only). Review agents check if changes violate prior decisions.
- **`pitfalls.md`** — PF-numbered entries scoped by area. Review agents check if changes reintroduce known pitfalls.

These files are read by Review agents automatically during `/code-review`.

## Documentation Structure

Devflow creates project documentation in `.devflow/docs/`:

```
.devflow/docs/
├── reviews/{branch-slug}/              # Review reports per branch
│   ├── .last-review-head              # HEAD SHA for incremental reviews
│   └── {timestamp}/                   # Timestamped review directory
│       ├── {focus}.md                 # Review agent reports
│       ├── review-summary.md          # Synthesize agent output
│       └── resolution-summary.md      # Written by /resolve
└── design/                            # Implementation plans
```
