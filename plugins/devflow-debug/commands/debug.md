---
description: Debug issues using competing hypothesis investigation with an agent team
---

# Debug Command

Investigate bugs by spawning a team of agents, each pursuing a different hypothesis. Agents actively try to disprove each other's theories, converging on the root cause that survives scrutiny.

## Usage

```
/debug "description of bug or issue"
/debug "function returns undefined when called with empty array"
/debug #42   (investigate bug from GitHub issue)
```

## Input

`$ARGUMENTS` contains whatever follows `/debug`:
- Bug description: "login fails after session timeout"
- GitHub issue: "#42"
- Empty: use conversation context

## Phases

### Phase 1: Context Gathering

If `$ARGUMENTS` starts with `#`, fetch the GitHub issue:

```
Task(subagent_type="Git"):
"OPERATION: fetch-issue
ISSUE: {issue number}
Return issue title, body, labels, and any linked error logs."
```

Analyze the bug description (from arguments or issue) and identify 3-5 plausible hypotheses. Each hypothesis must be:
- **Specific**: Points to a concrete mechanism (not "something is wrong")
- **Testable**: Can be confirmed or disproved by reading code/logs
- **Distinct**: Does not overlap significantly with other hypotheses

### Phase 2: Spawn Investigation Team

Create an agent team with one investigator per hypothesis:

```
Create a team named "debug-{bug-slug}" to investigate: {bug_description}

Spawn teammates:
- "Investigator A: {hypothesis A description}"
  Focus: {specific code area, mechanism, or condition to investigate}

- "Investigator B: {hypothesis B description}"
  Focus: {specific code area, mechanism, or condition to investigate}

- "Investigator C: {hypothesis C description}"
  Focus: {specific code area, mechanism, or condition to investigate}

(Add more if bug complexity warrants 4-5 hypotheses)

Each investigator:
1. Read relevant code files
2. Trace data flow related to their hypothesis
3. Look for evidence that CONFIRMS or DISPROVES the hypothesis
4. Document findings with file:line references
```

### Phase 3: Investigation

Teammates investigate in parallel:
- Read relevant source files
- Trace execution paths
- Check error handling
- Look for edge cases and race conditions
- Build evidence for or against their hypothesis

### Phase 4: Adversarial Debate

Lead broadcasts to all teammates:

```
"Investigation complete. Share your findings:
1. State your hypothesis
2. Present evidence FOR (with file:line references)
3. Present evidence AGAINST
4. Challenge at least one other investigator's hypothesis

Rules:
- You must try to DISPROVE other hypotheses, not just support your own
- Cite specific code when challenging
- If your hypothesis is disproved, acknowledge it
- Max 2 exchange rounds before we converge"
```

Teammates message each other directly:
- "My evidence at `src/auth.ts:42` disproves your hypothesis because..."
- "Your theory doesn't explain why this only fails on Tuesdays..."
- "I've updated my hypothesis based on your finding at..."

### Phase 5: Convergence

After debate (max 2 rounds), lead collects results:

```
Lead broadcast:
"Debate complete. Each investigator: submit final status.
- CONFIRMED: Your hypothesis survived scrutiny (evidence summary)
- DISPROVED: Your hypothesis was invalidated (what disproved it)
- PARTIAL: Some aspects confirmed, others not (details)"
```

### Phase 6: Cleanup

Lead shuts down all teammates and calls cleanup.

### Phase 7: Report

Lead produces final report:

```markdown
## Root Cause Analysis: {bug description}

### Root Cause (Consensus)
{Description of the root cause that survived peer scrutiny}
{Key evidence with file:line references}

### Investigation Summary

| Hypothesis | Status | Key Evidence |
|-----------|--------|-------------|
| A: {description} | CONFIRMED/DISPROVED/PARTIAL | {file:line + summary} |
| B: {description} | CONFIRMED/DISPROVED/PARTIAL | {file:line + summary} |
| C: {description} | CONFIRMED/DISPROVED/PARTIAL | {file:line + summary} |

### Key Debate Exchanges
{2-3 most important exchanges that led to the conclusion}

### Recommended Fix
{Concrete action items with file references}

### Confidence Level
{HIGH/MEDIUM/LOW based on consensus strength}
```

## Architecture

```
/debug (orchestrator)
│
├─ Phase 1: Context gathering
│  └─ Git agent (fetch issue, if #N provided)
│
├─ Phase 2: Spawn investigation team
│  └─ Create team with 3-5 hypothesis investigators
│
├─ Phase 3: Parallel investigation
│  └─ Each teammate investigates independently
│
├─ Phase 4: Adversarial debate
│  └─ Teammates challenge each other directly (max 2 rounds)
│
├─ Phase 5: Convergence
│  └─ Teammates submit final hypothesis status
│
├─ Phase 6: Cleanup
│  └─ Shut down teammates, release resources
│
└─ Phase 7: Root cause report with confidence level
```

## Principles

1. **Competing hypotheses** - Never investigate a single theory; always have alternatives
2. **Adversarial debate** - Agents must actively try to disprove each other
3. **Evidence-based** - Every claim requires file:line references
4. **Bounded debate** - Max 2 exchange rounds, then converge
5. **Honest uncertainty** - If no hypothesis survives, report that clearly
6. **Cleanup always** - Team resources released even on failure

## Error Handling

- If fewer than 3 hypotheses can be generated: proceed with 2, note limited scope
- If all hypotheses are disproved: report "No root cause identified" with investigation summary
- If team spawning fails: fall back to sequential subagent investigation (one per hypothesis)
- If a teammate errors: continue with remaining teammates, note the gap
