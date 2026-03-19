---
name: ambient-router
description: This skill should be used when classifying user intent for ambient mode, auto-loading relevant skills without explicit command invocation. Used by /ambient command and always-on UserPromptSubmit hook.
user-invocable: false
allowed-tools: Read, Grep, Glob
---

# Ambient Router

Classify user intent and auto-load relevant skills. Zero overhead for simple requests, skill loading + agent orchestration for substantive work.

## Iron Law

> **ORCHESTRATED GETS SKILLS + AGENT ORCHESTRATION MATCHED TO INTENT**
>
> QUICK gets zero overhead. ORCHESTRATED gets full skill loading via the Skill tool plus
> agent pipeline execution. Misclassification in either direction is a failure —
> false-positive ORCHESTRATED is expensive (5-6 agent spawns), false-negative
> ORCHESTRATED leaves quality on the table.

---

## Step 1: Classify Intent

Determine what the user is trying to do from their prompt.

| Intent | Signal Words / Patterns | Examples |
|--------|------------------------|---------|
| **IMPLEMENT** | "add", "create", "implement", "build", "write", "make" | "add a login form", "create an API endpoint" |
| **DEBUG** | "fix", "bug", "broken", "failing", "error", "why does" | "fix the auth error", "why is this test failing" |
| **REVIEW** | "check", "look at", "review", "is this ok", "any issues" | "check this function", "any issues with this?" |
| **PLAN** | "how should", "design", "architecture", "approach", "strategy" | "how should I structure auth?", "what's the approach for caching?" |
| **EXPLORE** | "what is", "where is", "find", "show me", "explain", "how does" | "where is the config?", "explain this function" |
| **CHAT** | greetings, meta-questions, confirmations, short responses | "thanks", "yes", "what can you do?" |

**Ambiguous prompts:** Default to the lowest-overhead classification. "Update the README" → QUICK. Git operations like "commit this" → QUICK.

## Step 2: Classify Depth

Determine how much enforcement the prompt warrants.

| Depth | Criteria | Action |
|-------|----------|--------|
| **QUICK** | CHAT intent. EXPLORE intent. PLAN discussions without clear deliverable. Git/devops operations (commit, push, merge, branch, pr, deploy, reinstall). Single-word continuations. Small edits, config changes. | Respond normally. Zero overhead. Do not state classification. |
| **ORCHESTRATED** | IMPLEMENT with clear, scoped task. DEBUG with specific bug/error. PLAN with clear deliverable ("design the caching layer"). REVIEW with code to review. Multi-file changes with defined scope. | Load skills via Skill tool, then orchestrate agents per Step 5. State classification. |

**Classification conservatism:** Default to QUICK. Only classify ORCHESTRATED when the prompt has clear task scope. ORCHESTRATED triggers agent spawning which has real cost. When in doubt, QUICK.

## Step 3: Select Skills (ORCHESTRATED depth only)

Based on classified intent, invoke each selected skill using the Skill tool.

| Intent | Primary Skills | Secondary (if file type matches) |
|--------|---------------|----------------------------------|
| **IMPLEMENT** | implementation-orchestration, implementation-patterns | typescript (.ts), react (.tsx/.jsx), go (.go), java (.java), python (.py), rust (.rs), frontend-design (CSS/UI), input-validation (forms/API), security-patterns (auth/crypto) |
| **DEBUG** | debug-orchestration, core-patterns | git-safety (if git operations involved) |
| **PLAN** | plan-orchestration, implementation-patterns, core-patterns | — |
| **REVIEW** | self-review, core-patterns | test-patterns |

**Excluded from ambient** (review-command-only): review-methodology, complexity-patterns, consistency-patterns, database-patterns, dependencies-patterns, documentation-patterns, regression-patterns, architecture-patterns, accessibility, performance-patterns.

See `references/skill-catalog.md` for the full skill-to-intent mapping with file pattern triggers.

## Step 4: Apply

<IMPORTANT>
When classification is ORCHESTRATED, skill loading is NON-NEGOTIABLE.
Do not rationalize skipping skills. Do not respond without loading them first.
BLOCKING REQUIREMENT: Invoke each selected skill using the Skill tool before proceeding.
</IMPORTANT>

- **QUICK:** Respond directly. No preamble, no classification statement.
- **ORCHESTRATED:** State classification briefly: `Ambient: IMPLEMENT/ORCHESTRATED. Loading: implementation-orchestration, implementation-patterns.` Then invoke each skill using the Skill tool and follow Step 5 for agent orchestration.

## Step 5: Orchestrate Agents (ORCHESTRATED depth only)

After loading skills via Step 3-4, execute the agent pipeline for the classified intent:

| Intent | Pipeline |
|--------|----------|
| **IMPLEMENT** | Follow implementation-orchestration skill pipeline: pre-flight → plan synthesis → Coder → quality gates |
| **DEBUG** | Follow debug-orchestration skill pipeline: hypotheses → parallel Explores → convergence → report → offer fix |
| **PLAN** | Follow plan-orchestration skill pipeline: Skimmer → Explores → Plan agent → gap validation |
| **REVIEW** | Spawn single Reviewer agent with focus derived from prompt (e.g., "check security" → security-patterns focus; vague prompt → general review across all pillars) |
| **EXPLORE** | No agents — respond in main session |
| **CHAT** | No agents — respond in main session |

---

## Transparency Rules

1. **QUICK → silent.** No classification output.
2. **ORCHESTRATED → brief statement + full skill enforcement + agent orchestration.** One line: intent, depth, skills loaded. Then follow every skill requirement and orchestrate agents per Step 5.
3. **Never lie about classification.** If uncertain, say so.
4. **Never over-classify.** When in doubt, QUICK.
5. **Never under-apply.** Rationalization is the enemy of quality. If a skill requires a step, do the step.

## Edge Cases

| Case | Handling |
|------|----------|
| Mixed intent ("fix this bug and add a test") | Use the higher-overhead intent (IMPLEMENT > DEBUG) |
| Continuation of previous conversation | Inherit previous classification unless prompt clearly shifts |
| User explicitly requests no enforcement | Respect immediately — classify as QUICK |
| Prompt references specific DevFlow command | Skip ambient — the command has its own orchestration |
| Multi-file change with clear scope | ORCHESTRATED |
| Multiple ORCHESTRATED triggers per session | Each runs independently; context compaction handles accumulation |
