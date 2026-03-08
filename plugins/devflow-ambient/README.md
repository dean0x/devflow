# devflow-ambient

Ambient mode — auto-loads relevant skills based on each prompt, no explicit commands needed.

## Command

### `/ambient`

Classify user intent and apply proportional skill enforcement to any prompt.

```bash
/ambient add a login form          # BUILD/GUIDED — loads TDD + implementation-patterns
/ambient fix the auth error        # DEBUG/GUIDED — loads test-patterns + core-patterns
/ambient where is the config?      # EXPLORE/QUICK — responds normally, zero overhead
/ambient refactor the auth system  # BUILD/ELEVATE — suggests /implement
```

## Always-On Mode

Enable ambient classification on every prompt without typing `/ambient`:

```bash
devflow ambient --enable    # Register UserPromptSubmit hook
devflow ambient --disable   # Remove hook
devflow ambient --status    # Check if enabled
```

When enabled, a `UserPromptSubmit` hook injects a classification preamble before every prompt. Slash commands (`/implement`, `/code-review`, etc.) and short confirmations ("yes", "ok") are skipped automatically.

## How It Works

1. **Classify intent** — BUILD, DEBUG, REVIEW, PLAN, EXPLORE, or CHAT
2. **Classify depth** — QUICK (zero overhead), GUIDED (2-3 skills), or ELEVATE (workflow nudge)
3. **Apply proportionally**:
   - QUICK: respond normally
   - GUIDED: load relevant skills, enforce TDD for BUILD
   - ELEVATE: respond + recommend full workflow command

## Depth Tiers

| Depth | When | Overhead |
|-------|------|----------|
| QUICK | Chat, simple exploration, git/devops ops, single-word confirmations | ~0 tokens |
| GUIDED | BUILD/DEBUG/REVIEW/PLAN, 1-5 file scope | ~500-1000 tokens (skill reads) |
| ELEVATE | Multi-file, architectural, system-wide scope | ~0 extra tokens (nudge only) |

## Skills

- `ambient-router` — Intent + depth classification, skill selection matrix
