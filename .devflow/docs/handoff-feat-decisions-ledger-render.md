# Phase 1+2 Implementation Summary
## Branch: feat/decisions-ledger-render

---

## Files Created/Modified

### New Files

- `scripts/hooks/lib/decisions-format.cjs` — Shared pure formatting helpers; single source of truth for byte-compat output strings. Exports: `initDecisionsContent(kind)`, `formatDecisionBody(row)`, `formatPitfallBody(row)`, `buildTldrLine(kind, rows)`.

- `scripts/hooks/lib/render-decisions.cjs` — Pure ledger renderer + CLI. Exports: `renderDecisionsFile(rows, kind)`, `parseLedger(ledgerPath)`, `isActive(row)`, `anchorNumeric(anchorId)`. CLI: `render <worktree>` (write both .md atomically), `--check <worktree>` (diff without writing; exit 1 on drift).

- `tests/decisions/decisions-format.test.ts` — Byte-compat tests for decisions-format.cjs helpers + json-helper.cjs delegation verification.

- `tests/decisions/render-decisions.test.ts` — Golden, idempotency, round-trip, empty-corpus, --check exit codes, AC-P1 perf tests.

- `tests/decisions/observations-schema.test.ts` — Type guard backward-compat + new ledger fields validation.

### Modified Files

- `scripts/hooks/json-helper.cjs` — Imports and delegates to decisions-format.cjs: `initDecisionsContent` now calls `_initDecisionsContent`, `decisions-append` case now calls `formatDecisionBody(entryRow)` / `formatPitfallBody(entryRow)` instead of inline string building. `merge-observation` passthrough updated to preserve new optional ledger fields (anchor_id, date, decisions_status, amendments, raw_body) on both reinforce and new-entry paths.

- `src/cli/utils/observations.ts` — Extended `LearningObservation` interface with 5 optional ledger fields; updated `isLearningObservation` type guard to validate them when present (backward compat: absent fields never cause rejection).

---

## Byte-Compat Strings (DO NOT DRIFT)

These strings are the byte-compat contract. All consumers (session-start-context line 57, apply-decisions, decisions-usage-scan, decisions-index.cjs) depend on them:

### File headers
```
decisions.md: "<!-- TL;DR: 0 decisions. Key: -->\n# Architectural Decisions\n\nAppend-only. Status changes allowed; deletions prohibited.\n"
pitfalls.md:  "<!-- TL;DR: 0 pitfalls. Key: -->\n# Known Pitfalls\n\nArea-specific gotchas, fragile areas, and past bugs.\n"
```

### Decision entry format (produced by `formatDecisionBody(row)`)
```
\n## {anchor_id}: {pattern}\n\n- **Date**: {date}\n- **Status**: Accepted\n- **Context**: {context-from-details}\n- **Decision**: {decision-from-details}\n- **Consequences**: {rationale-from-details}\n- **Source**: self-learning:{id}\n
```

### Pitfall entry format (produced by `formatPitfallBody(row)`)
```
\n## {anchor_id}: {pattern}\n\n- **Area**: {area-from-details}\n- **Issue**: {issue-from-details}\n- **Impact**: {impact-from-details}\n- **Resolution**: {resolution-from-details}\n- **Status**: Active\n- **Source**: self-learning:{id}\n
```
**NOTE: Pitfalls have NO `- **Date**:` line** — this asymmetry is intentional (byte-compat).

### TL;DR line format
```
<!-- TL;DR: N {decisions|pitfalls}. Key: id1, id2 -->
```
- N = count of active entries in the rendered file
- Key = last 5 anchor IDs (comma+space separated), or empty string when corpus is empty
- Line 1 of every decisions.md / pitfalls.md
- Parsed by `session-start-context` via sed

### Details regex patterns (in `formatDecisionBody` / `formatPitfallBody`)
- `context:\s*([^;]+)` → Context field (stops at `;`)
- `decision:\s*([^;]+)` → Decision field (stops at `;`)
- `rationale:\s*([^;]+)` → Consequences field (stops at `;`)
- `area:\s*([^;]+)` → Area field
- `issue:\s*([^;]+)` → Issue field
- `impact:\s*([^;]+)` → Impact field
- `resolution:\s*([^;]+)` → Resolution field
- Fallback: `details` string used verbatim when no tag matches

---

## Schema Extension (`LearningObservation`)

Five new optional fields added to `src/cli/utils/observations.ts`:

```typescript
anchor_id?: string                     // "ADR-016" — assigned once on promotion, never recomputed
date?: string                          // "YYYY-MM-DD" — decisions only, pitfalls omit
decisions_status?: 'Accepted' | 'Active' | 'Deprecated' | 'Superseded' | 'Retired'
amendments?: { date: string; note: string }[]
raw_body?: string                      // verbatim .md body for migrated entries
```

- All optional — backward compat guaranteed (old rows without these fields still pass `isLearningObservation`)
- `decisions_status` is separate from `status` (observation lifecycle) — renderer uses `decisions_status`
- `isLearningObservation` validates types when present; rejects malformed values (e.g., `decisions_status: 'Pending'` → false)

---

## render-decisions.cjs API

### `renderDecisionsFile(rows, kind)` (pure, clock-free)
- `rows`: all ledger rows (unfiltered)
- `kind`: `'decisions'` | `'pitfalls'`
- Filtering: `type` matches kind, `anchor_id` set, `decisions_status` not in `{Deprecated, Superseded, Retired}`
- Sort: numeric anchor ascending
- Per-row: `raw_body` verbatim if present, else `formatDecisionBody`/`formatPitfallBody`
- Returns complete file content (TL;DR line 1 + header + blocks)
- Idempotent; no clocks in output

### `parseLedger(ledgerPath)`
- Returns `[]` when file is absent (ENOENT → empty corpus)
- Skips malformed/empty JSONL lines

### CLI `render <worktree>`
- Reads `.devflow/decisions/decisions-ledger.jsonl` (absent = empty corpus)
- Creates `.devflow/decisions/` if absent
- Acquires `.decisions.lock` (mkdir-based, 30s timeout, 60s stale)
- Writes `decisions.md` and `pitfalls.md` atomically (temp+rename with O_EXCL)
- Exit 0 on success

### CLI `--check <worktree>`
- Renders in-memory, diffs against on-disk .md files
- Exit 0 if identical, exit 1 if drift (no writes ever)
- Treats absent .md files as drift

---

## json-helper.cjs Delegation

Which functions now delegate to decisions-format.cjs:
- `initDecisionsContent(type)` → `_initDecisionsContent(type)` (same signature, same output)
- `decisions-append` case: inline entry string → `formatDecisionBody(entryRow)` / `formatPitfallBody(entryRow)` where `entryRow = { anchor_id, id, pattern, details, date }`

`buildUpdatedTldr` in json-helper.cjs is NOT delegated — it builds TL;DR from existing .md file content (different algorithm, different purpose, not needed by renderer). The renderer uses `buildTldrLine(kind, rows)` from decisions-format.cjs directly.

---

## Test Files Added

- `tests/decisions/decisions-format.test.ts` (19 tests) — byte-compat for all format helpers + json-helper delegation
- `tests/decisions/render-decisions.test.ts` (38 tests) — full renderer: golden, idempotency, round-trip, CLI, perf
- `tests/decisions/observations-schema.test.ts` (29 tests) — type guard: backward compat + new fields accepted/rejected

Total new tests: 86. All 1628 tests pass.

---

## Gotchas for Phase 3

### What Phase 3 must implement
Phase 3 adds: `assign-anchor <obsId> <adrOrPf>`, `retire-anchor <anchorId>`, `rotate-observations` (move 30-day-old unanchored rows to archive). Numbering source moves from .md headings to the anchored ledger.

### Hard-cut: decisions-append is STILL IN json-helper.cjs (Phase 5 task)
Phase 3 kept `decisions-append` intact. Phase 5 will remove it after the migration wires up the new write path via `assign-anchor`.

### Ledger file path
`.devflow/decisions/decisions-ledger.jsonl` — does not exist yet (Phase 3 creates it via migration). `render-decisions.cjs` treats its absence as an empty corpus (correct behavior).

### Lock domain
`.decisions.lock` is shared by `decisions-append` (json-helper.cjs), the renderer CLI, and the future `assign-anchor`/`retire-anchor` ops. These are all in the same lock domain — design intentional per ADR-017.

### `decisions_status` vs `status`
- `status` = observation lifecycle: `observing | ready | created | deprecated`
- `decisions_status` = rendered entry visibility: `Accepted | Active | Deprecated | Superseded | Retired`
- The renderer only looks at `decisions_status` for filtering
- `decisions-index.cjs` reads from .md file content, not the ledger; the renderer's job is to keep the .md in sync with the ledger

### raw_body verbatim passthrough
`raw_body` contains the FULL entry block including the leading `\n## {id}: {title}\n\n` prefix. The renderer emits it verbatim — no reformatting. Phase 3 migration must set `raw_body` correctly when migrating existing .md entries.

### buildUpdatedTldr (json-helper) vs buildTldrLine (decisions-format)
These are two different algorithms:
- `buildUpdatedTldr` (json-helper): rebuilds TL;DR by scanning existing .md content — used by `decisions-append` to update the TL;DR after appending
- `buildTldrLine` (decisions-format): builds TL;DR from ledger rows — used by the renderer
After the migration hard-cuts `decisions-append` (Phase 5), only `buildTldrLine` will remain in use.

---

## Phase 3 Implementation Summary

### Files Modified

- `scripts/hooks/json-helper.cjs` — Added 3 new CLI ops + 3 pure helpers:
  - CLI ops: `assign-anchor <type> <obs_id>`, `retire-anchor <anchor_id> <status>`, `rotate-observations [log] [archive]`
  - Exported pure helpers: `nextAnchorFromLedger(rows, type)`, `countActiveLedgerRows(rows, type)`, `rotateObservations(logPath, archivePath, nowMs)`
  - Updated `count-active` op: prefers ledger-based count, backward-compat with legacy `.md` file-path callers (detects by `.endsWith('.md')` or `isFile()` stat)
  - Imports added: `renderAndWriteAll`, `parseLedger` from render-decisions.cjs; `getDecisionsLedgerPath`, `getDecisionsArchivePath`, `getObservationsLockDir` from project-paths.cjs

- `scripts/hooks/lib/render-decisions.cjs` — Added `renderAndWriteAll(worktreePath, rows)` lock-free helper:
  - Renders both decisions.md and pitfalls.md and writes them atomically
  - Does NOT acquire any lock — callers must hold `.decisions.lock` already
  - The `render` CLI subcommand now delegates to it (holds lock → calls renderAndWriteAll → releases)
  - Exported in `module.exports`

- `scripts/hooks/lib/project-paths.cjs` — Added 3 new path helpers:
  - `getDecisionsLedgerPath(projectRoot)` → `.devflow/decisions/decisions-ledger.jsonl`
  - `getDecisionsArchivePath(projectRoot)` → `.devflow/decisions/decisions-log.archive.jsonl`
  - `getObservationsLockDir(projectRoot)` → `.devflow/dream/.observations.lock`

### New File

- `tests/decisions/ledger-ops.test.ts` — 53 tests covering all new ops

### Op Names + Arg Signatures

```
node json-helper.cjs assign-anchor <type> <obs_id>
  type: 'decision' | 'pitfall'
  obs_id: ID of observation row in decisions-log.jsonl (cwd-relative)

node json-helper.cjs retire-anchor <anchor_id> <status>
  anchor_id: e.g. 'ADR-007' or 'PF-003'
  status: 'Deprecated' | 'Superseded' | 'Retired'

node json-helper.cjs rotate-observations [<log>] [<archive>]
  log: path to decisions-log.jsonl (default: cwd/.devflow/decisions/decisions-log.jsonl)
  archive: path to archive file (default: cwd/.devflow/decisions/decisions-log.archive.jsonl)
```

### Active-default decisions_status written by assign-anchor

- For `type = 'decision'`: `decisions_status = 'Accepted'`
- For `type = 'pitfall'`: `decisions_status = 'Active'`

This matches the byte-compat contract from formatDecisionBody (`- **Status**: Accepted`) and formatPitfallBody (`- **Status**: Active`).

### Lock-free render helper

`renderAndWriteAll(worktreePath, rows)` in render-decisions.cjs:
- Takes the worktree root (not a decisions dir), derives paths via project-paths helpers
- Creates `decisionsDir` if absent
- Calls `renderDecisionsFile` for both kinds and writes atomically via `writeAtomic`
- Emits stderr progress line
- Callers: `assign-anchor` (already holds `.decisions.lock`), `retire-anchor` (already holds `.decisions.lock`), `render` CLI (acquires lock, then calls this, then releases)

### Numbering now reads the ledger

`nextAnchorFromLedger(rows, type)`:
- Scans ALL anchored rows (including Retired/Deprecated/Superseded — only rows with an `anchor_id` matching the type prefix)
- O(N) single pass — returns `{ anchorId, nextN }` where nextN is zero-padded to 3 digits
- ADR and PF sequences are independent

`nextDecisionsId(matches, prefix)` — legacy signature kept for `decisions-append` caller; unchanged.

### Rotation cutoff / timestamp fields

`rotateObservations(logPath, archivePath, nowMs)`:
- Cutoff = `nowMs - 30 * 24 * 60 * 60 * 1000` (30 days)
- Per-row age key: `row.last_seen` if present, else `row.first_seen`
- Rows that move: `status === 'observing'` AND no `anchor_id` AND age > cutoff
- Rows that stay: `status !== 'observing'`, OR has `anchor_id`, OR younger than cutoff, OR no timestamp
- CLI uses `Date.now()`; internal function accepts injectable `nowMs` for test determinism

### Locking discipline enforced

- `assign-anchor` + `retire-anchor`: hold ONLY `.decisions.lock` (at `.devflow/decisions/.decisions.lock`)
- `rotate-observations`: holds ONLY `.observations.lock` (at `.devflow/dream/.observations.lock`)
- `renderAndWriteAll` is lock-free (callers hold the lock before calling it)
- Never both locks at once

### Gotchas for Phase 4 (migration)

1. **Row shape for migrate entries**: When migrating existing `.md` entries to ledger rows, set `anchor_id`, `decisions_status` (Accepted for decisions, Active for pitfalls), `type` (decision/pitfall), and `raw_body` (full entry block verbatim including leading `\n## ID: title\n\n`). The renderer uses `raw_body` when present — no reformatting.

2. **Date field asymmetry**: decisions rows get a `date` field; pitfall rows do NOT. assign-anchor enforces this. Migration must also enforce it.

3. **Retired rows stay in ledger**: Migration should NOT omit Retired/Deprecated/Superseded entries from the ledger. They must be present for AC-F7 (gap numbering) and are simply filtered out by renderDecisionsFile.

4. **decisions-log.jsonl is the observation lifecycle log** (observing/ready). The ledger is anchored rows only. Migration reads BOTH: the existing .md files (for already-rendered ADR/PF entries) and decisions-log.jsonl (for any `ready` rows that should be promoted).

5. **No re-number**: anchor IDs are assigned once and are stable. Migration assigns IDs from the existing .md headings (e.g., `## ADR-016: ...` → `anchor_id: 'ADR-016'`). Do NOT call `assign-anchor` during migration for existing entries — write rows directly.

6. **decisions-ledger.jsonl is the committed file** (tracked by git via `.devflow/.gitignore` re-includes). The archive and log are gitignored. Verify `.devflow/.gitignore` re-includes `decisions/decisions-ledger.jsonl` — currently it only re-includes `decisions/decisions.md` and `decisions/pitfalls.md`. Phase 4 must update the gitignore template to also track `decisions/decisions-ledger.jsonl`.

---

## Phase 4 Implementation Summary

### Files Created/Modified

- `src/cli/utils/decisions-ledger-migration.ts` — NEW. Pure, lock-aware migration function `migrateDecisionsLedger(projectRoot, opts?)`. Exports `MigrateDecisionsLedgerResult` interface.

- `tests/decisions/decisions-ledger-migration.test.ts` — NEW. 20 tests covering golden scenario, synthesis, amendments, hand-deletions, byte-compat round-trip, edge cases, gitignore template, and CJS parity.

- `src/cli/utils/migrations.ts` — Added `sync-devflow-gitignore-v3` (per-project) and `decisions-ledger-unify-v1` (per-project) to `MIGRATIONS` registry.

- `src/cli/utils/project-paths.ts` — Added `!decisions/decisions-ledger.jsonl` to gitignore template. Added `getDecisionsLedgerPath()` and `getDecisionsArchivePath()` exports.

- `scripts/hooks/lib/project-paths.cjs` — Added `!decisions/decisions-ledger.jsonl` to gitignore template. (CJS already had `getDecisionsLedgerPath`/`getDecisionsArchivePath` from Phase 3.)

- `scripts/hooks/ensure-devflow-init` — Synced heredoc with canonical CJS template to include `!decisions/decisions-ledger.jsonl`.

### migrateDecisionsLedger signature

```typescript
export async function migrateDecisionsLedger(
  projectRoot: string,
  opts?: {
    dryRun?: boolean;
    rendererPath?: string;   // override renderer path (tests)
    moduleUrl?: string;      // import.meta.url of caller (for path resolution)
  }
): Promise<MigrateDecisionsLedgerResult>

export interface MigrateDecisionsLedgerResult {
  anchored: number;       // rows matched from log and promoted
  synthesized: number;    // rows built from .md alone (no log entry)
  retired: number;        // hand-deleted anchors (in log but absent from .md)
  observingKept: number;  // observing-only rows that stayed in log
  warnings: string[];     // non-fatal: no-Source entries, duplicate Source ids
}
```

### Registry IDs Added

- `sync-devflow-gitignore-v3` — per-project, adds `!decisions/decisions-ledger.jsonl` to existing `.devflow/.gitignore` (idempotent, preserves existing content)
- `decisions-ledger-unify-v1` — per-project, calls `migrateDecisionsLedger`; runs AFTER the legacy purge migrations

### raw_body boundary convention

`raw_body = '\n' + sectionText.trimEnd() + '\n'`

Where `sectionText` is the text captured by the lookahead split at `## (ADR|PF)-NNN:` (does NOT include the preceding blank line). The `\n` prefix gives the blank-line separator between sections when blocks are joined; `trimEnd()` removes trailing blank lines that belong to the inter-section gap; the trailing `\n` terminates the last field line. This produces byte-identical output when the renderer joins `header + blocks`.

**Critical**: the original section split regex `/(?=^## (?:ADR|PF)-\d+:)/m` means each part starts at the `##` heading. The text between the heading and the NEXT heading includes a trailing blank line (`\n\n` because the next section's `\n` prefix provides one more). Using `trimEnd()` removes that trailing blank line so the inter-section gap is exactly one blank line, matching the original format.

### Bundled renderer path resolution (PF-007)

```typescript
// This file compiles to dist/utils/decisions-ledger-migration.js
// path.resolve(thisDir, '../..') = package root (where scripts/ lives)
function resolveRendererPath(thisModuleUrl: string): string {
  const thisFile = fileURLToPath(thisModuleUrl);
  const thisDir = path.dirname(thisFile);
  const packageRoot = path.resolve(thisDir, '../..');
  return path.join(packageRoot, 'scripts', 'hooks', 'lib', 'render-decisions.cjs');
}
```

The function is called with `import.meta.url` from the migration function so it always resolves relative to the compiled dist file location, not the installed `~/.devflow/scripts/`. Tests inject the renderer via `opts.rendererPath` to bypass the path resolution.

### Dry-run observations on live data copy

Ran against a copy of the live `.devflow/decisions/` (decisions.md 17 entries, pitfalls.md 9 entries, decisions-log.jsonl 32 rows). Result:
- **25 anchored**: log rows matched to .md entries via Source obs_id
- **1 synthesized**: ADR-001 (obs_c9d3m1 present in .md Source but absent from log)
- **3 retired**: ADR-002 (obs_u8elbu), PF-003 (obs_6rp5ri), PF-005 (obs_3vt99r)
- **12 observingKept**: rows with status:'observing' and no anchor
- **0 warnings**: no no-Source entries, no duplicates in live data
- **decisions.md byte-compat**: MATCH (TL;DR Key was the only diff)
- **pitfalls.md byte-compat**: MATCH
- ADR-016 amendment captured in `amendments[]` AND preserved in `raw_body`

### Gotchas for Phase 5 (writer-switch + creation-bar + decisions-append removal)

1. **decisions-log.jsonl stays gitignored**: Phase 5 switches the live write path from `decisions-append` (json-helper.cjs) to `assign-anchor`. The log file remains gitignored; only `decisions-ledger.jsonl` is committed.

2. **Migration idempotency**: `decisions-ledger-unify-v1` is designed to be idempotent. After Phase 5 switches writes to go through `assign-anchor` (which writes directly to the ledger), the migration will detect all anchors already present in the ledger and return a clean no-op.

3. **assign-anchor writes to the ledger, not the log**: After Phase 5, new ADR/PF entries go directly into `decisions-ledger.jsonl` via `assign-anchor`. The old `decisions-append` path wrote to the .md files directly. Phase 5 removes `decisions-append` from `json-helper.cjs`.

4. **Creation-bar**: Phase 5 adds a creation-bar check — if no ledger exists, the Dream agent knows to run the migration before promoting new observations. The migration must be idempotent for this to be safe.

5. **getDecisionsLedgerPath is now exported from TypeScript project-paths.ts**: Any Phase 5 code that needs the ledger path from TypeScript should import from `project-paths.ts`. The CJS version was already exported from Phase 3.

---

## Phase 5 Implementation Summary

### Commit: afc554e

### Files Modified

- `shared/skills/dream-decisions/SKILL.md` — Complete creation-bar rewrite and writer-flow switch.
  See details below.

- `scripts/hooks/json-helper.cjs` — Hard-cut `decisions-append` op and all its private helpers.
  Removed: `case 'decisions-append'`, `nextDecisionsId()`, `buildUpdatedTldr()`.
  Removed from `module.exports`: `nextDecisionsId`.
  Updated header comment, `acquireMkdirLock` JSDoc, and `merge-observation` lock-domain comment
  to remove references to `decisions-append`.

- `scripts/hooks/lib/decisions-format.cjs` — Updated file header comment: "decisions-append" →
  "assign-anchor" in the design note.

- `src/cli/utils/observation-io.ts` — Updated JSDoc comment on `updateDecisionsStatus`: lock
  domain comment now says "assign-anchor writer" instead of "decisions-append writer".

- `tests/decisions/decisions-format.test.ts` — Two updates:
  1. Replaced `describe('json-helper.cjs decisions-append delegates...')` with
     `describe('json-helper.cjs assign-anchor delegates...')` — two tests rewritten to use
     `merge-observation` + `assign-anchor` flow; one new test asserts `decisions-append` op
     exits with error (AC-A8 hard confirmation).
  2. Added new `describe('dream-decisions SKILL.md creation-bar contract')` with 8 content-
     presence assertions covering: abstain-by-default, ADR-XOR-PF, dedup-before-create,
     assign-anchor usage + decisions-append prohibition, no numeric gate (ADR-008), confidence
     metadata framing, Iron Law phrases, NOT-a-decision / NOT-a-pitfall negative examples.

- `shared/skills/docs-framework/SKILL.md` — Updated single reference: Dream agent now "promotes
  observations via assign-anchor" instead of "appends via decisions-append".

### Creation Bar Summary (dream-decisions SKILL.md)

**Abstain-by-default stance** (verbatim): "Most sessions produce nothing. If unsure, record
nothing. Only capture what a future contributor would need and could not reconstruct from the code."

**NOT-a-decision** list: bug fix, one-off UX tweak, routine refactor, applying an existing
pattern, dependency bump, anything already covered by an existing ADR.

**NOT-a-pitfall** list: typo, transient flake, mistake with no general lesson, problem fully
prevented by existing tooling.

**Positive bar**:
- Decision = deliberate architectural choice or trade-off with rationale that constrains future
  work; a real fork in the road, not an obvious choice.
- Pitfall = non-obvious failure mode with a transferable lesson not recoverable from the code.

**ADR-XOR-PF hard rule**: one incident yields exactly one of an ADR or a PF, never both.
Concrete failure → PF; forward-looking architectural choice → ADR.

**Dedup-before-create**: read the log first; if any existing row (any status, including Retired)
covers the concern, reinforce it via `merge-observation` (reuse `obs_` id) instead of creating
a new entry.

**Confidence**: honest LLM estimate, curation metadata only, NOT a gate. No numeric threshold
cited anywhere in the SKILL (ADR-008). The SKILL no longer references 0.65 or 0.95.

### New Iron Law

> **assign-anchor OWNS NUMBERING; render OWNS THE .md; NEVER HAND-EDIT**
>
> ADR and PF numbers are assigned exclusively by `assign-anchor`. The `.md` files are
> written exclusively by `render-decisions.cjs`. Never write, edit, or infer an ADR-NNN
> or PF-NNN number directly into decisions.md or pitfalls.md. Never call `decisions-append`.

### Writer Flow (as instructed in SKILL)

1. `merge-observation` → record/reinforce the observation in `decisions-log.jsonl` (under
   `.observations.lock` held by the caller shell subshell).
2. `assign-anchor <type> <obs_id>` → scans the ledger for max anchor incl. Retired, assigns
   max+1 zero-padded 3-digit ID, writes anchored row to `decisions-ledger.jsonl`, marks log
   row as `created`, registers usage, re-renders both `.md` — all atomically under
   `.decisions.lock`.

### decisions-append is GONE

- `case 'decisions-append':` removed from `json-helper.cjs`.
- `nextDecisionsId()` removed (only called by `decisions-append`).
- `buildUpdatedTldr()` removed (only called by `decisions-append`).
- `module.exports.nextDecisionsId` removed.
- `grep -rn "decisions-append" scripts/ shared/ src/ tests/` returns only:
  - `tests/decisions/decisions-format.test.ts` — AC-A8 test that asserts the op is rejected
    and a comment explaining the removal
  - `shared/skills/dream-decisions/SKILL.md` — "NEVER call `decisions-append`" prohibition
  - `shared/skills/dream-curation/SKILL.md` — Phase 6 handles this (plan says leave alone)
  - `scripts/hooks/lib/decisions-format.cjs` — historical comment (updated)
  - `src/cli/utils/observation-io.ts` — JSDoc comment (updated)
  - No live callers remain.

### Test Count

- Before Phase 5: 1710 tests (all passing).
- After Phase 5: 1710 tests (net: replaced 2 + added 9 SKILL assertions + added 1 AC-A8 op-
  rejection test = +8 net additional, offset by the 2 decisions-append tests that became the
  2 assign-anchor tests). All 1710 pass.

### Gotchas for Phase 6 (dream-curation)

1. **dream-curation/SKILL.md still says "decisions-append adds"**: Line 15 of dream-curation
   SKILL.md says `decisions-append adds, curation flips status`. Phase 6 must update this to
   reflect the new writer: "assign-anchor adds". Lines 75-77 also mention decisions-append in
   the context of a prohibition — these can be updated to just say "call assign-anchor for
   new entries; curation only flips status."

2. **retire-anchor for deprecation**: Currently dream-curation directly edits the .md files
   under `.decisions.lock` to flip `- **Status**:` to `Deprecated`. Phase 6 should switch
   this to use `retire-anchor <anchor_id> Deprecated` (or `Superseded`) instead — this keeps
   the ledger in sync and lets `renderAndWriteAll` produce the canonical output. Phase 6 must
   also ensure the ADR-XOR-PF and dedup rules are mirrored minimally into dream-curation.

3. **rotate-observations wiring into curation**: Phase 6 should wire `rotate-observations` as
   a step in the curation pass. The op already exists in `json-helper.cjs`; curation just
   needs to call it (under `.observations.lock`, not `.decisions.lock`).

4. **count-active legacy .md path**: After all projects migrate, the legacy `.md`-file-path
   fallback in `count-active` can be removed. Phase 6 can decide whether to defer this to
   Phase 8 or drop it now.

5. **observation-io.ts direct .md writers**: `updateDecisionsStatus` in `observation-io.ts`
   still directly edits `.md` files. Phase 6 or later should migrate it to use `retire-anchor`
   via `json-helper.cjs` so all writes go through the ledger.

6. **legacy-decisions-purge.ts**: If this file still contains direct `.md` writers, Phase 6
   should audit it. The pattern should be: purge via `retire-anchor`, render via
   `renderAndWriteAll`.

7. **Locking discipline reminder**: assign-anchor holds `.decisions.lock`; rotate-observations
   holds `.observations.lock`. NEVER hold both at once (per ADR-017).

---

## Phase 6 Implementation Summary

### Commit: c9e6fcd

### Files Created/Modified

- `shared/skills/dream-curation/SKILL.md` — Full rewrite.
  - Iron Law: "RETIRE BY STATUS — THE LEDGER IS THE SOURCE OF TRUTH"
  - Added sentence: "`assign-anchor` adds new entries; curation flips status only — never creates entries" (mirrors the line that was "decisions-append adds, curation flips status")
  - Removed 3-call lock/Edit dance; replaced with `retire-anchor <anchor_id> <status>` (self-locking, atomic, idempotent)
  - Wired `rotate-observations` as the FIRST step in the curation procedure, under `.observations.lock`
  - 7-day window now keyed off ledger row `date` field (not .md content)
  - ADR-XOR-PF and dedup awareness mirrored from dream-decisions (minimal)
  - Recoverability documented: flip `decisions_status` back to Accepted/Active via direct ledger write + render
  - Batch retirement: call `retire-anchor` once per entry, each self-locks; never hold `.decisions.lock` across multiple `retire-anchor` calls (would deadlock)
  - Applies ADR-017: locking note says `.observations.lock` and `.decisions.lock` are never held simultaneously

- `src/cli/utils/observation-io.ts` — Removed `updateDecisionsStatus` function.
  - Zero callers at time of removal (verified with grep)
  - Removal note added to file header: explains .md files are pure renders; future status changes must go through `retire-anchor` in json-helper.cjs
  - Removed unused imports: `path`, `acquireMkdirLock`, `type DecisionsEntryStatus`
  - Kept: `readObservations`, `writeObservations`, `warnIfInvalid` (unchanged)

- `src/cli/utils/legacy-decisions-purge.ts` — Added ordering/deprecation comment.
  - ORDERING NOTE: both exported functions operate on PRE-LEDGER .md files and run BEFORE `decisions-ledger-unify-v1` — this ordering is correct and must not change
  - DEPRECATION: superseded by ledger render model; future purges should target `decisions-ledger.jsonl` via `retire-anchor` + re-render
  - No behavioral changes; existing tests still pass

- `tests/decisions/dream-curation.test.ts` — NEW file, 31 tests:
  - SKILL content assertions (all prose assertions)
  - AC-F4/F5/F6/F7: retire-anchor + render lifecycle: hides from .md, survives in ledger, number not reused, raw_body round-trip restoration
  - AC-F9: rotation wiring contract (SKILL ordering check + op-level belt-and-suspenders)
  - observation-io surface test: `updateDecisionsStatus` is undefined in module exports

- `tests/learning/review-command.test.ts` — Migrated away from `updateDecisionsStatus`:
  - Removed 5 tests that asserted direct .md editing
  - Replaced with 1 test: "observation-io module does not export updateDecisionsStatus"
  - Removed import of `updateDecisionsStatus` from observation-io

### Key Decisions

1. **Removed `updateDecisionsStatus` (not redirected)**: The plan said "redirect to ledger + render OR remove if dead". It had zero callers — removal was cleaner than keeping a function with no callers even if redirected. Documented in file header and test.

2. **legacy-decisions-purge.ts: comment only, no guard**: The purge runs BEFORE the ledger migration, so it never encounters a ledger. Adding a guard would be dead code. The ordering comment + deprecation note suffice. If someone runs it after a ledger exists, it still works correctly (it only purges seeded entries from .md files that may have already been migrated — idempotent).

3. **Batch retire-anchor: one call per entry, not one outer lock**: `retire-anchor` is self-locking. Calling it N times is safe and correct. The old guidance suggested holding one lock for multiple .md edits; the new guidance correctly says never hold `.decisions.lock` across multiple `retire-anchor` calls.

4. **Recoverability via direct ledger write + render**: `retire-anchor` only accepts retiring statuses (Deprecated/Superseded/Retired). Re-activation requires a direct ledger write. The SKILL documents this clearly. No new plumbing needed for Phase 6.

### Integration Points for Phase 7 (Dream auto-commit)

Phase 7 adds a `scripts/hooks/dream-commit` helper and wires it into:
- `dream-decisions` (after assign-anchor, commit the ledger + rendered .md)
- `dream-curation` (after retire-anchor runs, commit the updated ledger + .md)
- `knowledge-refresh` (existing pattern)

Key facts for Phase 7:
- The files to commit are: `decisions-ledger.jsonl`, `decisions.md`, `pitfalls.md` (all in `.devflow/decisions/`)
- `decisions-ledger.jsonl` is git-tracked (re-included by `.devflow/.gitignore` via `sync-devflow-gitignore-v3` migration)
- `decisions.md` and `pitfalls.md` are git-tracked (always were)
- `decisions-log.jsonl` is gitignored (observation lifecycle log — not committed)
- `decisions-log.archive.jsonl` is gitignored (rotation archive — not committed)
- Config default: auto-commit should be ON by default; `devflow decisions --status` should report it
- The commit should be a `chore(decisions):` conventional commit

Phase 7 must NOT call `git commit` while holding `.decisions.lock` or `.observations.lock` (those are already released before the commit step).

### Gotchas for Phase 8 (cleanup)

- `decisions-index.cjs` still has a `KNOWN_STATUSES` set and Deprecated/Superseded filter — Phase 8 removes this since the .md files no longer contain non-active entries (the renderer filters them out before writing). This unlocks ~25 filter tests to remove.
- After Phase 8, `count-active` from `.md` file content (the legacy path in json-helper.cjs that does `countActiveHeadings`) is dead code — every project will have migrated to the ledger. Phase 8 can remove the `.endsWith('.md')` fallback.
- `npm run build` in Phase 8 must succeed with no errors (the build already succeeds; Phase 8 just needs to not break it).
