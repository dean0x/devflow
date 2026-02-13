# Agent Design Guidelines

Agents should be lean, focused, and trust the system around them.

## Target Structure

Every agent should follow this template (~50-150 lines total):

```markdown
---
frontmatter (name, description, model, skills, hooks)
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

## Length Guidelines

| Agent Type | Target Lines | Examples |
|------------|-------------|----------|
| Utility | 50-80 | Skimmer, Simplifier, Validator |
| Worker | 80-120 | Coder, Reviewer, Git |
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

## Adding New Agents

### Shared Agents (used by multiple plugins)

1. Create agent in `shared/agents/new-agent.md`
2. Follow existing agent patterns (clear specialty, restricted tools, focused scope, specific output)
3. Add agent name to `agents` array in each plugin's `plugin.json` that needs it
4. Run `npm run build` to distribute
5. Test with explicit invocation
6. Document in relevant plugin README.md files

### Plugin-Specific Agents (tightly coupled to one workflow)

1. Create agent directly in `plugins/devflow-{plugin}/agents/new-agent.md`
2. Do NOT add to `plugin.json` agents array (committed agents don't need distribution)
3. Test with explicit invocation
4. Document in plugin README.md

**Note:** Shared agents live in `shared/agents/` and are distributed at build time. Only create plugin-specific agents when tightly coupled to a single workflow (e.g., `claude-md-auditor.md`).
