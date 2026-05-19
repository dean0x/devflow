# Review Synthesis: feat/ambient-orchestration

**Branch**: feat/ambient-orchestration -> main
**Date**: 2026-03-19
**Commit**: 595cd05 feat(ambient): add agent orchestration to ambient mode
**Reviewers**: 9 (security, architecture, performance, complexity, consistency, regression, tests, typescript, documentation)

---

## Merge Recommendation: CHANGES_REQUESTED

Six of nine reviewers requested changes. Two approved with conditions. One (TypeScript) approved outright. The blocking issues are concentrated in three themes: stale test/documentation artifacts left behind after the taxonomy rename, undeclared agent contracts in the plugin manifest, and missing safeguards for pipeline proportionality. None require architectural redesign -- all are addressable with targeted fixes.

---

## Score Summary

| Dimension | Score | Verdict |
|-----------|-------|---------|
| Security | 8/10 | APPROVED_WITH_CONDITIONS |
| Architecture | 7/10 | CHANGES_REQUESTED |
| Performance | 7/10 | CHANGES_REQUESTED |
| Complexity | 7/10 | APPROVED_WITH_CONDITIONS |
| Consistency | 5/10 | CHANGES_REQUESTED |
| Regression | 3/10 | CHANGES_REQUESTED |
| Tests | 3/10 | CHANGES_REQUESTED |
| TypeScript | 8/10 | APPROVED |
| Documentation | 5/10 | CHANGES_REQUESTED |
| **Aggregate** | **5.9/10** | **CHANGES_REQUESTED** |

---

## Deduplicated Issue List

Issues are ordered by severity, then by number of reviewers who flagged them.

### CRITICAL

| # | Issue | Flagged By | Description |
|---|-------|------------|-------------|
| C1 | Integration tests use removed BUILD/GUIDED/ELEVATE terminology | regression, tests, documentation | Regex patterns in `helpers.ts` and assertions in `ambient-activation.test.ts` match only the old enum values. Tests silently pass without validating the new behavior because `hasClassification()` returns false on regex mismatch. |
| C2 | Zero new tests for orchestration skills or plugin changes | tests | 3 new skills, 7 new agents in plugin manifest, full taxonomy rename -- yet no new test files or test cases added. Existing build tests provide passive filesystem coverage only. |

### HIGH

| # | Issue | Flagged By | Description |
|---|-------|------------|-------------|
| H1 | Plugin README.md not updated -- documents removed GUIDED/ELEVATE model | regression, documentation | The entire plugin README still shows the old three-tier model, old intent name BUILD, and says "No agents spawned." Every section is stale. |
| H2 | Missing Explore/Plan/Synthesizer agents in plugin manifest | architecture, consistency, complexity | Orchestration skills reference "Explore agents" and "Plan agent" that are not declared in `plugin.json`. `synthesizer` and `git` agents are also absent despite being used by equivalent full commands. Pattern is consistent with existing commands (ad-hoc Task sub-agents) but undocumented. |
| H3 | `Task` tool in orchestration skill allowed-tools is unprecedented | consistency | No existing skill in the codebase uses `Task` as an allowed tool. Introduces a new convention without documentation or justification in the skills architecture reference. |
| H4 | Orchestration skills grant Bash without scope documentation | security | All three orchestration skills declare Bash access. Unlike git-safety (scoped to git commands), the orchestration skills have broad mandates without documenting which shell operations are expected. |
| H5 | IMPLEMENT pipeline has no scope-proportional fast path | performance | Once classified ORCHESTRATED, a one-line config change pays the same 5-6 agent overhead as a multi-file feature. The Iron Law prohibits shortcuts, but trivial changes should not spawn the full pipeline. |
| H6 | DEBUG pipeline has unbounded agent budget | performance | Worst case spawns 10+ Explore agents across initial hypotheses, second-round hypotheses, and validation -- no explicit cap. |
| H7 | `search-first` skill silently dropped from IMPLEMENT | regression, consistency, documentation | Was "Always for BUILD" in the previous version. Removed without migration note or rationale. The Coder agent does not include it either, so research-before-building enforcement is lost. |
| H8 | CHANGELOG has no entry for breaking taxonomy changes | regression, documentation | BUILD->IMPLEMENT rename, GUIDED/ELEVATE->ORCHESTRATED collapse, 3 new skills, 7 agents added -- none documented in CHANGELOG `[Unreleased]`. |

### MEDIUM

| # | Issue | Flagged By | Description |
|---|-------|------------|-------------|
| M1 | Pipeline mapping tables duplicated across 3-4 locations | complexity | Intent-to-pipeline routing is stated in `ambient.md`, `ambient-router` Steps 3 and 5, and `skill-catalog.md`. Must be updated in lockstep or they drift. Ambient command should reference the router as single source of truth. |
| M2 | Three-tier to two-tier collapse removes escalation safety valve | architecture, consistency, performance | ELEVATE previously nudged users toward `/implement` for complex tasks. No equivalent exists in the new model. Users with large, vague architectural requests get either QUICK (nothing) or ORCHESTRATED (expensive pipeline for unclear scope). |
| M3 | Undocumented delta between ambient pipelines and full commands | architecture | `implementation-orchestration` is a subset of `/implement` (6 vs 15 phases). `debug-orchestration` omits Synthesizer and knowledge persistence from `/debug`. The relationship is nowhere documented, creating maintenance drift risk. |
| M4 | Description mismatch across 5 locations | consistency | Three distinct description variants for the ambient plugin across `ambient.md` frontmatter, `plugin.json`, `CLAUDE.md`, `README.md`, and `plugins.ts`. |
| M5 | JSON.parse calls without try/catch in ambient.ts utilities | security, typescript | `addAmbientHook()`, `removeAmbientHook()`, `hasAmbientHook()` all parse without error handling. Corrupted `settings.json` crashes the CLI. |
| M6 | Shell hook reads user prompt without defensive security comment | security | `$PROMPT` is currently safe (only word-counted), but any future modification interpolating it into commands could introduce injection. Needs a security boundary comment. |
| M7 | No rate limiting on ORCHESTRATED classification | security | Rapid sequential ORCHESTRATED triggers spawn dozens of agents with no cooldown or queue mechanism. |
| M8 | `test-driven-development` removed from ambient IMPLEMENT skills | regression, documentation | TDD enforcement moved to Coder agent frontmatter -- valid choice, but the migration is undocumented. If Coder is skipped (pipeline error), TDD enforcement is lost. |
| M9 | Ambient-router allowed-tools mismatch with ORCHESTRATED role | consistency, complexity | Router declares `Read, Grep, Glob` (read-only) but Step 5 instructs agent orchestration requiring Bash and Task. Works in practice (main session context), but declared permissions conflict with described behavior. |
| M10 | Classification conservatism is instruction-only, no mechanical guardrail | performance | "Default to QUICK" is LLM-advisory. False-positive ORCHESTRATED is the primary performance risk. No heuristic backstop for short prompts without signal words. |
| M11 | EXPLORE with analytical depth downgraded to QUICK | regression | "Analyze our authentication flow" previously got GUIDED with skill loading. Now gets QUICK with zero assistance. Behavioral regression for analytical prompts. |
| M12 | Ambient command frontmatter description is stale | documentation | Still says "classify intent and auto-load relevant skills for any prompt" -- doesn't mention agent orchestration. |
| M13 | CLAUDE.md "Three shell-script hooks" should be four | documentation | `scripts/hooks/` now contains four hooks including `ambient-prompt`. Count is stale. |
| M14 | Untyped JSON.parse at line 149 of ambient.ts | typescript | Inline parse returns implicit `any`, bypassing TypeScript static checks on subsequent property access. |
| M15 | Cross-skill dependency undocumented (debug -> implementation) | complexity | `debug-orchestration` Phase 5 delegates to `implementation-orchestration` for fixes. A change to implementation's Phase 1 silently affects debug's fix path. |
| M16 | Implementation-orchestration worst-case agent count not documented | complexity, performance | Up to 12 agent spawns with retries. The budget should be transparent. |

### LOW

| # | Issue | Flagged By | Description |
|---|-------|------------|-------------|
| L1 | Explore agent referenced but not in plugin.json agents list | complexity | Minor confusion for maintainers; functional if Explore is an inline Task sub-agent. |
| L2 | Edge case table duplicated between ambient.md and ambient-router | complexity | Both files have nearly identical tables that can drift independently. |
| L3 | Skill count "35" may drift without build-time generation | architecture, consistency | Currently correct, but a maintenance hazard. |
| L4 | Ambient-router skill description frontmatter understates new role | consistency | Still says "auto-loading relevant skills" without mentioning agent orchestration. |
| L5 | Coder agent example TASK_ID year inconsistency (2025 vs 2026) | consistency | Cosmetic; example timestamps differ between agent and orchestration skill. |

---

## Key Themes

### 1. Incomplete Taxonomy Migration (C1, H1, H8, M4, M12)

The BUILD->IMPLEMENT and GUIDED/ELEVATE->ORCHESTRATED rename is executed thoroughly in the core skill and command files but was not propagated to: integration tests, plugin README, CHANGELOG, or command frontmatter description. This is the highest-priority fix category -- it represents stale artifacts that actively mislead, not subjective design choices.

### 2. Undeclared Agent Contracts (H2, H3, L1)

The orchestration skills reference agents (Explore, Plan, Synthesizer) that are not in the plugin manifest. The `Task` tool appears in skill allowed-tools for the first time in the codebase. This is consistent with existing command patterns (ad-hoc Task sub-agents) but creates an undocumented contract. The fix is documentation and/or manifest updates, not architectural change.

### 3. Pipeline Proportionality (H5, H6, M2, M10, M16)

The ORCHESTRATED path has no internal proportionality. Once triggered, every prompt gets the full agent pipeline regardless of scope. The IMPLEMENT pipeline lacks a scope gate for trivial changes. The DEBUG pipeline has no agent budget cap. Classification conservatism is advisory-only with no mechanical backstop. This is the most substantive design concern and warrants a scope gate for IMPLEMENT and an agent budget for DEBUG.

### 4. Dropped Quality Enforcement (H7, M8, M11)

Three behavioral regressions from the tier collapse: `search-first` removed from IMPLEMENT (research-before-building lost), `test-driven-development` moved from ambient skill to Coder-agent-only (enforcement pathway changed), and analytical EXPLORE downgraded from skill-assisted to bare QUICK. Each needs either restoration or documented intentional removal with rationale.

### 5. Documentation Duplication and Drift Risk (M1, M3, M15, L2)

Pipeline mapping tables are stated in 3-4 places. The relationship between ambient orchestration pipelines and their full-command counterparts is undocumented. Cross-skill dependencies (debug delegates to implementation for fixes) are implicit. These create maintenance surface that scales with each new intent or pipeline change.

---

## Required Actions (Must Fix Before Merge)

1. **Update integration tests** -- Replace BUILD/GUIDED/ELEVATE with IMPLEMENT/ORCHESTRATED in `helpers.ts` and `ambient-activation.test.ts`. (C1)
2. **Add tests for new orchestration features** -- At minimum, verify ambient plugin declares expected agents and skills in the plugin registry tests. (C2)
3. **Rewrite plugin README.md** -- The entire file documents a model that no longer exists. (H1)
4. **Document or declare ad-hoc agents** -- Either add Explore/Plan as agents to plugin.json, or add explicit comments in orchestration skills that these are ephemeral Task sub-agents. (H2)
5. **Document `Task` tool convention** -- Either remove from allowed-tools or document as a new convention for orchestration-tier skills. (H3)
6. **Add Bash scope documentation** to each orchestration skill. (H4)
7. **Add CHANGELOG entry** for the taxonomy changes and architectural shift. (H8)
8. **Resolve `search-first` removal** -- Restore it or document the intentional removal with rationale. (H7)

## Recommended Actions (Should Fix, Can Be Follow-Up)

9. Add scope gate to IMPLEMENT pipeline for trivial changes. (H5)
10. Add agent budget cap to DEBUG pipeline. (H6)
11. Add try/catch to JSON.parse calls in ambient.ts utility functions. (M5)
12. Collapse pipeline mapping tables to single source of truth in ambient-router. (M1)
13. Document relationship between ambient pipelines and full commands. (M3)
14. Add post-pipeline note recommending `/implement` for large-scope tasks. (M2)
15. Document TDD enforcement pathway shift in skill catalog. (M8)
16. Align plugin description across all 5 locations. (M4)
17. Add security boundary comment in ambient-prompt hook. (M6)
18. Update ambient command frontmatter description. (M12)

---

## Aggregate Issue Counts

| Category | CRITICAL | HIGH | MEDIUM | LOW | Total |
|----------|----------|------|--------|-----|-------|
| Blocking (deduplicated) | 2 | 8 | 16 | 5 | 31 |

*Note: Raw counts across all 9 reviewers total higher due to overlap. The above reflects deduplicated unique issues.*
