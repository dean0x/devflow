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

Spawn investigator teammates with self-contained prompts:

- Name: "investigator-a"
  Prompt: |
    You are investigating a bug: {bug_description}
    Your hypothesis: {hypothesis A description}
    Focus area: {specific code area, mechanism, or condition}

    Steps:
    1. Read relevant code files in your focus area
    2. Trace data flow related to your hypothesis
    3. Collect evidence FOR your hypothesis (with file:line references)
    4. Collect evidence AGAINST your hypothesis (with file:line references)
    5. Document all findings
    6. Report completion:
       SendMessage(type: "message", recipient: "team-lead",
         summary: "Hypothesis A: initial findings ready")

- Name: "investigator-b"
  Prompt: |
    You are investigating a bug: {bug_description}
    Your hypothesis: {hypothesis B description}
    Focus area: {specific code area, mechanism, or condition}

    Steps:
    1. Read relevant code files in your focus area
    2. Trace data flow related to your hypothesis
    3. Collect evidence FOR your hypothesis (with file:line references)
    4. Collect evidence AGAINST your hypothesis (with file:line references)
    5. Document all findings
    6. Report completion:
       SendMessage(type: "message", recipient: "team-lead",
         summary: "Hypothesis B: initial findings ready")

- Name: "investigator-c"
  Prompt: |
    You are investigating a bug: {bug_description}
    Your hypothesis: {hypothesis C description}
    Focus area: {specific code area, mechanism, or condition}

    Steps:
    1. Read relevant code files in your focus area
    2. Trace data flow related to your hypothesis
    3. Collect evidence FOR your hypothesis (with file:line references)
    4. Collect evidence AGAINST your hypothesis (with file:line references)
    5. Document all findings
    6. Report completion:
       SendMessage(type: "message", recipient: "team-lead",
         summary: "Hypothesis C: initial findings ready")

(Add more investigators if bug complexity warrants 4-5 hypotheses — same pattern)
```

### Phase 3: Investigation

Teammates investigate in parallel:
- Read relevant source files
- Trace execution paths
- Check error handling
- Look for edge cases and race conditions
- Build evidence for or against their hypothesis

### Phase 4: Adversarial Debate

Lead initiates debate via broadcast:

```
SendMessage(type: "broadcast", summary: "Debate: share findings and challenge hypotheses"):
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

Teammates challenge each other directly using SendMessage:
- `SendMessage(type: "message", recipient: "investigator-b", summary: "Challenge: evidence at auth.ts:42")`
  "My evidence at `src/auth.ts:42` disproves your hypothesis because..."
- `SendMessage(type: "message", recipient: "investigator-a", summary: "Counter: Tuesday-only failure")`
  "Your theory doesn't explain why this only fails on Tuesdays..."
- `SendMessage(type: "message", recipient: "team-lead", summary: "Updated hypothesis")`
  "I've updated my hypothesis based on investigator-b's finding at..."

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

Shut down all investigator teammates explicitly:

```
For each teammate in [investigator-a, investigator-b, investigator-c, ...]:
  SendMessage(type: "shutdown_request", recipient: "{name}", content: "Investigation complete")
  Wait for shutdown_response (approve: true)

TeamDelete
Verify TeamDelete succeeded. If failed, retry once after 5s. If retry fails, HALT.
```

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
