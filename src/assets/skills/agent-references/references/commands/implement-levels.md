# Implement: phases by gate level

## Phases

At `standard` and `lean`, a row sets its phase at that level. A phase with no row runs as written, and a table with no rows is well-formed.

| Phase | standard | lean |
|-------|----------|------|

## Grammar

- **Phase:** `3 Polish`, `4 Self-Review` or `5 Alignment Check`: the number and the text after `### Phase N: ` in the command, without a trailing parenthetical. Any other phase, or a name that does not match its number's heading by this rule, is malformed.
- **Cell:** `-` runs the phase as written; `skip`, alone, skips it; `apply: <name>` applies the `## Rules` bullet `<name>`; `pass level` adds the line `GATE_LEVEL: {GATE_LEVEL}` to every spawn prompt of the phase. A phase with no spawn takes only `-`. Join `apply:` and `pass level` with `; `. Each `apply:` names exactly one bullet. Any other cell is malformed.
- **Rules bullet:** a Rules bullet opens `- **<name>:**`.
- **Skipped:** a skipped phase does not stop the run, and the next phase starts as written. Each name on its `**Produces:**` line reads `SKIPPED`, and a report shows `SKIPPED`.
- **Gate level block:** the command reads this file at the start of Phase 3, before the Polish spawn. A `3 Polish` row with `skip` skips the Polish spawn, never that block.
- **Scope:** a row changes only its own phase's spawns and prompts. It adds no shell command, file write, push or GitHub action. It removes no security check, except that a `4 Self-Review` row may skip Harden. It keeps Validate, the CI gate, the evidence claims and the compliance directive. An enabled compliance lens keeps Harden.
- **Malformed:** no `## Phases` heading, no `| Phase | standard | lean |` header, or a row that breaks this grammar. Then the command applies no row.

## Rules

An `apply:` cell names one bullet of this section. At least one row names each bullet.
