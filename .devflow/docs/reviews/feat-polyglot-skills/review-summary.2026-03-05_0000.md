# Review Summary: feat/polyglot-skills

**Branch**: feat/polyglot-skills -> main
**PR**: #76
**Date**: 2026-03-05
**Reviewers**: security, architecture, performance, complexity, consistency, regression, tests, typescript, documentation, dependencies

## Merge Recommendation
CHANGES_REQUESTED -- The core contribution (4 new language skills, optional plugin architecture) is well-designed and production-ready, but two categories of issues must be addressed before merge: (1) the silent regression from moving 4 previously-bundled skills to optional plugins with no migration path, and (2) the Coder agent's unconditional frontmatter references to optional skills that may not be installed. Additionally, the CHANGELOG must document this behavioral change.

## Consolidated Findings

### BLOCKING Issues (Must Fix Before Merge)

#### B1. CRITICAL -- Missing CHANGELOG entry for breaking restructure
- **File**: `CHANGELOG.md`
- **Reported by**: documentation
- **Description**: The PR restructures 4 previously-bundled skills (TypeScript, React, Accessibility, Frontend Design) into optional plugins and adds 4 new language skills, but CHANGELOG.md is not updated. This is a behavioral change that silently removes auto-installed skills on upgrade. The `[1.1.0]` entry only documents ambient mode from the prior PR.
- **Fix**: Add entries under `[1.1.0]` documenting the new polyglot skills, the restructuring of existing skills into optional plugins, and a migration command (`npx devflow-kit init --plugin=typescript,react,accessibility,frontend-design`).

#### B2. HIGH -- Silent regression: 4 skills removed from default install with no migration path
- **File**: `src/cli/plugins.ts:27` (core-skills definition)
- **Reported by**: regression, documentation
- **Description**: TypeScript, React, Accessibility, and Frontend Design were previously bundled in `devflow-core-skills` (always installed). They are now `optional: true` in separate plugins. Users running `devflow init` (upgrade) will no longer receive these skills. Existing installations retain stale copies that silently drift from source. New installations get nothing unless `--plugin=` flags are passed.
- **Fix**: Either (a) auto-detect previously-installed optional skills during `init` and re-install them, (b) prompt the user during upgrade, or (c) add prominent migration guidance in CHANGELOG + README. At minimum, document the breaking change; ideally, add upgrade detection in `init.ts`.

#### B3. HIGH -- Coder agent frontmatter lists 8 optional skills as unconditional dependencies
- **File**: `shared/agents/coder.md:4`
- **Reported by**: architecture, complexity, consistency, regression, dependencies (5 reviewers)
- **Description**: The Coder agent's `skills:` frontmatter declares all 14 skills including 8 from optional plugins (`typescript, react, accessibility, frontend-design, go, python, java, rust`). These may not be installed. The Coder agent body already has conditional loading logic (step 3: "load the corresponding language skill"), but the frontmatter contradicts this by listing them as always-required. The Reviewer agent correctly uses dynamic loading without frontmatter declarations, establishing the right pattern. The `/implement` command lacks the skill-availability check added to `/code-review`.
- **Fix**: Remove optional skills from frontmatter, keeping only always-available skills: `skills: core-patterns, git-safety, implementation-patterns, git-workflow, test-patterns, input-validation`. Rely on the body's dynamic loading logic. Optionally add a skill-availability check to the implement command.

#### B4. HIGH -- Inconsistent language ordering across cross-referenced tables
- **File**: `plugins/devflow-code-review/commands/code-review.md:45-48`, `code-review-teams.md:45-48`, `shared/agents/reviewer.md:37-40`
- **Reported by**: consistency
- **Description**: The reviewer agent lists new languages alphabetically (`go, java, python, rust`), but the code-review commands list them as `go, python, java, rust` (python and java swapped). The same inconsistency appears in the teams variant. Cross-referencing tables between commands and agents is confusing when ordering differs.
- **Fix**: Standardize on alphabetical order (`go, java, python, rust`) in all tables across `code-review.md`, `code-review-teams.md`, and `reviewer.md`.

#### B5. MEDIUM -- Insecure gRPC connection in Go example code
- **File**: `shared/skills/go/references/concurrency.md:286`
- **Reported by**: security
- **Description**: The `sync.Once` example uses deprecated `grpc.WithInsecure()` and `grpc.Dial`, which normalizes insecure transport in a teaching context. Skills serve as templates developers copy.
- **Fix**: Use `grpc.NewClient` with `insecure.NewCredentials()` and add a comment noting production should use TLS.

#### B6. MEDIUM -- SQL injection pattern in Python async example
- **File**: `shared/skills/python/references/async.md:81-89`
- **Reported by**: security
- **Description**: The `stream_results` function accepts a raw SQL query string and passes it to `conn.execute(query)` without parameterization. The function signature invites callers to interpolate user input.
- **Fix**: Show parameterized query usage with a `params` argument.

#### B7. MEDIUM -- No skill availability guard in ambient-router for optional skills
- **File**: `shared/skills/ambient-router/SKILL.md:54`
- **Reported by**: architecture, regression
- **Description**: The ambient-router's BUILD intent references `go, python, java, rust` as secondary skills to load, but unlike the code-review commands, it has no instruction to verify `~/.claude/skills/{lang}/SKILL.md` exists before reading. If a language plugin is not installed, the read will fail.
- **Fix**: Add a skill availability note: "Before reading a secondary skill, verify the skill file exists. Skip silently if missing."

#### B8. MEDIUM -- Sequential file-existence checks for optional skills in code-review
- **File**: `plugins/devflow-code-review/commands/code-review.md:53-54`, `code-review-teams.md:53-54`
- **Reported by**: performance
- **Description**: The new "Skill availability check" instruction implies checking up to 8 optional skills one at a time. Each Glob is a tool call round-trip, adding 2-4s latency to review startup.
- **Fix**: Restructure the instruction to batch all checks into a single Glob pattern using brace expansion, or explicitly instruct parallel tool calls.

#### B9. MEDIUM -- Missing test coverage for `optional` field on new plugins
- **File**: `tests/plugins.test.ts`
- **Reported by**: tests
- **Description**: 8 new plugins set `optional: true`, but no test validates this flag. A regression removing `optional` would silently change install behavior (language plugins would install by default).
- **Fix**: Add a test asserting all 8 language/ecosystem plugins are marked `optional: true`.

#### B10. MEDIUM -- Missing test assertions for new skills in registry
- **File**: `tests/plugins.test.ts:17-23`
- **Reported by**: tests
- **Description**: The PR adds 4 new skills (`go, python, java, rust`) but no test verifies they appear in `getAllSkillNames()`. The existing test only checks `accessibility` and `agent-teams`.
- **Fix**: Add `expect(skills).toContain('go')` (and python, java, rust) assertions.

#### B11. MEDIUM -- Go skill excludes test files inconsistently with other language skills
- **File**: `shared/skills/go/SKILL.md:10-11`
- **Reported by**: architecture, regression, consistency, documentation (4 reviewers)
- **Description**: Go's activation metadata includes `exclude: ["**/*_test.go"]`, but Python, Java, and Rust do not exclude their respective test file patterns. This creates inconsistent behavior across the new language skills.
- **Fix**: Either remove Go's test file exclusion to match other languages, or add equivalent exclusions to all language skills.

#### B12. MEDIUM -- SKILL.md files exceed 150-line target (183-193 lines each)
- **File**: `shared/skills/go/SKILL.md`, `python/SKILL.md`, `java/SKILL.md`, `rust/SKILL.md`
- **Reported by**: architecture, complexity
- **Description**: All 4 new SKILL.md files are 22-29% over the project's 120-150 line guideline. The extra lines come from Anti-Patterns tables and Checklists that could be moved to reference files.
- **Fix**: Move Anti-Patterns tables and/or Checklists to `references/checklist.md`, bringing files within target range.

#### B13. MEDIUM -- New language skills lack Severity Guidelines section
- **File**: `shared/skills/go/SKILL.md`, `python/SKILL.md`, `java/SKILL.md`, `rust/SKILL.md`
- **Reported by**: consistency
- **Description**: Review-focused skills and domain skills like accessibility include `## Severity Guidelines`, but the 4 new language skills (and pre-existing TypeScript/React) omit it. This is a pattern deviation within the optional plugin group.
- **Fix**: Add a `## Severity Guidelines` table to each language SKILL.md, or explicitly document that language-pattern skills intentionally omit severity calibration.

### SHOULD-FIX Issues

#### S1. HIGH -- Implement command not updated with skill availability check
- **File**: `plugins/devflow-implement/commands/implement.md` (not modified)
- **Reported by**: regression
- **Description**: The `/code-review` commands received a "Skill availability check" paragraph, but `/implement` (and `/implement-teams`) were not updated despite the Coder agent now referencing 8 optional skills. Inconsistent treatment of the same problem.
- **Fix**: Add an equivalent availability check to the implement command, or handle it in the Coder agent body.

#### S2. MEDIUM -- Repetitive plugin definitions in plugins.ts (DRY violation)
- **File**: `src/cli/plugins.ts:86-152`
- **Reported by**: architecture, complexity, typescript (3 reviewers)
- **Description**: 8 new optional plugins use identical structure (`commands: [], agents: [], skills: [single-skill], optional: true`). The array grew 77% with purely repetitive data. Each new language requires copy-pasting the same 7-line boilerplate.
- **Fix**: Extract a factory function: `function optionalSkillPlugin(name, description, skill): PluginDefinition`. Can be addressed in this PR or a follow-up.

#### S3. MEDIUM -- Plugin count threshold test too low
- **File**: `tests/plugins.test.ts:108-110`
- **Reported by**: tests
- **Description**: The integrity test checks `DEVFLOW_PLUGINS.length >= 8` but the actual count is now 17. Nine plugins could be deleted without test failure.
- **Fix**: Update threshold to `>= 17`.

#### S4. MEDIUM -- No test for core-skills exclusion of moved skills
- **File**: `tests/plugins.test.ts`
- **Reported by**: tests
- **Description**: No test validates that `devflow-core-skills` does NOT contain the 4 skills that were moved to optional plugins. A future accidental re-addition would go undetected.
- **Fix**: Add assertion that core-skills excludes `typescript, react, accessibility, frontend-design`.

#### S5. MEDIUM -- No test for buildAssetMaps ownership of new skills
- **File**: `tests/plugins.test.ts:42-53`
- **Reported by**: tests
- **Description**: The `buildAssetMaps` test was updated for `accessibility` but not for the 4 new skills. Ownership assertions are missing for `go, python, java, rust`.
- **Fix**: Add `expect(skillsMap.get('go')).toBe('devflow-go')` (and python, java, rust).

#### S6. MEDIUM -- Python async example uses shared mutable list in TaskGroup
- **File**: `shared/skills/python/references/async.md:30-40`
- **Reported by**: performance
- **Description**: The `process_batch` TaskGroup example appends to a shared `list[Result]` from concurrent tasks. This produces non-deterministic ordering and teaches poor async patterns.
- **Fix**: Use `task.result()` after the TaskGroup completes to preserve order.

#### S7. MEDIUM -- Go errgroup example relies on Go 1.22+ loop variable semantics
- **File**: `shared/skills/go/references/concurrency.md:8-21`
- **Reported by**: performance
- **Description**: The `FetchAll` example captures loop variables in closures without shadowing. This is only safe in Go 1.22+ (per-iteration scoping). Go <1.22 would produce data races.
- **Fix**: Add a version note or show the `i, url := i, url` shadow pattern for compatibility.

#### S8. MEDIUM -- Skill availability check is prose instruction, not enforced
- **File**: `plugins/devflow-code-review/commands/code-review.md:52`, `code-review-teams.md:50`
- **Reported by**: complexity
- **Description**: The "Skill availability check" is a natural-language instruction. If the agent skips it (agents are probabilistic), a reviewer will be spawned for a missing skill. Adding a concrete worked example would reduce skip risk.
- **Fix**: Add an explicit example showing the Glob call and the conditional logic.

#### S9. MEDIUM -- Missing migration guidance in README for existing users
- **File**: `README.md:124-143`
- **Reported by**: documentation
- **Description**: The README documents new language plugin installation for new users but does not mention that TypeScript, React, Accessibility, and Frontend Design were previously bundled and are now optional.
- **Fix**: Add a migration callout: "Upgrading from v1.0? Run `npx devflow-kit init --plugin=typescript,react,accessibility,frontend-design` to restore them."

#### S10. MEDIUM -- Ambient router skill catalog ordering and availability caveat
- **File**: `shared/skills/ambient-router/references/skill-catalog.md:19-22`, `SKILL.md:57`
- **Reported by**: consistency, regression
- **Description**: New language entries in the skill catalog are not alphabetically sorted (`go, python, java, rust` instead of `go, java, python, rust`), and the catalog does not note that language skills are optional plugins.
- **Fix**: Sort alphabetically and add availability caveat.

#### S11. LOW -- Python skill uses deprecated `datetime.utcnow`
- **File**: `shared/skills/python/SKILL.md:126`
- **Reported by**: documentation
- **Description**: The dataclass example uses `datetime.utcnow`, deprecated in Python 3.12 in favor of `datetime.now(timezone.utc)`.
- **Fix**: Update to `datetime.now(timezone.utc)`.

#### S12. LOW -- Code review command says "up to 4 more" but conditionals now total 11
- **File**: `plugins/devflow-code-review/commands/code-review.md:55`
- **Reported by**: documentation
- **Description**: Outdated comment referencing "up to 4 more" conditional reviews when there are now 11 conditional review focuses.
- **Fix**: Update to "conditionally add more based on Phase 1 analysis".

#### S13. LOW -- Marketplace version skew risk
- **File**: `.claude-plugin/marketplace.json`
- **Reported by**: architecture
- **Description**: All 17 plugins share version `1.1.0`. No mechanism for independent plugin versioning if a single skill gets a bugfix.
- **Fix**: No immediate action; monorepo versioning is valid. Note for future consideration.

### PRE-EXISTING / INFORMATIONAL

#### P1. MEDIUM -- devflow-audit-claude plugin.json lacks standard fields
- **File**: `plugins/devflow-audit-claude/.claude-plugin/plugin.json`
- **Reported by**: consistency
- **Description**: This pre-existing optional plugin has only 5 keys while all other plugins (core and new optional) include the full key set with `author`, `homepage`, `repository`, `license`, `keywords`.

#### P2. MEDIUM -- Coder agent already listed optional skills before this PR
- **File**: `shared/agents/coder.md:4` (pre-existing on main)
- **Reported by**: architecture, regression
- **Description**: Pre-existing architectural debt: the Coder agent frontmatter listed `typescript, react, accessibility, frontend-design` as skills even when they were bundled. This PR extends the same pattern to 8 skills while removing the bundle guarantee.

#### P3. MEDIUM -- Ambient router already referenced TypeScript/React without availability check
- **File**: `shared/skills/ambient-router/SKILL.md:57`
- **Reported by**: regression
- **Description**: Pre-existing: BUILD intent line included `typescript (.ts), react (.tsx/.jsx)` with no availability guard. Now affects 8 skills instead of 2.

#### P4. MEDIUM -- No test for parsePluginSelection with optional plugins
- **File**: `tests/init-logic.test.ts`
- **Reported by**: tests
- **Description**: Pre-existing gap: no test validates that `parsePluginSelection` correctly handles the `optional` field or that `--plugin=go` shorthand resolves properly.

#### P5. MEDIUM -- skills-architecture.md glob patterns note could be clearer
- **File**: `docs/reference/skills-architecture.md:191`
- **Reported by**: documentation
- **Description**: Note says glob patterns are "metadata hints" which could mislead contributors into thinking exclude patterns don't need maintenance.

#### P6. LOW -- TypeScript/React skills lack detection.md references
- **File**: `shared/skills/typescript/references/`, `shared/skills/react/references/`
- **Reported by**: consistency
- **Description**: New language skills all include `detection.md` references; existing TypeScript and React skills do not.

#### P7. LOW -- `getAllSkillNames` and `getAllAgentNames` are structurally duplicated
- **File**: `src/cli/plugins.ts:144-164`
- **Reported by**: complexity
- **Description**: Identical function structure differing only in property name. Could be generalized.

#### P8. LOW -- `LEGACY_SKILL_NAMES` array is 39 entries and growing
- **File**: `src/cli/plugins.ts:100-139`
- **Reported by**: complexity
- **Description**: Append-only maintenance list taking up visual space.

#### P9. LOW -- String literal skill names lack compile-time type safety
- **File**: `src/cli/plugins.ts:27-48`
- **Reported by**: typescript
- **Description**: Skill names are raw strings with no union type validation. Typos compile fine but fail at runtime.

#### P10. LOW -- `PluginDefinition` allows ambiguous state
- **File**: `src/cli/plugins.ts:8-16`
- **Reported by**: typescript
- **Description**: `optional` is `boolean | undefined` with no discriminated union for plugin categories.

#### P11. LOW -- No CHANGELOG or migration guide exists yet
- **File**: (none)
- **Reported by**: regression
- **Description**: The restructuring of 4 core skills is a breaking change with no CHANGELOG entry. (Covered by B1 above, listed here as also flagged by regression reviewer.)

#### P12. LOW -- Go violations example shows HTTP request ignoring context
- **File**: `shared/skills/go/references/violations.md:79`
- **Reported by**: security
- **Description**: Correctly labeled as a VIOLATION (teaching what NOT to do). No action needed.

## Reviewer Scores

| Reviewer | Score | Recommendation |
|----------|-------|---------------|
| security | 8/10 | APPROVED_WITH_CONDITIONS |
| architecture | 7/10 | APPROVED_WITH_CONDITIONS |
| performance | 8/10 | APPROVED_WITH_CONDITIONS |
| complexity | 8/10 | APPROVED_WITH_CONDITIONS |
| consistency | 7/10 | APPROVED_WITH_CONDITIONS |
| regression | 5/10 | CHANGES_REQUESTED |
| tests | 5/10 | CHANGES_REQUESTED |
| typescript | 8/10 | APPROVED_WITH_CONDITIONS |
| documentation | 6/10 | CHANGES_REQUESTED |
| dependencies | 8/10 | CHANGES_REQUESTED |

**Average Score**: 7.0/10

## Issue Counts

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 1 | 3 | 9 | - |
| Should Fix | - | 1 | 9 | 3 |
| Pre-existing | - | - | 5 | 7 |

**Total unique issues**: 13 blocking, 13 should-fix, 12 pre-existing/informational

## Key Themes

1. **Migration gap** (B1, B2, S9) -- The most impactful finding. Moving 4 skills from bundled to optional without upgrade detection, CHANGELOG documentation, or migration guidance creates a silent regression for existing users. Three reviewers flagged this independently.

2. **Coder agent frontmatter over-declaration** (B3) -- Five reviewers independently flagged the same issue: the Coder agent's `skills:` frontmatter unconditionally lists 8 optional skills. The Reviewer agent's dynamic-loading approach is the correct pattern. This is the most cross-referenced finding in the review.

3. **Inconsistent optional-skill availability checks** (B7, S1, S8) -- The code-review commands correctly gate on skill existence, but the ambient-router and implement command do not. The system needs a uniform pattern for handling optional skills across all entry points.

4. **Test coverage gaps for the `optional` flag** (B9, B10, S3, S4, S5) -- The `optional: true` field drives core install behavior but has zero test coverage. Multiple test assertions are missing for new plugins, new skills, and the restructured core-skills plugin.

5. **Example code quality** (B5, B6, S6, S7, S11) -- Several reference code examples teach insecure or deprecated patterns (insecure gRPC, SQL injection, deprecated datetime, pre-1.22 Go loop semantics, shared mutable state). Since skills are templates developers copy, these are higher-impact than typical documentation issues.

6. **Cross-table ordering inconsistency** (B4, S10) -- Language entries are ordered differently across reviewer agent, code-review commands, and ambient-router skill catalog. Minor but violates consistency principles.
