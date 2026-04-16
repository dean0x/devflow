---
name: debug:orch
description: Agent orchestration for DEBUG intent — hypothesis investigation, root cause analysis, optional fix
user-invocable: false
---

# Debug Orchestration

Agent pipeline for DEBUG intent in ambient ORCHESTRATED mode. Competing hypothesis investigation, parallel evidence gathering, convergence validation, and optional fix.

This is a lightweight variant of `/debug` for ambient ORCHESTRATED mode. Excluded: knowledge persistence loading, GitHub issue fetching, pitfall recording.

## Iron Law

> **COMPETING HYPOTHESES BEFORE CONCLUSIONS**
>
> Never investigate a single theory. Generate 3-5 distinct hypotheses, investigate them
> in parallel, and let evidence determine the root cause. Confirmation bias is the enemy
> of debugging — multiple hypotheses are the antidote.

---

## Worktree Support

If the orchestrator receives a `WORKTREE_PATH` context (e.g., from multi-worktree workflows), pass it through to all spawned agents. Each agent's "Worktree Support" section handles path resolution.

## Phase 0: Load Knowledge Index (Orchestrator-Local)

Before hypothesizing, load the knowledge index:

```bash
KNOWLEDGE_CONTEXT=$(node scripts/hooks/lib/knowledge-context.cjs index "{worktree}")
```

The orchestrator uses `KNOWLEDGE_CONTEXT` locally when generating hypotheses (Phase 1) — prior pitfalls and decisions can suggest specific root causes to investigate. Follow `devflow:apply-knowledge` to Read full entry bodies on demand. **Do NOT pass `KNOWLEDGE_CONTEXT` to Explore sub-agents** — knowledge context stays in the orchestrator, not in the investigation workers.

## Phase 1: Hypothesize

Analyze the bug description, error messages, and conversation context. Generate 3-5 hypotheses that are:

- **Specific**: Points to a concrete mechanism (not "something is wrong with auth")
- **Testable**: Can be confirmed or disproved by examining specific files/logs
- **Distinct**: Each hypothesis proposes a different root cause

If fewer than 3 hypotheses are possible, proceed with 2.

## Phase 2: Investigate (Parallel)

Spawn one `Agent(subagent_type="Explore")` per hypothesis **in a single message** (parallel execution):

- Each investigator searches for evidence FOR and AGAINST its hypothesis
- Must provide file:line references for all evidence
- Returns verdict: **CONFIRMED** | **DISPROVED** | **PARTIAL** (some evidence supports, some contradicts)

## Phase 3: Converge

Evaluate investigation results:

- **One CONFIRMED**: Spawn 1-2 additional `Agent(subagent_type="Explore")` agents to validate from different angles (prevent confirmation bias)
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

- **YES** → Implement the fix directly in main session using GUIDED approach: load devflow:patterns, devflow:research, and devflow:test-driven-development skills, then code the fix. Spawn `Agent(subagent_type="Simplifier")` on changed files after.
- **NO** → Done. Report stands as documentation.

## Error Handling

- **All hypotheses disproved, no second-round ideas**: Report "No root cause identified" with summary of what was investigated and ruled out
- **Explore agents return insufficient evidence**: Report LOW confidence with available evidence, suggest manual investigation areas
