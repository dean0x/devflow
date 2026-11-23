# Working Memory

Working memory keeps a short note across restarts, `/clear`, and context compaction.
Working memory is off by default on new installs.

## How it works

| Hook / Worker | When | What |
|---------------|------|------|
| `capture-prompt`, `capture-turn`, `capture-question` | On a prompt, response, or answered question | Add rows to the memory queue when memory is on. Each memory row carries the session ID when it is available. The curation queue has its own switch. |
| `memory-worker` | After each response, in parallel with `capture-turn` | Starts the detached `background-memory-update` worker after the 120-second throttle expires. |
| `background-memory-update` | When `memory-worker` starts it | Claims a batch under the queue lock. Pairs prompts and replies within the same session. Runs `claude -p` on `agents.memory` (default `claude-sonnet-5-5`, high effort). Use `devflow agents` to change the model or effort. |
| `session-start-memory` | On startup, `/clear`, resume, and compaction | Adds the current note to `additionalContext` with a header that shows its Git state. Recovers orphaned batches. |
| `pre-compact-memory` | Before context compaction | Saves Git state to `backup.json`. If there is a HEAD commit and no note, creates a note with a stamp and two sections. For a detached HEAD, the stamp uses `branch: (detached)`. |

If the queue has only user rows, the worker keeps them for the next run and does not call the model.
The prompt keeps each data block separate. The model writes to `WORKING-MEMORY.md.new`.
The worker adds the Git stamp to a copy and checks its size and section headings.
If the note checksum still matches, the worker puts the checked copy in place and records the successful refresh.
If the checksum differs, the worker keeps the current note and the batch.

The note has a limit of 8 KB (8,192 bytes), including the stamp.
If a note on disk exceeds the limit, SessionStart skips it. The next successful update replaces it.
SessionStart restores the note only from `WORKING-MEMORY.md`. It can show a refresh warning even when it skips the note.
For the header states and worker notices, see [Working Memory hooks](reference/hooks.md#working-memory).

Use one worktree for each parallel session. All sessions in the same worktree share one note and one memory queue.
If two sessions write the note, in one batch or in separate batches, the note header says it holds more than one session.
The header shows this advice for four hours after the last batch that mixes sessions.

## Enable / Disable

A standard re-init keeps the recorded choice. Devflow records memory as on for an existing install with no memory setting.
`devflow init --reset` restores the off default. Use `--memory` to turn it on at init.

```bash
npx devflow-kit init --memory          # Enable during install
npx devflow-kit init --no-memory       # Disable during install
devflow memory --enable                # Toggle on
devflow memory --disable               # Toggle off
devflow memory --status                # Check current state
```

**Paused memory.** While git tracks a file in `.devflow/memory/` of the checkout, or a `.git` entry stands and git does not answer, devflow reads and writes no file there. Memory is paused for that checkout. On startup, resume and `/clear`, session start shows one notice. To find the tracked files, run `git ls-files .devflow`. To untrack a file, run `git rm --cached <file>` in the checkout. Each session start asks git again, so memory resumes when git tracks no file there. For the full rules, see the paused memory folder paragraph in the Working Memory section of `docs/reference/hooks.md`.

## File Structure

```
.devflow/
├── memory/
│   ├── WORKING-MEMORY.md              # Current note (8,192 bytes max)
│   │                                 # Line 1: Git stamp, with an optional multi-session mark
│   ├── WORKING-MEMORY.md.new          # Model output (temporary)
│   ├── .WORKING-MEMORY.md.swap        # Copy for the stamp and format checks (temporary)
│   ├── backup.json                    # Git state before compaction
│   ├── .pending-turns.jsonl           # Queue of turns and answered questions (JSONL)
│   ├── .pending-turns.processing     # Batch the worker claims from the queue
│   ├── .working-memory-last-trigger  # Worker throttle (120 seconds)
│   └── .last-refresh-ok               # Time of the last successful update
└── curation/
    ├── decisions.md              # Architectural decisions (ADR-NNN), rendered from the curation ledger
    ├── pitfalls.md               # Known pitfalls (PF-NNN, area-specific gotchas), rendered from the curation ledger
    └── index.md                  # Compact index of the active entries, read by workflow commands
```

Curation uses a separate queue at `.devflow/curation/.pending-turns.jsonl`. When work is pending, `session-start-context` asks the main model to start the Curate agent. See the [Curation Pipeline](reference/hooks.md#curation-pipeline).

Debug logs are stored at `~/.devflow/logs/{project-slug}/`, capped at the 200 most recently written project folders.

## Working Memory Sections

`WORKING-MEMORY.md` has two level-two sections:

| Section | Purpose |
|---------|---------|
| `## Now` | Current task and next steps |
| `## Progress` | Completed work, work that remains, and problems that stop work |

## Long-term Knowledge

Beyond session memory, Devflow persists architectural decisions and known pitfalls:

- **`decisions.md`** — ADR-numbered entries. Review agents check if changes violate prior decisions.
- **`pitfalls.md`** — PF-numbered entries scoped by area. Review agents check if changes reintroduce known pitfalls.

Both files are generated from the local curation ledger and never edited by hand. The Curate agent rewrites an entry in place when its lesson sharpens, and the store keeps its prior wording in `.devflow/curation/decisions-history.jsonl`; a retired entry leaves the rendered body and is listed, with its number, in the file's Inactive table.

These files are read by Review agents automatically during `/code-review`.

## Documentation Structure

Devflow creates project documentation in `.devflow/docs/`:

```
.devflow/docs/
├── reviews/{branch-slug}/              # Review reports per branch
│   └── {timestamp}/                   # Timestamped review directory
│       ├── {focus}.md                 # Review agent reports
│       ├── review-summary.md          # Synthesize agent output
│       └── resolution-summary.md      # Written by /resolve
└── design/                            # Implementation plans
```

The incremental head markers are not part of this tree. `/code-review` and `/bug-analysis` keep each marker under the git directory of the worktree, at `<git dir>/devflow/reviews/{branch-slug}/.last-review-head` and `<git dir>/devflow/bug-analysis/{branch-slug}/.last-analysis-head`. `<git dir>` is the path that `git rev-parse --absolute-git-dir` prints, so each worktree has its own markers.
