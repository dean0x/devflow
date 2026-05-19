# Architecture Review Report

**Branch**: feat/108-unified-plan-command -> main
**Date**: 2026-04-08_0153
**Focus**: Blast radius analysis -- did we update everything we had to update?

## Issues in Your Changes (BLOCKING)

### HIGH

**Missing LEGACY_PLUGIN_NAMES migration for devflow-specify -> devflow-plan** - `src/cli/plugins.ts:205-207`
**Confidence**: 95%
- Problem: `LEGACY_PLUGIN_NAMES` maps old plugin names to new names during `devflow init` upgrades. It currently maps `devflow-frontend-design -> devflow-ui-design` but does NOT map `devflow-specify -> devflow-plan`. Users who previously installed `devflow-specify` will have it in their manifest (`.devflow/manifest.json`). On partial reinstall (`--plugin` flag), `resolvePluginList()` in `manifest.ts:137` runs `LEGACY_PLUGIN_NAMES[p] ?? p` which will pass `devflow-specify` through unchanged, leaving a stale entry in the manifest that references a plugin that no longer exists.
- Impact: Users upgrading from pre-v2.x with `devflow-specify` installed will silently retain a dead plugin reference in their manifest. On full reinstall this is not an issue (manifest is replaced entirely), but partial installs will accumulate stale entries.
- Fix: Add to `LEGACY_PLUGIN_NAMES`:
  ```typescript
  export const LEGACY_PLUGIN_NAMES: Record<string, string> = {
    'devflow-frontend-design': 'devflow-ui-design',
    'devflow-specify': 'devflow-plan',
  };
  ```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**docs/reference/file-organization.md: stale skill and agent counts** - `docs/reference/file-organization.md:12,18,138`
**Confidence**: 95%
- Problem: Three count mismatches after this branch added 2 skills (`gap-analysis`, `design-review`) and 1 agent (`designer`):
  - Line 12: `# SINGLE SOURCE OF TRUTH (39 skills)` -- should be `(41 skills)`
  - Line 18: `# SINGLE SOURCE OF TRUTH (11 shared agents)` -- should be `(12 shared agents)`
  - Line 138: `**Shared** (11): git, synthesizer, skimmer, simplifier, coder, reviewer, resolver, evaluator, tester, scrutinizer, validator` -- should be `**Shared** (12)` and include `designer`
- Impact: Documentation drift. Developers consulting this file will have incorrect counts. The CLAUDE.md was correctly updated to 41/12, making this inconsistency worse.
- Fix: Update all three lines:
  ```
  Line 12: # SINGLE SOURCE OF TRUTH (41 skills)
  Line 18: # SINGLE SOURCE OF TRUTH (12 shared agents)
  Line 138: **Shared** (12): `git`, `synthesizer`, `skimmer`, `simplifier`, `coder`, `reviewer`, `resolver`, `evaluator`, `tester`, `scrutinizer`, `validator`, `designer`
  ```

**docs/reference/skills-architecture.md: missing gap-analysis and design-review from tier catalog** - `docs/reference/skills-architecture.md:13-24`
**Confidence**: 92%
- Problem: The Tier 1 Foundation Skills table lists 10 skills but does not include the two new skills introduced in this branch: `gap-analysis` and `design-review`. These are Foundation skills used by `/plan` and ambient mode (GUIDED PLAN, ORCHESTRATED PLAN). They were correctly added to `plugin.json` manifests, `DEVFLOW_PLUGINS` in `plugins.ts`, `LEGACY_SKILL_NAMES`, the router SKILL.md, and the skill catalog reference -- but not to this canonical tier table.
- Impact: The skills-architecture.md is the canonical reference for the tier system. Omitting these skills means developers looking here won't know where `gap-analysis` and `design-review` fit in the architecture.
- Fix: Add two rows to the Tier 1 Foundation Skills table:
  ```markdown
  | `gap-analysis` | Identify missing requirements, undefined states, security gaps in designs | Designer, /plan |
  | `design-review` | Detect anti-patterns, vagueness, and failure mode gaps in implementation plans | Designer, /plan, Ambient GUIDED PLAN |
  ```

## Pre-existing Issues (Not Blocking)

None identified.

## Suggestions (Lower Confidence)

- **Old /specify and /specify-teams command files at ~/.claude/commands/devflow/ on existing installs** - (Confidence: 75%) -- The `LEGACY_COMMAND_NAMES` array correctly lists `specify` and `specify-teams` for cleanup during `devflow init`. However, users who don't re-run `devflow init` after upgrading will still have the old command files installed. This is a known limitation of the legacy cleanup mechanism (it only runs during init), not a code bug.

- **docs/reference/file-organization.md plugin manifest example still shows "synthesizer" in implement plugin** - `docs/reference/file-organization.md:88` (Confidence: 65%) -- The example `plugin.json` snippet shows `"agents": ["git", "coder", "synthesizer"]` for `devflow-implement`, but the actual implement plugin.json no longer includes `synthesizer` or `skimmer` (they were moved to `devflow-plan`). This is a generic example, so the discrepancy may be intentional.

- **Router skill-catalog.md PLAN Intent table does not mention design-review** - `shared/skills/router/references/skill-catalog.md:75-81` (Confidence: 68%) -- The PLAN Intent table in the skill catalog lists `devflow:plan:orch`, `devflow:test-driven-development`, `devflow:patterns`, and `devflow:software-design`, but does not list `devflow:design-review`. The router SKILL.md itself (line 23) does include `devflow:design-review` for GUIDED PLAN. The skill-catalog reference appears to be incomplete for the PLAN section.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 0 | - |
| Should Fix | - | 0 | 2 | - |
| Pre-existing | - | - | 0 | 0 |

**Architecture Score**: 8/10
**Recommendation**: CHANGES_REQUESTED

The rename from specify to plan was executed thoroughly across 40 files. The core architecture (plugin manifests, DEVFLOW_PLUGINS, LEGACY_COMMAND_NAMES, LEGACY_SKILL_NAMES, router, skill catalog, CLAUDE.md, README.md, marketplace.json, .gitignore) is all correctly updated. The three documentation files with stale counts and the missing LEGACY_PLUGIN_NAMES migration entry are the only gaps found in the blast radius.
