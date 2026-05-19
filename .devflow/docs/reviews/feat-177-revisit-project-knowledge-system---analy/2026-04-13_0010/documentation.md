# Documentation Review Report

**Branch**: feat/177-revisit-project-knowledge-system---analy -> main
**PR**: #181
**Date**: 2026-04-13_0010
**Focus**: Documentation accuracy, alignment, and comment quality

## Issues in Your Changes (BLOCKING)

### CRITICAL

**Teams-variant commands still instruct agents to use `knowledge-persistence` skill for writing, which is now impossible** — Confidence: 98%
- `plugins/devflow-code-review/commands/code-review-teams.md:265-269`
- `plugins/devflow-resolve/commands/resolve-teams.md:187-191`
- `plugins/devflow-debug/commands/debug-teams.md:197-201`
- `plugins/devflow-implement/commands/implement-teams.md:367-371`
- Problem: The base `.md` command files in this PR had their "Phase 5/6/10 Record Pitfalls/Decisions" sections removed (with D8 decision comments explaining why). The paired `-teams.md` variants still contain those phases and instruct agents to "Read `~/.claude/skills/devflow:knowledge-persistence/SKILL.md` and follow its extraction procedure to record pitfalls". Two concrete breakages:
  1. The skill's `allowed-tools` was narrowed from `Read, Write, Bash` to `Read, Grep, Glob` — the agent literally cannot write.
  2. The "Extraction Procedure" section was removed from the skill (it's now a format-spec-only document), so "follow its extraction procedure" has no target.
- Per `CLAUDE.md`: "Every `-teams.md` command variant **must** have a matching base `.md` file — the installer iterates base files and looks up teams variants." Users installing with `--teams` will execute phase instructions that silently no-op or error.
- Fix: Apply the same D8 removals to the four teams variants (remove the Phase section, update the Architecture tree, and renumber subsequent phases if any). Add the same D8 HTML comment block at the top.

**Plan and Debug plugin.json still declare `knowledge-persistence` dependency** — Confidence: 95%
- `plugins/devflow-plan/.claude-plugin/plugin.json:29`
- `plugins/devflow-debug/.claude-plugin/plugin.json:24` (present per grep; not removed in this PR)
- Problem: The PR removed `knowledge-persistence` from `code-review`, `implement`, and `resolve` plugin.json files, but left it in `plan` and `debug`. This is inconsistent with the v2 story: the skill is a format-spec-only document. Plugins that don't read/write knowledge should not depend on it.
- Also: `plugins/devflow-ambient/.claude-plugin/plugin.json:53` still declares it.
- Fix: Either remove the dependency from all four plugins (plan, debug, ambient) to match code-review/implement/resolve, or document why these three still need the skill available. If `skimmer.md` in plan loads knowledge for context, that's a legitimate dependency — but then the removal from code-review is inconsistent (code-review reviewers also load pitfalls for context). Pick one rule and apply uniformly.

**`shared/agents/skimmer.md` frontmatter still lists `devflow:knowledge-persistence`** — Confidence: 95%
- `shared/agents/skimmer.md:5` — `skills: devflow:knowledge-persistence, devflow:worktree-support`
- Problem: The skill is now a pure format spec. Skimmer uses it to *load* knowledge for context (valid read-only use), but the frontmatter declaration implies the skill provides procedures the agent follows. The skill no longer has an extraction procedure. If skimmer only reads knowledge files directly, drop the skill reference. If skimmer reads the format spec for entry parsing, keep it but document why.
- Fix: Audit skimmer's actual usage — if it's just reading `.memory/knowledge/*.md`, drop the frontmatter reference. If it needs the format spec for parsing ADR/PF entries, keep it and add a one-line JSDoc pointing at the reason.

### HIGH

**CLAUDE.md Self-Learning paragraph misstates procedural required count** — Confidence: 96%
- `CLAUDE.md:45`
- Problem: The Self-Learning paragraph says "Per-type thresholds govern promotion (workflow/procedural: 3 required; decision/pitfall: 2 required)". The actual `THRESHOLDS` in `scripts/hooks/json-helper.cjs:100-104` are `workflow: required=3, procedural: required=4, decision: required=2, pitfall: required=2`. `docs/self-learning.md` has the correct numbers (table at line 40-45). CLAUDE.md is the overview a developer reads first — it's wrong.
- Fix: Split the combined phrase: "(workflow: 3 required; procedural: 4 required; decision/pitfall: 2 required)".

**`docs/self-learning.md` promotion rule mis-describes the actual code check** — Confidence: 90%
- `docs/self-learning.md:47`
- Problem: The doc says "An observation promotes to `ready` when: `quality_ok === true` AND `observations >= required` AND `daySpread >= spread`." The actual check in `json-helper.cjs:862` is `confidence >= th.promote && quality_ok === true` plus a separate `spread >= th.spread`. Confidence is computed as `floor(count * 100 / required) / 100`, clamped to 0.95. With `promote: 0.60` and `required: 3`, a workflow can promote at **2 observations** (66% ≥ 60%), not 3. With `promote: 0.70` and `required: 4`, procedural promotes at **3 observations** (75% ≥ 70%), not 4. The stated rule overcounts the required observations.
- Fix: Either rewrite as "confidence ≥ promote threshold AND quality_ok === true AND daySpread ≥ spread", then show the confidence formula; or simplify the table with a new column "Promotes at" computed values (workflow: 2, procedural: 3, decision: 1, pitfall: 1).

**`docs/self-learning.md` reconciler line claims "observation reinforced" on unchanged file, but code does no reinforcement** — Confidence: 85%
- `docs/self-learning.md:81`
- Problem: The doc says "**File present and unchanged** → observation reinforced". The reconciler code at `json-helper.cjs:1406,1414` only increments an `unchanged` counter for telemetry — no confidence bump, no count increment, no timestamp update. Reinforcement actually happens on session-end via `merge-observation` when the same pattern is re-extracted. The reconciler only applies a 0.3× penalty on deletion (line 1374, 1389).
- Fix: Either remove that bullet entirely, or rewrite as "File present and unchanged → no change (penalty only applies on deletion)".

### MEDIUM

**D37 "edge case" documented in CLAUDE.md but missing as JSDoc at the code site** — Confidence: 88%
- `CLAUDE.md:51` mentions "D37 edge case: a project cloned *after* migrations have run won't be swept"
- Source site: `src/cli/utils/migrations.ts:186-221` (`runMigrations` per-project branch) has no D37 JSDoc; the edge case is only documented in `tests/migrations.test.ts:270-299`.
- Per user's stated hard acceptance criterion ("Design decisions must be JSDoc D-series comments at code sites"), this fails the criterion.
- Fix: Add a JSDoc comment at or near the `results.every(r => r.status === 'fulfilled')` check (line 216) documenting D37's vacuous-truth behavior and the documented recovery (`rm ~/.devflow/migrations.json`).

**`CHANGELOG.md` [Unreleased] section predates v2 refactor — entries are stale** — Confidence: 92%
- `CHANGELOG.md:11,17`
- Problem: Line 11 says the self-learning system "detects repeated workflows and creates slash commands/skills automatically" — the v2 reality is 4 observation types (workflow, procedural, decision, pitfall) that render to 4 artifact targets. Line 17 says "Raised procedural thresholds from 2 to 3 observations with 24h+ temporal spread for both types" — the new thresholds are per-type (workflow: 3/3d, procedural: 4/5d, decision/pitfall: 2/0d). Unreleased changelog is the user-facing release note — it should match reality at release time.
- Fix: Add new `### Changed` and `### Added` entries under `[Unreleased]` covering: 4-type extraction, DIALOG_PAIRS/USER_SIGNALS channels, knowledge-persistence becoming format-spec-only, `--review` / `--dismiss-capacity` commands, `--purge-legacy-knowledge` replaced by auto-migration, capacity hard ceiling at 100, citation sentence + usage tracking, HUD learning row.

**`docs/reference/skills-architecture.md` still describes `knowledge-persistence` as recording decisions/pitfalls** — Confidence: 90%
- `docs/reference/skills-architecture.md:23`
- Quoted: `| `knowledge-persistence` | Record/load architectural decisions and pitfalls to `.memory/knowledge/` | /implement, /code-review, /resolve, /debug, /plan, /self-review |`
- Problem: Contradicts the updated SKILL.md which says writing is performed exclusively by the background extractor. The Used By column is also inaccurate — the commands no longer invoke this skill (per D8 removal).
- Fix: Update the description to "Format specification for `.memory/knowledge/` entries. Read by agents loading knowledge for context. Writing performed by background-learning extractor." Update Used By to reflect actual readers only (Skimmer, if still used; Reviewer reads pitfalls directly).

**`plugins/devflow-implement/README.md:51` describes `knowledge-persistence` as "Architectural decision recording"** — Confidence: 95%
- Problem: Describes the old write-side behavior. The skill no longer records; the plugin no longer lists it in plugin.json (this PR removed it). The README is orphaned from reality.
- Fix: Since the plugin no longer ships this skill, remove the bullet entirely.

**`docs/cli-reference.md` missing newly-added `learn --review` and migration system mention** — Confidence: 85%
- `docs/cli-reference.md:74-80` lists `--enable`, `--disable`, `--status`, `--list`, `--configure`, `--clear`, `--purge` but omits `--review` (documented in `docs/self-learning.md:93`). CLAUDE.md also mentions it explicitly. Users consulting the CLI reference for the canonical command list will miss this.
- No mention of the new migrations system (one-time migrations on init, `~/.devflow/migrations.json`) though that was called out in CLAUDE.md as a newly added subsection.
- Fix: Add `npx devflow-kit learn --review` line with purpose. Consider adding a Migrations section mirroring CLAUDE.md's language.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**README.md self-learning bullet is structurally clearer than CLAUDE.md's Self-Learning paragraph** — Confidence: 82%
- `README.md:47`
- Observation: The README now accurately says "4 observation types across sessions — workflow patterns, procedural knowledge, architectural decisions, and recurring pitfalls. Workflow and procedural observations create reusable slash commands and skills automatically. Decisions and pitfalls are written directly to `.memory/knowledge/decisions.md` and `.memory/knowledge/pitfalls.md`". This is correct, user-facing, and concise. CLAUDE.md's paragraph has correct facts elsewhere but is ~400 words long, runs them together, and contains the procedural=3 error above.
- Fix: Consider splitting the CLAUDE.md Self-Learning paragraph into a short overview + a bulleted list of sub-topics (extraction channels, thresholds, rendering targets, reconciler, CLI), similar to how the Working Memory paragraph is structured. Not blocking — just drift prevention.

**`docs/working-memory.md` Self-Learning sibling paragraph uses "4 observation types" but doesn't link forward to the types** — Confidence: 80%
- `docs/working-memory.md:81`
- Observation: The added paragraph says "extract 4 observation types (workflow, procedural, decision, pitfall)" and ends with "See [Self-Learning](self-learning.md) for the full architecture." That's good. Minor: the paragraph conflates "turns captured by Working Memory hook" with "transcript batches read by Self-Learning hook" — not quite clear whether they read the same source data or different sources.
- Fix (optional): Add one sentence: "The two systems read overlapping raw material (session transcripts) but via different hooks and at different cadences — Working Memory on every Stop, Self-Learning at SessionEnd batched every 3 sessions."

### LOW

**`src/cli/utils/legacy-knowledge-purge.ts:7` JSDoc references the CLI flag that no longer exists** — Confidence: 78%
- Quoted: `D34: Pure helper extracted from the --purge-legacy-knowledge handler in learn.ts for two reasons:`
- Analysis: The flag was removed in favor of auto-migration. The comment is historical ("extracted from") and tells future readers where the logic used to live. In software archaeology terms, this is valid — callers of "why did this helper exist?" will find the answer. Not strictly stale; just needs an additional sentence to make clear the flag no longer exists.
- Fix (optional): Append one sentence: "The flag was removed in v2; the function is now invoked only from the migration registry (see migrations.ts)."

## Pre-existing Issues (Not Blocking)

### MEDIUM

**`docs/working-memory.md` File Structure table still lists `.learning-*` state files without the new `.learning-manifest.json` and `.notifications.json`** — Confidence: 80%
- `docs/working-memory.md:36-46`
- Problem: The listing includes the pre-v2 state files but omits two new files introduced by this PR (`.learning-manifest.json`, `.notifications.json`, `.knowledge-usage.json`, `.knowledge-usage.lock`). CLAUDE.md's file listing was updated to include `.learning-manifest.json`; working-memory.md wasn't.
- Fix: Add the missing files. Since the Working Memory doc explicitly says "Self-learning shares the `.memory/` directory but uses a completely different pipeline", its listing of learning-* files is questionable scope — consider trimming them to just the shared files (WORKING-MEMORY.md, backup.json, knowledge/) and linking to self-learning.md for learning-specific files.

## Suggestions (Lower Confidence)

- **Citation block duplication across `coder.md`, `reviewer.md`, and SKILL.md** - `shared/agents/coder.md`, `shared/agents/reviewer.md`, `shared/skills/knowledge-persistence/SKILL.md` all contain identical `<!-- CITATION-SENTENCE-START -->` blocks (Confidence: 70%) — if the sentence ever needs updating, three places must be changed. Consider a single source with a propagation test (which already exists, per `tests/skill-references.test.ts`), but document the authoritative location in a comment.

- **`learn.ts` D-tag comments use inline `// D23:` prefix but no JSDoc block** - `src/cli/commands/learn.ts:1019,1076,1096,1128` (Confidence: 72%) — the comments reference D23 but lack the `@devflow-design-decision D23` machine-readable tag. Inconsistent with `src/cli/utils/migrations.ts:30,42,78` which use full JSDoc blocks. Minor consistency.

- **Self-learning doc "Key Design Decisions" section mixes D-series (D8, D9, D13, D15, D16) but doesn't explain the D numbering scheme** - `docs/self-learning.md:109-113` (Confidence: 62%) — first-time readers won't know D8 refers to a JSDoc decision tag. One-line prefix like "D-series tags link to JSDoc design comments at code sites" would help.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 3 | 3 | 5 | - |
| Should Fix | - | - | 2 | 1 |
| Pre-existing | - | - | 1 | - |

**Documentation Score**: 6/10

The PR makes significant, substantive doc updates that correctly describe the v2 knowledge architecture (docs/self-learning.md, README.md, working-memory.md sibling-system paragraph, CLAUDE.md Migrations subsection are all good additions). The D30-D37 JSDoc rationale in `migrations.ts` is genuinely substantive — D30 explains the scope-independence tradeoff concretely, D32 justifies always-run-unapplied over fresh-vs-upgrade detection with specific scenarios, D33 spells out non-fatal retry semantics, D35 explains the parallel-vs-serial choice via cross-reference to .claudeignore multi-project install. These are good design decision comments, not decision restatements.

However, the PR **partially migrated** away from `knowledge-persistence` as a write-side skill: base `.md` commands were updated but teams variants, two plugin.json files (plan, debug, ambient), the skimmer frontmatter, and `docs/reference/skills-architecture.md` still reference the old write-side role. Users installing with `--teams` will get commands that instruct agents to use a skill that no longer has the capability. CHANGELOG.md Unreleased section is stale. CLAUDE.md has one factual error (procedural=3 vs actual 4). docs/self-learning.md's promotion rule doesn't match the code check.

**Recommendation**: CHANGES_REQUESTED

The teams-variant inconsistency is a real behavioral breakage for teams users. The CLAUDE.md factual error (procedural required count) and the promotion-rule description in self-learning.md are both user-facing inaccuracies that should be fixed before merge. The stale `knowledge-persistence` references in plan/debug/ambient plugin.json and skimmer frontmatter should either be removed or have their continued presence justified with a comment. D37 should get a JSDoc at its code site to match the user's stated hard acceptance criterion.
