# devflow-ambient

Ambient mode — auto-classifies intent and applies proportional skill enforcement with optional agent orchestration.

## Command

### `/ambient`

Classify user intent and apply proportional enforcement to any prompt.

```bash
/ambient add a login form          # IMPLEMENT/GUIDED — skills + main session + Simplifier
/ambient refactor the auth system  # IMPLEMENT/ORCHESTRATED — Coder + quality gates
/ambient fix the auth error        # DEBUG/GUIDED — main session diagnoses + fixes
/ambient debug flaky test failures # DEBUG/ORCHESTRATED — parallel hypothesis investigation
/ambient how should we cache?      # PLAN/ORCHESTRATED — Skimmer + Explore + Plan agents
/ambient where is the config?      # EXPLORE/QUICK — responds normally, zero overhead
/ambient commit this               # QUICK — no overhead
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

1. **Classify intent** — IMPLEMENT, DEBUG, REVIEW, PLAN, EXPLORE, or CHAT
2. **Classify depth** — QUICK, GUIDED, or ORCHESTRATED (scope-based)
3. **Apply proportionally**:
   - QUICK: respond normally (zero overhead)
   - GUIDED: load skills, implement in main session, spawn Simplifier after code changes
   - ORCHESTRATED: load skills, orchestrate full agent pipeline

## Depth Tiers

| Depth | When | What Happens |
|-------|------|-------------|
| QUICK | Chat, exploration, git ops, config, trivial edits | Zero overhead — respond normally |
| GUIDED | Small-scope IMPLEMENT (≤2 files), clear DEBUG, focused PLAN, REVIEW | Load skills → main session works → Simplifier cleanup |
| ORCHESTRATED | Large-scope IMPLEMENT (>2 files), vague DEBUG, system-level PLAN | Load skills → spawn agent pipeline |

### Scope-Based Split

| Intent | GUIDED | ORCHESTRATED |
|--------|--------|-------------|
| IMPLEMENT | ≤2 files, single module | >2 files, multi-module |
| DEBUG | Clear error with stack trace/location | Vague/cross-cutting bug |
| PLAN | Focused design question | System-level architecture |
| REVIEW | Always GUIDED | — |

## Agent Orchestration (ORCHESTRATED only)

| Intent | Pipeline |
|--------|----------|
| IMPLEMENT | Pre-flight → Coder → Validator → Simplifier → Scrutinizer → Shepherd |
| DEBUG | Hypotheses → parallel Explores (max 8) → convergence → report → offer fix |
| PLAN | Skimmer → Explores → Plan agent → gap validation |

## Skills

- `ambient-router` — Intent + depth classification, skill selection matrix
- `test-driven-development` — TDD enforcement for IMPLEMENT (GUIDED + ORCHESTRATED)
