---
name: router
description: This skill should be used when classifying user intent for DevFlow mode, auto-loading relevant skills without explicit command invocation. Used by the always-on UserPromptSubmit hook.
user-invocable: false
# No allowed-tools: orchestrator requires unrestricted access (Skill, Agent, Edit, Write, Bash)
---

# Router

Classify user intent and auto-load relevant skills. Zero overhead for simple requests, skill loading + optional agent orchestration for substantive work.

**Note:** The UserPromptSubmit hook injects a detection-only preamble (classification rules only). This SKILL.md contains the full skill mappings — load it via Skill tool for complete routing logic.

## Iron Law

> **PROPORTIONAL RESPONSE MATCHED TO SCOPE**
>
> QUICK gets zero overhead. GUIDED gets skill loading + main session implementation
> with Simplifier cleanup. ORCHESTRATED gets full skill loading via the Skill tool plus
> agent pipeline execution. Misclassification in either direction is a failure —
> false-positive ORCHESTRATED is expensive (5-6 agent spawns), false-negative
> GUIDED leaves quality on the table.

---

## Step 1: Classify Intent

Determine what the user is trying to do from their prompt.

| Intent | Signal Words / Patterns |
|--------|------------------------|
| **CHAT** | greetings, meta-questions, confirmations, short responses |
| **EXPLORE** | "what is", "where is", "find", "show me", "explain", "how does" |
| **PLAN** | "how should", "design", "architecture", "approach", "strategy" |
| **IMPLEMENT** | "add", "create", "implement", "build", "write", "make" |
| **REVIEW** | "check", "look at", "review", "is this ok", "any issues" |
| **RESOLVE** | "resolve", "fix review issues", "address feedback", "fix findings" |
| **DEBUG** | "fix", "bug", "broken", "failing", "error", "why does" |
| **PIPELINE** | "end to end", "implement and review", "build and review", "full pipeline" |

**Ambiguous prompts:** "Update the README" → QUICK. Git operations like "commit this" → QUICK. Code-change prompts without clear scope → GUIDED (not QUICK).

## Step 2: Classify Depth

Determine how much enforcement the prompt warrants.

| Depth | Criteria | Action |
|-------|----------|--------|
| **QUICK** | CHAT intent. EXPLORE simple lookups ("where is X?"). Git/devops operations (commit, push, merge, branch, pr, deploy, reinstall). Single-word continuations. Rename/comment tweaks, config changes. 1-2 line edits. | Respond normally. Zero overhead. Do not state classification. |
| **GUIDED** | IMPLEMENT with small scope (≤2 files, single module). DEBUG with clear error location (stack trace, specific file, known function). PLAN for focused design questions (specific area/pattern). REVIEW (small scope — see below). | Load skills via Skill tool. Main session implements directly. Spawn Simplifier after code changes. State classification. |
| **ORCHESTRATED** | IMPLEMENT with larger scope (>2 files, multi-module, complex). DEBUG with vague/cross-cutting bug (no clear location, multiple possible causes). PLAN for system-level architecture (caching layer, auth system, multi-module design). REVIEW (large scope — see below). RESOLVE (always). PIPELINE (always). | Load skills via Skill tool, then orchestrate agents. State classification. |

**Scope-based decision criteria:**

| Intent | GUIDED (small scope) | ORCHESTRATED (large scope) |
|--------|---------------------|---------------------------|
| **IMPLEMENT** | ≤2 files, single module, clear task | >2 files, multi-module, complex |
| **DEBUG** | Clear error with known location (stack trace, specific file) | Vague/cross-cutting bug, multiple possible causes |
| **PLAN** | Focused question about specific area/pattern | System-level architecture, multi-module design |
| **EXPLORE** | Focused flow/module analysis, single subsystem | Multi-system architecture mapping, cross-cutting analysis |
| **REVIEW** | Continuation: match prior IMPLEMENT depth. Standalone: "check this"/"review this file" → GUIDED | Continuation: match prior IMPLEMENT depth. Standalone: "full review"/"branch review"/"PR review" → ORCHESTRATED |
| **RESOLVE** | — | Always ORCHESTRATED |
| **PIPELINE** | — | Always ORCHESTRATED |

**Classification conservatism:** When choosing between GUIDED and ORCHESTRATED, prefer GUIDED — escalate only when scope clearly exceeds main-session capacity. When choosing between QUICK and GUIDED, prefer GUIDED if the prompt involves code changes (implement, debug, fix, add, create code) or asks for analysis/explanation of a subsystem. Reserve QUICK for truly zero-overhead prompts: chat, simple lookups, git ops, config changes, trivial edits.

## Step 3: Select Skills

Based on classified intent and depth, invoke each selected skill using the Skill tool.

### GUIDED-depth skills

| Intent | Primary Skills | Secondary (if file type matches) |
|--------|---------------|----------------------------------|
| **IMPLEMENT** | devflow:test-driven-development, devflow:patterns, devflow:research | devflow:typescript (.ts), devflow:react (.tsx/.jsx), devflow:go (.go), devflow:java (.java), devflow:python (.py), devflow:rust (.rs), devflow:ui-design (CSS/UI), devflow:boundary-validation (forms/API), devflow:security (auth/crypto) |
| **EXPLORE** | devflow:explore | — |
| **DEBUG** | devflow:software-design, devflow:testing | devflow:git (if git operations involved) |
| **PLAN** | devflow:plan, devflow:patterns, devflow:software-design | — |
| **REVIEW** | devflow:self-review, devflow:software-design | devflow:testing |

### ORCHESTRATED-depth skills

| Intent | Primary Skills | Secondary (if file type matches) |
|--------|---------------|----------------------------------|
| **IMPLEMENT** | devflow:implement, devflow:patterns | devflow:typescript (.ts), devflow:react (.tsx/.jsx), devflow:go (.go), devflow:java (.java), devflow:python (.py), devflow:rust (.rs), devflow:ui-design (CSS/UI), devflow:boundary-validation (forms/API), devflow:security (auth/crypto) |
| **EXPLORE** | devflow:explore | — |
| **DEBUG** | devflow:debug, devflow:software-design | devflow:git (if git operations involved) |
| **PLAN** | devflow:plan, devflow:patterns, devflow:software-design | — |
| **REVIEW** | devflow:review | — (reviewers load their own pattern skills) |
| **RESOLVE** | devflow:resolve, devflow:software-design | — |
| **PIPELINE** | devflow:pipeline, devflow:patterns | — |

**Excluded from ambient loading** (loaded by agents internally): devflow:review-methodology, devflow:complexity, devflow:consistency, devflow:database, devflow:dependencies, devflow:documentation, devflow:regression, devflow:architecture, devflow:accessibility, devflow:performance, devflow:qa. These skills are always installed (universal skill installation) but loaded by Reviewer/Tester agents at runtime, not by the router.

See `references/skill-catalog.md` for the full skill-to-intent mapping with file pattern triggers.

## Step 4: Apply

<IMPORTANT>
When classification is GUIDED or ORCHESTRATED, skill loading is NON-NEGOTIABLE.
Do not rationalize skipping skills. Do not respond without loading them first.
BLOCKING REQUIREMENT: Your FIRST tool calls MUST be Skill tool invocations — before
writing ANY text about the task. Invoke all selected skills, THEN state classification,
THEN proceed with work. Do NOT write implementation text before all Skill tools return.
For IMPLEMENT intent, enforce TDD: write the failing test before ANY production code.
NOTE: Skills loaded in the main session via DevFlow mode are reference patterns only —
their allowed-tools metadata does NOT restrict your tool access. You retain full access
to all tools (Edit, Write, Bash, Agent, etc.) for implementation work.
</IMPORTANT>

- **QUICK:** Respond directly. No preamble, no classification statement.
- **GUIDED:** First, invoke each selected skill using the Skill tool. After all Skill tools return, state classification briefly: `DevFlow: IMPLEMENT/GUIDED. Loading: devflow:patterns, devflow:research.` Then work directly in main session. After code changes, spawn Simplifier on changed files.
- **ORCHESTRATED:** First, invoke each selected skill using the Skill tool. After all Skill tools return, state classification briefly: `DevFlow: IMPLEMENT/ORCHESTRATED. Loading: devflow:implement, devflow:patterns.` Then orchestrate agents per the loaded orchestration skill's pipeline.

### GUIDED Behavior by Intent

| Intent | Main Session Work | Post-Work |
|--------|------------------|-----------|
| **IMPLEMENT** | Implement directly with loaded skills. Follow TDD cycle. | Spawn Simplifier on changed files. |
| **EXPLORE** | Spawn Skimmer for orientation, then trace flow/analyze directly in main session. | No Simplifier (no code changes). |
| **DEBUG** | Investigate directly — reproduce bug, diagnose from stack trace/error, fix. | Spawn Simplifier on changed files. |
| **PLAN** | Spawn Skimmer for orientation, then design directly with loaded pattern/design skills. | No Simplifier (no code changes). |
| **REVIEW** | Review directly with loaded skills (self-review in main session). | No Simplifier. |

State classification as: `DevFlow: INTENT/DEPTH. Loading: [skills].` QUICK is silent.

## Edge Cases

| Case | Handling |
|------|----------|
| Mixed intent ("fix this bug and add a test") | Use the higher-overhead intent (IMPLEMENT > DEBUG) |
| Continuation of previous conversation | Inherit previous classification unless prompt clearly shifts |
| User explicitly requests no enforcement | Respect immediately — classify as QUICK |
| Prompt references specific DevFlow command | Skip ambient — the command has its own orchestration |
| Scope ambiguous between GUIDED and ORCHESTRATED | Default to GUIDED; escalate if complexity emerges during work |
| REVIEW after IMPLEMENT/GUIDED | GUIDED (continuation — match prior depth) |
| REVIEW after IMPLEMENT/ORCHESTRATED | ORCHESTRATED (continuation — match prior depth) |
| REVIEW standalone, large scope ("full review", "branch", "PR") | ORCHESTRATED |
| REVIEW standalone, small scope ("check this", specific file) | GUIDED |
| REVIEW standalone, ambiguous | GUIDED (conservative) |
| RESOLVE intent | Always ORCHESTRATED |
| PIPELINE intent | Always ORCHESTRATED |
| EXPLORE simple lookup ("where is X?") | QUICK — no skills needed |
| EXPLORE focused subsystem ("explain the auth flow") | GUIDED — Skimmer + main session trace |
| EXPLORE multi-system ("map the full architecture") | ORCHESTRATED — Skimmer + parallel Explore agents + Synthesizer |
| Multiple triggers per session | Each runs independently; context compaction handles accumulation |
