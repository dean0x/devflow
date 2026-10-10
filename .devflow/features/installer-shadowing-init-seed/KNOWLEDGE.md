---
feature: installer-shadowing-init-seed
name: Init Seeding, Manifest & Managed Config
description: "Use when changing init seeding (resolveInitSeed, resolveSeed*, --reset), manifest self-heal, writeManagedConfig, queue drain, --hud-only, proxy preflight order or migrations. Keywords: init-seed, manifest."
category: architecture
directories: [src/cli/commands/init.ts, src/cli/commands/init-seed.ts, src/core/manifest.ts, src/core/feature-config.ts, src/core/migrations.ts, src/cli/commands/proxy.ts]
created: 2026-10-10
updated: 2026-10-10
---

# Init Seeding, Manifest & Managed Config

## Rules

- **KB-AP-1** `--reset` and `--plugin` never combine: factory reset and partial install are mutually exclusive, and init rejects the pair before seeding.
- **KB-AP-2** `resolveSeedFlags` does not adopt only default-ON flags: it adopts EVERY absent registry flag at its `defaultValue`. Default-OFF flags arrive as `false`/`null` (inactive), not missing; a `null` value means deliberately unset.
- **KB-AP-3** Never run `reapplyAgentMapping` before proxy preflight resolves: GPT model lines would materialise in agent files even after a preflight failure, breaking dormancy.
- **KB-AP-4** The fresh-install default branch never takes every non-optional plugin: `devflow-ambient` follows the ambient switch on EVERY path (`D-AMBIENT-FOLLOWS-SWITCH`), or `init --no-ambient` records it in the manifest anyway.
- **KB-AP-5** Never write `.devflow/config.json` as a full-file overwrite: it drops the hand-written per-repo `tracker` override and every key Devflow does not manage. Go through `mergeManagedConfig` (`D-CONFIG-PRESERVE-UNMANAGED`).
- **KB-AP-6** Never reintroduce a `readConfigIfPresent` branch for any `FeatureSeed` key, and never seed `memory`/`learning`/`knowledge` from a per-repo file: whichever repo init runs in would override every other repo's choice.
- **KB-AP-7** Never drain a switched-off feature's queue before the manifest write lands: a concurrent session still reading "on" would append turns that survive the disable.
- **KB-AP-8** `--hud-only` over a prior install never rewrites the manifest as a fresh HUD-only install: it keeps every recorded value and flips only `features.hud` (`D-HUD-ONLY-PRESERVE`).
- **KB-AP-9** init never repairs a personal `config.json`: a malformed, duplicate-key or unreadable file is left byte for byte and a warning is printed (`D-CONFIG-STRICT-PARSE`, `D-CONFIG-NO-REPAIR`).
- **KB-AP-10** init writes no repository file at HOME (`D-INIT-NOT-HOME`): a git root whose realpath is HOME's counts as no repository.
- **KB-AP-11** Never write `settings.json` non-atomically: every writer goes through `writeSettingsFileAtomic` (`D-SETTINGS-ATOMIC`).
- **KB-AP-12** `resolveSeedFeatures` spreads the tracker object and never returns `FEATURE_DEFAULTS.tracker` by reference: a downstream mutation would corrupt the module-level default for every later call.
- **KB-INV-1** Every `FeatureSeed` field seeds from the manifest alone and falls back to `FEATURE_DEFAULTS`; `--reset` null-seeds the manifest so every field collapses to its registry default.
- **KB-INV-2** `FlagsRecord` key-presence encodes "known to this install": present = known, absent = adopt on next init, `null` = neutral; there is no `knownFlags` field.
- **KB-INV-3** The seeding helpers in `init-seed.ts` are pure and I/O-free.
- **KB-INV-4** The manifest records the FINAL resolved value after preflight (a failed proxy preflight forces `proxyEnabled = false` before the write).
- **KB-INV-5** `mergeManagedConfig` is the single merge site: it keeps every key the file has, drops `RETIRED_CONFIG_KEYS`, and overwrites only `reviewPublication` by name.
- **KB-INV-6** Init applies flags non-interactively: no TUI opens in either init path; `devflow flags` bare on a TTY is the sole TUI entry.
- **KB-INV-7** Init's summary and status lines come from the state the run acts on (`D-INIT-REAL-OUTCOME`).
- **KB-INV-8** The migration runner marks a migration applied for ANY non-throwing return; a throwing migration is retried on every init with no cap or backoff.

## Overview

`devflow init` is state-aware: a pure seeding module computes the initial prompt state from the existing manifest, project config, `settings.json` and the registry, so a re-init starts from what the machine already chose and adopts only what is new. The same module family owns the manifest snapshots init reads and writes, the managed per-repo config write, the queue drain that follows a switch-off, `--hud-only`, the proxy preflight ordering, and the one-time migrations. The wizard step modules are in the wizard-flags and tracker-wiring KBs; the `.gitignore` block and CLAUDE.md audit are in the init-artifacts KB.

## Init Seeding Layer (`src/cli/commands/init-seed.ts`)

- **Composition:** `resolveInitSeed(seedManifest, settingsSnapshot, plugins) → InitSeed` carrying `features: FeatureSeed`, `flags: FlagsRecord`, `workflowPlugins: string[]`, `languagePlugins: string[]`. View mode lives in `flags['view-mode']` and attribution suppression in `flags['suppress-attribution']`; there are no separate fields, and `seedManifest?.features.viewMode` is retired.
- **Feature seeding** (`resolveSeedFeatures(manifest: ManifestData | null)`): every field of `FeatureSeed` — `ambient / memory / hud / knowledge / learning / rules / proxy / compliance / tracker` — seeds uniformly from the manifest, falling back to `FEATURE_DEFAULTS` (all `true` except `proxy` = `false`, `compliance` = `{enabled:false, frameworks:[]}`, `tracker` = `{provider: DEFAULT_TRACKER_PROVIDER}`, i.e. github). It takes NO `.devflow/config.json` input: `memory`/`learning`/`knowledge` are machine-wide switches recorded in the manifest alone (`D-FEATURES-NARROW-ONLY`, `src/core/feature-switch.ts`). There is no per-feature exception: when `memory`/`learning`/`knowledge` once seeded from `config.json` while `proxy`/`compliance`/`tracker` seeded from the manifest, `devflow init --no-learning` in one repo looked successful while the manifest, and every other repo, kept the old value. Like `compliance`'s `rawCompliance` spread, `rawTracker` is spread (`{ ...rawTracker }`).
- **Flag seeding** (`resolveSeedFlags(manifestFlags: FlagsRecord | null, registry)`): (1) `null` (fresh install) → all registry flags at `defaultValue`; (2) non-null → spread the manifest record, then adopt `defaultValue` for each registry flag whose key is absent. Unknown IDs from old manifests pass through unchanged (forward compatibility).
- **Plugin seeding** (`resolveSeedPlugins`): fresh install → non-optional workflow plugins preselected, empty language list. Old manifest (no `knownPlugins`) → split existing into workflow/language buckets, adopt nothing. Re-init with `knownPlugins` → split plus adopt newly-added non-optional selectable plugins not in `knownPlugins`.
- **Install-time plugin resolution** (`resolvePluginsToInstall(selectedPlugins, ambientEnabled, allPlugins)`, pure): the ONE function turning a selection into the list `installViaFileCopy` installs. An empty selection (a fresh non-interactive install) → every non-optional plugin EXCEPT `devflow-ambient`; a non-empty selection is filtered to it as-is. `devflow-core-skills` is force-included whenever the list is non-empty. `devflow-ambient` is added iff `ambientEnabled`, on every path (`D-AMBIENT-FOLLOWS-SWITCH`). Before the fix the default branch took ambient too, so a first `init --no-ambient` recorded it anyway and the NEXT re-init (correctly seeded without it) appeared to drop it: the first install was the wrong one. Pinned by the all-off install-snapshot golden's argv coverage (`test-harness` KB) and a dedicated `--no-ambient` unit test held to every `--no-*` init switch.
- **Reset gate** (`resolveResetGatedInputs`): `--reset` zeroes `seedManifest`, `seedConfig` AND `seedSettings`. Only `seedManifest` and `seedSettings` feed `resolveInitSeed`; `seedConfig` survives solely to seed `reviewPublication` at the managed-config write site (`seedConfig?.reviewPublication ?? DEFAULT_CONFIG.reviewPublication`).
- **View-mode resolution:** `resolveInitSeed` resolves in three priorities — (1) `resolveExistingViewMode(settingsSnapshot)` (a non-`'default'` value from current `settings.json` wins; it returns `undefined` for `'default'` so the `??` chain falls through); (2) `readViewMode(flags)` from the spread manifest record (non-`'default'` wins); (3) `'default'`. Both resolvers live in `src/core/flags.ts`.
- **suppress-attribution resolution** (`resolveExistingAttributionSuppression`): an exported pure one-liner returning `settingHoldsManagedShape(settingsSnapshot, 'suppress-attribution') ? true : undefined` (type `true | undefined`), delegating to the single equality oracle (wizard-flags KB). Priority in `resolveInitSeed`: (1) the exact shape on disk → `true`; (2) `flags['suppress-attribution']` from the manifest record; (3) `false`. The fold uses `=== true`. `--reset` zeroes the snapshot and manifest, so a factory reset always resolves `false`.
- **CLI toggles** (`applyCliToggles`): explicit feature flags (`--no-learning`, `--proxy`, `--tracker <id>`) applied on top of the seed; undefined means not specified and the seed value is kept.
- **Flags applied non-interactively (D40):** after `applyCliToggles`, `init.ts` applies `enabledFlags` directly. Fresh install: all registry flags at `defaultValue`. Re-init: spread the manifest record, adopt defaults only for absent flags. Outcome line: `Flags: ${activeCount} active — customize any time with 'devflow flags'`. `getDefaultFlagsRecord` is not imported by `init.ts`; `viewModeExplicit` is exclusively `!!options.reset`.

## Manifest Snapshots (`src/core/manifest.ts`)

- `ManifestData.features.flags: FlagsRecord` — key-presence = known to this install; `null` = deliberately unset/neutral; absent key = adopt on next init. It replaced the former `knownFlags: string[]`. `parseManifestFlags(features, knownFlags)` handles three on-disk shapes: A — legacy `string[]`, migrated by `migrateLegacyFlagsToRecord` (folding in the separate `features.viewMode`), reports `legacy: true`; B — an object, already a `FlagsRecord`, spread into a fresh record (no mutation), `legacy: false`; C — missing/other, an empty record. The legacy `features.knownFlags` is read only to feed Case A and is NOT carried into `ManifestData`. `readManifest` then runs `sanitizeFlagsRecord` (values back through `coerceFlagValue`) as defence against schema drift.
- `ManifestData.knownPlugins?: string[]` — all `DEVFLOW_PLUGINS` names at the last install. Absent in older manifests; `readManifest` self-heals through a local `asStringArray` (every element must be a string; a mixed/garbage array self-heals to `undefined`). It is a top-level field.
- `ManifestData.features.proxy: boolean` — whether external model routing was enabled at the last install; self-heals to `false`. The written value is the **final resolved value after preflight**.
- Machine switches: `ambient`, `hud`, `rules`, `proxy`, `compliance`, `memory`, `learning`, `knowledge` and `tracker` are all manifest-group and machine-wide. `memory` / `learning` / `knowledge` can only be narrowed per repository by `features.<x>: false` in `.devflow/project.json` / `config.json` (`D-FEATURES-NARROW-ONLY`; mechanics in the `learning-capture-system` KB). `readManifest` treats absent `knowledge` / `learning` (with no legacy `kb` / `decisions` key) as `true` (`D-FEATURES-ABSENT-ON`). The tracker group's self-heal and its hard-null exemption are in the tracker-wiring KB.
- `resolvePluginList` (manifest.ts) filters `DELETED_PLUGIN_NAMES` in memory (hub KB).

## Managed Per-Repo Config Write (`src/core/feature-config.ts`, `D-CONFIG-PRESERVE-UNMANAGED`)

`.devflow/config.json` is user-editable and almost entirely NOT Devflow's: `FeatureConfig` holds `reviewPublication` (Devflow-managed) and an optional hand-written per-repo `tracker` override (`TrackerConfigOverride`, never Devflow-written), plus whatever keys a user adds. `memory`, `learning` and `knowledge` are machine switches in `~/.devflow/manifest.json` (`D-FEATURES-NARROW-ONLY`), narrowed by a repository only through the `features` namespace — a per-repo config gate for a feature every OTHER repo shares was the root cause of the report that one repo's `--disable` looked like it worked while every other repo kept the feature running. Their retired per-repo keys are `RETIRED_CONFIG_KEYS` (`memory`, `learning`, `knowledge`, plus the pre-rename `decisions` and the inert `autoCommit`), dropped on the next managed write, never carried, never read by any gate.

`mergeManagedConfig(existing, managed: ManagedConfig)` is the single merge site: it starts from every key the file already has, drops `RETIRED_CONFIG_KEYS`, then overwrites only `reviewPublication` by name (`ManagedConfig = Omit<FeatureConfig, 'tracker'>`). `writeManagedConfig` (init's entry point) is the ONLY production caller — there is no full-file writer, and no per-repo toggle command writes this file (`devflow memory|learning|knowledge --enable/--disable` write `~/.devflow/manifest.json` via `writeMachineFeature`). The merge holds under `--reset`, which restores `reviewPublication` to `'auto'` through `managed` and leaves the rest alone.
- **Strict parse (`D-CONFIG-STRICT-PARSE`, `D-CONFIG-NO-REPAIR`):** `writeManagedConfig` judges the file with the resolvers' strict parser (`lib/project-config.cjs`, loaded through `loadProjectConfigLib`): a malformed, duplicate-key or unreadable file is left byte for byte and a Result names why for init to print as a warning. A bare `JSON.parse` once read a syntax error as empty and the rewrite deleted the user's tracker override.
- **Links (`D-CLI-NO-SYMLINK`):** it reads and writes nothing under a `.devflow` that is a symbolic link; its temp copy is created with `wx` (an entry already at that name is never written through) and removed again when a later write, close or rename fails; the Result names why (link rules: `learning-capture-system` KB).
- `readConfig` always returns a config (falling back to `DEFAULT_CONFIG`); `readConfigIfPresent` returns `null` when absent or malformed, so seeding can tell "not configured yet" from "configured with specific values".

## Disabled-Feature Drain and `--hud-only` (`init.ts`)

`drainDisabledFeatureQueues(opts, io?)` (`D-INIT-DRAIN-AFTER-SWITCH`) drains this repo's memory and/or learning queue for any feature init just switched OFF — the same drain `devflow memory --disable` / `devflow learning --disable` perform. It runs ONLY after `persistManifestThenConvergeTracker` reports `manifestWritten: true`: draining first opens a window where a concurrent session, still reading the old "on" value, appends turns that then survive the disable; a failed manifest write leaves the feature on everywhere, so its queue is correctly left alone. Other repos need no drain: every gate reads the one machine-wide switch, so nothing appends to or processes an inert queue. It takes an injectable `DisabledQueueDrainIO` seam. A drain refused because `.devflow` or the queue's folder is a symbolic link deletes nothing and comes back as a warning init prints (`D-CLI-NO-SYMLINK`).

`buildHudOnlyManifest(existing, version, now)` (`D-HUD-ONLY-PRESERVE`) is the manifest `--hud-only` writes: pure, and over a prior install it keeps EVERY recorded value (plugins, version, scope, installedAt, every other feature) and flips only `features.hud`. Rewriting it as a fresh HUD-only install (every other feature `false`, `plugins: []`) left those features' artifacts on disk while, with memory/learning/knowledge switched by the manifest alone, silently disabling them machine-wide. With no prior manifest the fresh HUD-only record is exactly what gets installed.

## Proxy Preflight and `reapplyAgentMapping` Ordering (`init.ts`)

When `proxyEnabled` is true entering the install apply pass, `runProxyPreflight` runs **before** the settings mutation block (`buildRealPreflightDeps`, `swallowSettingsReadError: true`). A failed preflight emits `p.log.warn` and forces `proxyEnabled = false` without aborting init. `reapplyAgentMapping` runs **after** the preflight block — load-bearing, since GPT model assignments materialise in agent frontmatter only while proxy is enabled and it must use the final value. **Init-only optimisation:** the call is skipped when `readAgentMapping` returns an empty agents map AND `proxyEnabled` is false (pinned by `tests/init-proxy.test.ts`). The learning converge runs earlier, straight after the file copy, and already carries each agent's `model:`/`effort:` into the variant it writes, so this later reapply is the authority behind that carry (learning-variants KB).

## Other Init Behaviours

- **Atomic settings writes (`D-SETTINGS-ATOMIC`):** init, the toggles, debug and uninstall write `settings.json` through `writeSettingsFileAtomic` (`src/core/fs-atomic.ts`): a sibling temp file renamed into place, and for a symlinked `settings.json` the file the link resolves to, so a dotfiles-managed link survives. `tests/guards/settings-atomic-write.test.ts` holds `src/` to the one helper. `devflow debug` rejects a present `env` that is not an object (`D-DEBUG-ENV-OBJECT`) rather than writing a key `JSON.stringify` drops.
- **Not at HOME (`D-INIT-NOT-HOME`):** a git root whose realpath is HOME's (a dotfiles repository; `isSameLocation` in `src/core/same-location.ts`, shared with uninstall) is treated as no repository: no `.devflow/config.json` (which would land in the machine root), no `.claudeignore`, no `.gitignore` block, no per-project migration or queue drain, HOME dropped from the discovered `.claudeignore` targets, and one notice. `tests/init-location-invariance.test.ts` pins it as one of its covered locations.
- **Downgrade warning (`D-INIT-DOWNGRADE-WARN`):** `formatDowngradeWarning` fires when the manifest names a newer version than the running CLI, naming both and `npx devflow-kit@latest init`; it does not block.
- **Real outcomes (`D-INIT-REAL-OUTCOME`):** the Recommended summary's `.claudeignore` row reads `created`, `already present` or `skipped` (`resolveClaudeignoreOutcome`, over the same `projectRoots` the install writes to), and the safe-delete lines read installed, upgraded or already configured (`SafeDeleteAction`, `formatSafeDeleteStatus`); a hint names only a step left to the user.
- **Re-init is idempotent:** the `re-init` section of the `tests/install-snapshot.test.ts` goldens pins an empty diff against the first init. Three bugs it caught before any scope code changed: `D-SCRIPTS-EXEC-SCOPE` (hub KB), `D-KEY-ORDER` (wizard-flags KB) and `D-AMBIENT-FOLLOWS-SWITCH` (above). The frozen machine-wide snapshot is the regression net for the one-install-scope model.

## Migrations (`src/core/migrations.ts`)

The `MIGRATIONS` registry (typed `readonly AnyMigration[]`) has two global entries: `canonicalise-agent-keys-v1`, which renames legacy keys in `~/.devflow/agent-models.json` to their canonical names, and `tracker-conventions-per-provider-v1`, which moves a legacy `~/.devflow/tracker.md` to `~/.devflow/tracker/{provider}.md` by its frontmatter provider through `migrateLegacyTrackerConventions` (`src/core/tracker.ts`; `fs.rename`, so a symlink moves itself; never overwrites; a file with no registry provider stays in place with one warning; the legacy single counter is removed). Its I/O failure THROWS, so the runner does not mark it applied and retries it on the next init.
- **`AnyMigration`** is the discriminated union `Migration<'global'> | Migration<'per-project'>`, so TypeScript narrows `run()` by `scope` and no `as Migration<'global'>` cast is needed.
- **`canonicaliseAgentKeys`** returns `{ agents, didMutate, renamed, dropped, guardDropped }`: which keys were renamed, dropped (canonical key already present, old value discarded) and guard-dropped (prototype-pollution guard). `run()` is one linear flow: parse → canonicalise → write → report.
- **Shared envelope parser:** `parseAgentMappingEnvelope(filePath)` from `agent-models.ts` (I/O, BOM-strip, JSON parse, shape validation) serves both `readAgentMapping` (in-memory canonicalisation) and the migration (disk rewrite).
- **Failure modes:** `runGlobalMigration` marks a migration applied for ANY non-throwing return. `canonicalise-agent-keys-v1` catches all I/O failures and returns them as `warnings`, so a failed write is silently marked applied and never retried. Net impact is low: `readAgentMapping` canonicalises on EVERY read, so the disk file self-heals on the next write. The reverse hazard is known too: the runner retries a THROWING migration on every `devflow init` forever, with no cap or backoff, which is bounded for the tracker entry by what can fail (a rename and an rm inside `~/.devflow`). A future fix should make genuine I/O failure (as distinct from "malformed file, skip it") throw. `migrations.json` is removed by `removeDevFlowInstallArtifacts`, so migrations re-run cleanly on reinstall.

## Anti-Patterns

- **KB-AP-1** `--reset --plugin` is rejected before reaching seed resolution.
- **KB-AP-2** The correct invariant: an absent key from an old manifest adopts the registry default (whatever it is); a `null` value is deliberately unset.
- **KB-AP-3** Running the mapping earlier materialises GPT model lines after a failed preflight, breaking the dormancy invariant.
- **KB-AP-4** Including ambient unconditionally on the default branch makes the first install wrong and the correctly-seeded re-init look like the one that dropped it.
- **KB-AP-5, KB-AP-9** A full-file overwrite, or a "repair" of a file the strict parser rejects, destroys user-authored content; the merge keeps unmanaged keys and the strict parser stops the write.
- **KB-AP-7** The drain waits for `manifestWritten: true`.

## Gotchas

- **KB-INV-8** `canonicalise-agent-keys-v1`'s failure mode is silent (see Migrations); `readAgentMapping`'s in-memory canonicalisation is the safety net.
- **KB-INV-2** `knownPlugins` is top-level; the `knownFlags` array no longer exists in `ManifestData`.
- **KB-AP-6** `resolveSeedFeatures` takes only a `ManifestData | null`; seeding any `FeatureSeed` key from `readConfigIfPresent` is the regression that let one repo's `--no-learning` look successful while the manifest kept the old value.
- **`resolveExistingViewMode` returns `undefined` for `'default'`:** the literal is treated as "no opinion" so the `??` chain falls through.
- **Wizard-gate and prompt-IO facts** live in the wizard-flags and tracker-wiring KBs; init calls each gate with the same shape so the two paths cannot drift.

## Key Files

- `src/cli/commands/init.ts` — consumes `InstallReport` and `InitSeed`; the proxy preflight block and `reapplyAgentMapping` call (ordering load-bearing); the exhaustive `ShadowSkipReason` switch; `formatSweepSummary`; `drainDisabledFeatureQueues` / `DisabledQueueDrainIO`; `buildHudOnlyManifest`; `persistManifestThenConvergeTracker`; `formatDowngradeWarning`; `resolveClaudeignoreOutcome`; passes `learning: learningEnabled` to `installViaFileCopy` and calls `convergeLearningVariants` straight after it
- `src/cli/commands/init-seed.ts` — `resolveInitSeed`, `resolveSeedFeatures`, `resolveSeedFlags`, `resolveSeedPlugins`, `resolvePluginsToInstall`, `resolveResetGatedInputs`, `applyCliToggles`, `FEATURE_DEFAULTS`, `resolveExistingAttributionSuppression`, `InitSeed`, `FeatureSeed`
- `src/core/manifest.ts` — `ManifestData`, `parseManifestFlags`, `readManifest` (self-heals), `writeManifest`, `syncManifestFeature`, `resolvePluginList`
- `src/core/feature-config.ts` — `FeatureConfig`, `DEFAULT_CONFIG`, `readConfig`, `readConfigIfPresent`, `writeManagedConfig`, `mergeManagedConfig`, `ManagedConfig`, `RETIRED_CONFIG_KEYS`, `classifyConfigBytes`
- `src/core/migrations.ts` — `MIGRATIONS`, `AnyMigration`, `canonicaliseAgentKeys`, `runGlobalMigration`
- `src/cli/commands/proxy.ts` — `applyDisableToSettings`, `buildRealPreflightDeps`, `addProxyHooks`, `removeProxyHooks`, `applyProxyEnv`, `stripProxyEnv`
- `src/core/fs-atomic.ts` — `writeSettingsFileAtomic`, `writeFileAtomicExclusive`
- `src/core/feature-switch.ts` — the machine feature switch (owned by `learning-capture-system`)
- `tests/install-snapshot.test.ts`, `tests/init-location-invariance.test.ts`, `tests/init-proxy.test.ts`, `tests/guards/settings-atomic-write.test.ts` — the re-init, location, ordering and atomic-write pins

## Related

- `.devflow/features/installer-shadowing/KNOWLEDGE.md` — hub: install pipeline and the symbol split `resolvePluginList` uses
- `.devflow/features/installer-shadowing-wizard-flags/KNOWLEDGE.md` — wizard gates, prompt IO, flags pipeline and the managed-shape oracle seeding delegates to
- `.devflow/features/installer-shadowing-tracker-wiring/KNOWLEDGE.md` — the tracker group of the manifest and init's tracker convergence
- `.devflow/features/installer-shadowing-learning-variants/KNOWLEDGE.md` — the converge that runs straight after the file copy
- `.devflow/features/installer-shadowing-init-artifacts/KNOWLEDGE.md` — the `.gitignore` block init writes and the audit step init prints
- `.devflow/features/installer-shadowing-uninstall/KNOWLEDGE.md` — the inverse boundaries (artifacts vs user content)
- `.devflow/features/external-model-routing/KNOWLEDGE.md` — proxy lifecycle, preflight protocol, agent frontmatter rewriting
- `.devflow/features/learning-capture-system/KNOWLEDGE.md` — the machine feature-switch mechanism (`isMachineFeatureOn`, `readMachineFeature`, `writeMachineFeature`, `setMachineFeature` in `src/core/feature-switch.ts`, the shell-hook gate `queue_read_gates`, `D-FEATURES-ABSENT-ON` absent-key semantics), narrow-only repository switches and link rules; this KB covers how init seeds against, writes and drains around that switch
- `.devflow/features/test-harness/KNOWLEDGE.md` — install-snapshot capture and normalisation
