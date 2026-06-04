# Self-Learning

Devflow detects patterns across sessions and automatically creates reusable artifacts — slash commands, skills, and project decisions entries.

## Observation Types

The system extracts **4 observation types** from session transcripts:

| Type | Source Channel | Artifact Target |
|------|---------------|----------------|
| **workflow** | USER_SIGNALS | `.claude/commands/self-learning/{slug}.md` |
| **procedural** | USER_SIGNALS | `.claude/skills/{slug}/SKILL.md` |
| **decision** | DIALOG_PAIRS | `.devflow/decisions/decisions.md` (ADR entry) |
| **pitfall** | DIALOG_PAIRS | `.devflow/decisions/pitfalls.md` (PF entry) |

## Architecture

### Ingestion: Channel-Based Filtering

Transcripts are split into two channels by `scripts/hooks/lib/transcript-filter.cjs`:

- **USER_SIGNALS** — Plain user messages (no prior context). Feeds workflow and procedural detection. These reflect what you explicitly asked for.
- **DIALOG_PAIRS** — Each prior-assistant turn paired with the following user message. Feeds decision and pitfall detection. These capture rationale confirmed or challenged by the user.

### Detection: LLM-Driven Extraction at SessionStart

All detection, semantic matching, and promotion decisions are made by the **Dream agent** — a background LLM agent spawned at SessionStart via `Agent(subagent_type="Dream", run_in_background:true)`. It is a real agent defined at `shared/agents/dream.md` (not a skill).

The Dream agent receives USER_SIGNALS and DIALOG_PAIRS from the pending dream markers and uses LLM judgment to extract observations, deduplicate semantically (reusing `obs_id` when a pattern matches an existing observation), and decide whether an observation warrants materialization. There are no deterministic thresholds, confidence formulas, or promotion rules in code — all judgment is LLM-authored.

### SessionEnd: Marker Writing (Plumbing Only)

`dream-evaluate` (SessionEnd hook) is plumbing: it runs per-type evaluation modules that decide whether a marker is worth writing, then write it atomically.

- **`eval-learning`** — Accumulates session IDs. When the batch threshold is reached (default 3 sessions, 5 at 15+ observations), writes `learning.{session_id}.json` in `.devflow/dream/`.
- **`eval-decisions`** — Runs every session. Extracts DIALOG_PAIRS from the transcript and writes `decisions.{session_id}.json` in `.devflow/dream/`.
- **`eval-knowledge`** — Writes knowledge markers when staleness is detected.
- **`eval-curation`** — Throttled to once per 7 days; writes a curation marker when triggered.

### Merge: Dream Agent Writes via Plumbing Ops

When the Dream agent materializes an observation, it calls atomic plumbing operations:

- **`merge-observation`** — Id-keyed reinforcement into `.devflow/learning/learning-log.jsonl`. Lock acquired externally by the Dream agent via `.reinforce.lock` before the call.
- **`decisions-append`** — Appends a new ADR-NNN or PF-NNN entry to `decisions.md` / `pitfalls.md`. Internally self-acquires `.decisions.lock`, assigns the next sequential number, writes the TL;DR and `- **Source**:` marker. The Dream agent must NOT hold `.decisions.lock` when calling this op.

Observations accumulate in `.devflow/learning/learning-log.jsonl` (workflow/procedural) and `.devflow/decisions/decisions-log.jsonl` (decision/pitfall). Lifecycle: `observing → created → deprecated`.

### Curation

The Dream agent handles curation in the same background pass when a curation marker is present. It deprecates (never deletes) stale or low-value entries, updates `- **Status**: Deprecated` in place, and re-points citations. Maximum 5 changes per run; 7-day protection window for recently created entries.

## Decisions Index + On-Demand Read Pattern

Decisions consumers (slash commands) do not fan the full ADR/PF corpus to spawned agents. Instead they use a two-step pattern:

### Step 1: Load compact index at orchestrator

```bash
DECISIONS_CONTEXT=$(node scripts/hooks/lib/decisions-index.cjs index "{worktree}")
```

This produces a compact index listing each active entry's ID, truncated title, status, and area:

```
Decisions (2):
  ADR-001  Use Result types instead of thrown errors  [Active]
  ...

Pitfalls (3):
  PF-004  Background hook scripts become god scripts  [Active]  —  scripts/hooks/
  ...

ADR-NNN entries live in /path/to/project/.devflow/decisions/decisions.md
PF-NNN  entries live in /path/to/project/.devflow/decisions/pitfalls.md
Read the relevant file and locate the matching `## ADR-NNN:` or `## PF-NNN:` heading for the full body.
```

> **Note**: Pre-v2 seeded entries may show `[unknown]` instead of `[Active]` if they predate the standard `- **Status**: Active` line format. New entries created by the Dream agent always include the status line.

### Step 2: Agent reads full body on demand

Agents that receive `DECISIONS_CONTEXT` follow the `devflow:apply-decisions` skill algorithm:

1. Scan the index and identify plausibly-relevant entries for the current task
2. Use `Read` on the decisions file and locate the matching `## ADR-NNN:` or `## PF-NNN:` heading
3. Read the full entry body
4. Cite `applies ADR-NNN` / `avoids PF-NNN` inline — verbatim IDs only, no fabrication

### Commands using this pattern

| Command | Agents that consume |
|---------|---------------------|
| `/resolve` | Resolver |
| `/plan` | Designer, Explore |
| `/self-review` | Simplifier, Scrutinizer |
| `/code-review` | Reviewer |
| `/debug` | Orchestrator-local (not fanned to Explore) |

## CLI Commands

```bash
npx devflow-kit learn --enable                  # Register the learning SessionEnd hook
npx devflow-kit learn --disable                 # Remove the learning hook
npx devflow-kit learn --status                  # Show status and observation counts
npx devflow-kit learn --list                    # Show all observations sorted by type
npx devflow-kit learn --configure               # Interactive config (model, throttle, daily cap, debug)
npx devflow-kit learn --clear                   # Reset all observations
```

Two one-time migrations run automatically on `devflow init` to remove pre-v2 seeded decisions entries — no CLI flag needed. Migration state is tracked at `~/.devflow/migrations.json`.

**v2 migration (`purge-legacy-knowledge-v2`)**: Removes 4 hardcoded low-signal IDs (ADR-002, PF-001, PF-003, PF-005) and the orphan `PROJECT-PATTERNS.md` file seeded by earlier devflow versions.

**v3 migration (`purge-legacy-knowledge-v3`)**: Sweeps all remaining pre-v2 seeded entries using a format discriminator. Any ADR/PF section in `decisions.md` or `pitfalls.md` that lacks the line `- **Source**: self-learning:` is treated as pre-v2 seeded content and removed. Self-learning-generated entries all carry this marker, so they are preserved. User-edited entries survive too — add the `- **Source**: self-learning:manual_xxx` line to any entry you want to keep through future migrations.

**v4 migration (`purge-orphaned-sidecar-judgment-state`)**: Removes orphaned `.learning-manifest.json`, `.decisions-manifest.json`, and `.decisions-notifications.json` — judgment-state files written by the now-removed deterministic render/reconcile layer. Preserves `.decisions-usage.json` (still written by the `decisions-usage-scan.cjs` Stop hook).

## HUD Row

When promoted entries exist, the HUD displays counts of workflows, skills, decisions, and pitfalls.

## Configuration

Use `devflow learn --configure` for interactive setup, or edit `.devflow/learning/learning.json` directly:

| Setting | Default | Description |
|---------|---------|-------------|
| Model | `sonnet` | Model alias for the background Dream agent |
| Batch size | 3 sessions (5 at 15+ obs) | Sessions accumulated before writing a learning marker |
| Daily cap | 5 runs | Maximum learning marker writes per day |
| Debug | `false` | Enable verbose logging |

## Files

| File | Purpose |
|------|---------|
| `.devflow/learning/learning-log.jsonl` | All observations (one JSON per line) |
| `.devflow/learning/learning.json` | Project-level config (no `enabled` field — hook presence IS the toggle) |
| `.devflow/learning/.learning-runs-today` | Daily run counter (date + count) |
| `.devflow/learning/.learning-sessions` | Session IDs pending batch |
| `.devflow/learning/.learning-notified-at` | New artifact notification marker |
| `.devflow/decisions/decisions.md` | ADR entries (append-only, written by Dream agent via decisions-append) |
| `.devflow/decisions/pitfalls.md` | PF entries (append-only, written by Dream agent via decisions-append) |
| `.devflow/decisions/.decisions-usage.json` | Citation counts (written by decisions-usage-scan.cjs) |

## Key Design Decisions

- **D8**: Decisions writers removed from commands — agent-summaries at command-end were low-signal. Decisions now extracted directly from user transcripts by the Dream agent.
- **D9**: `decisions-format` SKILL is a format specification only. The actual writer is the Dream agent via `decisions-append`.
- **D13**: User edits to generated artifacts are authoritative.
- **D16**: Staleness detection is file-reference-based (grep for `.ts`, `.js`, `.py` paths). Function-level checks are not performed.
