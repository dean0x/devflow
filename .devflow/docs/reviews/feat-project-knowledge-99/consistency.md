# Skills Consistency Audit Report

**Branch**: feat/project-knowledge-99
**Date**: 2026-03-14
**Scope**: All 32 skills in `shared/skills/`

---

## Executive Summary

32 skills audited against the canonical spec in `docs/reference/skills-architecture.md`. 22 skills are fully compliant. 10 skills have violations of varying severity. Four skills are missing from the architecture reference document entirely.

---

## Issues in Your Changes (BLOCKING)

### CRITICAL

None.

### HIGH

**H1: `knowledge-persistence` -- missing `references/` directory** - `/Users/dean/Sandbox/devflow/shared/skills/knowledge-persistence/SKILL.md`
- Problem: This is the only skill in the entire codebase without a `references/` subdirectory. The skills-architecture spec states that progressive disclosure to `references/` is a core convention for all skills.
- Fix: Create `references/` directory. Consider extracting the lock protocol details and template examples into `references/procedure.md`.

**H2: `knowledge-persistence` -- description does not follow required format** - `/Users/dean/Sandbox/devflow/shared/skills/knowledge-persistence/SKILL.md:4`
- Problem: Description is `"Canonical procedure for recording architectural decisions and pitfalls to project knowledge files"`. The skills-architecture spec (line 147) requires descriptions to start with `"This skill should be used when..."`.
- Fix: Change to `"This skill should be used when recording architectural decisions (ADR entries) or pitfalls (PF entries) to .memory/knowledge/ files. Provides the canonical extraction procedure for decisions.md and pitfalls.md."`.

**H3: `ambient-router` -- description does not follow required format** - `/Users/dean/Sandbox/devflow/shared/skills/ambient-router/SKILL.md:3-6`
- Problem: Description is a multi-line YAML block scalar that starts with `"Classify user intent..."` instead of the required `"This skill should be used when..."` format.
- Fix: Change to `"This skill should be used when classifying user intent for ambient mode, determining response depth (QUICK/GUIDED/ELEVATE), or auto-loading relevant skills without explicit command invocation."`.

**H4: `search-first` -- description does not follow required format** - `/Users/dean/Sandbox/devflow/shared/skills/search-first/SKILL.md:3-6`
- Problem: Description uses a multi-line YAML block scalar starting with `"This skill should be used when the user asks to..."` which passes the pattern check, but the multi-line YAML format is inconsistent with the majority of skills that use single-line descriptions. The spec does not explicitly endorse or prohibit multi-line YAML block scalars.
- Fix: Consider collapsing to a single-line `description:` for consistency with other skills, or formally document multi-line YAML as acceptable.

**H5: `knowledge-persistence` -- only 89 lines, well below 120-150 target** - `/Users/dean/Sandbox/devflow/shared/skills/knowledge-persistence/SKILL.md`
- Problem: At 89 lines, this is the shortest skill in the codebase. The spec targets ~120-150 lines. The skill contains procedure steps that could benefit from examples.
- Fix: Add inline examples of complete ADR and PF entries (currently only templates are shown), and add a `references/` directory for extended patterns.

**H6: `ambient-router` -- only 96 lines, below 120-150 target** - `/Users/dean/Sandbox/devflow/shared/skills/ambient-router/SKILL.md`
- Problem: At 96 lines, this is the second shortest skill. The references section mentions `references/skill-catalog.md` but the skill itself is lean.
- Fix: Consider adding 1-2 inline classification examples showing the full QUICK/GUIDED/ELEVATE decision flow.

---

## Issues in Code You Touched (Should Fix)

### HIGH

**S1: Four skills missing from `docs/reference/skills-architecture.md`**
- `knowledge-persistence` -- not listed in any tier table
- `ambient-router` -- not listed in any tier table
- `search-first` -- not listed in any tier table
- `test-driven-development` -- not listed in any tier table
- Problem: The skills-architecture document lists 28 skills across its tier tables, but 32 skills exist on disk. These 4 are undocumented in the architecture reference.
- Fix: Add `knowledge-persistence` to Tier 1 Foundation (used by multiple commands for knowledge extraction). Add `search-first` to Tier 2 Specialized (auto-activate for utility code). Add `ambient-router` and `test-driven-development` to Tier 2 Specialized (auto-activate via ambient mode).

### MEDIUM

**S2: `allowed-tools` inconsistency across skills** - Multiple files
- Problem: The CLAUDE.md states "Skills are read-only (`allowed-tools: Read, Grep, Glob`)" but actual usage varies widely:
  - Standard pattern (`Read, Grep, Glob`): 20 skills -- this is the de facto norm
  - With `AskUserQuestion` added: `core-patterns`, `input-validation`, `test-patterns` (3 skills)
  - With `Bash` added: `review-methodology`, `git-safety`, `git-workflow`, `github-patterns`, `knowledge-persistence` (5 skills)
  - With `Write` added: `knowledge-persistence` (1 skill)
  - With `Edit, Write, Bash` added: `self-review` (1 skill)
  - `docs-framework` uses `Read, Bash, Glob` (missing `Grep`)
- Impact: The "read-only" claim in CLAUDE.md is inaccurate for 12 of 32 skills. Several have legitimate reasons for write tools (self-review fixes code, knowledge-persistence writes to .memory/, git skills run git commands). But the exceptions are undocumented.
- Fix: Either update CLAUDE.md to say "Skills are typically read-only (`Read, Grep, Glob`), with documented exceptions for skills that modify files" and list the exceptions, or enforce the read-only constraint more strictly.

**S3: `test-driven-development` not in glob pattern activation table** - `/Users/dean/Sandbox/devflow/docs/reference/skills-architecture.md:203`
- Problem: The skill has an `activation:` block with file patterns, but is not listed in the glob pattern activation table that documents other skills with activation patterns.
- Fix: Add `test-driven-development` row to the glob pattern activation table with its file patterns (`**/*.ts`, `**/*.tsx`, `**/*.js`, `**/*.jsx`, `**/*.py`).

**S4: Several skills exceed the 150-line target significantly**
- `react`: 276 lines (84% over target)
- `frontend-design`: 254 lines (69% over target)
- `accessibility`: 229 lines (53% over target)
- `rust`: 193 lines (29% over target)
- `python`: 188 lines (25% over target)
- `go`: 187 lines (25% over target)
- `java`: 183 lines (22% over target)
- `test-patterns`: 183 lines (22% over target)
- `typescript`: 176 lines (17% over target)
- Problem: These skills have grown beyond the ~120-150 line target. All have `references/` directories but have not fully leveraged progressive disclosure.
- Fix: Consider extracting extended patterns from the largest offenders (`react`, `frontend-design`, `accessibility`) into their `references/` directories. The Tier 3 language skills are moderately over but may be acceptable given they cover entire languages.

---

## Pre-existing Issues (Not Blocking)

### MEDIUM

**P1: Section heading inconsistency across skills**
- 15 skills use `## When This Skill Activates` while 17 skip it entirely.
- The skills-architecture template shows this as a standard section. Pattern skills (Tier 1b) omit it consistently, which may be intentional since they activate via Reviewer dynamic lookup.
- Impact: Minor inconsistency. Acceptable if the pattern is documented.

**P2: Checklist section naming varies**
- `## Checklist` (7 skills), `## Success Criteria` (1 skill), `## Quality Gates` (1 skill), `## {Name} Checklist` (5 skills), `## Implementation Checklist` (2 skills), various compound names (2 skills).
- The template shows `## Success Criteria` but `## Checklist` is the de facto norm.
- Impact: No functional impact but visually inconsistent.

**P3: Extended References section format varies**
- Some use a table format, some use bullet lists, some use bold links.
- No functional impact but slightly inconsistent presentation.

### LOW

**P4: `docs-framework` missing `Grep` in allowed-tools**
- `/Users/dean/Sandbox/devflow/shared/skills/docs-framework/SKILL.md:6`
- Uses `Read, Bash, Glob` instead of including `Grep`.
- Missing `Grep` seems like an oversight.

**P5: `git-safety` minimal allowed-tools**
- `/Users/dean/Sandbox/devflow/shared/skills/git-safety/SKILL.md:6`
- Uses only `Bash, Read` -- missing both `Grep` and `Glob`.
- This skill references detection patterns that would benefit from Grep/Glob access.

---

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 6 | 0 | - |
| Should Fix | - | 1 | 3 | - |
| Pre-existing | - | - | 3 | 2 |

### Skills Fully Compliant (22)

These skills pass all checks -- correct frontmatter format, description starts with "This skill should be used when...", `user-invocable: false`, Iron Law present, line count within acceptable range, and `references/` directory present:

1. `agent-teams` (124 lines)
2. `architecture-patterns` (153 lines)
3. `complexity-patterns` (143 lines)
4. `consistency-patterns` (140 lines)
5. `core-patterns` (162 lines)
6. `database-patterns` (134 lines)
7. `dependencies-patterns` (141 lines)
8. `documentation-patterns` (125 lines)
9. `git-workflow` (158 lines)
10. `github-patterns` (153 lines)
11. `implementation-patterns` (162 lines)
12. `input-validation` (148 lines)
13. `performance-patterns` (154 lines)
14. `regression-patterns` (146 lines)
15. `review-methodology` (119 lines)
16. `security-patterns` (156 lines)
17. `self-review` (149 lines)
18. `test-driven-development` (136 lines)
19. `accessibility` (229 lines -- over target but functional)
20. `frontend-design` (254 lines -- over target but functional)
21. `react` (276 lines -- over target but functional)
22. `go` (187 lines), `java` (183 lines), `python` (188 lines), `rust` (193 lines), `test-patterns` (183 lines), `typescript` (176 lines) -- over target but acceptable for language skills

### Skills With Violations (10)

| Skill | Violations |
|-------|-----------|
| `knowledge-persistence` | Missing references/ dir, bad description format, too short (89 lines), not in architecture doc, uses Write/Bash |
| `ambient-router` | Bad description format, too short (96 lines), not in architecture doc |
| `search-first` | Multi-line YAML description (inconsistent style), not in architecture doc |
| `test-driven-development` | Not in architecture doc tier tables or glob activation table |
| `docs-framework` | Missing `Grep` in allowed-tools |
| `git-safety` | Missing `Grep` and `Glob` in allowed-tools |
| `self-review` | Non-standard allowed-tools (includes Edit, Write, Bash) -- undocumented exception |
| `review-methodology` | Non-standard allowed-tools (includes Bash) -- undocumented exception |
| `test-patterns` | Non-standard allowed-tools (includes AskUserQuestion) -- undocumented exception |
| `core-patterns` | Non-standard allowed-tools (includes AskUserQuestion) -- undocumented exception |

### Cross-Skill Inconsistency Patterns

| Pattern | Finding |
|---------|---------|
| **Description format** | 29/32 start with "This skill should be used when..." -- 3 do not (ambient-router, knowledge-persistence, search-first partially) |
| **allowed-tools** | 20/32 use canonical `Read, Grep, Glob` -- 12 deviate. CLAUDE.md says skills are "read-only" but 6 skills have write/bash tools. Need explicit exception documentation. |
| **Line count** | Range: 89 to 276. Target: 120-150. Median is approximately 150. Two skills are significantly under (89, 96). Nine are significantly over (176-276). |
| **Activation block** | 10/32 have `activation:` -- correctly maps to Tier 3 + test skills. Pattern skills (Tier 1b) correctly omit it. |
| **Architecture doc** | 28/32 documented. Missing: knowledge-persistence, ambient-router, search-first, test-driven-development. |
| **Iron Law** | 32/32 present. All skills have exactly one Iron Law as a blockquote. Full compliance. |
| **user-invocable** | 32/32 set to `false`. Full compliance. |
| **references/ directory** | 31/32 present. Only `knowledge-persistence` is missing it. |

---

**Consistency Score**: 7/10
**Recommendation**: CHANGES_REQUESTED

The core skill system is well-structured and mostly consistent. The primary issues are:
1. Four skills missing from the architecture reference document (knowledge-persistence, ambient-router, search-first, test-driven-development)
2. Three description format violations (knowledge-persistence, ambient-router, search-first)
3. `knowledge-persistence` is the only skill without a `references/` directory and is significantly under the line count target
4. `allowed-tools` inconsistency needs explicit documentation of the "write-capable skill" exception pattern in CLAUDE.md and the architecture doc
5. Nine skills are over the 150-line target, with three (`react`, `frontend-design`, `accessibility`) substantially over -- content should be moved to their `references/` directories

None of these are architectural problems -- they are documentation and consistency gaps that accumulated as new skills were added without updating the architecture reference.
