---
feature: installer-shadowing
name: Installer & Skill/Rule Shadowing
description: "Use when modifying the install pipeline (installViaFileCopy, installAllRules, composeScripts, InstallReport), adding or changing skill/rule shadow override logic, touching uninstall scope (enumerateUserDevFlowContent, removeDevFlowInstallArtifacts, resolveDevflowDirCleanup) or install-artifact cleanup, extending the CLI skills/rules management commands, working with asset directory accessors (rulesDir, skillsDir, commandsDir) and package-root resolution, or modifying the init seeding layer (resolveInitSeed, resolveSeedFeatures, resolveSeedFlags, resolveSeedPlugins, --reset, knownFlags, knownPlugins, readConfigIfPresent, resolveExistingViewMode, getAllCommandNames, applyNonSelectableCarry). Keywords: installViaFileCopy, installAllRules, composeScripts, InstallReport, RuleInstallOutcome, SkillShadowState, RuleShadowState, shadow, unshadow, validateSkillShadow, validateRuleShadow, seedRuleShadow, prefixSkillName, unprefixSkillName, devflow:, skills, rules, uninstall, EISDIR, enumerateUserDevFlowContent, removeDevFlowInstallArtifacts, resolveDevflowDirCleanup, getPackageRoot, rulesDir, skillsDir, agentsDir, commandsDir, scriptsDir, LEGACY_SKILL_NAMES, LEGACY_AGENT_NAMES, orphan sweep, getAllSkillNames, getAllCommandNames, resolveInitSeed, resolveSeedFeatures, resolveSeedFlags, resolveSeedPlugins, resolveResetGatedInputs, resolveNonSelectableOptionalCarry, applyNonSelectableCarry, applyCliToggles, knownFlags, knownPlugins, readConfigIfPresent, resolveExistingViewMode, resolveFinalViewMode, reset, init-seed."
category: architecture
directories: [src/targets/claude-code/installer.ts, src/targets/claude-code/legacy.ts, src/cli/commands/init.ts, src/cli/commands/init-seed.ts, src/cli/commands/uninstall.ts, src/cli/commands/rules.ts, src/cli/commands/skills.ts, src/core/plugins.ts, src/core/assets.ts, src/core/paths.ts, src/core/manifest.ts, src/core/flags.ts, src/core/feature-config.ts]
created: 2026-07-13
updated: 2026-07-24
---

# Installer & Skill/Rule Shadowing

## Overview

Devflow installs its assets (skills, rules, agents, commands, scripts) via a single path: `installViaFileCopy` in `src/targets/claude-code/installer.ts`. File copy is the sole install mechanism. All asset source paths are resolved via named accessors in `src/core/assets.ts`, which are backed by `getPackageRoot()` in `src/core/paths.ts`. `installViaFileCopy` returns an `InstallReport` that `init.ts` uses to surface shadow and skip events in the post-install summary.

The shadow override system lets users place personal versions of skills or rules at well-known paths under `~/.devflow/`. On every `devflow init` or `devflow rules --enable`, Devflow detects a valid shadow and installs the user's copy instead of the Devflow source — without failing init. This knowledge covers the entire install-to-uninstall lifecycle, the CLI surface for managing overrides, and the state-aware init seeding layer.

## System Context

The installer is called from two entry points:
- **`devflow init`** — calls `installViaFileCopy` as part of the full install flow; consumes `InstallReport` for the post-install summary.
- **`devflow rules --enable`** — calls `installAllRules` directly; mirrors the init rules block without re-running skill install.

Shadow state is also read by `devflow skills list` and `devflow rules list` for the status display, and by `uninstall.ts` to enumerate user-authored content before cleanup.

## Component Architecture

### Asset Directory Accessors (`src/core/assets.ts`)

Every path to a source asset is obtained through a named accessor — no scattered `path.resolve(__dirname, '../..')` lookups anywhere in the installer:

| Accessor | Resolves to |
|----------|-------------|
| `skillsDir()` | `{root}/src/assets/skills/` — flat; one subdir per skill |
| `agentsDir()` | `{root}/src/assets/agents/` — flat; one `.md` per agent |
| `rulesDir()` | `{root}/src/assets/rules/` — flat; one `.md` per rule |
| `scriptsDir()` | `{root}/src/assets/scripts/` — hooks/ and hud.sh |
| `commandsDir()` | `{root}/dist/commands/` — compiled MDS + verbatim .md files |

All five call `getPackageRoot()` internally.

### Package Root Resolution (`src/core/paths.ts`)

`getPackageRoot()` resolves the package root from `import.meta.url` depth — 2 levels up from compiled `dist/core/paths.js`. It **throws loudly** if `package.json` is absent at the resolved root. Depth-mismatch bugs surface immediately at install time rather than silently producing wrong paths.

### Hard-Error Policy for Declared Sources

All four asset types now **throw** when a declared source is absent — there are no silent skips for registered assets:

| Asset type | Source checked | Error trigger |
|------------|---------------|---------------|
| Command | `dist/commands/{name}.md` | `fs.access` fails |
| Agent | `src/assets/agents/{name}.md` | `fs.access` fails |
| Skill | `src/assets/skills/{name}/` | `stat` not a directory |
| Rule | `src/assets/rules/{name}.md` | `fs.access` fails |

Shadow paths remain tolerant: invalid/missing shadows warn-and-install-source (applies ADR-010). The hard-error policy applies only to declared Devflow sources.

### Orphan Sweep (full install only)

On full (non-partial) install, `installViaFileCopy` reads `~/.claude/skills/` and removes any `devflow:*` directory whose bare name is absent from `getAllSkillNames()` (the live registry). This is the mechanism for cleaning up renamed or deleted skills across upgrades without requiring manual removal.

Bare (pre-namespace) dirs are **not touched** by the sweep — they are handled exclusively by the frozen `LEGACY_SKILLS_*` lists in `legacy.ts` (avoids PF-012). Shadow dirs (`~/.devflow/skills/`) are keyed by bare registry name and are unaffected.

### InstallReport

`installViaFileCopy` returns `InstallReport`:

```typescript
export interface InstallReport {
  shadowedSkills: string[];  // bare skill names that had a valid shadow applied
  shadowedRules: string[];   // bare rule names that had a valid shadow applied
  skippedShadows: ShadowSkip[];  // invalid shadows that were bypassed
}

export interface ShadowSkip {
  kind: 'skill' | 'rule';
  name: string;
  reason: ShadowSkipReason;  // 'missing-skill-md' | 'empty-shadow-file' | 'not-a-file'
}
```

`init.ts` iterates `skippedShadows` and emits a warning per entry via an exhaustive switch on `ShadowSkipReason` (with `never` guard). Invalid shadows never cause init to exit non-zero. (applies ADR-010)

### Manifest Snapshots: `knownFlags` and `knownPlugins`

`manifest.ts` stores two registry snapshots at install time:

- `ManifestData.features.knownFlags?: string[]` — all `FLAG_REGISTRY` IDs at the time of the last install
- `ManifestData.knownPlugins?: string[]` — all `DEVFLOW_PLUGINS` names at the time of the last install

Both are absent in pre-7b manifests; `readManifest` self-heals via a local `asStringArray` helper that requires all elements to pass `typeof e === 'string'` — a mixed/garbage array like `[1, null]` self-heals to `undefined`, not just non-arrays. These snapshots are consumed by the init seeding layer to detect newly added flags and plugins.

### RuleInstallOutcome

`installRuleFile` returns a discriminated `RuleInstallOutcome` per rule:

```typescript
export type RuleInstallOutcome =
  | 'shadow'                                  // valid shadow applied
  | 'source'                                  // Devflow source installed (no shadow)
  | 'source-invalid-shadow:empty-shadow-file' // source installed; shadow was empty
  | 'source-invalid-shadow:not-a-file'        // source installed; shadow path is a dir
  | 'skipped';                                // copy failed (EACCES, ENOSPC) — degrade
```

The compound `source-invalid-shadow:*` variants carry the specific reason directly in the outcome. Note: `'skipped'` is now only returned for copy-level failures (EACCES, ENOSPC) — a missing declared rule source now throws rather than returning `'skipped'`. `installViaFileCopy` decodes outcomes to populate `InstallReport.skippedShadows`.

### SkillShadowState / RuleShadowState

```typescript
export type SkillShadowState = 'valid' | 'missing-skill-md' | 'none';
export type RuleShadowState = 'valid' | 'empty-shadow-file' | 'not-a-file' | 'none';
```

Both are exported from `installer.ts` and imported by `skills.ts` and `rules.ts` for use in the exhaustive `buildSkillShadowTag` / `buildRuleShadowTag` display switches.

### installAllRules

The single compute site for rule installation. Both `installViaFileCopy` and `rules --enable` call it. There is **no `pluginsDir` or `ownerPlugin` parameter** — rule source is resolved internally by `installRuleFile` via `rulesDir()`:

```typescript
export async function installAllRules(
  rulesMap: Map<string, string>,
  devflowDir: string,
  rulesTarget: string,
): Promise<{ ruleName: string; outcome: RuleInstallOutcome }[]>
```

One place computes; callers present the outcomes.

### composeScripts

`composeScripts(scriptsTarget)` assembles `~/.devflow/scripts/` from three sources in order:

**(a) `src/assets/scripts/` verbatim** — hooks/ subdirectory and `hud.sh` entry script copied via `copyDirectory`, with executable bits applied via `chmodRecursive` (non-Windows only).

**(b) Transitive `dist/hud/` import graph** — starting from `dist/hud/index.js`, walks all relative JS import/export specifiers, copies each reachable module to `scriptsTarget` preserving its `dist/`-relative path.

**(c) `package.json` with `{"type":"module"}`** — written with `flag: 'wx'` (exclusive create); an existing file is left as-is.

Frozen externally-referenced paths: `~/.devflow/scripts/hooks/run-hook` and `~/.devflow/scripts/hud.sh`.

### Skill Namespace (`prefixSkillName` / `unprefixSkillName`)

Skills install under `~/.claude/skills/devflow:{name}` (prefixed). The `devflow:` prefix is applied at install time; source directories in `src/assets/skills/` stay unprefixed. Shadow dirs also stay unprefixed at `~/.devflow/skills/{name}/`.

`skills.ts` CLI accepts both prefixed and bare input (`unprefixSkillName` normalizes before lookup). `getAllCommandNames()` in `plugins.ts` derives unique command names (without leading `/`) from all plugins — the install loop uses this to build `commandsSourceNames`.

### Universal Skill Install

All skills from ALL plugins install regardless of plugin selection. `skillsMap` passed to `installViaFileCopy` is built by `buildFullSkillsMap` which covers every `DEVFLOW_PLUGINS` entry — not just the selected subset. Rules, by contrast, are plugin-scoped (only selected plugins' rules install).

### LEGACY_* Symbol Split

Legacy cleanup lists are split across two files:

| Symbol | File |
|--------|------|
| `LEGACY_AGENT_NAMES`, `LEGACY_SKILL_NAMES` (+ `LEGACY_SKILLS_PRE_V1`, `LEGACY_SKILLS_V2`, `LEGACY_SKILLS_V2X`) | `src/targets/claude-code/legacy.ts` |
| `LEGACY_PLUGIN_NAMES`, `LEGACY_COMMAND_NAMES`, `LEGACY_RULE_NAMES` | `src/core/plugins.ts` |

The split keeps target-specific delete lists separate from the plugin registry consumed by cross-cutting CLI commands. (avoids PF-012)

## Component Interactions

### Shadow Validation Flow (skills)

`validateSkillShadow(shadowDir)` in `installer.ts`:
- Returns `'none'` — shadow dir absent
- Returns `'valid'` — dir exists with a non-empty `SKILL.md` file
- Returns `'missing-skill-md'` — dir exists but `SKILL.md` absent, empty, or not a file

On `'valid'`: `copyDirectory(shadowDir, skillTarget)` replaces the install with the user's copy.
On `'missing-skill-md'`: adds to `skippedShadows`, installs Devflow source.
On `'none'`: installs Devflow source silently.
Before any copy: the skill source directory is stat-checked and throws if absent (hard-error policy — not a shadow concern).

### Shadow Validation Flow (rules)

`validateRuleShadow(shadowFile)` in `installer.ts`:
- Returns `'none'` — file absent
- Returns `'valid'` — file exists, is a regular file, non-empty
- Returns `'empty-shadow-file'` — file exists and is a file but has size 0
- Returns `'not-a-file'` — path exists but is not a file (e.g. a directory)

`installRuleFile(ruleName, devflowDir, rulesTarget)` uses this result. Rule source is always resolved internally: `path.join(rulesDir(), `${ruleName}.md`)`. The declared source is checked via `fs.access` and throws if absent — this check runs after shadow validation so a valid shadow bypasses it. Per-copy failures are isolated (avoids PF-009).

### Uninstall Scope

`removeAllDevFlow(claudeDir, devflowScriptsDir, verbose)` (internal, not exported) removes:
- `~/.claude/commands/devflow/`
- `~/.claude/agents/devflow/`
- `~/.claude/rules/devflow/`
- `devflowScriptsDir` (`{devflowDir}/scripts/`)
- All skill variants for every skill in `getAllSkillNames() ∪ LEGACY_SKILL_NAMES` (prefixed, bare, and `devflow-{name}` variants)

After `removeAllDevFlow`, scope-specific logic handles the remainder of `devflowDir`. The scope decision lives in `resolveDevflowDirCleanup(opts)`, a **pure exported function** (mirrors `resolveSecurityRemovalDecision`) — no I/O, no side effects, fully testable.

**Precondition guard** (inside `resolveDevflowDirCleanup`): four invariants must hold — `basename(devflowDir) === '.devflow'`, `devflowDir !== homeDir`, `devflowDir !== '/'`, and `devflowDir.startsWith(homeDir + sep)`. Any invariant failure → returns `'artifacts-only'` immediately (never throws in business logic; guards DEVFLOW_DIR env overrides and malformed paths).

Returns `'artifacts-only'` or `'prompt'`:

**Local scope** (`gitRoot/.devflow/`): `resolveDevflowDirCleanup` returns `'artifacts-only'` immediately (`scope !== 'user'`). Never removes project data (memory, learning, features, docs, config.json). Only `removeDevFlowInstallArtifacts` runs — removes `manifest.json`.

**User scope** (`~/.devflow/`): Calls `enumerateUserDevFlowContent(devflowDir)` first (before any removal — avoids reading files that no longer exist). Then calls `resolveDevflowDirCleanup`:
- `'artifacts-only'` — non-interactive session, no user content, or precondition guard failure; runs `removeDevFlowInstallArtifacts` only.
- `'prompt'` — interactive session with user content present; prompt states full scope (listed user-authored items, plus logs and install metadata). Confirm → `fs.rm(devflowDir, {recursive: true, force: true})`; decline OR cancel → falls through to `removeDevFlowInstallArtifacts` (clean end-state — never `process.exit()` here; applies ADR-003, avoids PF-014).

`enumerateUserDevFlowContent(devflowDir)` checks for: `devflowDir/skills/` (skill shadows), `devflowDir/rules/` (rule shadows), `devflowDir/preference-profile.md`, and `devflowDir/learning.json`. Returns a human-readable label for each that exists. Pure I/O — no side effects.

`removeDevFlowInstallArtifacts(devflowDir, verbose)` removes only `manifest.json` (install state). Scripts are already gone via `removeAllDevFlow`.

### Init Seeding Layer (`init-seed.ts`)

A dedicated pure-function module (`src/cli/commands/init-seed.ts`) computes the initial prompt state for `devflow init` from the existing manifest, project config, settings.json, and registry. All functions are I/O-free and testable in isolation (applies ADR-013).

**Composition point**: `resolveInitSeed(seedManifest, seedConfig, settingsSnapshot, plugins) → InitSeed`

`InitSeed` carries: `features: FeatureSeed`, `flags: string[]`, `viewMode: ViewMode`, `workflowPlugins: string[]`, `languagePlugins: string[]`.

**Feature seeding** (`resolveSeedFeatures`):
- `memory / learning / knowledge`: projectConfig wins when present (ADR-001 — config.json is the source of truth); falls back to manifest; then registry defaults (all true).
- `ambient / hud / rules`: manifest is the source; registry defaults when manifest absent.

**Flag seeding** (`resolveSeedFlags`):
- Fresh install (no manifest): all default-ON registry flags.
- Old manifest (no `knownFlags`): return existing flags as-is — adopt nothing new.
- Re-init with `knownFlags`: union existing ∪ {default-ON flags whose id ∉ knownFlags}. Default-OFF flags are NEVER auto-added.

**Plugin seeding** (`resolveSeedPlugins`):
- Fresh install: non-optional workflow plugins preselected, empty language list.
- Old manifest (no `knownPlugins`): split existing into workflow/language buckets, adopt nothing.
- Re-init with `knownPlugins`: split + adopt newly-added non-optional selectable plugins ∉ knownPlugins.

**Non-selectable optional carry**: `resolveNonSelectableOptionalCarry(manifestPlugins, allPlugins)` identifies optional plugins from the prior manifest (e.g. `devflow-audit-claude`) that are excluded from the selectable buckets by `partitionSelectablePlugins`. Internally uses a name→plugin `Map` for O(1) lookup (was a `.find()`-in-`.filter()` O(n·m) scan). `applyNonSelectableCarry(isPartialInstall, manifestPlugins, pluginsToInstall, allPlugins)` (pure exported helper) encapsulates the `!options.plugin` gate + carry call + dedup-merge loop; `init.ts` delegates to it. Without the carry, a full re-init would silently drop non-selectable optional plugins.

**Reset gate** (`resolveResetGatedInputs`): `--reset` zeroes seedManifest, seedConfig, AND settingsSnapshot (the empty settings string prevents `resolveExistingViewMode` from surfacing an externally-set viewMode and defeating the factory reset). The real manifest/settings are still used for security deny-state detection and `installedAt` preservation.

**viewMode resolution** (in `resolveInitSeed`): `resolveExistingViewMode(settingsSnapshot) ?? seedManifest?.features.viewMode ?? 'default'`. `resolveExistingViewMode` returns non-default values only ('focus' or 'verbose') — 'default' is returned as undefined so `??` falls through. `resolveFinalViewMode(current, selected, explicit)` resolves the final value to write: explicit CLI flag wins; otherwise a non-default current setting wins; otherwise the selected prompt value.

**CLI toggles** (`applyCliToggles`): Applies explicit CLI feature flags (e.g. `--no-learning`) on top of the resolved seed. Undefined means "not specified" — seed value is kept.

**`--reset --plugin` rejection**: Combining factory reset with a partial install is rejected as conflicting intent; init exits with an error before reaching the seed resolution.

## Integration Patterns

### Shadow Paths (canonical)

| Asset | Shadow path | Install target |
|-------|-------------|----------------|
| Skill | `~/.devflow/skills/{name}/` (unprefixed) | `~/.claude/skills/devflow:{name}/` |
| Rule | `~/.devflow/rules/{name}.md` | `~/.claude/rules/devflow/{name}.md` |

### `devflow skills` CLI

Positional command only (no flags). Unknown action exits 1.

- `shadow <name>` — validates the skill is installed; copies `~/.claude/skills/devflow:{name}/` to `~/.devflow/skills/{name}/` as a starting point; accepts both bare and prefixed input.
- `unshadow <name>` — removes `~/.devflow/skills/{name}/`; restores Devflow source on next `devflow init`.
- `list` — pre-reads `shadowDirSet` from `~/.devflow/skills/`, uses `shadowDirSet.has(skill)` as a short-circuit before calling `validateSkillShadow`. Shadow state renders via `buildSkillShadowTag` exhaustive switch. Orphan directories are shown as "unknown skill".

Exports: `hasShadow(skillName, devflowDir?)`.

### `devflow rules` CLI

Positional actions dispatch before flags. Unknown positional action exits 1.

- `shadow <name>` — validates against `allRules`; seeds via `seedRuleShadow`; emits a manual-create hint when seeding fails.
- `unshadow <name>` — validates against `allRules` (exits 1 on unknown names); removes `~/.devflow/rules/{name}.md`.
- `list` — delegates to `printRulesList`; same output as `--list`.

`seedRuleShadow(name, shadowFile, rulesTarget, devflowDir)` — 3-tier, **no `pluginsDir` param**:
- Tier 1: installed rule at `rulesTarget/{name}.md`
- Tier 2: flat source at `rulesDir()/{name}.md` (fallback when rules are disabled)
- Tier 3: returns `'none'` — caller emits manual-create instruction

**`--enable` error isolation**: `installAllRules` is wrapped in `try/catch` inside the `--enable` handler. If `installAllRules` throws (e.g. a missing declared rule source triggers the hard-error policy), the error surfaces as a clean CLI failure message and exits 1 — rather than an unhandled rejection after the rules directory was already wiped. (avoids PF-009)

`buildRuleShadowTag` / `buildSkillShadowTag` use exhaustive switches with `never` guards, so adding a new state variant causes a compile error until display coverage is added.

Exports: `hasRuleShadow(ruleName, devflowDir?)`, `listShadowedRules(devflowDir?)`, `seedRuleShadow(...)` — used by uninstall and tests.

## Anti-Patterns

- **Treating a missing declared source as a skip** — all four asset types (commands, agents, skills, rules) now throw on missing declared sources. `'skipped'` in `RuleInstallOutcome` means copy-level failure only (EACCES, ENOSPC), not a missing source file. Silently skipping a declared source hides build or packaging bugs.
- **Installing all of `~/.devflow/` on uninstall** — only `~/.devflow/scripts/` is Devflow-owned; `~/.devflow/skills/`, `~/.devflow/rules/`, and config files are user-owned and must survive uninstall. The `resolveDevflowDirCleanup` + `removeDevFlowInstallArtifacts` pattern enforces this boundary.
- **Staging shadow state after removal** — `enumerateUserDevFlowContent` must be called before the removal block; the files may be gone by the time a confirmation prompt is shown.
- **Calling `process.exit()` after `removeAllDevFlow` on a cancel/decline path** — `removeAllDevFlow` has already run by the time any prompt fires; exiting early leaves stale `manifest.json` on disk. Cancel and decline must both fall through to `removeDevFlowInstallArtifacts`. (avoids PF-014, applies ADR-003)
- **Installing without `npm run build`** — commands, agents, skills, and rules all throw hard errors when their source is absent (not a no-op). Run `npm run build` (or `build:mds` for commands alone) before any install.
- **Skipping `prefixSkillName` at install time** — the install target must always be the prefixed path `devflow:{name}`; shadow dirs stay unprefixed. Mixing these causes duplicate installs or missed cleanup.
- **Calling `installAllRules` outside a try/catch after wiping the rules directory** — if `installAllRules` throws (hard-error policy), the caller must catch and surface a clean error. Without the guard, the error becomes an unhandled rejection and the rules directory is left empty with no recovery signal. (avoids PF-009)
- **Restoring `pluginsDir` to `installAllRules` or `installRuleFile`** — rule source is exclusively `rulesDir()` (flat `src/assets/rules/`); there is no per-plugin subdirectory.
- **Combining `--reset` with `--plugin`** — factory reset and partial install are mutually exclusive; init rejects the combination before seeding.
- **Auto-adopting default-OFF flags in `resolveSeedFlags`** — only default-ON flags are auto-adopted when they are new (∉ knownFlags). Default-OFF flags must always be explicitly user-selected.

## Gotchas

- **`validateRuleShadow`'s `isFile()` guard is load-bearing.** Without `stat.isFile()`, a directory at `~/.devflow/rules/{name}.md` passes the `size > 0` check on some FSes and returns `'valid'`, causing `copyFile(shadowDir, targetFile)` to throw `EISDIR`. The valid-shadow block catches this and falls through to install the Devflow source (degraded path, not an abort). `fs.stat` follows symlinks: symlink → regular file = valid; symlink → directory = `'not-a-file'`.

- **Skills are cleaned before install on every run.** `installViaFileCopy` removes both the legacy unprefixed and current prefixed skill directories for all known skills before reinstalling. Partial installs (via `--plugin`) still clean all skills universally.

- **Orphan sweep runs only on full installs.** The `devflow:*` stale-dir sweep in `~/.claude/skills/` is skipped on partial installs (`isPartialInstall === true`). A partial reinstall does not prune orphaned skills from the registry.

- **`seedRuleShadow` tier 2 requires a built package root.** `rulesDir()` calls `getPackageRoot()`, which resolves from `dist/core/paths.js` depth and throws loudly if `package.json` is absent at the resolved root. Running `devflow rules shadow` without a built `dist/` causes a loud throw on tier-2 fallback.

- **`composeScripts` writes `package.json` with `wx` (exclusive create) flag.** A pre-existing `~/.devflow/scripts/package.json` is silently left as-is. If corrupt from a failed prior install, manual delete is needed.

- **`hasRuleShadow` uses `fs.access`, not `validateRuleShadow`.** It only checks existence. The status display calls `validateRuleShadow` for the full state. Do not conflate the two.

- **`readConfigIfPresent` vs `readConfig` distinction.** `readConfig` always returns a config (falling back to DEFAULT_CONFIG). `readConfigIfPresent` returns `null` when absent/malformed — used by init seeding to distinguish "not configured yet" from "configured with specific values". Passing `readConfig()`'s result to `resolveSeedFeatures` instead of `readConfigIfPresent()`'s result would incorrectly treat a missing config as an explicit "all features enabled" override.

- **`resolveExistingViewMode` returns `undefined` for `'default'`.** The 'default' literal is not surfaced — it is treated as "no opinion" so the `??` chain falls through to the manifest or the 'default' literal. This means externally-set `'focus'` or `'verbose'` modes survive re-init; an externally-set `'default'` does not (correct behaviour).

- **`knownPlugins` is a top-level field; `knownFlags` is inside `features`.** Both are snapshotted at install time. The asymmetric placement mirrors the schema: plugins are top-level in `ManifestData`, flags are nested in `ManifestData.features`.

- **`asStringArray` in `readManifest` validates element types, not just array shape.** A value like `[1, null, "valid"]` self-heals to `undefined` — the entire array must pass `every(e => typeof e === 'string')`. This means a partially-corrupted snapshot is treated as absent (safe) rather than partially trusted (unsafe).

## Key Files

- `src/targets/claude-code/installer.ts` — `installViaFileCopy`, `installAllRules`, `installRuleFile`, `composeScripts`, `validateSkillShadow`, `validateRuleShadow`, `InstallReport`, `ShadowSkip`, `RuleInstallOutcome`, `SkillShadowState`, `RuleShadowState`, `copyDirectory`, `chmodRecursive`; orphan sweep on full install
- `src/core/assets.ts` — `skillsDir`, `agentsDir`, `rulesDir`, `scriptsDir`, `commandsDir` accessors; single source of truth for all asset source paths
- `src/core/paths.ts` — `getPackageRoot()` with hard `package.json` assertion; 2-level-up resolution from `dist/core/paths.js`
- `src/targets/claude-code/legacy.ts` — `LEGACY_AGENT_NAMES`, `LEGACY_SKILL_NAMES` (composed from `LEGACY_SKILLS_PRE_V1`, `LEGACY_SKILLS_V2`, `LEGACY_SKILLS_V2X`); target-specific delete lists for upgrade cleanup
- `src/cli/commands/init.ts` — consumes `InstallReport` and `InitSeed`; calls `installViaFileCopy`; exhaustive `ShadowSkipReason` switch with `never` guard
- `src/cli/commands/init-seed.ts` — pure seeding helpers: `resolveInitSeed`, `resolveSeedFeatures`, `resolveSeedFlags`, `resolveSeedPlugins`, `resolveResetGatedInputs`, `resolveNonSelectableOptionalCarry`, `applyNonSelectableCarry`, `applyCliToggles`, `FEATURE_DEFAULTS`
- `src/cli/commands/uninstall.ts` — `removeAllDevFlow` (internal), `enumerateUserDevFlowContent`, `removeDevFlowInstallArtifacts`, `computeAssetsToRemove`, `resolveSecurityRemovalDecision`, `resolveDevflowDirCleanup`
- `src/cli/commands/rules.ts` — `rulesCommand` positional dispatch, `seedRuleShadow` (3-tier), `handleRuleShadow`, `handleRuleUnshadow`, `buildRuleShadowTag`, `printRulesList`, `hasRuleShadow`, `listShadowedRules`
- `src/cli/commands/skills.ts` — `skillsCommand` positional dispatch, `buildSkillShadowTag`, `hasShadow`
- `src/core/manifest.ts` — `ManifestData` (with `knownPlugins` and `features.knownFlags`), `readManifest` (self-heals snapshots via `asStringArray`), `writeManifest`, `syncManifestFeature`, `resolvePluginList`
- `src/core/flags.ts` — `FLAG_REGISTRY`, `resolveExistingViewMode`, `resolveFinalViewMode`, `applyFlags`, `stripFlags`, `getDefaultFlags`
- `src/core/feature-config.ts` — `readConfig`, `readConfigIfPresent`, `writeConfig`, `updateFeature`
- `src/core/plugins.ts` — `prefixSkillName`, `unprefixSkillName`, `SKILL_NAMESPACE`, `DEVFLOW_PLUGINS`, `buildFullSkillsMap`, `buildRulesMap`, `getAllSkillNames`, `getAllCommandNames`, `partitionSelectablePlugins`, `LEGACY_PLUGIN_NAMES`, `LEGACY_COMMAND_NAMES`, `LEGACY_RULE_NAMES`

## Related

- ADR-001: Config-only feature gates — governs `readConfigIfPresent` as the init-seed source for memory/learning/knowledge; config.json is the source of truth, manifest is secondary (applies ADR-001)
- ADR-003: End-state not transition — governs removals and legacy cleanup; cancel/decline on uninstall falls through to `removeDevFlowInstallArtifacts` rather than `process.exit()` so cleanup always runs (applies ADR-003)
- ADR-010: Shadow tolerance — governs `installViaFileCopy` as sole install path and warn-and-install-source (not hard-fail) for invalid shadows; hard-error policy applies only to declared Devflow sources (applies ADR-010)
- ADR-013: Core/adapter boundary — governs `init-seed.ts` living in `src/cli/commands/` (CLI-init-specific logic) rather than `src/core/` (applies ADR-013)
- PF-009: Per-item failure isolation in rule/skill fan-out — per-rule try/catch inside `installRuleFile` ensures one failing rule copy does not abort the `Promise.all`; `rules --enable` wraps `installAllRules` in try/catch so a hard-error throw surfaces as a clean CLI failure rather than an unhandled rejection after the rules dir was wiped (avoids PF-009)
- PF-012: LEGACY_* lists deletion-risk — lists split between `src/targets/claude-code/legacy.ts` (skill/agent) and `src/core/plugins.ts` (plugin/command/rule); both must be retained across upgrades (avoids PF-012)
- PF-014: process.exit() skips cleanup — governs the cancel/decline path in user-scope uninstall; `removeAllDevFlow` has already run by the time the full-cleanup prompt fires, so `removeDevFlowInstallArtifacts` must execute on every non-confirm path (avoids PF-014)
- Feature knowledge: `feature-knowledge-system` — the Knowledge agent writes to `.devflow/features/` which is tracked in git; related to the `.gitignore` carve-out maintained by the installer (`ensureDevflowGitignore` in `post-install.ts`)
