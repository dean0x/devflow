---
name: dream-curation
description: "Dream agent per-task procedure for the 'curation' task. Loaded EXPLICITLY by the Dream agent via the Skill tool when the agent is spawned for a curation task — not auto-activated. Handles periodic housekeeping of decisions.md and pitfalls.md."
allowed-tools: Read, Bash, Write, Edit, Glob, Grep
---

# Dream Task: curation

## Iron Law

> **DEPRECATE, NEVER DELETE — THE APPEND-ONLY INVARIANT IS ABSOLUTE**
>
> Curation may only flip an entry's status to `Deprecated` and rewrite the TL;DR comment.
> Entries are never removed from decisions.md or pitfalls.md. The file is append-only;
> `decisions-append` adds, curation flips status — nothing else touches the corpus.

This skill is loaded by the Dream agent after it has claimed the curation marker.
The agent has already done: claim (mv .json → .processing). Curation uses a single marker only.

## Procedure

Touch the claimed `.devflow/dream/curation.{session}.processing` file.

This task performs periodic housekeeping of decisions.md and pitfalls.md.
Bounds: **≤5 changes per run**. **7-day protection window** — never touch any entry whose
`- **Date**: YYYY-MM-DD` line is within the past 7 days.

Read all inputs:
```bash
# Active entry counts
node "$HOME/.devflow/scripts/hooks/json-helper.cjs" count-active \
  ".devflow/decisions/decisions.md" "decision"
node "$HOME/.devflow/scripts/hooks/json-helper.cjs" count-active \
  ".devflow/decisions/pitfalls.md" "pitfall"
```

Also read `.devflow/decisions/decisions.md`, `.devflow/decisions/pitfalls.md`,
`.devflow/decisions/decisions-log.jsonl`, and `.devflow/decisions/.decisions-usage.json`.

Cite counts come from `.decisions-usage.json` — read it directly. Each entry is keyed by
anchor ID (`ADR-NNN` / `PF-NNN`) with `{ cites, last_cited, created }`. There is no separate
"scan" step here: `decisions-usage-scan.cjs` is a write-path tool that increments cite counts
from session text, not a reporter — do not call it from the curation task.

**Staleness signal** (run once per curation task, before selecting candidates):

```bash
node "$HOME/.devflow/scripts/hooks/lib/staleness.cjs" \
  ".devflow/decisions/decisions-log.jsonl" \
  "$(pwd)"
```

Entries flagged `mayBeStale: true` in the log (their referenced files no longer exist) are
**preferred deprecation candidates**, WITHIN the existing 7-day protection window and ≤5-changes
bounds. This is a signal to prefer — not an automatic deprecation. Apply normal LLM judgment:
a stale-referenced entry that is otherwise heavily cited should survive over one that is
uncited and stale.

**LLM judgment — identify entries to deprecate or merge**:

Deprecate an entry when it is:
- Superseded by a newer, more precise entry on the same topic
- Contradicted by evidence in recent sessions
- Never cited (0 cites) AND older than 30 days AND low-confidence in the log

Merge near-duplicates: when two entries cover the same concern, deprecate the less specific one
and update the surviving entry to absorb the key insight.

**DEPRECATE, NEVER DELETE** (append-only invariant):
Curation deprecates an *existing* entry by directly editing two lines together:
1. Flip its status to `- **Status**: Deprecated` (exact literal — decisions-index.cjs matches this).
2. Rewrite the TL;DR comment (`<!-- TL;DR: N decisions. Key: ... -->`) so the count drops by one
   and the deprecated ID is dropped from the `Key:` list.

Do NOT use `decisions-append` for deprecation. `decisions-append` *appends a new* ADR/PF entry
and acquires `.decisions.lock` internally — calling it while you already hold that lock (below)
would deadlock, and appending is the wrong operation for deprecating an existing entry.

Editing the file requires holding `.decisions.lock` across the read-modify-write. Acquire the
lock EXACTLY ONCE using bounded retry+backoff (explicit cap: 9 attempts, ~47s total backoff;
on exhaustion leave `.processing` for retry — NEVER silently drop the write).
Because the Edit tool call cannot be nested inside a Bash call, split the lock lifecycle
across three separate calls and NEVER re-acquire it inside this window:

1. Bash call: acquire the lock with bounded retry.
   ```bash
   LOCK=".devflow/decisions/.decisions.lock"
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
     echo "dream-curation: failed to acquire .decisions.lock after 9 attempts — leaving .processing for retry" >&2
     exit 1
   fi
   ```
2. Edit tool call(s): flip the `- **Status**:` line and rewrite the TL;DR comment line.
3. Bash call: release the lock.
   ```bash
   rmdir ".devflow/decisions/.decisions.lock" 2>/dev/null || true
   ```

Complete all edits before releasing. Do not interleave other tool calls (especially any
plumbing op that takes `.decisions.lock`) between acquire and release — that would deadlock.

**Citation preservation**: if an entry being deprecated has inbound `applies ADR-NNN` citations
in other entries, update those entries to reference the surviving entry instead.

**Cap enforcement**: stop after 5 changes regardless of remaining candidates.

**Transparency**: after curation, emit a brief note in the agent output listing what was
deprecated/merged. If nothing was changed, stay silent.

Delete the claimed `.processing` marker on success.

**On any failure**: leave `.processing` files in place (dream-recover will retry them).
