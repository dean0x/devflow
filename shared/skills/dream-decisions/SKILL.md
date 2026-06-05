---
name: dream-decisions
description: "Dream agent per-task procedure for the 'decisions' task. Loaded EXPLICITLY by the Dream agent via the Skill tool when the agent is spawned for a decisions task — not auto-activated. Handles decision/pitfall detection from dialog pairs and materialization via decisions-append."
allowed-tools: Read, Bash, Write, Edit, Glob, Grep
---

# Dream Task: decisions

This skill is loaded by the Dream agent after it has claimed the decisions marker(s).
The agent has already done: claim (mv .json → .processing) and multi-marker merge
(concatenate dialogPairs strings; union existingObservationIds arrays).
Cap at the last 30 dialog-pairs before proceeding.

## Procedure

Touch all claimed `.devflow/dream/decisions.{session}.processing` files.

Read the merged `dialogPairs`. Cap at last 30 pairs.
Read `.devflow/decisions/decisions-log.jsonl` in full (for recurrence patterns).

**LLM judgment — detect DECISION and PITFALL patterns**:

Decision: explicit architectural choice, technology selection, or design trade-off discussed and agreed.
Pitfall: mistake made, issue discovered, or failure mode identified that others should avoid.

For each detected pattern:
1. Scan the log for an existing observation with matching semantic content. REUSE its `obs_` id.
2. Decide `confidence` (decisions: default 0.95 on first occurrence; pitfalls: 0.9+), `status`, `quality_ok`.
3. Author full `details` string: `"context: X; decision: Y; rationale: Z"` (decision) or
   `"area: X; issue: Y; impact: Z; resolution: W"` (pitfall).

Write each observation using bounded retry+backoff on `.reinforce.lock`
(explicit cap: 9 attempts, ~30s total backoff; on exhaustion leave `.processing` for retry):

```bash
(
  LOCK=".devflow/dream/.reinforce.lock"
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
    echo "dream-decisions: failed to acquire .reinforce.lock after 9 attempts — leaving .processing for retry" >&2
    exit 1
  fi
  node "$HOME/.devflow/scripts/hooks/json-helper.cjs" merge-observation \
    ".devflow/decisions/decisions-log.jsonl" \
    '{"id":"obs_xxx","type":"decision","pattern":"...","evidence":["..."],"details":"context: ...; decision: ...; rationale: ...","confidence":0.95,"status":"observing","quality_ok":true}'
  rmdir "$LOCK" 2>/dev/null || true
)
```

Replace the JSON with actual LLM-authored observation data (full fields shown above).

**If promoting** (quality_ok=true, confidence ≥ 0.65, pattern recurs or is clearly significant):
Author the full ADR or PF body text (LLM-written — not canned), then append via:

```bash
node "$HOME/.devflow/scripts/hooks/json-helper.cjs" decisions-append \
  ".devflow/decisions/decisions.md" \
  "decision" \
  '{"id":"obs_xxx","pattern":"...","details":"context: ...; decision: ...; rationale: ..."}'
```

For pitfalls:
```bash
node "$HOME/.devflow/scripts/hooks/json-helper.cjs" decisions-append \
  ".devflow/decisions/pitfalls.md" \
  "pitfall" \
  '{"id":"obs_xxx","pattern":"...","details":"area: ...; issue: ...; impact: ...; resolution: ..."}'
```

`decisions-append` assigns the ADR/PF number, appends to the file, updates the TL;DR, and embeds
`- **Source**: self-learning:{obs_id}` — all atomically under `.decisions.lock`. NEVER hand-edit
the numbering in decisions.md or pitfalls.md.

Delete all claimed `.processing` markers on success.

**On any failure**: leave `.processing` files in place (dream-recover will retry them).
