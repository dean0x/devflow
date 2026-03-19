---
description: Ambient mode — classify intent and auto-load relevant skills for any prompt
---

# Ambient Command

Classify user intent and respond with proportional effort — zero overhead for simple requests, skill loading for guided work, skill loading + agent orchestration for complex work.

## Usage

```
/ambient <prompt>           Classify, load skills, orchestrate agents if needed
/ambient                    Show usage
```

## Phases

### Phase 1: Load Router

Read the `ambient-router` skill:
- `~/.claude/skills/ambient-router/SKILL.md`

### Phase 2: Classify

Apply the ambient-router classification to `$ARGUMENTS`:

1. **Intent:** IMPLEMENT | DEBUG | REVIEW | PLAN | EXPLORE | CHAT
2. **Depth:** QUICK | GUIDED | ORCHESTRATED

If no arguments provided, output:

```
## Ambient Mode

Classify intent and auto-load relevant skills with optional agent orchestration.

Usage: /ambient <your prompt>

Examples:
  /ambient add a login form          → IMPLEMENT/GUIDED (main session + skills + Simplifier)
  /ambient refactor the auth system  → IMPLEMENT/ORCHESTRATED (Coder + quality gates)
  /ambient fix the auth error        → DEBUG/GUIDED (main session diagnoses + fixes)
  /ambient debug flaky test failures → DEBUG/ORCHESTRATED (parallel hypothesis investigation)
  /ambient how should we cache?      → PLAN/ORCHESTRATED (Skimmer + Explore + Plan agents)
  /ambient where is the config?      → EXPLORE/QUICK (responds normally)
  /ambient commit this               → QUICK (no overhead)

Always-on: devflow ambient --enable
```

Then stop.

### Phase 3: State Classification

- **QUICK:** Skip this phase entirely. Respond directly in Phase 4.
- **GUIDED:** Output one line: `Ambient: {INTENT}/GUIDED. Loading: {skill1}, {skill2}.`
- **ORCHESTRATED:** Output one line: `Ambient: {INTENT}/ORCHESTRATED. Loading: {skill1}, {skill2}.`

### Phase 4: Apply

**QUICK:**
Respond to the user's prompt normally. Zero skill loading. Zero overhead.

**GUIDED:**
Invoke each selected skill using the Skill tool based on the ambient-router's skill selection matrix:

| Intent | Skills Loaded | Main Session Work | Post-Work |
|--------|--------------|-------------------|-----------|
| IMPLEMENT | implementation-patterns, search-first | Implement directly with TDD | Spawn Simplifier on changed files |
| DEBUG | core-patterns, test-patterns | Investigate, diagnose, fix | Spawn Simplifier on changed files |
| PLAN | implementation-patterns, core-patterns | Explore and design directly | No Simplifier |
| REVIEW | self-review, core-patterns | Review directly | No Simplifier |

After loading skills, work directly in main session following loaded skill patterns.

**ORCHESTRATED:**
Invoke each selected skill using the Skill tool based on the ambient-router's skill selection matrix:

| Intent | Skills Loaded | Agent Pipeline |
|--------|--------------|----------------|
| IMPLEMENT | implementation-orchestration, implementation-patterns | Pre-flight → Coder → Validator → Simplifier → Scrutinizer → Shepherd |
| DEBUG | debug-orchestration, core-patterns | Hypotheses → parallel Explores → convergence → report → offer fix |
| PLAN | plan-orchestration, implementation-patterns, core-patterns | Skimmer → Explores → Plan agent → gap validation |

After loading skills, follow the orchestration skill's pipeline (Step 5 of ambient-router).

## Architecture

```
/ambient <prompt>
│
├─ Phase 1: Load ambient-router skill
├─ Phase 2: Classify intent + depth
├─ Phase 3: State classification (GUIDED/ORCHESTRATED only)
└─ Phase 4: Apply
   ├─ QUICK → respond directly (no agents, no skills)
   ├─ GUIDED → load skills via Skill tool → main session implements → Simplifier
   │   ├─ IMPLEMENT → skills + TDD + Simplifier
   │   ├─ DEBUG → skills + diagnose/fix + Simplifier
   │   ├─ PLAN → skills + explore/design
   │   └─ REVIEW → skills + review directly
   └─ ORCHESTRATED → load skills via Skill tool → orchestrate agents
      ├─ IMPLEMENT → implementation-orchestration pipeline
      ├─ DEBUG → debug-orchestration pipeline
      └─ PLAN → plan-orchestration pipeline
```

## Edge Cases

| Case | Handling |
|------|----------|
| No arguments | Show usage and stop |
| Single word ("help") | Classify — likely CHAT/QUICK |
| Prompt references `/implement` etc. | Classify as normal — user chose /ambient intentionally |
| Mixed intent ("fix and add test") | Use higher-overhead intent (IMPLEMENT > DEBUG) |
| User says "no enforcement" | Respect immediately — treat as QUICK |
| Scope ambiguous (GUIDED vs ORCHESTRATED) | Default to GUIDED; escalate if complexity emerges |
| Multiple triggers per session | Each runs independently; context compaction handles accumulation |

## Principles

1. **Three tiers** — QUICK (zero overhead), GUIDED (skills + main session), ORCHESTRATED (skills + agents)
2. **Skill tool for loading** — invoke skills via Skill tool, not Read
3. **Conservative classification** — default to QUICK; prefer GUIDED over ORCHESTRATED
4. **Transparent** — state classification for GUIDED/ORCHESTRATED, silent for QUICK
5. **Respectful** — never over-classify; when in doubt, one tier lower
