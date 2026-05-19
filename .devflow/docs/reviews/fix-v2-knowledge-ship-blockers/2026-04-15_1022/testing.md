# Testing Review Report

**Branch**: `fix/v2-knowledge-ship-blockers` -> `main`
**PR**: #182
**Date**: 2026-04-15 10:22
**Diff range**: `bd1c92f...HEAD` (incremental)
**Pattern skill**: devflow:testing
**Suite verification**: 135/135 tests pass across new + modified files

---

## Summary of Changed Test Surface

| File | Status | Tests | Behavior vs Implementation |
|------|--------|-------|---------------------------|
| `tests/knowledge/index-generator.test.ts` | New | 24 | Mostly behavior; 4 string-format assertions are mildly coupled |
| `tests/knowledge/apply-knowledge-skill.test.ts` | New | 13 | All structural prose assertions on a single skill file |
| `tests/knowledge/command-adoption.test.ts` | New | 29 | Pure structural prose assertions on 11 surfaces |
| `tests/knowledge/helpers.ts` | New | — | Re-export of `loadFile` / `extractSection` |
| `tests/resolve/knowledge-citation.test.ts` | Modified (-58) | 36 | Pruning is net-positive (de-dup) |
| `tests/skill-references.test.ts` | Modified | 33 | Reviewer citation byte-identity → content-shape |
| `tests/learning/helpers.ts` | Modified | — | Centralised `djb2()` |
| `tests/learning/reconcile.test.ts` | Modified | — | Imports shared `djb2` instead of inlining |
| `tests/legacy-knowledge-purge.test.ts` | Modified | — | Renamed import to match production rename |

Total verified: **135 tests pass** (all new + modified files).

---

## Issues in Your Changes (BLOCKING)

_None._ No CRITICAL or HIGH issues in the new or modified test code that would block merge.

The new tests verify the right behavior at the right level: pure unit tests against the production CJS module for filter/index logic, real subprocess (`execSync`) for the CLI dispatch surface, and structural assertions for markdown instruction content. The pruning of `tests/resolve/knowledge-citation.test.ts` removes assertions that have been re-homed into the new `tests/knowledge/*` suites, not coverage that vanished.

---

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Unbounded tmpdir leak in `index-generator.test.ts` (and inherited from `knowledge-citation.test.ts`)** — Confidence: 95%
- `tests/knowledge/index-generator.test.ts:21-32` — `makeTmpWorktree()` creates a fresh `mkdtempSync('knowledge-index-test-')` per call (one per test, ~24 per run) and there is no `afterEach`/`afterAll` cleanup. `tests/knowledge/apply-knowledge-skill.test.ts` doesn't allocate tmpdirs (read-only structural). The same omission exists in `tests/resolve/knowledge-citation.test.ts:136-150` (`knowledge-test-*`, `knowledge-test-opts-*`).
- Problem: every full suite run leaks ~30+ directories under `$TMPDIR`. CI keeps tmpfs around for the worker lifetime; local dev accumulates them across runs. Other test files in this repo (`tests/learning/reconcile.test.ts:127-132`, `tests/legacy-knowledge-purge.test.ts:19-21`) do `afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }))`. The new suite breaks that local convention.
- Fix: track the dir per-test in a `let tmpDir` + `beforeEach`/`afterEach`, mirroring `tests/learning/reconcile.test.ts:124-132`. Example:
  ```typescript
  let tmpDir: string
  beforeEach(() => { tmpDir = mkdtempSync(path.join(os.tmpdir(), 'knowledge-index-test-')) })
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }) })
  // then makeTmpWorktree() writes into tmpDir instead of allocating a new one
  ```

**Test helper duplication remains across `tests/knowledge/` and `tests/resolve/`** — Confidence: 95%
- `tests/knowledge/helpers.ts:6-22` defines `loadFile` and `extractSection`. `tests/resolve/knowledge-citation.test.ts:39-64` redefines `loadFile` and a slightly more verbose `extractSection` (different error message: `"Anchor not found in document:"` vs `"Anchor not found:"`).
- Problem: the prompt asks whether the new helpers are re-exportable to `tests/resolve/`. They are — but the modified `knowledge-citation.test.ts` did not adopt them. The PR introduced extraction in one place while leaving the same code in the file it was supposedly extracted from. This is the exact "drift between two near-identical helpers" pattern that helper extraction is supposed to prevent.
- Fix: change `tests/resolve/knowledge-citation.test.ts` to `import { loadFile, extractSection } from '../knowledge/helpers'` (or move helpers up to `tests/helpers/markdown.ts` if the cross-directory import bothers you), and delete lines 39-64. The error-message wording difference is cosmetic — the `tests/knowledge/helpers.ts` version (`"Anchor not found: \"X\""`) is fine.

**Bare-invocation deprecation test under-asserts intended exit behavior** — Confidence: 90%
- `tests/knowledge/index-generator.test.ts:221-228` — the `bare invocation emits deprecation notice to stderr` test runs `2>&1 1>/dev/null || true` with `shell: true`. Verified: the `|| true` masks the exit code, so the test passes regardless of whether bare invocation exits 0 (current behavior, intended as a soft deprecation) or exits 1 (which would be a behavior change). The companion test at line 215-219 (`bare invocation produces full corpus format`) also uses `2>/dev/null` to discard the notice.
- Problem: nothing pins down "deprecation notice + exit 0 + still emits corpus" as a single behavior contract. If a future change flips bare invocation to exit 1, both tests still pass for the wrong reasons (the `|| true` swallows the failure; `2>/dev/null` hides the notice).
- Fix: replace `|| true` with explicit exit-code capture and assert exit 0:
  ```typescript
  it('bare invocation: exit 0 + deprecation stderr + full corpus stdout', () => {
    const tmpDir = makeTmpWorktree(ACTIVE_ADR)
    const result = spawnSync('node', [CJS_PATH, tmpDir], { encoding: 'utf8' })
    expect(result.status).toBe(0)
    expect(result.stderr).toMatch(/deprecat/i)
    expect(result.stdout).toContain('Always return Result<T,E>')
  })
  ```
  This collapses the two split tests into one behavior contract and removes the `shell: true` + `|| true` brittleness.

### LOW

**`omits — Area suffix` test is fragile against the footer's identical em-dash** — Confidence: 85%
- `tests/knowledge/index-generator.test.ts:154-162` — splits output into lines and asserts the PF line does not contain `—`. Verified the production output has only the PF line containing the em-dash when an Area is present, but the footer also uses em-dashes in adjacent text in other generator paths. The assertion is correct *because* `lines.find(l => l.includes('PF-008'))` scopes to the line, not the whole document, but the assertion couples the test to the exact glyph (`—`, U+2014).
- Problem: a benign reformat from em-dash to ASCII `--` or `(` somewhere in the formatter would silently break this test even though the underlying behavior (no area suffix when area is missing) is preserved.
- Fix: assert positively on the absence of the literal `Area:` substring or compare against a regex that captures the suffix shape, e.g. `expect(pfLine).not.toMatch(/—\s+\S/)`. Even better: assert the line equals the expected literal `'  PF-008  No area field  [Active]'`, which is unambiguous.

**Area-truncation test asserts byte length, not character intent** — Confidence: 80%
- `tests/knowledge/index-generator.test.ts:131-144` — truncation assertion is `areaPart.length).toBeLessThanOrEqual(81)` (80 + ellipsis). Verified the actual output string-length is exactly 81 (`scripts/hooks/aaaaa…`, 80 ASCII + 1 codepoint for `…`).
- Problem: `String.length` returns UTF-16 code units, not characters. Today the ellipsis is BMP (1 unit), so 81 is correct. If `truncate()` ever switches to a non-BMP suffix glyph (`U+1F4D6` etc.), the assertion would break for the wrong reason.
- Fix: assert intent directly — the area part starts with `scripts/hooks/` and ends with `…`:
  ```typescript
  expect(areaPart.startsWith('scripts/hooks/')).toBe(true)
  expect(areaPart.endsWith('…')).toBe(true)
  expect(areaPart).not.toContain('a'.repeat(80)) // full input not present
  ```

**Edge cases not covered: malformed/whitespace/unicode inputs** — Confidence: 80%
- `tests/knowledge/index-generator.test.ts` covers happy-path filtering + truncation + missing-Area + unknown-Status, but does not exercise:
  - Trailing whitespace on `## ADR-NNN: title  ` (will the title carry trailing spaces into the index?). The production code does `headingMatch[2].trim()` so this is fine — but no test pins it.
  - Non-ASCII / unicode in titles (e.g., `## ADR-009: Use Résultat types`) — relevant because `truncate()` slices by code unit, which can split an emoji or surrogate pair.
  - Malformed sections (`## ADR-001:` with no title, `## ADR-` without a number, ADR with no `**Status**` line) — the production code's `[unknown]` branch handles missing status, but only the "non-standard status string" case is tested.
  - Empty body sections (`## PF-001: title\n\n## PF-002: ...`) — currently filtered by the `Status` regex (no Status line means no Deprecated/Superseded match → kept). One test would lock this in.
- Fix: add 3-4 short tests for unicode title, missing Status line, malformed heading, and trailing whitespace title. Each is a 5-line addition; locks in observable behavior of the truncation/filter primitives.

**29 structural-prose assertions on 11 surfaces are brittle to benign rewording** — Confidence: 75%
- `tests/knowledge/command-adoption.test.ts:8-25` — every surface check does `expect(content).toContain('knowledge-context.cjs index')`. This is the *literal exact subcommand invocation*, so renaming the subcommand or even reformatting the spawn block as a multi-line `node \\\n  scripts/.../knowledge-context.cjs \\\n  index \\\n  ...` would fail because `toContain` matches contiguous bytes.
  - Risk is bounded — a multi-line break that introduces whitespace inside `knowledge-context.cjs index` is unlikely; the more realistic break is a rename to `knowledge-context.cjs idx` (subcommand alias) or moving to a flag like `--mode=index`.
- The phase-section assertions (`extractSection(content, 'Phase 2: Investigate', '## Phase 3')`) are *more* fragile — renaming a phase from "Phase 2: Investigate" to "Phase 2 — Investigate" or to "Phase 2: Investigation" breaks `extractSection` with a hard error. This is a property of the helper ("loud failure" was an explicit design choice per `tests/knowledge/helpers.ts:14-17`).
- Net assessment: these are *integration tests of orchestration discipline* — their job is to fail loudly when a surface drifts. The brittleness is intentional and justifies itself when the orchestration contract is the unit being protected. No fix recommended; flagging as a known characteristic so reviewers don't churn rewriting them when phase headings get tweaked.

---

## Pre-existing Issues (Not Blocking)

### MEDIUM

**Verbose error message helper duplication strategy across `tests/`** — Confidence: 70%
- Three near-identical "load this file relative to repo root" helpers exist: `tests/knowledge/helpers.ts:6-8`, `tests/resolve/knowledge-citation.test.ts:39-41`, and similar inline patterns in `tests/skill-references.test.ts`. None of them is in scope to fix in this PR (`tests/skill-references.test.ts` predates these changes), but the pattern of "extract once, leave the original" recurs.
- Suggest a future PR consolidating to `tests/helpers/markdown.ts` and updating callers, which would also let `extractSection` standardize on one error-message convention.

---

## Suggestions (Lower Confidence)

- **Behavior-vs-implementation tradeoff in `apply-knowledge-skill.test.ts`** - `tests/knowledge/apply-knowledge-skill.test.ts:1-112` (Confidence: 65%) — every test reads the SKILL.md file and asserts `content.toContain(...)` on prose snippets like `'applies ADR-NNN'`, `'(none)'`, `'Identify plausibly-relevant'`. This is testing that a documentation file says specific words rather than testing observable behavior. It is the right level for a markdown-only artifact (there's no executable contract to assert against), but the suite would benefit from one end-to-end test that loads the skill and checks an LLM-driven invocation produces the citation format — out of scope for this PR.

- **No assertions on stderr observability format stability** - `tests/knowledge/index-generator.test.ts:259-289` (Confidence: 65%) — asserts stderr contains `[knowledge-context]`, `mode=index`, `entries=2`, but doesn't lock the *order* or `worktree=<path>` token. If a parser ever consumes this log line (and the comment in `knowledge-context.cjs:271-279` strongly suggests it might), a strict regex would be safer.

- **`createRequire` boundary in CJS-from-ESM imports** - `tests/knowledge/index-generator.test.ts:9-17` (Confidence: 60%) — uses `createRequire(import.meta.url)` to load the CJS module from an ESM test. This works but couples the test to the CJS module's `module.exports` shape rather than ESM named exports. If the production module ever migrates to ESM, every test file using this pattern (this file + `tests/resolve/knowledge-citation.test.ts:26-37`) needs updating. Not a current bug.

---

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 0 | - |
| Should Fix | - | 0 | 3 | 3 |
| Pre-existing | - | - | 1 | 0 |

**Specific concerns from the prompt, addressed:**

1. **Behavior vs implementation coupling** — The 24 tests in `index-generator.test.ts` are mostly behavior-focused (filter logic, status tagging, truncation outcome). Two are mildly coupled to glyph identity (em-dash, ellipsis). Not blocking.
2. **Real subprocess for CLI** — `execSync` is the right call. No mocked paths that should be real. The bare-invocation test under-asserts exit code (`|| true`) — flagged as MEDIUM.
3. **Edge-case coverage** — Gaps in unicode/whitespace/malformed inputs. Flagged as LOW.
4. **Structural prose assertions on 11 surfaces** — Intentionally brittle by design; appropriate for the contract being asserted. Not a defect.
5. **Pruning of `knowledge-citation.test.ts` -58 lines** — Net-positive. Removed assertions (decisions.md/pitfalls.md mention, Deprecated/Superseded mention, ADR-NNN/PF-NNN format, hallucination guard) are re-asserted in the new `tests/knowledge/` suites. No coverage gap.
6. **`reviewer.md` CITATION-SENTENCE relaxation** — The new check (`KNOWLEDGE_CONTEXT` + `devflow:apply-knowledge` + `applies ADR-NNN` + `avoids PF-NNN` substrings) is sufficient. The sentence intentionally diverges from the canonical (coder-style) one because reviewer.md uses the index+Read pattern; byte-identity would be wrong. The four substring checks lock in the semantic contract.
7. **Helpers re-exportable** — `tests/knowledge/helpers.ts` *is* re-exportable, but the modified `knowledge-citation.test.ts` did not adopt it. Duplication remains. Flagged as MEDIUM.
8. **Flaky patterns** — No timing/race issues. No subprocess teardown problems (children are short-lived `execSync`). No global state. The only hygiene issue is unbounded tmpdir creation (MEDIUM).

**Testing Score**: 8/10
- New tests are thorough, fast (412ms total for 135 tests), and use the production module directly rather than reimplementing it (a previous anti-pattern this PR removes — see the deleted inline `filterKnowledgeContext` in `knowledge-citation.test.ts`).
- Score reduced for: tmpdir leak, helper-extraction not finished, bare-invocation under-assertion.

**Recommendation**: APPROVED_WITH_CONDITIONS

Conditions (none individually blocking, recommend bundling into a follow-up commit on this branch before merge):
1. Add `beforeEach`/`afterEach` cleanup to `tests/knowledge/index-generator.test.ts` and `tests/resolve/knowledge-citation.test.ts` tmpdir allocations.
2. Delete the duplicated `loadFile`/`extractSection` from `tests/resolve/knowledge-citation.test.ts:39-64` and import from `tests/knowledge/helpers.ts`.
3. Tighten the bare-invocation deprecation test to use `spawnSync` and assert exit code 0 explicitly.
