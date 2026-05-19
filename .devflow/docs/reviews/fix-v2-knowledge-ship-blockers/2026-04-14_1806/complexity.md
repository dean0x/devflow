# Complexity Review Report

**Branch**: fix/v2-knowledge-ship-blockers -> main
**Date**: 2026-04-14_1806
**Reviewer**: devflow:complexity
**Diff**: `git diff main...HEAD`

## Methodology Notes

Measurements from source (post-diff HEAD):

| Function / handler | File | Lines | Decision points | Max nesting (body-relative) |
|--------------------|------|-------|-----------------|------------------------------|
| `findUnmanagedAnchors` | `scripts/hooks/json-helper.cjs:235-261` | 27 | 6 (`for`, `while`, 4× skip conditions) | 3 |
| Heal block (inline) | `scripts/hooks/json-helper.cjs:1489-1522` | 34 | 4 (`for`, `filter`, guard) | 2 |
| `reconcile-manifest` case body | `scripts/hooks/json-helper.cjs:1395-1534` | 140 | ~22 | 4 |
| `purgeAllPreV2Knowledge` | `src/cli/utils/legacy-knowledge-purge.ts:207-276` | 70 | 7 (3× `try`, 2× `for`, callback, guard) | 3 |
| `purgeLegacyKnowledgeEntries` (pre-existing, referenced for comparison) | `src/cli/utils/legacy-knowledge-purge.ts:88-166` | 79 | 10 | 3 |

Known pitfalls check: `PF-004` (background hook god script, 560 lines, 7+ responsibilities) overlaps directly with `scripts/hooks/json-helper.cjs` (now 1,791 lines). Resolution was deferred, not applied. The heal block added in this PR extends the pattern PF-004 flagged — see Should-Fix finding C3 below.

---

## Issues in Your Changes (BLOCKING)

### CRITICAL

_(none with ≥80% confidence)_

### HIGH

**H1. Reconcile-manifest case handler exceeds HIGH complexity thresholds** — `scripts/hooks/json-helper.cjs:1395-1534`
**Confidence**: 88%

- Problem: The `case 'reconcile-manifest':` body is now 140 lines with ~22 decision points and max nesting depth 4. Per the `devflow:complexity` Severity Guidelines, any of: function-length 50-200 **or** cyclomatic 10-20 **or** nesting 4-6 is HIGH. This handler hits all three simultaneously. The handler now has four distinct phases woven into a single function-scope body:
  1. Validation guards (lines 1401-1420) — 3 early-return branches each emit a separate hand-maintained `JSON.stringify(...)` literal.
  2. Deletion-and-edit pass (lines 1428-1487) — main `for` loop with 3 mutually exclusive inner branches (`!obs` / `!fs.existsSync(filePath)` / anchored vs non-anchored hash compare).
  3. Heal pass (lines 1489-1522) — new second `for` loop over `findUnmanagedAnchors`.
  4. Commit/release (lines 1524-1532) — atomic writes plus `finally` cleanup.
- Impact:
  - Hard to unit-test: the heal pass can only be exercised by constructing full manifest + log + knowledge-file state and invoking the whole case body through the CLI entry. There is no seam to test step 3 alone.
  - D-D "skip silently when zero or multiple log entries match" (line 1495 comment, line 1505) lives inside an inline block — a future change that adds logging for the ambiguous case has no obvious insertion point that preserves the D-D intent.
  - Result-shape drift: the exit shape (`{deletions, edits, unchanged, healed}`) is serialised in **five** places (1402, 1408, 1418, 1529, plus the `break` paths). Adding another counter now requires a 5-site edit — a classic PF-005-style duplication, but inside one function.
- Fix: Extract the three phases to named functions inside the case body so the top-level body shrinks back to orchestration:
  ```js
  case 'reconcile-manifest': {
    const cwd = safePath(args[0]);
    const paths = resolveReconcilePaths(cwd);
    if (!fs.existsSync(paths.manifest) || !fs.existsSync(paths.log)) {
      console.log(emptyReconcileResult());
      break;
    }
    if (!acquireMkdirLock(paths.lockDir, 15000, 60000)) {
      learningLog('reconcile-manifest: timeout acquiring lock, skipping');
      console.log(emptyReconcileResult());
      break;
    }
    try {
      const state = loadReconcileState(paths);         // manifest + log or null
      if (!state) { console.log(emptyReconcileResult()); break; }
      const { keptEntries, counts } = reconcileExisting(state);   // deletion + edit
      const healed = healUnmanagedAnchors(cwd, state, keptEntries); // new Fix-2 pass
      commitReconcile(paths, state, keptEntries);
      console.log(JSON.stringify({ ...counts, healed }));
    } finally {
      releaseLock(paths.lockDir);
    }
    break;
  }
  ```
  Each helper is independently callable from a test harness with a temp `.memory/` directory, and the five-place duplication of the exit shape collapses to one `emptyReconcileResult()` helper.

---

## Issues in Code You Touched (Should Fix)

### HIGH

**C1. `purgeAllPreV2Knowledge` duplicates 90% of `purgeLegacyKnowledgeEntries`** — `src/cli/utils/legacy-knowledge-purge.ts:207-276`
**Confidence**: 92%

- Problem: The new 70-line function copies verbatim the lock-acquire sequence (lines 215-226 ↔ 96-107), the `filePrefixPairs` loop scaffold (lines 231-270 ↔ 112-152), the TL;DR rewrite regex block (lines 259-265 ↔ 142-148), and the lock-release `finally` (lines 271-273 ↔ 161-163). The only real difference is the inner removal strategy (allow-list by ID vs. discriminator by marker absence). Both functions live ~100 lines apart in the same file; the diff makes the duplication unavoidable to notice.
- Impact: Two-site drift risk — any future hardening of the TL;DR regex, lock protocol, or file-prefix ordering must be applied in both places. This is the same class of issue as `PF-005` (HookEntry interface duplicated 4×) and `PF-003` (pluginHints map), both already logged in the project pitfalls file.
- Fix: Extract a shared private helper that accepts a predicate:
  ```ts
  async function purgeKnowledgeSections(options: {
    memoryDir: string;
    shouldRemove: (section: string) => boolean;
  }): Promise<PurgeLegacyKnowledgeResult> { ... }

  export function purgeLegacyKnowledgeEntries(opts: { memoryDir: string }) {
    return purgeKnowledgeSections({
      ...opts,
      shouldRemove: section => LEGACY_IDS.some(id => section.startsWith(`\n## ${id}:`)),
    });
  }

  export function purgeAllPreV2Knowledge(opts: { memoryDir: string }) {
    return purgeKnowledgeSections({
      ...opts,
      shouldRemove: section => !section.includes(SELF_LEARNING_SOURCE_MARKER),
    });
  }
  ```
  Bonus: the test doubles in `tests/legacy-knowledge-purge.test.ts` (+247 lines per the diff stats) could share a single fixture-setup helper instead of duplicating knowledge-file construction.

### MEDIUM

**C2. Unannotated exit-shape literal duplicated 5× in one case** — `scripts/hooks/json-helper.cjs:1402, 1408, 1418, 1425, 1529`
**Confidence**: 91%

- Problem: The counters object `{ deletions: 0, edits: 0, unchanged: 0, healed: 0 }` (or its mutated final form) is constructed inline five separate times — once at each early-exit path plus the final success path. Line 1425 initializes a let-binding with the same four names. When the earlier review (before Fix 2) added `healed` to the result shape, the PR had to touch lines 1402, 1408, 1418, 1425, and 1529 in lockstep. The handler has no central schema.
- Impact: Maintainability — the "add a new reconcile outcome" change is now a 5-line-per-addition diff that's easy to get wrong (especially the three early-exit paths, which are buried under `break`).
- Fix: Introduce a single factory:
  ```js
  const emptyReconcileResult = () =>
    JSON.stringify({ deletions: 0, edits: 0, unchanged: 0, healed: 0 });
  ```
  and use it at all four early-exit sites. Lines 1425/1529 become the single mutation path. This also clarifies at a glance that the early-exit shape is intentionally equal to the initial counter state.

**C3. Heal block grew `reconcile-manifest` handler — PF-004 pattern reinforced** — `scripts/hooks/json-helper.cjs:1489-1522`
**Confidence**: 84%

- Problem: `scripts/hooks/json-helper.cjs` is now 1,791 lines and hosts the switch statement in the project. PF-004 logged in `.memory/knowledge/pitfalls.md` flags this exact file family (background-hook helpers) as "untestable god scripts" with its resolution — "move JSON-heavy logic to TypeScript; keep shell script as thin orchestrator (~100 lines)." This PR inlines another 60 lines of JSON-heavy logic (the heal block plus its helper) into the same god file instead of migrating out. The heal logic is exactly the kind of logic the PF-004 resolution calls out: string normalisation, regex section extraction, log-obs matching, manifest reconstruction.
- Impact: Reinforces the architectural pitfall instead of paying it down. Tests for the heal logic must now go through the CLI (`node json-helper.cjs reconcile-manifest <cwd>`) rather than an importable API — which the `tests/learning/reconcile.test.ts` +334 lines suggest is the path being taken, locking in the coupling.
- Fix: At minimum, extract a module under `scripts/hooks/lib/reconcile.cjs` exporting `findUnmanagedAnchors`, `healUnmanagedAnchors`, `reconcileExisting`. The case in `json-helper.cjs` becomes a thin dispatcher. This keeps PR #182 shippable but creates the seam PF-004 asks for without a full TS migration. Flagged as Should-Fix because the file was already a pitfall area before the PR; this PR added to it rather than creating the condition.

### LOW

**C4. `findUnmanagedAnchors` hides two mutating regexes in one loop** — `scripts/hooks/json-helper.cjs:235-261`
**Confidence**: 82%

- Problem: The function declares its regexes as part of the `files` array literal with the `g` flag (lines 240-241). Because `re.exec(content)` advances `re.lastIndex` across calls, these regexes carry state across iterations of the outer `for` loop. This is safe today because each inner regex is used with a fresh `content` for a single inner `while`-loop — but if a future refactor reuses one of these regexes (e.g., for a "verify counts" pass), it will skip entries silently due to retained `lastIndex`.
- Impact: Latent correctness hazard in a low-traffic code path. The current behaviour is correct; the risk is in future edits.
- Fix: Either construct the regexes inline inside the outer `for` body (`const re = /^## (ADR-\d+):\s*([^\n]+)/gm;`), or reset `re.lastIndex = 0` before the `while`. The inline declaration is clearer; the prior art at line 1463 (`const sectionRe = new RegExp(...)` inside the loop) already uses this pattern.

**C5. Anchor-body slice repeats content-search logic already in the outer loop** — `scripts/hooks/json-helper.cjs:251-256` and `1509-1515`
**Confidence**: 81%

- Problem: The section-extraction pattern `content.indexOf('\n## ', sectionStart + 1)` / `content.slice(sectionStart, nextHeadingIdx)` in `findUnmanagedAnchors` (lines 251-256) and the RegExp-based extraction in the heal block `(##\\s+${safeAnchorId}[\\s\\S]*?)(?=\\n##\\s+(?:ADR|PF)-|\\s*$)` at line 1511 (which also appears at line 1463 in the pre-existing deletion pass) are two different implementations of "extract one `## AAA-NNN:` section from a knowledge file." They disagree on the trailing boundary: `indexOf('\n## ', ...)` matches any `## ` heading, while the RegExp at 1511 only matches `## ADR-` or `## PF-`.
- Impact: Parsing skew. If a future knowledge file grows a non-`ADR`/`PF` `## ` section (say, `## Overview`), the deletion/heal passes disagree about where the current section ends, and the content hash stored by heal won't match the hash computed by the next deletion pass — leading to spurious edits.
- Fix: Extract `function extractAnchorSection(content, anchorId)` into a shared helper and use it in both sites. This also sets up C3's extraction target.

### Consolidation — Pattern: "ad-hoc regex per call site"

**C6. Four ad-hoc regex literals reference `(ADR|PF)-\d+` with incompatible anchors** — Confidence: 80%
- `scripts/hooks/json-helper.cjs:240`, `scripts/hooks/json-helper.cjs:241`
- `scripts/hooks/json-helper.cjs:1463` (pre-existing, but adjacent)
- `scripts/hooks/json-helper.cjs:1511` (new)
- `src/cli/utils/legacy-knowledge-purge.ts:174`
- Problem: Five regexes in two files all parse `## ADR-NNN:` / `## PF-NNN:` headings with subtly different shapes — `^## (ADR-\d+):` (gm), `^## (ADR|PF)-\d+:[^\n]*` (gm with inline continuation), `##\s+${anchorId}\b`, `(##\s+${safeAnchorId}[\s\S]*?)(?=\n##\s+(?:ADR|PF)-|\s*$)`. The CJS and TS worlds re-invent the same parser.
- Fix: Define `const KNOWLEDGE_HEADING_RE = /^## ((?:ADR|PF)-\d+):([^\n]*)$/gm;` once per file; derive `KNOWLEDGE_SECTION_RE` from it. Cross-language sharing is probably not worth it, but intra-file consolidation is free.

---

## Pre-existing Issues (Not Blocking)

### MEDIUM

**P1. `scripts/hooks/json-helper.cjs` is 1,791 lines with a single mega-switch** — `scripts/hooks/json-helper.cjs` (whole file)
**Confidence**: 95%

- Problem: The `devflow:complexity` metric `File length > 500` is CRITICAL; this file is 3.5× that. The switch statement dispatches to ~15 distinct sub-commands, each 30-200 lines. This is the exact pattern flagged by PF-004 (though PF-004 nominally targets `scripts/hooks/background-learning`, the same issue applies here).
- Impact: Documented in PF-004; architectural, requires a dedicated refactor PR.
- Reported here only because PR #182 makes the file larger by 87 lines. Not blocking because the file was already over-limit before this PR.

### LOW

**P2. `purgeLegacyKnowledgeEntries` nests regex construction inside a loop inside a loop** — `src/cli/utils/legacy-knowledge-purge.ts:118-138`
**Confidence**: 86%

- Problem: Three levels of nested iteration (`for filePrefixPairs` → `for legacyInFile` → `.replace(sectionRegex, '')`) plus regex construction per-iteration. Cyclomatic ~6 in a ~50-line block.
- Fix: Build a single `new RegExp` matching all `legacyInFile` IDs alternated (`(ADR-002|PF-001|PF-003|PF-005):...`). Compile once, replace once.
- Not blocking because this is pre-existing code the PR does not touch.

---

## Suggestions (Lower Confidence)

- **S1. D-D ambiguity-guard deserves an explicit exit signal for observability** — `scripts/hooks/json-helper.cjs:1505` (Confidence: 72%) — The `continue` for 0-or-multiple candidates silently drops potential heals. A `learningLog('heal: skipped %s (n=%d)', u.anchorId, candidates.length)` would make ambiguous cases debuggable without changing D-D.
- **S2. `safeAnchorId = u.anchorId.replace(/[^A-Z0-9-]/gi, '')` is defensive belt-and-suspenders** — `scripts/hooks/json-helper.cjs:1510` (Confidence: 68%) — `u.anchorId` comes from the verified `/^## (ADR-\d+|PF-\d+):/` match, so it's already `[A-Z0-9-]+`. The sanitisation is unreachable-defensive; either drop it with a comment referencing the upstream validation or add a `// defence in depth` note.
- **S3. `PurgeLegacyKnowledgeResult`'s `removed` counter mixes two meanings** — `src/cli/utils/legacy-knowledge-purge.ts:37-40` (Confidence: 66%) — `purgeLegacyKnowledgeEntries` increments `removed` per removed ID and per `PROJECT-PATTERNS.md` unlink; `purgeAllPreV2Knowledge` increments per section regex-match. A caller counting files-cleaned vs. sections-removed gets different semantics from the two functions with the same signature.

---

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 0 | 0 |
| Should Fix | 0 | 1 | 2 | 3 |
| Pre-existing | 0 | 0 | 1 | 1 |

**Complexity Score**: 6/10

Reasoning: The new code itself is reasonably well-factored at the leaf level (`findUnmanagedAnchors` is readable; the heal block is linear). The score is dragged down by (1) the `reconcile-manifest` case handler now crossing all three HIGH thresholds simultaneously (length + cyclomatic + nesting), (2) near-total duplication of `purgeLegacyKnowledgeEntries` in `purgeAllPreV2Knowledge` where a 30-line shared helper would do, and (3) adding 87 lines to a file that PF-004 has already flagged as a god script without taking the extraction opportunity.

**Recommendation**: CHANGES_REQUESTED

Blocking finding H1 (reconcile-manifest case) is the only merge-blocking item. The duplication in C1 and the file-growth in C3 are should-fix but not strictly blocking — the PR is a ship-blocker fix and the architectural hygiene can follow in a targeted refactor PR. If time pressure precludes H1's full extraction, the minimum acceptable fix is C2 (dedupe the 5× result literal) and a comment at line 1395 explicitly flagging the 4-phase structure so the next reader has a map.

## Artifact

Written to `.docs/reviews/fix-v2-knowledge-ship-blockers/2026-04-14_1806/complexity.md`.
