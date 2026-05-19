# Regression Review Report

**Branch**: fix/v2-knowledge-ship-blockers -> main
**Date**: 2026-04-14_1806
**Diff**: `git diff main...HEAD` (9 commits, 14 files, +1277/-14)

## Scope

Three ship-blocker fixes layered onto existing v2.0.0 systems:
- **Fix 1**: `/resolve` reads and cites `.memory/knowledge/` files (Resolver agent + command + orchestration skill)
- **Fix 2**: `reconcile-manifest` self-heals render-ready crash-window duplicates (json-helper.cjs)
- **Fix 3**: v3 migration widens legacy purge to all pre-v2 seeded entries (migrations.ts + legacy-knowledge-purge.ts)

Files in diff: `scripts/hooks/json-helper.cjs`, `src/cli/utils/legacy-knowledge-purge.ts`, `src/cli/utils/migrations.ts`, `shared/agents/resolver.md`, `shared/skills/resolve:orch/SKILL.md`, `plugins/devflow-resolve/commands/resolve.md`, `plugins/devflow-resolve/commands/resolve-teams.md`, `CLAUDE.md`, `CHANGELOG.md`, `docs/self-learning.md`, plus test additions.

## Known Pitfall Check (`.memory/knowledge/pitfalls.md`)

- **PF-007** (Run-once migrations scheduled after the installer silently skip already-installed state): v3 migration is appended as a new entry with a new ID (`purge-legacy-knowledge-v3`). Registry gates execution on `applied.has(id)`, so the new entry runs for already-installed projects on next `devflow init`. **Not reintroduced.**
- **PF-008** (Command refactors drift between `.md` base and `-teams.md` paired variant): `resolve.md` and `resolve-teams.md` both received the same `Step 0d: Load Project Knowledge` insertion, both pass `KNOWLEDGE_CONTEXT` to Resolvers in Phase 4, and both append the `## Knowledge Citations` section to the resolution-summary template. **No drift.**
- **PF-004** (Background hook god script): `json-helper.cjs` grew by ~87 lines (one new helper + one additive block). Pre-existing accumulation, unchanged shape. Not regressed but not improved either.

---

## Issues in Your Changes (BLOCKING)

### CRITICAL

None.

### HIGH

None.

---

## Issues in Code You Touched (Should Fix)

### MEDIUM

**CHANGELOG placement under 2.0.0 section for unreleased fixes** — `CHANGELOG.md:39-41`
**Confidence**: 85%
- Problem: Three entries for the PR's features (`/resolve` knowledge integration, reconciler self-heal, v3 migration) were appended to `## [2.0.0] - 2026-04-05`, a dated-release section. At review time the branch is named `fix/v2-knowledge-ship-blockers` and the commits are from today (2026-04-14), nine days after the dated 2.0.0 release. The `## [Unreleased]` section sits above and is the correct home for post-release fixes per Keep a Changelog conventions.
- Why this matters for regression: a consumer scanning "what's in 2.0.0" will see features that were not in the 2.0.0 tag/cut. No runtime break, but the documented history becomes incorrect retroactively.
- Fix: Move lines 39–41 into `## [Unreleased]` under an `### Added` sub-section, or cut a new `## [2.0.1]` / `## [2.1.0]` section with today's date and move them there.

---

## Pre-existing Issues (Not Blocking)

### LOW

**Heal-block contentHash drift vs render-ready** — `scripts/hooks/json-helper.cjs:1515` vs `scripts/hooks/json-helper.cjs:1362`
**Confidence**: 90%
- Problem: `render-ready` writes `contentHash(entry)` where `entry` is the raw appended entry string (leading `\n`, trailing blank line). The new heal block at line 1515 writes `contentHash(section[1])` where `section[1]` is extracted via the read-back regex `(##\\s+${safeAnchorId}[\\s\\S]*?)(?=\\n##\\s+(?:ADR|PF)-|\\s*$)`. The regex captures from `##` (no leading `\n`) and stops before the next heading or EOF — different byte range than `entry`.
- Impact: No functional regression. The follow-on reconcile pass at line 1463-1466 uses the same `sectionRe` the heal used, so the persisted hash matches what reconcile will re-compute. A healed entry will pass `currentHash === entry.contentHash` on the next session's reconcile — it will NOT trigger a spurious `edits++`. This is actually better than the render-ready write path, which does trigger an `edits++` on the first post-write reconcile (pre-existing, silent per D13).
- Not blocking: the diverging hash-byte-range is already accepted elsewhere in this file. Documenting for awareness.

---

## Suggestions (Lower Confidence)

- **Heal block writes manifest entry but `renderedAt` is the heal time, not the original render time** — `scripts/hooks/json-helper.cjs:1516` (Confidence: 65%) — The heal reconstructs a manifest entry with `renderedAt: new Date().toISOString()`. If the observation was created 30 minutes ago and the reconcile runs at session-start now, `renderedAt` will be the session-start time rather than the crash-window-write time. Consumers using `renderedAt` for "how long ago was this rendered" analytics would see healed entries as "fresh" even when they were rendered earlier. No downstream consumer currently reads `renderedAt` in this codebase — noted for future analytics work.
- **v3 migration doesn't short-circuit when file has zero non-self-learning sections** — `src/cli/utils/legacy-knowledge-purge.ts:247-269` (Confidence: 70%) — The `content.replace(SECTION_REGEX, ...)` walks every section in the file; on a project where all entries already carry the `self-learning:` marker, this is still O(file size) work per project. At the default project concurrency of 16 with the file lock serialising, a machine with 50 projects completes the no-op sweep quickly (≤60ms total observed in tests). Fine for now; revisit if project fleet grows to 500+.

---

## Regression Checklist

| Check | Result |
|-------|--------|
| No exports removed without deprecation | PASS — `purgeLegacyKnowledgeEntries` kept; `purgeAllPreV2Knowledge` added |
| Return types backward compatible | PASS — `reconcile-manifest` JSON widened additively (`healed` field); no caller reads the shape strictly |
| Default values unchanged | PASS — no defaults altered |
| Side effects preserved | PASS — v2 migration still runs, still purges the 4 hardcoded IDs and `PROJECT-PATTERNS.md`; new v3 is additive |
| All consumers of changed code updated | PASS — all 3 Resolver spawn sites (`resolve.md`, `resolve-teams.md`, `resolve:orch`) updated to pass `KNOWLEDGE_CONTEXT`; `KNOWLEDGE_CONTEXT` declared optional in resolver.md |
| Migration complete across codebase | PASS — `resolver.md` responsibilities list renumbered internally (step 3 inserted; 3→4, 4→5, 5→6, 6→7); no external caller references these numbers (verified via grep for "Resolver.*step" and "responsibility [0-9]") |
| CLI options preserved | PASS — no CLI options removed or changed |
| Commit message matches implementation | PASS — 9 commits follow conventional format; each commit's code changes match its stated intent |
| Breaking changes documented in CHANGELOG | PARTIAL — entries are present but placed under `## [2.0.0]` rather than `## [Unreleased]` (see Should Fix section) |

---

## Regression Concerns from Prompt — Resolved

| Concern | Result |
|---------|--------|
| Removed exports, changed signatures, or altered existing behaviors? | **No.** `purgeLegacyKnowledgeEntries` (v2) is unchanged. `purgeAllPreV2Knowledge` (v3) is net-new. `findUnmanagedAnchors` is a new internal helper in a CJS file (no exports added to `module.exports`). Reconcile-manifest JSON is widened additively. |
| Phase renumbering in resolver.md — any callers broken? | **No callers broken.** The renumbering is confined to the Resolver agent's internal "Responsibilities" list (prose numbering). Grep for `Resolver.*step [0-9]`, `resolver.*step [0-9]`, and `responsibility [0-9]` across `shared/` and `plugins/` finds no external reference. Critically, **resolve.md and resolve-teams.md Phases 1-8 were NOT renumbered** — only a new `Step 0d` was inserted; and `resolve:orch` SKILL inserted `Phase 1.5` without renumbering. |
| Reconcile output JSON shape change (additive `healed` field) — all callers safe? | **Safe.** The sole non-test caller is `scripts/hooks/session-start-memory:108`, which invokes via `node "$_JSON_HELPER" reconcile-manifest "$CWD" 2>/dev/null \|\| true` — stdout/stderr discarded. Tests use `.field` access (no strict-equality assertions on the object shape). Verified 71 tests pass. |
| Order of v2/v3 migration execution — does v2 need to run before v3? | **Order is v2-then-v3 (registry order), but correctness does NOT depend on ordering.** Both are idempotent: v2 targets a hardcoded 4-ID allow-list; v3 targets "any section lacking the `- **Source**: self-learning:` marker" (which is a superset of v2's targets when both run, or equivalent to the entire pre-v2 seed set when only v3 runs). Both acquire/release the same `.memory/.knowledge.lock` inside a `try/finally`, so they cannot deadlock. If v3 runs first on a machine where v2 never ran, v3 still removes all 10 pre-v2 entries because it uses the format discriminator, not the hardcoded list. If v2 runs first, v3 removes the remaining 6 entries lacking the self-learning marker. |
| Breaking change for projects without `.memory/knowledge/` dir when reconcile runs? | **No.** Three layers of defense: (1) reconcile-manifest early-returns via `if (!fs.existsSync(manifestPath) \|\| !fs.existsSync(logFile))` at line 1401 — the heal block is unreachable when there's nothing to reconcile. (2) `findUnmanagedAnchors` guards each knowledge file with `if (!fs.existsSync(file)) continue;` at line 244. (3) `purgeAllPreV2Knowledge` early-returns via `fs.access(knowledgeDir)` try/catch at line 217. Fresh installs emit `{deletions:0, edits:0, unchanged:0, healed:0}` and exit cleanly. |

---

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 0 | - |
| Should Fix | - | 0 | 1 | - |
| Pre-existing | - | - | 0 | 1 |

**Regression Score**: 9/10
**Recommendation**: APPROVED

The three fixes are implemented with clean additive semantics: a new reconcile output field, a new migration ID in the registry, a new optional agent parameter, and an inserted phase step in command documentation. No existing exports, signatures, CLI options, or public output shapes were altered in a breaking way. The 71 tests across reconcile / legacy-purge / migrations all pass.

The one Should-Fix item is a documentation-placement nit in CHANGELOG.md — purely informational, no runtime impact.
