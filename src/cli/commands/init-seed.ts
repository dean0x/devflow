/**
 * Pure seeding helpers for devflow init.
 *
 * Computes the initial state (seed) for init prompts from:
 * - The existing manifest (from a prior install)
 * - The project feature config (.devflow/config.json)
 * - The current settings.json snapshot (for view-mode resolution)
 * - The plugin registry
 *
 * All exported functions are pure — no I/O, no side effects.
 *
 * Applies ADR-013: seeding helpers are CLI-init-specific logic, so they live
 * beside init.ts in src/cli/commands/ rather than in src/core/ (which holds
 * agent-neutral, target-agnostic utilities).
 */

import {
  resolveExistingViewMode,
  FLAG_REGISTRY,
  defaultValueOf,
  readViewMode,
  type ClaudeCodeFlag,
  type FlagsRecord,
  type ViewMode,
} from '../../core/flags.js';
import { type FeatureConfig } from '../../core/feature-config.js';
import { type ManifestData } from '../../core/manifest.js';
import { partitionSelectablePlugins, type PluginDefinition } from '../../core/plugins.js';
import { type ComplianceFeatureState } from '../../core/compliance.js';

// ── Types ─────────────────────────────────────────────────────────────────────

/** Per-feature boolean state for the init seed. */
export interface FeatureSeed {
  ambient: boolean;
  memory: boolean;
  hud: boolean;
  knowledge: boolean;
  learning: boolean;
  rules: boolean;
  /** External model routing. Advanced-init only; never part of Recommended defaults. */
  proxy: boolean;
  /**
   * Compliance feature seed — seeded from the manifest (manifest-group, like proxy).
   * Default: {enabled:false, frameworks:[]} — compliance is opt-in, never auto-enabled.
   */
  compliance: ComplianceFeatureState;
}

/** Registry defaults — all features enabled except proxy (advanced-only, off by default). */
export const FEATURE_DEFAULTS: FeatureSeed = {
  ambient: true,
  memory: true,
  hud: true,
  knowledge: true,
  learning: true,
  rules: true,
  proxy: false,
  compliance: { enabled: false, frameworks: [] },
};

/** The complete initial state passed from the hoisted-reads block to init prompts. */
export interface InitSeed {
  features: FeatureSeed;
  /** FlagsRecord with all registry flags at their resolved values. view-mode is encoded here. */
  flags: FlagsRecord;
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
  // ambient/hud/rules/proxy/compliance: manifest is the source; fall back to registry defaults.
  // proxy and compliance follow the manifest group (like ambient) per ADR-001 — NOT config.json-gated.
  const ambient = manifest?.features.ambient ?? FEATURE_DEFAULTS.ambient;
  const hud = manifest?.features.hud ?? FEATURE_DEFAULTS.hud;
  const rules = manifest?.features.rules ?? FEATURE_DEFAULTS.rules;
  const proxy = manifest?.features.proxy ?? FEATURE_DEFAULTS.proxy;
  // Return a fresh object so callers never hold a reference to FEATURE_DEFAULTS.compliance.
  // Without the spread, `manifest?.features.compliance ?? FEATURE_DEFAULTS.compliance` returns
  // the module-level default by reference — downstream mutation would corrupt it process-wide.
  const rawCompliance = manifest?.features.compliance ?? FEATURE_DEFAULTS.compliance;
  const compliance = { ...rawCompliance, frameworks: [...rawCompliance.frameworks] };

  // memory/learning/knowledge: projectConfig wins whenever present (ADR-001).
  // Helper eliminates the repeated projectConfig !== null ternary pattern.
  const fromConfig = (key: 'memory' | 'knowledge' | 'learning'): boolean =>
    projectConfig !== null
      ? projectConfig[key]
      : (manifest?.features[key] ?? FEATURE_DEFAULTS[key]);

  const memory = fromConfig('memory');
  const knowledge = fromConfig('knowledge');
  const learning = fromConfig('learning');

  return { ambient, memory, hud, knowledge, learning, rules, proxy, compliance };
}

/**
 * Resolve the flag record for the init seed.
 *
 * Returns a FlagsRecord containing ALL registry flags at their resolved values.
 * FlagsRecord key-presence encodes the "known" concept (ADR-014): present key =
 * known at last install, absent key = new to this install → adopt default on seed.
 *
 * @param manifestFlags - FlagsRecord from the manifest, or null for fresh install.
 * @param registry      - Flag registry to consult; injectable for tests.
 *
 * Rules:
 *   - null manifestFlags (fresh install) → all flags at registry defaults
 *   - Entry present                      → keep (coerceFlagValue is applied at read
 *                                          time via sanitizeFlagsRecord; PF-023)
 *   - Entry absent                       → adopt registry default (ADR-014)
 *   - Unknown IDs from old manifest      → pass through unchanged (forward-compat)
 *
 * Applies ADR-014: absent key = unknown to this install → adopt default.
 * view-mode is not set here; resolveInitSeed sets flags['view-mode'] after composing.
 */
export function resolveSeedFlags(
  manifestFlags: FlagsRecord | null,
  registry: readonly ClaudeCodeFlag[] = FLAG_REGISTRY,
): FlagsRecord {
  // Fresh install → all flags at registry defaults
  if (manifestFlags === null) {
    const result: FlagsRecord = {};
    for (const flag of registry) {
      result[flag.id] = defaultValueOf(flag); // single default-rule source (CONS-M2)
    }
    return result;
  }

  // Existing install: copy present entries then adopt defaults for absent flags.
  // Unknown IDs from the old manifest pass through unchanged (forward-compat).
  const result: FlagsRecord = { ...manifestFlags };
  for (const flag of registry) {
    if (flag.id in result) continue; // known → keep
    result[flag.id] = defaultValueOf(flag); // single default-rule source (CONS-M2)
  }
  return result;
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
 * Always-installed plugins (devflow-core-skills, devflow-ambient) are filtered
 * out by partitionSelectablePlugins and never appear in the returned buckets.
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
 * view-mode priority: existing settings.json (non-default) → manifest → 'default'.
 * The resolved view mode is encoded into flags['view-mode'] so all flag state lives
 * in one FlagsRecord (applying PF-015: fold before strip — the fold happens here).
 *
 * This is the single composition point; callers (init.ts hoist block) call this
 * once and pass `seed` down to prompt wiring.
 */
export function resolveInitSeed(
  seedManifest: ManifestData | null,
  seedConfig: FeatureConfig | null,
  settingsSnapshot: string,
  plugins: PluginDefinition[],
): InitSeed {
  const features = resolveSeedFeatures(seedManifest, seedConfig);

  // features.flags is FlagsRecord; null for fresh install (no manifest).
  // seedManifest?.features.flags may be absent at runtime on very old manifests not yet
  // healed — ?? null collapses to fresh-install behavior (all flags at registry defaults).
  const manifestFlags: FlagsRecord | null = seedManifest?.features.flags ?? null;
  const flags = resolveSeedFlags(manifestFlags);

  const manifestPlugins: string[] | null = seedManifest !== null ? seedManifest.plugins : null;
  const { workflowPlugins, languagePlugins } = resolveSeedPlugins(
    manifestPlugins, seedManifest?.knownPlugins, plugins,
  );

  // Encode the resolved view mode into flags['view-mode'] (PF-015: all flag state in FlagsRecord).
  // Priority: existing settings.json (non-default) → flags['view-mode'] from manifest → 'default'.
  // resolveExistingViewMode returns undefined when absent or 'default' — treated as no-opinion.
  const existingViewMode = resolveExistingViewMode(settingsSnapshot);
  const manifestViewMode = readViewMode(flags); // already in flags via resolveSeedFlags spread
  let resolvedViewMode: ViewMode;
  if (existingViewMode !== undefined) {
    resolvedViewMode = existingViewMode;        // settings.json non-default wins
  } else if (manifestViewMode !== 'default') {
    resolvedViewMode = manifestViewMode;        // manifest non-default wins
  } else {
    resolvedViewMode = 'default';              // fall back to neutral
  }

  // Return a fresh spread rather than mutating flags in place — keeps this function pure
  // per the module docblock and avoids aliasing if the caller inspects seed.flags.
  return { features, flags: { ...flags, 'view-mode': resolvedViewMode }, workflowPlugins, languagePlugins };
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
 * Apply CLI-explicit feature toggles on top of a seed's features.
 *
 * Per-key: `toggles.X ?? base.X` — an explicit CLI value (true/false) wins;
 * undefined means "user did not specify this flag, keep the seed value".
 *
 * Applies explicit --ambient/--no-ambient etc. passed alongside --recommended.
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
    proxy: toggles.proxy ?? base.proxy,
    compliance: toggles.compliance ?? base.compliance,
  };
}
