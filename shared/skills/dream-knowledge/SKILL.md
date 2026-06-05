---
name: dream-knowledge
description: "Dream agent per-task procedure for the 'knowledge' task. Loaded EXPLICITLY by the Dream agent via the Skill tool when the agent is spawned for a knowledge task — not auto-activated. Handles stale feature knowledge base refresh and index updates."
allowed-tools: Read, Bash, Write, Edit, Glob, Grep
---

# Dream Task: knowledge

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

Delete all claimed `.processing` markers on success.

**On any failure**: leave `.processing` files in place (dream-recover will retry them).
