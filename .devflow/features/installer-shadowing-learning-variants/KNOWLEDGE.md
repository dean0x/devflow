---
feature: installer-shadowing-learning-variants
name: Learning-aware Install & Language-focus Stamp
description: "Use when changing learning-off variants, convergeLearningVariants, applyLearningToggle, the apply-decisions skill gate or the /code-review language-focus stamp. Keywords: learning-off, converge, stamp."
category: architecture
directories: [src/targets/claude-code/learning-install.ts, src/targets/claude-code/language-stamp.ts, src/cli/commands/learning.ts, src/targets/claude-code/installer.ts, src/core/assets.ts]
created: 2026-10-10
updated: 2026-10-10
---

# Learning-aware Install & Language-focus Stamp

## Rules

- **KB-AP-1** `FileCopyOptions.learning` has no default, and `init` passes the SETTLED `learningEnabled`, never the raw seed or a repository's narrowing: the variant follows the machine switch alone, and the copied files and the manifest must agree.
- **KB-AP-2** Never express "learning off" by removing `apply-decisions` from a plugin's `skills` or `requires`: the closure guard reasons over the learning-on superset, and a plan-level removal would report the skill as a deselection (`removedSkills`). The exclusion is the install-time `LEARNING_GATED_SKILLS` condition on an untouched plan.
- **KB-AP-3** Never re-stamp the language list after each converge write or derive it from `manifest.plugins` in a toggle: the stamped copy always differs from source (rewritten every `devflow init`), and a selective uninstall leaves `manifest.plugins` stale (resurrects a removed language). The converge CARRIES the installed list; install and uninstall are the only writers.
- **KB-AP-4** Never put prompt text, an out-of-pattern name, or a duplicated stamp line on the stamp: `applyLanguageStamp` refuses over `MAX_STAMPED_FOCUSES`, any name outside the focus-name pattern, and a file with no stamp line or several.
- **KB-AP-5** The converge never throws and never stops a run: every failure is a warning and `converged: false`; a damaged stamp line is a warning to run `devflow init`, never a stop rule.
- **KB-AP-6** Never read a missing `dist/learning-off` as a no-op: after `build:cli` alone the converge warns to run `npm run build:mds` and reports `converged: false`.
- **KB-AP-7** The converge never installs an uninstalled plugin's prompt: a roster entry with no installed copy is left alone (`notInstalled`).
- **KB-INV-1** The learning switch picks variants machine-wide: a repository that narrows learning in `project.json` never reaches the installer; learning-on files keep their run-time gate.
- **KB-INV-2** `resolveSkillSource` is the one spelling of the shadow decision, shared by the install loop and the converge; it stat-checks the shipped source FIRST and throws if absent, even under a valid shadow.
- **KB-INV-3** A converge write is byte-compared with the installed file and written only when different, atomically (`writeFileAtomicExclusive`); a steady-state run moves nothing.
- **KB-INV-4** An installed agent keeps its `model:` and `effort:` across a variant rewrite (`carryAgentOverrides`); `reapplyAgentMapping` stays the authority and the carry only closes the shipped-model window.
- **KB-INV-5** The `/code-review` stamp is computed from the EFFECTIVE selection (what is on disk), never the plugins one run copies, and only `code-review.md` carries it (`LANGUAGE_STAMPED_COMMANDS`).
- **KB-INV-6** A shadow of `apply-decisions` is dormant under learning off: kept in `~/.devflow/skills/`, never installed, never deleted, applied again on enable.
- **KB-INV-7** A learning toggle across a CLI version skew records the switch but converges nothing (`learningToggleSkew`); both mismatches are safe by design.

## Overview

The build emits a learning-off variant of every command and agent that carries a learning arm into `dist/learning-off/{commands,agents}/` (the marker splitter, `src/core/learning-variants.ts`, belongs to the `learning-capture-system` KB). The install follows the machine's learning switch (`features.learning` in `~/.devflow/manifest.json`) and nothing else: the installed agents are machine-wide, so one repository's narrowing cannot pick them without changing every other repository's prompts (`D-LEARNING-VARIANT-INSTALL`). A separate mechanism stamps the installed `/code-review` with the language focuses on disk (`D-LANGUAGE-FOCUS-STAMP`); both live in `src/targets/claude-code/` and reach installed files after the copy.

## Learning-aware Install and Converge (`learning-install.ts`)

Three pieces carry it:
- **Source order.** `FileCopyOptions.learning` is REQUIRED with no default, because a caller that forgot it would install the wrong variant with no error. `init` passes the SETTLED `learningEnabled` (after flag, prompt and seed). Commands resolve over `commandSourceDirs(learning)` and agents over `agentSourceDirs(undefined, learning)`: with learning off the off-variant directory is consulted first, and a host with no arm falls through to its one compiled file.
- **Skill condition.** The skill loop runs over `omitLearningGatedSkills(skillsMap, learning)`, so `apply-decisions` is not installed with learning off. The full-install pre-clean walks the UNFILTERED `skillsMap`, so a full install also drops a leftover copy; a partial install leaves removal to the converge. The registry still owns and requires the skill and `resolveSkillInstallPlan` is untouched, so a learning-off machine never reports it as a deselection nor its shadow as inactive. Only skills and rules have shadows; commands and agents have none, so an off variant has nothing to collide with.
- **`resolveSkillSource(skill, devflowDir, packageRoot?)`** (`installer.ts`, returns `ResolvedSkillSource = { dir, shadow }`) stat-checks the shipped source FIRST and throws when it is absent, even under a valid shadow (a packaging failure a shadow must not mask), then `validateSkillShadow`: a valid shadow wins, an invalid one is reported and the shipped source installs.

**`convergeLearningVariants({claudeDir, devflowDir, learning, plugins, warn, packageRoot?})`** makes an ALREADY-installed tree match the switch. It never throws: every failure is a warning and `converged: false`, and a non-absolute `claudeDir` is warned and skipped. A failure only warns because either mismatch is safe — an on variant is still gated at run time and an off variant loads no decisions.
- *Roster*: the `.md` files under `dist/learning-off/{commands,agents}` whose name matches the roster pattern (`^[a-z0-9][a-z0-9-]*\.md$`, sorted, at most `MAX_LEARNING_ROSTER` per kind), never a list typed in the installer, so a new arm converges with no edit here. A missing directory (only `build:cli` ran) warns to run `npm run build:mds` and leaves the installed prompts as they are.
- *Rewrites only installed files*: a roster entry with no installed copy is left alone (`notInstalled`) — a `--plugin` install carries one plugin's files and a toggle must not add another plugin's. The wanted bytes are the variant (off: the roster file; on: the first existing file over the normal source order) wearing the installed copy's state (`withInstalledState`). An agent carries its installed `model:` and `effort:` (`carryAgentOverrides` in `agent-models.ts`, `D-AGENT-OVERRIDE-CARRY`: the two lines `devflow agents` and the proxy put there; the source comes back unchanged when either side has no well-formed frontmatter or the carried model/effort fail their guards). `code-review` carries its language stamp (`stampForConverge`). The result is byte-compared with the installed file and written only when different, atomically (`writeFileAtomicExclusive`), so a steady-state run moves nothing and a no-op converge rewrites no agent. `reapplyAgentMapping` stays the authority; the carry only shuts the window in which a rewritten agent would sit on its shipped model.
- *Skill*: with learning off it removes the `devflow:apply-decisions` directory when present; with learning on it installs only when `skillsOf(plugins)` holds the skill (else `not-selected`), from `resolveSkillSource` (shadows and `packageRoot` honoured), skipping when the two trees hold the same files and bytes, otherwise a staged swap. Staging sits at `{claudeDir}/.devflow-learning-<pid>-<ts36>.tmp`, never under `skills/` (a stranded directory there would look like a second skill); the old directory is displaced to `.old` and restored if the rename fails. Each file and each gated skill is tried separately, and a failed prompt never skips the skill. `LearningSkillState = installed | removed | unchanged | not-selected | failed`.

**Callers.** `init` calls it right after `installViaFileCopy` with `plugins: effectivePlugins` and `learning: learningEnabled`, routing warnings (and a thrown error, defensively) into `installWarnings`; `reapplyAgentMapping` runs later in init (preflight ordering is in the init-seed KB). It is the authority behind the carry, not the repair of a default-model window. `devflow learning --enable/--disable`: `handleToggle` writes the machine switch first (`writeMachineFeature`; exit 1 when Devflow is not installed), then `convergeInstalledVariants` calls `applyLearningToggle`, which SKIPS with a "run `devflow init`" message when there is no readable manifest or the manifest's version differs from the running CLI's (`learningToggleSkew`: the installed prompts are not ones this package would rewrite; the switch itself is already recorded). Otherwise it converges over the registry filtered by `manifest.plugins` and runs `reapplyAgentMapping` only when the converge rewrote an agent. `describeLearningConverge` prints one `Installed prompts: …` line only when something changed, and the exit code never changes. Re-init without a learning flag keeps the prior manifest value; only `--learning` / `--no-learning` or `devflow learning` flips it.

## Language-focus Stamp (`language-stamp.ts`, `D-LANGUAGE-FOCUS-STAMP`)

`/code-review` spawns a language focus only when its file-type trigger fires AND the focus appears on the one line `Installed language focuses: <list>` of the installed command; the installer writes that line, replacing a run-time `test -f` probe of Claude Code's directory.
- *Carrier*: shipped as `Installed language focuses: (none)` in `code-review.mds` (Step 1.2, outside every learning arm so both variants carry it, no interpolation braces) and found again by an anchored multiline match; exactly one match is required. Only `code-review.md` carries it (`LANGUAGE_STAMPED_COMMANDS`); `/dynamic-build` spawns every focus and has no stamp. A default install, with no language plugin, leaves code-review byte-identical to the build.
- *List*: `installedLanguageFocuses(effectivePlugins)` is plumbing only (which focuses a diff gets stays a prompt rule). It comes from the EFFECTIVE selection (`FileCopyOptions.effectivePlugins`: the full selection on a full install, the prior manifest's plugins merged with X on `--plugin=X`), because the stamp describes what is on disk.
- *Writers*: (1) `installViaFileCopy` calls `restampInstalledCommands({claudeDir, effectivePlugins, warn})` after the command copy and command sweep, on every install shape and even when code-review's own plugin is not in the run (`--plugin=devflow-typescript` copies no command yet must update an installed code-review; an absent command stays absent). It compares against the bytes on disk at write time, so neither the same-run copy nor the pre-clean can defeat it; `init.ts` is untouched. (2) The uninstall's `runSelectivePhaseForScope` re-stamps right after `removeSelectedPlugins` from `installedPlugins` minus the selected plugins (a language plugin owns a skill and no command, so otherwise the removed skill's name would stay on the line), under the legacy-local `mayChange` guard. (3) The converge CARRIES the stamp rather than re-stamping (`stampForConverge` calls `carryLanguageStamp` inside the write path, before the byte comparison). So install and uninstall are the only writers of an existing list and a toggle never changes it. A copy with no well-formed list to carry (installed before the stamp existed) is stamped from the converge's selection instead of being handed the shipped `(none)`.
- *Safety*: `applyLanguageStamp` returns a Result and refuses more than `MAX_STAMPED_FOCUSES` focuses, any name outside `FOCUS_NAME_RE` (`^[a-z][a-z0-9-]{0,31}$`; no prompt text can ride in on the list) and a file with no stamp line or several; `carryLanguageStamp` copies only a single well-formed line. A damaged or missing line is a warning to run `devflow init`, never a stop rule, and nothing here throws.
- *Edges*: a selective uninstall does not rewrite `manifest.json`, so `manifest.plugins` still lists the removed language plugin and a later `init --plugin=X` or full re-init re-installs that skill AND stamps it, consistent with disk; with no readable manifest the re-stamp falls back to the whole registry minus the selected plugins; `uninstall --dry-run` does not list the re-stamp (a rewrite, not a removal).

## Anti-Patterns

- **KB-AP-1** The option is required precisely because a forgetful caller installs the wrong variant silently. Passing the raw seed would let the copied files and the written manifest disagree; gating on a repository's narrowing would change every other repository's prompts.
- **KB-AP-2** The skill stays in the registry's `skills` / `requires` (the closure guard `tests/guards/requires-closure.test.ts` reasons over learning-on); the gate is `LEARNING_GATED_SKILLS` applied at install time and in the converge.
- **KB-AP-3** The stamped copy always differs from shipped source, so re-stamping after every converge write would rewrite it on every `devflow init`. A selective uninstall leaves `manifest.plugins` stale, so a manifest-derived stamp in a toggle would resurrect the removed language. `stampForConverge` therefore carries; the only two writers are install and uninstall.

## Gotchas

- **KB-AP-6** After `npm run build:cli` alone there are no variants: `convergeLearningVariants` warns and leaves prompts as they were, while `installViaFileCopy` on a learning-off machine falls through to the learning-on files, so the install itself still succeeds.
- **KB-INV-7** `devflow learning --enable/--disable` after a CLI upgrade and before `devflow init` records the switch but converges nothing; the installed prompts stay on the old variant until init. An on variant keeps its run-time gate and an off variant loads no decisions, so neither mismatch is harmful.
- **KB-INV-6** Under learning off the `apply-decisions` shadow stays in `~/.devflow/skills/` unapplied and undeleted, and a learning-off machine reports the skill neither as a deselection (`removedSkills`) nor its shadow as inactive; both come back on enable.
- **KB-AP-7** A `--plugin` install carries one plugin's files, so a toggle must rewrite only prompts that are already installed.

## Key Files

- `src/targets/claude-code/learning-install.ts` — `convergeLearningVariants` (+ `ConvergeLearningVariantsOptions` / `Result`, `LearningSkillState`), `applyLearningToggle`, `learningToggleSkew`, `describeLearningConverge`, `readRunningVersion`, `MAX_LEARNING_ROSTER`; its header is the design record for `D-LEARNING-VARIANT-INSTALL`
- `src/targets/claude-code/language-stamp.ts` — `LANGUAGE_STAMP_PREFIX`, `LANGUAGE_STAMP_NONE`, `LANGUAGE_STAMPED_COMMANDS`, `renderLanguageStamp`, `applyLanguageStamp` (Result), `carryLanguageStamp`, `stampForConverge`, `restampInstalledCommands` (called by `installViaFileCopy` and uninstall's selective phase); its header is the design record for `D-LANGUAGE-FOCUS-STAMP`
- `src/targets/claude-code/installer.ts` — `FileCopyOptions.learning` (REQUIRED), `resolveSkillSource` / `ResolvedSkillSource`, the skill loop over `omitLearningGatedSkills`, the `restampInstalledCommands` call after the command copy and sweep
- `src/core/assets.ts` — `learningOffDir`, `commandSourceDirs`, `agentSourceDirs(root?, learning)`
- `src/core/plugins.ts` — `LEARNING_GATED_SKILLS`, `omitLearningGatedSkills`, `PRESENCE_GATED_SKILLS`, `installedLanguageFocuses`
- `src/cli/commands/learning.ts` — the install half of the toggle only: `handleToggle` → `convergeInstalledVariants` → `applyLearningToggle`; the rest belongs to the `learning-capture-system` KB
- `src/core/learning-variants.ts` — the build-side marker splitter (owned by `learning-capture-system`); the installer consumes only `LEARNING_OFF_OUTPUT_DIR` and `LearningVariantKind`, through `assets.ts`
- `src/core/agent-models.ts` — `carryAgentOverrides`, `reapplyAgentMapping`

## Related

- `.devflow/features/installer-shadowing/KNOWLEDGE.md` — hub: accessors, hard-error policy, `InstallReport`, selection-scoped skill install
- `.devflow/features/installer-shadowing-init-seed/KNOWLEDGE.md` — where init settles the learning switch and orders `reapplyAgentMapping` after the converge
- `.devflow/features/installer-shadowing-uninstall/KNOWLEDGE.md` — the selective phase that re-stamps `/code-review`
- `.devflow/features/learning-capture-system/KNOWLEDGE.md` — the machine feature switch, narrow-only repository switches and the build-side variant splitter
- `.devflow/features/dynamic-workflow-engine/KNOWLEDGE.md` — `/dynamic-build`, which spawns every focus and carries no stamp
