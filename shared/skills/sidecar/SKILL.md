---
name: sidecar
description: Background sidecar agents for memory, learning, decisions, and knowledge refresh
allowed-tools: Read, Bash, Agent, Write, Edit, Glob, Grep
---

# Sidecar

Spawn background agents for pending sidecar tasks. Each task has a marker file in `.memory/.sidecar/`.

## Iron Law

> **BACKGROUND AGENTS DO NOT BLOCK THE USER**
>
> All sidecar agents run with `run_in_background: true`. Never spawn a sidecar agent in the foreground.
> The user's workflow must not be interrupted by maintenance tasks.

## Activation

This skill activates when the model receives `SIDECAR: <tasks>` in additionalContext from the dispatch hook.

## Processing

1. For each task listed in the SIDECAR directive:
   a. Find all markers for this task type: glob `.memory/.sidecar/{task}.*.json` (per-session) and `.memory/.sidecar/{task}.json` (legacy)
   b. Rename each matching marker to `.processing` suffix (atomic claim)
   c. Read and merge content from all markers of the same type:
      - **learning**: concatenate `userSignals` strings, union `existingObservationIds` arrays
      - **decisions**: concatenate `dialogPairs` strings, union `existingObservationIds` arrays
      - **knowledge**: union `staleSlugs` arrays, use any `worktreePath`
      - **memory**: single `memory.json` — no merge needed
   d. Spawn the appropriate background agent with the merged content
2. Continue with the user's actual request — sidecar processing is fire-and-forget.

## Task: memory

Read `.memory/.sidecar/memory.processing`. Spawn:

```
Agent({
  description: "Update working memory",
  run_in_background: true,
  model: "claude-haiku-4-5",
  prompt: "You are a working memory updater. Read .memory/.sidecar/memory.processing for task context.

Atomically claim the pending turns queue: rename .memory/.pending-turns.jsonl to .memory/.pending-turns.processing (this prevents concurrent sessions from losing appended turns during processing). If the rename fails (file doesn't exist), exit cleanly.

Read the claimed queue at .memory/.pending-turns.processing (JSONL format, each line is {role, content, ts}).
Read existing memory at .memory/WORKING-MEMORY.md (may not exist yet).

Write an updated .memory/WORKING-MEMORY.md that integrates the new turns into a structured summary.
Keep under 120 lines. Use sections: ## Now, ## Progress, ## Decisions, ## Context, ## Session Log.
- ## Now: current task/branch/status (1-3 lines)
- ## Progress: Done items and In Progress items
- ## Decisions: key architectural decisions made this session
- ## Context: repository context, branch info
- ## Session Log: one-line-per-session summary

After writing WORKING-MEMORY.md, delete .memory/.pending-turns.processing.
Then delete .memory/.sidecar/memory.processing.

If any step fails, leave memory.processing in place (it will be retried next dispatch)."
})
```

## Task: learning

Read `.memory/.sidecar/learning.processing`. Spawn:

```
Agent({
  description: "Background learning analysis",
  run_in_background: true,
  model: "claude-sonnet-4-5",
  prompt: "You are the Devflow learning agent. Read .memory/.sidecar/learning.processing for context.

The marker contains:
- userSignals: array of user messages to analyze
- existingObservationIds: array of existing observation IDs for deduplication

Analyze the userSignals for WORKFLOW and PROCEDURAL patterns:

WORKFLOW patterns: repeated multi-step sequences the user performs (e.g., always running lint before commit).
Detection markers: sequential commands, repeated tool patterns, consistent ordering.

PROCEDURAL patterns: domain knowledge or procedures the user teaches (e.g., 'always use Result types').
Detection markers: explicit instructions, corrections, teaching moments, stated preferences.

Read .memory/learning-log.jsonl for existing observations. For each detected pattern:
- If it matches an existing observation (same pattern/type): increment count, merge evidence, update confidence
- If new: append a new observation entry as a JSONL line with format:
  {\"id\":\"obs_<random6>\",\"type\":\"workflow|procedural\",\"pattern\":\"<description>\",\"evidence\":[\"<quotes>\"],\"count\":1,\"confidence\":0.5,\"quality_ok\":true,\"status\":\"observing\",\"created\":\"<ISO date>\",\"last_seen\":\"<ISO date>\"}

If any observation crosses promotion threshold (workflow: count>=3, procedural: count>=4):
- For workflow: write command file to ~/.claude/commands/self-learning/{slug}.md
- For procedural: write skill file to ~/.claude/skills/{slug}/SKILL.md
- Update observation status to 'created' with artifact_path field

Delete .memory/.sidecar/learning.processing when done."
})
```

## Task: decisions

Read `.memory/.sidecar/decisions.processing`. Spawn:

```
Agent({
  description: "Background decisions analysis",
  run_in_background: true,
  model: "claude-sonnet-4-5",
  prompt: "You are the Devflow decisions agent. Read .memory/.sidecar/decisions.processing for context.

The marker contains:
- dialogPairs: array of {prior, user} message pairs to analyze
- existingObservationIds: array of existing observation IDs for deduplication

Analyze dialog pairs for DECISION and PITFALL patterns:

DECISION patterns: architectural choices, technology selections, design trade-offs explicitly discussed and agreed upon.
PITFALL patterns: mistakes made, issues discovered, things that went wrong that others should avoid.

Read .memory/decisions-log.jsonl for existing observations. For each detected pattern:
- If it matches an existing observation: increment count, merge evidence
- If new: append a JSONL line:
  {\"id\":\"obs_<random6>\",\"type\":\"decision|pitfall\",\"pattern\":\"<description>\",\"evidence\":[\"<quotes>\"],\"details\":\"<semicolon-delimited fields>\",\"count\":1,\"confidence\":0.95,\"quality_ok\":true,\"status\":\"observing\",\"created\":\"<ISO date>\",\"last_seen\":\"<ISO date>\"}

Decision details format: \"context: X; decision: Y; rationale: Z\"
Pitfall details format: \"area: X; issue: Y; impact: Z; resolution: W\"

If any observation has quality_ok=true and confidence>=0.65:
- For decisions: append ADR entry to .memory/decisions/decisions.md
- For pitfalls: append PF entry to .memory/decisions/pitfalls.md
- Update observation status to 'created'

Delete .memory/.sidecar/decisions.processing when done."
})
```

## Task: knowledge

Read `.memory/.sidecar/knowledge.processing`. Spawn:

```
Agent({
  description: "Background knowledge refresh",
  run_in_background: true,
  model: "claude-sonnet-4-5",
  prompt: "You are the Devflow knowledge refresh agent. Read .memory/.sidecar/knowledge.processing for context.

The marker contains:
- staleSlugs: array of feature knowledge slugs that need refreshing
- worktreePath: project root path

For each stale slug:
1. Read .features/index.json to get the entry's directories and referencedFiles
2. Read .features/{slug}/KNOWLEDGE.md for the existing content
3. Read the referenced files and directories to understand current state
4. Update .features/{slug}/KNOWLEDGE.md with current information
5. Update the index entry's lastUpdated timestamp via:
   node ~/.devflow/scripts/hooks/lib/feature-knowledge.cjs update-index \"{worktreePath}\" --slug=\"{slug}\" --name=\"{name}\" --directories='[...]' --referencedFiles='[...]' --description=\"{desc}\"

After refreshing all slugs, write the current epoch timestamp to .features/.knowledge-last-refresh.
Delete .memory/.sidecar/knowledge.processing when done."
})
```
