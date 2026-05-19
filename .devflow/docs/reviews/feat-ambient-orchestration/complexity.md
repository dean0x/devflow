# Complexity Review Report

**Branch**: feat/ambient-orchestration -> main
**Date**: 2026-03-19
**PR**: #149

## Issues in Your Changes (BLOCKING)

### CRITICAL

No critical complexity issues found.

### HIGH

No high-severity complexity issues found.

### MEDIUM

**M1: Redundant decision tables duplicated across 4 files -- cognitive load multiplier** - `shared/skills/ambient-router/SKILL.md`, `plugins/devflow-ambient/commands/ambient.md`, `plugins/devflow-ambient/README.md`, `scripts/hooks/ambient-prompt`
- Problem: The intent-to-depth classification logic (QUICK/GUIDED/ORCHESTRATED criteria) and the skill-selection matrices are repeated with slight variations across 4 files: the `ambient-router` SKILL.md (authoritative), the `ambient.md` command, the `README.md`, and the `ambient-prompt` hook. Each copy uses slightly different phrasing for the same rules. The ambient-router alone has 3 separate tables for the GUIDED/ORCHESTRATED split (Step 2 depth criteria table, scope-based decision criteria table, and the "Classification conservatism" prose block). The `ambient.md` command then repeats GUIDED and ORCHESTRATED skill-selection matrices that are already in the router.
- Impact: When classification rules evolve (as they already have from ELEVATE to ORCHESTRATED in this PR), every copy must be updated in lockstep or they drift apart. Each file that repeats classification logic adds ~20-30 lines of table overhead that a reader must mentally reconcile with the canonical version.
- Fix: The `ambient.md` command and `ambient-prompt` hook should reference the router as the single source of truth rather than duplicating its tables. Replace the Phase 4 tables in `ambient.md` with a directive:
  ```markdown
  **ORCHESTRATED:**
  Invoke each selected skill using the Skill tool per the ambient-router's
  Step 3 (skill selection) and Step 5 (agent orchestration). The ambient-router
  skill is the single source of truth for intent-to-pipeline mapping.
  ```
  This collapses duplicated tables into a 2-line reference. The ambient-router is always loaded in Phase 1 -- there is no information loss.

**M2: ambient-router SKILL.md grown to 141 lines with 5 steps and 7 tables** - `shared/skills/ambient-router/SKILL.md:1-141`
- Problem: The ambient-router now encodes a 5-step decision process (classify intent, classify depth, select skills, apply, orchestrate agents) across 7 markdown tables with 3 orthogonal dimensions (intent x depth x pipeline). Step 5 partially restates what the individual orchestration skills already define. A reader must hold all 5 steps and their interactions in mind simultaneously. The file is within the project's ~120-150 line target for skills, but the conceptual density is at the warning threshold.
- Impact: An agent processing this skill must parse 5 interdependent steps with cross-references between them. Step 5's pipeline table duplicates information already present in each orchestration skill (implementation-orchestration, debug-orchestration, plan-orchestration).
- Fix: Move Step 5's pipeline dispatch and the ORCHESTRATED skill selection table into `references/orchestration.md`. Keep the main SKILL.md focused on classification (Steps 1-2) and GUIDED behavior (Steps 3-4). This would bring the router back to ~100 lines and reduce the table count from 7 to 4-5.

**M3: ambient.md command duplicates router logic rather than delegating** - `plugins/devflow-ambient/commands/ambient.md:59-85`
- Problem: Phase 4 of the `ambient.md` command contains two full skill-selection matrices (GUIDED 4-row table and ORCHESTRATED 3-row table) that duplicate what the ambient-router already defines in Step 3. The command file is 127 lines -- reasonable for a command -- but ~30 of those lines are duplicated decision tables that add no new information beyond what the router already specifies.
- Impact: A reader (human or LLM) must compare the tables in `ambient.md` against those in `ambient-router/SKILL.md` to verify consistency. Currently they are consistent, but this is a maintenance burden that grows with each classification change.
- Fix: Replace the duplicated tables in Phase 4 with: "Load skills per ambient-router Step 3 selection matrix." Keep only the unique Phase 4 content: the QUICK/GUIDED/ORCHESTRATED behavioral instructions (what to do after classification, not which skills to load).

## Issues in Code You Touched (Should Fix)

### MEDIUM

**S1: ambient-prompt hook preamble is a 17-line inlined string with embedded classification logic** - `scripts/hooks/ambient-prompt:34-51`
- Problem: The PREAMBLE variable is a 17-line multi-line string containing classification rules, conservatism guidelines, and GUIDED/ORCHESTRATED behavioral instructions. The preamble contains 3 conditional behavior blocks (GUIDED, ORCHESTRATED, QUICK) plus a classification conservatism paragraph. It duplicates classification guidance that exists in the router skill -- the hook says "Use the ambient-router skill already in your session context" but then proceeds to re-state conservatism rules and behavioral instructions anyway.
- Impact: Editing this preamble requires careful bash quoting awareness. The duplication means future classification changes require updates in both the router and the hook preamble.
- Fix: Trim the preamble to the minimum needed to trigger the router: intent/depth enum values, a one-line conservatism reminder, and "follow ambient-router skill for all details." This would reduce the preamble from 17 lines to ~5-7 lines.

### LOW

**S2: implementation-orchestration 6-phase pipeline with nested retry loops** - `shared/skills/implementation-orchestration/SKILL.md:66-76`
- Problem: Phase 5 (Quality Gates) contains 5 sequential steps, where steps 1 and 5 each have retry loops of up to 2 iterations. The worst-case execution path spawns up to 12 agents for a single IMPLEMENT intent: Coder + Validator retries with Coder fixes + Simplifier + Scrutinizer + Validator re-validate + Shepherd retries with Coder fixes. This is 3 levels of procedural nesting: phase -> step -> retry.
- Impact: The pipeline complexity is deliberate and well-documented (the Iron Law explicitly states "no shortcut"). Each phase is short (5-10 lines) and self-contained. The linear structure keeps it manageable despite the total step count.
- Fix: Consider adding a worst-case agent count note for transparency:
  ```markdown
  **Agent budget**: Typical 5-6 agents. Worst case with retries: up to 12.
  ```

**S3: debug-orchestration convergence phase has implicit 3-way branching** - `shared/skills/debug-orchestration/SKILL.md:53-58`
- Problem: Phase 3 (Converge) describes 3 distinct paths based on investigation outcomes ("One CONFIRMED", "Multiple PARTIAL", "All DISPROVED") as a prose bullet list. The branching logic is clear when read carefully but is denser than a table format.
- Impact: Minor readability concern. An LLM can parse the prose, but a table would reduce ambiguity.
- Fix: Consider reformatting Phase 3 as a decision table:
  ```markdown
  | Outcome | Action |
  |---------|--------|
  | One CONFIRMED | Spawn 1-2 validation Explores |
  | Multiple PARTIAL | Find unifying root cause |
  | All DISPROVED | Generate 2-3 second-round hypotheses |
  ```

## Pre-existing Issues (Not Blocking)

### MEDIUM

**P1: ambient.ts action handler is a single 72-line function with 6 conditional branches** - `src/cli/commands/ambient.ts:111-183`
- Problem: The `.action(async (options) => { ... })` handler at lines 111-183 is a 72-line inline function with 6 top-level conditional branches: no-flag check, settings read with error handling, status check, devflowDir resolution (with nested try/catch and conditional path extraction), enable check, and disable check. The devflowDir resolution block (lines 147-161) is the most complex with 3 levels of conditional logic.
- Impact: Pre-existing code not introduced in this PR (the only change was line 171, a log message string). The function is below the 200-line critical threshold but above the 50-line warning threshold.
- Fix: Extract the devflowDir resolution into a separate function `resolveDevflowDir(settingsContent: string): string`. Extract enable/disable/status handlers into individual functions. This would bring the main action handler to ~20 lines.

### LOW

**P2: Ambient-router allowed-tools is read-only but ORCHESTRATED path instructs agent spawning** - `shared/skills/ambient-router/SKILL.md:6`
- Problem: The ambient-router declares `allowed-tools: Read, Grep, Glob` (read-only), but Step 5 instructs the agent to "orchestrate agents" which requires Task and Bash tools. This works in practice because the router is loaded as a skill reference, not an agent sandbox, and the command that loads it has broader tool access.
- Impact: Pre-existing conceptual mismatch. No functional issue.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 3 | 0 |
| Should Fix | - | 1 | 0 | 2 |
| Pre-existing | - | - | 1 | 1 |

**Complexity Score**: 7/10

The PR successfully evolves the ambient system from a simple "classify and load skills" model to a full three-tier orchestration system. The new TypeScript code is clean with small focused functions. The three new orchestration skills (`implementation-orchestration`, `debug-orchestration`, `plan-orchestration`) are well-structured with clear linear phases and defined error handling, each within line-count budgets.

The primary complexity concern is the information architecture of the markdown-based classification system: the same classification rules and skill-selection matrices are expressed in 4 different files with slight variations, creating a synchronization burden. This is a documentation-layer DRY violation rather than a code-layer complexity problem, but for a system where markdown files ARE the executable specification (LLM-consumed skills), it has real maintenance impact. The cross-skill dependency (debug-orchestration Phase 5 delegates to implementation-orchestration) is well-documented but adds an implicit coupling path.

**Recommendation**: APPROVED_WITH_CONDITIONS

Conditions:
1. **M1/M3 (table duplication)**: Consider consolidating in a follow-up PR. The `ambient.md` command and `ambient-prompt` hook should reference the router as the single source of truth for classification rules and skill-selection matrices, rather than duplicating those tables. This is not blocking because all copies are currently consistent, but the drift risk is real.
2. **S1 (hook preamble)**: Trim the preamble to essentials in a follow-up. The router skill is already in the session context -- the hook should not re-state its rules.
3. **M2 (router density)**: Consider progressive disclosure of ORCHESTRATED-specific tables to `references/orchestration.md` to keep the main SKILL.md focused on classification.
