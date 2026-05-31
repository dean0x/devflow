---
name: sidecar
description: Spawn ONE background sidecar-processor agent that handles all pending maintenance tasks (memory, learning, decisions, knowledge, curation)
allowed-tools: Read, Bash, Agent, Write, Edit, Glob, Grep
---

# Sidecar

Spawn a single background sidecar-processor agent to handle all pending maintenance tasks.

## Iron Law

> **SPAWN EXACTLY ONE BACKGROUND AGENT — IT DOES EVERYTHING**
>
> The main model's only action is a single `Agent({ run_in_background: true })` call.
> Never spawn multiple agents. Never block the user. The processor handles all task types
> sequentially inside a single non-blocking agent.

## Activation

This skill activates when the model receives `SIDECAR: <tasks>` in additionalContext.

## Main Model Action (Do This First, Then Continue)

The main model makes ONE tool call and immediately continues with the user's request:

```
Agent({
  description: "Sidecar processor — maintenance tasks",
  run_in_background: true,
  model: "claude-sonnet-4-5",
  prompt: "<full processor spec below — paste the Tasks section verbatim>"
})
```

The processor spec is everything in the **Processor Spec** section below. The agent runs
independently; the main model does not wait for it.

---

## Processor Spec

You are the Devflow sidecar processor. You handle maintenance tasks left over from prior sessions.
Your role: claim markers atomically, do real LLM work, write results through plumbing ops, clean up.

### Environment

Installed scripts live at `$HOME/.devflow/scripts/hooks/`.
All node invocations use these paths:
- `node "$HOME/.devflow/scripts/hooks/json-helper.cjs" <op> ...`
- `node "$HOME/.devflow/scripts/hooks/lib/feature-knowledge.cjs" <op> ...`
- `node "$HOME/.devflow/scripts/hooks/lib/decisions-index.cjs" <op> ...`

Project root is your current working directory (`.`). All `.devflow/` paths are relative to it.

### Step 0 — Discover pending tasks

List all pending markers:

```bash
ls .devflow/sidecar/*.json 2>/dev/null | grep -v config.json
```

For each file, extract the type prefix (everything before the first `.` in the basename).
Known types: `memory`, `learning`, `decisions`, `knowledge`, `curation`.
Group markers by type. Each group is one task.

### Step 1 — Claim markers atomically

For each marker `{type}.{session}.json`, claim via atomic rename — preserving the session suffix:

```bash
mv ".devflow/sidecar/{type}.{session}.json" ".devflow/sidecar/{type}.{session}.processing" 2>/dev/null
```

If `mv` fails (another processor already claimed it), skip that marker.
If ALL markers for a type fail to claim, skip that task type entirely.

**Heartbeat rule**: At the start of every phase, `touch` each in-flight `.processing` file to
refresh its mtime. This prevents sidecar-recover from reclaiming a file that is actively
being processed (recovery threshold is 1800s; a long knowledge refresh can take time).

**Concurrency rule**: Never hold a lock across tool calls. All log/decisions writes go through
the plumbing ops below — they hold locks internally for one atomic read-modify-write.

**Multi-marker merge**: When multiple `{type}.{session}.processing` files exist for one type,
read them all, then union/concat their payloads before processing:
- `learning`: concatenate `userSignals` strings; union `existingObservationIds` arrays
- `decisions`: concatenate `dialogPairs` strings; union `existingObservationIds` arrays
- `knowledge`: union `staleSlugs` arrays; use any `worktreePath`
- `memory`, `curation`: single marker only

**Input cap**: Process only the last **30** userSignals / dialog-pairs (truncate oldest if more).
This bounds token cost and keeps each run predictable.

---

### Task: memory

Claim `.devflow/sidecar/memory.{session}.json` → `.devflow/sidecar/memory.{session}.processing`.
Also check for legacy `.devflow/sidecar/memory.json`.

Touch the `.processing` file, then:

1. Claim the pending-turns queue atomically:
   ```bash
   mv .devflow/memory/.pending-turns.jsonl .devflow/memory/.pending-turns.processing 2>/dev/null
   ```
   If the rename fails (file absent), proceed — the memory marker alone is enough context.

2. Read `.devflow/memory/.pending-turns.processing` (JSONL: each line `{role, content, ts}`).
   Read `.devflow/memory/WORKING-MEMORY.md` (existing memory; may not exist).

3. **Author the updated memory** (LLM writes this — no canned filler):
   Synthesize the new turns into an updated `WORKING-MEMORY.md`. Keep under 120 lines.
   Required sections:
   - `## Now` — current task/branch/status (1-3 lines)
   - `## Progress` — Done items and In Progress items
   - `## Decisions` — key architectural decisions made this session
   - `## Context` — repository context, branch info
   - `## Session Log` — one-line-per-session summary

4. Write the file, delete `.pending-turns.processing`, then delete all claimed `.processing` markers.

**On any failure**: leave `.processing` files in place (sidecar-recover will retry them).

---

### Task: learning

Touch all claimed `.devflow/sidecar/learning.{session}.processing` files.

Read the merged `userSignals`. Cap at last 30 signals.
Read `.devflow/learning/learning-log.jsonl` in full (needed for recurrence patterns).
Read the existing learning artifacts (commands under `.claude/commands/self-learning/`, skills under `.claude/skills/`).

**LLM judgment — semantic matching and detection**:

Detect WORKFLOW patterns (repeated multi-step sequences) and PROCEDURAL patterns (domain knowledge,
stated preferences, corrections) from the userSignals.

For each detected pattern:
1. Scan the full log for an existing observation with the same semantic meaning.
   - If found: REUSE the existing `obs_` id (do not mint a new one).
   - If genuinely new: mint `obs_<6chars>` (e.g. `obs_a3b9xz`).

2. Decide `confidence` (0.0–1.0), `status` (`observing`/`ready`/`created`), and `quality_ok` (bool).

**Promotion guidance (explicit rule — do not soften)**:
- A one-off mention MUST NOT promote. A pattern promotes ONLY when it has recurred across
  **≥3 DISTINCT sessions** (check `observations` count and `evidence` diversity in the log).
- When promoting: set `status: "created"`, `confidence ≥ 0.8`, `quality_ok: true`.
- When observing: set `status: "observing"`, `confidence < 0.7`.

3. For each observation, write via plumbing (one call per observation, lock acquired+released atomically):

   ```bash
   (
     LOCK=".devflow/sidecar/.reinforce.lock"
     mkdir "$LOCK" 2>/dev/null || { sleep 1; mkdir "$LOCK" 2>/dev/null || exit 1; }
     node "$HOME/.devflow/scripts/hooks/json-helper.cjs" merge-observation \
       ".devflow/learning/learning-log.jsonl" \
       '{"id":"obs_xxx","type":"workflow","pattern":"...","evidence":["..."],"confidence":0.5,"status":"observing","quality_ok":false}'
     rmdir "$LOCK" 2>/dev/null || true
   )
   ```

   Replace the JSON with actual LLM-authored observation data (full fields shown above).

4. **If promoting** (status = `created`): write the artifact file directly:
   - Workflow command: `.claude/commands/self-learning/{slug}.md`
   - Procedural skill: `.claude/skills/{slug}/SKILL.md`
   
   **Artifact content is fully LLM-authored** — write real, useful content. Include the source marker:
   ```
   - **Source**: self-learning:{obs_id}
   ```

5. Delete all claimed `.processing` markers on success.

---

### Task: decisions

Touch all claimed `.devflow/sidecar/decisions.{session}.processing` files.

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

Write each observation:

```bash
(
  LOCK=".devflow/sidecar/.reinforce.lock"
  mkdir "$LOCK" 2>/dev/null || { sleep 1; mkdir "$LOCK" 2>/dev/null || exit 1; }
  node "$HOME/.devflow/scripts/hooks/json-helper.cjs" merge-observation \
    ".devflow/decisions/decisions-log.jsonl" \
    '{"id":"obs_xxx","type":"decision","pattern":"...","evidence":["..."],"details":"context: ...; decision: ...; rationale: ...","confidence":0.95,"status":"observing","quality_ok":true}'
  rmdir "$LOCK" 2>/dev/null || true
)
```

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

---

### Task: knowledge

Touch all claimed `.devflow/sidecar/knowledge.{session}.processing` files.

Read the merged `staleSlugs` and `worktreePath`.

For each stale slug:
1. Read `.devflow/features/index.json` for the entry's `directories` and `referencedFiles`.
2. Read `.devflow/features/{slug}/KNOWLEDGE.md` (existing content).
3. Read the referenced files and directories to understand current state.
4. **Author an updated KNOWLEDGE.md** (LLM writes real content — no canned filler):
   Cover: architecture, key patterns, anti-patterns, gotchas, integration points, key files.
5. Write the updated file.
6. Update the index entry:
   ```bash
   node "$HOME/.devflow/scripts/hooks/lib/feature-knowledge.cjs" update-index \
     "{worktreePath}" \
     --slug="{slug}" \
     --name="{name}" \
     --directories='["{dir1}","{dir2}"]' \
     --referencedFiles='["{file1}"]' \
     --description="{description}"
   ```

After all slugs, write the refresh timestamp:
```bash
date +%s > .devflow/features/.knowledge-last-refresh
```

Delete all claimed `.processing` markers on success.

---

### Task: curation

Touch the claimed `.devflow/sidecar/curation.{session}.processing` file.

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

Editing the file requires holding `.decisions.lock` across the read-modify-write. Because the
Edit tool call cannot be nested inside a Bash call, split the lock lifecycle across three calls
and acquire the lock EXACTLY ONCE — never re-acquire it inside this window:
1. Bash call: acquire the lock.
   ```bash
   LOCK=".devflow/decisions/.decisions.lock"
   mkdir "$LOCK" 2>/dev/null || { sleep 2; mkdir "$LOCK" 2>/dev/null || { echo "lock busy"; exit 1; }; }
   ```
2. Edit tool call(s): flip the `- **Status**:` line and rewrite the TL;DR comment line.
3. Bash call: release the lock.
   ```bash
   rmdir ".devflow/decisions/.decisions.lock" 2>/dev/null || true
   ```
Complete the edit immediately. Do not interleave other tool calls (especially any plumbing op
that takes `.decisions.lock`) between acquire and release.

**Citation preservation**: if an entry being deprecated has inbound `applies ADR-NNN` citations
in other entries, update those entries to reference the surviving entry instead.

**Cap enforcement**: stop after 5 changes regardless of remaining candidates.

**Transparency**: after curation, emit a brief note in the agent output listing what was
deprecated/merged. If nothing was changed, stay silent.

Delete the claimed `.processing` marker on success.

---

### Error discipline

- On success for any task: delete all `.processing` files for that task type.
- On failure for any task: leave `.processing` files in place — sidecar-recover will retry them.
- Never delete `.processing` files for a task that did not fully complete.
- Each task type is independent — a failure in one must not prevent processing of others.
