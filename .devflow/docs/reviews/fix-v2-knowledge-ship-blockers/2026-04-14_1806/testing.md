# Testing Review Report

**Branch**: fix/v2-knowledge-ship-blockers -> main
**Date**: 2026-04-14_1806
**PR**: #182
**Diff scope**: `git diff main...HEAD`
**Test files reviewed**: 4 (+65 new tests, 943 total passing, verified `npm test` ⇒ 107/107 in these 4 files)

## Summary of Coverage

| File | New tests | Describe blocks |
|------|-----------|-----------------|
| tests/legacy-knowledge-purge.test.ts | 21 (Fix 3 new block only) | `purgeAllPreV2Knowledge` |
| tests/learning/reconcile.test.ts | 9 (Fix 2 new block only) | `reconcile-manifest — self-heal (Fix 2)` |
| tests/resolve/knowledge-citation.test.ts | 36 (NEW file) | 6 blocks |
| tests/migrations.test.ts | 4 v3 registry + 1 idempotency + 1 independence = 6 added | scattered inside existing blocks |

TDD sequence verified via git log: `33b487c test:` ← `9a8dfbb feat:` (Fix 3), `3d6eb8b test:` ← `c7fd2bf feat:` (Fix 2), `5fb3503 test:` ← `a4babb4 feat:` (Fix 1). All test-first commits precede their feat counterparts.

---

## Issues in Your Changes (BLOCKING)

### CRITICAL

_(none)_

### HIGH

**The `filterKnowledgeContext` reimplementation in knowledge-citation.test.ts does not validate the production pipeline — it validates the test's internal fixture copy** — Confidence: 95%
- `tests/resolve/knowledge-citation.test.ts:37-54` (filter helper), `tests/resolve/knowledge-citation.test.ts:60-119` (8 tests using it)
- Problem: There is NO production implementation of `filterKnowledgeContext`. Verified by `grep filterKnowledgeContext` across `src/`, `scripts/hooks/`, and all production dirs — zero hits. The filter lives entirely inside the test file. The function is fed to itself and asserted against its own output, which proves only that the filter is self-consistent. The real pipeline is: orchestrator markdown instruction → LLM interprets it → LLM emits filtered text. None of those steps are exercised.
- Impact: Every one of the 8 filter unit tests (`returns empty string when input is empty`, `preserves Active ADR sections unchanged`, `removes Deprecated ADR sections`, `removes Superseded ADR sections`, `removes Deprecated PF sections`, `keeps Active PF sections`, `preserves Active sections when mixed`, `returns (none) marker when all sections are removed`) gives false confidence. A regression where the orchestrator's markdown instruction silently fails to filter (e.g., LLM interprets "Deprecated" case-sensitively while a user wrote "deprecated") would leave all 8 tests green. This is testing-the-test, not testing-the-behavior — the exact opposite of the Iron Law: "TESTS VALIDATE BEHAVIOR, NOT IMPLEMENTATION".
- Fix: Two viable paths:
  1. **Extract the filter into production code** (`src/cli/utils/knowledge-filter.ts`), have the orchestrator call it (or have `json-helper.cjs` expose a `filter-knowledge-context` op) and import the SAME function into tests. This is the correct fix — it aligns production and test behavior and closes the gap the user correctly identified.
  2. **Delete the filter helper and the 8 filter tests entirely**. They carry zero safety value as written and give a misleading +8 to the `943 total passing` count. Keep only the structural markdown assertions that prove the INSTRUCTION is present — which is the most you can test without running an LLM.

Path 1 is strictly better because it also DRYs the instruction: today the filter rule is re-stated in `resolve.md:72`, `resolve-teams.md`, and `resolve:orch SKILL.md:35`. Three copies of an English sentence mean three places to drift, which is the PF-003/PF-005 pattern that already bit this codebase.

**Structural markdown tests are coupled to current heading anchors (implementation, not behavior)** — Confidence: 85%
- `tests/resolve/knowledge-citation.test.ts:128-180` (resolve.md block), `tests/resolve/knowledge-citation.test.ts:186-219` (teams block), `tests/resolve/knowledge-citation.test.ts:225-261` (orch block)
- Problem: Tests index into markdown via literal `content.indexOf('### Phase 1')`, `content.indexOf('### Phase 4')`, `content.indexOf('### Phase 5', phase4Start)`, etc. If the Phase numbering shifts (e.g., Phase 0d becomes Step 0c, Phase 1.5 becomes Phase 2-Preamble), tests break without any behavioral regression. Worse, the tests are brittle in a silent-failure direction: `content.indexOf('### Phase 5', phase4Start)` returns `-1` when not found, then `content.slice(phase4Start, -1)` returns "everything except the last char" — a bogus substring. Several tests then pass because `KNOWLEDGE_CONTEXT` happens to appear anywhere in the bogus slice. This means a rename could GREEN tests that should RED.
- Impact: High — any markdown restructure (the exact activity PF-008 already warned about: "Command refactors drift between `.md` base and `-teams.md` paired variant") will either break these tests spuriously or silently pass them incorrectly. This couples refactoring friction to trivial renames.
- Fix: Replace `indexOf(anchor, ...)` extraction with regex-based section matching that fails LOUDLY when anchors are absent (e.g., `const match = content.match(/### Phase 4[\s\S]*?(?=### Phase 5|$)/)`; `expect(match).not.toBeNull()`). Better yet: make the tests assert on the overall content structure without positional slicing — e.g., `expect(content).toMatch(/Phase [45][\s\S]*?KNOWLEDGE_CONTEXT/)`. The core promise being verified is "KNOWLEDGE_CONTEXT appears somewhere in the Resolver spawn block" — write THAT.

### MEDIUM

**`djb2` hash helper duplicated within a single file** — Confidence: 97%
- `tests/learning/reconcile.test.ts:174-180` and `tests/learning/reconcile.test.ts:312-318`
- Problem: Identical 7-line function defined twice, once inside `no-change: same hash → no mutation` and once at the top of the `self-heal (Fix 2)` describe block. The user's review prompt asked whether this helper "is clearer than inline fixtures" — the answer here is that it's clearer than inline hashing, but defining it twice defeats the purpose and creates a drift hazard (if `contentHash` in `json-helper.cjs:517-524` ever switches algorithms, both copies must be updated).
- Fix: Move it once to `tests/learning/helpers.ts` alongside `runHelper`/`baseEntry`:
  ```ts
  export function djb2(s: string): string {
    let h = 5381;
    for (let i = 0; i < s.length; i++) {
      h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
    }
    return h.toString(16);
  }
  ```
  Better: expose a `hash <content>` CLI op on `json-helper.cjs` so tests use the SAME implementation the production code uses. Otherwise both tests silently drift if `contentHash` changes to e.g. SHA1.

**`buildDecisionsFile` and `buildPitfallsFile` are trivially parameterizable duplicates** — Confidence: 85%
- `tests/learning/reconcile.test.ts:321-334`
- Problem: The two functions differ only in (a) the word "decisions" vs "pitfalls" in the TL;DR comment and (b) the `# Decisions`/`# Pitfalls` heading. 13 lines of code to express 2 string substitutions. The user explicitly asked whether these helpers are "clearer than inline fixtures" — DRY-wise they're fine, but the split into two near-identical functions is a small code smell.
- Fix:
  ```ts
  function buildKnowledgeFile(
    kind: 'decisions' | 'pitfalls',
    sections: Array<{ anchorId: string; heading: string; body: string }>,
  ): string {
    const parts = sections.map(s => `## ${s.anchorId}: ${s.heading}\n\n${s.body}\n`);
    const title = kind === 'decisions' ? 'Decisions' : 'Pitfalls';
    return `<!-- TL;DR: ${sections.length} ${kind}. -->\n# ${title}\n\n${parts.join('\n')}`;
  }
  ```
  Low-priority but reduces the surface when the fixture format evolves.

**Lock-lifecycle tests assert release but not mutual exclusion** — Confidence: 90%
- `tests/legacy-knowledge-purge.test.ts:157-171` and `tests/legacy-knowledge-purge.test.ts:404-419`
- Problem: Both `acquires and releases .knowledge.lock during operation` tests verify only that the lock directory is *cleaned up* after the call. They do not verify that (a) concurrent callers are serialized, (b) the 30 s timeout path is reachable, or (c) stale-lock reclamation (60 s threshold in `legacy-knowledge-purge.ts:52-73`) actually kicks in. Since the user's prompt specifically flagged "lock-lifecycle tests" as a concern, this is load-bearing.
- Impact: A regression where the lock acquisition logic silently no-ops (e.g., `mkdir` succeeds but the retry loop exits early) would pass both tests. The actual mutual-exclusion guarantee — which is the lock's entire purpose — is untested.
- Fix: Add at least ONE test that exercises concurrency:
  ```ts
  it('serializes concurrent purge calls', async () => {
    await fs.mkdir(path.join(memoryDir, '.knowledge.lock'));   // pre-hold the lock
    const settled = Promise.race([
      purgeAllPreV2Knowledge({ memoryDir }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('did-not-block')), 500)),
    ]);
    await expect(settled).rejects.toThrow('did-not-block'); // caller is blocked waiting
    await fs.rmdir(path.join(memoryDir, '.knowledge.lock'));  // release
  });
  ```
  Even better: extract `acquireMkdirLock` into its own helper file and unit-test IT in isolation — once — across all callers. Today the helper is copy-pasted in `legacy-knowledge-purge.ts:51-73` and `json-helper.cjs:477-505` (PF-005 pattern: interface/helper duplication).

**TOCTOU symlink tests verify the defensive read but not the retry write** — Confidence: 80%
- `tests/legacy-knowledge-purge.test.ts:218-244` and `tests/legacy-knowledge-purge.test.ts:421-448`
- Problem: Both TOCTOU tests assert (a) the sentinel file was not clobbered (good — proves the `{ flag: 'wx' }` EEXIST path triggered) and (b) the target file still ended up correct. But they do NOT explicitly verify that the retry path (unlink-then-rewrite in `fs-atomic.ts` `writeFileAtomicExclusive`) actually ran. If the implementation silently swallowed the EEXIST and then the second write also failed, `updated` might still show no ADR-002 simply because the pre-existing content never had ADR-002 to begin with. A stronger assertion is needed.
- Impact: The test passes even if the retry logic is broken in certain failure modes. Given that `writeFileAtomicExclusive` is described in production code as the race-tolerant primitive, its resilience deserves a direct assertion.
- Fix: After the call, assert that the `.tmp` path either no longer exists OR points to the actual newly written content (not the sentinel). Add:
  ```ts
  await expect(fs.readlink(tmpPath)).rejects.toThrow(); // symlink cleaned up
  await expect(fs.readFile(decisionsPath, 'utf-8')).resolves.toMatch(/TL;DR: 0 decisions/);
  ```
  The second assertion is behavior-level (the TL;DR recount fires ONLY when a write succeeds).

**`NOW = new Date().toISOString()` at module scope is a determinism footgun** — Confidence: 75%
- `tests/learning/reconcile.test.ts:49`
- Problem: Module-level mutable-looking constant. Computed ONCE when the test file loads, then reused in every `beforeEach` via `baseEntry(...)`. Because every test gets the SAME timestamp, tests that depend on `deprecated_at` ordering or `first_seen !== last_seen` semantics are silently comparing identical values. It also couples all tests to whatever time zone the test runner happens to use.
- Impact: Real bugs around timestamp drift (e.g., reconcile computing `deprecated_at` vs obs's `last_seen`) cannot be caught because both are the same `NOW`. Not flakiness per se, but a coverage blind spot.
- Fix: Compute timestamps inline per test with `new Date().toISOString()` when the test actually depends on time. For tests that just need SOMETHING in the field, keep `NOW` but document the intent. Ideal: use fake timers (`vi.useFakeTimers()` + `vi.setSystemTime()`) so tests can advance time deterministically and assert on `deprecated_at - first_seen` deltas.

**`heal: registerUsageEntry called — usage file has entry for healed anchorId` is a partial spy** — Confidence: 78%
- `tests/learning/reconcile.test.ts:544-571`
- Problem: The test checks that `usagePath` exists and has an entry for `ADR-001` with `cites: 0`. It does NOT verify:
  - The `created` timestamp is set (see `json-helper.cjs:413`)
  - Multiple heals correctly call `registerUsageEntry` once per anchor (only the single-heal path is covered)
  - `registerUsageEntry` is NOT called when heal is skipped (the `candidates.length !== 1` branch)
- Impact: The usage file is the downstream signal for other hooks. A regression where heal triggers spurious usage entries for user-curated anchors would pass this test.
- Fix: Add a negative assertion to the `heal: anchor in file, no matching log entry → no-op` test: `expect(fs.existsSync(path.join(tmpDir, '.memory', '.knowledge-usage.json'))).toBe(false)`. For the multi-heal test (line 507), add: `expect(Object.keys(usageData.entries).length).toBe(3)`.

### LOW

**TL;DR Key-section recount tests do not verify the Key contents** — Confidence: 85%
- `tests/legacy-knowledge-purge.test.ts:116-138`, `tests/legacy-knowledge-purge.test.ts:367-402`
- Problem: Tests assert `<!-- TL;DR: 2 decisions. Key: -->` verbatim — with empty Key section. But `json-helper.cjs:324-354` (`buildUpdatedTldr`) carefully populates `Key: ADR-001, ADR-002, ...` with the last 5 active IDs. In production, these TL;DR comments carry meaningful descriptors (e.g., `Key: ADR-001 Result types over throws, ADR-002 Single-coder default strategy` in the real `.memory/knowledge/decisions.md`). The purge functions explicitly regex-replace the comment with an EMPTY Key section — losing that context. No test catches this.
- Impact: After a purge, the TL;DR's human-readable summary is wiped to `Key: ` with nothing after it. If someone later adds a "Key: must match active entries" invariant, it silently breaks.
- Fix: Either (a) assert the Key is intentionally blank and document it as a post-purge limitation, or (b) fix the production regex to preserve Key content for non-removed entries. A test like:
  ```ts
  it('preserves Key text for entries that survived the purge', async () => {
    // write decisions.md with Key: ADR-001 Active, ADR-002 Legacy
    // purge ADR-002
    expect(updated).toMatch(/Key: ADR-001 Active/);
  });
  ```
  would force the design decision.

**Knowledge-citation filter tests use "Active" status but production uses "Accepted"** — Confidence: 70%
- `tests/resolve/knowledge-citation.test.ts:66, 92, 100, 109`
- Problem: Test fixtures use `- **Status**: Active` for non-deprecated ADRs, but the real `.memory/knowledge/decisions.md:8,16` uses `- **Status**: Accepted`. Because the filter only removes on `Deprecated|Superseded`, both pass through identically — so the test passes. But a developer reading the fixture would assume "Active" is the canonical status value.
- Impact: Fixture drift. Documentation value degraded — the test fixtures mislead readers.
- Fix: Change `- **Status**: Active` to `- **Status**: Accepted` throughout `knowledge-citation.test.ts` to match the actual format used in production files. Or, if "Active" is being intentionally used as a distinct ADR vs PF status (ADRs are Accepted, PFs are Active per pitfalls.md), reflect that split accurately: ADR fixtures say Accepted, PF fixtures say Active.

**`returns (none) marker when all sections are removed` test name contradicts its body** — Confidence: 92%
- `tests/resolve/knowledge-citation.test.ts:113-118`
- Problem: Test name promises verification of the `(none)` marker. Body asserts the filter returns empty string `''` and comment says `// Empty string signals orchestrator to emit "(none)"`. But the filter NEVER returns `(none)` — that's the orchestrator's decision. The test is checking something the helper doesn't do.
- Fix: Rename test to `returns empty string when all sections are Deprecated/Superseded`. The orchestrator's `(none)` emission is verified separately by the structural markdown tests (`Step 0d emits (none) when both files are absent or empty` at `tests/resolve/knowledge-citation.test.ts:155-160`).

---

## Issues in Code You Touched (Should Fix)

**`filterKnowledgeContext` and the orchestrator markdown diverge on section-boundary semantics** — Confidence: 72%
- `tests/resolve/knowledge-citation.test.ts:43` (split regex) vs `plugins/devflow-resolve/commands/resolve.md:72` (English instruction)
- Problem: The JS filter uses `raw.split(/(?=^## (?:ADR|PF)-\d+:)/m)` — a lookahead split that attaches each section to its own heading. The markdown instruction says "Strip any `## ADR-NNN:` or `## PF-NNN:` section whose body contains `- **Status**: Deprecated`". These describe the same idea but with different edge-case handling:
  - What about `### ADR-001:` (H3, not H2) inside an example code block? The filter regex requires `^##` but markdown could contain it unintentionally.
  - What about sections containing both `- **Status**: Active` (at top) AND `- **Status**: Deprecated` (quoted in history)? The filter's regex matches anywhere and would drop the section; a literal-minded LLM might keep it.
  - What about an ADR section whose body contains a link to a Deprecated ADR (e.g., `See ADR-005 (Deprecated)`)? Filter removes it; LLM likely doesn't.
- Impact: Test says "filter does X", orchestrator does "whatever the LLM thinks X means" — and the two can disagree. The user's exact question ("is this test strategy sound?") surfaces a fundamental gap.
- Fix: This reinforces the HIGH finding — extract the filter into production code. If a TS `filterKnowledgeContext` is called by the orchestrator (via bash + json-helper op), the behavior becomes deterministic AND the JS test suite actually exercises production behavior.

**MIGRATIONS array uniqueness asserted via Set size, but `v3 is after v2` test uses `findIndex` on mutable array** — Confidence: 60%
- `tests/migrations.test.ts:102-105, 142-147`
- Problem: The ordering test `v3 is after v2 in the MIGRATIONS array (ordering preserved)` uses `findIndex` which silently returns `-1` for not-found. If someone accidentally removed v2 entirely, the test would assert `v3Index > -1` (which is `v3Index > -1`, trivially true). The `v2Index >= 0` check defends against this, but it's a subtle assertion chain that could regress.
- Fix: Add a stronger guard:
  ```ts
  it('v3 is after v2 in the MIGRATIONS array (ordering preserved)', () => {
    const ids = MIGRATIONS.map(m => m.id);
    expect(ids).toContain('purge-legacy-knowledge-v2');
    expect(ids).toContain('purge-legacy-knowledge-v3');
    expect(ids.indexOf('purge-legacy-knowledge-v3')).toBeGreaterThan(
      ids.indexOf('purge-legacy-knowledge-v2'),
    );
  });
  ```

---

## Pre-existing Issues (Not Blocking)

**`acquireMkdirLock` helper is copy-pasted between `legacy-knowledge-purge.ts` and `json-helper.cjs`** — Confidence: 90%
- `src/cli/utils/legacy-knowledge-purge.ts:51-73` vs `scripts/hooks/json-helper.cjs:477-505`
- Note: This is pre-existing (predates this PR) but reinforces PF-005's pattern ("interfaces duplicated 4×"). The new test code cannot fix it without a refactor out of scope for this PR. Flagging as informational — worth a follow-up issue to extract the lock logic into a single TS module and have both callers consume it.

**Test isolation relies on process.env.HOME mutation (migrations.test.ts)** — Confidence: 85%
- `tests/migrations.test.ts:160-172`
- Note: Pre-existing pattern from before this PR. `process.env.HOME = ...` + `delete process.env.HOME` in afterEach is fragile if vitest runs tests in parallel within the same worker (which it does NOT by default, but can be configured to via `fileParallelism`). Because `migrations.ts` reads `os.homedir()` at call time, parallel describes would race. `vitest.config.ts` should set `fileParallelism: false, maxWorkers: 1` (per the devflow:testing SKILL's Test Suite Safety guidance) to prevent latent flakes as the test suite grows. Not blocking — just worth confirming the config.

---

## Coverage Gaps (Acceptance Criteria Check)

Going issue-by-issue through the PR:

### Fix 1: /resolve reads and cites project knowledge
- Markdown instruction present on 4 surfaces: yes, verified by cross-cutting block (lines 328-347).
- Instruction is semantically correct: only partially — the JS filter reimplementation gives false confidence. See HIGH finding.
- `(none)` emission when both files absent: verified structurally (line 155), not behaviorally.
- KNOWLEDGE_CONTEXT actually forwarded to Resolver: verified by string search, not by a live Resolver spawn. This is unavoidable for a markdown orchestration test, but worth a note: no end-to-end test exercises an actual Resolver receiving the context.
- Hallucination guard ("do not fabricate IDs"): verified by regex match against `resolver.md:81` (test at line 292-298). **Good.**
- **Gap**: No test that an ADR referenced by the orchestrator actually exists in the file it was loaded from. A Resolver could still hallucinate `ADR-999` and pass the "verbatim" check because the check lives in the LLM's interpretation.

### Fix 2: reconcile-manifest self-heal
- Happy path (single heal): covered (line 345).
- User-curated entry (no log match): covered (line 389).
- Heading mismatch: covered (line 419).
- Ambiguous 1-to-many: covered (line 446).
- Multi-file (decisions + pitfalls): covered (line 507).
- Usage file registration: partially covered — see MEDIUM finding.
- Zero-heal result shape: covered (line 573).
- Pre-v2 anchor immunity: covered (line 598). **Excellent regression guard.**
- **Gap 1**: No test for "heal runs AFTER deletion detection in the same reconcile pass" — does a deleted-then-rewritten anchor get deprecation-penalized then healed? Read of `json-helper.cjs:1425-1487` suggests deletion happens first (loop at 1428) and heal happens second (1489-1522), so a deleted+rewritten anchor would be penalized AND healed, potentially leaving the obs in weird state. Not tested.
- **Gap 2**: No test for the lock-timeout path (`reconcile-manifest` acquires `.learning.lock` with 15 s timeout at `json-helper.cjs:1406`). If the lock is held, the function logs and emits zero counters — no test exercises that path.
- **Gap 3**: No test for malformed manifest JSON (`catch` block at `json-helper.cjs:1417`). A corrupted `.learning-manifest.json` should short-circuit to zero counters; untested.

### Fix 3: purgeAllPreV2Knowledge
- Seeded /code-review removed: covered (line 270).
- Seeded /implement removed: covered (line 290).
- self-learning: preserved: covered (line 310).
- Mixed file: covered (line 331).
- TL;DR recount: covered (line 367).
- Lock release: covered (basic — see MEDIUM finding).
- TOCTOU symlink: covered (basic — see MEDIUM finding).
- PROJECT-PATTERNS.md boundary (v2 territory): covered (line 450). **Good separation-of-responsibility test.**
- Self-learning-only no-op: covered (line 461).
- **Gap 1**: No test for combined v2+v3 pass on the same file. Fixture: a decisions.md with ADR-001 (seeded /implement), ADR-002 (seeded /implement — legacy-id target), ADR-003 (self-learning). Run v2 then v3 in sequence. Expected: v2 removes ADR-002 (legacy-id list), v3 removes ADR-001 (seeded non-self-learning), ADR-003 survives. Not tested.
- **Gap 2**: No test for the common ADR case where `- **Source**: self-learning:obs_xxx` is on a different line position (e.g., not immediately after `- **Status**`). The production code uses `section.includes('\n- **Source**: self-learning:')` which requires the literal newline prefix. A section where the Source line is the first bullet (no leading newline within the slice) might be mishandled. Worth an explicit fixture.
- **Gap 3**: No test for malformed/missing TL;DR line. If `<!-- TL;DR: -->` is missing entirely, the production code's `replace` regex just no-ops. No test asserts that content is still written correctly in that case.

### Migration registry v3
- Unique IDs: covered (line 102).
- Required fields: covered (line 107).
- v3 presence + scope: covered (line 128).
- v3 description mentions source discriminator: covered (line 136).
- v3 ordering (v2 before v3): covered (line 142) but with weak assertion — see SHOULD-FIX.
- v3 runs independently: covered (line 370). **Excellent.**
- **Gap**: No test that `runMigrations` still marks v3 applied when v3 succeeds but v2 fails on a prior run. The independence proved is "v2-done, then v3-runs"; the reverse ("v2-failed, then v3-runs-anyway") is not asserted.

---

## Suggestions (Lower Confidence)

- **Flaky test risk in `reconcile.test.ts` lock-timeout dependency** — `tests/learning/reconcile.test.ts` (whole file) (Confidence: 65%) — The tests invoke `runHelper(\`reconcile-manifest "${tmpDir}"\`)` via `execSync`, which spawns a child node process. Child-process tests are slower (542 ms reported) and can become flaky on CI under load. Consider spying on `fs` in a pure TS harness if `reconcile-manifest` is refactored to expose a programmatic export.
- **Consider a property-based test for `filterKnowledgeContext`** — `tests/resolve/knowledge-citation.test.ts` (Confidence: 60%) — If the HIGH finding is addressed and the filter moves to production, `fc.property(fc.array(fc.record({...})), (sections) => { ... })` could generate random ADR/PF mixes and assert the invariant "output always contains exactly the non-Deprecated/non-Superseded sections". Much stronger than the 8 hand-coded cases.
- **Test names could follow Given-When-Then more consistently** — across all 4 files (Confidence: 60%) — Some tests use imperative prose (`removes ADR-002 section from decisions.md, keeps ADR-001`) while others use present tense (`is a no-op when both files have only self-learning entries`). Not a bug, just an inconsistency that future readers will scan for.

---

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 2 | 7 | 3 |
| Should Fix | - | 0 | 2 | - |
| Pre-existing | - | - | 2 | 0 |

**Testing Score**: 6/10

**Rationale for score**: The TDD commit sequence is textbook-clean, and the migration/purge/reconcile tests cover the happy paths and many edge cases well (10+ edge cases in each of the 3 fix blocks). The pre-v2 immunity test in reconcile (line 598) and the v3-independence test in migrations (line 370) are particularly well-conceived regression guards. But the knowledge-citation.test.ts strategy has a structural flaw: 8 of its 36 tests exercise a reimplementation that production code does not have, providing zero behavior coverage for the filter rule while appearing to. That's worth roughly -3 from a 10, because it's exactly the Iron Law violation the testing skill calls out. +1 back for the excellent TDD discipline and for catching 107 tests passing cleanly with no skips. Lock-lifecycle and TOCTOU tests are present but shallow — they prove cleanup, not safety.

**Recommendation**: CHANGES_REQUESTED

**Justification**: The HIGH finding on `filterKnowledgeContext` directly answers the user's explicit prompt question ("Is this test strategy sound, or is it testing something the production code doesn't have?"). The strategy is NOT sound as written — it tests a helper the production pipeline doesn't use, creating false confidence. Fix recommendation: either extract the filter to production code and share the implementation (best), or delete the 8 filter-unit tests as non-load-bearing (acceptable). The structural markdown tests (HIGH #2) have a silent-failure mode via `indexOf(-1)` fallbacks that should be hardened. Everything else (MEDIUM items) is tractable in a single cleanup pass. Total estimated fix effort: 1-2 hours if going with "extract to production", 15 minutes if going with "delete the filter tests".
