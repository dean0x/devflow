---
name: feature-kb
description: Structures codebase exploration into a feature knowledge base
trigger: agent-loaded
allowed-tools:
  - Read
  - Grep
  - Glob
  - Write
---

# Feature Knowledge Base Creation

## Iron Law

> **Knowledge that can't be derived from reading one file — capture cross-cutting understanding.**
>
> A KB exists to save the NEXT agent from rediscovering patterns that span multiple files,
> modules, or layers. If it's obvious from a single file read, don't capture it.

---

## Four-Phase Process

### Phase 1: Scan

Identify the feature area boundaries:
- Directory prefixes (e.g., `src/payments/`, `src/auth/`)
- Key entry points and exports
- Configuration and wiring files
- Test directories

### Phase 2: Extract

For each key file, extract:
- **Architecture**: Module boundaries, dependency graph, data flow
- **Conventions**: Naming patterns, file organization, API style
- **Component Patterns**: Reusable structures, composition patterns
- **Domain Knowledge**: Business rules, invariants, edge cases
- **Integration Points**: How this area connects to other areas

### Phase 3: Distill

Compress findings into actionable knowledge:
- Remove obvious/derivable information
- Highlight non-obvious patterns and gotchas
- Cross-reference with ADR/PF entries where relevant
- Identify anti-patterns specific to this area

### Phase 4: Forge

Write the KNOWLEDGE.md file with this structure:

```markdown
---
feature: {slug}
name: {human-readable name}
directories: [{dir prefixes}]
referencedFiles: [{key files for staleness tracking}]
created: {ISO date}
updated: {ISO date}
---

# {Feature Area Name}

## Overview
[2-3 sentence summary of what this area does and why it exists]

## Architecture
[Module boundaries, key abstractions, dependency direction]

## Data Flow
[How data moves through this area — inputs, transformations, outputs]

## Key Patterns
[Patterns unique to this area that agents should follow]

## Integration Points
[How this area connects to other areas of the codebase]

## Anti-Patterns
[Things that look right but are wrong in this specific area]

## Gotchas
[Non-obvious behaviors, edge cases, things that break silently]

## Key Files
[Most important files with one-line descriptions]

## Related
[Links to ADR/PF entries, other KBs, external docs]
```

---

## Quality Self-Checks

| Red Flag | Fix |
|----------|-----|
| KB > 500 lines | Split into focused sub-areas |
| Restates what's obvious from one file | Remove — KB is for cross-cutting knowledge |
| No anti-patterns section | Every area has gotchas — dig deeper |
| No integration points | How does this connect to rest of system? |
| Broad directories (e.g., `src/`) | Focus on specific subdirectories |
| No referenced files for staleness | Pick 5-10 key files that signal changes |

## Integration

After writing KNOWLEDGE.md, write a sidecar JSON file for the host process to consume:

**Filename**: `.create-result.json` (for new KBs) or `.refresh-result.json` (for refreshes)
**Location**: Same directory as KNOWLEDGE.md (`.features/{slug}/`)

**Required fields**:
```json
{
  "referencedFiles": ["src/path/to/key-file.ts", "src/path/to/other.ts"],
  "description": "Use when working on {feature area description}"
}
```

The host process reads this sidecar and updates `.features/index.json` — do NOT attempt to update the index directly.
