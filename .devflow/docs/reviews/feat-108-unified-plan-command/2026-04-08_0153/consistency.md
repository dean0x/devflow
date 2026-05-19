# Consistency Review Report

**Branch**: feat/108-unified-plan-command -> main
**Date**: 2026-04-08_0153

## Issues in Your Changes (BLOCKING)

### HIGH

**file-organization.md: Stale skill and agent counts** - `docs/reference/file-organization.md:12,18,138`
**Confidence**: 95%
- Problem: `file-organization.md` still shows `39 skills` and `11 shared agents` in three places. The branch added 2 new skills (gap-analysis, design-review) and 1 new agent (designer), making the correct counts `41 skills` and `12 shared agents`. CLAUDE.md and README.md were updated, but file-organization.md was not.
- Locations:
  - Line 12: `# SINGLE SOURCE OF TRUTH (39 skills)` -- should be 41
  - Line 18: `# SINGLE SOURCE OF TRUTH (11 shared agents)` -- should be 12
  - Line 138: `**Shared** (11): git, synthesizer, skimmer, simplifier, coder, reviewer, resolver, evaluator, tester, scrutinizer, validator` -- should be (12) and include `designer`
- Fix: Update all three occurrences to match CLAUDE.md (`41 skills`, `12 shared agents`, list designer in the shared agents enumeration).

### MEDIUM

**implement-teams.md: Principle count inconsistency with implement.md** - `plugins/devflow-implement/commands/implement-teams.md:417-430`
**Confidence**: 82%
- Problem: The teams variant has 14 principles while the non-teams variant has 11 principles. The teams variant includes 3 extra principles (#2 "Plan-first", #3 "Team-based alignment", #14 "Cleanup always") that are absent from the non-teams variant. While #3 and #14 are teams-specific (legitimate), #2 "Plan-first" applies equally to both variants since both now accept plan documents. The non-teams implement.md does have principle #2 "Plan-first" but is missing the "Cleanup always" principle (which makes sense) -- however the numbering divergence may confuse agents reading these files. Additionally, principle #5 "Bounded debate" in teams variant has no equivalent in non-teams (also fine since teams variant uses debate).
- Fix: Confirm this is intentional. The teams variant's extra principles are mostly teams-specific and correct. No action needed unless the intent is to keep principle sets aligned where applicable.

## Issues in Code You Touched (Should Fix)

_No issues found._

## Pre-existing Issues (Not Blocking)

### MEDIUM

**docs/reference/file-organization.md: Missing language plugins in plugin list** - `docs/reference/file-organization.md:23-37`
**Confidence**: 85%
- Problem: The file tree in the Source Structure section only lists 8 plugins (`devflow-plan`, `devflow-implement`, `devflow-code-review`, `devflow-resolve`, `devflow-debug`, `devflow-self-review`, `devflow-core-skills`, `devflow-audit-claude`). It does not list `devflow-ambient` or the 9 language/ecosystem plugins, despite the heading saying "17 plugins". This is a pre-existing documentation gap.
- Fix: Either add all 17 plugin directories to the tree or add an ellipsis/note. Low priority since this is pre-existing.

## Suggestions (Lower Confidence)

_No items._

## Cross-File Consistency Matrix

### 1. Phase/Block Numbering: /plan pipeline

| File | Phases | Blocks | Gate Numbers |
|------|--------|--------|--------------|
| `plan.md` | 14 (1-14) | 6 | G0=P1, G1=P7, G2=P13 |
| `plan-teams.md` | 14 (1-14) | 6 | G0=P1, G1=P7, G2=P13 |
| `README.md` | N/A (summary) | N/A | N/A |
| `commands.md` | 6 summary steps | N/A | G0="step 1", G1="step 4", G2="step 6" |
| `plan:orch SKILL.md` | 8 (1-8) | N/A (ambient lite variant) | No user gates |
| `devflow-plan/README.md` | 14-phase/6 blocks (stated) | 6 listed | Correct |
| `router SKILL.md` | N/A | N/A | N/A |

**Verdict**: CONSISTENT. All files agree on 14 phases / 6 blocks for the full /plan command. plan:orch correctly uses its own lighter 8-phase pipeline. commands.md correctly summarizes as 6 user-visible steps (matching the 6 blocks).

### 2. Phase/Block Numbering: /implement pipeline

| File | Phases | Notes |
|------|--------|-------|
| `implement.md` | 10 (1-10) | Correct |
| `implement-teams.md` | 10 (1-10) | Correct (teams variant uses team for Phase 7 alignment) |
| `commands.md` | 6 summary steps | Matches (Setup, Implement, Validate, Refine, Align, QA) |
| `devflow-implement/README.md` | 8 steps | Lists steps 1-8 (Setup through PR Creation) -- this omits the combined Report+Record phase but captures it implicitly |

**Verdict**: CONSISTENT. The 10-phase implement pipeline is uniformly applied.

### 3. specify --> plan rename completeness

| File | Status | Details |
|------|--------|---------|
| `marketplace.json` | DONE | devflow-specify -> devflow-plan |
| `CLAUDE.md` | DONE | /specify -> /plan, devflow-specify -> devflow-plan, agent teams list updated |
| `README.md` | DONE | /specify -> /plan, description updated |
| `docs/cli-reference.md` | DONE | devflow-specify -> devflow-plan |
| `docs/commands.md` | DONE | /specify -> /plan, full rewrite |
| `docs/reference/file-organization.md` | DONE | devflow-specify -> devflow-plan |
| `docs/reference/skills-architecture.md` | DONE | /specify -> /plan, removed Clarification Gates section |
| `plugins.ts` | DONE | devflow-specify -> devflow-plan |
| `init.ts` | DONE | pluginHints updated |
| `tests/plugins.test.ts` | DONE | devflow-specify -> devflow-plan |
| `tests/skill-references.test.ts` | DONE | 'specify' removed from COMMAND_REFS, 'plan' already present |
| `tests/integration/ambient-activation.test.ts` | DONE | Expected skills updated |
| `shared/skills/agent-teams/SKILL.md` | DONE | Specification -> Planning |
| `shared/skills/agent-teams/references/cleanup.md` | DONE | /specify -> /plan |
| `shared/skills/agent-teams/references/team-patterns.md` | DONE | Specification Team -> Planning Team |
| `shared/skills/plan:orch/SKILL.md` | DONE | Updated to reference /plan pipeline |
| `shared/skills/router/SKILL.md` | DONE | design-review added to PLAN skills |
| `shared/agents/synthesizer.md` | DONE | design mode added |
| `shared/agents/git.md` | DONE | fetch-issues-batch operation added |
| `plugins/devflow-implement/README.md` | DONE | devflow-specify -> devflow-plan |
| `CHANGELOG.md` | OK (historical) | Old /specify references are historical changelog entries |
| `plugins.ts` LEGACY_COMMAND_NAMES | DONE | 'specify' and 'specify-teams' added for cleanup |

**Verdict**: CLEAN. No stale /specify references remain outside of CHANGELOG.md (historical).

### 4. Plugin references across files

| Source | Plugin List | Status |
|--------|-------------|--------|
| `marketplace.json` | devflow-plan (first), devflow-implement, ... | Correct |
| `plugins.ts` | devflow-plan (after core-skills), devflow-implement, ... | Correct |
| `init.ts` pluginHints | devflow-plan, devflow-implement, ... | Correct |
| `CLAUDE.md` plugin table | devflow-implement, devflow-plan, ... | Correct (order differs, acceptable) |

**Verdict**: CONSISTENT. All files agree on devflow-plan replacing devflow-specify.

### 5. Agent references across files

| Agent | plan plugin.json | implement plugin.json | CLAUDE.md | file-organization.md |
|-------|-----------------|----------------------|-----------|---------------------|
| designer | Listed | Not listed | Listed (12 agents) | **MISSING** (still shows 11) |
| git | Listed | Listed | Listed | Listed |
| skimmer | Listed | **Removed** | Listed | Listed |
| synthesizer | Listed | **Removed** | Listed | Listed |

**Verdict**: designer is missing from file-organization.md (BLOCKING issue above). skimmer and synthesizer correctly removed from implement plugin since exploration/planning moved to /plan.

### 6. Skill references across files

| Skill | plan plugin.json | ambient plugin.json | plan:orch | router |
|-------|-----------------|--------------------|-----------| -------|
| gap-analysis | Listed | Listed | Used (Phase 3) | Not listed (correct -- loaded by plan:orch) |
| design-review | Listed | Listed | Used (Phase 6) | Listed under PLAN (GUIDED + ORCHESTRATED) |

**Verdict**: CONSISTENT. gap-analysis and design-review correctly propagated.

### 7. Gate numbering

| File | Gate 0 | Gate 1 | Gate 2 |
|------|--------|--------|--------|
| `plan.md` | Phase 1 | Phase 7 | Phase 13 |
| `plan-teams.md` | Phase 1 | Phase 7 | Phase 13 |
| `commands.md` | Step 1 | Step 4 | Step 6 |
| `devflow-plan/README.md` | Block 1 | Block 3 | Block 5 |

**Verdict**: CONSISTENT. All files agree on gate placement.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 1 | 0 |
| Should Fix | 0 | 0 | 0 | 0 |
| Pre-existing | 0 | 0 | 1 | 0 |

**Consistency Score**: 9/10
**Recommendation**: CHANGES_REQUESTED

The rename from specify to plan is thorough and well-executed across 40 files. The only blocking issue is the stale counts in `docs/reference/file-organization.md` (39 skills / 11 agents should be 41 / 12, and designer must be listed in the shared agents enumeration). This is a simple documentation update. All phase numbering, gate numbering, plugin registrations, skill references, and agent references are internally consistent.
