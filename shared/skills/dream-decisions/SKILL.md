---
name: dream-decisions
description: "Dream agent per-task procedure for the 'decisions' task. Loaded EXPLICITLY by the Dream agent via the Skill tool when the agent is spawned for a decisions task — not auto-activated. Handles decision/pitfall detection from dialog pairs and materialization via assign-anchor."
allowed-tools: Read, Bash, Write, Edit, Glob, Grep
---

# Dream Task: decisions

## Iron Law

> **assign-anchor OWNS NUMBERING; render OWNS THE .md; NEVER HAND-EDIT**
>
> ADR and PF numbers are assigned exclusively by `assign-anchor`. The `.md` files are
> written exclusively by `render-decisions.cjs`. Never write, edit, or infer an ADR-NNN
> or PF-NNN number directly into decisions.md or pitfalls.md. Never call `decisions-append`.
> One `assign-anchor` invocation claims one number and re-renders both files atomically.

This skill is loaded by the Dream agent after it has claimed the decisions marker(s).
The agent has already done: claim (mv .json → .processing) and multi-marker merge
(concatenate dialogPairs strings; union existingObservationIds arrays).
Cap at the last 30 dialog-pairs before proceeding.

## Procedure

Touch all claimed `.devflow/dream/decisions.{session}.processing` files.

Read the merged `dialogPairs`. Cap at last 30 pairs.
Read `.devflow/decisions/decisions-log.jsonl` in full (for dedup and recurrence patterns).

**LLM judgment — creation bar (abstain-by-default)**:

Most sessions produce nothing. If unsure, record nothing. Only capture what a future
contributor would need and could not reconstruct from the code.

**NOT a decision**: bug fix, one-off UX tweak, routine refactor, applying an existing
pattern, dependency bump, or anything already covered by an existing ADR in the log.

**NOT a pitfall**: typo, transient flake, mistake with no general lesson, or a problem
fully prevented by existing tooling.

**Positive bar**:
- Decision = a deliberate architectural choice or trade-off with rationale that
  constrains future work. It must be a real fork in the road, not an obvious choice.
- Pitfall = a non-obvious failure mode with a transferable lesson that the next
  contributor cannot recover from the code alone.

**ADR-XOR-PF (hard rule)**: one incident yields exactly one of an ADR or a PF — never
both. Concrete failure → PF; forward-looking architectural choice → ADR.

**Dedup before creating**: read the log first. If an existing row (any status, including
Retired) already covers this concern, reinforce it (reuse its `obs_` id via
`merge-observation`) instead of creating a new entry. Duplication is worse than silence.

For each pattern that clears the creation bar:
1. Scan the log for a matching existing entry. REUSE its `obs_` id if found.
2. Estimate `confidence` honestly — this is curation metadata only, NOT a gate. Estimate
   what the evidence actually supports; do not inflate it.
3. Author full `details` string: `"context: X; decision: Y; rationale: Z"` (decision) or
   `"area: X; issue: Y; impact: Z; resolution: W"` (pitfall).

Write (or reinforce) each observation using bounded retry+backoff on `.observations.lock`
(explicit cap: 9 attempts, ~47s total backoff; on exhaustion leave `.processing` for retry):

```bash
(
  LOCK=".devflow/dream/.observations.lock"
  _ACQUIRED=false
  _BACKOFF=1
  for _ATTEMPT in 1 2 3 4 5 6 7 8 9; do
    if mkdir "$LOCK" 2>/dev/null; then
      _ACQUIRED=true
      break
    fi
    sleep "$_BACKOFF"
    _BACKOFF=$(( _BACKOFF < 8 ? _BACKOFF * 2 : 8 ))
  done
  if [ "$_ACQUIRED" != "true" ]; then
    echo "dream-decisions: failed to acquire .observations.lock after 9 attempts — leaving .processing for retry" >&2
    exit 1
  fi
  node "$HOME/.devflow/scripts/hooks/json-helper.cjs" merge-observation \
    ".devflow/decisions/decisions-log.jsonl" \
    '{"id":"obs_xxx","type":"decision","pattern":"...","evidence":["..."],"details":"context: ...; decision: ...; rationale: ...","confidence":0.8,"status":"observing","quality_ok":true}'
  rmdir "$LOCK" 2>/dev/null || true
)
```

Replace the JSON with actual LLM-authored observation data (full fields shown above).

**If promoting** (quality_ok=true, pattern recurs or is clearly significant after clearing
the creation bar above): promote via `assign-anchor`:

```bash
node "$HOME/.devflow/scripts/hooks/json-helper.cjs" assign-anchor \
  "decision" \
  "obs_xxx"
```

For pitfalls:
```bash
node "$HOME/.devflow/scripts/hooks/json-helper.cjs" assign-anchor \
  "pitfall" \
  "obs_xxx"
```

`assign-anchor` scans the ledger for the current max anchor number (including Retired),
assigns max+1 as a zero-padded 3-digit ID, writes an anchored row to
`decisions-ledger.jsonl`, marks the log row as `created`, registers usage, and re-renders
both `decisions.md` and `pitfalls.md` — all atomically under `.decisions.lock`.

NEVER call `decisions-append`. NEVER hand-edit `decisions.md` or `pitfalls.md`.

**Auto-commit** (after assign-anchor succeeds, lock released):

Run the installed commit helper — pass the session id from the marker you claimed:
```bash
"$HOME/.devflow/scripts/hooks/dream-commit" decisions "add <anchor_id>" "<session_id>"
```
This is best-effort: the helper exits 0 silently on no-op or if auto-commit is disabled.
Run it AFTER the lock is released (assign-anchor releases `.decisions.lock` before returning).

Delete all claimed `.processing` markers on success.

**On any failure**: leave `.processing` files in place (dream-recover will retry them).
