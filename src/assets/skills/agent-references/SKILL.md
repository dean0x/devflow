---
name: agent-references
description: Agent-owned reference files, read by explicit path, never preloaded
user-invocable: false
disable-model-invocation: true
allowed-tools: Read
---

# Agent References

<!-- D-AGENT-REFS: a reference-only skill. It holds text that one agent mode needs and the
     other modes do not, so the agent body stays small and the spawn reads one file on demand.
     D-MODE-BY-PATH: Synthesize reads exactly one synthesize/{mode}.md by explicit path.
     D-MAINTAIN-ON-DUE: Learning reads learning/maintain.md only after claim-due hands out an entry. -->

## Iron Law

> **READ BY EXPLICIT PATH ONLY; NEVER PRELOAD**
>
> An agent that owns a file here names its full path in its own body and reads it with the
> Read tool when its mode needs it. No agent `skills:` list and no plugin preload names this
> skill: a preload would put every file in every spawn and undo the saving.

## Files

| Path under `references/` | Owner | Read when |
|--------------------------|-------|-----------|
| `synthesize/{mode}.md` | Synthesize | The prompt's `Mode:` line names `{mode}` |
| `learning/maintain.md` | Learning | `claim-due` hands out at least one entry |

The installed directory is `${CLAUDE_CONFIG_DIR:-$HOME/.claude}/skills/devflow:agent-references/`.
The model never invokes this skill: `disable-model-invocation: true` keeps it out of the
model's own skill choices, and `user-invocable: false` keeps it out of the slash menu.
