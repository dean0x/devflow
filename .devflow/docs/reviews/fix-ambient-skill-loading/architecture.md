# Architecture Review Report

**Branch**: fix/ambient-skill-loading -> main
**Date**: 2026-03-20
**Commits**: 3 (e7aa588, 8800f7b, 7630bad)

## Issues in Your Changes (BLOCKING)

### CRITICAL

(none)

### HIGH

(none)

### MEDIUM

**Preamble string duplicated across shell hook and TypeScript test helper** - `scripts/hooks/ambient-prompt:42`, `tests/integration/helpers.ts:18-19`
**Confidence**: 85%
- Problem: The ambient preamble string is defined identically in two places: the `ambient-prompt` shell hook (line 42) and the `AMBIENT_PREAMBLE` constant in `tests/integration/helpers.ts` (lines 18-19). Any future change to the preamble wording must be synchronized across both locations. This is a cross-language DRY violation (shell + TypeScript) that creates a maintenance burden and a risk of drift.
- Impact: If the preamble is updated in one place but not the other, integration tests will inject stale instructions via `--append-system-prompt`, producing misleading test results (either false passes or false failures).
- Fix: Extract the canonical preamble to a single source of truth. Options:
  1. Have the test helper read the preamble from the shell script file at test-time (e.g., parse between known delimiters).
  2. Generate both the shell constant and the TypeScript constant from a shared config file at build time.
  3. At minimum, add a comment in both locations cross-referencing the other: `// SYNC: must match scripts/hooks/ambient-prompt PREAMBLE`.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**`formatDryRunPlan` inlined in command action module instead of extracted to a utility** - `src/cli/commands/uninstall.ts:58-79`
**Confidence**: 82%
- Problem: The `formatDryRunPlan` function is a pure formatting function with no dependency on Commander, clack/prompts, or any CLI framework. It is co-located in the `uninstall.ts` command module alongside the full `uninstallCommand` action handler, which has heavy I/O and framework coupling. The function is already exported and tested independently (good), but its placement in a 600+ line command file mixes presentation logic with orchestration logic, making it harder to reuse (e.g., an `init --dry-run` in the future would need to import from `uninstall.ts`).
- Impact: Minor SRP violation. Not urgent, but extracting it to `src/cli/utils/format.ts` or similar would improve modularity.
- Fix: Move `formatDryRunPlan` (and potentially `computeAssetsToRemove`) to a utility module like `src/cli/utils/assets.ts`, since both are pure functions with no CLI framework dependencies.

**Dry-run extras detection uses `fs.access` + `process.cwd()` inline in command action** - `src/cli/commands/uninstall.ts:201-208`
**Confidence**: 80%
- Problem: The dry-run path performs filesystem checks (`fs.access` for `.docs/`, `.memory/`) and hardcodes `process.cwd()` directly in the command action handler. This makes the dry-run logic harder to unit test without filesystem setup, and couples the extras detection to the CLI execution context.
- Impact: The actual `formatDryRunPlan` is well-tested as a pure function, but the extras detection logic that feeds into it (lines 201-208) cannot be tested without real directories on disk. This is a minor layering violation -- I/O detection mixed with formatting orchestration.
- Fix: Extract extras detection into a separate pure-ish function like `detectCleanupExtras(cwd: string, isSelective: boolean): Promise<string[]>` that can be tested with a temp directory.

## Pre-existing Issues (Not Blocking)

### MEDIUM

**`uninstall.ts` is a 610-line monolith combining scope detection, CLI interaction, dry-run, asset removal, hook cleanup, settings management, and shell profile management** - `src/cli/commands/uninstall.ts`
**Confidence**: 85%
- Problem: This file has grown to handle at least 7 distinct responsibilities in a single action handler. While the pure functions (`computeAssetsToRemove`, `formatDryRunPlan`) are well-separated, the action handler itself is a long procedural sequence mixing I/O, user prompts, scope resolution, and asset deletion.
- Impact: God-method tendency. Adding more features (like the dry-run in this PR) keeps expanding the monolith. Not blocking this PR, but should be tracked for refactoring.

### LOW

**Integration test `helpers.ts` uses `execSync`/`execFileSync` for CLI availability check** - `tests/integration/helpers.ts:11`
**Confidence**: 80%
- Problem: `isClaudeAvailable()` uses synchronous `execSync` which blocks the Node.js event loop. This is acceptable for test setup, but the pattern should not propagate to production code.
- Impact: Minimal -- test-only code.

## Suggestions (Lower Confidence)

- **Ambient-router skill has no `allowed-tools` frontmatter, making it implicitly unrestricted** - `shared/skills/ambient-router/SKILL.md:1-5` (Confidence: 70%) -- The removal of `allowed-tools` is intentional (documented in CLAUDE.md), but it creates an exception to the project's skill convention that every skill declares its tool access. A comment in the frontmatter like `# allowed-tools: unrestricted (orchestrator)` would make the exception explicit without re-adding the restriction.

- **`runClaude` helper defaults `ambient: true` which means all integration tests inject the preamble by default** - `tests/integration/helpers.ts:29` (Confidence: 65%) -- If a future test needs to verify non-ambient behavior, it must remember to pass `{ ambient: false }`. Defaulting to `true` couples all tests to ambient mode. Consider whether the default should be `false` with explicit opt-in.

- **Dry-run scope prompt skipped via `&& !dryRun`** - `src/cli/commands/uninstall.ts:168` (Confidence: 60%) -- When `--dry-run` is used with multiple scopes, all scopes are shown in the plan without letting the user choose. This is likely intentional (show the full picture), but it silently changes behavior vs. the non-dry-run path. A brief log noting "showing plan for all detected scopes" would clarify.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 1 | 0 |
| Should Fix | 0 | 0 | 2 | 0 |
| Pre-existing | 0 | 0 | 1 | 1 |

**Architecture Score**: 8/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The architecture of this PR is sound overall. The three commits address a real ambient-mode skill loading bug (removing `allowed-tools` restriction), add a well-designed `--dry-run` feature with proper pure-function extraction, and include thorough test coverage for both unit and integration scenarios.

The main architectural concern is the duplicated preamble string across the shell hook and TypeScript test helper (Blocking/MEDIUM). This should be addressed before merge to prevent future drift -- at minimum by adding cross-reference comments, ideally by establishing a single source of truth.

The `formatDryRunPlan` placement and extras-detection inline logic are Should-Fix items that would improve modularity but are not blocking. The broader `uninstall.ts` monolith is a pre-existing concern worth tracking separately.

**Conditions for approval:**
1. Address the preamble duplication (cross-reference comments at minimum)
