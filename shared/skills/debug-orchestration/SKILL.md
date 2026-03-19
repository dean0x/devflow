---
name: debug-orchestration
description: Agent orchestration for DEBUG intent — hypothesis investigation, root cause analysis, optional fix
user-invocable: false
allowed-tools: Read, Grep, Glob, Bash, Task, AskUserQuestion
---

# Debug Orchestration

Agent pipeline for DEBUG intent in ambient ORCHESTRATED mode. Competing hypothesis investigation, parallel evidence gathering, convergence validation, and optional fix.

## Iron Law

> **COMPETING HYPOTHESES BEFORE CONCLUSIONS**
>
> Never investigate a single theory. Generate 3-5 distinct hypotheses, investigate them
> in parallel, and let evidence determine the root cause. Confirmation bias is the enemy
> of debugging — multiple hypotheses are the antidote.

---

## Phase 1: Hypothesize

Analyze the bug description, error messages, and conversation context. Generate 3-5 hypotheses that are:

- **Specific**: Points to a concrete mechanism (not "something is wrong with auth")
- **Testable**: Can be confirmed or disproved by examining specific files/logs
- **Distinct**: Each hypothesis proposes a different root cause

If fewer than 3 hypotheses are possible, proceed with 2.

## Agent Budget

Hard cap: **8 total Explore agents** across all phases.

| Phase | Allocation |
|-------|-----------|
| Phase 2 (Investigate) | Up to 5 (one per hypothesis, 3-5 hypotheses) |
| Phase 3 (Converge — validation) | Up to 2 |
| Phase 3 (Converge — second round) | Remaining budget (typically 1) |

If budget is exhausted before convergence, ask user to narrow scope via AskUserQuestion rather than spawning more agents.

## Phase 2: Investigate (Parallel)

Spawn one Explore agent per hypothesis **in a single message** (parallel execution, max 5):

- Each investigator searches for evidence FOR and AGAINST its hypothesis
- Must provide file:line references for all evidence
- Returns verdict: **CONFIRMED** | **DISPROVED** | **PARTIAL** (some evidence supports, some contradicts)

## Phase 3: Converge

Evaluate investigation results:

- **One CONFIRMED**: Spawn 1-2 additional Explore agents to validate from different angles (prevent confirmation bias)
- **Multiple PARTIAL**: Look for a unifying root cause that explains all partial evidence
- **All DISPROVED**: Report honestly — "No root cause identified from initial hypotheses." Generate 2-3 second-round hypotheses if conversation context suggests avenues not yet explored.

## Phase 4: Report

Present root cause analysis:

- **Confidence level**: HIGH (confirmed + validated) | MEDIUM (partial convergence) | LOW (best guess from incomplete evidence)
- **Evidence table**: Hypothesis → verdict → key evidence (file:line)
- **Root cause**: Clear statement of what's wrong and why
- **Recommended fix**: Specific changes with file references

## Phase 5: Offer Fix

Ask user via AskUserQuestion: "Want me to implement this fix?"

- **YES** → Run the implementation-orchestration pipeline (load it via Skill tool): pre-flight → Coder → quality gates. The fix description becomes the EXECUTION_PLAN.
- **NO** → Done. Report stands as documentation.

## Error Handling

- **All hypotheses disproved, no second-round ideas**: Report "No root cause identified" with summary of what was investigated and ruled out
- **Explore agents return insufficient evidence**: Report LOW confidence with available evidence, suggest manual investigation areas
