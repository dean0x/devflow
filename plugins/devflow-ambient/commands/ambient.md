---
description: Ambient mode — classify intent and auto-load relevant skills for any prompt
---

# Ambient Command

Classify user intent and auto-load relevant skills. No agents spawned — enhances the main session only.

## Usage

```
/ambient <prompt>           Classify and respond with skill enforcement
/ambient                    Show usage
```

## Phases

### Phase 1: Load Router

Read the `ambient-router` skill:
- `~/.claude/skills/ambient-router/SKILL.md`

### Phase 2: Classify

Apply the ambient-router classification to `$ARGUMENTS`:

1. **Intent:** BUILD | DEBUG | REVIEW | PLAN | EXPLORE | CHAT
2. **Depth:** QUICK | STANDARD | ESCALATE

If no arguments provided, output:

```
## Ambient Mode

Classify intent and auto-load relevant skills.

Usage: /ambient <your prompt>

Examples:
  /ambient add a login form          → BUILD/STANDARD (loads TDD + implementation-patterns)
  /ambient fix the auth error        → DEBUG/STANDARD (loads test-patterns + core-patterns)
  /ambient where is the config?      → EXPLORE/QUICK (responds normally)
  /ambient refactor the auth system  → BUILD/ESCALATE (suggests /implement)

Always-on: devflow ambient --enable
```

Then stop.

### Phase 3: State Classification

- **QUICK:** Skip this phase entirely. Respond directly in Phase 4.
- **STANDARD:** Output one line: `Ambient: {INTENT}/{DEPTH}. Loading: {skill1}, {skill2}.`
- **ESCALATE:** Skip — recommendation happens in Phase 4.

### Phase 4: Apply

**QUICK:**
Respond to the user's prompt normally. Zero skill loading. Zero overhead.

**STANDARD:**
Read the selected skills based on the ambient-router's skill selection matrix:

| Intent | Primary Skills | Secondary (conditional) |
|--------|---------------|------------------------|
| BUILD | test-driven-development, implementation-patterns | typescript (.ts), react (.tsx), frontend-design (CSS/UI), input-validation (forms/API), security-patterns (auth/crypto) |
| DEBUG | test-patterns, core-patterns | git-safety (if git ops) |
| REVIEW | self-review, core-patterns | test-patterns |
| PLAN | implementation-patterns | core-patterns |

Read up to 3 skills from `~/.claude/skills/{name}/SKILL.md`. Apply their patterns and constraints when responding to the user's prompt.

For BUILD intent: enforce RED-GREEN-REFACTOR from test-driven-development. Write failing tests before production code.

**ESCALATE:**
Respond to the user's prompt with your best effort, then append:

> This task spans multiple files/systems. Consider `/implement` for full lifecycle management (exploration → planning → implementation → review).

## Architecture

```
/ambient <prompt> (main session, no agents)
│
├─ Phase 1: Load ambient-router skill
├─ Phase 2: Classify intent + depth
├─ Phase 3: State classification (STANDARD only)
└─ Phase 4: Apply
   ├─ QUICK → respond directly
   ├─ STANDARD → load 2-3 skills, apply patterns, respond
   └─ ESCALATE → respond + workflow nudge
```

## Edge Cases

| Case | Handling |
|------|----------|
| No arguments | Show usage and stop |
| Single word ("help") | Classify — likely CHAT/QUICK |
| Prompt references `/implement` etc. | Classify as normal — user chose /ambient intentionally |
| Mixed intent ("fix and add test") | Use higher-overhead intent (BUILD > DEBUG) |
| User says "no enforcement" | Respect immediately — treat as QUICK |

## Principles

1. **No agents** — Ambient enhances the main session, never spawns subagents
2. **Proportional** — QUICK gets zero overhead, STANDARD gets 2-3 skills, ESCALATE gets a nudge
3. **Transparent** — State classification for STANDARD/ESCALATE, silent for QUICK
4. **Respectful** — Never over-classify; when in doubt, go one tier lower
5. **TDD for BUILD** — STANDARD depth BUILD tasks enforce test-first workflow
