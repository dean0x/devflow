# devflow-ambient

Ambient mode — plan auto-detection. A `UserPromptSubmit` hook detects structured implementation plans and invokes the implement workflow automatically.

## Activation

```bash
devflow ambient --enable    # Register ambient mode hook
devflow ambient --disable   # Remove hook
devflow ambient --status    # Check if enabled
```

## How It Works

**Plan detection** — When a prompt contains `## Goal`, `## Steps`, and `## Files` sections, the preamble hook outputs a directive to invoke `devflow:implement` via the Skill tool.

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

The ambient plugin distributes shared skills used by commands. Plan detection triggers `/implement` automatically — other commands are invoked via explicit slash commands (e.g. `/devflow:debug`, `/devflow:code-review`).

- `review-methodology` — Review process patterns
- `security` — Security analysis patterns
- `architecture` — Architecture analysis patterns
- `patterns` — Implementation patterns
