---
name: research:orch
description: Agent orchestration for RESEARCH intent — multi-type research with parallel researchers and trust-aware synthesis
user-invocable: false
---

# Research Orchestration

Agent pipeline for RESEARCH intent in ambient ORCHESTRATED mode. Multi-type research with parallel researchers, trust-aware synthesis, and optional feature knowledge creation.

## Iron Law

> **PARALLEL PERSPECTIVES, SYNTHESIZED TRUTH**
>
> Multiple research types converge on truth better than any single perspective. A
> codebase researcher + external researcher together produce higher-confidence findings
> than either alone. Parallel research types are not redundant — they validate each
> other across trust tiers.

### Phase 1: Load Decisions + Feature Knowledge (Orchestrator-Local)

**Produces:** DECISIONS_CONTEXT, FEATURE_KNOWLEDGE

Load the decisions index before research:

```bash
DECISIONS_CONTEXT=$(node ~/.devflow/scripts/hooks/lib/decisions-index.cjs index "{worktree}" 2>/dev/null || echo "(none)")
```

Use `DECISIONS_CONTEXT` locally to frame research — prior decisions and pitfalls suggest areas to investigate. Follow `devflow:apply-decisions` to Read full entry bodies on demand. Pass `DECISIONS_CONTEXT` to each Researcher agent in Phase 4 so they can cite relevant decisions in findings.

Also load feature knowledge:
1. Read `.features/index.json` if it exists. If not, set `FEATURE_KNOWLEDGE = (none)`.
2. Identify relevant feature knowledge entries (match research question against each entry's descriptions and directories).
3. For each match: check staleness via `node ~/.devflow/scripts/hooks/lib/feature-knowledge.cjs stale "{worktree}" {slug} 2>/dev/null`, read `.features/{slug}/KNOWLEDGE.md`.
4. Use `FEATURE_KNOWLEDGE` **locally** — feature-specific patterns guide what the codebase researcher should look for.
5. Pass `FEATURE_KNOWLEDGE` to each Researcher agent in Phase 4.

### Phase 2: Requirements

**Produces:** RESEARCH_PLAN

Analyze the user's prompt to infer research types needed:
- Minimum 2 types, maximum 5 types
- Always consider: does this question have both a codebase angle AND an external angle?
- Assign each type a focused RESEARCH_QUESTION (specific sub-question for that type)

For each research type in RESEARCH_PLAN, determine:
- `RESEARCH_TYPE`: One of `codebase | external | market | competitor | technology`
- `RESEARCH_QUESTION`: Focused sub-question for this type
- `OUTPUT_PATH`: `.docs/research/{topic-slug}/{YYYY-MM-DD_HHMM}/{type}.md`

Generate topic slug from the research question: kebab-case, lowercase, no articles.

**Tool availability check**: If WebSearch/WebFetch are unavailable, restrict RESEARCH_PLAN to `codebase` type only. Inform user in Phase 6 that external research types were skipped.

### Phase 3: Orient (Conditional)

**Produces:** ORIENT_OUTPUT

Only if `codebase` type is in RESEARCH_PLAN.

Spawn `Agent(subagent_type="Skimmer")` targeting codebase areas relevant to the research question:
- File structure and module boundaries in the relevant area
- Entry points and key abstractions
- Related patterns and conventions

Pass `ORIENT_OUTPUT` to the codebase Researcher in Phase 4.

Skip this phase (set ORIENT_OUTPUT = "(none)") if `codebase` type is not in RESEARCH_PLAN.

### Phase 4: Parallel Researchers

**Produces:** RESEARCH_OUTPUTS (paths to written files)
**Requires:** RESEARCH_PLAN, ORIENT_OUTPUT (optional)

Spawn 2-5 `Agent(subagent_type="Researcher")` agents **in a single message** (parallel execution).

Each Researcher receives:
- `RESEARCH_TYPE`: The assigned type from RESEARCH_PLAN
- `RESEARCH_QUESTION`: The focused sub-question for this type
- `OUTPUT_PATH`: The assigned output path from RESEARCH_PLAN
- `DECISIONS_CONTEXT`: From Phase 1
- `FEATURE_KNOWLEDGE`: From Phase 1
- `ORIENT_OUTPUT`: Only for `codebase` type; omit for all other types
- `WORKTREE_PATH`: If in a worktree context

Each Researcher writes its findings to disk at OUTPUT_PATH. Capture all OUTPUT_PATHs as RESEARCH_OUTPUTS.

### Phase 5: Synthesize

**Produces:** RESEARCH_SUMMARY
**Requires:** RESEARCH_OUTPUTS

Spawn `Agent(subagent_type="Synthesizer")` in `research` mode:
- Reads researcher outputs from disk (RESEARCH_OUTPUTS paths)
- Merges findings with trust-aware aggregation:
  - Trusted (codebase) findings override conflicting untrusted (web) findings
  - Untrusted findings corroborated by multiple web sources = medium confidence
  - Findings confirmed across both trusted and untrusted sources = high confidence
- Writes `research-summary.md` to the same timestamped directory

Output path: `.docs/research/{topic-slug}/{timestamp}/research-summary.md`

### Phase 6: Present

**Requires:** RESEARCH_SUMMARY

Main session reviews findings and presents to user:

- **Trust annotations**: Label each finding as (trusted), (untrusted), or (mixed)
- **Conflicts**: If codebase findings contradict web findings, highlight the conflict explicitly
- **Coverage gaps**: Note which research types were skipped (e.g., if WebSearch unavailable)
- **Drill-down**: Use AskUserQuestion to offer focused follow-up on specific findings

If external research types were skipped due to tool unavailability: inform user which types were skipped and why.

### Phase 7: Feature Knowledge Creation (Conditional)

**Requires:** RESEARCH_SUMMARY, DECISIONS_CONTEXT
**Produces:** FEATURE_KNOWLEDGE_STATUS (created | skipped)

1. If `.features/.disabled` exists → skip, set FEATURE_KNOWLEDGE_STATUS = skipped
2. If `codebase` type was not in RESEARCH_PLAN → skip (no local code was examined)
3. Read `.features/index.json` (if it exists)
4. Based on the codebase areas touched by research, check if matching feature knowledge already exists. If covered → skip
5. Use AskUserQuestion: "No feature knowledge exists for {researched area}. Create one to capture these patterns?"
6. If user declines → set FEATURE_KNOWLEDGE_STATUS = skipped
7. If user accepts:
   a. Derive FEATURE_SLUG from the researched area (kebab-case, must match `^[a-z0-9][a-z0-9-]*$`)
   b. Derive FEATURE_NAME (human-readable)
   c. Identify DIRECTORIES from codebase research scope
   d. Spawn Agent(subagent_type="Knowledge"):
      ```
      "FEATURE_SLUG: {slug}
      FEATURE_NAME: {name}
      DIRECTORIES: {directories}
      EXPLORATION_OUTPUTS: {codebase research findings from Phase 4}
      DECISIONS_CONTEXT: {from Phase 1}
      WORKTREE_PATH: {worktree path, if in a worktree}
      Load the devflow:feature-knowledge skill. EXPLORATION_OUTPUTS are pre-computed — synthesize instead of
      exploring from scratch. Read .features/index.json for cross-referencing."
      ```
   e. Read sidecar (`.features/{slug}/.create-result.json`), then run:
      ```bash
      node ~/.devflow/scripts/hooks/lib/feature-knowledge.cjs update-index "{worktree}" \
        --slug="{slug}" --name="{name}" --directories='[...]' \
        --referencedFiles='{from_sidecar}' --description="{from_sidecar}" \
        --createdBy="research" 2>/dev/null
      ```
      Clean up: `rm -f .features/{slug}/.create-result.json`
      If sidecar missing (agent failed), use empty defaults: `referencedFiles='[]'`, `description=""`.
   f. Report: "Created feature knowledge: {slug}"
   g. Set FEATURE_KNOWLEDGE_STATUS = created

**Failure handling**: Non-blocking. If Knowledge agent fails, log and continue.

---

## Worktree Support

If the orchestrator receives a `WORKTREE_PATH` context (e.g., from multi-worktree workflows), pass it through to all spawned agents. Each agent's "Worktree Support" section handles path resolution.

---

## Graceful Degradation

| Condition | Behavior |
|-----------|----------|
| WebSearch/WebFetch unavailable | Restrict to codebase type only, inform user |
| Codebase type not relevant | Proceed with web types only, skip Phase 3 |
| A Researcher agent fails | Continue with remaining outputs, note gap in synthesis |
| Synthesizer fails | Present individual researcher outputs directly |

---

## Phase Completion Checklist

Before presenting findings, verify every phase was completed:

- [ ] Phase 1: Load Decisions → DECISIONS_CONTEXT and FEATURE_KNOWLEDGE captured (orchestrator-local)
- [ ] Phase 2: Requirements → RESEARCH_PLAN captured (types, questions, paths)
- [ ] Phase 3: Orient → ORIENT_OUTPUT captured (or skipped if no codebase type)
- [ ] Phase 4: Parallel Researchers → RESEARCH_OUTPUTS captured (disk paths)
- [ ] Phase 5: Synthesize → RESEARCH_SUMMARY captured
- [ ] Phase 6: Present → Findings delivered with trust annotations
- [ ] Phase 7: Feature Knowledge Creation → FEATURE_KNOWLEDGE_STATUS captured (created or skipped with reason)

If any phase is unchecked, execute it before proceeding.
