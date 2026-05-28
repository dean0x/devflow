# Architecture Review Report

**Branch**: HEAD -> main
**Date**: 2026-05-25
**PR**: #227

## Issues in Your Changes (BLOCKING)

### HIGH

**Dual-ownership of commands.md rule content — source-of-truth ambiguity** - `shared/rules/commands.md` + `src/cli/commands/ambient.ts:COMMANDS_RULE_CONTENT`
**Confidence**: 90%
- Problem: The commands awareness rule exists as both a static file in `shared/rules/commands.md` (the canonical rules source of truth) and as an embedded string constant `COMMANDS_RULE_CONTENT` in `ambient.ts`. The `ambient.ts` constant is what `addAmbientHook()` writes to `COMMANDS_RULE_PATH` at runtime. `shared/rules/commands.md` is declared in `devflow-ambient/plugin.json` under the `rules` array, which means the build system distributes it to `plugins/devflow-ambient/rules/commands.md` and the installer would write it to `~/.claude/rules/devflow/commands.md` via the normal rules pipeline. But `ambient.ts` also writes to the exact same path independently. This creates two competing write channels for the same file: (1) the rules installer during `devflow init`, and (2) `addAmbientHook()` during ambient enable. If content diverges between the two sources, the last writer wins silently. The CLAUDE.md explicitly states the rule "is managed by `ambient.ts` directly, not by the rules plugin system" — but the `shared/rules/commands.md` file exists and is declared in `plugin.json`, so the build system and installer still process it.
- Fix: Choose one owner. Either (a) remove `commands.md` from `shared/rules/` and `plugin.json` `rules` array entirely, keeping only `ambient.ts` as the owner, or (b) remove `COMMANDS_RULE_CONTENT` from `ambient.ts` and have `addAmbientHook()` rely on the normal rules installer to place the file — `ambient.ts` then only manages the hook registration. Option (a) is cleaner for the current design since the rule lifecycle is tied to ambient enable/disable, not to plugin selection.

**`addAmbientHook` performs filesystem I/O as side effect of settings-JSON transformation** - `src/cli/commands/ambient.ts:95-131`
**Confidence**: 85%
- Problem: `addAmbientHook()` was previously a pure synchronous function that transformed a JSON string and returned a JSON string — a clean separation-of-concerns design. It is now `async` and performs filesystem I/O (`fs.mkdir`, `fs.writeFile`) as a side effect. This mixes two responsibilities: (1) settings.json hook registration and (2) rule file installation. Callers (`init.ts`, `ambient.ts` command) now get an implicit side effect when they call what appears to be a settings-transformation function. Similarly, `removeAmbientHook()` now performs `fs.unlink` as a side effect. This violates SRP — the function name suggests it manages hooks in settings JSON, but it also manages a file on disk.
- Fix: Extract rule file management into a separate function (e.g., `installCommandsRule()` / `removeCommandsRule()`) that callers invoke explicitly alongside `addAmbientHook()` / `removeAmbientHook()`. The hook functions return to being pure settings-JSON transformers. Callers like `init.ts` and the `ambient` command then call both explicitly:
  ```typescript
  const updated = addAmbientHook(settingsJson, devflowDir); // pure JSON transform
  await installCommandsRule(); // explicit side effect
  ```

### MEDIUM

**`hasAmbientHook` only checks UserPromptSubmit — commands rule presence is undetected** - `src/cli/commands/ambient.ts:161-168`
**Confidence**: 82%
- Problem: The `hasAmbientHook()` detection function only checks for the preamble hook in `UserPromptSubmit`. It does not check whether the commands rule file exists at `COMMANDS_RULE_PATH`. The `--status` command reports ambient as "enabled" based solely on hook presence. A user who manually deletes the rule file or has a partially-failed install will see "enabled" but be missing the commands awareness component. This is an incomplete status check for a two-component system.
- Fix: Either (a) check for the commands rule file existence in `hasAmbientHook()` (e.g., `await fs.access(COMMANDS_RULE_PATH)` — would require making it async), or (b) acknowledge the rule as optional and document that the hook is the canonical signal for "ambient enabled," with the rule being a secondary artifact. Given that the PR description frames ambient as a "two-component system" (hook + rule), option (a) is more consistent with the stated architecture.

**`removeAmbientHook` silently cleans stale SessionStart hook but does not reflect removal in return value** - `src/cli/commands/ambient.ts:141-156`
**Confidence**: 80%
- Problem: `removeAmbientHook()` calls `filterHookEntries(settings, 'SessionStart', isClassification)` but discards the return value. If a user's settings.json only has a stale `session-start-classification` hook and no `UserPromptSubmit` preamble hook, `removedPrompt` is `false` and the function returns the original JSON unchanged — even though it mutated the `settings` object to remove the classification hook. The stale hook is silently left in place because the mutated object is not serialized to the return value.
- Fix: Track both removals and serialize if either was removed:
  ```typescript
  const removedPrompt = filterHookEntries(settings, 'UserPromptSubmit', isAmbient);
  const removedClassification = filterHookEntries(settings, 'SessionStart', isClassification);
  // ...
  if (!removedPrompt && !removedClassification) return settingsJson;
  ```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Plugin.json declares `rules: []` for devflow-ambient but commands.md rule exists in shared/rules/** - `plugins/devflow-ambient/.claude-plugin/plugin.json`
**Confidence**: 85%
- Problem: The `plugin.json` for `devflow-ambient` declares `"rules": []` (empty), yet `shared/rules/commands.md` exists and is clearly intended for this plugin. If the intent is for `ambient.ts` to manage the rule directly (bypassing the rules pipeline), then `commands.md` should not be in `shared/rules/` at all — it will be distributed by the build system to any plugin that declares it, and the count in CLAUDE.md says "13 rules" which includes it. If the intent is for the rules pipeline to manage it, it should be declared in `plugin.json`. The current state is inconsistent: the file exists in the rules source directory but is not declared by any plugin.
- Fix: Align with one approach. If `ambient.ts` owns the rule: remove `shared/rules/commands.md` from the source tree (the embedded constant in `ambient.ts` is the source of truth). If the rules pipeline owns it: add `'commands'` to the `devflow-ambient` `plugin.json` `rules` array and remove `COMMANDS_RULE_CONTENT` from `ambient.ts`.

## Pre-existing Issues (Not Blocking)

No pre-existing issues at CRITICAL severity identified.

## Suggestions (Lower Confidence)

- **Plan detection markers may be too broad** - `scripts/hooks/preamble:25` (Confidence: 70%) — The three markers (`## Goal`, `## Steps`, `## Files`) are common markdown headings. A user writing documentation or a README that happens to contain all three will trigger the implement directive unexpectedly. Consider a more specific marker like `<!-- devflow:plan -->` or requiring an additional discriminator.

- **`devflow-ambient` plugin.json still declares all 14 agents** - `plugins/devflow-ambient/.claude-plugin/plugin.json` (Confidence: 65%) — The plugin still declares the full agent roster (coder, validator, simplifier, scrutinizer, evaluator, tester, skimmer, reviewer, git, synthesizer, resolver, designer, knowledge, researcher) from the old 4-layer classification era. With the simplified architecture (only plan detection triggers implement), most of these agents are never spawned by ambient mode itself — they are spawned by the implement:orch skill, which belongs to devflow-implement. This over-declaration inflates the ambient plugin's footprint without architectural justification.

- **Integration test uses `systemPrompt` to simulate hook injection** - `tests/integration/ambient-activation.test.ts:40` (Confidence: 65%) — The plan detection test passes the hook's output message as `--append-system-prompt` rather than verifying the actual hook fires. This tests the model's response to the directive but not the hook's plan detection logic itself. A shell-level test of the preamble hook would be more architecturally rigorous.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 2 | 2 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Architecture Score**: 7/10
**Recommendation**: CHANGES_REQUESTED

The PR achieves a significant and well-motivated architectural simplification — replacing a complex 4-layer ambient classification pipeline (router + 7 triage skills + 7 guided skills + classification hook) with a minimal 2-component system (plan detection hook + commands rule). This is a net architectural improvement: fewer moving parts, zero per-prompt overhead for normal messages, and elimination of ~1200 lines of classification machinery. The clean break approach applies ADR-001.

The main architectural concern is the dual-ownership of the commands rule content (both `shared/rules/commands.md` and `COMMANDS_RULE_CONTENT` in `ambient.ts`) and the mixing of pure JSON transformation with filesystem I/O in `addAmbientHook`/`removeAmbientHook`. These are not blocking defects but represent coupling that should be addressed before merge to prevent future maintenance confusion. The stale classification hook cleanup bug (`removeAmbientHook` silently dropping the mutation) should also be fixed.
