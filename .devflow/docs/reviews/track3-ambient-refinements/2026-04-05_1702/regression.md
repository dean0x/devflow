# Regression Review Report

**Branch**: track3/ambient-refinements -> main
**Date**: 2026-04-05_1702

## Issues in Your Changes (BLOCKING)

### CRITICAL

(none)

### HIGH

(none)

### MEDIUM

(none)

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Resolver agent gains `devflow:test-driven-development` skill without test coverage for the behavioral change** - `shared/agents/resolver.md:5`
**Confidence**: 82%
- Problem: The Resolver agent's `skills:` frontmatter was changed from `devflow:software-design, devflow:git, devflow:implementation-patterns, devflow:worktree-support` to `devflow:software-design, devflow:git, devflow:patterns, devflow:test-driven-development, devflow:worktree-support`. This adds `devflow:test-driven-development` as a new skill (not just a rename). The TDD skill's own docs confirm this addition under `RESOLVE/ORCHESTRATED` ("TDD enforced via Resolver agent (skill in Resolver frontmatter). Every fix needs a regression test first."). While the intent is sound, this is a behavioral change to the Resolver agent that may cause it to insist on writing regression tests before applying fixes -- which could slow down trivial review resolutions. No tests validate this new behavior.
- Fix: This is intentional and documented in the TDD skill. Add a brief comment in the resolver agent or a test case in `tests/skill-references.test.ts` to confirm the Resolver now expects TDD skill. Alternatively, accept this as a deliberate behavior enhancement -- the risk is low since TDD in Resolver context means "write a regression test first" which is a quality improvement.

## Pre-existing Issues (Not Blocking)

(none)

## Suggestions (Lower Confidence)

- **Session-start hook lost ambient skill injection without replacement verification** - `scripts/hooks/session-start-memory` (Confidence: 72%) -- Section 2 ("Ambient Skill Injection") was removed entirely. The old hook injected `devflow:ambient-router/SKILL.md` directly into `additionalContext` at session start so Claude had routing context immediately. The new architecture relies on the preamble hook injecting classification rules, plus the Skill tool loading `devflow:router` at runtime. This is architecturally cleaner (no stale cached skill content), but if the Skill tool is slow or unavailable during the first prompt, the router skill content may not be in context. Confirm this is acceptable.

- **Preamble hook references skill names without `devflow:` prefix in one line** - `scripts/hooks/preamble:43` (Confidence: 65%) -- The preamble text says `Load devflow:router skill FIRST via Skill tool` which is correct, but the old `ambient-prompt` hook had inline skill mappings (e.g., `devflow:implementation-patterns`) while the new preamble delegates all mappings to the router skill. If the router skill fails to load (e.g., not installed), there are no fallback inline mappings. This is by design (single source of truth) but reduces resilience compared to the old approach.

- **`explore` skill added to devflow-ambient plugin but not to LEGACY_SKILL_NAMES bare names cleanup** - `src/cli/plugins.ts` (Confidence: 60%) -- The `explore` skill is new (not a rename), and it is correctly added to LEGACY_SKILL_NAMES for bare-name cleanup. However, there is no `devflow:explore` entry in LEGACY_SKILL_NAMES because it did not exist before. This is correct behavior -- only stale names need cleanup entries. No action needed; included for completeness.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 0 | - |
| Should Fix | - | 0 | 1 | - |
| Pre-existing | - | - | 0 | 0 |

**Regression Score**: 9/10
**Recommendation**: APPROVED

## Analysis Details

### Migration Completeness (Verified)

This PR renames 9 skills and 1 hook script. The migration was verified across all layers:

| Old Name | New Name | Status |
|----------|----------|--------|
| `ambient-router` | `router` | Complete -- plugins.ts, plugin.json, agents, skills, tests, CLAUDE.md, README.md, docs all updated |
| `implementation-orchestration` | `implement` | Complete -- plugins.ts, plugin.json, README, docs, CLAUDE.md all updated |
| `debug-orchestration` | `debug` | Complete |
| `plan-orchestration` | `plan` | Complete |
| `review-orchestration` | `review` | Complete |
| `resolve-orchestration` | `resolve` | Complete |
| `pipeline-orchestration` | `pipeline` | Complete |
| `implementation-patterns` | `patterns` | Complete -- plugins.ts, plugin.json, agents (coder.md, resolver.md), README, docs, skills-architecture.md, CLAUDE.md all updated |
| `search-first` | `research` | Complete -- plugins.ts, plugin.json, agents (coder.md), docs, CLAUDE.md all updated |
| `ambient-prompt` (hook) | `preamble` (hook) | Complete -- script renamed, ambient.ts updated, init.ts has legacy cleanup |

### Legacy Cleanup (Verified)

All old names properly added to:
- `LEGACY_SKILL_NAMES` -- both bare names and `devflow:`-prefixed versions added for cleanup during `devflow init`
- `SHADOW_RENAMES` -- all 9 skill renames mapped for shadow override migration
- `LEGACY_HOOK_SCRIPTS` in `init.ts` -- `ambient-prompt` file deleted during reinstall
- `removeLegacyAmbientHook()` -- new function cleans old hook entries from `settings.json`
- `addAmbientHook()` -- calls `removeLegacyAmbientHook()` first, then adds `preamble` hook
- `removeAmbientHook()` -- removes both `preamble` and `ambient-prompt` markers
- `hasAmbientHook()` -- detects both `preamble` and `ambient-prompt` markers

### Deleted Files (Verified Safe)

| Deleted File | Replacement | Risk |
|-------------|-------------|------|
| `scripts/hooks/ambient-prompt` | `scripts/hooks/preamble` | Safe -- new file exists, init.ts cleans old file |
| `shared/skills/implementation-patterns/` | `shared/skills/patterns/` | Safe -- renamed via git, SKILL.md content preserved |
| `plugins/devflow-resolve/skills/implementation-patterns/` | Build-generated from `shared/skills/patterns/` | Safe -- gitignored build artifact |
| `plugins/devflow-implement/skills/implementation-patterns/` | Renamed to `shared/skills/patterns/` | Safe -- gitignored build artifact |

### Behavioral Changes (Verified)

1. **Preamble is now detection-only** -- The old `ambient-prompt` hook contained full skill mappings inline (~20 lines of IMPLEMENT/DEBUG/PLAN/etc. mappings). The new `preamble` hook contains only classification rules and tells Claude to load `devflow:router` for the full skill mappings. This is architecturally cleaner (single source of truth for mappings in `router/SKILL.md`).

2. **Session-start no longer injects ambient skill** -- The old `session-start-memory` hook injected `devflow:ambient-router/SKILL.md` as `additionalContext`. This is removed. The new architecture uses runtime Skill tool loading instead of pre-injection. Reduces stale content risk.

3. **Resolver agent now includes TDD skill** -- `devflow:test-driven-development` added to resolver.md frontmatter (not just a rename). This means resolvers will now write regression tests before fixes.

4. **DevFlow branding** -- `Ambient: INTENT/DEPTH` changed to `DevFlow: INTENT/DEPTH` across preamble, router, tests, and README.

### Test Coverage (Verified)

- Tests updated for all renamed exports (`addAmbientHook`, `removeLegacyAmbientHook`, `hasAmbientHook`)
- New test cases for legacy hook removal (`removeLegacyAmbientHook`)
- Integration test helpers refactored (streaming-based, `StreamResult` type)
- Preamble drift detection test updated in `ambient.test.ts`
- Plugin tests updated for new skill names
- Skill reference tests updated for new skill names

### Pitfall Check

Reviewed all 6 known pitfalls against this diff:
- **PF-001** (Synthesizer glob): Not affected by this change
- **PF-002** (init.ts monolith): init.ts changes are small (import + hook cleanup), not growing the monolith
- **PF-003** (pluginHints duplication): Not affected
- **PF-004** (background hook god script): Not affected
- **PF-005** (hook interface duplication): Not affected -- this PR uses the extracted `hooks.ts` types
- **PF-006** (session-start jq loop): Not affected
