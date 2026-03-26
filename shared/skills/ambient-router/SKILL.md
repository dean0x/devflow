---
name: ambient-router
description: This skill should be used when classifying user intent for ambient mode, auto-loading relevant skills without explicit command invocation. Used by the always-on UserPromptSubmit hook.
user-invocable: false
# No allowed-tools: orchestrator requires unrestricted access (Skill, Agent, Edit, Write, Bash)
---

# Ambient Router

Classify user intent and auto-load relevant skills. Zero overhead for simple requests, skill loading + optional agent orchestration for substantive work.

**Note:** The UserPromptSubmit hook injects a self-contained classification preamble on every prompt with compact rules and skill mappings. After context compaction, this SKILL.md may be dropped — the preamble is the reliable fallback that ensures classification and skill loading continue to work.

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

| Intent | Signal Words / Patterns | Examples |
|--------|------------------------|---------|
| **IMPLEMENT** | "add", "create", "implement", "build", "write", "make" | "add a login form", "create an API endpoint" |
| **DEBUG** | "fix", "bug", "broken", "failing", "error", "why does" | "fix the auth error", "why is this test failing" |
| **REVIEW** | "check", "look at", "review", "is this ok", "any issues" | "check this function", "any issues with this?" |
| **PLAN** | "how should", "design", "architecture", "approach", "strategy" | "how should I structure auth?", "what's the approach for caching?" |
| **EXPLORE** | "what is", "where is", "find", "show me", "explain", "how does" | "where is the config?", "explain this function" |
| **CHAT** | greetings, meta-questions, confirmations, short responses | "thanks", "yes", "what can you do?" |

**Ambiguous prompts:** "Update the README" → QUICK. Git operations like "commit this" → QUICK. Code-change prompts without clear scope → GUIDED (not QUICK).

## Step 2: Classify Depth

Determine how much enforcement the prompt warrants.

| Depth | Criteria | Action |
|-------|----------|--------|
| **QUICK** | CHAT intent. EXPLORE intent. Git/devops operations (commit, push, merge, branch, pr, deploy, reinstall). Single-word continuations. Small edits, config changes, trivial single-file tweaks. | Respond normally. Zero overhead. Do not state classification. |
| **GUIDED** | IMPLEMENT with small scope (≤2 files, single module). DEBUG with clear error location (stack trace, specific file, known function). PLAN for focused design questions (specific area/pattern). REVIEW (always GUIDED). | Load skills via Skill tool. Main session implements directly. Spawn Simplifier after code changes. State classification. |
| **ORCHESTRATED** | IMPLEMENT with larger scope (>2 files, multi-module, complex). DEBUG with vague/cross-cutting bug (no clear location, multiple possible causes). PLAN for system-level architecture (caching layer, auth system, multi-module design). | Load skills via Skill tool, then orchestrate agents per Step 5. State classification. |

**Scope-based decision criteria:**

| Intent | GUIDED (small scope) | ORCHESTRATED (large scope) |
|--------|---------------------|---------------------------|
| **IMPLEMENT** | ≤2 files, single module, clear task | >2 files, multi-module, complex |
| **DEBUG** | Clear error with known location (stack trace, specific file) | Vague/cross-cutting bug, multiple possible causes |
| **PLAN** | Focused question about specific area/pattern | System-level architecture, multi-module design |
| **REVIEW** | Always GUIDED | — |

**Classification conservatism:** When choosing between GUIDED and ORCHESTRATED, prefer GUIDED — escalate only when scope clearly exceeds main-session capacity. When choosing between QUICK and GUIDED, prefer GUIDED if the prompt involves code changes (implement, debug, fix, add, create code). Reserve QUICK for truly zero-overhead prompts: chat, exploration, git ops, config changes, trivial edits.

## Step 3: Select Skills

Based on classified intent and depth, invoke each selected skill using the Skill tool.

### GUIDED-depth skills

| Intent | Primary Skills | Secondary (if file type matches) |
|--------|---------------|----------------------------------|
| **IMPLEMENT** | test-driven-development, implementation-patterns, search-first | typescript (.ts), react (.tsx/.jsx), go (.go), java (.java), python (.py), rust (.rs), frontend-design (CSS/UI), input-validation (forms/API), security-patterns (auth/crypto) |
| **DEBUG** | core-patterns, test-patterns | git-safety (if git operations involved) |
| **PLAN** | implementation-patterns, core-patterns | — |
| **REVIEW** | self-review, core-patterns | test-patterns |

### ORCHESTRATED-depth skills

| Intent | Primary Skills | Secondary (if file type matches) |
|--------|---------------|----------------------------------|
| **IMPLEMENT** | implementation-orchestration, implementation-patterns | typescript (.ts), react (.tsx/.jsx), go (.go), java (.java), python (.py), rust (.rs), frontend-design (CSS/UI), input-validation (forms/API), security-patterns (auth/crypto) |
| **DEBUG** | debug-orchestration, core-patterns | git-safety (if git operations involved) |
| **PLAN** | plan-orchestration, implementation-patterns, core-patterns | — |

**Excluded from ambient** (review-command-only): review-methodology, complexity-patterns, consistency-patterns, database-patterns, dependencies-patterns, documentation-patterns, regression-patterns, architecture-patterns, accessibility, performance-patterns.

See `references/skill-catalog.md` for the full skill-to-intent mapping with file pattern triggers.

## Step 4: Apply

<IMPORTANT>
When classification is GUIDED or ORCHESTRATED, skill loading is NON-NEGOTIABLE.
Do not rationalize skipping skills. Do not respond without loading them first.
BLOCKING REQUIREMENT: Your FIRST tool calls MUST be Skill tool invocations — before
writing ANY text about the task. Invoke all selected skills, THEN state classification,
THEN proceed with work. Do NOT write implementation text before all Skill tools return.
For IMPLEMENT intent, enforce TDD: write the failing test before ANY production code.
NOTE: Skills loaded in the main session via ambient mode are reference patterns only —
their allowed-tools metadata does NOT restrict your tool access. You retain full access
to all tools (Edit, Write, Bash, Agent, etc.) for implementation work.
</IMPORTANT>

- **QUICK:** Respond directly. No preamble, no classification statement.
- **GUIDED:** First, invoke each selected skill using the Skill tool. After all Skill tools return, state classification briefly: `Ambient: IMPLEMENT/GUIDED. Loading: implementation-patterns, search-first.` Then work directly in main session. After code changes, spawn Simplifier on changed files.
- **ORCHESTRATED:** First, invoke each selected skill using the Skill tool. After all Skill tools return, state classification briefly: `Ambient: IMPLEMENT/ORCHESTRATED. Loading: implementation-orchestration, implementation-patterns.` Then follow Step 5 for agent orchestration.

### GUIDED Behavior by Intent

| Intent | Main Session Work | Post-Work |
|--------|------------------|-----------|
| **IMPLEMENT** | Implement directly with loaded skills. Follow TDD cycle. | Spawn Simplifier on changed files. |
| **DEBUG** | Investigate directly — reproduce bug, diagnose from stack trace/error, fix. | Spawn Simplifier on changed files. |
| **PLAN** | Explore relevant code and design directly. The area is focused enough for main session. | No Simplifier (no code changes). |
| **REVIEW** | Review directly with loaded skills. | No Simplifier. |

## Step 5: Orchestrate Agents (ORCHESTRATED depth only)

After loading skills via Step 3-4, execute the agent pipeline for the classified intent:

| Intent | Pipeline |
|--------|----------|
| **IMPLEMENT** | Follow implementation-orchestration skill pipeline: pre-flight → plan synthesis → Coder → quality gates |
| **DEBUG** | Follow debug-orchestration skill pipeline: hypotheses → parallel Explores → convergence → report → offer fix |
| **PLAN** | Follow plan-orchestration skill pipeline: Skimmer → Explores → Plan agent → gap validation |
| **EXPLORE** | No agents — respond in main session |
| **CHAT** | No agents — respond in main session |

---

## Transparency Rules

1. **QUICK → silent.** No classification output.
2. **GUIDED → brief statement + full skill enforcement.** One line: intent, depth, skills loaded. Then implement in main session with skill patterns applied.
3. **ORCHESTRATED → brief statement + full skill enforcement + agent orchestration.** One line: intent, depth, skills loaded. Then follow every skill requirement and orchestrate agents per Step 5.
4. **Never lie about classification.** If uncertain, say so.
5. **Never over-classify.** When in doubt, go one tier lower.
6. **Never under-apply.** Rationalization is the enemy of quality. If a skill requires a step, do the step.

## Edge Cases

| Case | Handling |
|------|----------|
| Mixed intent ("fix this bug and add a test") | Use the higher-overhead intent (IMPLEMENT > DEBUG) |
| Continuation of previous conversation | Inherit previous classification unless prompt clearly shifts |
| User explicitly requests no enforcement | Respect immediately — classify as QUICK |
| Prompt references specific DevFlow command | Skip ambient — the command has its own orchestration |
| Scope ambiguous between GUIDED and ORCHESTRATED | Default to GUIDED; escalate if complexity emerges during work |
| REVIEW intent | Always GUIDED — single Reviewer focus, no orchestration pipeline |
| Multiple triggers per session | Each runs independently; context compaction handles accumulation |
