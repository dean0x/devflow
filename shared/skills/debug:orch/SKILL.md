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

## Phase 1: Load Knowledge Index (Orchestrator-Local)

**Produces:** KNOWLEDGE_CONTEXT, FEATURE_KNOWLEDGE

Before hypothesizing, load the knowledge index:

```bash
KNOWLEDGE_CONTEXT=$(node scripts/hooks/lib/knowledge-context.cjs index "{worktree}")
```

The orchestrator uses `KNOWLEDGE_CONTEXT` locally when generating hypotheses (Phase 1) — prior pitfalls and decisions can suggest specific root causes to investigate. Follow `devflow:apply-knowledge` to Read full entry bodies on demand. **Do NOT pass `KNOWLEDGE_CONTEXT` to Explore sub-agents** — knowledge context stays in the orchestrator, not in the investigation workers.

Also load feature knowledge:
1. Read `.features/index.json` if it exists
2. Based on the bug description, identify relevant KBs
3. Read matching KB files, check staleness via `node scripts/hooks/lib/feature-kb.cjs stale "{worktree}" {slug}`
4. Use `FEATURE_KNOWLEDGE` **locally** for hypothesis generation — feature-specific gotchas and anti-patterns suggest root causes
5. **Do NOT pass to Explore sub-agents** (same asymmetric pattern as KNOWLEDGE_CONTEXT)

## Phase 2: Hypothesize

**Produces:** HYPOTHESES
**Requires:** KNOWLEDGE_CONTEXT

Analyze the bug description, error messages, and conversation context. Generate 3-5 hypotheses that are:

- **Specific**: Points to a concrete mechanism (not "something is wrong with auth")
- **Testable**: Can be confirmed or disproved by examining specific files/logs
- **Distinct**: Each hypothesis proposes a different root cause

If fewer than 3 hypotheses are possible, proceed with 2.

## Phase 3: Investigate (Parallel)

**Produces:** INVESTIGATION_RESULTS
**Requires:** HYPOTHESES

Spawn one `Agent(subagent_type="Explore")` per hypothesis **in a single message** (parallel execution):

- Each investigator searches for evidence FOR and AGAINST its hypothesis
- Must provide file:line references for all evidence
- Returns verdict: **CONFIRMED** | **DISPROVED** | **PARTIAL** (some evidence supports, some contradicts)

## Phase 4: Converge

**Produces:** CONVERGENCE_DECISION
**Requires:** INVESTIGATION_RESULTS

Evaluate investigation results:

- **One CONFIRMED**: Spawn 1-2 additional `Agent(subagent_type="Explore")` agents to validate from different angles (prevent confirmation bias)
- **Multiple PARTIAL**: Look for a unifying root cause that explains all partial evidence
- **All DISPROVED**: Report honestly — "No root cause identified from initial hypotheses." Generate 2-3 second-round hypotheses if conversation context suggests avenues not yet explored.

## Phase 5: Report

**Produces:** ROOT_CAUSE_REPORT
**Requires:** CONVERGENCE_DECISION, INVESTIGATION_RESULTS

Present root cause analysis:

- **Confidence level**: HIGH (confirmed + validated) | MEDIUM (partial convergence) | LOW (best guess from incomplete evidence)
- **Evidence table**: Hypothesis → verdict → key evidence (file:line)
- **Root cause**: Clear statement of what's wrong and why
- **Recommended fix**: Specific changes with file references

## Phase 6: Offer Fix

**Requires:** ROOT_CAUSE_REPORT

Ask user via AskUserQuestion: "Want me to implement this fix?"

- **YES** → Implement the fix directly in main session using GUIDED approach: load devflow:patterns, devflow:research, and devflow:test-driven-development skills, then code the fix. Spawn `Agent(subagent_type="Simplifier")` on changed files after.
- **NO** → Done. Report stands as documentation.

## Error Handling

- **All hypotheses disproved, no second-round ideas**: Report "No root cause identified" with summary of what was investigated and ruled out
- **Explore agents return insufficient evidence**: Report LOW confidence with available evidence, suggest manual investigation areas

## Phase Completion Checklist

Before reporting results, verify every phase was announced:

- [ ] Phase 1: Load Knowledge Index → KNOWLEDGE_CONTEXT captured, FEATURE_KNOWLEDGE loaded (orchestrator-local only, or skipped if `.features/` absent)
- [ ] Phase 2: Hypothesize → HYPOTHESES captured (3-5 distinct)
- [ ] Phase 3: Investigate → INVESTIGATION_RESULTS captured per hypothesis
- [ ] Phase 4: Converge → CONVERGENCE_DECISION captured
- [ ] Phase 5: Report → ROOT_CAUSE_REPORT presented
- [ ] Phase 6: Offer Fix → User asked, response handled

If any phase is unchecked, execute it before proceeding.
