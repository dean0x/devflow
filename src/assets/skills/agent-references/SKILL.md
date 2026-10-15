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
     D-MAINTAIN-ON-DUE: Curate reads curate/maintain.md only after claim-due hands out an entry.
     D-CMD-REF-HAND: a command moves a rare branch here (hand-authored, byte for byte) and keeps only
     the condition and the read path, so a run that never takes the branch never carries its text.
     Only text with no learning arm and no Git-spawn fence moves.
     /code-review reads commands/code-review-levels.md on its default path (standard or lean), once
     per run; a failed read applies the full sets.
     /plan reads commands/plan-levels.md at standard or lean, once per run; a failed read runs the
     full shape. -->

## Iron Law

> **READ BY EXPLICIT PATH ONLY; NEVER PRELOAD**
>
> An agent or command that owns a file here names its full path in its own body and reads it with
> the Read tool when its mode or branch needs it. No agent `skills:` list, no plugin `requires:`
> and no preload names this skill: a preload would put every file in every spawn and undo the saving.

## Files

| Path under `references/` | Owner | Read when |
|--------------------------|-------|-----------|
| `synthesize/{mode}.md` | Synthesize | The prompt's `Mode:` line names `{mode}` |
| `curate/maintain.md` | Curate | `claim-due` hands out at least one entry |
| `commands/{name}.md` | The command named in the file | The command's condition for that branch holds |

The installed directory is `{claude_dir}/skills/devflow:agent-references/`, where `{claude_dir}` is Claude Code's directory: `CLAUDE_CONFIG_DIR` when that is set to an absolute path, else `$HOME/.claude`.
The model never invokes this skill: `disable-model-invocation: true` keeps it out of the
model's own skill choices, and `user-invocable: false` keeps it out of the slash menu.
