# devflow-ambient

Ambient mode — keyword dispatch and plan auto-detection. A `UserPromptSubmit` hook detects first-word keywords (`implement`, `explore`, `research`, `debug`, `plan`) and invokes the matching workflow skill, or detects structured implementation plans (`## Goal` / `## Steps` / `## Files`) and invokes `devflow:implement` automatically.

## Activation

```bash
devflow ambient --enable    # Register ambient mode hook
devflow ambient --disable   # Remove hook
devflow ambient --status    # Check if enabled
```

## How It Works

The `preamble` UserPromptSubmit hook uses two coexisting detection paths. Both are controlled by the same `devflow ambient` toggle.

### Keyword detection

When a prompt's first word (case-insensitive) is one of `implement`, `explore`, `research`, `debug`, or `plan`:

- The prompt must have at least one word after the keyword (bare `plan` alone does nothing).
- The prompt must not end in `?` (questions are suppressed — "explore A or B?" produces no output).
- The model is told to briefly announce the invoked workflow, then invoke `devflow:<keyword>` via the Skill tool, passing the text after the keyword as the task input.

**Example triggers:**

```
implement the auth module
Explore the payments flow
RESEARCH caching options
debug: why the tests fail
plan a new feature
```

### Plan detection

When a prompt contains all three of `## Goal`, `## Steps`, and `## Files` (and the keyword path did not fire), the hook invokes `devflow:implement` to execute the plan.

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

### Command coverage

Auto-triggered by ambient mode: `implement`, `explore`, `research`, `debug`, `plan`.

Remaining commands require explicit slash commands: `/code-review`, `/resolve`, `/release`, `/self-review`, `/bug-analysis`.

Normal prompts produce zero overhead — the hook exits without output.

## Skills

The ambient plugin distributes shared skills used by commands.

- `review-methodology` — Review process patterns
- `security` — Security analysis patterns
- `architecture` — Architecture analysis patterns
- `patterns` — Implementation patterns
