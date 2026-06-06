---
name: dream-memory
description: "Dream agent per-task procedure for the 'memory' task. Loaded EXPLICITLY by the Dream agent via the Skill tool when the agent is spawned for a memory task — not auto-activated. Handles pending-turns queue drain and WORKING-MEMORY.md authoring."
allowed-tools: Read, Bash, Write, Edit, Glob, Grep
---

# Dream Task: memory

## Iron Law

> **SYNTHESIZE FROM THE QUEUE — NEVER FABRICATE**
>
> WORKING-MEMORY.md must be authored from the captured turns in `.pending-turns.processing`.
> Do not invent context, carry over assumptions from prior sessions, or fill sections with
> canned text. If the queue is empty, write only what the marker and existing memory support.

This skill is loaded by the Dream agent after it has claimed the memory marker(s).
The agent has already done: claim (mv .json → .processing), heartbeat (touch .processing),
and multi-marker merge (single marker only for memory type). The pending-turns queue
rename may or may not have succeeded — proceed regardless.

## Procedure

1. Claim the pending-turns queue atomically (soft-fail):
   ```bash
   mv .devflow/memory/.pending-turns.jsonl .devflow/memory/.pending-turns.processing 2>/dev/null
   ```
   If the rename fails (file absent), proceed — the memory marker alone is enough context.

2. Read `.devflow/memory/.pending-turns.processing` (JSONL: each line `{role, content, ts}`).
   Read `.devflow/memory/WORKING-MEMORY.md` (existing memory; may not exist).

3. **Author the updated memory** (LLM writes this — no canned filler):
   Synthesize the new turns into an updated `WORKING-MEMORY.md`. Keep under 120 lines.
   Required sections:
   - `## Now` — current task/branch/status (1-3 lines)
   - `## Progress` — Done items and In Progress items
   - `## Decisions` — key architectural decisions made this session
   - `## Context` — repository context, branch info
   - `## Session Log` — one-line-per-session summary

4. Write the file, delete `.pending-turns.processing`, then delete all claimed `.processing` markers.

**On any failure**: leave `.processing` files in place (dream-recover will retry them).
