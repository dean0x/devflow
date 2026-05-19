# Regression Review Report

**Branch**: `fix/v2-knowledge-ship-blockers` -> `main`
**Diff range**: `bd1c92f...HEAD` (14 commits)
**Date**: 2026-04-15 10:22

## Methodology

Loaded `devflow:regression` pattern skill. Applied 6-step review process from `devflow:review-methodology`. Investigated each concern from the orchestrator prompt, plus broader regression-surface analysis.

## Summary of Investigation

Surfaces examined for breaking changes:

| Surface | Public API change | Migration status |
|---------|-------------------|------------------|
| `scripts/hooks/lib/knowledge-context.cjs` module | `loadKnowledgeContext` preserved; `loadKnowledgeIndex` and `extractIndexEntries` added | Backward compatible |
| `knowledge-context.cjs` CLI dispatch | New subcommands `index`/`full`; bare invocation now requires path-shaped argument | Mostly backward-compatible — see Should-Fix #1 |
| `KNOWLEDGE_CONTEXT` semantics (was full corpus, now compact index) | Breaking — but all four production callers and downstream agents migrated in same PR | Verified consumer-side |
| `purgeAllPreV2Knowledge` → `purgeAllPreV2KnowledgeEntries` rename | Breaking export rename | Single internal caller (migrations.ts) and tests both updated |
| `reviewer.md` CITATION-SENTENCE marker semantics | Diverges from coder.md byte-identity invariant | Test updated to allow divergence — see Should-Fix #2 |
| Test pruning in `tests/resolve/knowledge-citation.test.ts` | Net -58 lines | Coverage migrated to apply-knowledge-skill.test.ts and command-adoption.test.ts (verified inline below) |

---

## Issues in Your Changes (BLOCKING)

### CRITICAL

None.

### HIGH

None.

---

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Bare-invocation CLI dispatch rejects bare relative-path argument without slash** — `scripts/hooks/lib/knowledge-context.cjs:314`
**Confidence**: 85%

- Problem: The new dispatch logic at line 314 detects "bare path" form by requiring `firstArg.startsWith('/') || .startsWith('.') || .startsWith('~') || .includes('/')`. A pre-PR caller that invoked `node knowledge-context.cjs myproject` (a bare relative path with no slash and not starting with `.`) used to work — the previous CLI just ran `path.resolve(worktree)` on whatever it received. After this PR, that invocation falls through to the `else if (!KNOWN_SUBCOMMANDS.has(firstArg))` branch (line 318) and exits 1 with usage. The deprecation contract in the file's docstring (lines 13-15, 22-23) promises that bare invocation still emits the full corpus with a warning — that promise is broken for bare-name paths.
- Impact: Likely zero in practice (only test files import the module per `Grep`, and no callers pass bare names today), but the documented backward-compat surface is wider than the implementation. If a third-party wrapper or shell script ever did `node knowledge-context.cjs $WORKTREE_NAME`, this is a silent regression to an exit-1 error.
- Fix: Treat any non-known-subcommand single argument as the bare path form, OR add a Node `fs.existsSync` check to disambiguate. Simplest fix:
  ```javascript
  } else if (!KNOWN_SUBCOMMANDS.has(firstArg) && argv.length === 1) {
    // Bare deprecated form: single argument that isn't a known subcommand → treat as path
    mode = 'bare';
    worktreeArg = firstArg;
  }
  ```
  This preserves the original "anything goes as worktree" behavior under the documented deprecation umbrella while still rejecting `foo bar baz` as an unknown subcommand.

**Reviewer citation sentence diverges from canonical coder/skill sentence — `tests/skill-references.test.ts:1039` invariant relaxed** — `shared/agents/reviewer.md:50-52`
**Confidence**: 80%

- Problem: Pre-PR, `tests/skill-references.test.ts` enforced byte-identity between the citation sentence in `shared/skills/knowledge-persistence/SKILL.md`, `shared/agents/coder.md`, AND `shared/agents/reviewer.md`. This PR intentionally diverges reviewer.md (it now references `KNOWLEDGE_CONTEXT` index + `devflow:apply-knowledge`, which coder.md does not) and the test was relaxed to a substring/keyword check (lines 1039-1048). Your concern is correct: coder.md byte-identity with the canonical skill is still guarded (line 1033-1037), but the three-way invariant that originally existed is now a two-way invariant. There's no test that reviewer.md's new sentence stays in sync with apply-knowledge SKILL.md's instructions if the latter evolves.
- Impact: Future drift risk. If apply-knowledge SKILL.md changes its citation format (e.g., from `applies ADR-NNN` to a different convention), reviewer.md will silently fall out of sync. The substring check (`KNOWLEDGE_CONTEXT`, `devflow:apply-knowledge`, `applies ADR-NNN`, `avoids PF-NNN`) catches structural drift but not semantic drift.
- Fix: Either (a) add a byte-identity test between the reviewer.md CITATION-SENTENCE block and a new canonical block in apply-knowledge SKILL.md, or (b) document in reviewer.md (inline comment) that the sentence is the canonical source for the index+Read pattern. Option (a) is more durable. Suggested addition to apply-knowledge SKILL.md:
  ```markdown
  <!-- CITATION-SENTENCE-START -->
  When you apply a decision or avoid a pitfall identified via the KNOWLEDGE_CONTEXT index (after reading its full body per the `devflow:apply-knowledge` skill), cite the entry ID inline: `applies ADR-NNN` or `avoids PF-NNN`.
  <!-- CITATION-SENTENCE-END -->
  ```
  Then add a third assertion in `tests/skill-references.test.ts` to check reviewer.md byte-identity against this new canonical block.

---

## Pre-existing Issues (Not Blocking)

None flagged. No CRITICAL pre-existing regression risks identified outside the diff.

---

## Suggestions (Lower Confidence)

- **Implement orchestration does not pass KNOWLEDGE_CONTEXT to Simplifier/Scrutinizer/Coder despite their frontmatters declaring `devflow:apply-knowledge`** — `shared/skills/implement:orch/SKILL.md`, `plugins/devflow-implement/agents/{simplifier,scrutinizer}.md` (Confidence: 65%) — The Simplifier and Scrutinizer agent files now declare a `KNOWLEDGE_CONTEXT` input variable and an Apply Knowledge section. The `implement:orch/SKILL.md` orchestrator does not load knowledge or pass `KNOWLEDGE_CONTEXT` to these agents. The `apply-knowledge` skill explicitly handles this (Skip Guard, line 86: "When `KNOWLEDGE_CONTEXT` is empty, `(none)`, or not provided: skip this skill entirely"), so this is graceful degradation rather than a bug. But the CHANGELOG entry says the index pattern was added "across all four knowledge-consuming commands": `/resolve`, `/plan`, `/self-review`, `/code-review`. Implement is intentionally out of scope per the plan, which the prompt confirmed. Recording for visibility — the agents are wired but the orchestration is not, by design. Worth a one-line comment in `implement:orch/SKILL.md` noting the deliberate omission so future maintainers don't think it's a bug.

- **Pruned hallucination-guard assertion no longer asserts in resolver.md test** — `tests/resolve/knowledge-citation.test.ts` (Confidence: 70%) — The pre-PR resolver.md test asserted that the Apply Knowledge section contained `verbatim|do not fabricate|fabricat`. That assertion was removed. Coverage migrated to `tests/knowledge/apply-knowledge-skill.test.ts:68-71` which asserts on the SKILL.md, not on resolver.md. The resolver.md text DOES still contain "verbatim" + "do not fabricate" (verified at `shared/agents/resolver.md:81`), so behavior is correct today, but the resolver-specific guard test is now indirect (relies on resolver.md following apply-knowledge skill, which is asserted only structurally). If resolver.md is edited to drop the verbatim language, no test will catch it. Acceptable trade-off given the consolidation, but worth noting.

---

## Detailed Verification of Orchestrator-Specified Concerns

### Concern 1: `loadKnowledgeContext` still exported?

**Status: PASS.** Module exports at `scripts/hooks/lib/knowledge-context.cjs:367` include both old and new symbols:
```javascript
module.exports = { filterKnowledgeContext, loadKnowledgeContext, loadKnowledgeIndex, extractIndexEntries };
```
`loadKnowledgeContext` signature unchanged: `(worktreePath, opts = {}) → string`. Behavior unchanged: returns `(none)` on absent/empty, returns concatenated filtered corpus otherwise. Tests at `tests/resolve/knowledge-citation.test.ts:135-211` exercise the production module directly and pass.

### Concern 2: CLI bare invocation `node knowledge-context.cjs <path>` still works?

**Status: PARTIAL.** Works for path-shaped arguments (absolute paths, paths with `.`, `~`, or `/`). Fails for bare relative path names with no slash (e.g., `node knowledge-context.cjs myworktree`). See Should-Fix MEDIUM #1 above. Test coverage at `tests/knowledge/index-generator.test.ts:215-228` only covers the path-shaped case.

### Concern 3: Deprecation notice semantics correct?

**Status: PASS.** Deprecation notice at line 332 emits to stderr, then full corpus to stdout, exit 0. Matches docstring contract (lines 22-23). Tested at `tests/knowledge/index-generator.test.ts:221-228`.

### Concern 4: KNOWLEDGE_CONTEXT semantic change — does any caller pass full corpus where index is now expected?

**Status: PASS.** Searched all `KNOWLEDGE_CONTEXT` references (25 files via Grep). Every production caller updated:

| Caller | Updated to use `knowledge-context.cjs index` |
|--------|----------------------------------------------|
| `plugins/devflow-resolve/commands/resolve.md` | YES (line 75) |
| `plugins/devflow-resolve/commands/resolve-teams.md` | YES (line 68) |
| `plugins/devflow-plan/commands/plan.md` | YES (line 78) |
| `plugins/devflow-plan/commands/plan-teams.md` | YES (line 78) |
| `plugins/devflow-self-review/commands/self-review.md` | YES (line 26) |
| `plugins/devflow-code-review/commands/code-review.md` | YES (line 97) |
| `plugins/devflow-code-review/commands/code-review-teams.md` | YES (line 90) |
| `shared/skills/{plan,resolve,review,debug}:orch/SKILL.md` | YES |

All four downstream consumer agents (resolver, designer, simplifier, scrutinizer, reviewer) declare `devflow:apply-knowledge` in frontmatter and have an Apply Knowledge section with the Skip Guard. Verified by `tests/knowledge/command-adoption.test.ts:71-89` (frontmatter check) and `tests/knowledge/apply-knowledge-skill.test.ts:105-110` (skip guard check).

`/implement` orchestration deliberately does not load knowledge per the prompt's stated design — confirmed: `shared/skills/implement:orch/SKILL.md` contains zero `KNOWLEDGE_CONTEXT`/`apply-knowledge`/`knowledge-context` references. Implement plugin's bundled scrutinizer.md and simplifier.md DO declare the input/skill, but receive `(none)` by default and short-circuit per the Skip Guard. See Suggestion #1 above.

### Concern 5: Pruned tests in `tests/resolve/knowledge-citation.test.ts` — coverage owned elsewhere?

**Status: PASS for most assertions, with one minor gap (Suggestion #2 above).**

Reviewed each pruned assertion:

| Pruned assertion | Coverage owner |
|------------------|----------------|
| `decisions.md` + `pitfalls.md` mentioned in Step 0d (resolve.md) | `tests/knowledge/command-adoption.test.ts:8-25` invokes `knowledge-context.cjs index` which subsumes the file references |
| Strip Deprecated/Superseded mentioned in markdown | `tests/resolve/knowledge-citation.test.ts:70-129` (filterKnowledgeContext unit tests) — algorithm now lives in production module, test source-of-truth shifted |
| Same for resolve-teams.md and resolve:orch | Same as above |
| Inline regex extractSection helper duplicated 5× | Refactored into `extractSection` helper (lines 51-64) — net code reduction without coverage loss |
| `applies ADR-NNN` / `avoids PF-NNN` in resolver.md Apply Knowledge | Migrated to `tests/knowledge/apply-knowledge-skill.test.ts:89-99` (asserts on SKILL.md). Resolver.md inherits via reference — the substring still exists in resolver.md (`shared/agents/resolver.md:81`) but is no longer asserted directly |
| Hallucination guard `verbatim|fabricat` in resolver.md | Migrated to `tests/knowledge/apply-knowledge-skill.test.ts:68-71` (asserts on SKILL.md). Resolver.md still contains "verbatim" + "do not fabricate" but is no longer asserted directly. See Suggestion #2. |

### Concern 6: `reviewer.md` CITATION-SENTENCE marker — coder.md byte-identity test still guards?

**Status: PASS for coder.md, intentional divergence for reviewer.md.**

`tests/skill-references.test.ts:1033-1037` still asserts coder.md byte-identity against `shared/skills/knowledge-persistence/SKILL.md`. This is unchanged. The reviewer.md byte-identity assertion was relaxed to a structural substring check at lines 1039-1048 with an inline comment explaining the divergence. See Should-Fix MEDIUM #2 for the durability concern.

### Concern 7: Removed exports, renamed functions, signature changes?

**Status: ONE rename, fully migrated.**

- `purgeAllPreV2Knowledge` → `purgeAllPreV2KnowledgeEntries` (`src/cli/utils/legacy-knowledge-purge.ts:245`). Caller at `src/cli/utils/migrations.ts:126-127` updated. Test file `tests/legacy-knowledge-purge.test.ts` updated (12 references). No external callers — function is internal to the migrations subsystem. Verified via Grep: zero stale references to old name anywhere in repo.
- `purgeLegacyKnowledgeEntries` signature unchanged (verified at `src/cli/utils/legacy-knowledge-purge.ts:181-220`).
- `withKnowledgeFiles` is a new internal helper, no external surface.
- No CLI options removed. `devflow learn --enable/--disable/--status/--purge/--review/--reset/--configure` all preserved.

---

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 0 | - |
| Should Fix | - | 0 | 2 | - |
| Pre-existing | - | - | 0 | 0 |

**Regression Score**: 8.5/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The PR successfully migrates the KNOWLEDGE_CONTEXT semantics from full corpus to compact index across all four declared consumer commands, with the `loadKnowledgeContext` and `loadKnowledgeIndex` exports both available, the legacy bare-CLI invocation preserved with deprecation notice, and the legacy export rename (`purgeAllPreV2Knowledge` → `purgeAllPreV2KnowledgeEntries`) fully cascaded to its single internal caller and tests. Pruned test coverage is largely re-owned by the new `tests/knowledge/` test files, with two minor coverage-shape concerns documented in Should-Fix above (CLI bare-name path edge case + reviewer.md citation drift risk). No breaking change is unguarded; the two MEDIUM findings are durability/edge-case concerns rather than active regressions, and either can be addressed in a follow-up without reverting this PR.
