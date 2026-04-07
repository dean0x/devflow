# Skills Architecture

This document covers the full skills system: templates, tier catalog, activation patterns, and creation guide.

## Tiered Skills System

Skills serve as shared knowledge libraries that agents reference via frontmatter. Three tiers eliminate duplication and ensure consistent behavior.

### Tier 1: Foundation Skills

Shared patterns used by multiple agents.

| Skill | Purpose | Used By |
|-------|---------|---------|
| `software-design` | Engineering patterns (Result types, DI, immutability, workaround labeling) | Coder, Scrutinizer, Resolver, Evaluator |
| `review-methodology` | 6-step review process, 3-category issue classification | Reviewer, Synthesizer |
| `quality-gates` | 9-pillar self-review framework | Scrutinizer |
| `docs-framework` | Documentation conventions (.docs/ structure, naming, templates) | Synthesizer |
| `git` | Git safety, atomic commits, PR descriptions, GitHub API patterns | Coder, Git, Resolver |
| `patterns` | CRUD, API endpoints, events, config, logging | Coder, Resolver |
| `agent-teams` | Agent Teams patterns for peer-to-peer collaboration, debate, consensus | /code-review, /implement, /debug |
| `router` | Intent classification and proportional skill loading for Devflow mode (unrestricted tools — orchestrator) | Ambient UserPromptSubmit hook |
| `knowledge-persistence` | Record/load architectural decisions and pitfalls to `.memory/knowledge/` | /implement, /code-review, /resolve, /debug, /plan, /self-review |
| `qa` | Scenario-based acceptance testing methodology, evidence collection | Tester |

### Tier 1b: Pattern Skills

Domain expertise for Reviewer agent focus areas. Loaded dynamically based on review focus parameter.

| Skill | Purpose | Reviewer Focus |
|-------|---------|----------------|
| `security` | Injection, auth, crypto, OWASP vulnerabilities | `security` |
| `architecture` | SOLID violations, coupling, layering, modularity | `architecture` |
| `performance` | Algorithms, N+1, memory, I/O, caching | `performance` |
| `complexity` | Cyclomatic complexity, readability, maintainability | `complexity` |
| `consistency` | Pattern violations, simplification, truncation | `consistency` |
| `testing` | Coverage, quality, brittle tests, mocking, test design | `testing` |
| `database` | Schema, queries, migrations, indexes | `database` |
| `documentation` | Docs quality, alignment, code-comment drift | `documentation` |
| `dependencies` | CVEs, versions, licenses, supply chain | `dependencies` |
| `regression` | Lost functionality, broken behavior, migrations | `regression` |

### Tier 2: Specialized Skills

Listed in Claude Code's skill catalog. May auto-invoke based on description matching, but primary activation is through agent frontmatter references.

| Skill | Purpose | Agent Refs |
|-------|---------|------------|
| `boundary-validation` | Boundary validation enforcement | Coder |
| `research` | Research-before-building enforcement for utility code | Coder |
| `test-driven-development` | RED-GREEN-REFACTOR cycle enforcement | Coder |

### Tier 3: Domain-Specific Skills

Language and framework patterns. Referenced by agents via frontmatter and conditionally activated by Reviewer.

| Skill | Purpose | Used When |
|-------|---------|-----------|
| `typescript` | Type safety, generics, utility types, type guards | TypeScript codebases |
| `react` | Components, hooks, state management, performance | React codebases |
| `accessibility` | Keyboard, ARIA, focus, color contrast | Frontend codebases |
| `ui-design` | Typography, color, spacing, visual design | Frontend codebases |
| `go` | Error handling, interfaces, concurrency, package design | Go codebases |
| `python` | Type hints, protocols, dataclasses, async patterns | Python codebases |
| `java` | Records, sealed classes, composition, modern Java | Java codebases |
| `rust` | Ownership, borrowing, error handling, type-driven design | Rust codebases |

## How Skills Activate

Skills activate through two guaranteed mechanisms:

1. **Agent frontmatter `skills:` field** — When an agent runs, all skills listed in its frontmatter are loaded into context. This is the primary activation path.
2. **Reviewer dynamic read** — The Reviewer agent reads the pattern skill file for its assigned focus area from a lookup table (e.g., `focus=testing` → `testing/SKILL.md`).

Skills with `user-invocable: false` also appear in Claude Code's skill catalog with their description. Claude MAY auto-invoke them based on description matching, but this is not guaranteed and should not be relied upon as the sole activation path.

The `activation: file-patterns` frontmatter is metadata for documentation purposes. Claude Code does not currently use glob patterns to trigger skills.

### Example: Agent Frontmatter

```yaml
---
name: Coder
skills: software-design, git, patterns, ...
---
```

All listed skills are loaded when the Coder agent is spawned.

## Skill File Template

Create in `shared/skills/skill-name/SKILL.md` (~120-150 lines):

```markdown
---
name: skill-name
description: "This skill should be used when..." with concrete trigger words (<180 chars)
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

## Description Rules

Skill descriptions appear in Claude Code's skill catalog and influence when Claude auto-invokes skills. Poorly written descriptions can cause Claude to treat the description itself as instructions, bypassing the actual SKILL.md flowchart.

**Format**: Descriptions MUST start with `"This skill should be used when..."`.

**Include**: Concrete trigger words -- tool names, error types, user phrases, file types, or review focus areas that signal when the skill is relevant.

**Never**: Describe the skill's internal process, steps, methodology, or output format in the description. That information belongs in the SKILL.md body, not the frontmatter.

### Examples

| Bad (process summary) | Good (trigger-only) |
|---|---|
| "Standard review methodology providing the 6-step process and 3-category issue classification used by all review agents." | "This skill should be used when performing a code review to apply the standard 6-step review process." |
| "Security vulnerability analysis patterns for code review. Detects injection flaws, authentication bypasses, insecure cryptography." | "This skill should be used when reviewing code for injection flaws, auth bypasses, or hardcoded secrets." |
| "Enforce RED-GREEN-REFACTOR cycle during implementation. Write failing tests before production code." | "This skill should be used when implementing new features, fixing bugs, or writing new code. Enforces RED-GREEN-REFACTOR." |

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
| `ui-design` | `**/*.tsx`, `**/*.jsx`, `**/*.css`, `**/*.scss` | `node_modules/**` |
| `go` | `**/*.go` | `vendor/**` |
| `python` | `**/*.py` | `venv/**`, `.venv/**`, `**/__pycache__/**` |
| `java` | `**/*.java` | `**/build/**`, `**/target/**` |
| `rust` | `**/*.rs` | `**/target/**` |
| `testing` | `**/*.test.*`, `**/*.spec.*`, `**/test/**` | `node_modules/**` |

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

