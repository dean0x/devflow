# devflow-ambient

Ambient mode — classifies intent and applies proportional effort via a `UserPromptSubmit` hook. No slash command — ambient mode activates automatically on every prompt when enabled.

## Activation

```bash
devflow ambient --enable    # Register UserPromptSubmit hook
devflow ambient --disable   # Remove hook
devflow ambient --status    # Check if enabled
```

When enabled, the hook injects a classification preamble before every prompt. Slash commands (`/implement`, `/code-review`, etc.) and short confirmations ("yes", "ok") are skipped automatically. Git operations (`commit`, `push`, `merge`, etc.) are fast-pathed to zero overhead.

## How It Works

1. **Classify intent** — IMPLEMENT, DEBUG, REVIEW, PLAN, EXPLORE, or CHAT
2. **Classify depth** — QUICK, GUIDED, or ORCHESTRATED (scope-based)
3. **Apply proportionally**:
   - QUICK: respond normally (zero overhead)
   - GUIDED: load skills, implement in main session, spawn Simplifier after code changes
   - ORCHESTRATED: load skills, orchestrate full agent pipeline

## Three-Tier Classification

| Depth | When | What Happens |
|-------|------|-------------|
| QUICK | Chat, exploration, git ops, config, trivial edits | Zero overhead — respond normally |
| GUIDED | Small-scope IMPLEMENT (≤2 files), clear DEBUG, focused PLAN, REVIEW | Load skills → main session works → Simplifier cleanup |
| ORCHESTRATED | Large-scope IMPLEMENT (>2 files), vague DEBUG, system-level PLAN | Load skills → spawn agent pipeline |

### Intent × Depth Matrix

| Intent | GUIDED | ORCHESTRATED |
|--------|--------|-------------|
| IMPLEMENT | ≤2 files, single module | >2 files, multi-module |
| DEBUG | Clear error with stack trace/location | Vague/cross-cutting bug |
| PLAN | Focused design question | System-level architecture |
| REVIEW | Always GUIDED | — |

## GUIDED Behavior

Skills are loaded via the Skill tool and work happens in the main session:

| Intent | Skills | Main Session Work | Post-Work |
|--------|--------|-------------------|-----------|
| IMPLEMENT | test-driven-development, implementation-patterns, search-first | Implement with TDD | `Task(subagent_type="Simplifier")` |
| DEBUG | core-patterns, test-patterns | Investigate, diagnose, fix | `Task(subagent_type="Simplifier")` |
| PLAN | implementation-patterns, core-patterns | Explore and design | — |
| REVIEW | self-review, core-patterns | Review directly | — |

## ORCHESTRATED Pipelines

| Intent | Pipeline |
|--------|----------|
| IMPLEMENT | Pre-flight → Coder → Validator → Simplifier → Scrutinizer → Shepherd |
| DEBUG | Hypotheses → parallel Explores → convergence → report → offer fix |
| PLAN | Skimmer → Explores → Plan agent → gap validation |

These are lightweight variants of `/implement`, `/debug`, and the Plan phase of `/implement` — focused on the immediate task without full lifecycle features (PR creation, knowledge persistence, retry loops).

## Skills

- `ambient-router` — Intent + depth classification, skill selection matrix
- `test-driven-development` — TDD enforcement for IMPLEMENT (GUIDED + ORCHESTRATED)
- `implementation-orchestration` — Agent pipeline for IMPLEMENT/ORCHESTRATED
- `debug-orchestration` — Agent pipeline for DEBUG/ORCHESTRATED
- `plan-orchestration` — Agent pipeline for PLAN/ORCHESTRATED
