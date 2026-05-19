# Documentation Review Report

**Branch**: feat/ambient-orchestration -> main
**Date**: 2026-03-19
**Commit**: 595cd05 feat(ambient): add agent orchestration to ambient mode

## Issues in Your Changes (BLOCKING)

### HIGH

**H1: Plugin README.md not updated -- still references BUILD/GUIDED/ELEVATE terminology** - `/Users/dean/Sandbox/devflow/plugins/devflow-ambient/README.md:3,12-15,32-37,44-45`
- Problem: The ambient plugin README still uses the old three-tier depth model (QUICK/GUIDED/ELEVATE) and old intent name BUILD. Every example, the "How It Works" section, and the "Depth Tiers" table are stale. This file was not touched in the diff despite being the primary user-facing documentation for the ambient plugin.
- Impact: Users reading the plugin README will see a completely different model than what the code actually implements. The README says "GUIDED (2-3 skills)" and "ELEVATE (workflow nudge)" but the code now has only QUICK and ORCHESTRATED (with full agent pipelines).
- Fix: Rewrite `plugins/devflow-ambient/README.md` to match the new two-tier model:
  ```markdown
  # devflow-ambient

  Ambient mode -- intent classification with proportional agent orchestration.

  ## Command

  ### `/ambient`

  Classify user intent and respond with proportional effort.

  ```bash
  /ambient add a login form          # IMPLEMENT/ORCHESTRATED -- Coder + quality gates
  /ambient fix the auth error        # DEBUG/ORCHESTRATED -- parallel hypothesis investigation
  /ambient how should we cache?      # PLAN/ORCHESTRATED -- Skimmer + Explore + Plan agents
  /ambient where is the config?      # EXPLORE/QUICK -- responds normally, zero overhead
  /ambient commit this               # QUICK -- no overhead
  ```

  ## How It Works

  1. **Classify intent** -- IMPLEMENT, DEBUG, REVIEW, PLAN, EXPLORE, or CHAT
  2. **Classify depth** -- QUICK (zero overhead) or ORCHESTRATED (skills + agents)
  3. **Apply proportionally**:
     - QUICK: respond normally (no agents)
     - ORCHESTRATED: load skills via Skill tool, orchestrate agent pipelines

  ## Depth Tiers

  | Depth | When | Overhead |
  |-------|------|----------|
  | QUICK | Chat, exploration, git/devops ops, small edits, config changes | ~0 tokens |
  | ORCHESTRATED | IMPLEMENT/DEBUG/PLAN/REVIEW with clear scope | Agent spawns + skill loading |

  ## Skills

  - `ambient-router` -- Intent + depth classification, skill selection matrix
  - `implementation-orchestration` -- IMPLEMENT pipeline
  - `debug-orchestration` -- DEBUG pipeline
  - `plan-orchestration` -- PLAN pipeline
  ```

**H2: Integration tests use stale BUILD/GUIDED/ELEVATE terminology** - `/Users/dean/Sandbox/devflow/tests/integration/ambient-activation.test.ts:31-54` and `/Users/dean/Sandbox/devflow/tests/integration/helpers.ts:37-65`
- Problem: The integration test file and its helpers still reference BUILD (should be IMPLEMENT), GUIDED (should be ORCHESTRATED), and ELEVATE (removed). The regex in `hasClassification()` matches `QUICK|GUIDED|ELEVATE` and `extractIntent()` matches `BUILD|DEBUG|REVIEW|PLAN|EXPLORE|CHAT` -- none of these will match the new IMPLEMENT intent or ORCHESTRATED depth.
- Impact: Tests will pass vacuously (the regex won't match, so `hasClassification()` returns false, and the conditional assertions in the test simply skip). These tests provide zero validation of the new behavior.
- Fix: Update `/Users/dean/Sandbox/devflow/tests/integration/helpers.ts`:
  ```typescript
  // Line 37: Update comment
  // Classification markers look like: "Ambient: IMPLEMENT/ORCHESTRATED"

  // Line 40: Update regex
  return /ambient:\s*(IMPLEMENT|DEBUG|REVIEW|PLAN|EXPLORE|CHAT)\s*\/\s*(QUICK|ORCHESTRATED)/i.test(output);

  // Line 55: Update regex
  const match = output.match(/ambient:\s*(IMPLEMENT|DEBUG|REVIEW|PLAN|EXPLORE|CHAT)/i);

  // Line 63: Update regex
  const match = output.match(/ambient:\s*\w+\s*\/\s*(QUICK|ORCHESTRATED)/i);
  ```
  Update `/Users/dean/Sandbox/devflow/tests/integration/ambient-activation.test.ts`:
  ```typescript
  // Line 31: Update comment
  // Git operations should not trigger ORCHESTRATED classification

  // Lines 35-41: Update test
  it('classifies "add a login form" as IMPLEMENT/ORCHESTRATED', () => {
    // ...
    expect(extractIntent(output)).toBe('IMPLEMENT');
    expect(extractDepth(output)).toBe('ORCHESTRATED');

  // Lines 50-55: Update test
  it('classifies "fix the auth error" as DEBUG/ORCHESTRATED', () => {
    // ...
    expect(extractIntent(output)).toBe('DEBUG');
    expect(extractDepth(output)).toBe('ORCHESTRATED');
  ```

### MEDIUM

**M1: ambient.md command frontmatter description is stale** - `/Users/dean/Sandbox/devflow/plugins/devflow-ambient/commands/ambient.md:2`
- Problem: The frontmatter description still says "classify intent and auto-load relevant skills for any prompt" which describes the old skill-only model. The body of the file correctly describes agent orchestration.
- Impact: Frontmatter descriptions are displayed in Claude Code's command listing. Users will see the old description when browsing available commands.
- Fix: Update line 2:
  ```yaml
  description: Ambient mode -- intent classification with proportional agent orchestration
  ```

**M2: CHANGELOG.md has no entry for this feature** - `/Users/dean/Sandbox/devflow/CHANGELOG.md:8-9`
- Problem: The `[Unreleased]` section is empty. This PR introduces a significant behavioral change -- ambient mode evolving from skill-only loading to full agent orchestration with 3 new orchestration skills and 7 agents added to the plugin. This is a notable change that warrants changelog documentation.
- Impact: Users upgrading will have no changelog entry explaining the shift from GUIDED/ELEVATE to ORCHESTRATED, the removal of the ELEVATE tier, or the addition of agent pipelines. This makes the upgrade opaque.
- Fix: Add under `[Unreleased]`:
  ```markdown
  ## [Unreleased]

  ### Changed
  - **Ambient mode agent orchestration** -- Ambient mode now orchestrates full agent pipelines for substantive work. GUIDED/ELEVATE depth tiers replaced with single ORCHESTRATED tier. BUILD intent renamed to IMPLEMENT. QUICK depth unchanged (zero overhead).
    - IMPLEMENT: Coder + Validator + Simplifier + Scrutinizer + Shepherd pipeline
    - DEBUG: Competing hypothesis investigation with parallel Explore agents
    - PLAN: Skimmer + Explore + Plan agent design pipeline
    - REVIEW: Single Reviewer agent
  - **Coder agent TDD enforcement** -- test-driven-development skill added to Coder agent frontmatter

  ### Added
  - **3 orchestration skills** -- `implementation-orchestration`, `debug-orchestration`, `plan-orchestration` (skill count: 32 -> 35)
  ```

**M3: CLAUDE.md "Working Memory" section mentions "Three shell-script hooks" but there are now four** - `/Users/dean/Sandbox/devflow/CLAUDE.md:41`
- Problem: The Working Memory description says "Three shell-script hooks" but `scripts/hooks/` now contains four hooks: stop, session-start, pre-compact, and ambient-prompt. This was pre-existing from the ambient mode initial implementation, but this PR modifies `ambient-prompt` and further entrenches it as a core hook.
- Impact: Developers relying on CLAUDE.md for architecture understanding will undercount the hooks. Minor, since the hooks directory listing in the Project Structure section does mention `ambient-prompt`.
- Category note: This is a borderline pre-existing/should-fix issue since the PR modifies the ambient-prompt hook but not this specific text. Flagging as should-fix since the overall documentation update would be incomplete without it.
- Fix: Update the Working Memory description to say "Four shell-script hooks" or qualify the count: "Three shell-script hooks for memory (`scripts/hooks/`) plus one ambient hook provide automatic session continuity."

## Issues in Code You Touched (Should Fix)

### MEDIUM

**S1: CLAUDE.md `/ambient` description doesn't mention "no agents" removal** - `/Users/dean/Sandbox/devflow/CLAUDE.md:116`
- Problem: The updated `/ambient` command description now says "Intent classification + agent orchestration (IMPLEMENT/DEBUG/PLAN/REVIEW pipelines)" which is accurate. However, the CLAUDE.md previously documented ambient as "no agents, main session only" and this was listed as a key architectural constraint in the Agent & Command Roster. The new description is correct but the surrounding context in CLAUDE.md (line 144: "Commands are orchestration-only -- spawn agents, never do agent work in main session") now has an implicit tension with ambient mode, which does agent work through its orchestration skills rather than through the traditional command orchestration pattern.
- Impact: Developers may be confused about whether `/ambient` is an "orchestration command" (it spawns agents for ORCHESTRATED depth) or a "main session only" command (it was previously documented as such). The convention section should clarify.
- Fix: Consider adding `/ambient` to the orchestration commands preamble: "Orchestration commands (spawn agents, never do agent work in main session) -- except `/ambient` which spawns agents only for ORCHESTRATED depth; QUICK depth stays in main session."

**S2: Ambiguous "Update the README" classification change** - `/Users/dean/Sandbox/devflow/shared/skills/ambient-router/SKILL.md:36`
- Problem: The ambiguous prompt guidance changed from `"Update the README" -> BUILD/GUIDED` to `"Update the README" -> QUICK`. While this is a valid classification conservatism improvement, it contradicts the IMPLEMENT intent signal words on line 29 which include "write" and "make" -- updating a README involves writing. The guidance could be clearer about why README updates are QUICK despite matching IMPLEMENT signal words.
- Impact: AI agents applying this skill may be confused by the apparent contradiction between the signal word table and the ambiguous prompt guidance.
- Fix: Add a brief clarification after the ambiguous prompts line:
  ```
  **Ambiguous prompts:** Default to the lowest-overhead classification. "Update the README" -> QUICK (single-file documentation, not a feature). Git operations like "commit this" -> QUICK.
  ```

### LOW

**S3: Skill catalog removed `search-first` from IMPLEMENT without explanation** - `/Users/dean/Sandbox/devflow/shared/skills/ambient-router/references/skill-catalog.md:13-14`
- Problem: The previous skill catalog listed `search-first` as "Always for BUILD" in the IMPLEMENT (formerly BUILD) intent. The updated catalog drops `search-first` and replaces it with `implementation-orchestration`. The `search-first` skill still exists and is relevant for implementation work, but the catalog no longer references it for IMPLEMENT intent.
- Impact: Low -- the Coder agent may still load `search-first` through its own skill discovery, but the ambient router will no longer explicitly include it.
- Fix: Either add `search-first` back as a secondary skill for IMPLEMENT, or document its removal rationale.

**S4: `test-driven-development` removed from IMPLEMENT primary skills** - `/Users/dean/Sandbox/devflow/shared/skills/ambient-router/references/skill-catalog.md:13`
- Problem: Previously, `test-driven-development` was listed as "Always for BUILD" in the skill catalog. It is now absent from the IMPLEMENT intent entirely. The TDD enforcement moved to the Coder agent frontmatter (see `shared/agents/coder.md:5`), which is a valid architectural choice, but the skill catalog doesn't document this shift.
- Impact: Someone reading only the skill catalog would think TDD is no longer enforced for IMPLEMENT intent. The `test-driven-development/SKILL.md` correctly documents "TDD enforced via Coder agent (skill in Coder frontmatter)" but the skill catalog should cross-reference this.
- Fix: Add a note to the IMPLEMENT section of `skill-catalog.md`:
  ```
  Note: `test-driven-development` is enforced via Coder agent frontmatter, not loaded as an ambient skill.
  ```

## Pre-existing Issues (Not Blocking)

### MEDIUM

**P1: CHANGELOG references stale terminology in historical entries** - `/Users/dean/Sandbox/devflow/CHANGELOG.md:80-81,132-133,151`
- Problem: Historical CHANGELOG entries reference BUILD, GUIDED, ELEVATE, and "auto-loads relevant skills" terminology. While these were accurate at the time of writing, users reading the changelog chronologically may be confused by the terminology shift if no `[Unreleased]` entry explains the rename.
- Impact: Minor -- changelogs are historical records. This is resolved by adding the `[Unreleased]` entry recommended in M2.

**P2: CLAUDE.md skills section mentions "3-tier system" without naming the orchestration tier** - `/Users/dean/Sandbox/devflow/CLAUDE.md:129`
- Problem: The Skills conventions section says "3-tier system: Foundation (shared patterns), Specialized (auto-activate), Domain (language/framework)" but the new orchestration skills (implementation-orchestration, debug-orchestration, plan-orchestration) don't cleanly fit any of these tiers. They are specialized skills that only activate for ORCHESTRATED depth, with `allowed-tools` that include Bash, Task, and AskUserQuestion -- well beyond the read-only default.
- Impact: Developers creating new skills may be unsure how to categorize orchestration skills within the existing tier system.

**P3: `allowed-tools` inconsistency in orchestration skills** - `/Users/dean/Sandbox/devflow/shared/skills/implementation-orchestration/SKILL.md:5`, `/Users/dean/Sandbox/devflow/shared/skills/debug-orchestration/SKILL.md:5`, `/Users/dean/Sandbox/devflow/shared/skills/plan-orchestration/SKILL.md:5`
- Problem: All three orchestration skills list `allowed-tools: Read, Grep, Glob, Bash, Task, AskUserQuestion`. The CLAUDE.md Skills section (line 132) says skills default to read-only with specific exceptions listed. The orchestration skills aren't mentioned in the exceptions list.
- Impact: The exceptions documentation doesn't cover this new category. Currently lists: "git/review skills add Bash, interactive skills add AskUserQuestion, and knowledge-persistence/self-review add Write." Orchestration skills add both Bash and AskUserQuestion plus Task, which is a new combination.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 2 | 1 | 0 |
| Should Fix | 0 | 0 | 2 | 2 |
| Pre-existing | 0 | 0 | 3 | 0 |

**Documentation Score**: 5/10

The core documentation changes (CLAUDE.md, ambient-router SKILL.md, ambient.md command, new orchestration SKILL.md files) are well-written and internally consistent. However, two significant gaps bring the score down: the plugin README.md was not updated at all (still shows the entirely removed GUIDED/ELEVATE model), and the integration tests use stale terminology that will cause them to silently pass without validating the new behavior. The missing CHANGELOG entry is also notable for a feature of this scope.

**Recommendation**: CHANGES_REQUESTED

Blocking issues:
1. **H1** -- Plugin README.md is entirely stale, showing a model that no longer exists
2. **H2** -- Integration tests reference removed terminology (BUILD/GUIDED/ELEVATE) and cannot validate the new behavior
