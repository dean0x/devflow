# Documentation Review Report

**Branch**: feat/ambient-pipeline-flow -> main
**Date**: 2026-04-07

## Issues in Your Changes (BLOCKING)

### HIGH

**pipeline:orch behavioral change undocumented — user gates removed** - `shared/skills/pipeline:orch/SKILL.md:8-17`
**Confidence**: 90%
- Problem: The pipeline:orch skill's Iron Law changed from "USER GATES BETWEEN STAGES" (requiring user confirmation between implement/review/resolve) to "FULL PIPELINE, NO INTERRUPTIONS" (auto-proceeding). `AskUserQuestion` was removed from `allowed-tools`. This is a significant user-facing behavioral change: users who previously had the option to stop between pipeline stages no longer can. Neither CLAUDE.md, the Ambient README, nor the main README document this change. The error handling section also silently removed the "User declines gate" case.
- Fix: Add a sentence to the CLAUDE.md Ambient Mode paragraph or the devflow-ambient README noting that PIPELINE intent runs end-to-end without pauses. The Ambient README's ORCHESTRATED Pipelines table already shows the pipeline stages but should note the auto-proceed behavior.

### MEDIUM

**CLAUDE.md says classification-rules.md is "~25 lines" but file is 32 lines** - `CLAUDE.md:43`
**Confidence**: 82%
- Problem: The new Ambient Mode paragraph in CLAUDE.md states classification-rules.md is "~25 lines". The actual file is 32 lines (including blank lines). While "~" indicates approximation, 32 is 28% more than 25 — at the edge of what "approximately" covers. This matters because the line count is used to communicate the token cost/size of the SessionStart injection.
- Fix: Update to "~30 lines" for a more accurate approximation.

**Ambient README QUICK depth description drifted from classification-rules.md** - `plugins/devflow-ambient/README.md:257`
**Confidence**: 83%
- Problem: The README's Three-Tier Classification table describes QUICK as "Chat, exploration, git ops, config, trivial edits". The new canonical classification-rules.md describes QUICK as "CHAT intent. Simple lookups. Git/devops ops. Config changes. Rename/comment tweaks. 1-2 line edits." The README says "exploration" (broad) while the rules say "simple lookups" (narrow). This inconsistency could confuse contributors about what qualifies as QUICK.
- Fix: Align the README's QUICK description to say "Chat, simple lookups, git ops, config, trivial edits" matching classification-rules.md.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Ambient README GUIDED PLAN row missing devflow:security skill** - `plugins/devflow-ambient/README.md:280`
**Confidence**: 85%
- Problem: The Ambient README's GUIDED Behavior table for PLAN intent shows skills as "patterns, software-design" but the updated router SKILL.md GUIDED table lists PLAN skills as "devflow:test-driven-development, devflow:patterns, devflow:software-design, devflow:security". The README is missing `test-driven-development` and `security` from the PLAN/GUIDED row. While the README may be intentionally abbreviated, it is now inconsistent with the canonical router skill table.
- Fix: Either update the README GUIDED table to match the router, or add a note that the README shows primary skills only and the router SKILL.md is authoritative.

**`Task` renamed to `Agent` across 12 command files but `allowed-tools` in pipeline:orch still lists `Task`** - `shared/skills/pipeline:orch/SKILL.md:5`
**Confidence**: 92%
- Problem: The diff shows a systematic rename from `Task(subagent_type="...")` to `Agent(subagent_type="...")` across all command and skill files. However, pipeline:orch's frontmatter still has `allowed-tools: Read, Grep, Glob, Bash, Task` — using the old `Task` tool name instead of `Agent`. If the tool was renamed at the platform level, this reference is stale.
- Fix: Verify whether the Claude Code platform tool is now `Agent` instead of `Task`. If so, update the `allowed-tools` line to `Read, Grep, Glob, Bash, Agent`. If the tool name in `allowed-tools` is still `Task` at the platform level while the invocation syntax changed, no fix is needed.

## Pre-existing Issues (Not Blocking)

No pre-existing documentation issues found.

## Suggestions (Lower Confidence)

- **Router SKILL.md removed edge case documentation** - `shared/skills/router/SKILL.md` (Confidence: 75%) — The old router SKILL.md had an extensive "Edge Cases" section covering mixed intent, continuations, scope ambiguity, REVIEW depth matching, and EXPLORE tiers. The new lean router has no edge case guidance. The classification-rules.md covers basic depth defaults but not these edge cases. This documentation was valuable for understanding classification behavior in ambiguous scenarios. Consider moving key edge cases to `references/classification-rules.md` or a new `references/edge-cases.md`.

- **Router SKILL.md removed Iron Law section** - `shared/skills/router/SKILL.md` (Confidence: 68%) — Every other skill has an Iron Law per CLAUDE.md conventions ("Each skill has one non-negotiable Iron Law in its SKILL.md"). The new router SKILL.md omits it entirely. The old Iron Law was "PROPORTIONAL RESPONSE MATCHED TO SCOPE".

- **classification-rules.md depth default changed from GUIDED-conservative to ORCHESTRATED-default** - `shared/skills/router/references/classification-rules.md:23-24` (Confidence: 72%) — The old router said "When choosing between GUIDED and ORCHESTRATED, prefer GUIDED". The new classification-rules.md says "Default to ORCHESTRATED for substantive work". This is a deliberate policy change but is not called out in commit messages or documentation as an intentional shift.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 2 | 0 |
| Should Fix | 0 | 0 | 2 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Documentation Score**: 7/10
**Recommendation**: CHANGES_REQUESTED

The documentation changes are generally well-executed. The `Task` to `Agent` rename is consistent across all 12+ command/skill files, CLAUDE.md is updated with the new three-layer architecture description, and the new classification-rules.md is clean and well-structured. The primary concerns are: (1) the pipeline:orch behavioral change (removing user gates) should be documented since it changes user-facing behavior, (2) minor alignment issues between the Ambient README and the now-canonical classification-rules.md, and (3) the `allowed-tools` in pipeline:orch may reference a stale tool name.
