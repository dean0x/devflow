# Self-Learning

Devflow detects repeated workflows and procedural knowledge across sessions and automatically creates slash commands and skills.

## How it works

A background agent runs on session end, batching every 3 sessions (5 at 15+ observations) to analyze transcripts for patterns. When a pattern is observed enough times (3 observations with 24h+ temporal spread), it creates an artifact:

- **Workflow patterns** become slash commands at `.claude/commands/self-learning/`
- **Procedural patterns** become skills at `.claude/skills/{slug}/`

Observations accumulate in `.memory/learning-log.jsonl` with confidence scores and temporal decay. Generated artifacts are never overwritten — you can edit or delete them freely.

## CLI Commands

```bash
npx devflow-kit learn --enable       # Register the learning SessionEnd hook
npx devflow-kit learn --disable      # Remove the learning hook
npx devflow-kit learn --status       # Show status and observation counts
npx devflow-kit learn --list         # Show all observations sorted by confidence
npx devflow-kit learn --configure    # Interactive config (model, throttle, daily cap, debug)
npx devflow-kit learn --clear        # Reset all observations
npx devflow-kit learn --purge        # Remove invalid/corrupted entries
```

## Configuration

Use `devflow learn --configure` for interactive setup, or edit `.memory/learning.json` directly:

| Setting | Default | Description |
|---------|---------|-------------|
| Model | `haiku` | Model for background analysis |
| Batch size | 3 sessions (5 at 15+ obs) | Sessions accumulated before analysis |
| Daily cap | 5 runs | Maximum learning runs per day |
| Debug | `false` | Enable verbose logging |

## Observation Lifecycle

1. **Accumulate** — Each session end appends the session ID to `.memory/.learning-session-count`
2. **Batch** — When count reaches threshold, session IDs are moved to `.learning-batch-ids`
3. **Analyze** — Background agent reads batch transcripts, extracts patterns
4. **Score** — Observations get confidence scores based on frequency and temporal spread
5. **Create** — When confidence threshold met (3 observations, 24h+ spread), artifact is generated
6. **Reinforce** — Existing observations are reinforced locally (no LLM) on each session end

## Files

| File | Purpose |
|------|---------|
| `.memory/learning-log.jsonl` | All observations (one JSON per line) |
| `.memory/learning.json` | Project-level configuration |
| `.memory/.learning-runs-today` | Daily run counter (date + count) |
| `.memory/.learning-session-count` | Session IDs pending batch |
| `.memory/.learning-batch-ids` | Session IDs for current batch |
| `.memory/.learning-notified-at` | Artifact notification marker |
| `~/.devflow/logs/{project-slug}/.learning-update.log` | Background agent log |
