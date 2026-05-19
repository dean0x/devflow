# Documentation Review Report

**Branch**: feat/177-revisit-project-knowledge-system---analy -> main
**Date**: 2026-04-13_2208
**Mode**: Incremental (10 commits across 0dd9e24...HEAD)
**Scope**: Documentation drift, cross-reference integrity, stale flag mentions, contradictions between files

## Review Methodology

Applied the 6-step `devflow:review-methodology` process using `devflow:documentation` pattern skill. Verified each checkpoint from the PR prompt:

1. CLAUDE.md migrations subsection + D37 + procedural count + stale flag mentions
2. docs/self-learning.md promotion-rule + reconciler claim
3. docs/reference/skills-architecture.md Format-Spec recategorization
4. plugins/devflow-implement/README.md skill count (6→5)
5. 4 teams-variant commands — phase removal + renumbering + architecture diagrams
6. plugins/devflow-resolve/commands/resolve.md Phase 9→8
7. JSDoc D-tags D30-D37 present at all intended sites in migrations.ts + legacy-knowledge-purge.ts

Known pitfalls cross-check: PF-008 (base/teams drift) is the most relevant to this diff; all 4 teams-variant changes correctly mirror base-variant D8 removals.

---

## Issues in Your Changes (BLOCKING)

### HIGH

**D-tag collision: D35 used for two unrelated decisions** — Confidence: 95%
- `src/cli/utils/migrations.ts:282`
- `src/cli/utils/legacy-knowledge-purge.ts:45`
- Problem: `D35` appears in two files documenting **different** design decisions:
  - `migrations.ts:282` — "Per-project migrations run across all discovered projects with a concurrency cap of 16…"
  - `legacy-knowledge-purge.ts:45` — "Uses `{ flag: 'wx' }` (O_EXCL | O_WRONLY) so the kernel rejects the open if the path already exists — TOCTOU fix"
  - These are two distinct architectural choices, but they share a single D-tag. Per user feedback memory "design-decisions-jsdoc" — D-series comments must be at code sites and serve as authoritative identifiers. Collisions defeat the scheme: a reader searching `D35` finds two different decisions, and future references (e.g., in commit messages, commentary, or an ADR rollup) become ambiguous.
  - Cross-reference impact: `src/cli/commands/init.ts:762` comment `// D32/D35: Apply one-time migrations…` reads cleanly against the migrations.ts definition of D35 (concurrency cap), but a reader following the tag into legacy-knowledge-purge.ts will find an unrelated TOCTOU decision also labelled D35. This is the kind of silent drift the tag system is meant to prevent.
- Fix: Rebase one of the two to a fresh tag. Recommend keeping `migrations.ts:282` as D35 (it is referenced externally by init.ts and by the test file `tests/init-logic.test.ts:857`) and renumbering the `legacy-knowledge-purge.ts:45` comment to D39 (next unused tag), updating its JSDoc intro to reflect the new tag, then updating any grep results in the test file if needed. Alternative: pick separate unused values (D39, D40) for both if neither has widespread external references; the goal is a 1:1 tag→decision mapping.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**knowledge-persistence SKILL frontmatter description contradicts D9 body comment** — Confidence: 85%
- `shared/skills/knowledge-persistence/SKILL.md:3-6`
- Problem: The frontmatter description states: "Format specification for on-disk knowledge files (.memory/knowledge/decisions.md and pitfalls.md). **Used by commands that read knowledge for context.** Writing is performed exclusively by the background extractor." However, the D9 HTML comment block below (lines 12-20) states: "It is NOT invoked by commands." and the skill is explicitly recategorized as a Format-Spec Skill in `docs/reference/skills-architecture.md:71` — "on-disk format specifications consumed by background processes, **not by agents or commands**."
  - A grep over `plugins/` for `knowledge-persistence/SKILL` returns zero matches — no command actually reads this skill for context. The description is aspirational at best, incorrect at worst.
  - This file was not modified in the 10-commit range, so strictly this is pre-existing. Flagging as Should-Fix because the skills-architecture.md Format-Spec section (which WAS modified in this diff, at line 71) introduces a claim that directly contradicts this description. The PR creates the contradiction by renaming the skill's category while leaving the frontmatter stale.
- Fix: Update the description in `shared/skills/knowledge-persistence/SKILL.md` to match the new Format-Spec categorization, e.g.: "Format specification for on-disk knowledge files — reference material only. Not invoked by commands or agents; writing is performed exclusively by the background extractor."

**CLAUDE.md Self-Learning paragraph is missing `--dismiss-capacity` CLI flag** — Confidence: 82%
- `CLAUDE.md:45`
- Problem: The Self-Learning paragraph enumerates CLI flags ("Use `devflow learn --reset`…", "Use `devflow learn --purge`…", "Use `devflow learn --review`…") but does NOT mention `devflow learn --dismiss-capacity`, which was added in commit 53bc0f4 (before this incremental range but still present on the branch). The flag is visible in `src/cli/commands/learn.ts:528` and is a first-class user-facing feature per commit message `feat(learning): extend --review with capacity mode and add --dismiss-capacity (D23, D28)`.
  - This is pre-existing drift (commit 53bc0f4 was outside 0dd9e24...HEAD) but the Self-Learning paragraph was explicitly touched in this incremental range (commit 8435914 "docs: fix documentation accuracy for self-learning thresholds and reconciler") — the author rewrote the paragraph's threshold claim while leaving the flag list incomplete. Since the touching author is "in the same function" on this paragraph, per review-methodology category 2, this should be fixed while here.
- Fix: After "Use `devflow learn --review` to inspect observations needing attention.", add: "Use `devflow learn --dismiss-capacity` to dismiss the current capacity notification for a knowledge file."

## Pre-existing Issues (Not Blocking)

### MEDIUM

**docs/cli-reference.md learn section is missing `--reset`, `--review`, `--dismiss-capacity`** — Confidence: 90%
- `docs/cli-reference.md:73-81`
- Problem: Lists only `--enable`, `--disable`, `--status`, `--list`, `--configure`, `--clear`, `--purge` — missing three flags that are documented in CLAUDE.md and docs/self-learning.md. Not touched in this incremental diff.
- Fix (not blocking): Separate cleanup PR. Add the three missing flags with parity descriptions from docs/self-learning.md:87-98.

**docs/self-learning.md CLI section is missing `--reset` and `--dismiss-capacity`** — Confidence: 85%
- `docs/self-learning.md:89-98`
- Problem: Lists `--clear` and `--purge` but not `--reset` (distinct from `--clear` per learn.ts:524-525 — `--clear` resets log only, `--reset` removes artifacts + log + state). Also missing `--dismiss-capacity`. The "Files" table at lines 109-123 already references the capacity-mode notifier file, so the CLI command to dismiss it should be present.
- Fix (not blocking): Separate cleanup PR. Add both flags with descriptions matching the help text in learn.ts.

## Suggestions (Lower Confidence)

- **CLAUDE.md "reinforced locally" phrasing is ambiguous** - `CLAUDE.md:45` (Confidence: 65%) — The phrase "Loaded artifacts are reinforced locally (no LLM) on each session end" is technically correct (the session-end-learning hook updates `last_seen` timestamps for matched slugs per scripts/hooks/session-end-learning:91-134) but "reinforced" suggests confidence boosting, which does not happen. Consider "Loaded artifacts have their `last_seen` refreshed locally (no LLM) on each session end" for precision. Lower confidence because "reinforced" is an industry term with some latitude.

- **Format-Spec Skills section could note it is NOT installed anywhere** - `docs/reference/skills-architecture.md:69-73` (Confidence: 60%) — The section says "not distributed to any plugin" which is accurate. Reader may wonder whether the skill is installed at the user level via `buildFullSkillsMap` (it is not — `src/cli/plugins.ts:495` iterates only plugin-declared skills). One sentence clarifying "The file lives only in the repo's `shared/skills/` and is not copied to `~/.claude/skills/`" would close the comprehension loop for users tracing install paths.

- **Documentation "contradiction" in `docs/self-learning.md` threshold paragraph** - `docs/self-learning.md:43-45` (Confidence: 70%) — The revised promotion rule "An observation promotes to `ready` when: `quality_ok === true` AND `confidence >= promote` AND `daySpread >= spread`" matches `scripts/hooks/json-helper.cjs:101-104` THRESHOLDS. However, the explanatory follow-up says "For workflow (promote=0.60, required=3) this means promotion at count=2 (0.66 ≥ 0.60)". That arithmetic is `floor(2*100/3)=66` → `0.66 ≥ 0.60` ✓. For procedural: `floor(3*100/4)=75` → `0.75 ≥ 0.70` ✓. Numbers check out. Minor: the intermediate formula `min(floor(count × 100 / required), 95) / 100` is stated once (line 45); the preceding paragraph at line 27 also has the same formula with identical wording. Consider consolidating to avoid the duplication drifting later.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 0 | - |
| Should Fix | - | 0 | 2 | - |
| Pre-existing | - | - | 2 | 0 |

**Documentation Score**: 8/10
**Recommendation**: CHANGES_REQUESTED

### Rationale

The PR delivers a substantial and well-executed documentation pass. Every D8-related code change has a matching documentation update: the 4 teams-variant commands correctly remove Record Pitfalls/Decisions phases with explanatory tombstones, renumber remaining phases, and update architecture diagrams to match; resolve.md Phase 9→8 is consistent throughout including the "Output Artifact" paragraph; the implement README skill count drops from 6 to 5 matching the actual plugin manifest; the skills-architecture.md Format-Spec Skills section is a genuinely useful new categorization; and docs/self-learning.md accurately restates the promotion rule and reconciler "unchanged" behavior against the code. No stale `--purge-legacy-knowledge` flag references remain in user-facing docs.

The single HIGH issue is a real documentation-at-code-site bug (D35 tag collision between two files) that will mislead future readers walking the tag scheme, per user feedback memory. The two MEDIUM Should-Fix items are a contradiction introduced by re-categorizing the knowledge-persistence skill while leaving its frontmatter stale, and a CLI flag left out of the Self-Learning paragraph that the author did rewrite in this range. None of these are catastrophic, all are straightforward to fix. Recommendation is CHANGES_REQUESTED rather than APPROVED_WITH_CONDITIONS because the D-tag collision is both factual (not stylistic) and sits at a load-bearing code site where a reader following "D35" could reasonably conclude the wrong decision applied.
