# Working Memory

Devflow automatically preserves session context across restarts, `/clear`, and context compaction — zero ceremony required.

## How it works

Three shell hooks run behind the scenes:

| Hook | When | What |
|------|------|------|
| **Stop** | After each response | Captures the user/assistant turns to `.pending-turns.jsonl` and writes a `memory.json` dream marker (throttled — skips if written <2 min ago). |
| **SessionStart** | On startup, `/clear`, resume, compaction | Injects previous working memory + fresh git state as system context. Warns if memory is >1h stale. Also emits a DREAM MAINTENANCE directive when pending markers are present, spawning the background Dream agent that rewrites `WORKING-MEMORY.md`. |
| **PreCompact** | Before context compaction | Backs up git state to JSON. Bootstraps a minimal working memory from git if none exists yet. |

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
│   ├── WORKING-MEMORY.md         # Auto-maintained by the Dream agent (background LLM agent)
│   ├── backup.json               # Pre-compact git state snapshot
│   ├── .pending-turns.jsonl      # Queue of captured user/assistant turns (JSONL, ephemeral)
│   └── .pending-turns.processing # Atomic handoff during background processing (transient)
├── dream/
│   └── memory.{session}.json     # Pending memory update marker (claimed by the Dream agent)
├── learning/
│   ├── learning-log.jsonl        # Learning observations (JSONL, one entry per line)
│   ├── learning.json             # Project-level learning config
│   ├── .learning-runs-today      # Daily run counter (date + count)
│   ├── .learning-sessions        # Session IDs pending batch (one per line)
│   └── .learning-notified-at     # New artifact notification marker (epoch timestamp)
└── decisions/
    ├── decisions.md              # Architectural decisions (ADR-NNN, append-only)
    └── pitfalls.md               # Known pitfalls (PF-NNN, area-specific gotchas)
```

Debug logs are stored at `~/.devflow/logs/{project-slug}/`.

## Working Memory Sections

The Dream agent (background LLM agent spawned at SessionStart) maintains these sections in `WORKING-MEMORY.md`:

| Section | Purpose |
|---------|---------|
| `## Now` | Current focus and immediate next steps |
| `## Progress` | What's done, what remains, blockers |
| `## Decisions` | Architectural and design decisions made this session |
| `## Modified Files` | Files changed with status |
| `## Context` | Repository state, build status, test results |
| `## Session Log` | Timestamped log of significant actions |

## Long-term Knowledge

Beyond session memory, Devflow persists architectural decisions and known pitfalls:

- **`decisions.md`** — ADR-numbered entries (append-only). Reviewers check if changes violate prior decisions.
- **`pitfalls.md`** — PF-numbered entries scoped by area. Reviewers check if changes reintroduce known pitfalls.

These files are read by reviewers automatically during `/code-review`.

## Self-Learning (Sibling System)

Self-learning shares the `.devflow/` directory but uses a completely different pipeline. Working memory captures every turn via a queue (`UserPromptSubmit` / Stop hook → `.devflow/memory/.pending-turns.jsonl`) and the Dream agent rewrites `WORKING-MEMORY.md` from the queue. Self-learning instead uses `SessionEnd` evaluation modules that write dream markers; the same Dream agent at SessionStart claims those markers and extracts 4 observation types (workflow, procedural, decision, pitfall) from transcript channels via LLM judgment. The two systems operate independently and do not interfere. See [Self-Learning](self-learning.md) for the full architecture.

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
