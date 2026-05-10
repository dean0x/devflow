---
name: explore:guided
description: GUIDED exploration — orient with Skimmer, trace flows directly in main session
user-invocable: false
---

# Explore (GUIDED)

Direct main-session exploration for GUIDED depth. Orient, trace, present, suggest knowledge creation.

1. **Load Decisions** — Run `node ~/.devflow/scripts/hooks/lib/decisions-index.cjs index "{worktree}"` for DECISIONS_CONTEXT. Read `.features/index.json` if it exists. Based on the exploration question, identify relevant feature knowledge entries and read them. Use both locally to frame exploration. Set `FEATURE_KNOWLEDGE = (none)` if none are relevant.
2. **Spawn Skimmer** — `Agent(subagent_type="Skimmer")` targeting the area of interest. Use orientation output to ground exploration in real file structures and patterns.
3. **Trace** — Using Skimmer findings + `FEATURE_KNOWLEDGE`, trace the flow or analyze the subsystem directly in main session. Follow call chains, read key files, map integration points.
4. **Present** — Deliver structured findings. Use AskUserQuestion to offer drill-down into specific areas.

## Output

Structured exploration findings with concrete code references:

- Scope (what was explored and boundaries)
- Architecture Map (modules, layers, key abstractions with file:line)
- Flow Trace (call chain from entry to exit with file:line at each step)
- Integration Points (module boundaries, shared types, external dependencies)
- Patterns (recurring conventions, design decisions observed)
- Key Insights (non-obvious findings, surprises, potential concerns)

## Suggest Feature Knowledge Creation

After presenting, if `.features/.disabled` does NOT exist and the explored area has no matching feature knowledge entry in `.features/index.json`, ask the user if they want to create one. If yes: derive slug/name/directories from the explored area, spawn Knowledge agent with findings from step 3, read sidecar (`.features/{slug}/.create-result.json`), update index with `node ~/.devflow/scripts/hooks/lib/feature-knowledge.cjs update-index "{worktree}" --slug="{slug}" --name="{name}" --directories='[...]' --referencedFiles='{from_sidecar}' --description="{from_sidecar}" --createdBy="explore" 2>/dev/null`, clean up sidecar.
