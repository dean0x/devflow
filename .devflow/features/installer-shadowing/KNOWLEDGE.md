---
feature: installer-shadowing
name: Installer & Skill/Rule Shadowing
description: "Use when modifying the install pipeline (installViaFileCopy, installAllRules, composeScripts, InstallReport), adding or changing skill/rule shadow override logic, touching uninstall scope (enumerateUserDevFlowContent, removeDevFlowInstallArtifacts, resolveDevflowDirCleanup, installArtifactPaths, sweepDevflowNamespaces, resolveProjectDataCleanup) or install-artifact cleanup, extending the CLI skills/rules management commands, working with asset directory accessors (rulesDir, skillsDir, commandsDir) and package-root resolution, or modifying the init seeding layer (resolveInitSeed, resolveSeedFeatures, resolveSeedFlags, resolveSeedPlugins, --reset, knownFlags, knownPlugins, readConfigIfPresent, resolveExistingViewMode, getAllCommandNames, proxy). Keywords: installViaFileCopy, installAllRules, composeScripts, InstallReport, RuleInstallOutcome, SkillShadowState, RuleShadowState, shadow, unshadow, validateSkillShadow, validateRuleShadow, seedRuleShadow, prefixSkillName, unprefixSkillName, devflow:, skills, rules, uninstall, EISDIR, enumerateUserDevFlowContent, removeDevFlowInstallArtifacts, resolveDevflowDirCleanup, installArtifactPaths, enumerateDryRunExtras, sweepDevflowNamespaces, resolveProjectDataCleanup, runDryRunPhase, runSelectivePhaseForScope, runFullPhaseForScope, runCleanupPhase, getPackageRoot, isContainedIn, rulesDir, skillsDir, agentsDir, commandsDir, scriptsDir, LEGACY_SKILL_NAMES, sweepOrphanedAssets, SweepResult, sweepOrphans, sweepFailures, SweepFailure, mdFileName, mdEntryName, orphan sweep, getAllSkillNames, getAllCommandNames, getAllAgentNames, DELETED_PLUGIN_NAMES, EXCLUDED, resolveInitSeed, resolveSeedFeatures, resolveSeedFlags, resolveSeedPlugins, resolveResetGatedInputs, applyCliToggles, knownFlags, knownPlugins, readConfigIfPresent, resolveExistingViewMode, resolveFinalViewMode, reset, init-seed, proxy, reapplyAgentMapping, revertExternalAgents, agent-models.json, proxy.json, proxy-routing.json, proxy.pid, applyDisableToSettings, buildRealPreflightDeps, canonicalise-agent-keys-v1, AnyMigration, migrations.json, compliance-prompts, shouldRunComplianceStep, CompliancePromptIO, runComplianceStep, modePromptShown."
category: architecture
directories: [src/targets/claude-code/installer.ts, src/targets/claude-code/legacy.ts, src/cli/commands/init.ts, src/cli/commands/init-seed.ts, src/cli/commands/uninstall.ts, src/cli/commands/rules.ts, src/cli/commands/skills.ts, src/core/plugins.ts, src/core/assets.ts, src/core/paths.ts, src/core/manifest.ts, src/core/flags.ts, src/core/feature-config.ts, src/core/orphan-sweep.ts, src/core/migrations.ts, src/cli/commands/compliance-prompts.ts]
created: 2026-07-13
updated: 2026-08-22
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

### Manifest Snapshots: `knownFlags`, `knownPlugins`, and `proxy`

`manifest.ts` stores two registry snapshots at install time:

- `ManifestData.features.knownFlags?: string[]` — all `FLAG_REGISTRY` IDs at the time of the last install
- `ManifestData.knownPlugins?: string[]` — all `DEVFLOW_PLUGINS` names at the time of the last install

Both are absent in pre-7b manifests; `readManifest` self-heals via a local `asStringArray` helper that requires all elements to pass `typeof e === 'string'` — a mixed/garbage array like `[1, null]` self-heals to `undefined`, not just non-arrays. These snapshots are consumed by the init seeding layer to detect newly added flags and plugins.

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

**`removeAllDevFlow(claudeDir, devflowScriptsDir, verbose)`** removes `commands/devflow/`, `agents/devflow/`, `rules/devflow/`, `devflowScriptsDir`, and skill dirs via two separate passes (avoids PF-012): **prefixed** (`devflow:name`) for every skill in `getAllSkillNames() ∪ LEGACY_SKILL_NAMES`; **bare** (name or `devflow-name`) for `LEGACY_SKILL_NAMES` only — `~/.claude/skills/` is shared, so a bare dir matching a live-registry skill name is by construction foreign to Devflow.

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
- **`runCleanupPhase(opts)`** — post-loop extras on full uninstall: `.devflow/` project data dir, `.claudeignore`, `settings.json` hooks/flags, security deny list, safe-delete shell function. Takes injected `cwd` and `isTTY` so prompt gates are testable without touching developer files.

**`enumerateUserDevFlowContent(devflowDir)`** (called BEFORE any removal) checks for: `devflowDir/skills/` (skill shadows), `devflowDir/rules/` (rule shadows), `devflowDir/preference-profile.md`, `devflowDir/learning.json`, and `devflowDir/hud.json`. Returns human-readable labels. `agent-models.json` is **NOT** listed here — it is classified as an install artifact (see `installArtifactPaths`).

**`removeDevFlowInstallArtifacts(devflowDir, verbose)`** removes (non-fatally per-item): `manifest.json` (separate step at top), then all entries from `installArtifactPaths(devflowDir)`. Before removing `proxy.pid`, reads PID and checks process existence via `process.kill(pid, 0)` — if still running, emits a warning with a manual kill hint; **never kills the relay**.

**Containment precondition** (inside the artifact-removal loop): before each `fs.rm`, computes `path.relative(devflowDir, fullPath)`. If the result is `''`, starts with `'..'`, or is absolute — **skips the removal** rather than throwing. This guards against a derived relative path (e.g. from `hudCacheDir`) collapsing to `''` and triggering a recursive wipe of all of `~/.devflow`. Asserting in production code (not only tests) keeps the invariant load-bearing (reliability rule).

**Hard classification invariant**: `enumerateUserDevFlowContent` (user state — survives unless explicitly confirmed) and the artifact list in `installArtifactPaths` / `removeDevFlowInstallArtifacts` (removed on every path: decline, cancel, non-interactive, `--keep-docs`) must be **DISJOINT**. A name in both lists makes the confirmation prompt untruthful — it is presented as user content that removal would take, then deleted regardless of the answer. A test enforces this invariant. Specifically: `agent-models.json` and `migrations.json` are install artifacts; `hud.json` is user state.

**User-scope prompt path**: confirm → `fs.rm(devflowDir, {recursive: true, force: true})`; decline OR cancel → falls through to `removeDevFlowInstallArtifacts` (applies ADR-003, avoids PF-014). `process.exit()` is never called here.

**Settings cleanup**: calls `applyDisableToSettings(parsedSettings, managedPort)` in a single parse-mutate-serialize pass. `managedPort` is read from `proxy.json` (falling back to `DEFAULT_PROXY_PORT`) so only the `ANTHROPIC_BASE_URL` for Devflow's managed port is stripped.

### Init Seeding Layer (`init-seed.ts`)

A dedicated pure-function module (`src/cli/commands/init-seed.ts`) computes the initial prompt state for `devflow init` from the existing manifest, project config, settings.json, and registry. All functions are I/O-free and testable in isolation (applies ADR-013).

**Composition point**: `resolveInitSeed(seedManifest, seedConfig, settingsSnapshot, plugins) → InitSeed`

`InitSeed` carries: `features: FeatureSeed`, `flags: string[]`, `viewMode: ViewMode`, `workflowPlugins: string[]`, `languagePlugins: string[]`.

**Feature seeding** (`resolveSeedFeatures`):
- `memory / learning / knowledge`: projectConfig wins when present (ADR-001 — config.json is the source of truth); falls back to manifest; then registry defaults (all true).
- `ambient / hud / rules / proxy`: manifest is the source; registry defaults when manifest absent. `proxy` defaults to `false` in `FEATURE_DEFAULTS` — it is Advanced-only and never part of Recommended defaults. Because proxy seeds from the manifest group (not config.json), `--reset` null-seeds the manifest and correctly resets proxy to `false`.

**Flag seeding** (`resolveSeedFlags`): Fresh install → all default-ON registry flags. Old manifest (no `knownFlags`) → return existing flags as-is. Re-init with `knownFlags` → union existing ∪ {default-ON flags ∉ knownFlags}. Default-OFF flags are NEVER auto-added.

**Plugin seeding** (`resolveSeedPlugins`): Fresh install → non-optional workflow plugins preselected, empty language list. Old manifest (no `knownPlugins`) → split existing into workflow/language buckets, adopt nothing. Re-init with `knownPlugins` → split + adopt newly-added non-optional selectable plugins ∉ knownPlugins.

**Reset gate** (`resolveResetGatedInputs`): `--reset` zeroes seedManifest, seedConfig, AND settingsSnapshot.

**viewMode resolution**: `resolveExistingViewMode(settingsSnapshot) ?? seedManifest?.features.viewMode ?? 'default'`. `resolveExistingViewMode` returns non-default values only — 'default' surfaces as undefined so `??` falls through.

**CLI toggles** (`applyCliToggles`): Applies explicit CLI feature flags (e.g. `--no-learning`, `--proxy`) on top of the resolved seed. Undefined = not specified; seed value is kept.

**`--reset --plugin` rejection**: Combining factory reset with a partial install is rejected before reaching seed resolution.

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

### Migrations (`src/core/migrations.ts`)

The `MIGRATIONS` registry (typed `readonly AnyMigration[]`) has one entry: `canonicalise-agent-keys-v1` (scope `'global'`), which renames legacy keys in `~/.devflow/agent-models.json` to their canonical names.

**`AnyMigration`** is a discriminated union `Migration<'global'> | Migration<'per-project'>` — replaces the previous `Migration<MigrationScope>` (= bare `Migration`) annotation in registry and runner signatures. The union form lets TypeScript narrow the `run()` overload by discriminating on `scope`, eliminating the `as Migration<'global'>` casts that were previously required.

**`canonicaliseAgentKeys` return shape**: now returns `{ agents, didMutate, renamed, dropped, guardDropped }` — truthful reporting of which keys were renamed (collision with canonical already present), which were dropped (canonical key already present, old value discarded), and which were guard-dropped (prototype-pollution guard). `normaliseRunResult` is deleted; `run()` collapses to parse → canonicalise → write → report in a single linear flow.

**Shared envelope parser**: `parseAgentMappingEnvelope(filePath)` from `agent-models.ts` handles I/O, BOM-strip, JSON parse, and shape validation. It is now used by both `readAgentMapping` (in-memory canonicalisation path) and the migration (disk-rewrite path) — single parse site for the agent-models envelope.

**Failure mode**: `runGlobalMigration` marks a migration applied for ANY non-throwing return. The `canonicalise-agent-keys-v1` entry catches ALL I/O failures and returns them as `warnings` — it never throws. Result: a failed write is silently marked applied and never retried. Net impact is low because `readAgentMapping` applies `canonicaliseAgentKeys` on EVERY read, so the disk file self-heals on the next write even if the one-time disk migration was lost. A future fix should make genuine I/O failure throw so the runner retries it (distinguished from "malformed file, skip it" which returns correctly). `migrations.json` is removed by `removeDevFlowInstallArtifacts` so migrations re-run cleanly on reinstall.

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
- **Auto-adopting default-OFF flags in `resolveSeedFlags`** — only default-ON flags are auto-adopted when new (∉ knownFlags). Default-OFF flags must always be explicitly user-selected.
- **Running `reapplyAgentMapping` before proxy preflight resolves** — must use the final `proxyEnabled` value. Running it earlier materializes GPT model lines even after a preflight failure, breaking the dormancy invariant.
- **Putting a name in both `enumerateUserDevFlowContent` and `installArtifactPaths`** — makes the confirmation prompt untruthful (item is presented as user content, then deleted regardless of user answer). A test enforces disjointness.
- **Importing `EXCLUDED` as an oracle in tests** — destroys the test's independent literal check and turns invariant guards into tautologies. Pin an independent literal in the test alongside the production import.
- **Dry-run preview using only pure helpers instead of the production enumeration path** — `runDryRunPhase` (full mode) must call `enumerateDryRunExtras`, which itself calls `installArtifactPaths`. A test that exercises only the pure helper (`installArtifactPaths` in isolation) does not catch divergence between the preview and the real removal loop. (avoids PF-018)

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

- **`knownPlugins` is a top-level field; `knownFlags` is inside `features`.** Both snapshotted at install time. The asymmetric placement mirrors the schema: plugins are top-level in `ManifestData`, flags are nested in `ManifestData.features`.

- **`proxy` seeds from the manifest group, not the config group.** Unlike `memory`/`learning`/`knowledge` (config.json wins per ADR-001), `proxy` follows the same seeding path as `ambient`/`hud`/`rules` — manifest is authoritative, then registry default (`false`). Do not gate `proxy` on `readConfigIfPresent`.

- **PF-018: dry-run preview must exercise the production enumeration path.** The original test (9j) tested `installArtifactPaths` in isolation. When the dry-run loop was refactored to use `enumerateDryRunExtras`, a real divergence (bare legacy skill dirs and `agent-models.json` were shown in the preview but not in the production removal path) was missed. The fix: `runDryRunPhase` (full mode) calls `enumerateDryRunExtras`, which derives from `installArtifactPaths` and the same skill-candidate sets that `removeAllDevFlow` uses. The updated test exercises `runDryRunPhase` directly, not only the pure helper.

- **Compliance wizard gate keys on `modePromptShown`, never the mode name.** `shouldRunComplianceStep` uses `modePromptShown` (was the Setup-mode `p.select` actually shown?) rather than checking `mode === 'recommended'`. Gating on the mode name would break the `--recommended` promptless contract: `--recommended` resolves `mode='recommended'` but never shows the prompt, so `modePromptShown` stays `false`. Same applies to the non-TTY fallback. (PF-029)

## Key Files

- `src/core/orphan-sweep.ts` — `sweepOrphanedAssets(dir, knownNames, extractRegistryName) => Promise<SweepResult>`; `SweepResult = { scanned, removed, failed }`; `mdFileName` / `mdEntryName` inverse pair; shared by both installer and uninstall; per-item failure isolation on both readdir and rm
- `src/targets/claude-code/installer.ts` — `installViaFileCopy`, `installAllRules`, `installRuleFile`, `composeScripts`, `validateSkillShadow`, `validateRuleShadow`, `InstallReport` (+ `sweptOrphans`, `sweepFailures`), `SweepFailure`, `ShadowSkip`, `RuleInstallOutcome`, `SkillShadowState`, `RuleShadowState`, `copyDirectory`, `chmodRecursive`; ungated orphan sweeps for skills, commands, agents via `sweepOrphanedAssets`
- `src/core/assets.ts` — `skillsDir`, `agentsDir`, `rulesDir`, `scriptsDir`, `commandsDir` accessors; single source of truth for all asset source paths
- `src/core/paths.ts` — `getPackageRoot()` with hard `package.json` assertion; 2-level-up resolution from `dist/core/paths.js`; `isContainedIn(parent, candidate)` pure containment predicate (guards path-traversal in reapplyAgentMapping)
- `src/targets/claude-code/legacy.ts` — `LEGACY_SKILL_NAMES` (composed from `LEGACY_SKILLS_PRE_V1`, `LEGACY_SKILLS_V2`, `LEGACY_SKILLS_V2X`); target-specific delete lists for upgrade cleanup
- `src/cli/commands/init.ts` — consumes `InstallReport` and `InitSeed`; proxy preflight block using `buildRealPreflightDeps` factory (`swallowSettingsReadError: true`); `reapplyAgentMapping` call (ordering load-bearing, guarded when mapping is empty AND proxy is off); exhaustive `ShadowSkipReason` switch with `never` guard
- `src/cli/commands/init-seed.ts` — pure seeding helpers: `resolveInitSeed`, `resolveSeedFeatures`, `resolveSeedFlags`, `resolveSeedPlugins`, `resolveResetGatedInputs`, `applyCliToggles`, `FEATURE_DEFAULTS` (proxy: false)
- `src/cli/commands/uninstall.ts` — exported: `removeAllDevFlow`, `removeSelectedPlugins`, `isDevFlowInstalled`, `installArtifactPaths` (SSOT for artifact list), `enumerateDryRunExtras` (derived from installArtifactPaths + skill lists), `sweepDevflowNamespaces` (named selective-path sweep step), `resolveProjectDataCleanup` (pure: cancel→preserve, no process.exit), `enumerateUserDevFlowContent` (skills/rules/preference-profile/learning.json/hud.json — NOT agent-models.json), `removeDevFlowInstallArtifacts` (uses installArtifactPaths; containment guard; `isDir === true` strict equality), `revertExternalAgents` runs on both full and selective paths, `computeAssetsToRemove`, `resolveSecurityRemovalDecision`, `resolveDevflowDirCleanup` (--keep-docs honored); phase runners: `runDryRunPhase`, `runSelectivePhaseForScope`, `runFullPhaseForScope`, `runCleanupPhase` (injected cwd + isTTY)
- `src/core/manifest.ts` — `ManifestData` (with `knownPlugins`, `features.knownFlags`, `features.proxy`), `readManifest` (self-heals via `asStringArray`; proxy absent→false), `writeManifest`, `syncManifestFeature`, `resolvePluginList` (filters `DELETED_PLUGIN_NAMES` via in-memory filter)
- `src/core/plugins.ts` — `prefixSkillName`, `unprefixSkillName`, `SKILL_NAMESPACE`, `DEVFLOW_PLUGINS` (21 plugins — no devflow-audit-claude), `buildFullSkillsMap`, `buildRulesMap`, `getAllSkillNames`, `getAllCommandNames`, `getAllAgentNames`, `partitionSelectablePlugins`, `EXCLUDED` (module-level export), `LEGACY_PLUGIN_NAMES`, `LEGACY_COMMAND_NAMES`, `LEGACY_RULE_NAMES`, `DELETED_PLUGIN_NAMES` (['devflow-audit-claude'])
- `src/core/migrations.ts` — `MIGRATIONS: readonly AnyMigration[]` (one entry: `canonicalise-agent-keys-v1`, scope `'global'`); `AnyMigration = Migration<'global'> | Migration<'per-project'>` discriminated union; `canonicaliseAgentKeys` returns `{agents, didMutate, renamed, dropped, guardDropped}`; `parseAgentMappingEnvelope` shared with `readAgentMapping`; failure-as-warning means a failed write is permanently skipped (self-healed by `readAgentMapping`)
- `src/cli/commands/proxy.ts` — `applyDisableToSettings`, `buildRealPreflightDeps`, `addProxyHooks`, `removeProxyHooks`, `applyProxyEnv`, `stripProxyEnv`
- `src/core/flags.ts` — `FLAG_REGISTRY`, `resolveExistingViewMode`, `resolveFinalViewMode`, `applyFlags`, `stripFlags`, `getDefaultFlags`
- `src/core/feature-config.ts` — `readConfig`, `readConfigIfPresent`, `writeConfig`, `updateFeature`

## Related

- ADR-001: Config-only feature gates — governs `readConfigIfPresent` as the init-seed source for memory/learning/knowledge; config.json is the source of truth, manifest is secondary. Note: proxy is NOT in this group — it seeds from the manifest like ambient/hud/rules
- ADR-003: End-state not transition — governs removals and legacy cleanup; cancel/decline on uninstall falls through to `removeDevFlowInstallArtifacts` rather than `process.exit()` so cleanup always runs
- ADR-010: Shadow tolerance — governs `installViaFileCopy` as sole install path and warn-and-install-source (not hard-fail) for invalid shadows; hard-error policy applies only to declared Devflow sources
- ADR-013: Core/adapter boundary — governs `init-seed.ts` living in `src/cli/commands/` (CLI-init-specific logic) rather than `src/core/`
- ADR-014: State-aware re-init — governs `readManifest` self-heal idiom (`proxy` absent→false) and the `knownFlags`/`knownPlugins` snapshot pattern for detecting newly added registry entries
- PF-009: Per-item failure isolation — per-rule try/catch inside `installRuleFile`; `rules --enable` wraps `installAllRules`; proxy preflight failure warns + forces off without aborting init; `sweepOrphanedAssets` outer/inner independent catches; proxy artifact removal is per-item non-fatal; non-fatal catches can mask systematic TypeErrors when optional properties are not narrowed
- PF-012: LEGACY_* lists deletion-risk — lists split between `src/targets/claude-code/legacy.ts` (skill) and `src/core/plugins.ts` (plugin/command/rule); both must be retained across upgrades
- PF-014: process.exit() skips cleanup — governs the cancel/decline path in user-scope uninstall; `removeDevFlowInstallArtifacts` must execute on every non-confirm path; `resolveProjectDataCleanup` maps cancel→false (preserve) instead of process.exit()
- PF-018: Dry-run regression test must exercise the production output path — the original helper-only test missed a real preview/deletion divergence; `runDryRunPhase` (full mode) calls `enumerateDryRunExtras` which shares `installArtifactPaths` with the removal loop
- Feature knowledge: `external-model-routing` — deep proxy mechanics (lifecycle, preflight protocol, ensure-proxy hook, per-agent model mapping, dormancy invariant, agent frontmatter rewriting, TUI); `installer-shadowing` covers only proxy's footprint in the install/uninstall pipeline and init seeding
- Feature knowledge: `feature-knowledge-system` — the Knowledge agent writes to `.devflow/features/` which is tracked in git; related to the `.gitignore` carve-out maintained by the installer
