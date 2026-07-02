# Dream Worker Procedure

## Iron Law

> **assign-anchor OWNS NUMBERING; render OWNS THE .md; NEVER HAND-EDIT decisions.md or pitfalls.md**
>
> ADR and PF numbers are assigned exclusively by `assign-anchor`. The `.md` files are written
> exclusively by `render-decisions.cjs` (invoked internally by `assign-anchor`/`retire-anchor`).
> One `assign-anchor` invocation claims one number and re-renders both files atomically. To
> deprecate, supersede, or retire an entry, call `retire-anchor <anchor_id> <status>` — never
> edit the `.md` files directly.

This procedure is read directly (via the Read tool) by the detached dream worker's
`claude -p` session — spawned by `spawn-dream-worker`/`background-dream-update` whenever the
dream queue is non-empty or a leftover `.processing` batch needs re-attempting. It is NOT a
Claude Code skill (skills do not load in `claude -p` sessions). You have Read, Grep, Glob,
Write, Edit, and Bash. Do everything below yourself — no other script validates or applies
your output.

## Inputs (read-only, except where noted)

The worker script's invocation prompt tells you the exact paths to use. Within the project's
`.devflow/decisions/` and `.devflow/dream/` directories, read:

- The claimed queue snapshot (conversation turns + qa rows since the last run)
- `decisions-log.jsonl` — full observation history (for dedup and recurrence patterns)
- `decisions.md` and `pitfalls.md` — the rendered, currently-active entries
- `.decisions-usage.json` — citation counts, keyed by anchor ID (`ADR-NNN`/`PF-NNN`)

You do NOT need to claim, heartbeat, or merge any marker files — the worker script already
claimed the queue atomically (rename-to-claim) before spawning you. There is nothing left to
claim.

## Part 1 — Decision & pitfall detection

Read the queue snapshot in full (cap at the last 30 dialog-worthy entries if the file is very
large). Read `decisions-log.jsonl` in full for dedup.

**LLM judgment — creation bar (abstain-by-default)**:

Most runs produce nothing. If unsure, record nothing. Only capture what a future contributor
would need and could not reconstruct from the code.

**NOT a decision**: bug fix, one-off UX tweak, routine refactor, applying an existing pattern,
dependency bump, or anything already covered by an existing ADR in the log.

**NOT a pitfall**: typo, transient flake, mistake with no general lesson, or a problem fully
prevented by existing tooling.

**Positive bar**:
- Decision = a deliberate architectural choice or trade-off with rationale that constrains
  future work. It must be a real fork in the road, not an obvious choice.
- Pitfall = a non-obvious failure mode with a transferable lesson that the next contributor
  cannot recover from the code alone.

**ADR-XOR-PF (hard rule)**: one incident yields exactly one of an ADR or a PF — never both.
Concrete failure → PF; forward-looking architectural choice → ADR.

**Dedup before creating (read the log first)**: if an existing row (any status, including
Retired) already covers this concern, reinforce it (reuse its `obs_` id via
`merge-observation`) instead of creating a new entry. Duplication is worse than silence.

For each pattern that clears the creation bar:
1. Scan the log first for a matching existing entry. REUSE its `obs_` id if found.
2. Estimate `confidence` honestly — this is curation metadata only, NOT a gate. Estimate what
   the evidence actually supports; do not inflate it.
3. Author a full `details` string: `"context: X; decision: Y; rationale: Z"` (decision) or
   `"area: X; issue: Y; impact: Z; resolution: W"` (pitfall).

Write (or reinforce) each observation directly — `merge-observation` is self-locking (it
acquires and releases `.devflow/dream/.observations.lock` internally), so call it plainly:

```bash
node "$HOME/.devflow/scripts/hooks/json-helper.cjs" merge-observation \
  ".devflow/decisions/decisions-log.jsonl" \
  '{"id":"obs_xxx","type":"decision","pattern":"...","evidence":["..."],"details":"context: ...; decision: ...; rationale: ...","confidence":0.8,"status":"observing","quality_ok":true}'
```

Do NOT wrap this call in your own lock acquisition — the op self-locks; an external lock
around it would nest against the internal one and time out.

**If promoting** (quality_ok=true, pattern recurs or is clearly significant after clearing the
creation bar above): promote via `assign-anchor` (self-locking on `.decisions.lock`, atomic —
claims the number and re-renders both `.md` files in one call):

```bash
node "$HOME/.devflow/scripts/hooks/json-helper.cjs" assign-anchor "decision" "obs_xxx"
node "$HOME/.devflow/scripts/hooks/json-helper.cjs" assign-anchor "pitfall" "obs_xxx"
```

NEVER hand-edit `decisions.md` or `pitfalls.md`. NEVER invent an ADR-NNN/PF-NNN number
yourself — `assign-anchor` is the only source of numbering.

## Part 2 — Curation

Periodic housekeeping of the decisions ledger and rendered `.md` files. Bounds: **≤5 curation
changes per run**. **7-day protection window** — never touch any entry whose `date` field in
the ledger is within the past 7 days. The window key is the ledger row's `date` field
(YYYY-MM-DD), not anything in the `.md` file.

Read active entry counts:

```bash
node "$HOME/.devflow/scripts/hooks/json-helper.cjs" count-active "decision"
node "$HOME/.devflow/scripts/hooks/json-helper.cjs" count-active "pitfall"
```

Cite counts come from `.decisions-usage.json` directly (no scan step here —
`decisions-usage-scan.cjs` is a write-path tool triggered by conversation capture, not a
curation reporter).

**Rotate stale observations first** (before selecting curation candidates) — self-locking on
`.observations.lock`:

```bash
node "$HOME/.devflow/scripts/hooks/json-helper.cjs" rotate-observations
```

This archives `observing` rows older than 30 days to `decisions-log.archive.jsonl`
(gitignored). It never touches anchored (`anchor_id` set) or `created`/`ready` rows.

**Staleness signal** (run once per curation pass, before selecting candidates):

```bash
node "$HOME/.devflow/scripts/hooks/lib/staleness.cjs" \
  ".devflow/decisions/decisions-log.jsonl" "$(pwd)"
```

Entries flagged `mayBeStale: true` (their referenced files no longer exist) are preferred
retirement candidates, within the 7-day window and ≤5-change bounds above — a signal to
prefer, not an automatic retirement.

**LLM judgment — identify entries to retire or merge**:

Retire an entry when it is:
- Superseded by a newer, more precise entry on the same topic
- Contradicted by evidence in recent sessions
- Never cited (0 cites) AND older than 30 days AND low-confidence in the log

**ADR-XOR-PF awareness**: if curation finds two entries covering the same incident (one ADR,
one PF), consolidate to the more accurate type and retire the other.

**Dedup awareness**: before retiring, check whether two near-duplicate entries could be
consolidated. Retire the less specific one and update the surviving entry's `pattern` to
absorb the key insight from the retired entry.

**RETIRE BY STATUS — never hand-edit the .md**:

```bash
node "$HOME/.devflow/scripts/hooks/json-helper.cjs" retire-anchor <anchor_id> <status>
# status ∈ Deprecated | Superseded | Retired
```

`retire-anchor` self-locks on `.decisions.lock` across the full ledger-write + render critical
section. Atomic and idempotent. Call it once per entry — never hold a lock across multiple
invocations yourself.

**Citation preservation**: if an entry being retired has inbound `applies ADR-NNN` citations
in other entries, update those entries' `pattern`/`details` to reference the surviving entry
instead (edit those ledger rows directly, then re-render via
`node "$HOME/.devflow/scripts/hooks/lib/render-decisions.cjs" render "$(pwd)"`).

**Cap enforcement**: stop after 5 changes regardless of remaining candidates.

**Transparency**: if you retired or merged anything this run, say so briefly in your final
output.

## Run visibility

If (and only if) this run changed the ledger (created, promoted, retired, or merged
anything), write a 1-3 line summary to `.devflow/dream/last-run-summary` describing what
changed. If nothing changed, do NOT create this file. `session-start-context` injects this
file's content once at the next session start, then deletes it — you do not need to manage
its lifecycle beyond writing it.

## Finishing

Regardless of whether Part 1 or Part 2 found anything to do:

1. Run `rotate-observations` if you have not already run it this pass (Part 2 already covers
   this — do not run it twice).
2. Touch `.devflow/dream/.last-dream-ok` LAST, after all other writes are complete. This is
   the worker script's success signal — it will not be reached if you error out or are killed
   by the watchdog, which is the correct (safe) outcome for a partial run.
