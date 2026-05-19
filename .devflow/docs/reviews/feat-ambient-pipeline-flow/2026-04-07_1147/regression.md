# Regression Review Report

**Branch**: feat/ambient-pipeline-flow -> main
**Date**: 2026-04-07_1147

## Issues in Your Changes (BLOCKING)

### HIGH

**Router SKILL.md drops skills for ORCHESTRATED DEBUG, RESOLVE, and PLAN compared to prior version and own skill-catalog.md** - `shared/skills/router/SKILL.md:30-36`
**Confidence**: 92%
- Problem: The new lean router SKILL.md ORCHESTRATED table omits skills that were present in the old version and are still documented as "Always for {intent}" in `shared/skills/router/references/skill-catalog.md`:
  - **DEBUG/ORCHESTRATED**: Old had `devflow:debug:orch, devflow:test-driven-development, devflow:software-design`. New has only `devflow:debug:orch`. Lost: `devflow:test-driven-development`, `devflow:software-design`.
  - **RESOLVE/ORCHESTRATED**: Old had `devflow:resolve:orch, devflow:test-driven-development, devflow:software-design`. New has only `devflow:resolve:orch`. Lost: `devflow:test-driven-development`, `devflow:software-design`.
  - **PLAN/ORCHESTRATED**: Old had `devflow:plan:orch, devflow:test-driven-development, devflow:patterns, devflow:software-design`. New has `devflow:plan:orch, devflow:patterns, devflow:software-design, devflow:security`. Lost: `devflow:test-driven-development`. Gained: `devflow:security`.
- Impact: When ambient mode classifies a prompt as DEBUG/ORCHESTRATED or RESOLVE/ORCHESTRATED, the model will no longer load `devflow:test-driven-development` and `devflow:software-design` skills, reducing quality enforcement. The skill-catalog.md reference file explicitly states these are "Always for DEBUG" and "Always for RESOLVE" at ORCHESTRATED depth. This creates a drift between the reference doc and the actual routing table.
- Fix: Either (a) restore the dropped skills to the ORCHESTRATED table rows in router SKILL.md to match skill-catalog.md, or (b) intentionally update skill-catalog.md to reflect the new leaner approach and document the rationale. The integration test for RESOLVE/ORCHESTRATED was already updated to only assert `resolve:orch` (removing `software-design`), suggesting this was intentional — but skill-catalog.md was not updated to match.

**pipeline:orch removes AskUserQuestion from allowed-tools, eliminating user gates between stages** - `shared/skills/pipeline:orch/SKILL.md:5`
**Confidence**: 95%
- Problem: The `allowed-tools` for `pipeline:orch` changed from `Read, Grep, Glob, Bash, Task, AskUserQuestion` to `Read, Grep, Glob, Bash, Task`. The Iron Law changed from "USER GATES BETWEEN STAGES" to "FULL PIPELINE, NO INTERRUPTIONS". Phases 2 and 4 changed from interactive gates (AskUserQuestion with user approval) to auto-proceeding status logs. The error handling section removed the "User declines gate" case.
- Impact: This is an intentional behavior change — the pipeline now auto-chains implement -> review -> resolve without user confirmation at any stage. If the review finds CRITICAL blocking issues (e.g., security vulnerabilities), the pipeline will auto-resolve them without human judgment. Previously, the user had the opportunity to inspect findings and decline auto-resolution. This is a significant behavioral regression for users who relied on the gates.
- Fix: If this is intentional (which the Iron Law rewrite strongly suggests), document the breaking change. Consider whether a `--no-gates` flag or similar opt-in mechanism would be more appropriate than removing the gates entirely. At minimum, update the README/CLAUDE.md Ambient Mode description to reflect that PIPELINE no longer pauses for user input.

### MEDIUM

**Router SKILL.md removes edge case handling, classification conservatism guidance, and IMPORTANT block** - `shared/skills/router/SKILL.md`
**Confidence**: 85%
- Problem: The old router SKILL.md contained substantial operational guidance that was removed:
  - 14 edge case rules (mixed intent, continuation behavior, REVIEW depth-matching, scope ambiguity, etc.)
  - Classification conservatism guidance ("prefer GUIDED — escalate only when scope clearly exceeds main-session capacity")
  - The `<IMPORTANT>` block enforcing skill-loading-first behavior and TDD enforcement for IMPLEMENT
  - GUIDED Behavior by Intent table (defining post-work actions like Simplifier spawning per intent)
  - Ambiguous prompt handling rules ("Update the README" -> QUICK, git ops -> QUICK)
- Impact: The classification rules in `classification-rules.md` cover the basic depth criteria, but the fine-grained edge cases were not migrated there. The model may now handle edge cases inconsistently (e.g., mixed intents, REVIEW after IMPLEMENT continuation, scope ambiguity). The classification-rules.md says "Default to ORCHESTRATED for substantive work" which reverses the old conservatism of "prefer GUIDED." This is a significant behavioral change — more prompts will trigger full orchestration.
- Fix: If the simplified approach is intentional, at minimum verify that the edge cases are handled correctly by the model with just the lean classification rules. Consider adding a "## Edge Cases" section to classification-rules.md for the most impactful scenarios (mixed intent, continuation behavior, REVIEW depth-matching).

**Classification bias shifted from GUIDED-conservative to ORCHESTRATED-default** - `shared/skills/router/references/classification-rules.md:22-24`
**Confidence**: 90%
- Problem: The old router said "Classification conservatism: When choosing between GUIDED and ORCHESTRATED, prefer GUIDED — escalate only when scope clearly exceeds main-session capacity." The new classification-rules.md says "Default to ORCHESTRATED for substantive work — it produces better results. Reserve GUIDED for small focused changes where orchestration adds no value." This inverts the default.
- Impact: Users who were accustomed to GUIDED-first behavior will now see significantly more ORCHESTRATED classifications, meaning more agent spawning, longer execution times, and higher API costs. While this may produce better quality, it is a behavioral change that affects cost and latency.
- Fix: This appears intentional based on the description "it produces better results." Document this change in the release notes.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**skill-catalog.md is now stale relative to router SKILL.md** - `shared/skills/router/references/skill-catalog.md:30-56`
**Confidence**: 92%
- Problem: `skill-catalog.md` still lists `devflow:test-driven-development` and `devflow:software-design` as "Always for DEBUG" and "Always for RESOLVE" at ORCHESTRATED depth, but the new router SKILL.md table no longer includes them for those intents. The `skill-catalog.md` also says `devflow:test-driven-development` is "Always for PLAN" at both GUIDED + ORCHESTRATED, but the new ORCHESTRATED PLAN row omits it (while adding `devflow:security`).
- Fix: Update `skill-catalog.md` to match the new router tables, or restore the skills in the router tables if the catalog is the source of truth.

**PIPELINE skill-catalog.md description updated but not consistent with removed gates** - `shared/skills/router/references/skill-catalog.md:68`
**Confidence**: 85%
- Problem: The line changed from "PIPELINE is always ORCHESTRATED -- it chains multiple orchestration stages with user gates" to "...with status reporting between phases." This correctly reflects the pipeline:orch change, but the catalog still lists `devflow:pipeline:orch` with its old purpose description. It does not mention that the pipeline no longer pauses for user confirmation.
- Fix: Add a note to the catalog entry that PIPELINE runs uninterrupted.

## Pre-existing Issues (Not Blocking)

No CRITICAL pre-existing issues found.

## Suggestions (Lower Confidence)

- **Duplicate frontmatter in router SKILL.md** - `shared/skills/router/SKILL.md` (Confidence: 75%) — The file appears to contain its frontmatter block twice (lines 1-5 and again later). This is likely a build/diff artifact from the duplicated skill content pattern, but could cause issues if skills are parsed naively.

- **GUIDED EXPLORE row has no skills ("---")** - `shared/skills/router/SKILL.md:21` (Confidence: 65%) — The EXPLORE/GUIDED row maps to no skills, while the old router loaded `devflow:explore:orch` for GUIDED EXPLORE. The prose says "GUIDED EXPLORE: spawn Skimmer + Explore agents" but no skill is loaded to guide this behavior. This may work fine since the prose instruction is present, but the asymmetry with old behavior could lead to less structured exploration.

- **`Task` still in pipeline:orch allowed-tools** - `shared/skills/pipeline:orch/SKILL.md:5` (Confidence: 60%) — The allowed-tools lists `Task` but the commands across the codebase were changed from `Task(...)` to `Agent(...)`. If `Task` was renamed to `Agent` at the platform level, `Task` in allowed-tools might be stale. However, if both names are supported, this is fine.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 2 | 2 | 0 |
| Should Fix | 0 | 0 | 2 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Regression Score**: 5/10
**Recommendation**: CHANGES_REQUESTED
