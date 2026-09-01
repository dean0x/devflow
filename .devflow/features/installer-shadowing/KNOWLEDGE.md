---
feature: installer-shadowing
name: Installer & Skill/Rule Shadowing
description: "Use when modifying the install pipeline (installViaFileCopy, installAllRules, composeScripts, InstallReport), adding or changing skill/rule shadow override logic, touching uninstall scope (enumerateUserDevFlowContent, removeDevFlowInstallArtifacts, resolveDevflowDirCleanup, installArtifactPaths, sweepDevflowNamespaces, resolveProjectDataCleanup) or install-artifact cleanup, extending the CLI skills/rules/flags management commands, working with asset directory accessors (rulesDir, skillsDir, commandsDir) and package-root resolution, modifying the init seeding layer (resolveInitSeed, resolveSeedFeatures, resolveSeedFlags, resolveSeedPlugins, --reset, FlagsRecord, knownPlugins, readConfigIfPresent, resolveExistingViewMode, resolveExistingAttributionSuppression, getAllCommandNames, proxy), working on the flags TUI (FlagsViewState, FlagRow, buildFlagRows, collectFlagRecord, effectiveDisplay, blurb, inline mode, RunTuiSpec screen) or the flags CLI (createFlagsCommand, lookupFlag, persistFlagConfig, formatFlagValue), working on the compliance wizard step (shouldRunComplianceStep, runComplianceStep, modePromptShown, CompliancePromptIO), or working on the attribution wizard step (shouldRunAttributionStep, runAttributionStep, AttributionPromptIO, suppress-attribution). Keywords: installViaFileCopy, installAllRules, composeScripts, InstallReport, RuleInstallOutcome, SkillShadowState, RuleShadowState, shadow, unshadow, validateSkillShadow, validateRuleShadow, seedRuleShadow, prefixSkillName, unprefixSkillName, devflow:, skills, rules, uninstall, EISDIR, enumerateUserDevFlowContent, removeDevFlowInstallArtifacts, resolveDevflowDirCleanup, installArtifactPaths, enumerateDryRunExtras, sweepDevflowNamespaces, resolveProjectDataCleanup, runDryRunPhase, runSelectivePhaseForScope, runFullPhaseForScope, runCleanupPhase, getPackageRoot, isContainedIn, rulesDir, skillsDir, agentsDir, commandsDir, scriptsDir, LEGACY_SKILL_NAMES, sweepOrphanedAssets, SweepResult, sweepOrphans, sweepFailures, SweepFailure, mdFileName, mdEntryName, orphan sweep, getAllSkillNames, getAllCommandNames, getAllAgentNames, DELETED_PLUGIN_NAMES, EXCLUDED, resolveInitSeed, resolveSeedFeatures, resolveSeedFlags, resolveSeedPlugins, resolveResetGatedInputs, applyCliToggles, FlagsRecord, FlagsRecordValue, getDefaultFlagsRecord, parseManifestFlags, migrateLegacyFlagsToRecord, sanitizeFlagsRecord, coerceFlagValue, parseFlagValueInput, neutralValueOf, isNeutral, countActiveFlags, readViewMode, knownPlugins, readConfigIfPresent, resolveExistingViewMode, resolveExistingAttributionSuppression, resolveFinalViewMode, reset, init-seed, proxy, reapplyAgentMapping, revertExternalAgents, agent-models.json, proxy.json, proxy-routing.json, proxy.pid, applyDisableToSettings, buildRealPreflightDeps, canonicalise-agent-keys-v1, AnyMigration, migrations.json, compliance-prompts, shouldRunComplianceStep, CompliancePromptIO, runComplianceStep, modePromptShown, attribution-prompts, shouldRunAttributionStep, AttributionPromptIO, runAttributionStep, suppress-attribution, settingDeleteGuard, deepEqualsPlain, D-ATTR-GUARD, D27, BooleanFlagDef, EnvBooleanFlagDef, SettingBooleanFlagDef, createFlagsCommand, lookupFlag, persistFlagConfig, FlagsViewState, FlagRow, buildFlagRows, collectFlagRecord, buildStops, cycleForward, cycleBackward, sanitizeCell, padToVisible, truncateVisible, effectiveDisplay, EffectiveDisplay, formatFlagValue, blurb, FlagDefCommon, INLINE_MARGIN, cursorUp, RunTuiSpec, screen, inline."
category: architecture
directories: [src/targets/claude-code/installer.ts, src/targets/claude-code/legacy.ts, src/cli/commands/init.ts, src/cli/commands/init-seed.ts, src/cli/commands/uninstall.ts, src/cli/commands/rules.ts, src/cli/commands/skills.ts, src/cli/commands/flags.ts, src/cli/commands/attribution-prompts.ts, src/cli/flags-view, src/cli/tui, src/core/plugins.ts, src/core/assets.ts, src/core/paths.ts, src/core/manifest.ts, src/core/flags.ts, src/core/feature-config.ts, src/core/orphan-sweep.ts, src/core/migrations.ts, src/cli/commands/compliance-prompts.ts]
created: 2026-07-13
updated: 2026-09-01
---

# Installer & Skill/Rule Shadowing

## Overview

Devflow installs its assets (skills, rules, agents, commands, scripts) via a single path: `installViaFileCopy` in `src/targets/claude-code/installer.ts`. File copy is the sole install mechanism. All asset source paths are resolved via named accessors in `src/core/assets.ts`, which are backed by `getPackageRoot()` in `src/core/paths.ts`. `installViaFileCopy` returns an `InstallReport` that `init.ts` uses to surface shadow, skip, and orphan-sweep events in the post-install summary.

The shadow override system lets users place personal versions of skills or rules at well-known paths under `~/.devflow/`. On every `devflow init` or `devflow rules --enable`, Devflow detects a valid shadow and installs the user's copy instead of the Devflow source — without failing init. This knowledge covers the entire install-to-uninstall lifecycle, the CLI surface for managing overrides, and the state-aware init seeding layer. Current counts: 21 plugins, 16 agents, 14 dist commands, 41 skills, 13 rules.

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
| `scriptsDir()` | `{root}/src/assets/scripts/` — hooks/ subdirectory and hud.sh |
| `commandsDir()` | `{root}/dist/commands/` — compiled MDS + verbatim .md files |

All five call `getPackageRoot()` internally.

### Package Root Resolution (`src/core/paths.ts`)

`getPackageRoot()` resolves the package root from `import.meta.url` depth — 2 levels up from compiled `dist/core/paths.js`. It **throws loudly** if `package.json` is absent at the resolved root. Depth-mismatch bugs surface immediately at install time rather than silently producing wrong paths.

`isContainedIn(parent, candidate)` is a new pure containment predicate: resolves both paths and checks that `candidate` is strictly inside `parent` (non-empty relative, no `..` prefix, not absolute outside). Used by `reapplyAgentMapping` to guard against path-traversal mapping keys. No filesystem access.

### Hard-Error Policy for Declared Sources

All four asset types now **throw** when a declared source is absent — there are no silent skips for registered assets:

| Asset type | Source checked | Error trigger |
|------------|---------------|---------------|
| Command | `dist/commands/{name}.md` | `fs.access` fails |
| Agent | `src/assets/agents/{name}.md` | `fs.access` fails |
| Skill | `src/assets/skills/{name}/` | `stat` not a directory |
| Rule | `src/assets/rules/{name}.md` | `fs.access` fails |

Shadow paths remain tolerant: invalid/missing shadows warn-and-install-source (applies ADR-010). The hard-error policy applies only to declared Devflow sources.

### Shared Orphan-Sweep Module (`src/core/orphan-sweep.ts`)

`sweepOrphanedAssets(dir, knownNames, extractRegistryName) => Promise<SweepResult>` is the single compute site for registry-diff sweeps. It is imported by both `installer.ts` and `uninstall.ts` — no duplication.

`SweepResult` shape:

```typescript
export interface SweepResult {
  scanned: number;    // count of entries the predicate accepted (matched), regardless of outcome
  removed: string[];  // registry names successfully removed
  failed: ReadonlyArray<{ name: string; error: unknown }>; // per-item removal failures (avoids PF-009)
}
```

Key contract details:

- **`scanned`** is the count of entries accepted by the predicate, NOT the removed count. Tests assert non-vacuousness by checking `scanned > 0`. A `scanned` of 0 means the predicate matched nothing — the registry is not being exercised.
- **Per-item isolation**: the outer `readdir` and the inner `rm` are independently try/caught. A missing directory is a no-op; a failed individual removal is recorded in `failed` without aborting the batch (avoids PF-009).
- **`knownNames` must span ALL plugins**, never intersected with any selected-plugin subset — assets from uninstalled plugins must survive a partial sweep.

Also exports the **`mdFileName` / `mdEntryName` inverse pair** for `.md` asset naming:
- `mdFileName(name)` — converts a registry name to its `.md` filename. Inverse of `mdEntryName`.
- `mdEntryName(entry)` — extracts the registry name from a `.md` directory entry, or returns `null` for non-`.md` entries (suitable as a pass-through predicate for `sweepOrphanedAssets`). Inverse of `mdFileName`.

### Orphan Sweep (three ungated namespaces)

`installViaFileCopy` runs three ungated registry-diff sweeps via `sweepOrphanedAssets` — all run on every install shape, including `--plugin` partial installs:

- **Skills**: reads `~/.claude/skills/` and removes any `devflow:*` directory whose bare name is absent from `getAllSkillNames()`. Bare (pre-namespace) dirs are **not touched** — handled exclusively by the frozen `LEGACY_SKILLS_*` lists in `legacy.ts` (avoids PF-012). Shadow dirs (`~/.devflow/skills/`) are keyed by bare registry name and are unaffected.
- **Commands**: reads `~/.claude/commands/devflow/` and removes any `.md` file whose command name is absent from `getAllCommandNames()`. `getAllCommandNames()` was wired in during this work — previously it existed in plugins.ts but had no production consumer in the installer.
- **Agents**: reads `~/.claude/agents/devflow/` and removes any `.md` file whose agent name is absent from `getAllAgentNames()`.

All three `knownNames` sets span ALL plugins — not just the selected subset — so assets from unselected plugins survive a partial run; only assets completely absent from the registry are removed. **Intersecting with the selected-plugin subset would be a data-loss bug** (assets from OTHER plugins would be deleted on a single-plugin reinstall). Separate from the sweeps, `installViaFileCopy` still performs a **full directory wipe** of `commands/devflow/`, `agents/devflow/`, and `rules/devflow/` before reinstalling on full (non-partial) installs.

Sweep results fold into `InstallReport.sweptOrphans` (F15: `SweptOrphan[]` — each entry carries `{ kind: 'skill'|'command'|'agent', name: string }` for disambiguation) and `InstallReport.sweepFailures` (per-item failures with kind discriminant). The `recordSweep(report, kind, sweep)` helper (F14) centralises the push from all three sweep call sites.

### InstallReport

`installViaFileCopy` returns `InstallReport`:

```typescript
export interface SweptOrphan {           // F15: carries kind tag for disambiguation
  kind: 'skill' | 'command' | 'agent';
  name: string;
}

export interface InstallReport {
  shadowedSkills: string[];   // bare skill names that had a valid shadow applied
  shadowedRules: string[];    // bare rule names that had a valid shadow applied
  skippedShadows: ShadowSkip[];   // invalid shadows that were bypassed
  sweptOrphans: SweptOrphan[];    // F15: { kind, name }[] removed by orphan sweeps (skills, commands, agents)
  sweepFailures: SweepFailure[]; // per-item removal failures from orphan sweeps
}

export interface SweepFailure {
  kind: 'skill' | 'command' | 'agent';
  name: string;
  error: unknown;
}

export interface ShadowSkip {
  kind: 'skill' | 'rule';
  name: string;
  reason: ShadowSkipReason;  // 'missing-skill-md' | 'empty-shadow-file' | 'not-a-file'
}
```

`init.ts` iterates `skippedShadows` and emits a warning per entry via an exhaustive switch on `ShadowSkipReason` (with `never` guard). Invalid shadows never cause init to exit non-zero. (applies ADR-010)

### Manifest Snapshots: `flags`, `knownPlugins`, and `proxy`

`manifest.ts` stores the flag state and the plugin snapshot at install time:

- `ManifestData.features.flags: FlagsRecord` — typed flag record (key-presence = known to this install; `null` value = deliberately unset/neutral; absent key = adopt-on-next-init per ADR-014). Replaces the former `knownFlags: string[]` field; old string[] manifests are auto-migrated by `parseManifestFlags` + `migrateLegacyFlagsToRecord` on first `readManifest`.
- `ManifestData.knownPlugins?: string[]` — all `DEVFLOW_PLUGINS` names at the time of the last install. Absent in pre-7b manifests; `readManifest` self-heals via a local `asStringArray` helper (requires every element to pass `typeof e === 'string'`; a mixed/garbage array self-heals to `undefined`).

**`parseManifestFlags(features, knownFlags)`** handles three on-disk shapes for `features.flags`:
- Case A: `string[]` — legacy format; migrated to `FlagsRecord` via `migrateLegacyFlagsToRecord`, folding the separate `features.viewMode` field in. Reports `legacy: true`.
- Case B: `object` — already a `FlagsRecord`; spread into a fresh record (avoids mutation). Reports `legacy: false`.
- Case C: missing/other — defaults to empty record.

The legacy `features.knownFlags` field from old manifests is read by `readManifest` only to feed Case A migration; it is NOT carried into the returned `ManifestData`. The "known" semantic is encoded entirely in `FlagsRecord` key-presence: a key present in the record = known to this install; an absent key = adopt-on-next-seed.

`readManifest` calls `sanitizeFlagsRecord` on the parsed result to coerce any stored values back through `coerceFlagValue` — a mild defensive measure against schema drift. The `proxy` and `knownPlugins` snapshots are consumed by the init seeding layer.

`ManifestData.features.proxy: boolean` tracks whether external model routing was enabled at the last install. `readManifest` self-heals absent fields to `false` (applies ADR-014 self-heal idiom). The value written to the manifest is the **final resolved value after preflight** — a preflight failure forces `proxyEnabled = false` before the manifest write, so the manifest always reflects the actual settled state.

### RuleInstallOutcome

`installRuleFile` returns a discriminated `RuleInstallOutcome` per rule. `'skipped'` is only returned for copy-level failures (EACCES, ENOSPC) — a missing declared rule source now throws rather than returning `'skipped'`. `installViaFileCopy` decodes outcomes to populate `InstallReport.skippedShadows`.

### SkillShadowState / RuleShadowState

```typescript
export type SkillShadowState = 'valid' | 'missing-skill-md' | 'none';
export type RuleShadowState = 'valid' | 'empty-shadow-file' | 'not-a-file' | 'none';
```

Both are exported from `installer.ts` and imported by `skills.ts` and `rules.ts` for use in the exhaustive `buildSkillShadowTag` / `buildRuleShadowTag` display switches.

### installAllRules

The single compute site for rule installation. Both `installViaFileCopy` and `rules --enable` call it. There is **no `pluginsDir` or `ownerPlugin` parameter** — rule source is resolved internally by `installRuleFile` via `rulesDir()`. One place computes; callers present the outcomes.

### composeScripts

`composeScripts(scriptsTarget)` assembles `~/.devflow/scripts/` from three sources in order: **(a)** `src/assets/scripts/` verbatim — hooks/ subdirectory and `hud.sh` entry script copied via `copyDirectory`, with executable bits applied via `chmodRecursive` (non-Windows only). **(b)** Transitive `dist/hud/` import graph — starting from `dist/hud/index.js`, walks all relative JS import/export specifiers, copies each reachable module to `scriptsTarget` preserving its `dist/`-relative path. **(c)** `package.json` with `{"type":"module"}` — written with `flag: 'wx'` (exclusive create); an existing file is left as-is.

Frozen externally-referenced paths: `~/.devflow/scripts/hooks/run-hook` and `~/.devflow/scripts/hud.sh`.

### Skill Namespace (`prefixSkillName` / `unprefixSkillName`)

Skills install under `~/.claude/skills/devflow:{name}` (prefixed). The `devflow:` prefix is applied at install time; source directories in `src/assets/skills/` stay unprefixed. Shadow dirs also stay unprefixed at `~/.devflow/skills/{name}/`.

### Universal Skill Install

All skills from ALL plugins install regardless of plugin selection. `skillsMap` passed to `installViaFileCopy` is built by `buildFullSkillsMap` which covers every `DEVFLOW_PLUGINS` entry — not just the selected subset. Rules, by contrast, are plugin-scoped (only selected plugins' rules install).

### LEGACY_* and DELETED_* Symbol Split

| Symbol | File | Load-bearing? |
|--------|------|---------------|
| `LEGACY_SKILL_NAMES` (+ `LEGACY_SKILLS_PRE_V1`, `LEGACY_SKILLS_V2`, `LEGACY_SKILLS_V2X`) | `src/targets/claude-code/legacy.ts` | YES — deletion manifests for pre-namespace bare dirs at `~/.claude/skills/{name}/` |
| `LEGACY_PLUGIN_NAMES`, `LEGACY_COMMAND_NAMES`, `LEGACY_RULE_NAMES` | `src/core/plugins.ts` | YES (upgrade cleanup) |
| `DELETED_PLUGIN_NAMES` | `src/core/plugins.ts` | YES — in-memory filter, NOT an fs.rm |

`DELETED_PLUGIN_NAMES` (currently `['devflow-audit-claude']`) is a **string array** (not a rename map like `LEGACY_PLUGIN_NAMES`). `resolvePluginList` in `manifest.ts` calls `.filter(p => !deletedSet.has(p))` on the prior manifest's plugin array during partial reinstalls — it is a pure in-memory operation, not a filesystem delete. Two inverse guards: the filter runs BEFORE the rename map, so a name in both `DELETED_PLUGIN_NAMES` and `LEGACY_PLUGIN_NAMES` is dropped (not migrated). `devflow-audit-claude` was removed from DEVFLOW_PLUGINS, its agent (`claude-md-auditor`) and command (`/audit-claude`) removed, and it was added to `DELETED_PLUGIN_NAMES` so stale manifest entries are pruned on the next partial reinstall. (avoids PF-012)

### EXCLUDED as Module-Level Export

`EXCLUDED: ReadonlySet<string>` is a module-level export from `plugins.ts` (not a function-local const). This makes the `EXCLUDED ∩ optional === ∅` invariant assertable from tests. The trap: importing the production const into tests as an oracle destroys the test's INDEPENDENT literal check and turns existing invariant guards into tautologies — test code must pin an independent literal alongside it.

## Component Interactions

### Shadow Validation Flow

`validateSkillShadow(shadowDir)` in `installer.ts`: returns `'none'` (shadow dir absent), `'valid'` (dir exists with a non-empty `SKILL.md`), or `'missing-skill-md'` (dir exists but `SKILL.md` absent, empty, or not a file). On `'valid'`: installs user's copy. On `'missing-skill-md'`: adds to `skippedShadows`, installs Devflow source. Before any copy: the skill source directory is stat-checked and throws if absent.

`validateRuleShadow(shadowFile)` in `installer.ts`: returns `'none'`, `'valid'`, `'empty-shadow-file'`, or `'not-a-file'`. `installRuleFile(ruleName, devflowDir, rulesTarget)` uses this result. Rule source is always resolved internally: `path.join(rulesDir(), \`${ruleName}.md\`)`. The declared source is checked via `fs.access` and throws if absent — this check runs after shadow validation so a valid shadow bypasses it.

### Proxy Preflight and `reapplyAgentMapping` Ordering (init.ts)

When `proxyEnabled` is true entering the install apply pass, `runProxyPreflight` runs **before** the settings mutation block. A failed preflight emits a `p.log.warn` and forces `proxyEnabled = false` without aborting init (avoids PF-009). `reapplyAgentMapping` runs **after** the preflight block — this ordering is load-bearing: `reapplyAgentMapping` must use the final `proxyEnabled` value (GPT model assignments materialize in agent frontmatter only while proxy is enabled). Running it before preflight resolves would leave GPT model lines in agent files after a preflight failure, breaking the dormancy contract. **Init-only optimization**: the call is skipped when `readAgentMapping` returns an empty agents map AND `proxyEnabled` is false. (pinned by `tests/init-proxy.test.ts`)

### Uninstall Scope

**Exports**: `removeAllDevFlow`, `removeSelectedPlugins`, and `isDevFlowInstalled` are all **exported** from `uninstall.ts` (previously unexported and structurally untestable). `enumerateUserDevFlowContent` and `removeDevFlowInstallArtifacts` were already exported.

**`isDevFlowInstalled(claudeDir)`** detects via: `commands/devflow/` (exists), OR `agents/devflow/` (exists), OR any skill dir starting with `devflow:` in `skills/`. Keying off `commands/devflow/` alone misses commandless-plugin installs where agents and skills are still present.

**`revertExternalAgents` on the selective path**: runs **before** `removeSelectedPlugins` — strips GPT model lines from installed agent frontmatter while the files are still present. **Known limitation**: on the selective path it reverts EVERY installed agent, not only those being removed — surviving agents lose GPT frontmatter assignments until the next `devflow init`. On the full-uninstall path it also runs before `removeAllDevFlow`.

**`removeAllDevFlow(claudeDir, devflowDir, verbose)`** removes `commands/devflow/`, `agents/devflow/`, `rules/devflow/`, `devflowScriptsDir`, and skill dirs via two separate passes (avoids PF-012): **prefixed** (`devflow:name`) for every skill in `getAllSkillNames() ∪ LEGACY_SKILL_NAMES`; **bare** (name or `devflow-name`) for `LEGACY_SKILL_NAMES` only — `~/.claude/skills/` is shared, so a bare dir matching a live-registry skill name is by construction foreign to Devflow.

After `removeAllDevFlow`, scope-specific logic handles the remainder of `devflowDir`. The scope decision lives in `resolveDevflowDirCleanup(opts)`, a **pure exported function** (mirrors `resolveSecurityRemovalDecision`) — no I/O, no side effects, fully testable.

**`resolveDevflowDirCleanup`** precondition guard: four invariants must hold — `basename(devflowDir) === '.devflow'`, `devflowDir !== homeDir`, `devflowDir !== '/'`, and `devflowDir.startsWith(homeDir + sep)`. Any failure → returns `'artifacts-only'` immediately (never throws in business logic). **`--keep-docs` gate**: when `keepDocs` is true, returns `'artifacts-only'` regardless of `isTTY` or user content — suppresses the full cleanup prompt (previously an active data-loss path; now fixed). Returns `'artifacts-only'` or `'prompt'`.

**`installArtifactPaths(devflowDir)`** — new exported pure SSOT function returning `ReadonlyArray<{ relPath: string; isDir?: boolean }>`. Contains all Devflow-owned install artifacts under `devflowDir` (excluding `manifest.json`, which is removed by a separate step at the top of `removeDevFlowInstallArtifacts`): `migrations.json`, `agent-models.json`, `costs/` (isDir), `proxy.json`, `proxy-routing.json`, `proxy.pid`, `.proxy-spawn.lock/` (isDir), `logs/` (isDir), and the cache directory (resolved via `hudCacheDir(devflowDir)`). Used as the shared source of truth by both `removeDevFlowInstallArtifacts` (removal loop) and `enumerateDryRunExtras` (dry-run preview) — the two callers are guaranteed to list the same set by construction (avoids PF-018).

**`enumerateDryRunExtras(claudeDir, devflowDir)`** — new exported async function, extracted from the dry-run loop body for independent testability (avoids PF-018). Enumerates what is actually on disk: whole Claude directories (`commands/devflow`, `agents/devflow`, `rules/devflow`, `devflowDir/scripts`), skill removal candidates via the same split-pass approach as `removeAllDevFlow` (prefixed from live registry ∪ `LEGACY_SKILL_NAMES`; bare from `LEGACY_SKILL_NAMES` only — avoids PF-012), `manifest.json`, and every artifact from `installArtifactPaths(devflowDir)`. Coverage matches `removeAllDevFlow` exactly so the preview cannot diverge from the real removal.

**`sweepDevflowNamespaces(claudeDir, verbose)`** — new exported function that performs a registry-diff sweep of all Devflow-owned namespaces: `agents/devflow/`, `commands/devflow/`, and `skills/` (`devflow:*` entries). Called by `removeSelectedPlugins` after per-plugin removals to prune any retired asset names (renamed or deleted from the registry) without requiring the caller to know the full registry. `knownNames` spans ALL plugins for each asset type so assets belonging to non-selected plugins are never swept (avoids PF-012). Failures always warn (a swept-but-not-removed agent keeps loading in Claude Code); removals are logged only under `verbose`.

**`resolveProjectDataCleanup(answer: boolean | symbol) => boolean`** — new exported pure function. Maps a `p.confirm()` answer (boolean or cancel symbol) to a removal decision: `true` only when the user explicitly confirmed; a cancel (Ctrl-C) maps to `false` (preserve) and the uninstall continues rather than `process.exit()`-ing (applies ADR-003, avoids PF-014). Previously the cancel path called `process.exit(0)` after `removeAllDevFlow` had already run, leaving `manifest.json` on disk.

**Phase runners** — extracted from the `.action()` body for independent testability. Each covers one logical stage:

- **`runDryRunPhase(opts)`** — selective mode: derives plan from `computeAssetsToRemove` + `formatDryRunPlan`; full mode: calls `enumerateDryRunExtras` for each scope (exercises the production enumeration path, not only pure helpers — avoids PF-018).
- **`runSelectivePhaseForScope(opts)`** — reverts external agent frontmatter, calls `removeSelectedPlugins` (which calls `sweepDevflowNamespaces`), cleans ambient hook if ambient plugin is removed.
- **`runFullPhaseForScope(opts)`** — reverts external agents, calls `removeAllDevFlow`, then scope-aware devflowDir cleanup (local: always artifacts-only; user: `resolveDevflowDirCleanup` gate → prompt or artifacts-only). Takes injected `isTTY` rather than reading `process.stdin.isTTY` directly.
- **`runCleanupPhase(opts)`** — post-loop extras on full uninstall: `.devflow/` project data dir, `.claudeignore`, `settings.json` hooks/flags, security deny list, safe-delete shell function. Calls `stripFlags` directly (no record argument) — removes all flag-managed keys including the `attribution` key when its current value is the devflow-managed shape `{"commit":"","pr":""}` (shape guard via `settingDeleteGuard`; a custom attribution value is never deleted). Takes injected `cwd` and `isTTY` so prompt gates are testable without touching developer files.

**`enumerateUserDevFlowContent(devflowDir)`** (called BEFORE any removal) checks for: `devflowDir/skills/` (skill shadows), `devflowDir/rules/` (rule shadows), `devflowDir/preference-profile.md`, `devflowDir/learning.json`, and `devflowDir/hud.json`. Returns human-readable labels. `agent-models.json` is **NOT** listed here — it is classified as an install artifact (see `installArtifactPaths`).

**`removeDevFlowInstallArtifacts(devflowDir, verbose)`** removes (non-fatally per-item): `manifest.json` (separate step at top), then all entries from `installArtifactPaths(devflowDir)`. Before removing `proxy.pid`, reads PID and checks process existence via `process.kill(pid, 0)` — if still running, emits a warning with a manual kill hint; **never kills the relay**.

**Containment precondition** (inside the artifact-removal loop): before each `fs.rm`, computes `path.relative(devflowDir, fullPath)`. If the result is `''`, starts with `'..'`, or is absolute — **skips the removal** rather than throwing. This guards against a derived relative path (e.g. from `hudCacheDir`) collapsing to `''` and triggering a recursive wipe of all of `~/.devflow`. Asserting in production code (not only tests) keeps the invariant load-bearing (reliability rule).

**Hard classification invariant**: `enumerateUserDevFlowContent` (user state — survives unless explicitly confirmed) and the artifact list in `installArtifactPaths` / `removeDevFlowInstallArtifacts` (removed on every path: decline, cancel, non-interactive, `--keep-docs`) must be **DISJOINT**. A name in both lists makes the confirmation prompt untruthful — it is presented as user content that removal would take, then deleted regardless of the answer. A test enforces this invariant. Specifically: `agent-models.json` and `migrations.json` are install artifacts; `hud.json` is user state.

**User-scope prompt path**: confirm → `fs.rm(devflowDir, {recursive: true, force: true})`; decline OR cancel → falls through to `removeDevFlowInstallArtifacts` (applies ADR-003, avoids PF-014). `process.exit()` is never called here.

**Settings cleanup**: calls `applyDisableToSettings(parsedSettings, managedPort)` in a single parse-mutate-serialize pass. `managedPort` is read from `proxy.json` (falling back to `DEFAULT_PROXY_PORT`) so only the `ANTHROPIC_BASE_URL` for Devflow's managed port is stripped.

### Init Seeding Layer (`init-seed.ts`)

A dedicated pure-function module (`src/cli/commands/init-seed.ts`) computes the initial prompt state for `devflow init` from the existing manifest, project config, settings.json, and registry. All functions are I/O-free and testable in isolation (applies ADR-013).

**Composition point**: `resolveInitSeed(seedManifest, seedConfig, settingsSnapshot, plugins) → InitSeed`

`InitSeed` carries: `features: FeatureSeed`, `flags: FlagsRecord`, `workflowPlugins: string[]`, `languagePlugins: string[]`. `viewMode` is encoded inside `flags['view-mode']` (PF-015: all flag state in FlagsRecord) — there is no separate `viewMode` field. `suppress-attribution` is similarly encoded inside `flags['suppress-attribution']`.

**Feature seeding** (`resolveSeedFeatures`):
- `memory / learning / knowledge`: projectConfig wins when present (ADR-001 — config.json is the source of truth); falls back to manifest; then registry defaults (all true).
- `ambient / hud / rules / proxy`: manifest is the source; registry defaults when manifest absent. `proxy` defaults to `false` in `FEATURE_DEFAULTS` — it is Advanced-only and never part of Recommended defaults. Because proxy seeds from the manifest group (not config.json), `--reset` null-seeds the manifest and correctly resets proxy to `false`.

**Flag seeding** (`resolveSeedFlags(manifestFlags: FlagsRecord | null, registry)`): Two branches — (1) `null` (fresh install): all registry flags at their `defaultValue`; (2) non-null: spread the manifest `FlagsRecord`, then for each registry flag whose key is absent from the record, adopt its `defaultValue` (ADR-014: absent key = new to this install → adopt). Unknown IDs from old manifests pass through unchanged for forward-compat. Default-OFF flags adopt `false`/`null` — they arrive in the seed as inactive, not as missing.

**Plugin seeding** (`resolveSeedPlugins`): Fresh install → non-optional workflow plugins preselected, empty language list. Old manifest (no `knownPlugins`) → split existing into workflow/language buckets, adopt nothing. Re-init with `knownPlugins` → split + adopt newly-added non-optional selectable plugins ∉ knownPlugins.

**Reset gate** (`resolveResetGatedInputs`): `--reset` zeroes seedManifest, seedConfig, AND settingsSnapshot.

**viewMode resolution**: `resolveInitSeed` resolves view-mode in three-priority order — (1) `resolveExistingViewMode(settingsSnapshot)` (non-`'default'` from current settings.json wins); (2) `readViewMode(flags)` from the spread manifest record (non-`'default'` wins); (3) `'default'`. The resolved value is encoded into `flags['view-mode']` on the returned `InitSeed`. `seedManifest?.features.viewMode` is no longer consulted — that field is retired; view-mode lives entirely in `ManifestData.features.flags['view-mode']`.

**suppress-attribution resolution** (`resolveExistingAttributionSuppression`): an exported pure function in `init-seed.ts` (mirrors `resolveExistingViewMode`). Returns `true` when the settings.json `attribution` key is the exact devflow-managed shape `{"commit":"","pr":""}` (two keys, both empty string, no extras). Returns `undefined` for absent key, custom value, or malformed JSON — callers fall through to the manifest entry. Priority order in `resolveInitSeed`: (1) `resolveExistingAttributionSuppression(settingsSnapshot)` → `true` when exact shape; (2) `flags['suppress-attribution']` from manifest FlagsRecord (boolean); (3) `false` (registry default). The resolved value is encoded into `flags['suppress-attribution']` on the returned `InitSeed`. `--reset` zeroes `settingsSnapshot` and `seedManifest`, so the resolved value is always `false` on a factory reset.

**CLI toggles** (`applyCliToggles`): Applies explicit CLI feature flags (e.g. `--no-learning`, `--proxy`) on top of the resolved seed. Undefined = not specified; seed value is kept.

**`--reset --plugin` rejection**: Combining factory reset with a partial install is rejected before reaching seed resolution.

**Flags applied non-interactively (D40)**: After `applyCliToggles`, `init.ts` applies `enabledFlags` directly — no TUI is opened in either init path. Fresh install: all registry flags at their `defaultValue`. Re-init: spread manifest record, then adopt defaults only for absent flags (ADR-014). Outcome line: `Flags: ${activeCount} active — customize any time with 'devflow flags'`. `getDefaultFlagsRecord` is not imported by init.ts; `viewModeExplicit` is exclusively `!!options.reset` (not set by any interactive input since the TUI was removed).

### Compliance Prompt Module (`src/cli/commands/compliance-prompts.ts`)

A dedicated CLI-layer module (ADR-013 — CLI-layer prompts; core stays UI-agnostic) that owns all compliance wizard UI. Key exports:

- **`frameworkChoices()`** — builds the clack multiselect options array from `COMPLIANCE_FRAMEWORKS`.
- **`FRAMEWORK_SELECT_MESSAGE`** — canonical string for the framework multiselect prompt.
- **`formatFrameworkCatalogue()`** — padded framework catalogue for the `p.note` body.
- **`formatComplianceSummary(enabled, frameworks)`** — pure formatter; canonical home for the compliance state label. `init.ts` re-exports it for backward-compatible test imports.
- **`CompliancePromptIO`** — injectable DI seam (mirrors `ProxyPreflightDeps`). Enables unit tests to drive all branches without a real TTY.
- **`buildClackCompliancePrompts()`** — builds the real clack adapter; translates the cancel symbol into the `PromptOutcome` discriminated union.
- **`runComplianceStep(opts)`** — pure orchestrator (no `throw`/`process.exit()`/direct I/O; all I/O routed through `opts.prompts`). Flow: note header → labeled enable select → framework multiselect (`required:false`). Disable preserves frameworks (defensive copy; returned arrays never alias the seed). Returns `{kind:'resolved', state, messages}` or `{kind:'cancelled'}`.
- **`shouldRunComplianceStep({mode, modePromptShown, isTTY, hasCliOverride})`** — pure gate predicate (PF-029). BOTH wizard paths (Recommended and Advanced) call it. `modePromptShown` is `true` only when the Setup-mode `p.select` actually ran; `--recommended` flag and non-TTY fallback never set it, preserving their promptless contracts. `--compliance`/`--no-compliance` wins via `hasCliOverride`. Recommended threads the result via `applyCliToggles(…, { compliance: cliComplianceOverride ?? wizardCompliance })`.

### Attribution Prompt Module (`src/cli/commands/attribution-prompts.ts`)

A dedicated CLI-layer module (ADR-013) that owns the attribution wizard UI for the `suppress-attribution` flag (D27). Parallel structure to `compliance-prompts.ts` but with a deliberately different gate predicate.

Key exports:

- **`shouldRunAttributionStep({mode, isTTY})`** — pure gate predicate (applies PF-029). Returns `isTTY && mode === 'advanced'`. **Advanced-only — this is a documented divergence from `shouldRunComplianceStep`** (see Gotchas). There is no `modePromptShown` parameter and no CLI override for attribution: the question never runs on Recommended, and post-install toggling is via `devflow flags --enable/--disable suppress-attribution`.
- **`AttributionPromptIO`** — injectable DI seam mirroring `CompliancePromptIO`. Enables unit tests to drive all branches without a real TTY.
- **`buildClackAttributionPrompts()`** — builds the real clack adapter; translates the cancel symbol into `PromptOutcome`.
- **`runAttributionStep({seed, prompts})`** — pure orchestrator (no `throw`/`process.exit()`/direct I/O). Flow: note header (current setting + context) → `p.select` Yes/No (seeded from prior state). Returns `{kind:'resolved', suppress, messages}` or `{kind:'cancelled'}`.

**Call site in `init.ts`**: a single call in the Advanced path only. The Recommended path has no attribution call and carries the seeded `suppress-attribution` value unchanged from `resolveInitSeed`. After the Advanced step, `enabledFlags` is updated with the wizard answer so the subsequent `convergeFlagsIntoSettings` pipeline writes (or removes) the `attribution` key.

**Single ownership**: the `attribution` settings.json key is owned exclusively by the flags pipeline (`applyFlags`/`stripFlags` via `convergeFlagsIntoSettings`). It is absent from `src/targets/claude-code/templates/settings.json` and is NOT injected by `mergeDevflowSettingsTemplate` — adding it to either would create a second writer and could race with the flag pipeline.

### Migrations (`src/core/migrations.ts`)

The `MIGRATIONS` registry (typed `readonly AnyMigration[]`) has one entry: `canonicalise-agent-keys-v1` (scope `'global'`), which renames legacy keys in `~/.devflow/agent-models.json` to their canonical names.

**`AnyMigration`** is a discriminated union `Migration<'global'> | Migration<'per-project'>` — replaces the previous `Migration<MigrationScope>` (= bare `Migration`) annotation in registry and runner signatures. The union form lets TypeScript narrow the `run()` overload by discriminating on `scope`, eliminating the `as Migration<'global'>` casts that were previously required.

**`canonicaliseAgentKeys` return shape**: now returns `{ agents, didMutate, renamed, dropped, guardDropped }` — truthful reporting of which keys were renamed (collision with canonical already present), which were dropped (canonical key already present, old value discarded), and which were guard-dropped (prototype-pollution guard). `normaliseRunResult` is deleted; `run()` collapses to parse → canonicalise → write → report in a single linear flow.

**Shared envelope parser**: `parseAgentMappingEnvelope(filePath)` from `agent-models.ts` handles I/O, BOM-strip, JSON parse, and shape validation. It is now used by both `readAgentMapping` (in-memory canonicalisation path) and the migration (disk-rewrite path) — single parse site for the agent-models envelope.

**Failure mode**: `runGlobalMigration` marks a migration applied for ANY non-throwing return. The `canonicalise-agent-keys-v1` entry catches ALL I/O failures and returns them as `warnings` — it never throws. Result: a failed write is silently marked applied and never retried. Net impact is low because `readAgentMapping` applies `canonicaliseAgentKeys` on EVERY read, so the disk file self-heals on the next write even if the one-time disk migration was lost. A future fix should make genuine I/O failure throw so the runner retries it (distinguished from "malformed file, skip it" which returns correctly). `migrations.json` is removed by `removeDevFlowInstallArtifacts` so migrations re-run cleanly on reinstall.

### Flags CLI (`src/cli/commands/flags.ts`)

A CLI-layer module that owns the `devflow flags` command surface. All I/O-free flag logic lives in `src/core/flags.ts`; this module owns the Commander wiring, settings I/O, and manifest persistence.

Key exports:
- **`createFlagsCommand()`** — root Commander for `devflow flags`. Bare invocation on a TTY launches the interactive TUI; on non-TTY, prints a status table and exits 1.
- **`lookupFlag(id)`** — resolves a flag by ID from `FLAG_REGISTRY`; returns `null` for unknown IDs (callers emit an error).
- **`readSettingsSafe(settingsPath)`** — reads settings.json, returning `{ok: true, content}` or `{ok: false, reason}` — never throws.
- **`persistFlagConfig(claudeDir, devflowDir, settingsContent, newRecord)`** — writes the `FlagsRecord` to both `manifest.json` (`features.flags`) and `settings.json` (via `applyFlags`). Returns `true` on success, `false` on I/O failure. Boolean-only flags use `--enable`/`--disable`; non-boolean flags are redirected to `--set`.

**Display vocabulary** (D-EFFDV — one definition, all surfaces route through `effectiveDisplay`):

- **`--enable` / `--disable` confirmation**: both call `formatFlagValue(flag, value)` which delegates to `effectiveDisplay`. Vocabulary: `true` → 'on', `false` → 'off'. The former asymmetry ('enabled' for enable, `formatFlagValue` for disable) is gone.
- **`--set` confirmation**: active values route through `formatFlagValue`; `null` echoes literal 'unset' at the call site (the user typed that word explicitly — do not replace it with the effective default).
- **`formatStatusRows` (non-TTY status table)**: not-adopted rows use `effectiveDisplay(flag, neutralValueOf(flag)).text` — shows what the default does rather than printing 'unset'. Format: `not adopted — default: <effective text> applies on next devflow init`.
- **`--list` defaultLabel**: number flags with `upstreamDefault` print `upstream default: N`; otherwise `flag.defaultValue` as a string or `'none'` (never 'unset').

### Flags TUI (`src/cli/flags-view/`, `src/cli/tui/`)

An interactive terminal UI for editing flag state in one session. Launched exclusively by `devflow flags` bare on a TTY (D40: init no longer opens the flags editor in any path). Uses **inline mode** (see below) — renders in-place in the normal scroll buffer rather than entering the alt screen.

**`src/cli/flags-view/state.ts`** — pure state machine for the TUI. Key functions:
- `buildFlagRows(registry, record)` — produces the row list from the live `FlagsRecord`; each `FlagRow` holds `id`, `tui` value (TUI-internal representation), `hint`, `blurb` (sourced from `flag.blurb`), and display metadata.
- `collectFlagRecord(rows)` — inverse: reconstructs a `FlagsRecord` from the row list (via `tuiToRecord` per row).
- `buildStops(flag)` — ordered cycle stops for a flag (for enum/boolean/number cycling).
- `cycleForward` / `cycleBackward` — advance or retreat through a flag's stop list.
- `reduce(state, key)` — event reducer; returns `{state, done, saved}`.
- `enterEdit` / `commitEdit` / `insertChar` / `reduceEditMode` — inline text-edit for enum and string flags.
- `recordToTui` / `tuiToRecord` — convert between `FlagsRecord` values and TUI-internal values (TUI uses `null` as the "devflow default" stop; `tuiToRecord` maps that back to `neutralValueOf`).
- `adjustViewport` — scrolling helper (cursor, offset, height, rowCount).

**`FlagRow.blurb`** — short phrase (≤30 chars) describing what the flag does. Sourced from `flag.blurb` at `buildFlagRows` — no registry reach-back at render time. Rendered as a dim trailing column in the TUI (D-BLURB).

**`src/cli/flags-view/render.ts`** — frame renderer. Column layout at 80-col reference:

| Column | Width | Notes |
|--------|-------|-------|
| PREFIX | 2 | cursor mark `❯ ` or `  ` |
| LABEL | 27 | flag label |
| DIRTY | 2 | `● ` when dirty |
| VALUE | 16 | formatted value or edit buffer |
| BLURB | 30 | dim short phrase (HINT in column header) |

VALUE+BLURB = 46, preserving the prior total from the single VALUE column. All widths scale proportionally with terminal width (`Math.min(1, cols/80)`). Column header uses `gray('VALUE')` padded to `valueW` and `gray('HINT')` for the blurb column (omitted when `blurbW === 0`).

`formatValue` vocabulary (D-EFFDV — delegates to `effectiveDisplay` for null/neutral values):
- `null` (any kind) → `dim(effectiveDisplay(flag, null).text)`, with ` (default)` appended for number flags
- `boolean true` → `green('on')`, `boolean false` → `yellow('off')`
- Non-boolean active value → `bold(str)` when deviating from devflow default, else plain `str`

**`src/cli/tui/cells.ts`** — shared cell-rendering helpers used by the flags TUI render layer:
- `sanitizeCell(s)` — strips control characters from cell content (avoids terminal injection).
- `padToVisible(s, width)` — pads a string to `width` visible characters (ANSI-aware).
- `truncateVisible(s, maxWidth)` — truncates to `maxWidth` visible characters (ANSI-aware).

**`src/cli/flags-view/terminal.ts`** — flags TUI entry point. `runFlagsTui` passes `screen: 'inline'` to `runTui` (D-INLINE) so both the bare `devflow flags` invocation and the init Advanced step render in the normal scroll buffer.

**`src/cli/tui/terminal.ts`** — generic TUI driver. New additions:

- **`RunTuiSpec.screen?: 'alt' | 'inline'`** — controls screen mode. Default is `'alt'` (prior behavior; agents-view uses this). `'inline'` renders in-place without entering the alt screen.
- **Inline mode mechanics** (D-INLINE): first frame writes lines directly; subsequent frames use `cursorUp(prevLineCount - 1) + \r` then rewrite + `ERASE_BELOW`; on exit, cursor-up to frame top + `ERASE_BELOW` + `SHOW_CURSOR` erases the widget completely so the caller's clack flow continues uninterrupted.
- **`INLINE_MARGIN = 2`** — lines reserved below the widget so the shell prompt is never clobbered. Height is clamped to `stdout.rows - INLINE_MARGIN` in inline mode.
- **`cursorUp(n): string`** — returns `ESC[nA` for `n > 0`, empty string otherwise; callers need no guard.

## Integration Patterns

### Shadow Paths (canonical)

| Asset | Shadow path | Install target |
|-------|-------------|----------------|
| Skill | `~/.devflow/skills/{name}/` (unprefixed) | `~/.claude/skills/devflow:{name}/` |
| Rule | `~/.devflow/rules/{name}.md` | `~/.claude/rules/devflow/{name}.md` |

### `devflow skills` CLI

`shadow <name>` — validates the skill is installed; copies `~/.claude/skills/devflow:{name}/` to `~/.devflow/skills/{name}/` as a starting point. `unshadow <name>` — removes `~/.devflow/skills/{name}/`; restores Devflow source on next init. `list` — pre-reads `shadowDirSet` from `~/.devflow/skills/`, uses `shadowDirSet.has(skill)` as a short-circuit before calling `validateSkillShadow`. Exports: `hasShadow(skillName, devflowDir?)`.

### `devflow rules` CLI

`shadow <name>` — validates against `allRules`; seeds via `seedRuleShadow` (3-tier, no `pluginsDir` param). `unshadow <name>` — validates against `allRules` (exits 1 on unknown names). `list` — delegates to `printRulesList`. **`--enable` error isolation**: `installAllRules` is wrapped in try/catch inside the `--enable` handler (avoids PF-009). `buildRuleShadowTag` / `buildSkillShadowTag` use exhaustive switches with `never` guards. Exports: `hasRuleShadow`, `listShadowedRules`, `seedRuleShadow`.

## Anti-Patterns

- **Treating a missing declared source as a skip** — all four asset types throw on missing declared sources. `'skipped'` in `RuleInstallOutcome` means copy-level failure only (EACCES, ENOSPC), not a missing source file.
- **Installing all of `~/.devflow/` on uninstall** — only `~/.devflow/scripts/` is Devflow-owned; `~/.devflow/skills/`, `~/.devflow/rules/`, and config files are user-owned. The `resolveDevflowDirCleanup` + `removeDevFlowInstallArtifacts` pattern enforces this boundary.
- **Intersecting `knownNames` with the selected-plugin subset in `sweepOrphanedAssets`** — this would delete assets belonging to OTHER (non-selected) plugins on a partial reinstall. `knownNames` must always span ALL plugins.
- **Staging shadow state after removal** — `enumerateUserDevFlowContent` must be called before the removal block; the files may be gone by the time a confirmation prompt is shown.
- **Calling `process.exit()` after `removeAllDevFlow` on a cancel/decline path** — `removeAllDevFlow` has already run; exiting early leaves stale `manifest.json` on disk. Cancel and decline must both fall through to `removeDevFlowInstallArtifacts`. (avoids PF-014, applies ADR-003)
- **Installing without `npm run build`** — commands, agents, skills, and rules all throw hard errors when their source is absent. Run `npm run build` or `build:mds` before any install.
- **Restoring `pluginsDir` to `installAllRules` or `installRuleFile`** — rule source is exclusively `rulesDir()` (flat `src/assets/rules/`); there is no per-plugin subdirectory.
- **Combining `--reset` with `--plugin`** — factory reset and partial install are mutually exclusive; init rejects the combination before seeding.
- **Expecting `resolveSeedFlags` to only adopt default-ON flags** — it adopts ALL absent registry flags at their `defaultValue`. Default-OFF flags arrive with `false`/`null` (inactive), not as missing. The correct invariant: absent key from an old manifest → adopt registry default (whatever it is); `null` value → deliberately unset/neutral.
- **Running `reapplyAgentMapping` before proxy preflight resolves** — must use the final `proxyEnabled` value. Running it earlier materializes GPT model lines even after a preflight failure, breaking the dormancy invariant.
- **Putting a name in both `enumerateUserDevFlowContent` and `installArtifactPaths`** — makes the confirmation prompt untruthful (item is presented as user content, then deleted regardless of user answer). A test enforces disjointness.
- **Importing `EXCLUDED` as an oracle in tests** — destroys the test's independent literal check and turns invariant guards into tautologies. Pin an independent literal in the test alongside the production import.
- **Dry-run preview using only pure helpers instead of the production enumeration path** — `runDryRunPhase` (full mode) must call `enumerateDryRunExtras`, which itself calls `installArtifactPaths`. A test that exercises only the pure helper (`installArtifactPaths` in isolation) does not catch divergence between the preview and the real removal loop. (avoids PF-018)
- **Re-deriving the display vocabulary at a render site instead of calling `effectiveDisplay`** — four render sites (TUI `formatValue`, `--enable/--disable` confirmation, `--status` not-adopted message, `--list` defaultLabel) all route through `effectiveDisplay`. Adding a fifth site that hand-codes 'on'/'off' or shows 'unset' creates vocabulary drift. Always delegate to `effectiveDisplay` (D-EFFDV) or `formatFlagValue` (which does so internally).
- **Mirroring the compliance wizard gate for the attribution wizard gate** — `shouldRunAttributionStep` uses `mode === 'advanced'` directly (no `modePromptShown`), deliberately diverging from `shouldRunComplianceStep`. The compliance gate runs on interactive Recommended (`modePromptShown: true`); the attribution gate never does. Do not "restore symmetry" — the divergence is D27 design intent.
- **Adding `attribution` to `templates/settings.json` or `mergeDevflowSettingsTemplate`** — the `attribution` settings.json key is owned exclusively by the flags pipeline (`applyFlags`/`stripFlags`). A second writer creates a race: the template merge runs before the flags pipeline, so a template-written value would be immediately overwritten or, on the off path, leave a stale block. Single ownership is enforced by omission from both the template file and the merge function.

## Gotchas

- **`validateRuleShadow`'s `isFile()` guard is load-bearing.** Without `stat.isFile()`, a directory at `~/.devflow/rules/{name}.md` passes the `size > 0` check on some FSes and returns `'valid'`, causing `copyFile(shadowDir, targetFile)` to throw `EISDIR`.

- **Orphan sweeps (skills, commands, agents) run on every install shape.** All three are ungated — they run on full and partial installs alike. A partial reinstall still prunes assets absent from the full registry.

- **Agents have no legacy name list.** Orphan cleanup of agent files is the ungated registry-diff sweep via `sweepOrphanedAssets`. `LEGACY_SKILL_NAMES` and the `LEGACY_SKILLS_*` lists REMAIN load-bearing — they delete pre-namespace bare dirs outside the `devflow:` namespace.

- **`sweepOrphanedAssets` returns a `SweepResult` struct, not a count.** The `scanned` field is the count of entries matched by the predicate (not the removed count) — use it for non-vacuousness assertions in tests. A `scanned` of 0 means the predicate matched nothing; the `removed` array holds the names actually deleted; `failed` records per-item removal errors.

- **`migrations.json` is an install artifact, not user state.** It is removed by `removeDevFlowInstallArtifacts` so that migrations (including `canonicalise-agent-keys-v1`) re-run cleanly on reinstall rather than remaining permanently marked done.

- **`canonicalise-agent-keys-v1` failure mode is silent.** It catches I/O errors and returns them as warnings, so `runGlobalMigration` still marks it applied. A failed disk write is never retried. `readAgentMapping`'s in-memory re-canonicalisation is the safety net.

- **`removeDevFlowInstallArtifacts` proxy artifact removal requires `artifact.isDir === true` (strict equality, not truthiness).** Passing `recursive: artifact.isDir` passes `recursive: undefined` for entries with no `isDir`, and `fs.rm` throws a `TypeError` for directories, which the per-item `catch` swallows silently (avoids PF-009 can mask systematic TypeErrors when optional properties are not narrowed to boolean).

- **`revertExternalAgents` on the selective path reverts ALL agents, not only those being removed.** Surviving agents lose GPT frontmatter until the next `devflow init --plugin`.

- **`readConfigIfPresent` vs `readConfig` distinction.** `readConfig` always returns a config (falling back to DEFAULT_CONFIG). `readConfigIfPresent` returns `null` when absent/malformed — used by init seeding to distinguish "not configured yet" from "configured with specific values".

- **`resolveExistingViewMode` returns `undefined` for `'default'`.** The 'default' literal is not surfaced — it is treated as "no opinion" so the `??` chain falls through.

- **`knownPlugins` is a top-level field; there is no `knownFlags` field.** The plugin snapshot (`ManifestData.knownPlugins`) remains a top-level field. The former `features.knownFlags: string[]` field no longer exists — its semantic ("known to this install") is encoded in `ManifestData.features.flags` key-presence: present key = known, absent key = adopt-on-next-init. Old manifests that still have a `knownFlags` array are consumed inside `parseManifestFlags` during `readManifest` migration and NOT carried into `ManifestData`.

- **`proxy` seeds from the manifest group, not the config group.** Unlike `memory`/`learning`/`knowledge` (config.json wins per ADR-001), `proxy` follows the same seeding path as `ambient`/`hud`/`rules` — manifest is authoritative, then registry default (`false`). Do not gate `proxy` on `readConfigIfPresent`.

- **PF-018: dry-run preview must exercise the production enumeration path.** The original test (9j) tested `installArtifactPaths` in isolation. When the dry-run loop was refactored to use `enumerateDryRunExtras`, a real divergence (bare legacy skill dirs and `agent-models.json` were shown in the preview but not in the production removal path) was missed. The fix: `runDryRunPhase` (full mode) calls `enumerateDryRunExtras`, which derives from `installArtifactPaths` and the same skill-candidate sets that `removeAllDevFlow` uses. The updated test exercises `runDryRunPhase` directly, not only the pure helper.

- **Compliance wizard gate keys on `modePromptShown`, never the mode name.** `shouldRunComplianceStep` uses `modePromptShown` (was the Setup-mode `p.select` actually shown?) rather than checking `mode === 'recommended'`. Gating on the mode name would break the `--recommended` promptless contract: `--recommended` resolves `mode='recommended'` but never shows the prompt, so `modePromptShown` stays `false`. Same applies to the non-TTY fallback. (PF-029)

- **Attribution wizard gate does NOT use `modePromptShown`.** `shouldRunAttributionStep` gates on `mode === 'advanced'` directly — no `modePromptShown` parameter. This is safe because the Advanced branch itself exits non-zero on non-TTY (isTTY is the outer guard), so `mode === 'advanced'` is only ever true in an interactive session. Do not add a `modePromptShown` parameter to "align" it with the compliance gate — the divergence is intentional (D27). (PF-029)

- **`settingDeleteGuard` protects deletion, not writes.** When `suppress-attribution` is enabled (`true`), `applyFlags` always writes `{"commit":"","pr":""}` to `settings.json`, overwriting any prior value including a custom attribution block. The guard only gates the neutral/off path: when the flag transitions to false/null, the key is deleted ONLY when the current value deep-equals the managed shape. If the user has a custom attribution block (e.g. an org name), a flag-disable preserves it; a flag-enable overwrites it — this behavior is test-pinned.

- **`--set` confirmation echoes literal 'unset' for an explicit null input.** When the user types `--set flag=unset`, `parseFlagValueInput` maps that to `null`. The `handleSet` confirmation special-cases `null → 'unset'` at the call site so the user sees their own word reflected back. Active values route through `formatFlagValue` (D-EFFDV) as normal — this is the only site where 'unset' still appears in user-facing output.

- **Blurb hard-cap is enforced by a registry test, not a TypeScript type.** `flag.blurb` is typed as `string` on `FlagDefCommon` (no length constraint in the type). The ≤30-char cap lives in `tests/flags.test.ts` as a registry-walk test — adding a blurb longer than 30 chars will fail CI but not the TypeScript compiler.

- **Inline mode (`screen: 'inline'`) does not enter the alt screen.** On exit it cursor-ups to the frame top and `ERASE_BELOW` — the widget is erased and the clack flow continues in the normal scroll buffer. If you attach a flags TUI test expecting `ENTER_ALT` sequences, it will fail for `runFlagsTui` (which passes `screen: 'inline'`) but pass for agents-view tests (which use the default alt mode). Use `screen: 'alt'` explicitly when testing alt-screen behavior.

- **Selective uninstall never strips flags.** `runCleanupPhase` (which calls `stripFlags`) only runs on full uninstall. Selective plugin uninstall (`runSelectivePhaseForScope`) does not invoke `stripFlags` — flag state persists in `settings.json` even when individual plugins are removed.

## Key Files

- `src/core/orphan-sweep.ts` — `sweepOrphanedAssets(dir, knownNames, extractRegistryName) => Promise<SweepResult>`; `SweepResult = { scanned, removed, failed }`; `mdFileName` / `mdEntryName` inverse pair; shared by both installer and uninstall; per-item failure isolation on both readdir and rm
- `src/targets/claude-code/installer.ts` — `installViaFileCopy`, `installAllRules`, `installRuleFile`, `composeScripts`, `validateSkillShadow`, `validateRuleShadow`, `InstallReport` (+ `sweptOrphans`, `sweepFailures`), `SweepFailure`, `ShadowSkip`, `RuleInstallOutcome`, `SkillShadowState`, `RuleShadowState`, `copyDirectory`, `chmodRecursive`; ungated orphan sweeps for skills, commands, agents via `sweepOrphanedAssets`
- `src/core/assets.ts` — `skillsDir`, `agentsDir`, `rulesDir`, `scriptsDir`, `commandsDir` accessors; single source of truth for all asset source paths
- `src/core/paths.ts` — `getPackageRoot()` with hard `package.json` assertion; 2-level-up resolution from `dist/core/paths.js`; `isContainedIn(parent, candidate)` pure containment predicate (guards path-traversal in reapplyAgentMapping)
- `src/targets/claude-code/legacy.ts` — `LEGACY_SKILL_NAMES` (composed from `LEGACY_SKILLS_PRE_V1`, `LEGACY_SKILLS_V2`, `LEGACY_SKILLS_V2X`); target-specific delete lists for upgrade cleanup
- `src/cli/commands/init.ts` — consumes `InstallReport` and `InitSeed`; proxy preflight block using `buildRealPreflightDeps` factory (`swallowSettingsReadError: true`); `reapplyAgentMapping` call (ordering load-bearing, guarded when mapping is empty AND proxy is off); exhaustive `ShadowSkipReason` switch with `never` guard; attribution step in Advanced path only (`shouldRunAttributionStep`, `runAttributionStep`)
- `src/cli/commands/init-seed.ts` — pure seeding helpers: `resolveInitSeed`, `resolveSeedFeatures`, `resolveSeedFlags(manifestFlags: FlagsRecord | null, registry)` (two-branch: null→all defaults, non-null→spread+adopt-absent), `resolveSeedPlugins`, `resolveResetGatedInputs`, `applyCliToggles`, `FEATURE_DEFAULTS` (proxy: false); `resolveExistingAttributionSuppression` (mirrors resolveExistingViewMode — returns true for exact devflow shape, undefined otherwise); `InitSeed.flags: FlagsRecord` encodes both view-mode and suppress-attribution — no separate fields
- `src/cli/commands/attribution-prompts.ts` — `shouldRunAttributionStep({mode, isTTY})` (Advanced-only gate; no modePromptShown; D27 divergence from compliance gate); `AttributionPromptIO` (DI seam); `buildClackAttributionPrompts()`; `runAttributionStep({seed, prompts})` (pure orchestrator, no process.exit, no throw)
- `src/cli/commands/uninstall.ts` — exported: `removeAllDevFlow`, `removeSelectedPlugins`, `isDevFlowInstalled`, `installArtifactPaths` (SSOT for artifact list), `enumerateDryRunExtras` (derived from installArtifactPaths + skill lists), `sweepDevflowNamespaces` (named selective-path sweep step), `resolveProjectDataCleanup` (pure: cancel→preserve, no process.exit), `enumerateUserDevFlowContent` (skills/rules/preference-profile/learning.json/hud.json — NOT agent-models.json), `removeDevFlowInstallArtifacts` (uses installArtifactPaths; containment guard; `isDir === true` strict equality), `revertExternalAgents` runs on both full and selective paths, `computeAssetsToRemove`, `resolveSecurityRemovalDecision`, `resolveDevflowDirCleanup` (--keep-docs honored); phase runners: `runDryRunPhase`, `runSelectivePhaseForScope`, `runFullPhaseForScope`, `runCleanupPhase` (injected cwd + isTTY; calls stripFlags with settingDeleteGuard shape-guarded deletion)
- `src/core/manifest.ts` — `ManifestData` (`features.flags: FlagsRecord` — key-presence = known, null = neutral, absent = adopt-on-init; `knownPlugins?: string[]`; `features.proxy`); `parseManifestFlags(features, knownFlags)` — three-shape migration: string[]→`migrateLegacyFlagsToRecord`, object→spread, missing→empty; `readManifest` — self-heals legacy `knownFlags` (consumed in migration, not stored), proxy absent→false, applies `sanitizeFlagsRecord`; `writeManifest`, `syncManifestFeature`, `resolvePluginList` (filters `DELETED_PLUGIN_NAMES` via in-memory filter)
- `src/core/plugins.ts` — `prefixSkillName`, `unprefixSkillName`, `SKILL_NAMESPACE`, `DEVFLOW_PLUGINS` (21 plugins — no devflow-audit-claude), `buildFullSkillsMap`, `buildRulesMap`, `getAllSkillNames`, `getAllCommandNames`, `getAllAgentNames`, `partitionSelectablePlugins`, `EXCLUDED` (module-level export), `LEGACY_PLUGIN_NAMES`, `LEGACY_COMMAND_NAMES`, `LEGACY_RULE_NAMES`, `DELETED_PLUGIN_NAMES` (['devflow-audit-claude'])
- `src/core/migrations.ts` — `MIGRATIONS: readonly AnyMigration[]` (one entry: `canonicalise-agent-keys-v1`, scope `'global'`); `AnyMigration = Migration<'global'> | Migration<'per-project'>` discriminated union; `canonicaliseAgentKeys` returns `{agents, didMutate, renamed, dropped, guardDropped}`; `parseAgentMappingEnvelope` shared with `readAgentMapping`; failure-as-warning means a failed write is permanently skipped (self-healed by `readAgentMapping`)
- `src/cli/commands/proxy.ts` — `applyDisableToSettings`, `buildRealPreflightDeps`, `addProxyHooks`, `removeProxyHooks`, `applyProxyEnv`, `stripProxyEnv`
- `src/core/flags.ts` — `FLAG_REGISTRY` (29 flags, each with `blurb: string` on `FlagDefCommon` — ≤30 chars, hard-capped by registry test); `BooleanFlagDef = EnvBooleanFlagDef | SettingBooleanFlagDef` discriminated union — `EnvBooleanFlagDef` compile-constrains `onPayload: string` and `settingDeleteGuard?: never`; `SettingBooleanFlagDef` allows object `onPayload` and optional `settingDeleteGuard: Record<string, unknown>`; `suppress-attribution` is a `SettingBooleanFlagDef` (target key `attribution`, onPayload `{commit:'',pr:''}`, settingDeleteGuard same shape); `deepEqualsPlain` (private pure JSON structural equality used by D-ATTR-GUARD); `FlagsRecord` (`Record<string, FlagsRecordValue>`), `FlagsRecordValue` (`FlagValue | null`); `effectiveDisplay(flag, value): EffectiveDisplay` (D-EFFDV one-definition seam — never returns 'unset': boolean→'on'/'off', enum null→neutralValue, number null→devflow/upstream default, string null→'—'); `formatFlagValue` delegates to `effectiveDisplay`; `getDefaultFlagsRecord`, `sanitizeFlagsRecord`, `migrateLegacyFlagsToRecord`, `coerceFlagValue`, `parseFlagValueInput`, `neutralValueOf`, `isNeutral`, `countActiveFlags`, `readViewMode`; `applyFlags(settingsJson, FlagsRecord)`, `stripFlags`, `resolveExistingViewMode`, `resolveFinalViewMode`
- `src/core/feature-config.ts` — `readConfig`, `readConfigIfPresent`, `writeConfig`, `updateFeature`
- `src/cli/commands/flags.ts` — `createFlagsCommand` (bare TTY→TUI inline mode, bare non-TTY→status table+exit 1); `lookupFlag(id)` (null for unknown); `readSettingsSafe(settingsPath)` (Result-returning); `persistFlagConfig(claudeDir, devflowDir, settingsContent, newRecord)` (writes FlagsRecord to manifest + settings.json); `formatStatusRows` uses `effectiveDisplay` for not-adopted rows; `--set` confirmation special-cases null→literal 'unset'
- `src/cli/flags-view/state.ts` — `FlagsViewState`, `FlagRow` (includes `blurb: string` sourced from `flag.blurb`); `buildFlagRows(registry, record)`, `collectFlagRecord(rows)`; `buildStops`, `cycleForward`, `cycleBackward`; `recordToTui`/`tuiToRecord` value converters; `reduce(state, key) → {state, done, saved}`; `enterEdit`/`commitEdit`/`insertChar`/`reduceEditMode`; `adjustViewport`
- `src/cli/flags-view/render.ts` — column layout: PREFIX 2, LABEL 27, DIRTY 2, VALUE 16, BLURB 30; `formatValue` delegates to `effectiveDisplay` for null; boolean → green 'on' / yellow 'off'; HINT column header; blurb rendered dim and truncated to `blurbW`
- `src/cli/flags-view/terminal.ts` — `runFlagsTui` passes `screen: 'inline'` to `runTui` (D-INLINE); sole launch path is `devflow flags` bare on a TTY (D40: init does not open the flags editor)
- `src/cli/tui/terminal.ts` — `runTui<S,A,C>` generic driver; `RunTuiSpec.screen?: 'alt' | 'inline'` (default 'alt'; agents-view uses alt, flags uses inline); `INLINE_MARGIN = 2`; `cursorUp(n)` helper; inline mode: cursor-up repaints, ERASE_BELOW on exit, height clamped to stdout.rows - INLINE_MARGIN
- `src/cli/tui/cells.ts` — `sanitizeCell(s)`, `padToVisible(s, width)`, `truncateVisible(s, maxWidth)` — ANSI-aware cell rendering helpers used by flags TUI render layer

## Related

- ADR-001: Config-only feature gates — governs `readConfigIfPresent` as the init-seed source for memory/learning/knowledge; config.json is the source of truth, manifest is secondary. Note: proxy is NOT in this group — it seeds from the manifest like ambient/hud/rules
- ADR-003: End-state not transition — governs removals and legacy cleanup; cancel/decline on uninstall falls through to `removeDevFlowInstallArtifacts` rather than `process.exit()` so cleanup always runs
- ADR-010: Shadow tolerance — governs `installViaFileCopy` as sole install path and warn-and-install-source (not hard-fail) for invalid shadows; hard-error policy applies only to declared Devflow sources
- ADR-013: Core/adapter boundary — governs `init-seed.ts` and `attribution-prompts.ts` living in `src/cli/commands/` (CLI-init-specific logic) rather than `src/core/`
- ADR-014: State-aware re-init — governs `readManifest` self-heal idiom (`proxy` absent→false), FlagsRecord key-presence as the "known" encoding (absent key = adopt-on-init), `--reset` zeroing seedManifest so suppress-attribution always falls back to false on factory reset, and the `knownPlugins` snapshot pattern for detecting newly added plugins
- ADR-019: Typed flag registry — governs the `FLAG_REGISTRY` design including `BooleanFlagDef` as a discriminated union (`EnvBooleanFlagDef | SettingBooleanFlagDef`) enforcing the env-string invariant at compile time
- ADR-020: Flags editor removal from init (D40) — governs that init applies flags non-interactively; `devflow flags` bare on TTY is the sole TUI entry point
- PF-009: Per-item failure isolation — per-rule try/catch inside `installRuleFile`; `rules --enable` wraps `installAllRules`; proxy preflight failure warns + forces off without aborting init; `sweepOrphanedAssets` outer/inner independent catches; proxy artifact removal is per-item non-fatal; non-fatal catches can mask systematic TypeErrors when optional properties are not narrowed
- PF-012: LEGACY_* lists deletion-risk — lists split between `src/targets/claude-code/legacy.ts` (skill) and `src/core/plugins.ts` (plugin/command/rule); both must be retained across upgrades
- PF-014: process.exit() skips cleanup — governs the cancel/decline path in user-scope uninstall; `removeDevFlowInstallArtifacts` must execute on every non-confirm path; `resolveProjectDataCleanup` maps cancel→false (preserve) instead of process.exit(); `runAttributionStep` also never calls process.exit (callers own the cancel idiom)
- PF-015: Fold-before-strip — governs that `suppress-attribution` (like view-mode) must be encoded into `FlagsRecord` before `convergeFlagsIntoSettings` runs; both flags share the single-record pattern
- PF-018: Dry-run regression test must exercise the production output path — the original helper-only test missed a real preview/deletion divergence; `runDryRunPhase` (full mode) calls `enumerateDryRunExtras` which shares `installArtifactPaths` with the removal loop
- PF-029: Wizard gate predicates must be fully wired, seeded, tested — applies to both `shouldRunComplianceStep` and `shouldRunAttributionStep`; the attribution gate diverges deliberately (Advanced-only, no modePromptShown) and the divergence is documented in `attribution-prompts.ts` (D27)
- PF-043: Test fixtures must match runtime shapes — governs the `tests/init-e2e-flags.test.ts` subprocess e2e tests over the real init settings pass, ensuring test fixtures stay in sync with the actual settings.json schema written by `applyFlags`
- Feature knowledge: `external-model-routing` — deep proxy mechanics (lifecycle, preflight protocol, ensure-proxy hook, per-agent model mapping, dormancy invariant, agent frontmatter rewriting, TUI); `installer-shadowing` covers only proxy's footprint in the install/uninstall pipeline and init seeding
- Feature knowledge: `feature-knowledge-system` — the Knowledge agent writes to `.devflow/features/` which is tracked in git; related to the `.gitignore` carve-out maintained by the installer
