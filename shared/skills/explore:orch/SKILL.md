---
name: explore:orch
description: Agent orchestration for EXPLORE intent — codebase analysis, flow tracing, architecture mapping
user-invocable: false
---

# Explore Orchestration

Agent pipeline for EXPLORE intent in ambient GUIDED and ORCHESTRATED modes. Codebase analysis, flow tracing, dependency mapping, and architecture understanding.

## Iron Law

> **EXPLORATION WITHOUT STRUCTURE IS JUST BROWSING**
>
> Every exploration must produce file:line references. Vague summaries like "the auth
> system is complex" are failures. Every claim must point to concrete code locations,
> real call chains, and actual file paths. If you can't cite it, you don't know it.

---

## GUIDED Behavior

For GUIDED depth, the main session performs exploration directly:

1. **Load Knowledge** — Run `node scripts/hooks/lib/knowledge-context.cjs index "{worktree}"` for KNOWLEDGE_CONTEXT. Read `.features/index.json` if it exists. Based on the exploration question, identify relevant KBs and read them. Use both locally to frame exploration. Set `FEATURE_KNOWLEDGE = (none)` if none are relevant.
2. **Spawn Skimmer** — `Agent(subagent_type="Skimmer")` targeting the area of interest. Use orientation output to ground exploration in real file structures and patterns.
3. **Trace** — Using Skimmer findings + `FEATURE_KNOWLEDGE`, trace the flow or analyze the subsystem directly in main session. Follow call chains, read key files, map integration points.
4. **Present** — Deliver structured findings using the Output format below. Use AskUserQuestion to offer drill-down into specific areas.

## ORCHESTRATED Pipeline

### Phase 1: Load Knowledge (Orchestrator-Local)

**Produces:** KNOWLEDGE_CONTEXT, FEATURE_KNOWLEDGE

Before exploring, load the knowledge index:

```bash
KNOWLEDGE_CONTEXT=$(node scripts/hooks/lib/knowledge-context.cjs index "{worktree}")
```

The orchestrator uses `KNOWLEDGE_CONTEXT` locally when framing exploration — prior
decisions and pitfalls suggest specific areas to investigate. Follow
`devflow:apply-knowledge` to Read full entry bodies on demand. **Do NOT pass
`KNOWLEDGE_CONTEXT` to Explore sub-agents** — knowledge context stays in the
orchestrator, not in the investigation workers.

Also load feature knowledge:
1. Read `.features/index.json` if it exists. If not, set `FEATURE_KNOWLEDGE = (none)`.
2. Identify relevant KBs (match task intent against KB descriptions and directories).
3. For each match: check staleness via `node scripts/hooks/lib/feature-kb.cjs stale "{worktree}" {slug}`, read `.features/{slug}/KNOWLEDGE.md`.
4. Use `FEATURE_KNOWLEDGE` **locally** for exploration framing — feature-specific patterns and integration points guide where to focus.
5. **Do NOT pass to Explore sub-agents** (same asymmetric pattern as KNOWLEDGE_CONTEXT).

**Explore agent framing**: "The KB is a baseline — your job is to VALIDATE, EXTEND, and CORRECT it, not repeat it. Focus on areas the KB doesn't cover and things that may have changed."

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

## Phase Completion Checklist

Before presenting findings, verify every phase was announced:

- [ ] Phase 1: Load Knowledge (Orchestrator-Local) → KNOWLEDGE_CONTEXT and FEATURE_KNOWLEDGE captured (orchestrator-local, not passed to workers)
- [ ] Phase 2: Orient → ORIENT_OUTPUT captured
- [ ] Phase 3: Explore → EXPLORE_OUTPUT captured
- [ ] Phase 4: Synthesize → MERGED_FINDINGS captured
- [ ] Phase 5: Present → Findings delivered with file:line references

If any phase is unchecked, execute it before proceeding.
