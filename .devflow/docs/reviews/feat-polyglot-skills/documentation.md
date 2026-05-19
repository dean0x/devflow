# Documentation Review Report

**Branch**: feat/polyglot-skills -> main
**Date**: 2026-03-04

## Issues in Your Changes (BLOCKING)

### CRITICAL

**CHANGELOG.md not updated for polyglot skills feature** - `CHANGELOG.md`
- Problem: This PR adds 4 new language skills (Go, Python, Java, Rust), restructures 4 existing skills (TypeScript, React, Accessibility, Frontend Design) into optional plugins, updates plugin count from 9 to 17, and changes skill count from 26 to 30. None of these changes are recorded in `CHANGELOG.md`. The existing `[1.1.0]` entry documents only the ambient mode feature from the prior PR. Users upgrading to 1.1.0 will have no record that language/ecosystem skills were restructured into optional plugins or that new languages were added.
- Impact: Breaking change for existing users -- skills previously bundled in `devflow-core-skills` (typescript, react, accessibility, frontend-design) are now in separate optional plugins. Users who relied on these auto-activating will lose them after upgrade unless they install the new plugins. This is a behavioral regression that must be documented.
- Fix: Add a section to `CHANGELOG.md` under `[1.1.0]` covering:
  ```markdown
  ### Added
  - **Polyglot language skills** — Go, Python, Java, Rust skill plugins with idiomatic patterns
    - Go: error handling, interfaces, concurrency, package design
    - Python: type hints, protocols, dataclasses, async patterns
    - Java: records, sealed classes, composition, modern Java (17-21+)
    - Rust: ownership, borrowing, error handling, type-driven design
    - Each language has SKILL.md + 3-4 reference docs (violations, patterns, detection, domain-specific)

  ### Changed
  - **Language/ecosystem skills restructured as optional plugins** — TypeScript, React, Accessibility, Frontend Design moved from `devflow-core-skills` to individual optional plugins (`devflow-typescript`, `devflow-react`, `devflow-accessibility`, `devflow-frontend-design`)
    - **Migration**: Run `npx devflow-kit init --plugin=typescript,react,accessibility,frontend-design` to restore previous behavior
    - Skills: 26 -> 30, Plugins: 9 -> 17 (9 core + 8 optional)
  - **Code review conditional perspectives** — Go, Python, Java, Rust reviewers added; language reviewers now check for skill availability before spawning
  ```

### HIGH

**Go skill excludes test files but other language skills do not** - `shared/skills/go/SKILL.md:11`
- Problem: The Go skill's `activation.exclude` includes `"**/*_test.go"` but neither Python, Java, nor Rust exclude their respective test file patterns (`**/test_*.py`, `**/*Test.java`, `**/*_test.rs`). The existing TypeScript skill excludes `"**/*.d.ts"` (declaration files) but not test files, and the React skill excludes `"**/*.test.*"` and `"**/*.spec.*"`. There is an inconsistency in what the exclude patterns document across skills.
- Impact: The exclude patterns are currently metadata hints (as noted in `docs/reference/skills-architecture.md`), so there is no functional impact today. However, the inconsistency creates misleading documentation about intended activation scope. If Claude Code ever reads these patterns for conditional loading, Go skills would skip test files while Python/Java/Rust would not.
- Fix: Either remove `"**/*_test.go"` from Go's exclude list to be consistent with Python/Java/Rust, or add test file exclusions to all language skills for consistency. Given that the React skill already excludes test files, adding them to all language skills is the more defensible choice:
  ```yaml
  # Python
  exclude:
    - "venv/**"
    - ".venv/**"
    - "**/__pycache__/**"
    - "**/test_*.py"
    - "**/*_test.py"

  # Java
  exclude:
    - "**/build/**"
    - "**/target/**"
    - "**/*Test.java"
    - "**/*Tests.java"

  # Rust
  exclude:
    - "**/target/**"
    - "**/*_test.rs"  # (though Rust tests are typically inline, not separate files)
  ```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**README "auto-activating" skill count discrepancy with CLAUDE.md** - `README.md:27`
- Problem: The README states "8 auto-activating core" skills, but the `devflow-core-skills` plugin in `src/cli/plugins.ts` now contains only 8 skills (core-patterns, docs-framework, git-safety, git-workflow, github-patterns, input-validation, test-driven-development, test-patterns). The README count is correct but could be confusing in context because the previous version said "12 auto-activating" -- the 4 skills moved to optional plugins were not "auto-activating" in the same sense (they required file-type triggers), so the previous count was arguably inflated. The current description "8 auto-activating core, 8 optional language/ecosystem" is accurate.
- Impact: Low confusion risk since the numbers are technically correct. Noting for completeness.
- Fix: No change needed. The current wording is accurate.

**Reviewer agent missing `typescript` in focus-to-skill table** - `shared/agents/reviewer.md`
- Problem: The reviewer agent's focus-to-skill table was updated to add `go`, `java`, `python`, `rust` but the existing `typescript` entry was already present. However, the conditional activation table at the bottom was not updated with the `frontend-design` entry being present but lacking a corresponding entry for existing skills that were moved. This is actually correct -- the table already had TypeScript, React, Accessibility, and Frontend Design from before this PR. No issue here upon closer inspection.
- Impact: None. The tables are correct.
- Fix: No change needed.

**Missing migration guidance in README for existing users** - `README.md:124-143`
- Problem: The README documents the new "Language & Ecosystem Plugins" section with install instructions for new users, but does not mention that TypeScript, React, Accessibility, and Frontend Design were previously bundled and are now optional. Existing users who upgrade will silently lose these skills. The README's install example (`npx devflow-kit init --plugin=typescript,react`) suggests these are new, not migrated.
- Impact: Existing users running `npx devflow-kit init` (without `--plugin` flags) may not realize they need to explicitly install language plugins they previously had. This is a behavioral change that warrants a note.
- Fix: Add a brief migration note after the install examples:
  ```markdown
  > **Upgrading from v1.0?** TypeScript, React, Accessibility, and Frontend Design
  > were previously bundled in `devflow-core-skills`. They are now optional plugins.
  > Run `npx devflow-kit init --plugin=typescript,react,accessibility,frontend-design`
  > to restore them.
  ```

### LOW

**Code review command mentions "up to 4 more" but conditional reviews now total up to 11** - `plugins/devflow-code-review/commands/code-review.md:55`
- Problem: The comment "Always run 7 core reviews; conditionally add up to 4 more" was written when there were only 4 conditional reviews (TypeScript, React, Accessibility, Frontend Design). Now there are 11 conditional reviews (+ Go, Python, Java, Rust, Database, Dependencies, Documentation). The "up to 4 more" text was not updated.
- Impact: Minor inaccuracy in the command's internal documentation. Agents reading this may undercount available conditional reviews.
- Fix: Update the line to "conditionally add more based on Phase 1 analysis" or "conditionally add up to 11 more".

## Pre-existing Issues (Not Blocking)

### MEDIUM

**`skills-architecture.md` note about glob patterns being metadata-only could be confusing** - `docs/reference/skills-architecture.md:191`
- Problem: The note states "Glob patterns are metadata hints for documentation. Claude Code does not currently read glob patterns to trigger skills." This is accurate but could mislead contributors into thinking the exclude patterns don't matter, when they will matter if/when Claude Code implements pattern-based activation.
- Impact: Contributors may not maintain exclude patterns carefully.
- Fix: Consider rewording to "Glob patterns are metadata hints that document intended activation scope. While Claude Code does not yet use them for automatic activation, they should be kept accurate for when this feature ships."

### LOW

**New plugin.json files lack README.md** - `plugins/devflow-go/`, `plugins/devflow-python/`, `plugins/devflow-java/`, `plugins/devflow-rust/`
- Problem: The 4 new language plugins have `plugin.json` but no `README.md`. The existing `devflow-ambient` plugin has a README. However, none of the restructured plugins (`devflow-typescript`, `devflow-react`, `devflow-accessibility`, `devflow-frontend-design`) have READMEs either, establishing a pattern that skill-only plugins don't need them.
- Impact: Minimal -- these are internal plugin directories, not user-facing packages.
- Fix: No action needed given the established pattern. If READMEs are desired later, add them in a separate PR.

**Python skill recommends `datetime.utcnow` which is deprecated** - `shared/skills/python/SKILL.md:126`
- Problem: The dataclass example uses `datetime.utcnow` as a default factory, but `datetime.utcnow()` was deprecated in Python 3.12 in favor of `datetime.now(timezone.utc)`.
- Impact: The skill would teach a deprecated pattern to Python developers.
- Fix: Update to `datetime.now(timezone.utc)`:
  ```python
  from datetime import datetime, timezone

  @dataclass(frozen=True)
  class User:
      name: str
      email: str
      created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
  ```

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 1 | 1 | - | - |
| Should Fix | - | - | 1 | 1 |
| Pre-existing | - | - | 1 | 2 |

**Documentation Score**: 6/10

The documentation updates across README, CLAUDE.md, skills-architecture.md, reviewer agent, coder agent, ambient-router, code-review commands, and marketplace.json are thorough and internally consistent. The new SKILL.md files are well-structured (183-193 lines each, consistent with the ~120-150 line target plus code examples), follow the established pattern (Iron Law, When This Skill Activates, categories, anti-patterns table, extended references, checklist), and have comprehensive reference docs (3-4 files each, 120-310 lines). However, the missing CHANGELOG entry for a feature that includes a behavioral change (skills moving from bundled to optional) is a significant documentation gap, and the lack of migration guidance in the README compounds this.

**Recommendation**: CHANGES_REQUESTED

Two blocking issues must be addressed:
1. CHANGELOG.md must document the polyglot skills addition and the restructuring of existing skills into optional plugins, including migration instructions.
2. The inconsistent test file exclusion across language skill activation metadata should be normalized.
