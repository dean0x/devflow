# Architecture Review Report

**Branch**: fix/v2-knowledge-ship-blockers -> main
**Date**: 2026-04-14_1806
**Focus**: Architecture (SOLID, coupling, layering, modularity)
**Diff scope**: `git diff main...HEAD` — 14 files, +1277 / -14
**Known-pitfall context**: PF-008 (teams-variant drift) directly applies to this PR's lockstep markdown changes.

---

## Issues in Your Changes (BLOCKING)

### CRITICAL

*(none)*

### HIGH

**Heal path skipped when manifest file does not yet exist** — Confidence: 88%
- `scripts/hooks/json-helper.cjs:1401`
- **Problem**: The reconcile-manifest handler short-circuits when `manifestPath` does not exist:
  ```
  if (!fs.existsSync(manifestPath) || !fs.existsSync(logFile)) {
    console.log(JSON.stringify({ deletions: 0, edits: 0, unchanged: 0, healed: 0 }));
    break;
  }
  ```
  The exact crash window that Fix 2 targets (render-ready writes knowledge file at line 1347, then crashes before writing the manifest at line 1382) leaves NO manifest file on the *first ever* rendered observation. On that first-obs crash the next session-start reconcile sees `!fs.existsSync(manifestPath)`, returns immediately, and the heal block never runs. The next render-ready pass finds `obs.status === 'ready'`, re-renders it, and produces the very duplicate anchor that Fix 2 is supposed to prevent.
- **Impact**: Single-observation crash recovery is incomplete. The fix works correctly for the second-and-later crash (where a manifest already exists from a prior successful render), but the first-render crash case silently regresses. This is a narrow window but it is the exact scenario the design claims to cover — widening lexical coverage without widening scenario coverage.
- **Fix**: Allow the reconcile pass to run even when the manifest file is absent, by constructing an empty in-memory manifest when the path does not exist but the log file does:
  ```js
  if (!fs.existsSync(logFile)) {
    console.log(JSON.stringify({ deletions: 0, edits: 0, unchanged: 0, healed: 0 }));
    break;
  }
  // Create empty manifest if missing — heal block still needs to run
  if (!fs.existsSync(manifestPath)) {
    fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  }
  ```
  Then initialise `manifest = { schemaVersion: 1, entries: [] }` in the missing-file branch of the JSON.parse block at line 1415. The deletion/edit loops iterate over `manifest.entries` (empty → no work), the heal block still scans knowledge files and pairs ready log obs with orphan anchors. Add a reconcile test covering "manifest absent + knowledge file contains a self-learning anchor + log has matching ready obs → heal triggers".

**Duplicated section-slice algorithm across four call sites** — Confidence: 84%
- `scripts/hooks/json-helper.cjs:207-210`, `scripts/hooks/json-helper.cjs:251-255`, `scripts/hooks/json-helper.cjs:1463-1465`, `scripts/hooks/json-helper.cjs:1511-1512`
- **Problem**: The same "slice a section from `## ANCHOR:` heading to the next `## ` heading or EOF" algorithm appears four times with subtly different encodings:
  - `countActiveHeadings` (line 207): `content.indexOf('\n## ', sectionStart + 1)` + `content.slice(sectionStart, nextHeadingIdx)`
  - `findUnmanagedAnchors` (line 252, new code): identical `indexOf('\n## ', ...)` pattern
  - reconcile edit-detection (line 1463): `new RegExp('(##\\s+${entry.anchorId}[\\s\\S]*?)(?=\\n##\\s+(?:ADR|PF)-|\\s*$)')`
  - reconcile heal (line 1511, new code): same regex as line 1463 reconstructed per anchor
  
  Plus `src/cli/utils/legacy-knowledge-purge.ts:174` holds a FIFTH variant (`SECTION_REGEX = /\n## (ADR|PF)-\d+:[^\n]*(?:\n(?!## )[^\n]*)*/g`). Each variant has slightly different edge behaviour (line 252 splits on the literal `'\n## '` so it does NOT stop at an `# Heading` or a `### subheading`; the regex at line 1463 uses `\n##\\s+(?:ADR|PF)-` so it stops only at another knowledge heading, not at arbitrary `## ` content — the two return different slices if a non-knowledge `## ` heading were ever added).
- **Impact**: Code cohesion violation — a single concept ("extract the body of knowledge section N") is encoded five ways across two files. Future edits must fan out to five sites to stay consistent; the heal block re-implemented a pattern that already existed 60 lines away (line 1463) rather than reusing it. This is the shallow-module anti-pattern [Ousterhout]: the "extract section body" operation leaks into every caller instead of being a deep helper with a rich implementation.
- **Fix**: Extract a single helper near the top of json-helper.cjs:
  ```js
  /**
   * Slice a knowledge section body from `## ANCHOR:` to the next `## ADR-` or
   * `## PF-` heading (or EOF). Returns the section including its own heading.
   * @param {string} content - Full file content
   * @param {string} anchorId - e.g. 'ADR-005' or 'PF-002'
   * @returns {string | null} section content or null if anchor not present
   */
  function sliceKnowledgeSection(content, anchorId) {
    const re = new RegExp(`(##\\s+${anchorId}[\\s\\S]*?)(?=\\n##\\s+(?:ADR|PF)-|\\s*$)`);
    const match = content.match(re);
    return match ? match[1] : null;
  }
  ```
  Call from the three reconcile sites (line 1463, 1511, and the new heal block). Keep `findUnmanagedAnchors` using its own indexOf-based loop since it iterates over all anchors, not a specific one. The `purgeAllPreV2Knowledge` SECTION_REGEX is a separate concern (global sweep) but should at minimum share a comment pointing to this canonical helper. Reduces the five-site drift surface to two.

## Issues in Code You Touched (Should Fix)

**Redundant file I/O in heal block** — Confidence: 90%
- `scripts/hooks/json-helper.cjs:245` (inside `findUnmanagedAnchors`), `scripts/hooks/json-helper.cjs:1509` (heal loop)
- **Problem**: `findUnmanagedAnchors` reads the full contents of decisions.md and pitfalls.md at line 245, extracts headings + source markers, and returns only anchor metadata. The content is then discarded. The heal loop at line 1509 then calls `fs.readFileSync(u.path, 'utf8')` again for each unmanaged anchor to compute the content hash. For K unmanaged anchors found in decisions.md, the file is read K+1 times; same for pitfalls.md.
- **Impact**: At realistic sizes (≤100 ADRs, ≤100 PFs) this is a microsecond-scale perf concern, not a correctness issue. But it's symptomatic of the shallow-module issue above — the heal loop doesn't know `findUnmanagedAnchors` already has the content, so it re-reads.
- **Fix**: Have `findUnmanagedAnchors` return `{ anchorId, type, path, headingText, section }` where `section` is the already-sliced body. Line 1509-1515 then uses `u.section` directly for hashing instead of re-reading:
  ```js
  // In findUnmanagedAnchors:
  result.push({
    anchorId: m[1], type, path: file, headingText: m[2].trim(),
    section, // the slice already computed at lines 253-255
  });
  // In heal loop:
  keptEntries.push({
    observationId: obs.id, type: u.type, path: u.path,
    contentHash: contentHash(u.section),
    renderedAt: new Date().toISOString(), anchorId: u.anchorId,
  });
  ```
  Eliminates the re-read and the `safeAnchorId` regex reconstruction. Cohesion of `findUnmanagedAnchors` improves (it already owns the section slice; now it returns it).

**`ctx.devflowDir` ignored for state-file location — API signature misleading** — Confidence: 82%
- `src/cli/utils/migrations.ts:402`, `src/cli/utils/migrations.ts:408`
- **Problem**: `runMigrations(ctx: { devflowDir: string }, ...)` accepts a `devflowDir` as input, then on line 408 unconditionally overrides it: `const homeDevflowDir = path.join(os.homedir(), '.devflow')`. The passed `ctx.devflowDir` IS used downstream (lines 422, 439) for the per-migration contexts, but the applied-state file location is locked to `~/.devflow`. A caller could reasonably read the signature and expect `devflowDir` to control state location.
- **Impact**: Hidden invariant — the rationale (D30: state must be scope-independent) is well-justified in the comment, but the signature obscures it. A local-scope install that passes `./.devflow` as `devflowDir` will still write state to `~/.devflow/migrations.json`, which is correct but surprising. Makes unit testing awkward (tests at `tests/migrations.test.ts:161` redirect via `process.env.HOME` instead of injecting a path).
- **Fix**: Two options, neither urgent:
  1. Rename the field to clarify: `ctx: { perMigrationDevflowDir: string }` or `ctx: { migrationCtxDir: string }` so it's obvious that the passed field is NOT the state location.
  2. Better — split the concerns: accept both `perMigrationCtx` (for migration execution) and `stateFilePath` (for applied-list persistence) as explicit inputs. The current code conflates two roles.
  Option 2 restores testability without the `process.env.HOME` hack at test:161. Can be deferred — test workaround is acceptable, and D30 doc gives future readers enough context.

**Resolve-variant knowledge-loading phrasing diverges between base/teams (Step 0d) and ambient (Phase 1.5)** — Confidence: 75%
- `plugins/devflow-resolve/commands/resolve.md:72`, `plugins/devflow-resolve/commands/resolve-teams.md:65`, `shared/skills/resolve:orch/SKILL.md:35`
- **Problem**: The prose for loading project knowledge is byte-identical between resolve.md and resolve-teams.md (good — lockstep discipline per PF-008). The orch variant uses prose that is *semantically* equivalent but lexically different: it uses "Phase 1.5" instead of "Step 0d", drops the `{worktree}` prefix (correct — ambient mode excludes multi-worktree), and the paragraph has the same words in the same order otherwise. Structural tests at `tests/resolve/knowledge-citation.test.ts:125-260` assert each surface independently (good), but there is no test that asserts the three surfaces share a common canonical instruction set — only that each contains the required keywords.
- **Impact**: Moderate drift risk. The structural tests give belt-and-suspenders coverage against accidental omission (missing keyword → fail) but not against intentional divergence that subtly changes semantics (e.g., someone edits resolve.md to say "Strip sections with **State**: Deprecated" — the keyword tests still pass because "Deprecated" appears, but resolve-teams.md may still say "**Status**: Deprecated"). PF-008 specifically calls out this silent-divergence class.
- **Fix**: Add one more cross-cutting test in `knowledge-citation.test.ts` that asserts the identity of the loader paragraph across the two base/teams files (they SHOULD be byte-identical at the user-facing prose level). For the orch variant, assert the trimmed Phase 1.5 body matches a canonical shape (same filter algorithm, same `(none)` sentinel, same marker). Example:
  ```ts
  it('resolve.md and resolve-teams.md Step 0d prose is byte-identical', () => {
    const base = loadFile('plugins/devflow-resolve/commands/resolve.md');
    const teams = loadFile('plugins/devflow-resolve/commands/resolve-teams.md');
    const extractStep0d = (s: string) =>
      s.slice(s.indexOf('#### Step 0d'), s.indexOf('### Phase 1'));
    expect(extractStep0d(teams)).toBe(extractStep0d(base));
  });
  ```
  This is the mechanical link PF-008 recommends ("Add a CI check that diffs the shared prose sections of base vs teams variants"). Current structural tests are necessary but not sufficient.

## Pre-existing Issues (Not Blocking)

**`json-helper.cjs` approaching god-module territory** — Confidence: 86%
- `scripts/hooks/json-helper.cjs` (whole file, now 1791 lines, +87 from this PR)
- **Problem**: Single file now hosts: stdin/stdout JSON utilities (~100 lines), learning-system constants and thresholds (~40 lines), per-type promotion math (~50 lines), atomic file I/O wrappers (~50 lines), knowledge-file header writers (~20 lines), usage tracking (~80 lines), notification state machine (~90 lines), mkdir lock primitives (~40 lines), content/hash/slug utilities (~50 lines), and then 25+ case handlers dispatching on `argv[2]`. Each case handler is 20-150 lines of inline business logic. The reconcile-manifest case at line 1395 is now 140 lines.
- **Impact**: Maintainability — nothing is directly testable in isolation because everything is at top-level scope of one CJS script. Adding Fix 2's 87 lines landed a new helper function plus inline heal block in the reconcile case; the natural place for the heal block to live is alongside findUnmanagedAnchors and the existing edit-detection logic in a cohesive `reconcile.cjs` module. This is the Parnas (1972) information-hiding concern the Iron Law cites — currently every hook that loads json-helper.cjs pulls in every function, every constant, and every case handler.
- **Fix**: Not this PR. Track as tech debt. The file already carries an implicit split (learning-system stuff could migrate to `scripts/hooks/lib/learning.cjs`; JSON utilities to `scripts/hooks/lib/json-ops.cjs`; knowledge file I/O + locks to `scripts/hooks/lib/knowledge.cjs`). Boundary is visible today from the imports-to-nothing structure: 30 top-level functions, only ~6 get used outside their immediate case handler.

**Migration registry lacks schema-version awareness** — Confidence: 72%
- `src/cli/utils/migrations.ts:137`, `src/cli/utils/migrations.ts:200-211`
- **Problem**: The `MIGRATIONS` array grows monotonically — v2 then v3 then (eventually) v4, v5. Each migration receives only `memoryDir` and runs unconditionally (unless applied). There is no notion of schema version or of prerequisite ordering. If v3 must run after v2 (which is the case — v3's self-learning-marker discriminator assumes the 4 hardcoded IDs are already gone), this is expressed implicitly by array order (v2 at index 1, v3 at index 2) and documented only in comments at line 111-120. A future editor could reorder the array without realising v3 depends on v2's side effects.
- **Impact**: Fragile implicit dependency. Today v2 and v3 on the same project are both idempotent on a post-v2 state (v3 is a superset that would correctly handle all entries v2 targets), so ordering is incidental rather than load-bearing. But as the registry grows, this invariant will matter.
- **Fix**: Deferred. Either (a) add an explicit `dependsOn: string[]` field on Migration entries and run them in topological order, or (b) document the invariant in the MIGRATIONS declaration itself with a test at `tests/migrations.test.ts` that asserts `indexOf('purge-legacy-knowledge-v3') > indexOf('purge-legacy-knowledge-v2')`. Not a ship blocker — PR #182 adds a coincidentally correct ordering and the comment at line 122 is clear.

## Suggestions (Lower Confidence)

- **v2 and v3 purge functions share 80% of their body** — `src/cli/utils/legacy-knowledge-purge.ts:88,207` (Confidence: 68%) — Both functions have: identical early-bail on missing knowledgeDir, identical lock acquisition, identical file-prefix iteration, identical TL;DR recount, identical lock release. The only material difference is the removal-algorithm (v2: `for (legacyId of LEGACY_IDS) replace(...)`; v3: `content.replace(SECTION_REGEX, filter)`). Could extract a `processKnowledgeFiles(memoryDir, transform: (content, prefix) => { content, removed })` helper, but the savings are modest (~30 lines) and the two removal algorithms are genuinely different in shape. The question posed in the review brief ("is the shared setup worth extracting?") — my read is: the setup is worth extracting *once the v4 migration arrives*. Two implementations with boilerplate is fine; three is the refactor trigger. Leave as-is.

- **Heal block inside reconcile-manifest case is a separate concern** — `scripts/hooks/json-helper.cjs:1489-1522` (Confidence: 70%) — The reconcile case now does three things: (1) prune stale manifest entries (delete detection), (2) update content hashes (edit detection), (3) re-pair orphan anchors with ready obs (heal). Each is a separate pass over its own data. Extracting the heal block into a named function would improve readability:
  ```js
  function healOrphanedAnchors(memoryDir, logMap, keptEntries) { ... return healed; }
  // ... in reconcile case:
  healed = healOrphanedAnchors(memoryDir, logMap, keptEntries);
  ```
  But the function needs `cwd`, `logMap`, `keptEntries`, `learningLog`, `normalizeForDedup`, `contentHash`, `registerUsageEntry`, `findUnmanagedAnchors` — all module-scoped. Extraction would require parameter pass-through noise that doesn't pay for itself inside a single 1791-line file. My read: the heal block belongs where it is UNTIL json-helper.cjs is split up (see pre-existing god-module issue). At that point it migrates naturally into `lib/reconcile.cjs` with its siblings.

- **`legacy-knowledge-purge.ts` SECTION_REGEX (line 174) vs json-helper.cjs section-slicing is semantically equivalent but lexically different** — `src/cli/utils/legacy-knowledge-purge.ts:174` (Confidence: 62%) — TS side uses `/\n## (ADR|PF)-\d+:[^\n]*(?:\n(?!## )[^\n]*)*/g`; JS side uses `(##\s+ANCHOR[\s\S]*?)(?=\n##\s+(?:ADR|PF)-|\s*$)`. Both work. The TS regex is more restrictive (won't match if ANY `## heading` appears mid-section, including `## subheading`); the JS regex is narrower in its stop condition (only stops at another `## ADR-` or `## PF-`, tolerates arbitrary `## ` mid-section). If a self-learning entry ever contained a literal `## ` line in its body (unlikely but possible via user edits to decisions.md), the two implementations would disagree about where the section ends. Worth noting; not worth fixing today.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 2 | 0 | 0 |
| Should Fix | 0 | 0 | 3 | 0 |
| Pre-existing | 0 | 0 | 2 | 0 |

**Architecture Score**: 7.5 / 10

**Recommendation**: **CHANGES_REQUESTED**

### Rationale

Overall the PR exhibits solid architectural discipline:
- **Layering is clean**: CLI migration registry (migrations.ts) delegates via dynamic `import()` to legacy-knowledge-purge.ts utility, which delegates to fs-atomic.ts helpers. Each layer has one reason to change. The dynamic import is the correct decoupling technique for registry entries that shouldn't be paged in on every devflow run.
- **SOLID**: D38 discriminated-union refactor (GlobalMigrationContext vs PerProjectMigrationContext) eliminates a pre-existing ISP violation. D31 registry pattern correctly extends OCP (adding migrations = adding entries, no edits to dispatcher).
- **Lockstep markdown drift risk is handled**: The three resolve surfaces use byte-identical prose between base/teams; the orch variant is semantically consistent. Structural tests cover all three surfaces at the keyword level. PF-008 is the exact pitfall this PR could have tripped over, and it didn't.
- **Test coverage is thorough**: 107 tests pass, including explicit regression guards (pre-v2 marker exclusion at reconcile.test.ts:598, D-D ambiguity at reconcile.test.ts:446, cross-surface KNOWLEDGE_CONTEXT assertions at knowledge-citation.test.ts:328).

Two HIGH-severity issues block approval as-is:
1. **Heal path skipped when manifest absent** (json-helper.cjs:1401) — a real scenario-coverage gap in the exact crash window Fix 2 targets. Narrow but fixable in <20 lines.
2. **Section-slice algorithm duplicated across four call sites** — adds to pre-existing technical debt rather than reducing it. Fix requires extracting one helper function.

The remaining Should-Fix items (redundant I/O, misleading ctx signature, cross-surface parity test) are small ergonomic improvements and can ride in a follow-up if the two HIGH issues are addressed in this PR.

**Answer to review brief questions**:

1. *Duplication between purgeLegacyKnowledgeEntries and purgeAllPreV2Knowledge*: The shared setup is **not** worth extracting today. Two implementations with boilerplate is acceptable; the refactor payoff arrives with the v4 migration. The removal algorithms are genuinely different (allow-list vs format-discriminator), and premature extraction would hide that difference.

2. *Three lockstep markdown surfaces, PF-008 drift risk*: Drift risk is **partially mitigated** by structural tests, but not **byte-equal** mitigation. Recommend adding one cross-cutting test asserting that the Step 0d paragraph is byte-identical between resolve.md and resolve-teams.md (Should-Fix item above). Orch variant should remain a separate semantic assertion — ambient mode legitimately diverges from the worktree flow.

3. *Layer boundaries — CLI registry → purge utils → fs-atomic helpers*: **Clean**. Each layer has a single responsibility, dependencies flow inward (registry imports purge, purge imports fs-atomic — never the reverse), and the dynamic `import()` in migration entries is appropriate lazy loading. No issues.

4. *Heal block location — embedded inside reconcile-manifest handler or extracted?*: **Stays embedded for now**. The heal block is cohesive with the existing reconcile concerns (deletion detection, edit detection, healing all belong to the same "sync manifest vs FS" pass). Extracting to a named function would require passing ~7 module-scoped dependencies through the signature. The correct time to extract is when json-helper.cjs is split into `lib/*.cjs` modules (separate PR — noted under pre-existing issues).
