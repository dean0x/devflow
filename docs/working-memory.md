# Working Memory

Devflow automatically preserves session context across restarts, `/clear`, and context compaction — zero ceremony required.

## How it works

Three shell hooks run behind the scenes:

| Hook | When | What |
|------|------|------|
| **Stop** | After each response | Updates `.memory/WORKING-MEMORY.md` with current focus, decisions, and progress. Throttled — skips if updated <2 min ago. |
| **SessionStart** | On startup, `/clear`, resume, compaction | Injects previous working memory + fresh git state as system context. Warns if memory is >1h stale. |
| **PreCompact** | Before context compaction | Backs up git state to JSON. Bootstraps a minimal working memory from git if none exists yet. |

Working memory is **per-project** — scoped to each repo's `.memory/` directory. Multiple sessions across different repos don't interfere.

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
.memory/
├── WORKING-MEMORY.md         # Auto-maintained by Stop hook (overwritten each session)
├── backup.json               # Pre-compact git state snapshot
├── learning-log.jsonl        # Learning observations (JSONL, one entry per line)
├── learning.json             # Project-level learning config
├── .learning-runs-today      # Daily run counter (date + count)
├── .learning-session-count   # Session IDs pending batch (one per line)
├── .learning-batch-ids       # Session IDs for current batch run
├── .learning-notified-at     # New artifact notification marker (epoch timestamp)
└── decisions/
    ├── decisions.md           # Architectural decisions (ADR-NNN, append-only)
    └── pitfalls.md            # Known pitfalls (PF-NNN, area-specific gotchas)
```

Debug logs are stored at `~/.devflow/logs/{project-slug}/`.

## Working Memory Sections

The Stop hook maintains these sections in `WORKING-MEMORY.md`:

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

Self-learning shares the `.memory/` directory but uses a completely different pipeline. Working memory captures every turn via a queue (`UserPromptSubmit` → `.pending-turns.jsonl`) and processes them in batch via a background `claude -p --model haiku` updater that writes `WORKING-MEMORY.md`. Self-learning instead uses a `SessionEnd` hook that accumulates session IDs, then triggers a background `claude -p --model sonnet` agent every 3 sessions to extract 4 observation types (workflow, procedural, decision, pitfall) from full transcript batches via channel-based filtering. The two systems operate independently and do not interfere. See [Self-Learning](self-learning.md) for the full architecture.

## Documentation Structure

Devflow creates project documentation in `.docs/`:

```
.docs/
├── reviews/{branch-slug}/              # Review reports per branch
│   ├── .last-review-head              # HEAD SHA for incremental reviews
│   └── {timestamp}/                   # Timestamped review directory
│       ├── {focus}.md                 # Reviewer reports
│       ├── review-summary.md          # Synthesizer output
│       └── resolution-summary.md      # Written by /resolve
└── design/                            # Implementation plans
```
