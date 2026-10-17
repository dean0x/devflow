# Resolve: phases by gate level

## Phases

At `standard` and `lean`, a row sets its phase at that level. Each worktree reads the column of its own level, except in a global phase. A phase with no row runs as written, and a table with no rows is well-formed.

| Phase | standard | lean |
|-------|----------|------|

## Grammar

- **Phase:** `2 Global Triage`, `3 Batch FIX_NOW Issues`, `4 Fix`, `6 Polish` or `9 Manage Debt`: the number and the name of the command's `### Phase N:` heading, matched with the colon, without its parenthetical. Phase `9` never covers `9b` or `9c`. Any other phase, or a name that is not its number's heading, is malformed.
- **Cell:** `-` runs the phase as written; `skip`, alone, skips it; `apply: <name>` applies the `## Rules` bullet `<name>`; `pass level` adds the line `GATE_LEVEL: {GATE_LEVEL}` to every spawn prompt of the phase, and a phase with no spawn never takes `pass level`. Join `apply:` and `pass level` with `; `. Each `apply:` names exactly one bullet. Any other cell is malformed.
- **Rules bullet:** a Rules bullet opens `- **<name>:**`.
- **Skipped:** a skipped phase counts as passed, so the next phase starts as written. Each name on its `**Produces:**` line reads `skipped`, and a report shows `skipped`, never a pass.
- **Never skip:** `2 Global Triage`, `3 Batch FIX_NOW Issues`, `4 Fix` and `9 Manage Debt` never take `skip`. Triage routes each security finding as it does at `full`. No row leaves a FIX_NOW security finding unfixed, leaves a FIX_SEPARATE item without a ticket, or drops the CI gate.
- **Global phase:** a phase that one spawn serves for all worktrees, as `2 Global Triage` does, uses the strictest level in the run, in the order `full`, `standard`, `lean`: it takes that level's cell, and `pass level` passes that level. At `full` it runs as written.
- **Scope:** a row changes only its own phase's spawns and prompts. It adds no shell command, file write, push or GitHub action. It removes no security check, changes neither the Triage security gate nor the ESCALATED route, and keeps the Verification Gate, the CI gate and the compliance directive.
- **Malformed:** no `## Phases` heading, no `| Phase | standard | lean |` header, or a row that breaks this grammar. Then the command applies no row in any worktree.

## Rules

An `apply:` cell names one bullet of this section. A row names every bullet.
