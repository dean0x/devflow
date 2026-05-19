# Consistency Review Report

**Branch**: feat/polyglot-skills -> main
**Date**: 2026-03-04

## Issues in Your Changes (BLOCKING)

### HIGH

**Inconsistent plugin.json key structure vs devflow-audit-claude** - `plugins/devflow-audit-claude/.claude-plugin/plugin.json:1`
- Problem: The pre-existing `devflow-audit-claude` plugin.json has only 5 keys (`name`, `description`, `version`, `agents`, `skills`), while all 8 new optional plugin.json files include the full key set (`author`, `homepage`, `repository`, `license`, `keywords` in addition to the base keys). This creates an inconsistency among optional plugins -- one format for the original optional plugin, a different format for all new ones.
- Impact: The new plugins are actually consistent with the core plugins (e.g., `devflow-core-skills`, `devflow-code-review`, `devflow-implement`), which all use the full key set. This means the new plugins follow the *majority* pattern correctly. However, `devflow-audit-claude` is now the odd one out.
- Fix: This is a should-fix rather than blocking. Consider backfilling `devflow-audit-claude` with the full key set for uniformity across all plugin.json files. The new plugins are doing the right thing.

**Reviewer agent Focus Areas table ordering inconsistency** - `shared/agents/reviewer.md:37-40`
- Problem: In the Focus Areas table, the new languages are listed as `go`, `java`, `python`, `rust` (alphabetical). However, in the Conditional Activation table at the bottom of the same file, they are listed in the same order: `go`, `java`, `python`, `rust`. Meanwhile, in the code-review commands (`code-review.md:45-48` and `code-review-teams.md:45-48`), the file type detection table lists them as `go`, `python`, `java`, `rust` -- a different order (python and java swapped). The reviewer agent tables and the code-review command tables should use the same ordering.
- Impact: Inconsistent ordering creates cognitive friction when cross-referencing which languages are conditional. Not functionally breaking, but violates the Iron Law of consistency.
- Fix: Pick one ordering (alphabetical: `go`, `java`, `python`, `rust`) and apply it consistently across all tables in:
  - `shared/agents/reviewer.md` (already alphabetical)
  - `plugins/devflow-code-review/commands/code-review.md:45-48` (currently `go, python, java, rust`)
  - `plugins/devflow-code-review/commands/code-review-teams.md:45-48` (currently `go, python, java, rust`)
  - `plugins/devflow-code-review/commands/code-review-teams.md:70-73` (currently `Go, Python, Java, Rust`)

```markdown
# In code-review.md and code-review-teams.md, change:
| .go files | go |
| .py files | python |
| .java files | java |
| .rs files | rust |

# To (alphabetical, matching reviewer.md):
| .go files | go |
| .java files | java |
| .py files | python |
| .rs files | rust |
```

### MEDIUM

**New language skills lack Severity Guidelines section** - `shared/skills/go/SKILL.md`, `shared/skills/python/SKILL.md`, `shared/skills/java/SKILL.md`, `shared/skills/rust/SKILL.md`
- Problem: All review-focused skills (security-patterns, architecture-patterns, performance-patterns, consistency-patterns, etc.) and even domain skills like accessibility and frontend-design include a `## Severity Guidelines` section. The existing TypeScript and React skills also omit this section. The 4 new language skills (Go, Python, Java, Rust) similarly do not include Severity Guidelines. While the new skills are consistent with TypeScript/React in this regard, they deviate from the pattern used by accessibility and frontend-design (which were moved to optional plugins alongside these new skills).
- Impact: When the reviewer agent uses a language skill to evaluate code, it has no severity calibration from the skill itself. The review-methodology provides generic severity guidelines, but language-specific calibration (e.g., "ignoring an error in Go is CRITICAL" vs "missing a type hint in Python is MEDIUM") would improve review quality. This is a pattern deviation within the optional language plugin group.
- Fix: Consider adding a `## Severity Guidelines` table to each new language SKILL.md, similar to accessibility/SKILL.md. Alternatively, acknowledge this as an intentional distinction between "language pattern" skills and "review pattern" skills.

**Coder agent skills frontmatter lists all languages unconditionally** - `shared/agents/coder.md:4`
- Problem: The coder agent frontmatter now includes `go, python, java, rust` in its skills list alongside `typescript, react, accessibility, frontend-design`. The body text at line 41 correctly says "For non-TypeScript backends: load the corresponding language skill" -- but the frontmatter declares all language skills regardless of what the coder is actually implementing. Since these are now optional plugins, the skills may not be installed.
- Impact: The frontmatter skill declarations serve as documentation/hints for the orchestrator about what skills the agent may need. Listing skills that might not be installed could cause confusion. The body text mitigates this with conditional loading instructions, so the functional impact is low.
- Fix: This mirrors how `typescript, react, accessibility, frontend-design` were already listed before being moved to optional plugins. The pattern is technically pre-existing, but now applies to 8 skills instead of 4. Consider adding a note in the frontmatter or body that these are optional skills and may not be available.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Ambient router BUILD skill table ordering** - `shared/skills/ambient-router/SKILL.md:57`
- Problem: The new language skills are listed in the BUILD row as `go (.go), python (.py), java (.java), rust (.rs)` -- not alphabetical by skill name (go, java, python, rust). The original entries (typescript, react, frontend-design) are listed in a logical grouping order rather than alphabetical. The new entries follow the same non-alphabetical approach but in yet another order.
- Fix: Minor inconsistency. Either sort all secondary skills alphabetically or group by ecosystem (frontend then backend languages). Currently it reads: `typescript (.ts), react (.tsx/.jsx), go (.go), python (.py), java (.java), rust (.rs), frontend-design (CSS/UI)`. Backend languages are inserted between two frontend skills, splitting the frontend group.

```markdown
# Current (frontend group split):
typescript (.ts), react (.tsx/.jsx), go (.go), python (.py), java (.java), rust (.rs), frontend-design (CSS/UI), ...

# Suggested (grouped by ecosystem):
typescript (.ts), react (.tsx/.jsx), frontend-design (CSS/UI), go (.go), java (.java), python (.py), rust (.rs), ...
```

**Skill catalog ordering** - `shared/skills/ambient-router/references/skill-catalog.md`
- Problem: The new language entries (`go`, `python`, `java`, `rust`) are inserted between `input-validation` and `security-patterns`. Within themselves they are listed as `go, python, java, rust` -- not alphabetical (should be `go, java, python, rust`). The existing entries are not strictly alphabetical either (`typescript, react, frontend-design, input-validation`), but the new additions should at least be internally consistent.
- Fix: Sort the 4 new entries alphabetically: `go, java, python, rust`.

### LOW

**README count update: "8 auto-activating core" may cause confusion** - `README.md:27`
- Problem: Changed from "12 auto-activating" to "8 auto-activating core". The original count of 12 included `accessibility`, `core-patterns`, `docs-framework`, `frontend-design`, `git-safety`, `git-workflow`, `github-patterns`, `input-validation`, `react`, `test-driven-development`, `test-patterns`, `typescript`. After moving 4 skills out, the core-skills plugin has 8 skills. The count is accurate. No issue.
- Note: This is correctly updated and consistent.

## Pre-existing Issues (Not Blocking)

### MEDIUM

**devflow-audit-claude plugin.json lacks standard fields** - `plugins/devflow-audit-claude/.claude-plugin/plugin.json:1`
- Problem: This pre-existing optional plugin has a minimal plugin.json with only `name`, `description`, `version`, `agents`, `skills`. All other plugins (both core and now the new optional plugins) include `author`, `homepage`, `repository`, `license`, and `keywords`.
- Fix: Backfill the missing fields in a separate PR to make all plugin.json files structurally identical.

### LOW

**TypeScript and React skills lack detection.md references** - `shared/skills/typescript/references/`, `shared/skills/react/references/`
- Problem: The existing TypeScript and React skills have only `patterns.md` and `violations.md` in their references directories. The new language skills (Go, Python, Java, Rust) all include `detection.md` (plus a language-specific deep-dive file). Accessibility and frontend-design already had `detection.md`. This creates an inconsistency within the Tier 3 language/domain skill group.
- Fix: Consider adding `detection.md` to TypeScript and React skills in a future PR.

**TypeScript skill has no `activation` frontmatter exclude for test files** - `shared/skills/typescript/SKILL.md:10-12`
- Problem: The existing TypeScript skill excludes `node_modules/**` and `**/*.d.ts` in its activation metadata. The new Go skill excludes `vendor/**` and `**/*_test.go`. React, accessibility, and frontend-design exclude `**/*.test.*` and `**/*.spec.*`. Go is the only new skill that excludes test files from activation (`**/*_test.go`), while Python, Java, and Rust do not exclude their respective test directories/patterns. This is inconsistent within the new skills themselves.
- Fix: Either remove Go's test file exclusion (`**/*_test.go`) to match Python/Java/Rust, or add equivalent test exclusions to the others (`**/*_test.py` for Python, `**/src/test/**` for Java, `**/*_test.rs` or `**/tests/**` for Rust). The Go exclusion arguably makes sense since `_test.go` files have different build constraints, but the inconsistency across new skills should be deliberate and documented.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 2 | 2 | 0 |
| Should Fix | 0 | 0 | 2 | 1 |
| Pre-existing | 0 | 0 | 1 | 2 |

**Consistency Score**: 7/10

The PR demonstrates strong consistency in the areas that matter most: SKILL.md structure (Iron Law, When This Skill Activates, domain sections, Anti-Patterns, Extended References, Checklist), plugin.json format (matching core plugins), plugins.ts registration (uniform `optional: true` pattern), and documentation updates (CLAUDE.md, README.md, skills-architecture.md, marketplace.json all updated in lockstep). The new skills are structurally consistent with each other and with the existing TypeScript/React skills.

The two HIGH issues are minor ordering inconsistencies in cross-referenced tables (code-review commands vs reviewer agent) that could cause confusion but are not functionally breaking. The MEDIUM issues note legitimate pattern deviations (missing Severity Guidelines, ambient router grouping) that would improve the skill ecosystem but are not regressions.

**Recommendation**: APPROVED_WITH_CONDITIONS

Conditions:
1. Fix the language ordering inconsistency between `code-review.md`/`code-review-teams.md` and `reviewer.md` (pick alphabetical and apply uniformly)
2. The remaining issues are non-blocking improvements that can be addressed in follow-up PRs
