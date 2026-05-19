# Consistency Review Report

**Branch**: feat/177-revisit-project-knowledge-system---analy -> main
**Scope**: Incremental review of 10 resolution commits (`git diff 0dd9e24...HEAD`)
**Date**: 2026-04-13_2208
**PR**: #181

## Summary of Focus Areas Examined

1. Atomic-write `wx` flag pattern applied in 4+ files — same approach? same retry semantics?
2. Type guards across `learn.ts` / `notifications.ts` / `learning-counts.ts` — naming and style
3. D34-tagged duplication of fs-lock helpers — do the helpers match the documented contract?
4. 4 teams-variant commands — phase numbering consistency after Record Pitfalls/Decisions removal
5. `plugin.json` files (3 changed) — knowledge-persistence removal uniform?
6. Migration JSDoc D-tags (D30–D38) — present at all sites, consistent style?

---

## Issues in Your Changes (BLOCKING)

### HIGH

**`writeFileAtomic` retry is not race-tolerant in TypeScript but IS race-tolerant in JavaScript — retry semantics diverge across 5 implementations ({N} occurrences)** — Confidence: 95%

- `src/cli/commands/learn.ts:395-407` (`writeFileAtomic`)
- `src/cli/utils/legacy-knowledge-purge.ts:50-61` (`writeFileAtomic`)
- `src/cli/utils/migrations.ts:157-180` (`writeAppliedMigrations`)
- `scripts/hooks/json-helper.cjs:137-146` (`writeExclusive`) — **IS race-tolerant**
- `scripts/hooks/knowledge-usage-scan.cjs:117-124` (inline) — **IS race-tolerant**

Problem: The PR applies the `{ flag: 'wx' }` pattern in 5 sites, but only the 2 CommonJS sites (`json-helper.cjs::writeExclusive` and `knowledge-usage-scan.cjs` inline) wrap the inter-attempt `unlinkSync` call in `try { ... } catch { /* race */ }`. The 3 TypeScript sites call `await fs.unlink(tmp)` with no catch — so if another writer removes the stale `.tmp` between our EEXIST and our unlink (a legitimate race the CJS code anticipates), the TS code throws. The documented intent is clearly "stale/adversarial tmp — unlink and retry once"; the 3 TS sites do not honour this race resilience.

Evidence — json-helper.cjs:143 (race-tolerant):
```js
try { fs.unlinkSync(tmp); } catch { /* race — already removed */ }
fs.writeFileSync(tmp, content, { flag: 'wx' });
```

legacy-knowledge-purge.ts:55-58 (not race-tolerant):
```ts
if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
// Stale or attacker-placed .tmp — remove it and retry once.
await fs.unlink(tmp);
await fs.writeFile(tmp, content, { encoding: 'utf-8', flag: 'wx' });
```

If `fs.unlink` throws `ENOENT` (already removed by a competing process) the whole operation fails and propagates up, despite the subsequent `fs.writeFile(wx)` likely succeeding.

Fix: Extract a shared `writeFileAtomicExclusive(filePath, content)` helper in a single module (e.g. `src/cli/utils/fs-atomic.ts`) and import it from all three TS sites. The helper must mirror `json-helper.cjs::writeExclusive` race semantics:
```ts
export async function writeFileAtomicExclusive(filePath: string, content: string): Promise<void> {
  const tmp = `${filePath}.tmp`;
  try {
    await fs.writeFile(tmp, content, { encoding: 'utf-8', flag: 'wx' });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    try { await fs.unlink(tmp); } catch { /* race — already removed */ }
    await fs.writeFile(tmp, content, { encoding: 'utf-8', flag: 'wx' });
  }
  await fs.rename(tmp, filePath);
}
```
Replace the three inline copies. This collapses 3 near-duplicates to 1 import and fixes the race-tolerance regression in one edit.

---

**`isNotificationMap` has two incompatible definitions reading the same file** — `src/cli/hud/notifications.ts:28-30` vs `src/cli/commands/learn.ts:31-36` — Confidence: 95%

Problem: Both files read `.memory/.notifications.json` and gate access through a guard named `isNotificationMap`, but they enforce different invariants:

- `notifications.ts:28-30` — shallow: object, not null, not array. Entries can be anything (null, strings, arrays).
  ```ts
  function isNotificationMap(v: unknown): v is Record<string, NotificationEntry> {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
  }
  ```
- `learn.ts:31-36` — deep: object, not null, not array, AND every entry is an object, not null, not array.
  ```ts
  function isNotificationMap(v: unknown): v is Record<string, NotificationFileEntry> {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
    return Object.values(v as object).every(
      (entry) => typeof entry === 'object' && entry !== null && !Array.isArray(entry),
    );
  }
  ```

Impact: Given `.notifications.json = {"foo": null}`:
- `learn.ts` rejects it → warns "unexpected shape — treating as empty"
- `notifications.ts` accepts it → iterates with a subsequent `if (!entry) continue` guard that handles null differently
These diverge on edge-case JSON that either file could produce; same identifier, same file, same key, different semantics.

Also inconsistent: `learn.ts` attaches JSDoc `D-SEC1` + `D-SEC2` tags; `notifications.ts` guard has no D-tag at all despite being introduced in the same PR with identical intent ("TOCTOU/malformed JSON hardening").

Fix: Decide on one shape contract, then:
1. Extract the guard to a shared module (e.g. `src/cli/utils/notifications-schema.ts`) that both `NotificationEntry` (HUD) and `NotificationFileEntry` (CLI) schemas can consume, OR
2. Use the same deep variant from `learn.ts` in both places (preferred — rejects malformed entries earlier), and tag both occurrences with the same `D-SEC1` label.

---

**D-tag naming is inconsistent across security commits in the same PR — `D-SEC{1,2,3}` vs `D{35}` vs no tag** — Confidence: 90%

- `src/cli/commands/learn.ts:27, 37, 125` — uses `D-SEC1`, `D-SEC2`, `D-SEC3`
- `src/cli/utils/legacy-knowledge-purge.ts:45, 48` — uses `D35`
- `src/cli/hud/notifications.ts:24-30` — **no D-tag at all** despite introducing the same kind of runtime guard
- `src/cli/utils/migrations.ts:16, 74, 121, 223, 258, 282, 294` — uses `D30`–`D38` (numeric)
- `scripts/hooks/json-helper.cjs:131-135` — no D-tag, just docstring

Per the user feedback stored in global memory ("design-decisions-jsdoc: Design decisions must be JSDoc D-series comments at code sites — hard acceptance criterion"), every load-bearing decision should carry a D-series reference. The PR mixes three schemes:
1. `D-SEC1`/`D-SEC2`/`D-SEC3` — learn.ts only
2. `D30`–`D38` — migrations.ts, legacy-knowledge-purge.ts
3. none — notifications.ts, json-helper.cjs

These aren't necessarily wrong individually, but reading the PR as a whole, a reader cannot tell whether `D-SEC3` in learn.ts is the same design as `D35` in legacy-knowledge-purge.ts (they describe the same wx-flag TOCTOU fix — they should share an ID, or cross-reference).

Fix: Pick one scheme and normalise. Suggested: allocate `D39` (or similar) for "atomic write with wx TOCTOU hardening" and reference it from all four sites (learn.ts, legacy-knowledge-purge.ts, json-helper.cjs, knowledge-usage-scan.cjs, migrations.ts::writeAppliedMigrations). Replace the orphan `D-SEC1/2/3` labels with numeric equivalents to match the rest of the project. For the shallow vs deep `isNotificationMap` consolidation, add one D-tag shared between notifications.ts and learn.ts.

---

**Three `acquireMkdirLock`/`acquireLock`/bash `acquire_lock` helpers diverge from the documented contract** — Confidence: 92%

Files/contracts:
- `shared/skills/knowledge-persistence/SKILL.md:117-121` documents: **30 s timeout, 60 s stale**.
- `src/cli/commands/learn.ts:357` — `acquireMkdirLock(timeoutMs = 30_000, staleMs = 60_000)` ✅ matches contract
- `src/cli/utils/legacy-knowledge-purge.ts:68-90` — `acquireMkdirLock(timeoutMs = 30_000, staleMs = 60_000)` ✅ matches contract (identical to learn.ts modulo comment drift `/* race OK */` vs `/* race condition OK */`)
- `scripts/hooks/json-helper.cjs:429` — `acquireLock(timeoutMs = 30000, staleMs = 60000)` ✅ matches contract — but **different function name** (`acquireLock` vs `acquireMkdirLock`)
- `scripts/hooks/background-learning:70-80` — `acquire_lock` (bash) uses `timeout=90`, and `STALE_THRESHOLD=300` (5 min) from `break_stale_lock` at line 54-66. **This contradicts the skill's documented 30 s / 60 s contract.**

The PR adds D34 to legacy-knowledge-purge.ts noting "same mkdir-based lock used by json-helper.cjs render-ready and updateKnowledgeStatus in learn.ts" and the `acquireMkdirLock` JSDoc claims "all lock holders interpret staleness consistently". That claim is not borne out: the bash hook uses a very different staleness and timeout, and the function names (`acquireMkdirLock` in TS vs `acquireLock` in JS vs `acquire_lock` in bash) drift as well.

Fix:
1. Rename `scripts/hooks/json-helper.cjs::acquireLock` → `acquireMkdirLock` (match TS) — purely cosmetic, but unifies vocabulary that the D34 comment explicitly promises.
2. Update `scripts/hooks/background-learning:54, 71` to use `STALE_THRESHOLD=60` and `timeout=30` — or if background-learning needs longer waits for legitimate reasons, document why in a D-tag explaining the deviation.
3. Cross-reference the knowledge-persistence SKILL.md lock contract from all three implementations so a future reader finds the single source of truth.

### MEDIUM

**`staleness.cjs` writes `learning-log.jsonl` non-atomically — breaks the atomic-write contract the PR enforces elsewhere** — `scripts/hooks/lib/staleness.cjs:92` — Confidence: 88%

Problem: The learning log is otherwise written only via `writeJsonlAtomic` (tmp + wx + rename) in `json-helper.cjs`. `staleness.cjs` is new in this PR and writes the log with a raw `fs.writeFileSync(logFile, out, 'utf8')` — no tmp, no wx, no rename. A reader concurrent with this write can observe a torn file (partial line) and a parallel JSON.parse will crash/skip entries.

Evidence — staleness.cjs:87-94:
```js
const updated = checkStaleEntries(entries, cwd);
const flagged = updated.filter(e => e.mayBeStale).length;
if (flagged > 0) {
  const out = updated.map(e => JSON.stringify(e)).join('\n') + '\n';
  fs.writeFileSync(logFile, out, 'utf8');   // ← not atomic
  ...
}
```

Fix: Import `writeJsonlAtomic` (or the new `writeExclusive` helper) from `json-helper.cjs`, or inline the same tmp+rename dance. Also: staleness.cjs holds no lock while writing, so it can race with `json-helper.cjs` writers that DO acquire `.learning.lock`. Either acquire the same lock before writing, or document why staleness can race safely.

---

**`writeAppliedMigrations` duplicates the wx-retry pattern inline instead of calling the new helper** — `src/cli/utils/migrations.ts:157-180` — Confidence: 85%

Problem: `migrations.ts::writeAppliedMigrations` contains a copy of the same wx-retry dance that was just extracted into `writeExclusive` (json-helper.cjs) and the TS `writeFileAtomic` helpers. The migration file ends up with a 4th inline copy. No D-tag cross-references the shared design.

Evidence — migrations.ts:167-178:
```ts
try {
  await fs.writeFile(tmp, content, { encoding: 'utf-8', flag: 'wx' });
} catch (err) {
  if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
    await fs.unlink(tmp);
    await fs.writeFile(tmp, content, { encoding: 'utf-8', flag: 'wx' });
  } else {
    throw err;
  }
}
await fs.rename(tmp, filePath);
```
This is `learn.ts::writeFileAtomic` spelled out inline. Same bug as HIGH #1: the inner `fs.unlink(tmp)` is not wrapped in try/catch, so it is not race-tolerant.

Fix: Consolidate alongside HIGH #1. Once `writeFileAtomicExclusive` is extracted, call it here too.

---

**Phase-numbering renumbering applied correctly in all 4 teams commands — but architecture diagrams lag prose in one file** — Confidence: 85%

Per-file phase sequences after the "Record Pitfalls/Decisions" removal:

| File | Phases (prose headings) | Last phase | Gap? |
|------|-------------------------|------------|------|
| `plugins/devflow-code-review/commands/code-review-teams.md` | 0,1,2,3,4,5,6 | 6 | No gap |
| `plugins/devflow-debug/commands/debug-teams.md` | 1,2,3,4,5,6,7,8 | 8 | No gap |
| `plugins/devflow-implement/commands/implement-teams.md` | 1,2,3,4,5,6,7,8,9,10 | 10 | No gap |
| `plugins/devflow-resolve/commands/resolve-teams.md` | 0,1,2,3,4,5,6,7,8 | 8 | No gap |

All four prose sequences are gap-free. Architecture diagrams and "Output Artifact" back-references were also updated in resolve-teams.md (Phase 9 → Phase 8) and debug-teams.md (Phase 9 → Phase 8 collapsed). code-review-teams.md architecture diagram: updated Phase 6→cleanup; no orphan reference to the removed Phase 6.

**However**: The 4 files use different comment conventions for the removed phase:

- `code-review-teams.md:260-261`, `debug-teams.md:558-559`, `resolve-teams.md:1222-1223` — `<!-- D8: "Record Pitfalls" phase removed — ... -->`
- `implement-teams.md:975-976` — `<!-- D8: "Record Decisions" block removed — ... -->`

This is not really inconsistent (Pitfalls vs Decisions reflects the actual content that was removed), but the three Pitfalls files have identical boilerplate whereas implement-teams.md differs in structure (phase title changes `Report + Record Decisions` → `Report`, followed by the comment block). That's fine semantically but makes grep-finding all four sites awkward. Consider unifying the comment prefix: `<!-- D8: knowledge-persistence phase removed — writer moved to background-learning extractor. -->` in all four, then have the specific text ("pitfalls" / "decisions") only in the prose that describes what was there.

---

**Hook script stale-threshold comment drift — `/* race condition OK */` vs `/* race OK */` vs `/* race — already removed */`** — Confidence: 82%

Three identical-intent catch comments across this PR with three different wordings:

- `src/cli/commands/learn.ts:367` — `/* race condition OK */`
- `src/cli/utils/legacy-knowledge-purge.ts:82` — `/* race OK */`
- `scripts/hooks/json-helper.cjs:143, 442` — `/* race — already removed */`, `/* already gone */`
- `scripts/hooks/knowledge-usage-scan.cjs:121` — `/* race — already removed */`

Each comment tries to say "we intentionally swallow this error because another process raced ahead of us and that's expected". Having four different phrasings is benign but makes code-search across the cluster harder. If someone greps `race condition OK` they'll find exactly one of the four. Pick one phrasing (suggest: `/* race — already gone */`) and replace_all.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**`runMigrations` infos/warnings output doesn't match error output pattern** — `src/cli/commands/init.ts:777-790` — Confidence: 78%

Problem: `migrationResult.failures` are rendered as `p.log.warn(`Migration '${f.id}' in ... failed: ${f.error.message}`)` — always `warn`, never `error`, despite the D33 JSDoc in migrations.ts calling them "non-fatal" but still failures. `migrationResult.warnings` are also rendered as `p.log.warn`. Both use identical log level, so from the user's perspective there's no way to tell "a real migration failed" apart from "a migration produced a diagnostic". The `infos` go to `p.log.info`; `success` is emitted only for the aggregate count.

Inconsistent with how `learn.ts` / `init.ts` signal failures elsewhere (e.g., `p.log.error('Learning system is currently running. Try again in a moment.')` at learn.ts:415). Migration failures are arguably more severe than lock-contention transient errors; they should at minimum distinguish themselves in the output.

Fix: Use `p.log.error` for `migrationResult.failures` and `p.log.warn` for `migrationResult.warnings`. This gives the user three distinct log levels corresponding to three distinct semantic categories.

---

**Type guard style inconsistency — `isRawObservation` does NOT use an exhaustive check marker while `getLearningCounts` does** — `src/cli/hud/learning-counts.ts:18-23` — Confidence: 72%

Problem: The diff adds a `default` branch to the `switch (parsed.type)` block in `getLearningCounts` using the `const _exhaustive: never = parsed.type` pattern (lines 1082-1085 in the diff). Nice. But the type guard `isRawObservation` (same file, top) still uses a hardcoded array literal `['workflow', 'procedural', 'decision', 'pitfall'].includes(o.type)`. If someone adds a 5th observation type, the exhaustiveness check catches it at the switch but the type guard silently rejects the new type at parse time.

Fix: Derive both from a shared `const RAW_OBSERVATION_TYPES = ['workflow', 'procedural', 'decision', 'pitfall'] as const;` and use it in both the guard and the switch exhaustiveness comment. This way a new type forces both sites to update simultaneously.

## Pre-existing Issues (Not Blocking)

_None significant enough to report._

## Suggestions (Lower Confidence)

- **Consistency between `isCountActiveResult` (learn.ts) and a missing equivalent in HUD / other readers** — `src/cli/commands/learn.ts:40-43` (Confidence: 68%) — The PR introduces a narrow count-active guard in learn.ts, but the same `count-active` command output is consumed elsewhere (json-helper.cjs internal). If another TS caller later parses the same subcommand's output, they'll re-derive an ad-hoc guard. Consider exporting `isCountActiveResult` from a shared module.

- **`SEVERITY_VALUES` in notifications.ts vs `SEVERITY_ORDER` in same file** — `src/cli/hud/notifications.ts:22-24` (Confidence: 65%) — Two constants encoding the same severity set; `SEVERITY_VALUES` is the array, `SEVERITY_ORDER` is the ordinal map. `SEVERITY_ORDER`'s keys should be derived from `SEVERITY_VALUES`, not hand-spelled, so a 4th severity can't get added in one but forgotten in the other.

- **`FORMAT_SPEC_SKILLS` set declared inside `describe` block** — `tests/build.test.ts` (Confidence: 62%) — The new `FORMAT_SPEC_SKILLS` set is declared inside `describe('no orphaned declarations', ...)`. If a 2nd skill ever moves into format-spec status, the set has to be grown at this exact location. Consider hoisting to module scope with a JSDoc explaining the semantic category, so it's grep-findable from `shared/skills/`.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 4 | 4 | 0 |
| Should Fix | 0 | 0 | 2 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Consistency Score**: 6/10

The PR makes substantive progress consolidating type-guard, atomic-write, and phase-numbering patterns across a large surface. However, the core promises of the refactor are **semi-applied**:
- wx-flag pattern spreads to 5 call sites but race-tolerance diverges between TS and JS writers
- `isNotificationMap` is a single identifier with two incompatible definitions in the same PR
- Lock helpers have three names (`acquireMkdirLock`, `acquireLock`, `acquire_lock`) and documented-contract-drift in the bash version
- D-tag scheme mixes `D-SEC{N}`, `D{NN}`, and no-tag within a single PR's worth of JSDoc

Each of these is the exact "said one thing in one place, another elsewhere" pattern the review was asked to look for. None are subtle.

**Recommendation**: CHANGES_REQUESTED

The HIGH-severity findings (atomic-write race drift, `isNotificationMap` double definition, D-tag scheme mixing, lock helper naming/contract drift) should be addressed before merge. They are small edits (mostly extract-helper + rename) that restore the consistency the PR promises. None of them are architecturally hard; they are follow-through work on a refactor that was 80% done.
