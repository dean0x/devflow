---
description: Ambient mode — classify intent and auto-load relevant skills for any prompt
---

# Ambient Command

Classify user intent and respond with proportional effort — zero overhead for simple requests, skill loading + agent orchestration for substantive work.

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
2. **Depth:** QUICK | ORCHESTRATED

If no arguments provided, output:

```
## Ambient Mode

Classify intent and auto-load relevant skills with agent orchestration.

Usage: /ambient <your prompt>

Examples:
  /ambient add a login form          → IMPLEMENT/ORCHESTRATED (Coder + quality gates)
  /ambient fix the auth error        → DEBUG/ORCHESTRATED (parallel hypothesis investigation)
  /ambient how should we cache?      → PLAN/ORCHESTRATED (Skimmer + Explore + Plan agents)
  /ambient where is the config?      → EXPLORE/QUICK (responds normally)
  /ambient commit this               → QUICK (no overhead)

Always-on: devflow ambient --enable
```

Then stop.

### Phase 3: State Classification

- **QUICK:** Skip this phase entirely. Respond directly in Phase 4.
- **ORCHESTRATED:** Output one line: `Ambient: {INTENT}/ORCHESTRATED. Loading: {skill1}, {skill2}.`

### Phase 4: Apply

**QUICK:**
Respond to the user's prompt normally. Zero skill loading. Zero overhead.

**ORCHESTRATED:**
Invoke each selected skill using the Skill tool based on the ambient-router's skill selection matrix:

| Intent | Skills Loaded | Agent Pipeline |
|--------|--------------|----------------|
| IMPLEMENT | implementation-orchestration, implementation-patterns | Pre-flight → Coder → Validator → Simplifier → Scrutinizer → Shepherd |
| DEBUG | debug-orchestration, core-patterns | Hypotheses → parallel Explores → convergence → report → offer fix |
| PLAN | plan-orchestration, implementation-patterns, core-patterns | Skimmer → Explores → Plan agent → gap validation |
| REVIEW | self-review, core-patterns | Single Reviewer agent with focus from prompt |

After loading skills, follow the orchestration skill's pipeline (Step 5 of ambient-router).

## Architecture

```
/ambient <prompt>
│
├─ Phase 1: Load ambient-router skill
├─ Phase 2: Classify intent + depth
├─ Phase 3: State classification (ORCHESTRATED only)
└─ Phase 4: Apply
   ├─ QUICK → respond directly (no agents)
   └─ ORCHESTRATED → load skills via Skill tool → orchestrate agents
      ├─ IMPLEMENT → implementation-orchestration pipeline
      ├─ DEBUG → debug-orchestration pipeline
      ├─ PLAN → plan-orchestration pipeline
      └─ REVIEW → single Reviewer agent
```

## Edge Cases

| Case | Handling |
|------|----------|
| No arguments | Show usage and stop |
| Single word ("help") | Classify — likely CHAT/QUICK |
| Prompt references `/implement` etc. | Classify as normal — user chose /ambient intentionally |
| Mixed intent ("fix and add test") | Use higher-overhead intent (IMPLEMENT > DEBUG) |
| User says "no enforcement" | Respect immediately — treat as QUICK |
| Multiple ORCHESTRATED triggers per session | Each runs independently; context compaction handles accumulation |

## Principles

1. **Agents for ORCHESTRATED, main session for QUICK** — proportional response
2. **Skill tool for loading** — invoke skills via Skill tool, not Read
3. **Conservative classification** — default to QUICK; ORCHESTRATED has real agent cost
4. **Transparent** — state classification for ORCHESTRATED, silent for QUICK
5. **Respectful** — never over-classify; when in doubt, QUICK
