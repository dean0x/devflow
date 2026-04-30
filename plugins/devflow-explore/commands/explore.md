---
description: Explore codebase with structured analysis and optional KB creation
---

# Explore Command

Explore a codebase area by spawning parallel agents for flow tracing, dependency mapping, and pattern analysis. Findings are synthesized into structured output with file:line references, with an optional feature KB created as a byproduct.

## Usage

```
/explore "how does the auth system work"
/explore "trace the request lifecycle from API to database"
/explore "what patterns does the payments module use"
```

## Input

`$ARGUMENTS` contains whatever follows `/explore`:
- Area description: "how does the auth system work"
- Flow question: "trace the request lifecycle"
- Empty: use conversation context

## Phases

### Phase 1: Load Knowledge Index (Orchestrator-Local)

**Produces:** KNOWLEDGE_CONTEXT, FEATURE_KNOWLEDGE

Before exploring, load the knowledge index:

```bash
KNOWLEDGE_CONTEXT=$(node ~/.devflow/scripts/hooks/lib/knowledge-context.cjs index "{worktree}" 2>/dev/null || echo "(none)")
```

The orchestrator uses `KNOWLEDGE_CONTEXT` locally when framing exploration — prior decisions and pitfalls suggest specific areas to investigate. Follow `devflow:apply-knowledge` to Read full entry bodies on demand. **Do NOT pass `KNOWLEDGE_CONTEXT` to Explore sub-agents** — knowledge context stays in the orchestrator, not in the investigation workers.

**Load Feature Knowledge:**
1. Read `.features/index.json` if it exists. If not, set `FEATURE_KNOWLEDGE = (none)`.
2. Identify relevant KBs (match task intent against KB descriptions and directories).
3. For each match: check staleness via `node ~/.devflow/scripts/hooks/lib/feature-kb.cjs stale "{worktree}" {slug} 2>/dev/null`, read `.features/{slug}/KNOWLEDGE.md`.
4. Use `FEATURE_KNOWLEDGE` **locally** for exploration framing — feature-specific patterns and integration points guide where to focus.
5. **Do NOT pass to Explore sub-agents** (same asymmetric pattern as KNOWLEDGE_CONTEXT).

**Explore agent framing**: "The KB is a baseline — your job is to VALIDATE, EXTEND, and CORRECT it, not repeat it. Focus on areas the KB doesn't cover and things that may have changed."

### Phase 2: Orient

**Produces:** ORIENT_OUTPUT

Spawn `Agent(subagent_type="Skimmer")` to get codebase overview relevant to the exploration question:

- File structure and module boundaries in the target area
- Entry points and key abstractions
- Related patterns and conventions

### Phase 3: Explore (Parallel)

**Produces:** EXPLORE_OUTPUT
**Requires:** ORIENT_OUTPUT

Based on Skimmer findings, spawn 2-3 `Agent(subagent_type="Explore")` agents **in a single message** (parallel execution):

- **Flow explorer**: Trace the primary call chain end-to-end — entry point through to side effects
- **Dependency explorer**: Map imports, shared types, module boundaries, and integration points
- **Pattern explorer**: Identify recurring patterns, conventions, and architectural decisions in the area

Adjust explorer focus based on the specific exploration question.

### Phase 4: Synthesize

**Produces:** MERGED_FINDINGS
**Requires:** EXPLORE_OUTPUT

Spawn `Agent(subagent_type="Synthesizer")` in `exploration` mode with combined findings:

- Merge overlapping discoveries from parallel explorers
- Resolve any contradictions between explorer findings
- Organize into structured output format

### Phase 5: Present

**Requires:** MERGED_FINDINGS

Main session reviews synthesis for:

- **Gaps**: Areas the explorers missed or couldn't reach
- **Surprises**: Unexpected patterns, hidden dependencies, non-obvious design choices
- **Depth**: Areas where the user might want to drill deeper

Present findings to user. Use AskUserQuestion to offer focused follow-up exploration.

### Phase 6: Suggest KB Creation (Conditional)

**Requires:** MERGED_FINDINGS, KNOWLEDGE_CONTEXT
**Produces:** KB_STATUS (created | skipped)

1. If `.features/.disabled` exists → skip, set KB_STATUS = skipped
2. Read `.features/index.json` (if it exists)
3. Based on the explored area (user's question + MERGED_FINDINGS scope), check if a matching KB
   already exists (match against each KB's `directories` and `description`). If covered → skip
4. Use AskUserQuestion: "No feature KB exists for {explored area}. Create one to capture these patterns?"
5. If user declines → set KB_STATUS = skipped
6. If user accepts:
   a. Derive FEATURE_SLUG from explored area (kebab-case from primary directory, strip src/lib
      prefixes, must match `^[a-z0-9][a-z0-9-]*$`)
   b. Derive FEATURE_NAME (human-readable)
   c. Identify DIRECTORIES from explored scope
   d. Spawn Agent(subagent_type="Knowledge"):
      ```
      "FEATURE_SLUG: {slug}
      FEATURE_NAME: {name}
      DIRECTORIES: {directories}
      EXPLORATION_OUTPUTS: {MERGED_FINDINGS from Phase 4}
      KNOWLEDGE_CONTEXT: {from Phase 1}
      WORKTREE_PATH: {worktree path, if in a worktree}
      Load the devflow:feature-kb skill. EXPLORATION_OUTPUTS are pre-computed — synthesize instead of
      exploring from scratch. Read .features/index.json for cross-referencing."
      ```
   e. Read sidecar (`.features/{slug}/.create-result.json`), then run:
      ```bash
      node ~/.devflow/scripts/hooks/lib/feature-kb.cjs update-index "{worktree}" \
        --slug="{slug}" --name="{name}" --directories='[...]' \
        --referencedFiles='{from_sidecar}' --description="{from_sidecar}" \
        --createdBy="explore" 2>/dev/null
      ```
      Clean up: `rm -f .features/{slug}/.create-result.json`
      If sidecar missing (agent failed), use empty defaults: `referencedFiles='[]'`, `description=""`.
   f. Report: "Created feature KB: {slug}"
   g. Set KB_STATUS = created

**Failure handling**: Non-blocking. If Knowledge agent fails, log and continue.

## Architecture

```
/explore (orchestrator)
│
├─ Phase 1: Load Knowledge Index (Orchestrator-Local)
│
├─ Phase 2: Orient
│  └─ Skimmer agent (codebase overview)
│
├─ Phase 3: Parallel exploration
│  └─ 2-3 Explore agents (flow, dependency, pattern) in single message
│
├─ Phase 4: Synthesize
│  └─ Synthesizer aggregates findings in exploration mode
│
├─ Phase 5: Present findings with drill-down offer
│
└─ Phase 6: Suggest KB creation (conditional)
   └─ Knowledge agent (if user accepts and no existing KB)
```

## Principles

1. **Structure over browsing** - Every claim must cite file:line references
2. **Parallel execution** - All explorers run simultaneously for speed
3. **Knowledge-informed** - Prior decisions and feature KBs guide where to look
4. **User-driven depth** - Present findings, then offer drill-down into specific areas

## Error Handling

- If Skimmer returns no relevant files: report "No files found matching exploration scope"
- If all explorers error: report partial findings from any that succeeded, note gaps
- If an explorer errors: continue with remaining results, note the gap
- If KB creation fails: log failure, report exploration results normally
