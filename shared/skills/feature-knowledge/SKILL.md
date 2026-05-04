---
name: feature-knowledge
description: Structures codebase exploration into a feature knowledge base
user-invocable: false
allowed-tools:
  - Read
  - Grep
  - Glob
  - Write
---

# Feature Knowledge Base Creation

## Iron Law

> **Capture the institutional knowledge that lives in developers' heads — the things
> obvious to them but invisible to newcomers.**
>
> A KB exists to save the NEXT agent from rediscovering patterns that span multiple files,
> modules, or layers. If it's obvious from a single file read, don't capture it.

---

## The Four Phases

Follow these four phases in order. Do not skip ahead.

### Phase 1: Scan

Map the landscape. Get a high-level understanding before going deep.

- Use `Glob` to discover directory structure and file organization
- Identify language(s), framework(s), and major dependencies
- Locate key entry points, configuration files, and existing documentation
- Note how the code is organized — monorepo, modules, layers, etc.

**Goal**: Answer "Where does the code related to this area live, and how is it structured?"

### Phase 2: Extract

Go deep. Read the actual code and pull out the real patterns.

- Read key files using `Read`
- Use `Grep` to find recurring patterns across the codebase
- Trace data flow: how does information move through the system?
- Identify naming conventions, structural patterns, error handling approaches
- Look for implicit rules — things the team clearly follows but never wrote down
- Pay attention to what's consistent (conventions) vs. what varies (knowledge gaps)
- Look at how similar things are implemented — find ALL instances and see what they share

**For complex domains, go further:**
- Map core entities and their relationships
- Identify decision points — where does business logic branch?
- Extract implicit knowledge — what's obvious to current developers but invisible to newcomers?
- Document state transitions, business rules, and edge case handling

**Self-check before moving on:**
- "Am I understanding the full scope of what's being requested?"
- "What connections am I seeing that weren't obvious initially?"
- "Are there patterns I'm missing because I'm too focused on one area?"

### Phase 3: Distill

Organize and validate findings. Raw observations become structured knowledge.

**Choose a knowledge category:**

| The knowledge is about... | Category | Language Style |
|---|---|---|
| How the overall system is designed | `architecture` | Descriptive — explains what systems are and why they exist |
| Patterns followed across the whole project | `conventions` | Prescriptive — "Do this," "Avoid that" |
| How a specific type of component works | `component-patterns` | Prescriptive — enforces conventions |
| A specific business domain or module | `domain-knowledge` | Descriptive — builds mental models |
| Hard-won lessons from incidents or edge cases | `lessons-learned` | Narrative — tells the story of discovery |

**Validate each finding:**
- Is this specific to THIS codebase, or generic advice? (only keep specific)
- Does this reflect what the code actually does NOW, or is it speculative? (only keep current)
- Would a developer actually use this to build something? (only keep actionable)
- Is this obvious from reading one file, or does it require cross-cutting knowledge? (prefer cross-cutting)

### Phase 4: Forge

Write the knowledge file. Follow the output format exactly.

---

## Output Format

### KNOWLEDGE.md Structure

```markdown
---
feature: {slug}
name: {human-readable name}
description: "Use when [specific scenarios]. Keywords: [relevant terms]."
category: [architecture | conventions | component-patterns | domain-knowledge | lessons-learned]
directories: [{dir prefixes}]
referencedFiles: [{5-10 key files for staleness tracking}]
created: {ISO date}
updated: {ISO date}
---

# {Feature Area Name}

## Overview
[1-2 paragraphs: what this knowledge covers and why it matters for this codebase]

## [Main Sections — vary by category, see Category Templates below]

## Anti-Patterns
[What to avoid and why — with explanation of consequences]

## Gotchas
[Non-obvious behaviors, edge cases, things that break silently]

## Key Files
[Most important files with one-line descriptions]

## Related
[Links to ADR/PF entries, other KBs, key source files]
```

### Category Templates

Use the matching template as your main sections. Anti-Patterns, Gotchas, Key Files, and Related are shared across all categories.

**Architecture:**
- System Context (purpose, role in larger system, external dependencies)
- Component Architecture (major building blocks, data stores, APIs)
- Component Interactions (how pieces communicate, data flow)
- Integration Patterns (how this connects to external systems)
- Constraints (security boundaries, performance considerations, scaling limits)

**Conventions:**
- Code Organization Principles (principle with rationale)
- Standard Patterns (pattern with annotated code example)
- Error Handling Standards (approach with code example)

**Component Patterns:**
- Core Responsibilities (what this component should/should NOT do)
- Standard Structure (complete annotated code example)
- Dependency Patterns (how dependencies are managed)
- Error Handling (component-specific error patterns)
- Integration Guidelines (how to interact with other component types)

**Domain Knowledge:**
- Business Context (purpose, business value, compliance constraints)
- Core Business Rules (rules with examples and edge cases)
- State Transitions (workflow states and triggers)
- Technical Implementation Patterns (code patterns specific to this domain)
- Error Handling and Recovery (domain-specific failure modes)

**Lessons Learned:**
- Per lesson: Incident Context → Root Cause → Impact → Code showing problem and solution → Prevention Strategy

### Description Field Rules

The `description` field is how this KB gets discovered. It must:
- Start with "Use when"
- Name specific scenarios where this knowledge applies
- Include keywords a developer would search for

Good: `"Use when adding a new vendor integration, implementing API clients, or connecting to external services. Keywords: integration, vendor, API client, webhook."`
Bad: `"Integration stuff"`

### Cross-References

Knowledge files must not exist in isolation. The **Related** section must link to:
- Other KBs that cover related topics
- ADR/PF entries from DECISIONS_CONTEXT (if provided)
- Key source files referenced in the knowledge

References should be bidirectional — when creating a new KB that relates to an existing one, note the connection.

---

## Rules for Code Examples

Every code example must have three parts:
1. **Description before**: what it demonstrates and why
2. **Inline comments**: explaining the important lines
3. **Takeaways after**: key points

Before including an example, verify it adds **significant unique value** beyond what descriptive text alone provides. If the pattern can be fully explained in a sentence, skip the code block. Only show codebase-specific patterns — never generic language features.

Never include bare code snippets without context.

---

## What to Avoid

- **Generic advice**: "Use dependency injection" without showing how THIS project does it
- **Speculation**: "We might want to add caching later" — only document what exists
- **Bare examples**: Code without explanation of what it shows and why it matters
- **Low-value examples**: Code that restates generic language features. If it doesn't show something unique to THIS project, cut it.
- **Everything-bagel files**: Covering too many topics in one file — stay focused
- **Obvious things**: If reading one file makes it clear, it doesn't need a KB
- **Testing knowledge**: Don't include test patterns unless explicitly requested
- **Isolated knowledge islands**: Every KB must reference related files and source code

| Red Flag | What It Indicates |
|----------|-------------------|
| "Always follow best practices" | Generic, not codebase-specific |
| No code examples at all | Insufficient actionable guidance |
| Examples without inline comments | Missing required context |
| "In the future, we might..." | Speculative — remove it |
| 500+ lines in a single file | Should be split into focused files |
| No cross-references in Related | Isolated knowledge island |

---

## Quality Self-Checks

Run through this before writing. If any check fails, go back and fix it.

**Content:**
- [ ] Knowledge provides codebase-specific insights (not generic guidance)
- [ ] All content reflects current patterns (no speculation)
- [ ] Business context and domain constraints captured where relevant
- [ ] Every claim is verifiable in actual code

**Examples:**
- [ ] Every code example has description before, inline comments, and takeaways after
- [ ] Each example adds significant unique value beyond descriptive text alone
- [ ] Anti-patterns documented with explanation of consequences

**Structure:**
- [ ] Category is correct and main sections follow the matching template
- [ ] Description field starts with "Use when" and includes keywords
- [ ] File stays under 500 lines (split if necessary)
- [ ] 5-10 referenced files selected for staleness tracking

**Connections:**
- [ ] Cross-references to related KBs and ADR/PF entries in Related section
- [ ] No isolated knowledge islands — file connects to the broader knowledge network
- [ ] Key source files listed in Key Files section

---

## Sidecar Output

After writing KNOWLEDGE.md, write a sidecar JSON for the host process:

**Filename**: `.create-result.json` (new KBs) or `.refresh-result.json` (refreshes)
**Location**: Same directory as KNOWLEDGE.md (`.features/{slug}/`)

```json
{
  "referencedFiles": ["src/path/to/key-file.ts", "src/path/to/other.ts"],
  "description": "Use when working on {feature area}. Keywords: {terms}."
}
```

The host process reads this sidecar and updates `.features/index.json` — do NOT update the index directly.

---

## Worked Example

This is what a complete, well-structured KB looks like. Use it as a reference for quality and format.

````markdown
---
feature: integrations
name: Third-Party Integrations
description: "Use when adding a new vendor integration, implementing API clients, or connecting to external services. Keywords: integration, vendor, API client, webhook, spawn, config."
category: component-patterns
directories: [src/lib/]
referencedFiles: [src/lib/config.ts, src/lib/claude.ts, src/lib/skill-installer.ts, src/lib/deploy.ts]
created: 2026-04-30
updated: 2026-04-30
---

# Third-Party Integrations

## Overview

This project integrates with external systems in three ways: spawning CLI processes, fetching files from remote registries, and writing to directories that AI editors watch. Each integration lives in its own module under `src/lib/` and is wired into a command in `src/commands/`. All external constants are centralized in `src/lib/config.ts`.

The key cross-cutting pattern is the separation between lib modules (which integrate) and commands (which orchestrate). Violating this creates coupling that breaks the error handling model.

## Core Responsibilities

- Lib modules: integrate with external systems, export async functions, throw on failure
- Commands: orchestrate lib modules, catch errors, route to UI via `showError()`
- Config: centralize all external constants, expose env var overrides

## Standard Structure

Every integration follows the same file organization. This example shows the pattern that all three existing integrations (Claude CLI, GitHub, AI editors) follow:

```
src/lib/
  claude.ts          # Claude Code CLI (spawn + stream JSON)
  skill-installer.ts # GitHub (git clone, sparse checkout)
  deploy.ts          # AI editors (.claude/, .cursor/ dirs)
  config.ts          # All constants for the above
```

A new integration means a new file here. The module exports async functions, imports from `config.ts`, and never imports from `src/ui/` or `src/commands/`.

### Config Centralization

URLs, subpaths, install directories — these change together. One file to update when an upstream moves:

All constants use `SCREAMING_SNAKE_CASE` with a descriptive prefix. If a value can be overridden by the user, expose an env var with a sensible default.

## Anti-Patterns

- **Putting fetch logic in a command file** — breaks the lib/command separation and makes the integration untestable in isolation.
- **Hardcoding URLs in lib modules** — always use `config.ts`. Scattered strings become stale and hard to find.
- **Calling `showError()` from a lib module** — lib modules throw; commands catch and display.

## Gotchas

- `spawn` requires the binary on PATH. If integrating a tool that may not be globally installed, detect `ENOENT` and provide an install URL.
- Temp files use `Date.now()`. If two processes run simultaneously, add a random suffix to avoid collisions.

## Key Files

- `src/lib/config.ts` — add constants here before writing integration code
- `src/lib/claude.ts` — reference implementation for spawn-and-stream pattern
- `src/lib/skill-installer.ts` — reference implementation for fetch-from-remote pattern

## Related

- ADR-003: Lib/command separation principle
- PF-001: Config drift when constants are scattered
````

---

## Scope and Limitations

Only document what you can verify in the codebase. When you encounter:
- Knowledge outside the provided codebase
- External systems without accessible documentation
- Information that requires context you don't have

Acknowledge the limitation clearly and focus on what IS extractable. Never fill gaps with generic knowledge or speculation.
