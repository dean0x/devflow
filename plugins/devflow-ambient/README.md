# devflow-ambient

Ambient mode — orchestrator charter + plan handoff. Two presence-gated hooks make every git-repo session an orchestrator session: a `~200-token` charter injected at session start and a per-prompt reminder that steers the main model to delegate work to agents and devflow workflows. Plan-mode handoffs (`Implement the following plan:`) auto-run `devflow:implement`.

## Activation

```bash
devflow ambient --enable    # Register orchestrator hooks
devflow ambient --disable   # Remove hooks
devflow ambient --status    # Check if enabled
```

## How It Works

Ambient mode registers two hooks, both controlled by the same toggle. Both are silent outside git repos.

### Session charter (SessionStart)

`session-start-orchestrator` injects the orchestrator charter as `additionalContext` at every session start (startup, `/clear`, resume, compact). The charter:

- Establishes the main session as a pure orchestrator
- Grades sub-agents by complexity: haiku (mechanical), sonnet (defined execution), opus (analysis/design/research)
- Lists devflow workflows for real-scale work: `devflow:implement`, `devflow:plan`, `devflow:research`, etc.
- Carries a plan-handoff fallback bullet in case `UserPromptSubmit` does not fire for the auto-injected new-session prompt

### Per-prompt dispatch (UserPromptSubmit)

`preamble` runs on every prompt with three behaviors:

1. **Plan-handoff fast-path** — if prompt begins `Implement the following plan:` (Claude Code's native plan-mode handoff prefix), injects a directive to immediately invoke `devflow:implement` with the full plan.
2. **Slash skip** — slash commands (`/...`) receive no output.
3. **Orchestrator reminder** — all other prompts get a 2-line reminder to coordinate rather than produce.

**Plan handoff example:**

```
Implement the following plan:

## Add rate limiting

1. Add middleware
2. Configure limits
3. Write tests
```

## Upgrade Note

After upgrading, run `devflow init` to register the new `session-start-orchestrator` hook. Existing installs with only the `preamble` hook are in partial state — `devflow ambient --enable` repairs it.

## Skills

The ambient plugin distributes shared skills used by commands.

- `review-methodology` — Review process patterns
- `security` — Security analysis patterns
- `architecture` — Architecture analysis patterns
- `patterns` — Implementation patterns
