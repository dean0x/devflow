# New Knowledge Base

Read this file only when you create a knowledge base. A refresh keeps the category and the sections of the existing file.

## Category

Choose the category of the new knowledge base:

| The knowledge is about... | Category | Language Style |
|---|---|---|
| How the overall system is designed | `architecture` | Descriptive — explains what systems are and why they exist |
| Patterns followed across the whole project | `conventions` | Prescriptive — "Do this," "Avoid that" |
| How a specific type of component works | `component-patterns` | Prescriptive — enforces conventions |
| A specific business domain or module | `domain-knowledge` | Descriptive — builds mental models |
| Hard-won lessons from incidents or edge cases | `lessons-learned` | Narrative — tells the story of discovery |

## Category Templates

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

## Worked Example

This is what a complete, well-structured feature knowledge entry looks like. Use it as a reference for quality and format.

````markdown
---
feature: integrations
name: Third-Party Integrations
description: "Use when adding a new vendor integration, implementing API clients, or connecting to external services. Keywords: integration, vendor, API client, webhook, spawn, config."
category: component-patterns
directories: [src/lib/]
created: 2026-04-30
updated: 2026-04-30
---

# Third-Party Integrations

## Rules

- **KB-AP-1** Fetch logic never lives in a command file: it breaks the lib/command split and cannot be tested alone.
- **KB-AP-2** URLs never live in lib modules: they go through `config.ts`.
- **KB-AP-3** A lib module never calls `showError()`: lib modules throw, commands catch and display.
- **KB-AP-4** `spawn` needs the binary on PATH: detect `ENOENT` and give an install URL.
- **KB-INV-1** Every external constant lives in `src/lib/config.ts`.

## Overview

This project integrates with external systems by spawning CLI processes, fetching files from remote registries, and writing to directories that AI editors watch. Each integration lives in its own module under `src/lib/` and is wired into a command in `src/commands/`. All external constants are centralized in `src/lib/config.ts`.

The key cross-cutting pattern is the separation between lib modules (which integrate) and commands (which orchestrate). Violating this creates coupling that breaks the error handling model.

## Core Responsibilities

- Lib modules: integrate with external systems, export async functions, throw on failure
- Commands: orchestrate lib modules, catch errors, route to UI via `showError()`
- Config: centralize all external constants, expose env var overrides

## Standard Structure

Every integration follows the same file organization. This example shows the pattern that every existing integration (Claude CLI, GitHub, AI editors) follows:

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

- **KB-AP-1, putting fetch logic in a command file** — breaks the lib/command separation and makes the integration untestable in isolation.
- **KB-AP-2, hardcoding URLs in lib modules** — always use `config.ts`. Scattered strings become stale and hard to find.
- **KB-AP-3, calling `showError()` from a lib module** — lib modules throw; commands catch and display.

## Gotchas

- **KB-AP-4**: `spawn` requires the binary on PATH. If integrating a tool that may not be globally installed, detect `ENOENT` and provide an install URL.
- Temp files use `Date.now()`. If two processes run simultaneously, add a random suffix to avoid collisions.

## Key Files

- `src/lib/config.ts` — add constants here before writing integration code
- `src/lib/claude.ts` — reference implementation for spawn-and-stream pattern
- `src/lib/skill-installer.ts` — reference implementation for fetch-from-remote pattern

## Related

- `.devflow/features/cli-commands/KNOWLEDGE.md` — the command side of the lib/command split: catching errors and routing them to `showError()`
- `src/commands/` — where each integration is wired into a command
````
