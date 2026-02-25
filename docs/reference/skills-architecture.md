# Skills Architecture

This document covers the full skills system: templates, tier catalog, activation patterns, and creation guide.

## Tiered Skills System

Skills serve as shared knowledge libraries that agents reference via frontmatter. Three tiers eliminate duplication and ensure consistent behavior.

### Tier 1: Foundation Skills

Shared patterns used by multiple agents.

| Skill | Purpose | Used By |
|-------|---------|---------|
| `core-patterns` | Engineering patterns (Result types, DI, immutability, workaround labeling) | Coder, Scrutinizer, Resolver, Shepherd |
| `review-methodology` | 6-step review process, 3-category issue classification | Reviewer, Synthesizer |
| `self-review` | 9-pillar self-review framework | Scrutinizer |
| `docs-framework` | Documentation conventions (.docs/ structure, naming, templates) | Synthesizer |
| `git-safety` | Git operations, lock handling, sequential ops | Coder, Git, Resolver |
| `git-workflow` | Atomic commits, message format, PR descriptions, size assessment | Coder, Git, Resolver |
| `github-patterns` | GitHub API patterns (rate limiting, PR comments, issues, releases) | Git |
| `implementation-patterns` | CRUD, API endpoints, events, config, logging | Coder, Resolver |
| `agent-teams` | Agent Teams patterns for peer-to-peer collaboration, debate, consensus | /code-review, /implement, /debug |

### Tier 1b: Pattern Skills

Domain expertise for Reviewer agent focus areas. Loaded dynamically based on review focus parameter.

| Skill | Purpose | Reviewer Focus |
|-------|---------|----------------|
| `security-patterns` | Injection, auth, crypto, OWASP vulnerabilities | `security` |
| `architecture-patterns` | SOLID violations, coupling, layering, modularity | `architecture` |
| `performance-patterns` | Algorithms, N+1, memory, I/O, caching | `performance` |
| `complexity-patterns` | Cyclomatic complexity, readability, maintainability | `complexity` |
| `consistency-patterns` | Pattern violations, simplification, truncation | `consistency` |
| `test-patterns` | Coverage, quality, brittle tests, mocking, test design | `tests` |
| `database-patterns` | Schema, queries, migrations, indexes | `database` |
| `documentation-patterns` | Docs quality, alignment, code-comment drift | `documentation` |
| `dependencies-patterns` | CVEs, versions, licenses, supply chain | `dependencies` |
| `regression-patterns` | Lost functionality, broken behavior, migrations | `regression` |

### Tier 2: Specialized Skills

Listed in Claude Code's skill catalog. May auto-invoke based on description matching, but primary activation is through agent frontmatter references.

| Skill | Purpose | Agent Refs |
|-------|---------|------------|
| `input-validation` | Boundary validation enforcement | Coder |

### Tier 3: Domain-Specific Skills

Language and framework patterns. Referenced by agents via frontmatter and conditionally activated by Reviewer.

| Skill | Purpose | Used When |
|-------|---------|-----------|
| `typescript` | Type safety, generics, utility types, type guards | TypeScript codebases |
| `react` | Components, hooks, state management, performance | React codebases |
| `accessibility` | Keyboard, ARIA, focus, color contrast | Frontend codebases |
| `frontend-design` | Typography, color, spacing, visual design | Frontend codebases |

## How Skills Activate

Skills activate through two guaranteed mechanisms:

1. **Agent frontmatter `skills:` field** — When an agent runs, all skills listed in its frontmatter are loaded into context. This is the primary activation path.
2. **Reviewer dynamic read** — The Reviewer agent reads the pattern skill file for its assigned focus area from a lookup table (e.g., `focus=tests` → `test-patterns/SKILL.md`).

Skills with `user-invocable: false` also appear in Claude Code's skill catalog with their description. Claude MAY auto-invoke them based on description matching, but this is not guaranteed and should not be relied upon as the sole activation path.

The `activation: file-patterns` frontmatter is metadata for documentation purposes. Claude Code does not currently use glob patterns to trigger skills.

### Example: Agent Frontmatter

```yaml
---
name: Coder
skills: core-patterns, git-safety, implementation-patterns, git-workflow, ...
---
```

All listed skills are loaded when the Coder agent is spawned.

## Skill File Template

Create in `shared/skills/skill-name/SKILL.md` (~120-150 lines):

```markdown
---
name: skill-name
description: Brief description with trigger phrases (<180 chars)
user-invocable: false
allowed-tools: Read, Grep, Glob, AskUserQuestion
activation:
  file-patterns:
    - "**/*.tsx"
    - "**/*.jsx"
  exclude:
    - "node_modules/**"
    - "**/*.test.*"
---

# Skill Name

## Iron Law

> **[PRINCIPLE NAME]**
>
> [Non-negotiable core principle]

## When This Skill Activates

- Trigger condition 1
- Trigger condition 2

## Pattern Categories

### Category 1
Brief description, 1-2 inline examples

### Category 2
Brief description, 1-2 inline examples

---

## Extended References

For additional examples and detection patterns:
- `references/violations.md` - Extended violation examples
- `references/patterns.md` - Extended correct patterns

---

## Success Criteria

- [ ] Checklist item 1
- [ ] Checklist item 2
```

## Progressive Disclosure Structure

```
skill-name/
├── SKILL.md              # Essential content (~120-150 lines)
└── references/           # Extended material (loaded on demand)
    ├── violations.md     # Extended code violations
    ├── patterns.md       # Extended correct patterns
    ├── detection.md      # Grep/regex patterns for finding issues
    └── [topic].md        # Additional topic-specific references
```

**What stays in SKILL.md** (always loaded):
- Frontmatter (name, description, allowed-tools, activation)
- Iron Law (non-negotiable principle)
- When This Activates (trigger conditions)
- Core categories with brief descriptions
- 1-2 representative examples per category
- Severity guidelines table
- Pointer to references/

**What goes in references/** (loaded on demand):
- Extended code violations beyond first 1-2 per category
- Extended correct patterns
- Language-specific variations
- Detection grep/regex patterns
- Full report templates, checklists, edge cases

**Target metrics**: SKILL.md ~120-150 lines, code examples 15-25% of content, ~5KB token cost per activation.

## Glob Pattern Activation Schema

Skills can declare file patterns for context-aware activation:

```yaml
activation:
  file-patterns:
    - "**/*.tsx"
  exclude:
    - "node_modules/**"
```

| Skill | file-patterns | exclude |
|-------|---------------|---------|
| `react` | `**/*.tsx`, `**/*.jsx` | `node_modules/**`, `**/*.test.*` |
| `typescript` | `**/*.ts`, `**/*.tsx` | `node_modules/**`, `**/*.d.ts` |
| `accessibility` | `**/*.tsx`, `**/*.jsx`, `**/*.css` | `node_modules/**` |
| `frontend-design` | `**/*.tsx`, `**/*.jsx`, `**/*.css`, `**/*.scss` | `node_modules/**` |
| `test-patterns` | `**/*.test.*`, `**/*.spec.*`, `**/test/**` | `node_modules/**` |

**Note:** Glob patterns are metadata hints for documentation. Claude Code does not currently read glob patterns to trigger skills — activation happens through agent frontmatter and Reviewer dynamic read (see "How Skills Activate" above).

## Skill vs Command Decision

**Use a Skill when:**
- Should activate automatically based on context
- Enforces patterns/quality (proactive)
- Detects violations during implementation
- Read-only analysis and reporting

**Use a Command when:**
- Requires explicit user decision
- Performs state changes (commits, releases)
- User controls timing and sequencing
- Orchestrates complex workflows

## Creating New Skills

All skills live in `shared/skills/` (single source of truth). Copied to plugins at build time.

### Foundation Skill (Tier 1)

If multiple agents need the same knowledge:
1. Create in `shared/skills/{name}/SKILL.md`
2. Create `references/` subdirectory with extended examples
3. Document which agents should use it
4. Add skill name to `skills` array in relevant `plugins/devflow-*/plugin.json` files
5. Run `npm run build` to distribute

### Specialized Skill (Tier 2)

If user-facing with context triggers:
1. Create in `shared/skills/{name}/SKILL.md`
2. Create `references/` subdirectory
3. Focus on clear trigger conditions in description
4. Add to `plugins/devflow-core-skills/plugin.json` skills array
5. Run `npm run build` to distribute
6. Test auto-activation in various contexts

### Domain-Specific Skill (Tier 3)

For language/framework patterns:
1. Create in `shared/skills/{language|framework}/SKILL.md`
2. Create `references/` subdirectory
3. Focus on idioms, patterns, and best practices
4. Add to relevant plugin manifests
5. Run `npm run build` to distribute

## Clarification Gates

The `/specify` command uses **mandatory clarification gates**:

1. **Gate 0 (Before Exploration)**: Confirm understanding of feature idea
2. **Gate 1 (After Exploration)**: Validate scope and priorities
3. **Gate 2 (Before Issue Creation)**: Confirm acceptance criteria

No gate may be skipped. If user says "whatever you think", state recommendation and get explicit approval.
