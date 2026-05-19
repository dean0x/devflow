# Documentation Review Report

**Branch**: fix/v2-knowledge-ship-blockers -> main
**Date**: 2026-04-14_1806
**Focus**: Documentation drift, accuracy, staleness, completeness

## Issues in Your Changes (BLOCKING)

### CRITICAL

_None._

### HIGH

**CHANGELOG categorization violates Keep-a-Changelog convention** — `CHANGELOG.md:39-41`
**Confidence**: 92%
- Problem: The three new bullets were added under `## [2.0.0] - 2026-04-05` → `### Added`, but:
  1. The `[2.0.0]` section is already released (dated 2026-04-05); Keep-a-Changelog treats released versions as immutable. Modifying a released section mutates history a reader already relied on.
  2. All three bullets describe **fixes to ship-blocker regressions in 2.0.0** (the branch itself is named `fix/v2-knowledge-ship-blockers` and two of three commits are `feat: … (Fix 2)` / `feat: … (Fix 3)`). The appropriate category is `### Fixed`, not `### Added`. The `/resolve` knowledge integration (Fix 1) is borderline "added" because the integration itself is new, but Fix 2 (reconciler self-heal) and Fix 3 (v3 purge migration) are recoveries from bugs in 2.0.0 that shipped without them — they are fixes by the project's own framing.
- Fix: Move all three bullets to `## [Unreleased]` — either split across `### Added` (Fix 1 — net-new feature) and `### Fixed` (Fix 2, Fix 3 — regressions from 2.0.0 shipping without them), OR bump a new patch/minor version heading (`## [2.0.1] - YYYY-MM-DD` or `[2.1.0]`) and place entries there. Pick whichever matches release cadence, but do not edit the sealed 2.0.0 entry.
- Note: the `[Unreleased]` section at lines 8–28 is already populated with _other_ learning entries, which suggests the project IS using `[Unreleased]` as the working section — making the placement under `[2.0.0]` inconsistent with the project's own active pattern in the same file.

**Missing scrutiny-pass commit in CHANGELOG** — `CHANGELOG.md:39-41`
**Confidence**: 85%
- Problem: Commit `bd1c92f` ("fix: scrutiny issues from 9-pillar review on v2.0.0 ship-blockers") introduced a **behavioral change** in `findUnmanagedAnchors`: it now requires sections to contain `- **Source**: self-learning:` before they qualify as heal candidates. The commit message states: _"a current ready obs whose pattern normalises to an old seed heading could be falsely paired with the seeded anchor ID. The v3 migration would later delete that seeded entry, leaving the manifest pointing at a missing anchor and deprecating the obs unfairly."_ That is a correctness-affecting change — not cosmetic. The CHANGELOG bullet for "Self-learning reconciler self-heal" (line 40) does not mention the marker requirement. A reader trusting the CHANGELOG would not know that heal is restricted to marker-bearing sections.
- Fix: Either (a) expand the line-40 bullet to mention the marker check, e.g., `"Only sections containing the '- **Source**: self-learning:' marker qualify — pre-v2 seeded entries are excluded to prevent false pairing with ready observations when v3 later deletes them."`, or (b) add a separate `### Fixed` bullet under Unreleased describing the scrutiny-time hardening.

### MEDIUM

**`### Added` entries describe fixes, not additions** — `CHANGELOG.md:40-41`
**Confidence**: 82%
- Problem: Bullets for Fix 2 and Fix 3 describe recovery mechanisms for render-ready crash windows and gaps in v2 purge coverage. Keep-a-Changelog taxonomy: `Added` is for new user-visible capabilities; `Fixed` is for bug fixes. The Fix 2 bullet reads "recovers from crash-window states" (recovery = fix). The Fix 3 bullet reads "catches entries the v2 migration missed" (missed = fix). Calling them `Added` understates the severity and misclassifies the change type.
- Fix: Move Fix 2 and Fix 3 bullets under a `### Fixed` subsection. Keep Fix 1 (the /resolve knowledge integration) under `### Added` since it is a new feature. See BLOCKING HIGH above for full restructuring.

**Scrutiny commit's resolver.md `(none)` guard clarification not documented** — `shared/agents/resolver.md:81`
**Confidence**: 80%
- Problem: Commit `bd1c92f` tightened the resolver's Apply Knowledge wording from "if KNOWLEDGE_CONTEXT is non-empty" to "If `KNOWLEDGE_CONTEXT` is non-empty and not the literal `(none)`". The commit message explains the rationale: _"Previous wording was strictly true for '(none)' as a string and could lead an LLM to scan a no-op marker."_ This is a **correctness** fix for LLM prompt behavior. The CHANGELOG entry for Fix 1 at line 39 mentions the hallucination guard ("verbatim-only, no inference") but does not mention the `(none)` literal guard — so the CHANGELOG is missing a documented robustness improvement.
- Fix: Append to the Fix 1 CHANGELOG bullet: `"The resolver guards against the literal string '(none)' — emitted when both knowledge files are absent or empty — so LLMs do not treat the placeholder as scannable content."` Or add as a separate `### Fixed` bullet if you go with the restructuring above.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Inconsistent phase-numbering scheme between `/resolve` variants** — `plugins/devflow-resolve/commands/resolve.md:70` / `plugins/devflow-resolve/commands/resolve-teams.md:63` / `shared/skills/resolve:orch/SKILL.md:33`
**Confidence**: 82%
- Problem: The same "Load Project Knowledge" logic is introduced with different phase labels across the three variants:
  - `resolve.md` / `resolve-teams.md`: labeled `#### Step 0d: Load Project Knowledge` (sub-step of Phase 0)
  - `resolve:orch/SKILL.md`: labeled `## Phase 1.5: Load Project Knowledge` (half-phase inserted between 1 and 2)
  Both orchestrate the same agent contract. Readers switching between files must translate between labeling conventions. "1.5" is also a non-integer phase number, which breaks the numeric phase sequence used everywhere else in the ambient `:orch` family.
- Fix: Unify on one scheme. Two reasonable options: (a) relabel `resolve:orch` to have a `Phase 1` knowledge-load step and renumber downstream phases, OR (b) accept the "half-step" pattern because `resolve:orch` intentionally omits Phase 0 (the doc says "Excluded: … multi-worktree flow") and keep as-is but add a note explaining the numbering gap. Whichever you choose, make the justification explicit in the SKILL's preamble.

### LOW

**Architecture diagram in `resolve.md` does not reflect Step 0d** — `plugins/devflow-resolve/commands/resolve.md:204-236` and the matching diagram in `resolve-teams.md:252-287`
**Confidence**: 85%
- Problem: The ASCII phase diagrams still list only `Step 0a`, `Step 0b`, `Step 0c` under Phase 0. Step 0d (Load Project Knowledge) is described in prose above but missing from both diagrams. A reader scanning the diagram to understand the pipeline will not see the new knowledge-loading step — the diagram lies about pipeline shape.
- Fix: Add a diagram row like `│  └─ Step 0d: Load knowledge (decisions.md + pitfalls.md) → KNOWLEDGE_CONTEXT` to both files. Also consider mentioning `KNOWLEDGE_CONTEXT` in the Resolver phase box (Phase 4) so the data flow is visible.

**`resolve:orch` feedback section's "Knowledge citations applied (if any)" bullet is redundant** — `shared/skills/resolve:orch/SKILL.md:82-89`
**Confidence**: 80%
- Problem: The section declares twice that citations are surfaced: once in the paragraph at line 82 ("The report includes a `## Knowledge Citations` section…") and again as the last item in the report-to-user list at line 89. Both say the same thing and neither adds detail the other lacks. Minor noise in an otherwise tight skill.
- Fix: Remove the bullet at line 89; the paragraph at 82 already covers it. Or, conversely, drop the paragraph and keep the bullet — whichever you prefer.

## Pre-existing Issues (Not Blocking)

_None of MEDIUM+ severity._ The CLAUDE.md Self-Learning paragraph was already dense before this PR; this PR made it denser but did not introduce new drift in pre-existing sentences.

## Suggestions (Lower Confidence)

- **CLAUDE.md Self-Learning paragraph is a single sentence of 400+ words** — `CLAUDE.md:45` (Confidence: 65%) — the self-heal description makes an already-hard-to-read paragraph harder. Consider splitting into two paragraphs: one for detection/merge/render (before this PR), one for feedback + self-heal (this PR's addition). Not new to this PR, but exacerbated.
- **`docs/self-learning.md` could link to the commit/issue for crash-window bug** — `docs/self-learning.md:87-99` (Confidence: 60%) — the Self-Heal subsection documents _what_ happens without the historical _why_. A one-line reference to the ship-blocker context (or a link) would give future readers the motivation behind this specific recovery path.
- **Migration IDs `-v2`/`-v3` suffix convention not explained anywhere user-facing** — `docs/self-learning.md:116-118` / `CLAUDE.md:51` (Confidence: 65%) — the version suffixes appear without commentary. A sentence like _"Migration IDs carry a version suffix so follow-up migrations can coexist with earlier ones in the state file"_ would clarify why there are two separate entries rather than a single updated one.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 2 | 2 | 0 |
| Should Fix | - | 0 | 1 | 2 |
| Pre-existing | - | - | 0 | 0 |

**Documentation Score**: 7/10

Accuracy is strong: the marker requirement, `healed` counter, Knowledge Citations flow, migration IDs (v2 and v3), and verbatim constraint are all reflected in prose. Inline JSDoc on `purgeAllPreV2Knowledge`, `MIGRATION_PURGE_LEGACY_KNOWLEDGE_V3`, and `findUnmanagedAnchors` is thorough. Staleness is low: no pre-existing content became inconsistent. The score is dragged down by CHANGELOG structure — the Keep-a-Changelog violation and the Added/Fixed categorization both merit correction before ship, and the CHANGELOG is the first artifact downstream consumers read.

**Recommendation**: CHANGES_REQUESTED

The two HIGH findings (CHANGELOG placement under sealed `[2.0.0]` section, and missing scrutiny-commit documentation) should be resolved before merge. They are not architectural — both are string edits in `CHANGELOG.md` — but they affect how this change is communicated to downstream users of the CHANGELOG. Everything else is MEDIUM/LOW and can be tidied in a follow-up.
