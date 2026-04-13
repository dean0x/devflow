# Self-Learning

Devflow detects patterns across sessions and automatically creates reusable artifacts — slash commands, skills, and project knowledge entries.

## Observation Types

The system extracts **4 observation types** from session transcripts:

| Type | Source Channel | Artifact Target |
|------|---------------|----------------|
| **workflow** | USER_SIGNALS | `.claude/commands/self-learning/{slug}.md` |
| **procedural** | USER_SIGNALS | `.claude/skills/{slug}/SKILL.md` |
| **decision** | DIALOG_PAIRS | `.memory/knowledge/decisions.md` (ADR entry) |
| **pitfall** | DIALOG_PAIRS | `.memory/knowledge/pitfalls.md` (PF entry) |

## Architecture

### Ingestion: Channel-Based Filtering

Transcripts are split into two channels by `scripts/hooks/lib/transcript-filter.cjs`:

- **USER_SIGNALS** — Plain user messages (no prior context). Feeds workflow and procedural detection. These reflect what you explicitly asked for.
- **DIALOG_PAIRS** — Each prior-assistant turn paired with the following user message. Feeds decision and pitfall detection. These capture rationale confirmed or challenged by the user.

### Detection: Per-Type Extraction

The background `claude -p --model sonnet` agent receives separate USER_SIGNALS and DIALOG_PAIRS blocks and uses per-type linguistic markers to extract observations. Each observation includes a `quality_ok` boolean set by the LLM based on quality gates (specificity, actionability, scope).

### Merge: Per-Type Thresholds + Status Machine

Observations accumulate in `.memory/learning-log.jsonl` (JSONL, one entry per line). Each observation tracks:

- `confidence` — computed as `min(floor(count * 100 / required), 95) / 100` (per-type required count)
- `status` — `observing → ready → created → deprecated`
- `quality_ok` — required for promotion to `ready`
- `first_seen` / `last_seen` — used for temporal spread check

Per-type thresholds (in `json-helper.cjs THRESHOLDS`):

| Type | Required count | Spread | Promote threshold |
|------|---------------|--------|-------------------|
| workflow | 3 | 3 days | 0.60 |
| procedural | 4 | 5 days | 0.70 |
| decision | 2 | 0 days (no spread) | 0.65 |
| pitfall | 2 | 0 days (no spread) | 0.65 |

An observation promotes to `ready` when: `quality_ok === true` AND `confidence >= promote` AND `daySpread >= spread`.

Confidence is computed as `min(floor(count × 100 / required), 95) / 100`. For workflow (promote=0.60, required=3) this means promotion at count=2 (0.66 ≥ 0.60); for procedural (promote=0.70, required=4) at count=3 (0.75 ≥ 0.70). The `promote` threshold is what the code actually evaluates — not a raw count comparison.

### Rendering: Deterministic 4-Target Dispatch

`json-helper.cjs render-ready <log> <baseDir>` reads the log, finds all `status: 'ready'` entries, and dispatches each to one of 4 render handlers:

- **workflow** → generates a slash command file with frontmatter and pattern body
- **procedural** → generates a skill SKILL.md with Iron Law and step sections
- **decision** → appends an ADR-NNN entry to `.memory/knowledge/decisions.md`
- **pitfall** → appends a PF-NNN entry to `.memory/knowledge/pitfalls.md` (deduped by normalized Area+Issue prefix)

All rendered artifacts are recorded in `.memory/.learning-manifest.json`:

```json
{
  "schemaVersion": 1,
  "entries": [
    {
      "observationId": "obs_abc123",
      "type": "workflow",
      "path": ".claude/commands/self-learning/my-workflow.md",
      "contentHash": "sha256...",
      "renderedAt": "2026-04-10T12:00:00Z"
    }
  ]
}
```

### Feedback: Session-Start Reconciler

On session start, `json-helper.cjs reconcile-manifest <cwd>` compares manifest entries against the filesystem:

- **File deleted** → applies 0.3× confidence penalty to the observation (signals unwanted artifact)
- **File edited** → ignored (per D13 — user edits are authoritative; don't fight them)
- **File present and unchanged** → counted in telemetry only (no confidence change)

This creates a feedback loop: deleting a generated artifact reduces its observation's confidence, eventually causing it to stop promoting.

## CLI Commands

```bash
npx devflow-kit learn --enable                  # Register the learning SessionEnd hook
npx devflow-kit learn --disable                 # Remove the learning hook
npx devflow-kit learn --status                  # Show status and observation counts
npx devflow-kit learn --list                    # Show all observations sorted by confidence
npx devflow-kit learn --configure               # Interactive config (model, throttle, daily cap, debug)
npx devflow-kit learn --clear                   # Reset all observations
npx devflow-kit learn --purge                   # Remove invalid/corrupted entries
npx devflow-kit learn --review                  # Inspect observations needing attention (stale, capped, low-quality)
```

Removal of pre-v2 low-signal knowledge entries (ADR-002, PF-001, PF-003, PF-005) and orphan `PROJECT-PATTERNS.md` now runs automatically as a one-time migration on `devflow init` — no CLI flag needed. Migration state is tracked at `~/.devflow/migrations.json`.

## HUD Row

When promoted entries exist, the HUD displays:

```
Learning: 2 workflows, 1 skills, 3 decisions, 1 pitfalls  ⚠ 1 need review
```

The `⚠ N need review` suffix appears when observations have `needsReview: true` (stale code refs, soft cap exceeded, or low confidence with many observations).

## Configuration

Use `devflow learn --configure` for interactive setup, or edit `.memory/learning.json` directly:

| Setting | Default | Description |
|---------|---------|-------------|
| Model | `sonnet` | Model for background extraction |
| Batch size | 3 sessions (5 at 15+ obs) | Sessions accumulated before analysis |
| Daily cap | 5 runs | Maximum learning runs per day |
| Debug | `false` | Enable verbose logging |

## Files

| File | Purpose |
|------|---------|
| `.memory/learning-log.jsonl` | All observations (one JSON per line) |
| `.memory/.learning-manifest.json` | Rendered artifact registry for feedback reconciliation |
| `.memory/learning.json` | Project-level config (no `enabled` field — hook presence IS the toggle) |
| `.memory/.learning-runs-today` | Daily run counter (date + count) |
| `.memory/.learning-session-count` | Session IDs pending batch |
| `.memory/.learning-batch-ids` | Session IDs for current batch run |
| `.memory/.learning-notified-at` | New artifact notification marker |
| `.memory/knowledge/decisions.md` | ADR entries (append-only, written by render-ready) |
| `.memory/knowledge/pitfalls.md` | PF entries (append-only, written by render-ready) |
| `~/.devflow/logs/{project-slug}/.learning-update.log` | Background agent log |

## Key Design Decisions

- **D8**: Knowledge writers removed from commands — agent-summaries at command-end were low-signal. Knowledge now extracted directly from user transcripts.
- **D9**: `knowledge-persistence` SKILL is a format specification only. The actual writer is `scripts/hooks/background-learning` via `json-helper.cjs render-ready`.
- **D13**: User edits to generated artifacts are ignored by the reconciler — your edits are authoritative.
- **D15**: Soft cap + HUD attention counter instead of auto-pruning. Human judgment is required for deprecation.
- **D16**: Staleness detection is file-reference-based (grep for `.ts`, `.js`, `.py` paths). Function-level checks are not performed.
