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

## `bash-max-timeout-ms` — INCLUDED (number), env name confirmed

**Probe date**: 2026-10-08  
**Claude Code version**: 2.1.294

`BASH_MAX_TIMEOUT_MS` appears four times in the executable, and `BASH_DEFAULT_TIMEOUT_MS`
beside it. Two occurrences are entries in the settings `env` allowlists. The third is the
module that resolves the Bash tool's timeouts, and it fixes the semantics the registry
relies on:

- The default timeout is 120000 ms and the default ceiling is 600000 ms.
- The ceiling is read from `BASH_MAX_TIMEOUT_MS`. A value that is not a positive number
  is ignored; a valid one is raised to at least the default timeout, and has no upper
  bound of its own.
- A sibling function in the same module bounds a timer to the 32-bit limit, 2147483647 ms.
  The registry's `max` of 7200000 (two hours) is a devflow sanity bound, not an upstream one.

The name matches the registry, so the registry follows no correction. The flag's `min`
is 600000 because the upstream ceiling is already 600000: a lower value could only shrink
it.

## `auto-compact-window` — INCLUDED (number), env name confirmed

**Probe date**: 2026-10-10  
**Claude Code version**: 2.1.296

`CLAUDE_CODE_AUTO_COMPACT_WINDOW` appears in the executable at least ten times, and the
name is spelled exactly as the registry spells it. Strings around the occurrences show:

- the variable is the environment counterpart of an in-app `autoCompactWindow` setting
  ("... (or the autoCompactWindow setting)");
- when it is set the runtime says so and refuses the in-app change: "`CLAUDE_CODE_AUTO_COMPACT_WINDOW` is set and
  takes precedence. Unset it to change this setting.";
- an in-app parse message names the accepted values as `auto` or a size from 100k to 1M,
  which matches the registry's `min` 100000 and `max` 1000000 (devflow sanity bounds).

Not observed: the grammar of the variable's own value (the registry writes a decimal token
count, such as `200000`), the default window, and what compaction does at a given window.
The registry entry therefore records no `upstreamDefault`, and the flag stays unset by
default and not recommended until a forced mid-`/implement` `/compact` has been checked.
The variable that sets a percentage threshold instead is a different variable; devflow
does not write or name it.
