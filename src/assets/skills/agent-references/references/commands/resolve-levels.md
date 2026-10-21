# Resolve: phases by gate level

## Phases

At `standard` and `lean`, a row sets its phase at that level. Each worktree reads the column of its own level, except in a global phase. A phase with no row runs as written, and a table with no rows is well-formed.

| Phase | standard | lean |
|-------|----------|------|
| 2 Global Triage | pass level | pass level |
| 6 Polish | skip | skip |

## Grammar

- **Phase:** `2 Global Triage`, `3 Batch FIX_NOW Issues`, `4 Fix`, `6 Polish` or `9 Manage Debt`: the number and the text after `### Phase N: ` in the command, without a trailing parenthetical. Phase `9` never covers `9b` or `9c`. Any other phase, or a name that does not match its number's heading by this rule, is malformed.
- **Cell:** `-` runs the phase as written; `skip`, alone, skips it; `apply: <name>` applies the `## Rules` bullet `<name>`; `pass level` puts the line `GATE_LEVEL: {GATE_LEVEL}` first in every spawn prompt of the phase, right after a leading `OPERATION:` line. A phase with no spawn takes only `-`. Join `apply:` and `pass level` with `; `. Each `apply:` names exactly one bullet. Any other cell is malformed.
- **Rules bullet:** a Rules bullet opens `- **<name>:**`.
- **Skipped:** a skipped phase does not stop the run, and the next phase starts as written. A phase that waits for a skipped phase starts at once. Each name on its `**Produces:**` line reads `SKIPPED`, and a report shows `SKIPPED`.
- **Never skip:** `2 Global Triage`, `3 Batch FIX_NOW Issues`, `4 Fix` and `9 Manage Debt` never take `skip`. Triage routes each security finding as it does at `full`. No row leaves a FIX_NOW security finding unfixed, leaves a FIX_SEPARATE item without a ticket, or drops the CI gate. A row or Rules bullet that breaks this rule is malformed, so the command applies no row in any worktree.
- **Global phase:** one spawn serves all worktrees in a global phase, as in `2 Global Triage`. A global phase uses the strictest level in the run. `full` is the strictest and `lean` the least strict. The phase takes that level's cell, and `pass level` sends that level. At `full` the phase runs as written.
- **Scope:** a row changes only its own phase's spawns and prompts. It adds no shell command, file write, push or GitHub action. It removes no security check, changes neither the Triage security gate nor the ESCALATED route, and keeps the Verification Gate, the CI gate and the compliance directive.
- **Malformed:** no `## Phases` heading, no `| Phase | standard | lean |` header, or a row that breaks this grammar. Then the command applies no row in any worktree.

## Rules

An `apply:` cell names one bullet of this section. At least one row names each bullet.
