---
description: Explore codebase with cross-validating agent team and optional KB creation
---

# Explore Command

Explore a codebase area by spawning a team of agents for flow tracing, dependency mapping, and pattern analysis. Agents cross-validate each other's findings to ensure accuracy before synthesis.

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

The orchestrator uses `KNOWLEDGE_CONTEXT` locally when framing exploration — prior decisions and pitfalls suggest specific areas to investigate. Follow `devflow:apply-knowledge` to Read full entry bodies on demand. **Do NOT pass `KNOWLEDGE_CONTEXT` to explorer teammates** — knowledge context stays in the orchestrator; teammates examine code directly.

**Load Feature Knowledge:**
1. Read `.features/index.json` if it exists. If not, set `FEATURE_KNOWLEDGE = (none)`.
2. Based on the exploration question, identify relevant KBs
3. For each match: check staleness via `node ~/.devflow/scripts/hooks/lib/feature-kb.cjs stale "{worktree}" {slug} 2>/dev/null`, read `.features/{slug}/KNOWLEDGE.md`
4. Use `FEATURE_KNOWLEDGE` **locally only** for exploration framing — feature-specific patterns and integration points guide where to focus. **Do NOT pass to explorer teammates.**

**Explore agent framing**: "The KB is a baseline — your job is to VALIDATE, EXTEND, and CORRECT it, not repeat it. Focus on areas the KB doesn't cover and things that may have changed."

### Phase 2: Orient

**Produces:** ORIENT_OUTPUT

Spawn `Agent(subagent_type="Skimmer")` (pre-team) to get codebase overview relevant to the exploration question:

- File structure and module boundaries in the target area
- Entry points and key abstractions
- Related patterns and conventions

### Phase 3: Spawn Exploration Team

**Requires:** ORIENT_OUTPUT

Create an agent team with specialized explorers:

```
Create a team named "explore-{topic-slug}" to explore: {exploration question}

Spawn explorer teammates with self-contained prompts:

- Name: "flow-explorer"
  Prompt: |
    You are exploring: {exploration question}
    Your focus: Trace the primary call chain end-to-end — entry point through to side effects.
    Codebase orientation: {ORIENT_OUTPUT summary}

    Steps:
    1. Read relevant source files in the target area
    2. Trace data flow and call chains end-to-end
    3. Map entry points, transformations, and side effects
    4. Document all findings with file:line references
    5. Report completion:
       SendMessage(type: "message", recipient: "team-lead",
         summary: "Flow exploration: initial findings ready")

- Name: "dependency-explorer"
  Prompt: |
    You are exploring: {exploration question}
    Your focus: Map imports, shared types, module boundaries, and integration points.
    Codebase orientation: {ORIENT_OUTPUT summary}

    Steps:
    1. Read module boundaries and import graphs
    2. Identify shared types and cross-module contracts
    3. Map integration points and external dependencies
    4. Document all findings with file:line references
    5. Report completion:
       SendMessage(type: "message", recipient: "team-lead",
         summary: "Dependency exploration: initial findings ready")

- Name: "pattern-explorer"
  Prompt: |
    You are exploring: {exploration question}
    Your focus: Identify recurring patterns, conventions, and architectural decisions in the area.
    Codebase orientation: {ORIENT_OUTPUT summary}

    Steps:
    1. Read key files looking for recurring patterns
    2. Identify naming conventions, error handling styles, configuration patterns
    3. Note architectural decisions and design trade-offs
    4. Document all findings with file:line references
    5. Report completion:
       SendMessage(type: "message", recipient: "team-lead",
         summary: "Pattern exploration: initial findings ready")
```

### Phase 4: Investigation

**Produces:** INVESTIGATION_RESULTS
**Requires:** ORIENT_OUTPUT

Teammates explore in parallel:
- Read relevant source files
- Trace execution paths and data flow
- Map module boundaries and integration points
- Identify patterns and conventions
- Build structured findings with file:line references

### Phase 5: Cross-Validation

**Requires:** INVESTIGATION_RESULTS

Lead initiates cross-validation via broadcast:

```
SendMessage(type: "broadcast", summary: "Cross-validate: share findings and validate claims"):
"Exploration complete. Share your findings:
1. State your focus area
2. Present key findings (with file:line references)
3. Validate at least one other explorer's claims — confirm or correct with evidence

Rules:
- Validate and extend each other's findings, not disprove
- Cite specific code when confirming or correcting
- If you found something that contradicts another explorer, explain the discrepancy
- Max 2 exchange rounds before we converge"
```

Teammates validate each other directly using SendMessage:
- `SendMessage(type: "message", recipient: "dependency-explorer", summary: "Confirm: shared types at types.ts:15")`
  "Your finding about the shared AuthContext type is confirmed — I traced it through..."
- `SendMessage(type: "message", recipient: "flow-explorer", summary: "Correction: middleware order")`
  "The middleware chain actually runs validation before auth, not after — see `src/middleware/index.ts:32`..."
- `SendMessage(type: "message", recipient: "team-lead", summary: "Updated findings")`
  "Updated my findings based on dependency-explorer's correction about..."

### Phase 6: Convergence

**Produces:** CONVERGENCE_RESULTS
**Requires:** INVESTIGATION_RESULTS

After cross-validation (max 2 rounds), lead collects results:

```
Lead broadcast:
"Cross-validation complete. Each explorer: submit final findings.
- VALIDATED findings (confirmed by at least one other explorer)
- CORRECTED findings (updated based on cross-validation)
- UNVALIDATED findings (not yet checked by others)"
```

### Phase 7: Cleanup

**Requires:** CONVERGENCE_RESULTS

Shut down all explorer teammates explicitly:

```
For each teammate in [flow-explorer, dependency-explorer, pattern-explorer]:
  SendMessage(type: "shutdown_request", recipient: "{name}", content: "Exploration complete")
  Wait for shutdown_response (approve: true)

TeamDelete
Verify TeamDelete succeeded. If failed, retry once after 5s. If retry fails, HALT.
```

### Phase 8: Synthesize

**Produces:** MERGED_FINDINGS
**Requires:** CONVERGENCE_RESULTS

Spawn `Agent(subagent_type="Synthesizer")` in `exploration` mode with converged findings:

- Merge validated findings from all explorers
- Incorporate corrections from cross-validation
- Flag unvalidated findings separately
- Organize into structured output format

### Phase 9: Present

**Requires:** MERGED_FINDINGS

Main session reviews synthesis for:

- **Gaps**: Areas the explorers missed or couldn't reach
- **Surprises**: Unexpected patterns, hidden dependencies, non-obvious design choices
- **Depth**: Areas where the user might want to drill deeper
- **Validation status**: Which findings were cross-validated vs unvalidated

Present findings to user. Use AskUserQuestion to offer focused follow-up exploration.

### Phase 10: Suggest KB Creation (Conditional)

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
      EXPLORATION_OUTPUTS: {MERGED_FINDINGS from Phase 8}
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
│  └─ Skimmer agent (pre-team codebase overview)
│
├─ Phase 3: Spawn exploration team
│  └─ Create team with flow-explorer, dependency-explorer, pattern-explorer
│
├─ Phase 4: Parallel exploration
│  └─ Each teammate explores independently
│
├─ Phase 5: Cross-validation
│  └─ Teammates validate and extend each other's findings (max 2 rounds)
│
├─ Phase 6: Convergence
│  └─ Teammates submit validated/corrected/unvalidated findings
│
├─ Phase 7: Cleanup
│  └─ Shut down teammates, release resources
│
├─ Phase 8: Synthesize
│  └─ Synthesizer on converged findings
│
├─ Phase 9: Present findings with drill-down offer
│
└─ Phase 10: Suggest KB creation (conditional)
   └─ Knowledge agent (if user accepts and no existing KB)
```

## Principles

1. **Cross-validation** - Explorers validate and extend each other's findings, not disprove
2. **Parallel execution** - All explorers run simultaneously for speed
3. **Evidence-based** - Every claim requires file:line references
4. **Bounded validation** - Max 2 exchange rounds, then converge
5. **Structure over browsing** - Findings organized into actionable categories
6. **Cleanup always** - Team resources released even on failure

## Error Handling

- If fewer than 3 exploration areas warrant teammates: proceed with 2, note limited scope
- If all findings are unvalidated: report with explicit caveat about validation status
- If a teammate errors: continue with remaining teammates, note the gap
- If KB creation fails: log failure, report exploration results normally
