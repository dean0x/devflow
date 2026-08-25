# Claude Code Flags — Phase 0 Probe Findings

**Probe date**: 2026-08-23  
**Claude Code version**: 2.1.241  
**Purpose**: Binary verification of env var names and domain values before adding flags to the registry.

## Findings

### `keybindingFlavor` — CUT

Domain is unverifiable. The strings `'emacs'`, `'readline'`, and `'classic'` appear in
the binary but in unrelated contexts (Node.js module names, VS Code terminal settings).
Behavioral probes via `claude --version` produced no validation output. Not added to the
registry.

### `workflowSizeGuideline` — INCLUDED (enum)

Domain `small|medium|large|unrestricted` verified from binary strings: a 4-value cluster
at adjacent string offsets, adjacent to Workflows feature description text. Added as an
enum flag.

### Env var names — all confirmed present in binary

- `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS`
- `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH`
- `CLAUDE_CODE_ENABLE_TODO_TOOLS`
- `CLAUDE_CODE_GOAL_CHECKIN_MINUTES`
- `ANTHROPIC_DEFAULT_MODEL`

## Methodology

Strings inspected via binary grep over the Claude Code executable. Adjacent-offset
clustering confirms a domain enum when the candidate values appear as a tight cluster
near feature description text. Single occurrences in unrelated modules are not
considered verification.
