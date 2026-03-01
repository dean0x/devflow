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

**Ambiguous prompts:** Default to the lowest-overhead classification. "Update the README" → BUILD (but QUICK depth since it's a single file, simple edit).

## Step 2: Classify Depth

Determine how much enforcement the prompt warrants.

| Depth | Criteria | Action |
|-------|----------|--------|
| **QUICK** | CHAT or EXPLORE intent, OR prompt < 20 words with no file references, OR single-file trivial edit | Respond normally. Zero overhead. Do not state classification. |
| **STANDARD** | BUILD/DEBUG/REVIEW/PLAN intent with 1-5 file scope | Read and apply 2-3 relevant skills from the selection matrix below. State classification briefly. |
| **ESCALATE** | Multi-file architectural change, "refactor all", system-wide scope, > 5 files | Respond at best effort + recommend: "This looks like it would benefit from `/implement` for full lifecycle management." |

## Step 3: Select Skills (STANDARD depth only)

Based on classified intent, read the following skills to inform your response.

| Intent | Primary Skills | Secondary (if file type matches) |
|--------|---------------|----------------------------------|
| **BUILD** | test-driven-development, implementation-patterns | typescript (.ts), react (.tsx/.jsx), frontend-design (CSS/UI), input-validation (forms/API), security-patterns (auth/crypto) |
| **DEBUG** | test-patterns, core-patterns | git-safety (if git operations involved) |
| **REVIEW** | self-review, core-patterns | test-patterns |
| **PLAN** | implementation-patterns | core-patterns |

**Excluded from ambient** (review-command-only): review-methodology, complexity-patterns, consistency-patterns, database-patterns, dependencies-patterns, documentation-patterns, regression-patterns, architecture-patterns, accessibility.

See `references/skill-catalog.md` for the full skill-to-intent mapping with file pattern triggers.

## Step 4: Apply

- **QUICK:** Respond directly. No preamble, no classification statement.
- **STANDARD:** State classification briefly: `Ambient: BUILD/STANDARD. Loading: test-driven-development, implementation-patterns.` Then read the selected skills and apply their patterns to your response. For BUILD intent, enforce RED-GREEN-REFACTOR from test-driven-development.
- **ESCALATE:** Respond with your best effort, then append: `> This task spans multiple files/systems. Consider \`/implement\` for full lifecycle (exploration → planning → implementation → review).`

---

## Transparency Rules

1. **QUICK → silent.** No classification output.
2. **STANDARD → brief statement.** One line: intent, depth, skills loaded.
3. **ESCALATE → recommendation.** Best-effort response + workflow nudge.
4. **Never lie about classification.** If uncertain, say so.
5. **Never over-classify.** When in doubt, go one tier lower.

## Edge Cases

| Case | Handling |
|------|----------|
| Mixed intent ("fix this bug and add a test") | Use the higher-overhead intent (BUILD > DEBUG) |
| Continuation of previous conversation | Inherit previous classification unless prompt clearly shifts |
| User explicitly requests no enforcement | Respect immediately — classify as QUICK |
| Prompt references specific DevFlow command | Skip ambient — the command has its own orchestration |
