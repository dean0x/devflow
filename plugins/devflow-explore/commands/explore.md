---
description: Explore codebase with structured analysis and optional feature knowledge creation
---

# Explore Command

Explore a codebase area by spawning parallel agents for flow tracing, dependency mapping, and pattern analysis. Findings are synthesized into structured output with file:line references, with optional feature knowledge created as a byproduct.

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

### Phase 1: Load Decisions (Orchestrator-Local)

**Produces:** DECISIONS_CONTEXT, FEATURE_KNOWLEDGE

Before exploring, load the decisions index:

```bash
DECISIONS_CONTEXT=$(node ~/.devflow/scripts/hooks/lib/decisions-index.cjs index "{worktree}" 2>/dev/null || echo "(none)")
```

The orchestrator uses `DECISIONS_CONTEXT` locally when framing exploration — prior decisions and pitfalls suggest specific areas to investigate. Follow `devflow:apply-decisions` to Read full entry bodies on demand. **Do NOT pass `DECISIONS_CONTEXT` to Explore sub-agents** — decisions context stays in the orchestrator, not in the investigation workers.

Also load feature knowledge:
1. Read `.devflow/features/index.json` if it exists. If not, set `FEATURE_KNOWLEDGE = (none)`.
2. Identify relevant feature knowledge entries (match task intent against each entry's descriptions and directories).
3. For each match: check staleness via `node ~/.devflow/scripts/hooks/lib/feature-knowledge.cjs stale "{worktree}" {slug} 2>/dev/null`, read `.devflow/features/{slug}/KNOWLEDGE.md`.
4. Use `FEATURE_KNOWLEDGE` **locally** for exploration framing — feature-specific patterns and integration points guide where to focus.
5. **Do NOT pass to Explore sub-agents** (same asymmetric pattern as DECISIONS_CONTEXT).

**Explore agent framing**: "The feature knowledge is a baseline — your job is to VALIDATE, EXTEND, and CORRECT it, not repeat it. Focus on areas the feature knowledge doesn't cover and things that may have changed."

### Phase 2: Orient

**Produces:** ORIENT_OUTPUT

Spawn `Agent(subagent_type="Skimmer")` to get codebase overview relevant to the exploration question:

- File structure and module boundaries in the target area
- Entry points and key abstractions
- Related patterns and conventions

### Phase 3: Explore

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
- Organize into the Output format below

### Phase 5: Present

**Requires:** MERGED_FINDINGS

Main session reviews synthesis for:

- **Gaps**: Areas the explorers missed or couldn't reach
- **Surprises**: Unexpected patterns, hidden dependencies, non-obvious design choices
- **Depth**: Areas where the user might want to drill deeper

Present findings to user. Use AskUserQuestion to offer focused follow-up exploration.

### Phase 6: Suggest Feature Knowledge Creation (Conditional)

**Requires:** MERGED_FINDINGS, DECISIONS_CONTEXT
**Produces:** FEATURE_KNOWLEDGE_STATUS (created | skipped)

1. If `.devflow/features/.disabled` exists → skip, set FEATURE_KNOWLEDGE_STATUS = skipped
2. Read `.devflow/features/index.json` (if it exists)
3. Based on the explored area (user's question + MERGED_FINDINGS scope), check if matching feature knowledge
   already exists (match against each entry's `directories` and `description`). If covered → skip
4. Use AskUserQuestion: "No feature knowledge exists for {explored area}. Create one to capture these patterns?"
5. If user declines → set FEATURE_KNOWLEDGE_STATUS = skipped
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
      DECISIONS_CONTEXT: {from Phase 1}
      WORKTREE_PATH: {worktree path, if in a worktree}
      Load the devflow:feature-knowledge skill. EXPLORATION_OUTPUTS are pre-computed — synthesize instead of
      exploring from scratch. Read .devflow/features/index.json for cross-referencing."
      ```
   e. Read sidecar (`.devflow/features/{slug}/.create-result.json`), then run:
      ```bash
      node ~/.devflow/scripts/hooks/lib/feature-knowledge.cjs update-index "{worktree}" \
        --slug="{slug}" --name="{name}" --directories='[...]' \
        --referencedFiles='{from_sidecar}' --description="{from_sidecar}" \
        --createdBy="explore" 2>/dev/null
      ```
      Clean up: `rm -f .devflow/features/{slug}/.create-result.json`
      If sidecar missing (agent failed), use empty defaults: `referencedFiles='[]'`, `description=""`.
   f. Report: "Created feature knowledge: {slug}"
   g. Set FEATURE_KNOWLEDGE_STATUS = created

**Failure handling**: Non-blocking. If Knowledge agent fails, log and continue.

## Worktree Support

If the orchestrator receives a `WORKTREE_PATH` context (e.g., from multi-worktree workflows), pass it through to all spawned agents. Each agent's "Worktree Support" section handles path resolution.

## Output

Structured exploration findings with concrete code references:

- Scope (what was explored and boundaries)
- Architecture Map (modules, layers, key abstractions with file:line)
- Flow Trace (call chain from entry to exit with file:line at each step)
- Integration Points (module boundaries, shared types, external dependencies)
- Patterns (recurring conventions, design decisions observed)
- Key Insights (non-obvious findings, surprises, potential concerns)

## Architecture

```
/explore (orchestrator)
│
├─ Phase 1: Load Decisions (Orchestrator-Local)
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
└─ Phase 6: Suggest feature knowledge creation (conditional)
   └─ Knowledge agent (if user accepts and no existing feature knowledge)
```

## Principles

1. **Structure over browsing** - Every claim must cite file:line references
2. **Parallel execution** - All explorers run simultaneously for speed
3. **Knowledge-informed** - Prior decisions and feature knowledge guide where to look
4. **User-driven depth** - Present findings, then offer drill-down into specific areas

## Error Handling

- If Skimmer returns no relevant files: report "No files found matching exploration scope"
- If all explorers error: report partial findings from any that succeeded, note gaps
- If an explorer errors: continue with remaining results, note the gap
- If feature knowledge creation fails: log failure, report exploration results normally
