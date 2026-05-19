# Consistency Review Report

**Branch**: feat/ambient-orchestration -> main
**Date**: 2026-03-19
**PR**: #149
**Commits**: 595cd05 feat(ambient): add agent orchestration to ambient mode, 15849ce fix(ambient): three-tier model, search-first on Coder, debug agent budget
**Files Changed**: 18

---

## Issues in Your Changes (BLOCKING)

### HIGH

**H1: `test-driven-development` absent from ambient-router GUIDED IMPLEMENT skill selection matrix** - `shared/skills/ambient-router/SKILL.md:68`
- Problem: The GUIDED-depth IMPLEMENT row in the skill selection table lists `implementation-patterns, search-first` as primary skills but omits `test-driven-development`. The pre-branch version listed `test-driven-development` as a primary BUILD skill. Step 4 (line 91) still says "If test-driven-development is selected (IMPLEMENT intent), you MUST write the failing test before ANY production code" -- but Step 3's GUIDED table never selects it. The `test-driven-development` skill itself documents (line 133): "IMPLEMENT/GUIDED -> TDD enforced in main session. Write the failing test before production code. Skill loaded directly." This creates a broken contract: the TDD skill says it is loaded for GUIDED, but the router never loads it.
- Impact: TDD enforcement in GUIDED IMPLEMENT mode becomes dead code. Users get skill-loaded implementation without test-first enforcement, violating the documented behavior of both the router and the TDD skill.
- Fix: Add `test-driven-development` to the GUIDED IMPLEMENT primary skills:
  ```
  | **IMPLEMENT** | implementation-patterns, search-first, test-driven-development | typescript (.ts), ... |
  ```
  Also add a `test-driven-development` row to `shared/skills/ambient-router/references/skill-catalog.md` under IMPLEMENT Intent with Depth `GUIDED + ORCHESTRATED (via Coder frontmatter)`.

**H2: `test-driven-development` absent from skill-catalog.md entirely** - `shared/skills/ambient-router/references/skill-catalog.md`
- Problem: The skill-catalog.md was updated to add the three new orchestration skills and the new Depth column, but `test-driven-development` was removed entirely. The old catalog had `test-driven-development | Always for BUILD | *.ts, *.tsx, *.js, *.jsx, *.py`. The new catalog has no row for it under any intent. This means the "full mapping of DevFlow skills to ambient intents" is incomplete.
- Impact: The skill-catalog is the reference document for the ambient-router's selection logic. Missing TDD from it means no reference for when/how TDD is supposed to be loaded.
- Fix: Add a row under IMPLEMENT Intent:
  ```
  | test-driven-development | Always for IMPLEMENT | GUIDED (loaded directly) + ORCHESTRATED (via Coder frontmatter) | Any code file |
  ```

### MEDIUM

**M1: Three new orchestration skills introduce `Task` in `allowed-tools` with no precedent** - `shared/skills/implementation-orchestration/SKILL.md:5`, `shared/skills/debug-orchestration/SKILL.md:5`, `shared/skills/plan-orchestration/SKILL.md:5`
- Problem: All three orchestration skills declare `allowed-tools: Read, Grep, Glob, Bash, Task, AskUserQuestion`. No other skill in the codebase (32 pre-existing) uses `Task`. The established tool vocabulary across all skills includes `Read`, `Grep`, `Glob`, `Bash`, `Edit`, `Write`, and `AskUserQuestion`. The CLAUDE.md skill conventions document exceptions for Bash (git/review skills), AskUserQuestion (interactive skills), and Write (persistence skills) but does not mention `Task`.
- Impact: Introduces a new tool permission pattern without documentation. If `Task` is not a recognized Claude Code tool, it silently does nothing. If it is (e.g., `TaskCreate`/`TaskUpdate`), it sets an undocumented precedent.
- Fix: Either (a) remove `Task` from all three if it is not needed -- orchestration skills primarily describe pipelines for the main session to execute, (b) replace with the correct tool name if different, or (c) document `Task` as a new convention for orchestration-tier skills in `docs/reference/skills-architecture.md`.

**M2: Informal "Explore agent" and "Plan agent" references deviate from established `Task(subagent_type=...)` pattern** - `shared/skills/debug-orchestration/SKILL.md:46`, `shared/skills/plan-orchestration/SKILL.md:33,43`
- Problem: The new orchestration skills say "Spawn Explore agent" and "Spawn Plan agent" informally. The existing `search-first` skill (line 59-62) established a more formal invocation convention: `Task(subagent_type="Explore")` with a structured prompt template. The new skills do not use this syntax. Neither "Explore" nor "Plan" appear in the `devflow-ambient` plugin.json agents array (since they are inline subagents, not shared agent definitions).
- Impact: Two conventions coexist for referencing inline subagents. The `search-first` skill uses the formal `Task(subagent_type=...)` syntax while the new orchestration skills use informal "Spawn X agent" prose. The `synthesizer.md` agent also uses the informal style ("4 Explore agents"), so the new skills are not without precedent, but the inconsistency between skills is notable.
- Fix: This is a judgment call. At minimum, add a note in each orchestration skill clarifying that "Explore" and "Plan" are inline subagent types, not shared agent definitions. Optionally, adopt the `Task(subagent_type="Explore")` format for consistency with `search-first`.

**M3: Description string diverges across five locations** - multiple files
- Problem: The ambient plugin description appears in five places with three distinct phrasings:
  - `plugin.json:3` + `plugins.ts:73`: "intent classification with proportional agent orchestration"
  - `README.md:69`: "intent classification with agent orchestration" (missing "proportional")
  - `CLAUDE.md:25`: "three-tier intent classification (QUICK/GUIDED/ORCHESTRATED)"
  - `plugins/devflow-ambient/README.md:3`: "auto-classifies intent and applies proportional skill enforcement with optional agent orchestration"
- Impact: The existing codebase convention (visible for `devflow-implement`, `devflow-debug`, etc.) is that `plugin.json` and `plugins.ts` share the exact same description string. `CLAUDE.md` uses its own table format. The `README.md` table should match `plugin.json` but does not.
- Fix: Update `README.md:69` to match the `plugin.json`/`plugins.ts` description: "intent classification with proportional agent orchestration". The `CLAUDE.md` format is acceptable as-is since it uses a different descriptive style for its table.

**M4: `ambient-router` skill description frontmatter does not mention agent orchestration** - `shared/skills/ambient-router/SKILL.md:3`
- Problem: The skill `description` metadata still says: "This skill should be used when classifying user intent for ambient mode, auto-loading relevant skills without explicit command invocation." This was accurate for the pre-orchestration model but now understates the skill's purpose -- it also orchestrates agents for ORCHESTRATED depth.
- Impact: Skill descriptions are used for discovery and auto-activation. An incomplete description may lead to the skill not being loaded when agent orchestration is the primary need.
- Fix: Update to: "This skill should be used when classifying user intent for ambient mode, auto-loading relevant skills and orchestrating agents without explicit command invocation."

### LOW

**L1: Agent list ordering inconsistency in plugin.json** - `plugins/devflow-ambient/.claude-plugin/plugin.json:18-26`
- Problem: The agents array lists `coder, validator, simplifier, scrutinizer, shepherd, skimmer, reviewer`. The `devflow-implement` plugin (which shares most of these agents) uses order: `git, skimmer, synthesizer, coder, simplifier, scrutinizer, shepherd, validator`. The ambient plugin orders them differently and omits `git` and `synthesizer`.
- Impact: Minor. No functional impact. The existing convention appears to be pipeline-order rather than alphabetical.
- Fix: Consider reordering to match approximate pipeline flow: `skimmer, coder, validator, simplifier, scrutinizer, shepherd, reviewer`.

---

## Issues in Code You Touched (Should Fix)

### MEDIUM

**S1: Coder agent skills expanded without body documentation update** - `shared/agents/coder.md:5`
- Problem: The Coder agent skills line grew from 6 to 8 skills (adding `test-driven-development` and `search-first`). The agent's body text (Responsibilities section) does not mention TDD enforcement or search-first research. The Principles section says "Pattern discovery first" which partially covers `search-first`, but the strict RED-GREEN-REFACTOR requirement from `test-driven-development` is not reflected in the Responsibilities section.
- Impact: An implementor reading only the Coder agent body would not know TDD is enforced. The behavioral change is invisible without examining the frontmatter.
- Fix: Add a brief note in the Responsibilities section, e.g., "2.5. **Enforce TDD**: When `test-driven-development` skill is loaded, follow RED-GREEN-REFACTOR cycle for all new code."

**S2: `TASK_ID` example year differs between Coder agent and implementation-orchestration** - `shared/agents/coder.md:15` vs `shared/skills/implementation-orchestration/SKILL.md:44`
- Problem: The Coder agent shows example `TASK_ID: "task-2025-01-15_1430"` (2025) while implementation-orchestration shows `"task-2026-03-19_1430"` (2026). These are illustrative examples, but inconsistent years in related documents can cause confusion.
- Impact: Trivial. Both correctly show the format pattern.
- Fix: Update the Coder agent example to use 2026 for consistency, since the agent was modified in this branch.

---

## Pre-existing Issues (Not Blocking)

### MEDIUM

**P1: `devflow-debug` plugin agents differ significantly from ambient debug pipeline agents** - `plugins/devflow-debug/.claude-plugin/plugin.json`
- Problem: The `/debug` command plugin lists only `git, synthesizer` as agents. The ambient debug-orchestration pipeline references Explore agents and optionally chains to `implementation-orchestration` (which uses Coder, Validator, Simplifier, Scrutinizer, Shepherd). The two debug workflows have very different agent footprints.
- Impact: This is an intentional architectural difference (`/debug` uses Agent Teams, ambient debug uses a pipeline pattern). Informational only.

### LOW

**P2: Skill count hardcoded in documentation** - `CLAUDE.md:47`, `README.md:27`
- Problem: Both files now say "35 skills" and the actual count is 35. But this is a maintenance hazard -- any future skill addition requires manual updates.
- Impact: None currently. Accurate as of this branch.
- Fix: No action needed. Consider build-time generation in a future iteration.

---

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 2 | 4 | 1 |
| Should Fix | - | 0 | 2 | - |
| Pre-existing | - | - | 1 | 1 |

**Consistency Score**: 6/10
**Recommendation**: CHANGES_REQUESTED

### What is Consistent (Positive)

- The BUILD->IMPLEMENT rename is applied thoroughly and correctly across all 18 files (ambient-router, skill-catalog, command, hook, tests, helpers, README, CLAUDE.md, CHANGELOG).
- The ELEVATE->ORCHESTRATED rename is similarly complete.
- The three new orchestration skills follow a consistent internal structure: frontmatter with identical `allowed-tools`, Phase-based organization, Iron Law section, Error Handling section, and line counts within the 70-91 line range (within the ~120-150 target).
- Test helpers (`extractIntent`, `extractDepth`, `hasClassification`) correctly updated their regex patterns to match the new vocabulary.
- The second commit (15849ce) correctly restored the three-tier model (QUICK/GUIDED/ORCHESTRATED) and added `search-first` to the Coder agent.

### What Needs Attention

1. **TDD skill selection gap** (H1, H2): `test-driven-development` is documented as enforced at GUIDED depth but is absent from both the router's selection matrix and the skill-catalog. This is the most significant consistency issue -- a broken contract between documented behavior and actual configuration.
2. **New `Task` tool pattern** (M1): Three skills introduce an unprecedented tool permission without documentation or precedent.
3. **Informal agent references** (M2): "Explore agent" and "Plan agent" are referenced without the formal `Task(subagent_type=...)` syntax used in existing skills.
4. **Description drift** (M3): Plugin description differs across surfaces where the convention is identical strings.
5. **Stale skill description** (M4): The ambient-router's frontmatter description does not reflect agent orchestration capabilities.

### Blocking Issues for Merge

The two HIGH issues (H1, H2) represent a real behavioral inconsistency that would confuse both the system and developers. The TDD skill explicitly documents integration with GUIDED depth, but the router's selection logic never activates it at that depth. This should be resolved before merge.
