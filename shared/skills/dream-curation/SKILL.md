---
name: dream-curation
description: "Dream agent per-task procedure for the 'curation' task. Loaded EXPLICITLY by the Dream agent via the Skill tool when the agent is spawned for a curation task — not auto-activated. Handles periodic housekeeping of the decisions ledger and observation log."
allowed-tools: Read, Bash, Write, Edit, Glob, Grep
---

# Dream Task: curation

## Iron Law

> **RETIRE BY STATUS — THE LEDGER IS THE SOURCE OF TRUTH**
>
> The `.md` files are rendered views of the ledger — they are never hand-edited.
> To deprecate, supersede, or retire an entry, call `retire-anchor <anchor_id> <status>`.
> That op flips `decisions_status` on the ledger and re-renders both `.md` files
> automatically. Numbers are never reused; retired entries are recoverable.

This skill is loaded by the Dream agent after it has claimed the curation marker.
The agent has already done: claim (mv .json → .processing). Curation uses a single marker only.

`assign-anchor` adds new entries; curation flips status only — never creates entries.

## Procedure

Touch the claimed `.devflow/dream/curation.{session}.processing` file.

This task performs periodic housekeeping of the decisions ledger and rendered `.md` files.
Bounds: **≤5 changes per run**. **7-day protection window** — never touch any entry whose
`date` field in the ledger is within the past 7 days. The window key is the ledger row's
`date` field (YYYY-MM-DD), not anything in the `.md` file.

Read all inputs:
```bash
# Active entry counts from the ledger (preferred)
node "$HOME/.devflow/scripts/hooks/json-helper.cjs" count-active \
  "decision"
node "$HOME/.devflow/scripts/hooks/json-helper.cjs" count-active \
  "pitfall"
```

Also read `.devflow/decisions/decisions-ledger.jsonl`,
`.devflow/decisions/decisions-log.jsonl`, and `.devflow/decisions/.decisions-usage.json`.

Cite counts come from `.decisions-usage.json` — read it directly. Each entry is keyed by
anchor ID (`ADR-NNN` / `PF-NNN`) with `{ cites, last_cited, created }`. There is no separate
"scan" step here: `decisions-usage-scan.cjs` is a write-path tool that increments cite counts
from session text, not a reporter — do not call it from the curation task.

**Rotate stale observations first** (before selecting curation candidates):

Run under `.observations.lock` — never hold `.decisions.lock` and `.observations.lock`
simultaneously (ADR-017: if you need both, take `.decisions.lock` as the outer and complete
your observation reads before acquiring the inner — but in curation only rotation needs
`.observations.lock` and it is a self-contained step):

```bash
node "$HOME/.devflow/scripts/hooks/json-helper.cjs" rotate-observations
```

This archives `observing` rows older than 30 days to `decisions-log.archive.jsonl`
(gitignored), keeping the writer's recurrence read bounded. It never touches anchored
(`anchor_id` set) or `created`/`ready` rows. After rotation, the live log is a clean
working set.

**Staleness signal** (run once per curation task, before selecting candidates):

```bash
node "$HOME/.devflow/scripts/hooks/lib/staleness.cjs" \
  ".devflow/decisions/decisions-log.jsonl" \
  "$(pwd)"
```

Entries flagged `mayBeStale: true` in the log (their referenced files no longer exist) are
**preferred retirement candidates**, WITHIN the existing 7-day protection window and ≤5-changes
bounds. This is a signal to prefer — not an automatic retirement. Apply normal LLM judgment:
a stale-referenced entry that is otherwise heavily cited should survive over one that is
uncited and stale.

**LLM judgment — identify entries to retire or merge**:

Retire an entry when it is:
- Superseded by a newer, more precise entry on the same topic
- Contradicted by evidence in recent sessions
- Never cited (0 cites) AND older than 30 days AND low-confidence in the log

**ADR-XOR-PF awareness**: one incident yields exactly one of an ADR or a PF — never both.
If curation finds two entries covering the same incident (one ADR, one PF), consolidate to
the more accurate type and retire the other. Concrete failure mode → PF; forward-looking
architectural choice → ADR.

**Dedup awareness**: before retiring, check whether two near-duplicate entries could be
consolidated. Retire the less specific one and update the surviving entry's `pattern`
description to absorb the key insight from the retired entry.

**RETIRE BY STATUS — never hand-edit the .md** (rendered render invariant):

To deprecate/supersede/retire an entry, call `retire-anchor` — this flips `decisions_status`
on the ledger row and re-renders both `.md` files atomically:

```bash
# Single retirement — self-locking (acquires and releases .decisions.lock internally)
node "$HOME/.devflow/scripts/hooks/json-helper.cjs" \
  retire-anchor <anchor_id> <status>
# status ∈ Deprecated | Superseded | Retired
```

`retire-anchor` holds `.decisions.lock` across the full ledger-write + render critical
section. It is atomic and idempotent — calling it twice with the same status is safe.
The entry vanishes from the rendered `.md` but survives in the committed ledger;
numbers are never reused.

**Batch retirement**: call `retire-anchor` once per entry — each call self-locks atomically.
Do NOT attempt to hold `.decisions.lock` across multiple `retire-anchor` invocations; that
would deadlock against `retire-anchor`'s own lock acquisition.

**Recoverability**: to re-activate a retired entry (AC-F6), flip `decisions_status` back
by calling `retire-anchor` is NOT applicable (it only accepts retiring statuses). Instead,
directly update the ledger row's `decisions_status` to `Accepted` or `Active` via
`merge-observation` or a direct ledger write, then re-render:

```bash
node "$HOME/.devflow/scripts/hooks/lib/render-decisions.cjs" render "$(pwd)"
```

**Citation preservation**: if an entry being retired has inbound `applies ADR-NNN` citations
in other entries, update those entries' `pattern` or `details` to reference the surviving
entry instead (update the ledger rows via `merge-observation`, then re-render).

**Cap enforcement**: stop after 5 changes regardless of remaining candidates.

**Auto-commit** (after all retire-anchor calls complete, all locks released):

Run the installed commit helper — summarise what changed as the action:
```bash
"$HOME/.devflow/scripts/hooks/dream-commit" curation "<action>" "<session_id>"
```
Where `<action>` describes what happened, e.g. `"retire 2 stale entries"` or
`"retire ADR-007 (superseded)"`. Pass the session id from the marker you claimed.
This is best-effort: the helper exits 0 silently on no-op or if auto-commit is disabled.
Run it AFTER all `retire-anchor` calls complete (each self-releases `.decisions.lock`).

**Transparency**: after curation, emit a brief note in the agent output listing what was
retired/merged. If nothing was changed, stay silent.

Delete the claimed `.processing` marker on success.

**On any failure**: leave `.processing` files in place (dream-recover will retry them).
