# Consistency Review Report

**Branch**: feat/ambient-pipeline-flow -> main
**Date**: 2026-04-07

## Issues in Your Changes (BLOCKING)

### HIGH

**`allowed-tools` frontmatter still references `Task` while all body text migrated to `Agent` (7 occurrences)** -- Confidence: 95%
- `shared/skills/pipeline:orch/SKILL.md:5`, `shared/skills/implement:orch/SKILL.md:5`, `shared/skills/debug:orch/SKILL.md:5`, `shared/skills/explore:orch/SKILL.md:5`, `shared/skills/plan:orch/SKILL.md:5`, `shared/skills/review:orch/SKILL.md:5`, `shared/skills/resolve:orch/SKILL.md:5`
- Problem: This PR systematically renames `Task(subagent_type=...)` to `Agent(subagent_type=...)` across all commands and orchestration skill bodies. However, the `allowed-tools` frontmatter in every `:orch` skill still lists `Task` instead of `Agent`. This is an incomplete migration -- the body text says `Agent(...)` but the metadata that declares which tools the skill may use still says `Task`.
- Fix: Update all 7 `:orch` skill frontmatter lines to replace `Task` with `Agent`:
  ```yaml
  # Before
  allowed-tools: Read, Grep, Glob, Bash, Task
  # After
  allowed-tools: Read, Grep, Glob, Bash, Agent
  ```
  Same for the 5 skills that include `AskUserQuestion`.

**`pipeline:orch` removed `AskUserQuestion` from `allowed-tools` but other orch skills still have it** -- Confidence: 85%
- `shared/skills/pipeline:orch/SKILL.md:5`
- Problem: The diff shows `pipeline:orch` changed its `allowed-tools` from `Read, Grep, Glob, Bash, Task, AskUserQuestion` to `Read, Grep, Glob, Bash, Task` (removing `AskUserQuestion`). This is intentional (pipeline no longer has user gates), but the frontmatter metadata should be internally consistent with the new design. Since `pipeline:orch` loads sub-skills that may use `AskUserQuestion` (like `implement:orch` which chains to Evaluator), the `allowed-tools` of the loader does not propagate restrictions. However, this is a deliberate design change aligned with the new "no interruptions" Iron Law. The inconsistency with other orch skills is acceptable and intentional.
- Fix: No action needed -- this is a design-intentional deviation, not an oversight.

### MEDIUM

**CLI status message still says "UserPromptSubmit hook" but ambient now manages two hooks** -- Confidence: 85%
- `src/cli/commands/ambient.ts:221`
- Problem: The `--enable` success message says `'Ambient mode enabled — UserPromptSubmit hook registered'` but the `addAmbientHook` function now registers both a `UserPromptSubmit` preamble hook AND a `SessionStart` classification hook. The message is incomplete and could confuse users who inspect their `settings.json` and see two hooks where the message implies one.
- Fix:
  ```typescript
  // Before
  p.log.success('Ambient mode enabled — UserPromptSubmit hook registered');
  // After
  p.log.success('Ambient mode enabled — hooks registered');
  ```

**`hasAmbientHook` only checks `UserPromptSubmit`, not `SessionStart` classification hook** -- Confidence: 82%
- `src/cli/commands/ambient.ts:138-150`
- Problem: The `hasAmbientHook` function (used by `--status`) only checks for the preamble hook in `UserPromptSubmit`. It does not check for the `SessionStart` classification hook. If a user somehow has only one of the two hooks (e.g., partial upgrade), `--status` would report enabled even if the classification hook is missing. This is a minor inconsistency since both hooks are always added/removed together, but it breaks the symmetry with the add/remove functions which now manage both hooks.
- Fix: Consider adding a check for the `SessionStart` classification hook as well, or at minimum document that `hasAmbientHook` checks preamble presence as the canonical "enabled" indicator.

**GUIDED PLAN skills differ between router table and skill-catalog.md** -- Confidence: 80%
- `shared/skills/router/SKILL.md:23` vs `shared/skills/router/references/skill-catalog.md`
- Problem: The new router SKILL.md adds `devflow:security` to the GUIDED PLAN row (`devflow:test-driven-development, devflow:patterns, devflow:software-design, devflow:security`). The old router had `devflow:test-driven-development, devflow:plan:orch, devflow:patterns, devflow:software-design` for GUIDED PLAN. The skill-catalog.md reference still lists `devflow:plan:orch` as loaded for GUIDED PLAN, but the new router table does not include `devflow:plan:orch` for GUIDED (it is only in ORCHESTRATED). This is a cross-reference drift between the SKILL.md and its reference document.
- Fix: Verify `skill-catalog.md` PLAN section matches the new router table. If `plan:orch` should not load for GUIDED, update skill-catalog.md accordingly. If `devflow:security` was intentionally added to GUIDED PLAN, add it to the skill-catalog.md PLAN section as well.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**ORCHESTRATED DEBUG and RESOLVE lost skills in the router table compared to prior version** -- Confidence: 80%
- `shared/skills/router/SKILL.md:32-35`
- Problem: The old router ORCHESTRATED table included additional skills for certain intents: DEBUG had `devflow:debug:orch, devflow:test-driven-development, devflow:software-design` and RESOLVE had `devflow:resolve:orch, devflow:test-driven-development, devflow:software-design`. The new lean router table has DEBUG as just `devflow:debug:orch` and RESOLVE as just `devflow:resolve:orch`. This may be intentional (those sub-skills are loaded by the orch skill internally), but it is a behavioral change -- previously the router loaded TDD and software-design skills into the main session for DEBUG/ORCHESTRATED, and now it does not.
- Fix: If intentional, add a comment in the skill-catalog.md noting that ORCHESTRATED DEBUG/RESOLVE secondary skills are loaded internally by the orch skill. If unintentional, restore the additional skills.

**`--enable` and `--disable` option descriptions not updated for SessionStart hook** -- Confidence: 80%
- `src/cli/commands/ambient.ts:160-161`
- Problem: The `--enable` description says `'Register UserPromptSubmit hook for ambient mode'` and `--disable` says `'Remove ambient mode hook'`. With the new two-hook architecture, these descriptions are incomplete.
- Fix:
  ```typescript
  .option('--enable', 'Register ambient mode hooks')
  .option('--disable', 'Remove ambient mode hooks')
  ```

## Pre-existing Issues (Not Blocking)

No CRITICAL pre-existing issues found.

## Suggestions (Lower Confidence)

- **`allowed-tools` comment removed from router SKILL.md frontmatter** - `shared/skills/router/SKILL.md:4` (Confidence: 65%) -- The old router had `# No allowed-tools: orchestrator requires unrestricted access (Skill, Agent, Edit, Write, Bash)` as an explanatory comment. The new version simply omits `allowed-tools` without documenting why. This is consistent with the documented convention ("router omits allowed-tools entirely — unrestricted, as the main-session orchestrator" per CLAUDE.md), but the inline comment was helpful context.

- **`pipeline:orch` Iron Law changed from cautious to aggressive without cross-reference update** - `shared/skills/pipeline:orch/SKILL.md:13-16` (Confidence: 70%) -- The Iron Law changed from "USER GATES BETWEEN STAGES / Never auto-chain..." to "FULL PIPELINE, NO INTERRUPTIONS / Pipeline runs end-to-end without pausing." The skill-catalog.md still says "PIPELINE is always ORCHESTRATED -- it chains multiple orchestration stages with status reporting between phases" (updated), but the README.md or CLAUDE.md may not reflect this new autonomous behavior.

- **`Task` → `Agent` rename is purely syntactic in markdown command files** - across all command `.md` files (Confidence: 60%) -- The rename from `Task(subagent_type=...)` to `Agent(subagent_type=...)` appears across ~15 command and skill files. This is presumably tracking a Claude Code platform API change. The consistency of the rename is excellent (all occurrences migrated), but it is worth verifying that the platform actually supports `Agent(...)` syntax.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 2 | 0 |
| Should Fix | 0 | 0 | 2 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Consistency Score**: 7/10
**Recommendation**: CHANGES_REQUESTED

The `Task` to `Agent` rename is applied consistently across all command bodies and orchestration skill bodies, which is good. However, the `allowed-tools` frontmatter in all 7 `:orch` skills still references `Task` instead of `Agent`, creating an inconsistency between metadata and content. The new two-hook architecture (preamble + classification) is well-implemented in the core functions but the CLI messaging and status detection have not been fully updated to reflect the dual-hook design. The router simplification (from ~250-line monolith to ~50-line lookup table + separate classification-rules.md) is cleanly executed but introduces minor drift with the skill-catalog.md reference document.
