/**
 * Pure seeding helpers for devflow init.
 *
 * Computes the initial state (seed) for init prompts from:
 * - The existing manifest (from a prior install)
 * - The project feature config (.devflow/config.json)
 * - The current settings.json snapshot (for viewMode)
 * - The plugin registry
 *
 * All exported functions are pure — no I/O, no side effects.
 *
 * Applies ADR-013: seeding helpers are CLI-init-specific logic, so they live
 * beside init.ts in src/cli/commands/ rather than in src/core/ (which holds
 * agent-neutral, target-agnostic utilities).
 */

import { resolveExistingViewMode, FLAG_REGISTRY, type ClaudeCodeFlag, type ViewMode } from '../../core/flags.js';
import { type FeatureConfig } from '../../core/feature-config.js';
import { type ManifestData } from '../../core/manifest.js';
import { partitionSelectablePlugins, type PluginDefinition } from '../../core/plugins.js';

// ── Types ─────────────────────────────────────────────────────────────────────

/** Per-feature boolean state for the init seed. */
export interface FeatureSeed {
  ambient: boolean;
  memory: boolean;
  hud: boolean;
  knowledge: boolean;
  learning: boolean;
  rules: boolean;
}

/** Registry defaults — all features enabled. Used for fresh installs. */
export const FEATURE_DEFAULTS: FeatureSeed = {
  ambient: true,
  memory: true,
  hud: true,
  knowledge: true,
  learning: true,
  rules: true,
};

/** The complete initial state passed from the hoisted-reads block to init prompts. */
export interface InitSeed {
  features: FeatureSeed;
  flags: string[];
  viewMode: ViewMode;
  workflowPlugins: string[];
  languagePlugins: string[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Resolve feature booleans for the init seed.
 *
 * - memory / learning / knowledge come from projectConfig WHENEVER present,
 *   independent of whether a manifest exists (covers config-present /
 *   manifest-missing cases such as a fresh project with a prior learning run).
 * - ambient / hud / rules come from manifest.features; registry defaults
 *   (all true) are used when the manifest is absent.
 *
 * Applies ADR-001: .devflow/config.json is the source of truth for
 * memory/learning/knowledge; manifest reflects the last install choices for
 * the remaining toggles.
 */
export function resolveSeedFeatures(
  manifest: ManifestData | null,
  projectConfig: FeatureConfig | null,
): FeatureSeed {
  // ambient/hud/rules: manifest is the source; fall back to registry defaults
  const ambient = manifest?.features.ambient ?? FEATURE_DEFAULTS.ambient;
  const hud = manifest?.features.hud ?? FEATURE_DEFAULTS.hud;
  const rules = manifest?.features.rules ?? FEATURE_DEFAULTS.rules;

  // memory/learning/knowledge: projectConfig wins whenever present (ADR-001).
  // Helper eliminates the repeated projectConfig !== null ternary pattern.
  const fromConfig = (key: 'memory' | 'knowledge' | 'learning'): boolean =>
    projectConfig !== null
      ? projectConfig[key]
      : (manifest?.features[key] ?? FEATURE_DEFAULTS[key]);

  const memory = fromConfig('memory');
  const knowledge = fromConfig('knowledge');
  const learning = fromConfig('learning');

  return { ambient, memory, hud, knowledge, learning, rules };
}

/**
 * Resolve the enabled flag set for the init seed.
 *
 * @param enabledFlags - Currently-enabled flag IDs from the manifest,
 *                       or null for a fresh install (no prior manifest).
 * @param knownFlags   - Snapshot of all flag IDs known at the last install
 *                       (manifest.features.knownFlags), or undefined when
 *                       the manifest pre-dates the snapshot feature.
 * @param registry     - Flag registry to consult; injectable for tests.
 *
 * Rules:
 *   - null enabledFlags (fresh) → all default-ON flags in the registry
 *   - knownFlags === undefined (old manifest, migration) → return enabledFlags
 *     as-is; adopt nothing new (safe: user's prior choices preserved)
 *   - Otherwise → enabledFlags ∪ {default-ON flags whose id ∉ knownFlags}
 *     (newly added registry entries that the user never saw before are auto-adopted)
 *   - Default-OFF flags are NEVER auto-added regardless of knownFlags
 */
export function resolveSeedFlags(
  enabledFlags: string[] | null,
  knownFlags: string[] | undefined,
  registry: readonly ClaudeCodeFlag[] = FLAG_REGISTRY,
): string[] {
  // Fresh install → all default-ON flags from the registry
  if (enabledFlags === null) {
    return registry.filter(f => f.defaultEnabled).map(f => f.id);
  }

  // Old manifest without a knownFlags snapshot → adopt nothing new
  if (knownFlags === undefined) {
    return [...enabledFlags];
  }

  // Re-init with a knownFlags snapshot: union existing + newly-added default-ON entries
  const knownSet = new Set(knownFlags);
  const result = new Set(enabledFlags);
  for (const flag of registry) {
    if (flag.defaultEnabled && !knownSet.has(flag.id)) {
      result.add(flag.id);
    }
  }
  return [...result];
}

/**
 * Resolve the plugin selection buckets for the init seed.
 *
 * @param manifestPlugins - Plugin names stored in the existing manifest,
 *                          or null for a fresh install.
 * @param knownPlugins    - Plugin name snapshot from the last install
 *                          (manifest.knownPlugins), or undefined when the
 *                          manifest pre-dates the snapshot feature.
 * @param allPlugins      - Full plugin registry.
 *
 * Rules:
 *   - null manifestPlugins (fresh) → non-optional workflow plugins preselected,
 *     empty language list (matches current init UI defaults)
 *   - knownPlugins === undefined → split existing into workflow/language buckets,
 *     adopt nothing new
 *   - Otherwise → split + adopt newly-added non-optional selectable plugins
 *     whose name is ∉ knownPlugins and ∉ manifestPlugins
 *
 * Always-installed plugins (devflow-core-skills, devflow-ambient) and
 * non-selectable optional plugins (devflow-audit-claude) are filtered out by
 * partitionSelectablePlugins and never appear in the returned buckets.
 */
export function resolveSeedPlugins(
  manifestPlugins: string[] | null,
  knownPlugins: string[] | undefined,
  allPlugins: PluginDefinition[],
): { workflowPlugins: string[]; languagePlugins: string[] } {
  const { workflow, language } = partitionSelectablePlugins(allPlugins);
  const workflowNames = new Set(workflow.map(p => p.name));
  const languageNames = new Set(language.map(p => p.name));

  // Fresh install → non-optional workflow plugins preselected, empty language
  if (manifestPlugins === null) {
    return {
      workflowPlugins: workflow.filter(p => !p.optional).map(p => p.name),
      languagePlugins: [],
    };
  }

  // Split existing manifest plugins into the selectable buckets
  const workflowPlugins = manifestPlugins.filter(n => workflowNames.has(n));
  const languagePlugins = manifestPlugins.filter(n => languageNames.has(n));

  // Old manifest (no knownPlugins snapshot) → adopt nothing new
  if (knownPlugins === undefined) {
    return { workflowPlugins, languagePlugins };
  }

  // Re-init with a knownPlugins snapshot: adopt new non-optional selectable plugins
  const knownSet = new Set(knownPlugins);
  const manifestSet = new Set(manifestPlugins);

  for (const plugin of allPlugins) {
    if (plugin.optional) continue;            // never auto-adopt optional plugins
    if (knownSet.has(plugin.name)) continue;  // was known at last install
    if (manifestSet.has(plugin.name)) continue; // already in the selection

    if (workflowNames.has(plugin.name)) {
      workflowPlugins.push(plugin.name);
    } else if (languageNames.has(plugin.name)) {
      languagePlugins.push(plugin.name);
    }
    // excluded always-installed plugins: neither bucket — silently ignored
  }

  return { workflowPlugins, languagePlugins };
}

/**
 * Compose the full init seed from manifest, project config, settings, and registry.
 *
 * viewMode priority: existing settings.json (non-default) → manifest → 'default'
 *
 * This is the single composition point; callers (init.ts hoist block) call this
 * once and pass `seed` down to Phase 4's prompt wiring.
 */
export function resolveInitSeed(
  seedManifest: ManifestData | null,
  seedConfig: FeatureConfig | null,
  settingsSnapshot: string,
  plugins: PluginDefinition[],
): InitSeed {
  const features = resolveSeedFeatures(seedManifest, seedConfig);

  // null for a fresh install (no manifest); string[] from manifest otherwise
  const enabledFlags: string[] | null = seedManifest !== null ? seedManifest.features.flags : null;
  const flags = resolveSeedFlags(enabledFlags, seedManifest?.features.knownFlags);

  const manifestPlugins: string[] | null = seedManifest !== null ? seedManifest.plugins : null;
  const { workflowPlugins, languagePlugins } = resolveSeedPlugins(
    manifestPlugins, seedManifest?.knownPlugins, plugins,
  );

  // viewMode: non-default setting wins; else manifest; else 'default'
  const viewMode: ViewMode =
    resolveExistingViewMode(settingsSnapshot) ??
    seedManifest?.features.viewMode ??
    'default';

  return { features, flags, viewMode, workflowPlugins, languagePlugins };
}

/**
 * Resolve the three seed inputs under the --reset gate.
 *
 * --reset is a factory reset: the prior manifest, the prior project config, AND
 * the current settings.json snapshot are all discarded so the seed collapses to
 * registry defaults. Emptying the settings snapshot is essential — otherwise
 * resolveInitSeed's viewMode resolution would surface an externally-set value
 * (e.g. a /focus mode persisted in settings.json) and defeat the reset. This
 * keeps --reset faithful to its USER-LOCKED contract: viewMode is forced to
 * 'default'.
 *
 * The caller must still use the REAL (un-emptied) settings/manifest elsewhere —
 * e.g. for security deny-state detection and installedAt preservation. This
 * helper only shapes the inputs handed to resolveInitSeed.
 *
 * Pure function — no I/O, no side effects.
 */
export function resolveResetGatedInputs(
  reset: boolean,
  manifest: ManifestData | null,
  projectConfig: FeatureConfig | null,
  settingsJson: string,
): { seedManifest: ManifestData | null; seedConfig: FeatureConfig | null; seedSettings: string } {
  if (reset) {
    return { seedManifest: null, seedConfig: null, seedSettings: '' };
  }
  return { seedManifest: manifest, seedConfig: projectConfig, seedSettings: settingsJson };
}

/**
 * Identify non-selectable optional plugins from the prior manifest that should be
 * carried forward on a plugin-less full re-init.
 *
 * Non-selectable optional plugins (e.g. devflow-audit-claude) are excluded from
 * the init prompt buckets by partitionSelectablePlugins and therefore never appear
 * in the seed's workflowPlugins/languagePlugins. Without an explicit carry, a
 * plugin-less full re-init would silently drop them — violating the
 * "re-init preserves all existing state" acceptance criterion.
 *
 * Rules:
 *   - null manifestPlugins (fresh install OR --reset) → empty carry set
 *   - Otherwise: carry set = manifestPlugins ∩ optional ∩ not-in-selectable-buckets
 *   - Unknown/stale names (not in allPlugins) are excluded
 *
 * The caller is responsible for injecting the carry set into pluginsToInstall only
 * on full (plugin-less) re-inits. Partial installs (--plugin flag) already merge
 * via resolvePluginList. --reset produces null seedManifest → null manifestPlugins
 * so the carry is empty by construction (factory reset drops them, as intended).
 *
 * Pure function — no I/O, no side effects.
 */
export function resolveNonSelectableOptionalCarry(
  manifestPlugins: string[] | null,
  allPlugins: PluginDefinition[],
): string[] {
  if (manifestPlugins === null || manifestPlugins.length === 0) return [];

  const { workflow, language } = partitionSelectablePlugins(allPlugins);
  const selectableNames = new Set([
    ...workflow.map(p => p.name),
    ...language.map(p => p.name),
  ]);

  // Build a name→plugin Map for O(1) lookup, replacing an O(n·m) find-in-filter.
  const pluginMap = new Map(allPlugins.map(p => [p.name, p]));

  // Carry only OPTIONAL non-selectable plugins that exist in the registry.
  // Non-optional always-installed plugins (core-skills, ambient) are excluded —
  // they are guaranteed to be in pluginsToInstall by other mechanisms.
  return manifestPlugins.filter(name => {
    const plugin = pluginMap.get(name);
    return plugin !== undefined && plugin.optional && !selectableNames.has(name);
  });
}

/**
 * Apply the non-selectable optional plugin carry on a full (plugin-less) re-init.
 *
 * Encapsulates the `!options.plugin` gate + resolveNonSelectableOptionalCarry call
 * + dedup-merge loop from initAction, extracted as a pure function to make the
 * carry wiring independently testable without spinning up the full init action.
 *
 * @param isPartialInstall - true when --plugin was passed (carry is skipped)
 * @param manifestPlugins  - Plugin list from seedManifest (null on fresh/--reset)
 * @param pluginsToInstall - Current install list (not mutated; returns new array)
 * @param allPlugins       - Full plugin registry
 * @returns Updated plugin list with carry plugins merged in (deduped, order preserved)
 *
 * Pure function — no I/O, no side effects.
 */
export function applyNonSelectableCarry(
  isPartialInstall: boolean,
  manifestPlugins: string[] | null,
  pluginsToInstall: PluginDefinition[],
  allPlugins: PluginDefinition[],
): PluginDefinition[] {
  if (isPartialInstall) return pluginsToInstall;
  const carryNames = resolveNonSelectableOptionalCarry(manifestPlugins, allPlugins);
  const result = [...pluginsToInstall];
  for (const name of carryNames) {
    const plugin = allPlugins.find(p => p.name === name);
    if (plugin && !result.includes(plugin)) {
      result.push(plugin);
    }
  }
  return result;
}

/**
 * Apply CLI-explicit feature toggles on top of a seed's features.
 *
 * Per-key: `toggles.X ?? base.X` — an explicit CLI value (true/false) wins;
 * undefined means "user did not specify this flag, keep the seed value".
 *
 * Used in Phase 4 to honour --ambient/--no-ambient etc. passed alongside
 * --recommended.
 */
export function applyCliToggles(
  base: FeatureSeed,
  toggles: Partial<FeatureSeed>,
): FeatureSeed {
  return {
    ambient: toggles.ambient ?? base.ambient,
    memory: toggles.memory ?? base.memory,
    hud: toggles.hud ?? base.hud,
    knowledge: toggles.knowledge ?? base.knowledge,
    learning: toggles.learning ?? base.learning,
    rules: toggles.rules ?? base.rules,
  };
}
