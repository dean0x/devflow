---
name: dream-knowledge
description: "Dream agent per-task procedure for the 'knowledge' task. Loaded EXPLICITLY by the Dream agent via the Skill tool when the agent is spawned for a knowledge task — not auto-activated. Handles stale feature knowledge base refresh and index updates."
allowed-tools: Read, Bash, Write, Edit, Glob, Grep
---

# Dream Task: knowledge

## Iron Law

> **REFRESH FROM THE LIVE CODEBASE — NEVER FROM MEMORY OR STALE CONTEXT**
>
> Every KNOWLEDGE.md update must be grounded in the current files listed under
> `directories` and `referencedFiles`. Do not carry forward assertions from the
> existing KNOWLEDGE.md without re-verifying them against the current source.

This skill is loaded by the Dream agent after it has claimed the knowledge marker(s).
The agent has already done: claim (mv .json → .processing) and multi-marker merge
(union staleSlugs arrays; use any worktreePath).

## Procedure

Touch all claimed `.devflow/dream/knowledge.{session}.processing` files.

Read the merged `staleSlugs` and `worktreePath`.

For each stale slug:
1. Read `.devflow/features/index.json` for the entry's `directories` and `referencedFiles`.
2. Read `.devflow/features/{slug}/KNOWLEDGE.md` (existing content).
3. Read the referenced files and directories to understand current state.
4. **Author an updated KNOWLEDGE.md** (LLM writes real content — no canned filler):
   Cover: architecture, key patterns, anti-patterns, gotchas, integration points, key files.
5. Write the updated file.
6. Update the index entry:
   ```bash
   node "$HOME/.devflow/scripts/hooks/lib/feature-knowledge.cjs" update-index \
     "{worktreePath}" \
     --slug="{slug}" \
     --name="{name}" \
     --directories='["{dir1}","{dir2}"]' \
     --referencedFiles='["{file1}"]' \
     --description="{description}"
   ```

After all slugs, write the refresh timestamp:
```bash
date +%s > .devflow/features/.knowledge-last-refresh
```

**Auto-commit** (after all slugs refreshed and refresh timestamp written):

Run the installed commit helper — summarise the refreshed slugs as the action:
```bash
"$HOME/.devflow/scripts/hooks/dream-commit" knowledge "refresh <slug> knowledge" "<session_id>"
```
Use `"refresh <slug1>, <slug2> knowledge"` when multiple slugs were refreshed.
Pass the session id from the marker you claimed. This is best-effort: the helper exits 0
silently on no-op or if auto-commit is disabled.

Delete all claimed `.processing` markers on success.

**On any failure**: leave `.processing` files in place (dream-recover will retry them).
