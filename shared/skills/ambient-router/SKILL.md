---
name: ambient-router
description: >-
  Classify user intent and response depth for ambient mode. Auto-loads relevant
  skills without explicit command invocation. Used by /ambient command and
  always-on UserPromptSubmit hook.
user-invocable: false
allowed-tools: Read, Grep, Glob
---

# Ambient Router

Classify user intent and auto-load relevant skills. Zero overhead for simple requests, skill injection for substantive work, workflow nudges for complex tasks.

## Iron Law

> **PROPORTIONAL RESPONSE**
>
> Match effort to intent. Never apply heavyweight processes to lightweight requests.
> A chat question gets zero overhead. A 3-file feature gets 2-3 skills. A system
> refactor gets a nudge toward `/implement`. Misclassification in either direction
> is a failure.

---

## Step 1: Classify Intent

Determine what the user is trying to do from their prompt.

| Intent | Signal Words / Patterns | Examples |
|--------|------------------------|---------|
| **BUILD** | "add", "create", "implement", "build", "write", "make" | "add a login form", "create an API endpoint" |
| **DEBUG** | "fix", "bug", "broken", "failing", "error", "why does" | "fix the auth error", "why is this test failing" |
| **REVIEW** | "check", "look at", "review", "is this ok", "any issues" | "check this function", "any issues with this?" |
| **PLAN** | "how should", "design", "architecture", "approach", "strategy" | "how should I structure auth?", "what's the approach for caching?" |
| **EXPLORE** | "what is", "where is", "find", "show me", "explain", "how does" | "where is the config?", "explain this function" |
| **CHAT** | greetings, meta-questions, confirmations, short responses | "thanks", "yes", "what can you do?" |

**Ambiguous prompts:** Default to the lowest-overhead classification. "Update the README" → BUILD/GUIDED. Git operations like "commit this" → QUICK.

## Step 2: Classify Depth

Determine how much enforcement the prompt warrants.

| Depth | Criteria | Action |
|-------|----------|--------|
| **QUICK** | CHAT intent. EXPLORE with no analytical depth ("where is X?"). Git/devops operations (commit, push, merge, branch, pr, deploy, reinstall). Single-word continuations. | Respond normally. Zero overhead. Do not state classification. |
| **GUIDED** | BUILD/DEBUG/REVIEW/PLAN intent (any word count). EXPLORE with analytical depth ("analyze our X", "discuss how Y works"). | Read and apply 2-3 relevant skills from the selection matrix below. State classification briefly. |
| **ELEVATE** | Multi-file architectural change, system-wide scope, > 5 files. Detailed implementation plan (100+ words with plan structure). | Respond at best effort + recommend: "This looks like it would benefit from `/implement` for full lifecycle management." |

## Step 3: Select Skills (GUIDED depth only)

Based on classified intent, read the following skills to inform your response.

| Intent | Primary Skills | Secondary (if file type matches) |
|--------|---------------|----------------------------------|
| **BUILD** | test-driven-development, implementation-patterns | typescript (.ts), react (.tsx/.jsx), go (.go), java (.java), python (.py), rust (.rs), frontend-design (CSS/UI), input-validation (forms/API), security-patterns (auth/crypto) |
| **DEBUG** | test-patterns, core-patterns | git-safety (if git operations involved) |
| **REVIEW** | self-review, core-patterns | test-patterns |
| **PLAN** | implementation-patterns | core-patterns |

**Excluded from ambient** (review-command-only): review-methodology, complexity-patterns, consistency-patterns, database-patterns, dependencies-patterns, documentation-patterns, regression-patterns, architecture-patterns, accessibility.

See `references/skill-catalog.md` for the full skill-to-intent mapping with file pattern triggers.

## Step 4: Apply

<IMPORTANT>
When classification is GUIDED or ELEVATE, skill application is NON-NEGOTIABLE.
Do not rationalize skipping skills. Do not respond without loading them first.
If test-driven-development is selected, you MUST write the failing test before ANY production code.
</IMPORTANT>

- **QUICK:** Respond directly. No preamble, no classification statement.
- **GUIDED:** State classification briefly: `Ambient: BUILD/GUIDED. Loading: test-driven-development, implementation-patterns.` Then read the selected skills and apply their patterns. No exceptions.
- **ELEVATE:** Respond with your best effort, then append: `> This task spans multiple files/systems. Consider \`/implement\` for full lifecycle.`

---

## Transparency Rules

1. **QUICK → silent.** No classification output.
2. **GUIDED → brief statement + full skill enforcement.** One line: intent, depth, skills loaded. Then follow every skill requirement without shortcuts.
3. **ELEVATE → recommendation.** Best-effort response + workflow nudge.
4. **Never lie about classification.** If uncertain, say so.
5. **Never over-classify.** When in doubt, go one tier lower.
6. **Never under-apply.** Rationalization is the enemy of quality. If a skill requires a step, do the step.

## Edge Cases

| Case | Handling |
|------|----------|
| Mixed intent ("fix this bug and add a test") | Use the higher-overhead intent (BUILD > DEBUG) |
| Continuation of previous conversation | Inherit previous classification unless prompt clearly shifts |
| User explicitly requests no enforcement | Respect immediately — classify as QUICK |
| Prompt references specific DevFlow command | Skip ambient — the command has its own orchestration |
