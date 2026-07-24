# Agent Design Guidelines

Agents should be lean, focused, and trust the system around them.

## Target Structure

Every agent should follow this template (~50-150 lines total):

```markdown
---
frontmatter (name, description, model, skills, hooks, tools)
---

# Agent Name

[Identity paragraph - 2-4 sentences describing role and autonomy level]

## Input Context
[What the orchestrator passes: structured list of parameters]

## Responsibilities
[5-7 numbered items: what this agent does]

## Principles
[4-6 focused principles guiding behavior]

## Output
[Simple structured report format]

## Boundaries
[What to escalate vs handle autonomously]
```

## Tool Restrictions

Use the `tools` frontmatter field to restrict which tools an agent can access. Claude Code enforces this at platform level — the agent physically cannot call tools outside the allowlist. This is far more reliable than prompt-level prohibitions.

```markdown
---
name: Skimmer
tools: ["Bash", "Read"]
---
```

When an agent only needs a subset of tools, prefer platform-enforced restriction over prompt instructions. Only omit `tools` when the agent genuinely needs full tool access.

## Length Guidelines

| Agent Type | Target Lines | Examples |
|------------|-------------|----------|
| Utility | 50-80 | Skimmer, Simplifier, Validator |
| Worker | 80-120 | Coder, Reviewer, Git, Designer |
| Orchestration | 100-150 | (Commands handle orchestration, not agents) |

## What Belongs Where

| Content | Location | Rationale |
|---------|----------|-----------|
| Engineering patterns (Result types, DI) | Skills | Shared across agents |
| Git safety, commit conventions | Skills | Consistent enforcement |
| Review methodology | Skills | Reusable across review types |
| Branch setup | Orchestrator | Agent receives ready feature branch |
| Codebase exploration | Explore agents | Dedicated agents do exploration |
| Implementation planning | Plan agents | Dedicated agents do planning |
| Task identity + responsibilities | Agent | Core agent definition |
| Input/output contract | Agent | Interface with orchestrator |
| Escalation boundaries | Agent | Clear handoff points |

## Anti-Patterns to Avoid

1. **Duplicating skill content** - Don't re-document what skills provide. Reference skills via frontmatter.
2. **Embedding bash scripts** - Agents know how to code. Don't over-specify implementation details.
3. **Re-doing orchestrator work** - If orchestrator creates feature branch, agent shouldn't document branch creation.
4. **Verbose phase documentation** - A worker agent implements; it doesn't need exploration and planning phases.
5. **Progress tracking templates** - Trust the agent to log appropriately without detailed echo scripts.
6. **Listing auto-activating skills** - Skills auto-activate based on context; no need to enumerate triggers.
7. **Skill-invoking a frontmatter-preloaded skill** - Any skill in the agent's `skills:` frontmatter is already active. A body instruction to invoke that same skill via `Skill(skill="devflow:<name>")` hits the re-entrancy guard and returns `devflow:<name> already running`. The agent treats this guard string as a terminal instruction and returns with zero tool uses while the workflow reports success — a silent complete-failure. Symptom: agent finishes in under 5 seconds with no tool calls. Fix: remove the `Skill(...)` call for any skill already in the frontmatter. (See `skills-architecture.md` § "Frontmatter preload and Skill-tool invocation are mutually exclusive".)

## Quality Checklist

Before committing a new or modified agent:

- [ ] Under 150 lines (ideally under 120)
- [ ] Single identity paragraph (not multiple paragraphs of context)
- [ ] Input contract clearly defined
- [ ] Output format simple and structured
- [ ] Boundaries section present (escalate vs handle)
- [ ] No duplicated skill content
- [ ] No bash script templates
- [ ] Skills referenced in frontmatter, not re-documented in body

## Per-Agent Model Overrides

Devflow ships with explicit model assignments in agent frontmatter (Opus for analysis, Sonnet for execution, Haiku for I/O). You can override these per-agent without touching the source files — overrides persist across `devflow init` reinstalls.

**Source of truth:** `~/.devflow/agent-models.json` stores deviations from shipped defaults (absent entry = shipped default; `"model": "default"` removes the key).

**Management:**
```bash
npx devflow-kit agents               # Interactive TUI — navigate, cycle model, save
npx devflow-kit agents --list        # Print all agents with current assignments
npx devflow-kit agents --set reviewer --model gpt-5.5   # Assign one agent via CLI
npx devflow-kit agents --reset                          # Reset all agents to shipped defaults (prompts)
npx devflow-kit agents --reset --yes                    # Skip confirmation prompt
```

**Convergence:** `reapplyAgentMapping` runs after every `devflow init` (post-install). It reads `agent-models.json` and rewrites the matching agent frontmatter so your assignments survive reinstalls and plugin updates.

**Dormancy:** GPT model assignments are dormant when external model routing is disabled. The TUI shows dormant assignments with a dim annotation (`gpt-5.5 saved`). Enabling routing via `devflow proxy --enable` applies the saved mapping; disabling reverts frontmatter to Claude defaults while preserving the mapping for re-enable.

**When adding a new agent:** the shipped model in frontmatter is the default; if users have overridden it via `agent-models.json`, `reapplyAgentMapping` will apply their override on the next `devflow init`.

## Adding New Agents

### Shared Agents (used by multiple plugins)

1. Create agent in `src/assets/agents/new-agent.md`
2. Follow existing agent patterns (clear specialty, restricted tools, focused scope, specific output)
3. Add agent name to the `agents` array of each plugin entry in DEVFLOW_PLUGINS (`src/core/plugins.ts`) that needs it
4. Run `node dist/cli.js init` to install (no build step required for agents)
5. Test with explicit invocation

### Plugin-Specific Agents (tightly coupled to one workflow)

All agents live in `src/assets/agents/` — there is no separate per-plugin agent directory. For an agent used by only one plugin, add it to `src/assets/agents/` and declare it in only that plugin's `agents` array in DEVFLOW_PLUGINS.

**Note:** `src/assets/agents/` is the single source of truth for all agents (e.g., `git.md`, `coder.md`, `designer.md`, `claude-md-auditor.md`). No build step distributes agents — they install directly at `node dist/cli.js init` time.
