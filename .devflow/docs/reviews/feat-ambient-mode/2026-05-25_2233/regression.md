# Regression Review Report

**Branch**: feat-ambient-mode -> main
**Date**: 2026-05-25
**PR**: #227

## Issues in Your Changes (BLOCKING)

### HIGH

**Missing LEGACY_SKILL_NAMES entries for deleted `devflow:`-prefixed skill directories** - `src/cli/plugins.ts:LEGACY_SKILL_NAMES`
**Confidence**: 95%
- Problem: 17 skill directories were deleted (`router`, 7 triage skills, 7 guided skills, plus `router/classification-rules.md`). The bare names (`router`, `implement:triage`, `implement:guided`, etc.) already exist in `LEGACY_SKILL_NAMES` from a prior entry, but the `devflow:`-prefixed versions (`devflow:router`, `devflow:implement:triage`, `devflow:implement:guided`, `devflow:debug:triage`, `devflow:debug:guided`, `devflow:explore:triage`, `devflow:explore:guided`, `devflow:plan:triage`, `devflow:plan:guided`, `devflow:review:triage`, `devflow:review:guided`, `devflow:research:triage`, `devflow:research:guided`, `devflow:release:triage`, `devflow:release:guided`) are NOT in the list. Since skills are installed under `~/.claude/skills/devflow:router/`, `~/.claude/skills/devflow:implement:triage/`, etc., existing users who run `devflow init` after upgrading will retain stale skill directories that Claude Code may still present in its skill catalog, causing confusion or phantom skill loading. Applies ADR-001 (clean break philosophy) — but clean breaks still require cleanup of installed artifacts.
- Fix: Add the 15 `devflow:`-prefixed skill names to `LEGACY_SKILL_NAMES` in `src/cli/plugins.ts`:
```typescript
// v2.x ambient simplification: deleted router, triage, and guided skills
'devflow:router',
'devflow:implement:triage',
'devflow:implement:guided',
'devflow:debug:triage',
'devflow:debug:guided',
'devflow:explore:triage',
'devflow:explore:guided',
'devflow:plan:triage',
'devflow:plan:guided',
'devflow:review:triage',
'devflow:review:guided',
'devflow:research:triage',
'devflow:research:guided',
'devflow:release:triage',
'devflow:release:guided',
```

### MEDIUM

**`shared/rules/commands.md` exists but is orphaned from the build system** - `shared/rules/commands.md`
**Confidence**: 85%
- Problem: The new `commands.md` rule file is committed to `shared/rules/` (the single source of truth for rules), but no plugin's `plugin.json` declares it in a `rules` array. The CLAUDE.md states: "build fails if a declared rule is missing from `shared/rules/`" — but the inverse is also a consistency concern: a rule existing in `shared/rules/` that is never declared by any plugin creates a dead file. The rule is intentionally managed by `ambient.ts` directly (bypassing the rules pipeline), and the PR description documents this. However, the file in `shared/rules/` serves no build-system purpose — it's never distributed to any plugin and its content is already duplicated as `COMMANDS_RULE_CONTENT` in `ambient.ts`. This dual-source creates a maintenance risk: edits to one won't automatically propagate to the other.
- Fix: Either (a) remove `shared/rules/commands.md` since the authoritative source is `COMMANDS_RULE_CONTENT` in `ambient.ts`, or (b) have `ambient.ts` read the rule content from the shared source at build time to maintain single-source-of-truth. Option (a) is simpler and consistent with the rule being "managed by ambient.ts directly, not by the rules plugin system."

**`addAmbientHook` returns unchanged JSON but still writes commands rule** - `src/cli/commands/ambient.ts:95-130`
**Confidence**: 82%
- Problem: When the preamble hook already exists, `addAmbientHook` returns the original `settingsJson` string unchanged (the early return at the end: `if (!changed) return settingsJson`). However, before that return, it unconditionally writes `COMMANDS_RULE_CONTENT` to disk at line 126-127. In the `ambient --enable` action handler (line 232-240), when `updated === settingsContent`, it prints "Ambient mode already enabled" and returns — which is correct for idempotency of the hook. But the rule file write still happens silently. This is benign (idempotent file write) but the comment at line 234 acknowledges this asymmetry ("Hook already exists but rule may still need writing — addAmbientHook writes it anyway"). The real issue is for callers in `init.ts` line 1079: when ambient is being re-enabled after `removeAmbientHook` cleaned it, the `addAmbientHook` call correctly re-adds both. But if only the rule file was deleted (e.g., manually), the settings JSON would be unchanged and the caller would skip the `writeFile` of settings — while the rule gets silently re-written. This asymmetry is not a bug but makes the control flow harder to reason about.
- Fix: Consider splitting the rule write into a separate function (e.g., `ensureCommandsRule`) called explicitly in both the `--enable` handler and `init.ts`, keeping `addAmbientHook` purely focused on settings JSON manipulation. This preserves the original function's pure-function-like contract.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**`removeAmbientHook` return value ignores SessionStart cleanup result** - `src/cli/commands/ambient.ts:141-155`
**Confidence**: 85%
- Problem: The `removeAmbientHook` function calls `filterHookEntries(settings, 'SessionStart', isClassification)` at line 145 to clean up stale classification hooks from previous installs. However, it discards the return value (the `const removedClassification` was removed and the result is not captured). The function then only checks `if (!removedPrompt) return settingsJson` at line 154. This means: if a user has ONLY a stale SessionStart classification hook (no UserPromptSubmit preamble hook) and calls `removeAmbientHook`, the function will mutate the `settings` object in memory (removing the stale hook) but then return the *original* `settingsJson` string because `removedPrompt` is `false`. The cleaned-up settings are never persisted.
- Fix: Capture the SessionStart cleanup result and include it in the change check:
```typescript
const removedClassification = filterHookEntries(settings, 'SessionStart', isClassification);

if (!removedPrompt && !removedClassification) return settingsJson;
```

## Pre-existing Issues (Not Blocking)

(none)

## Suggestions (Lower Confidence)

- **`COMMANDS_RULE_CONTENT` references `/devflow:<name>` prefix but actual commands are `/plan`, `/implement`, etc.** - `src/cli/commands/ambient.ts:34` (Confidence: 70%) — The rule lists commands as backtick-quoted names (`plan`, `implement`, etc.) preceded by a heading that says "Use `/devflow:<name>` to trigger a workflow." However, the actual installed commands are `/plan`, `/implement`, etc. (as shown in CLAUDE.md's Agent & Command Roster and the README). If commands are actually invoked as `/devflow:plan` in the marketplace plugin format vs. `/plan` in the file-copy format, this could confuse users. Verify which format is canonical for the installed environment.

- **Integration test `plan handoff prompt` injects systemPrompt manually rather than relying on the actual preamble hook** - `tests/integration/ambient-activation.test.ts:40` (Confidence: 65%) — The test passes the directive as `--append-system-prompt` rather than verifying the actual preamble hook fires. This means the test validates that Claude responds to the directive, not that the hook produces it. The previous integration tests (though more complex) validated end-to-end behavior including the hook.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 2 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Regression Score**: 7/10
**Recommendation**: CHANGES_REQUESTED

The ambient simplification is architecturally sound — removing 17 skill files, a SessionStart hook, and ~1200 lines of classification/triage/guided infrastructure in favor of a lean plan-detection preamble plus a commands awareness rule (applies ADR-001). The orch skills, slash commands, and agent pipelines remain fully intact. Test coverage was properly updated: router structural tests, classification helpers, preamble drift tests, and all GUIDED/ORCHESTRATED integration tests were replaced with targeted plan-detection and non-plan assertions.

The blocking HIGH issue is concrete: 15 `devflow:`-prefixed skill directories will be orphaned on existing users' machines because `LEGACY_SKILL_NAMES` lacks the namespaced entries needed for cleanup during `devflow init`. This is a one-line-category fix that should be addressed before merge.

The two MEDIUM blocking issues (orphaned `shared/rules/commands.md` creating dual-source maintenance risk, and the `addAmbientHook` async side-effect asymmetry) are lower urgency but worth addressing for code clarity.

The should-fix MEDIUM (`removeAmbientHook` silently dropping SessionStart cleanup) is a real edge case that could leave stale hooks on upgrading users who had ambient enabled in the previous version.
