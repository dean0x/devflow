---
description: Research a topic using cross-validating agent team with trust-aware synthesis
---

# Research Command

Research a topic by creating a cross-validating research team. Researchers validate each other's findings before synthesis, producing higher-confidence output at the cost of extra rounds.

## Usage

```
/research "best caching strategies"
/research "compare React vs Svelte for our use case"
/research "what open-source competitors exist"
/research "how does our auth system work and what are the industry alternatives"
```

## Input

`$ARGUMENTS` contains whatever follows `/research`:
- Research question: "best caching strategies"
- Comparison question: "compare React vs Svelte for our use case"
- Empty: use conversation context

## Phases

### Phase 1: Load Decisions (Orchestrator-Local)

**Produces:** DECISIONS_CONTEXT, FEATURE_KNOWLEDGE

Before researching, load the decisions index:

```bash
DECISIONS_CONTEXT=$(node ~/.devflow/scripts/hooks/lib/decisions-index.cjs index "{worktree}" 2>/dev/null || echo "(none)")
```

Use `DECISIONS_CONTEXT` locally when framing research. Follow `devflow:apply-decisions` to Read full entry bodies on demand. Pass `DECISIONS_CONTEXT` to researcher teammates via their prompts in Phase 4 so they can cite relevant decisions in findings.

Also load feature knowledge:
1. Read `.devflow/features/index.json` if it exists. If not, set `FEATURE_KNOWLEDGE = (none)`.
2. Identify relevant feature knowledge entries.
3. For each match: check staleness, read `.devflow/features/{slug}/KNOWLEDGE.md`.
4. Use `FEATURE_KNOWLEDGE` **locally** for research framing. Include in researcher teammate prompts in Phase 4.

### Phase 2: Requirements

**Produces:** RESEARCH_PLAN

Analyze the research question to infer research types needed (min 2, max 5):
- `RESEARCH_TYPE`: `codebase | external | market | competitor | technology`
- `RESEARCH_QUESTION`: Focused sub-question for this type
- `OUTPUT_PATH`: `.devflow/docs/research/{topic-slug}/{YYYY-MM-DD_HHMM}/{type}.md`

Generate topic slug from the research question (kebab-case, lowercase, no articles).

**Tool availability check**: If WebSearch/WebFetch are unavailable, restrict to `codebase` type only.

### Phase 3: Orient (Conditional)

**Produces:** ORIENT_OUTPUT

Only if `codebase` type is in RESEARCH_PLAN.

Spawn `Agent(subagent_type="Skimmer")` (pre-team) to get codebase overview relevant to the research question.

Skip and set ORIENT_OUTPUT = "(none)" if `codebase` type is not in RESEARCH_PLAN.

### Phase 4: Spawn Research Team

**Requires:** RESEARCH_PLAN, ORIENT_OUTPUT

Create a team for cross-validating research:

```
Create a team named "research-{topic-slug}" to research: {research question}

Spawn researcher teammates with self-contained prompts:

{For each research type in RESEARCH_PLAN:}

- Name: "{type}-researcher"
  Prompt: |
    You are researching: {RESEARCH_QUESTION}
    Your research type: {RESEARCH_TYPE}
    Your focus: {type-specific methodology — load the research skill for your type using the Research Types table}
    {For codebase type: Codebase orientation: {ORIENT_OUTPUT summary}}

    Steps:
    1. Load the research skill for your RESEARCH_TYPE using the Skill tool (name: devflow:research-codebase, devflow:research-external, devflow:research-market, devflow:research-competitor, or devflow:research-technology)
    2. Execute research methodology from loaded skill
    3. Produce findings with citations (file:line or URLs)
    4. Report completion:
       SendMessage(type: "message", recipient: "team-lead",
         summary: "{type} research: initial findings ready")
```

### Phase 5: Investigation

**Produces:** INVESTIGATION_RESULTS
**Requires:** RESEARCH_PLAN, ORIENT_OUTPUT

Teammates research in parallel:
- Execute research methodology for their assigned type
- Collect findings with citations
- Respect trust levels (local = trusted, web = untrusted)

### Phase 6: Cross-Validation

**Requires:** INVESTIGATION_RESULTS

Lead initiates cross-validation via broadcast:

```
SendMessage(type: "broadcast", summary: "Cross-validate: share findings and check for conflicts"):
"Research complete. Share findings and cross-validate:
1. State your research type and key findings
2. Look for findings from other researchers that confirm or contradict yours
3. For contradictions: the codebase researcher's findings take precedence over web findings
4. Send updates to team-lead

Rules:
- Contradictions between codebase and web are expected — flag them explicitly
- Validate web claims against other web researchers when possible
- Max 2 exchange rounds before we converge"
```

Teammates cross-validate:
- Codebase findings override conflicting web findings
- Web findings corroborated by 2+ teammates gain confidence
- Explicit contradictions are surfaced, not silenced

### Phase 7: Convergence

**Produces:** CONVERGENCE_RESULTS
**Requires:** INVESTIGATION_RESULTS

After cross-validation (max 2 rounds), lead collects results:

```
Lead broadcast:
"Cross-validation complete. Each researcher: submit final findings.
- VALIDATED findings (confirmed by at least one other researcher or type)
- CORRECTED findings (updated based on cross-validation)
- UNVALIDATED findings (not yet checked by others)
- CONFLICTS (explicit contradictions between research types)"
```

### Phase 8: Cleanup

**Requires:** CONVERGENCE_RESULTS

Shut down all researcher teammates explicitly:

```
For each teammate in research team:
  SendMessage(type: "shutdown_request", recipient: "{name}", content: "Research complete")
  Wait for shutdown_response (approve: true)

TeamDelete
Verify TeamDelete succeeded. If failed, retry once after 5s. If retry fails, HALT.
```

### Phase 9: Write Findings to Disk

**Produces:** RESEARCH_OUTPUTS
**Requires:** CONVERGENCE_RESULTS

For each research type, write the converged findings to OUTPUT_PATH. Include:
- Trust level annotation at top of each file
- Validated, corrected, and unvalidated findings clearly labeled
- Explicit conflicts noted

### Phase 10: Synthesize

**Produces:** RESEARCH_SUMMARY
**Requires:** RESEARCH_OUTPUTS

Spawn `Agent(subagent_type="Synthesizer")` in `research` mode:
- Reads researcher outputs from RESEARCH_OUTPUTS paths
- Merges validated findings with trust-aware aggregation
- Highlights cross-validated findings as highest confidence
- Notes unvalidated findings separately
- Writes `research-summary.md` to the same timestamped directory

Output path: `.devflow/docs/research/{topic-slug}/{timestamp}/research-summary.md`

### Phase 11: Present

**Requires:** RESEARCH_SUMMARY

Present findings to user with:
- Trust annotations per finding: (trusted) for codebase, (untrusted) for web, (mixed) for technology
- Validation status: cross-validated vs single-researcher
- Explicit conflicts between research types
- Drill-down offer via AskUserQuestion

### Phase 12: Feature Knowledge Creation (Conditional)

**Requires:** RESEARCH_SUMMARY, DECISIONS_CONTEXT
**Produces:** FEATURE_KNOWLEDGE_STATUS (created | skipped)

1. If `.devflow/features/.disabled` exists → skip
2. If `codebase` type was not in RESEARCH_PLAN → skip
3. Read `.devflow/features/index.json` (if it exists)
4. Check if matching feature knowledge already exists. If covered → skip
5. Use AskUserQuestion: "No feature knowledge exists for {researched area}. Create one?"
6. If user accepts: spawn Knowledge agent, update index
7. Set FEATURE_KNOWLEDGE_STATUS = created or skipped

**Failure handling**: Non-blocking. If Knowledge agent fails, log and continue.

## Worktree Support

If the orchestrator receives a `WORKTREE_PATH` context, pass it through to all spawned agents.

## Output

Research findings saved to `.devflow/docs/research/{topic-slug}/{YYYY-MM-DD_HHMM}/`:
- `{type}.md` per research type (codebase.md, external.md, etc.)
- `research-summary.md` — synthesized findings with trust annotations and validation status

## Architecture

```
/research (orchestrator — teams variant)
│
├─ Phase 1: Load Decisions (Orchestrator-Local)
│
├─ Phase 2: Requirements
│  └─ Infer 2-5 research types from question
│
├─ Phase 3: Orient (conditional — codebase type only)
│  └─ Skimmer agent (pre-team codebase overview)
│
├─ Phase 4: Spawn research team
│  └─ Create team with one researcher per research type
│
├─ Phase 5: Parallel investigation
│  └─ Each teammate researches independently
│
├─ Phase 6: Cross-validation
│  └─ Teammates validate and flag conflicts (max 2 rounds)
│
├─ Phase 7: Convergence
│  └─ Submit validated/corrected/unvalidated/conflicting findings
│
├─ Phase 8: Cleanup
│  └─ Shut down teammates, release team resources
│
├─ Phase 9: Write findings to disk
│
├─ Phase 10: Synthesize
│  └─ Synthesizer on converged findings with trust-aware aggregation
│
├─ Phase 11: Present findings with trust annotations and validation status
│
└─ Phase 12: Suggest feature knowledge creation (conditional)
   └─ Knowledge agent (if codebase type researched + user accepts)
```

## Principles

1. **Cross-validation** — Researchers validate and extend each other's findings (max 2 rounds)
2. **Trust hierarchy** — Codebase findings override conflicting web findings
3. **Conflict surfacing** — Contradictions are highlighted, not silenced
4. **Evidence-based** — Every claim requires citations (file:line or URL)
5. **Bounded validation** — Max 2 exchange rounds, then converge
6. **Cleanup always** — Team resources released even on failure

## Error Handling

- If WebSearch/WebFetch unavailable: restrict to codebase type, inform user
- If fewer than 2 research types warrant teammates: proceed with 1, note limited scope
- If a teammate errors: continue with remaining teammates, note the gap
- If all findings are unvalidated: report with explicit caveat about validation status
- If feature knowledge creation fails: log failure, report research results normally
