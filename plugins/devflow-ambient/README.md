# devflow-ambient

Ambient mode — plan auto-detection and command awareness. A `UserPromptSubmit` hook detects structured implementation plans and invokes the implement workflow. A commands rule provides passive command reference.

## Activation

```bash
devflow ambient --enable    # Register ambient mode hook and install commands rule
devflow ambient --disable   # Remove hook and commands rule
devflow ambient --status    # Check if enabled
```

## How It Works

1. **Plan detection** — When the first message contains `## Goal`, `## Steps`, and `## Files` sections, the preamble hook outputs a directive to invoke `devflow:implement` via the Skill tool
2. **Command awareness** — The `~/.claude/rules/devflow/commands.md` rule lists all available `/devflow:<name>` commands and documents the plan auto-execution trigger

Normal prompts produce zero overhead — the hook exits without output.

## Plan Handoff Format

A structured plan that triggers auto-execution:

```markdown
## Goal
Description of what to implement.

## Steps
1. First step
2. Second step

## Files
- path/to/file.ts
- path/to/test.ts
```

## Skills

- `implement:orch` — Agent pipeline for IMPLEMENT tasks
- `debug:orch` — Agent pipeline for DEBUG tasks
- `explore:orch` — Agent pipeline for EXPLORE tasks
- `plan:orch` — Agent pipeline for PLAN tasks
- `review:orch` — Agent pipeline for REVIEW tasks
- `resolve:orch` — Agent pipeline for RESOLVE tasks
- `research:orch` — Agent pipeline for RESEARCH tasks
- `release:orch` — Agent pipeline for RELEASE tasks
- `pipeline:orch` — End-to-end meta-orchestrator (implement → review → resolve)
