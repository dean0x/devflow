---
description: Debug issues using competing hypothesis investigation with parallel agents
---

# Debug Command

Investigate bugs by spawning parallel agents, each pursuing a different hypothesis. Evidence is aggregated and synthesized to identify the root cause.

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

### Phase 1: Load Project Knowledge

Read `.memory/knowledge/decisions.md` and `.memory/knowledge/pitfalls.md`. Known pitfalls from prior debugging sessions and code reviews can directly inform hypothesis generation — pass their content as context to investigators in Phase 2.

### Phase 2: Context Gathering

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

### Phase 3: Investigate (Parallel)

Spawn one Explore agent per hypothesis in a **single message** (parallel execution):

```
Task(subagent_type="Explore"):
"Investigate this bug: {bug_description}

Hypothesis: {hypothesis A description}
Focus area: {specific code area, mechanism, or condition}

Steps:
1. Read relevant code files in your focus area
2. Trace data flow related to this hypothesis
3. Collect evidence FOR this hypothesis (with file:line references)
4. Collect evidence AGAINST this hypothesis (with file:line references)

Return a structured report:
- Hypothesis: {restate}
- Status: CONFIRMED / DISPROVED / PARTIAL
- Evidence FOR: [list with file:line refs]
- Evidence AGAINST: [list with file:line refs]
- Key finding: {one-sentence summary}"

Task(subagent_type="Explore"):
"Investigate this bug: {bug_description}

Hypothesis: {hypothesis B description}
Focus area: {specific code area, mechanism, or condition}

[same steps and return format]"

Task(subagent_type="Explore"):
"Investigate this bug: {bug_description}

Hypothesis: {hypothesis C description}
Focus area: {specific code area, mechanism, or condition}

[same steps and return format]"

(Add more investigators if bug complexity warrants 4-5 hypotheses)
```

### Phase 4: Synthesize

Once all investigators return, spawn a Synthesizer agent to aggregate findings:

```
Task(subagent_type="Synthesizer"):
"You are a root cause analyst. Synthesize these investigation reports:

{paste all investigator reports}

Instructions:
1. Compare evidence across all hypotheses
2. Identify which hypothesis has the strongest evidence
3. Note contradictions between investigators
4. Determine overall root cause (may combine partial findings)
5. Assess confidence level based on evidence strength"
```

### Phase 5: Report

Produce the final report:

```markdown
## Root Cause Analysis: {bug description}

### Root Cause
{Description of the root cause supported by evidence}
{Key evidence with file:line references}

### Investigation Summary

| Hypothesis | Status | Key Evidence |
|-----------|--------|-------------|
| A: {description} | CONFIRMED/DISPROVED/PARTIAL | {file:line + summary} |
| B: {description} | CONFIRMED/DISPROVED/PARTIAL | {file:line + summary} |
| C: {description} | CONFIRMED/DISPROVED/PARTIAL | {file:line + summary} |

### Key Findings
{2-3 most important discoveries across all investigators}

### Recommended Fix
{Concrete action items with file references}

### Confidence Level
{HIGH/MEDIUM/LOW based on evidence strength and investigator agreement}
```

### Phase 6: Record Pitfall (if root cause found)

If root cause was identified with HIGH or MEDIUM confidence:
1. Read `~/.claude/skills/knowledge-persistence/SKILL.md` and follow its extraction procedure to record pitfalls to `.memory/knowledge/pitfalls.md`
2. Source field: `/debug {bug description}`

## Architecture

```
/debug (orchestrator)
│
├─ Phase 1: Load Project Knowledge
│
├─ Phase 2: Context gathering
│  └─ Git agent (fetch issue, if #N provided)
│
├─ Phase 3: Parallel investigation
│  └─ 3-5 Explore agents, one per hypothesis (single message)
│
├─ Phase 4: Synthesize
│  └─ Synthesizer aggregates and compares findings
│
├─ Phase 5: Root cause report with confidence level
│
└─ Phase 6: Record Pitfall (inline, if root cause found)
```

## Principles

1. **Competing hypotheses** - Never investigate a single theory; always have alternatives
2. **Parallel execution** - All investigators run simultaneously for speed
3. **Evidence-based** - Every claim requires file:line references
4. **Honest uncertainty** - If no hypothesis survives, report that clearly

## Error Handling

- If fewer than 3 hypotheses can be generated: proceed with 2, note limited scope
- If all hypotheses are disproved: report "No root cause identified" with investigation summary
- If an investigator errors: continue with remaining results, note the gap
