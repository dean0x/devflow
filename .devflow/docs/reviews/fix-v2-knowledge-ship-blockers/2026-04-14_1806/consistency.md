# Consistency Review Report

**Branch**: fix/v2-knowledge-ship-blockers -> main
**Date**: 2026-04-14_1806
**PR**: #182
**Focus**: consistency

## Scope

The PR ships three fixes bundled as v2.0.0 ship-blockers. Reviewed against the Iron Law "match existing patterns or justify deviation," with explicit attention to:

1. Lockstep consistency across three resolve surfaces (resolve.md, resolve-teams.md, resolve:orch/SKILL.md) plus resolver agent
2. Naming symmetry between v2 and v3 legacy-knowledge purge helpers and migrations
3. Return-shape consistency inside the Migration registry
4. Intentional parallel structures noted in the PR description
5. Cross-surface use of `KNOWLEDGE_CONTEXT`

I verified PF-008 (teams-variant drift) — the PR correctly propagates changes across both command variants. I verified PF-003 / PF-001 are not reintroduced.

---

## Issues in Your Changes (BLOCKING)

### HIGH

**Return-shape style inconsistency between v2 and v3 migrations — `src/cli/utils/migrations.ts:100-107` vs `:125-134`**
**Confidence**: 95%
- Problem: All three existing registry entries — `MIGRATION_SHADOW_OVERRIDES` (:86-93), `MIGRATION_PURGE_LEGACY_KNOWLEDGE` v2 (:100-107), plus every other `infos`-producing migration on `main` — use a **named intermediate binding** before return:
  ```typescript
  const infos = result.removed > 0 ? [...] : [];
  return { infos, warnings: [] };
  ```
  The new `MIGRATION_PURGE_LEGACY_KNOWLEDGE_V3` (:125-134) breaks this pattern and inlines the ternary directly into the returned object literal:
  ```typescript
  return {
    infos: result.removed > 0 ? [...] : [],
    warnings: [],
  };
  ```
  The PR context notes that scrutinizer deemed V3 "cleaner" and queries whether V2 was left inconsistent. Per this codebase's Iron Law, consistency trumps personal preference — the question is whether v3 matches existing code, not whether it is locally nicer. Today there are three `Migration` entries and two styles (2:1 vote favoring the named binding). This is the exact moment to pick one style before a fourth entry is added and the precedent ambiguates.
- Impact: Medium-term maintenance — every new migration author has to decide which style to follow, drift compounds, grep patterns for adding infos logic get harder.
- Fix: Align v3 with the established pattern (applied to v3 since it is the new code):
  ```typescript
  run: async (ctx: PerProjectMigrationContext): Promise<MigrationRunResult> => {
    const { purgeAllPreV2Knowledge } = await import('./legacy-knowledge-purge.js');
    const result = await purgeAllPreV2Knowledge({ memoryDir: ctx.memoryDir });
    const infos = result.removed > 0
      ? [`Purged ${result.removed} pre-v2 knowledge entry(ies) in ${result.files.length} file(s)`]
      : [];
    return { infos, warnings: [] };
  },
  ```
  Alternatively: refactor all three entries to the inline style. The important output is **one style in the registry**. Scrutinizer's "cleaner" verdict is a valid local-preference opinion, but the codebase is already committed to the named-binding form.

### MEDIUM

**Asymmetric naming: `purgeLegacyKnowledgeEntries` vs `purgeAllPreV2Knowledge` — `src/cli/utils/legacy-knowledge-purge.ts:88` and `:207`**
**Confidence**: 85%
- Problem: The two sibling helpers in the same file expose the work they do through inconsistent noun phrases:
  - v2 function: `purgeLegacyKnowledgeEntries` (verb + adjective + noun + plural "Entries")
  - v3 function: `purgeAllPreV2Knowledge` (verb + quantifier + adjective + bare noun)
  They operate on the same substrate (ADR/PF sections in decisions.md/pitfalls.md), have the same signature (`{ memoryDir } → PurgeLegacyKnowledgeResult`), are used side-by-side in migrations.ts, and differ only in their filter criterion. The asymmetric naming obscures this sibling relationship. Reading the migrations.ts registry out of context, the two imports look like unrelated operations.

  Compare the CHANGELOG framing, which **is** symmetric: "v2 migration" / "v3 migration". The CHANGELOG names them as a pair; the code hides it.

  Note also: `PurgeLegacyKnowledgeResult` is shared between both functions, but v3 is not about "legacy" in the v2 sense (v2 = 4-ID allow-list, v3 = format-discriminator sweep of all seeded entries). The shared result type name is acceptable (it describes the shape, not the operation), but the function names should either both use "legacy" framing or both use "pre-v2" framing.
- Impact: Discoverability — a future engineer looking for "the other purge helper" via IDE symbol search has to know both names. Code review of migrations.ts requires mentally translating between the two vocabulary choices.
- Fix: Two options, either is acceptable; pick one and apply consistently:
  - **Option A (align v3 to v2's "Entries" suffix)**: rename `purgeAllPreV2Knowledge` → `purgeAllPreV2KnowledgeEntries`. Minimal churn, keeps v2 name stable, adds the missing "Entries" to v3.
  - **Option B (align both on "pre-v2" vocabulary)**: rename `purgeLegacyKnowledgeEntries` → `purgePreV2KnowledgeAllowlist` and `purgeAllPreV2Knowledge` → `purgePreV2KnowledgeSweep`. More churn but makes the "allowlist vs sweep" discriminator explicit in the names.
  I mildly prefer Option A for the smaller blast radius; if v2 is considered stable API, the "Entries" suffix on v3 is the cheapest fix. Document the decision: is the intended pairing `(legacy = v2 ID allow-list) vs (pre-v2 = v3 sweep)`, or are both just "pre-v2 purge, one narrow one broad"? Whichever wording the team picks, record it as a D-comment above both functions so the next migration author inherits the convention.

**Migration ID suffix convention is undocumented — `src/cli/utils/migrations.ts:97, :122`**
**Confidence**: 82%
- Problem: The v2→v3 version suffix introduces a new convention to the migration registry — but nothing in the code explains that ID-stability-plus-version-suffix is the expected evolution pattern. Readers have to infer it from two datapoints:
  - `purge-legacy-knowledge-v2` (v2's id suggests "version 2 of this migration", but v2 was actually the *first* version of this migration — the "v2" refers to devflow v2.0.0, not migration schema v2)
  - `purge-legacy-knowledge-v3` (similarly "v3" is devflow v3-era wider scope, not migration schema v3)

  Meanwhile `shadow-overrides-v2-names` uses "v2-names" (a compound discriminator) not "-v2" (a version). Three IDs, two different suffix meanings: `-v2` (migration-cycle version), `-v2-names` (semantic name-space tag). Without a documented rule, a future migration author has no guidance on whether a follow-up to shadow-overrides would be `shadow-overrides-v3-names` or `shadow-overrides-v3` or `shadow-overrides-rename-v2`.

  The JSDoc on `MIGRATION_PURGE_LEGACY_KNOWLEDGE_V3` (:110-120) explains v3's *function* ("widens v2 from 4 IDs to ALL seeded entries") but says nothing about *ID naming convention* for the next scope widening (would it be `-v4`?).
- Impact: Future migrations will invent new conventions; registry IDs become a Wild West of suffixes.
- Fix: Add a short comment block above the `MIGRATIONS` array (:137) documenting the suffix convention the team chose. Example:
  ```typescript
  /**
   * Migration ID naming convention:
   * - {action}-{target}[-{discriminator}]
   * - When the same action + target is revisited to widen scope, append -v{N} where N
   *   increments each revision. The `v` prefix refers to the migration revision, not
   *   the devflow release version. First pass on a new target does NOT take -v1 —
   *   that suffix is reserved for the 2nd+ revision.
   * - `shadow-overrides-v2-names` is historical: its `-v2-names` discriminator is a
   *   name-space tag (shadow-override directory names changed from v1 to v2), not a
   *   migration revision. Do not replicate this form for new migrations.
   */
  ```
  Without this, the next conflict (e.g., purge-legacy-knowledge-v4, or a new targeted sweep) will re-raise this ambiguity.

---

## Issues in Code You Touched (Should Fix)

### MEDIUM

**JSDoc class name on `PurgeLegacyKnowledgeResult` is semantically misleading for v3 — `src/cli/utils/legacy-knowledge-purge.ts:37`**
**Confidence**: 80%
- Problem: `PurgeLegacyKnowledgeResult` (`removed: number; files: string[]`) is returned by both functions. The type name embeds "Legacy" but v3 explicitly operates on a superset ("ALL pre-v2 seeded"). A reader of `purgeAllPreV2Knowledge`'s signature sees it returns `Promise<PurgeLegacyKnowledgeResult>` and may reasonably wonder whether only "legacy" (= v2 allow-list) entries are counted in `removed`. Tests confirm the count is inclusive of all removed sections, but the type name suggests otherwise.
- Impact: Minor — tests clarify behavior, but the type name fights the function name.
- Fix: Rename `PurgeLegacyKnowledgeResult` → `PurgeResult` or `PurgeKnowledgeResult` (shape-descriptive, not scope-descriptive). Single global search-and-replace in this file and its test.

**Phase 1.5 numbering break vs Step 0d is documented implicitly, not explicitly — `shared/skills/resolve:orch/SKILL.md:33`**
**Confidence**: 78%
- Problem: The PR context calls out this asymmetry: `resolve:orch` uses "Phase 1.5" for Load Project Knowledge while `resolve.md` and `resolve-teams.md` use "Step 0d". My read is that this asymmetry is **intentional and correct** — `resolve:orch` has no Phase 0 (the skill description says "Excluded: ... multi-worktree flow, CLI flags"), so there is no "Step 0" to add a sub-step to. Putting knowledge loading as "Phase 1.5" after "Phase 1: Target Review Directory" is the natural slot.

  That said, the intentional asymmetry is **not documented** in either surface. A maintainer comparing the three files for lockstep will correctly notice the different numbering and then have to reconstruct the reasoning from the skill description in line 11 ("lightweight variant of `/resolve` for ambient mode. Excluded: ... multi-worktree flow"). This is a knowledge trap — it looks like drift at a glance.
- Impact: Future "lockstep" audits will flag this false positive, or worse, "fix" it by renumbering.
- Fix: Add one-line comments on the three files clarifying the intentional divergence, OR add a note in the skill header explaining the Phase 1.5 slot. Suggested `resolve:orch/SKILL.md` addition near line 32:
  ```markdown
  ## Phase 1.5: Load Project Knowledge

  <!-- Numbered 1.5 (not 0d) because resolve:orch has no Phase 0 — multi-worktree
       flow is excluded per this skill's lightweight mandate. This content is the
       ambient-mode counterpart to Step 0d in resolve.md / resolve-teams.md. -->

  Read `.memory/knowledge/decisions.md` ...
  ```
  Or add a similar HTML comment in resolve.md Step 0d pointing the other direction. One note is sufficient; both is belt-and-braces.

---

## Pre-existing Issues (Not Blocking)

_None found within consistency scope._

The existing registry patterns (Migration struct, mkdir lock, atomic write delegation) are internally consistent. The Phase 4 `KNOWLEDGE_CONTEXT` variable is consistently named and capitalized across all four surfaces verified:

- `resolve.md:123` — `KNOWLEDGE_CONTEXT: {filtered decisions.md + pitfalls.md content, or (none)}`
- `resolve-teams.md:123` — `KNOWLEDGE_CONTEXT: {filtered decisions.md + pitfalls.md content, or (none)}`
- `resolve:orch/SKILL.md:64` — `- **KNOWLEDGE_CONTEXT**: Filtered content from Phase 1.5 (or ` + "`" + `(none)` + "`" + `)`
- `resolver.md:18` — `- **KNOWLEDGE_CONTEXT** (optional): Filtered content from ...`

The Step 0d paragraph text is **byte-identical** between resolve.md and resolve-teams.md (verified via diff; zero bytes of drift). Resolver agent's "Apply Knowledge" section (:79-81) and "Input Context" (:18) use the same `KNOWLEDGE_CONTEXT` name/casing as all orchestration surfaces. This is the intentional lockstep working as designed.

---

## Suggestions (Lower Confidence)

- **Message text drift in migration infos** - `src/cli/utils/migrations.ts:104, :130` (Confidence: 70%) — v2 says `"Purged ${n} legacy knowledge entry(ies)"`, v3 says `"Purged ${n} pre-v2 knowledge entry(ies)"`. Since v2's scope is a strict subset of v3's ("legacy = 4 allow-listed IDs" ⊂ "pre-v2 = all seeded"), the two messages will appear on the same `devflow init` run on an upgraded project. Consider unifying the wording — e.g., both say "pre-v2" and disambiguate via "(v2 allow-list)" / "(v3 sweep)" — to avoid user confusion.
- **`DESIGN: D-D` anchor convention** - `scripts/hooks/json-helper.cjs:1495` (Confidence: 65%) — The new heal block uses `D-D` as its design-decision anchor, but the rest of the file (and the project's D-series convention per user CLAUDE.md) uses numbered anchors like `D30`, `D31`, etc. The D-Fix3 / D2026-04-14-A style is also in use elsewhere in this PR (resolve tests). Three anchor styles in one PR is a noise ceiling. Consider picking the numbered form for new anchors.
- **`filePrefixPairs` variable is duplicated verbatim between v2 and v3** - `src/cli/utils/legacy-knowledge-purge.ts:113-116, :232-235` (Confidence: 60%) — The two functions share identical `[decisionsPath, 'ADR'], [pitfallsPath, 'PF']` construction; same lock acquisition block; same TL;DR update regex. Extracting a shared helper (`withKnowledgeLock(memoryDir, fn)`) could reduce the duplication. However, the functions have different per-section logic (allow-list filter vs marker-based filter), and the PR context explicitly notes that "v3 intentionally parallels v2 migration structure" — so this is a deliberate design choice, not a refactor oversight. Noting for future consideration if a v4 migration arrives.

---

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 2 | 0 |
| Should Fix | - | 0 | 2 | 0 |
| Pre-existing | - | - | 0 | 0 |

**Consistency Score**: 8/10

The PR demonstrates excellent cross-surface discipline on the load-bearing parts:
- The three resolve surfaces' shared content is byte-identical where it should be.
- `KNOWLEDGE_CONTEXT` naming is uniform across all four touchpoints.
- PF-008 (teams-variant drift) is correctly avoided.
- v3 migration intentionally parallels v2 structure as documented.

Blocking issues are smaller-scale code-local inconsistencies, not surface-level drift:
- **Return-shape style** breaks a 3/3 existing pattern with no justification.
- **Naming asymmetry** (`purgeLegacyKnowledgeEntries` vs `purgeAllPreV2Knowledge`) obscures the sibling relationship.
- **Migration ID suffix convention** is inherited from an ambiguous precedent without documentation.

**Recommendation**: `CHANGES_REQUESTED`

Fix the return-shape inconsistency (HIGH) and add documentation for the migration ID convention (MEDIUM). The naming asymmetry is debatable — if the team prefers keeping `purgeLegacyKnowledgeEntries`'s historical name stable, rename v3 to `purgeAllPreV2KnowledgeEntries` (minimum-churn Option A). None of these block semantic correctness; they block future maintainers from the same author's consistency baseline.
