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

import {
  resolveExistingViewMode,
  FLAG_REGISTRY,
  coerceFlagValue,
  readViewMode,
  type ClaudeCodeFlag,
  type ViewMode,
  type FlagsRecord,
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
   * Full init wiring (framework multi-select, CLI toggle) is a later phase.
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
 * Resolve the enabled flag set for the init seed.
 *
 * Phase 2: accepts a FlagsRecord instead of the old (string[], knownFlags) pair.
 * FlagsRecord key-presence encodes the "known" concept: present key = known at
 * last install, absent key = new to this install (adopt on seed per ADR-014).
 *
 * @param manifestFlags - FlagsRecord from the manifest, or null for fresh install.
 * @param registry      - Flag registry to consult; injectable for tests.
 *
 * Rules (boolean flags only — non-boolean flags are not represented in string[]):
 *   - null manifestFlags (fresh install) → all default-ON boolean flags
 *   - Entry absent from record           → adopt registry default (if true → include)
 *   - Entry present (any value)          → coerceFlagValue; include iff coerced === true
 *                                          NEVER resurrect default for invalid/null (PF-023)
 *   - Unknown IDs with value === true    → included (forward-compat preservation)
 *
 * Applies ADR-014: absent key = unknown to this install → adoption on next seed.
 * Applies PF-023: sink-validation via coerceFlagValue — invalid → null, never default.
 *
 * @deprecated InitSeed.flags stays string[] as a Phase 6 bridge for init.ts. This
 * function produces the string[] from the FlagsRecord; Phase 6 will replace it.
 */
export function resolveSeedFlags(
  manifestFlags: FlagsRecord | null,
  registry: readonly ClaudeCodeFlag[] = FLAG_REGISTRY,
): string[] {
  // Fresh install → all default-ON boolean flags from registry
  if (manifestFlags === null) {
    return registry.filter(f => f.kind === 'boolean' && f.defaultValue === true).map(f => f.id);
  }

  const registryIds = new Set(registry.map(f => f.id));
  const result: string[] = [];

  for (const flag of registry) {
    if (flag.kind !== 'boolean') continue; // only boolean flags appear in string[] output

    if (flag.id in manifestFlags) {
      // Entry present (any value): coerce; include only if the result is true.
      // NEVER resurrect the registry default for null/invalid values (PF-023).
      const coerced = coerceFlagValue(flag, manifestFlags[flag.id]);
      if (coerced === true) result.push(flag.id);
      // false / null → not included (deliberate disable or neutral)
    } else {
      // Entry absent → adopt registry default (ADR-014: absent = new/unknown)
      if (flag.defaultValue === true) result.push(flag.id);
    }
  }

  // Unknown IDs (not in registry): pass through if truthy (forward-compat)
  for (const [id, value] of Object.entries(manifestFlags)) {
    if (!registryIds.has(id) && value === true) result.push(id);
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

  // Phase 2: features.flags is now FlagsRecord; null for fresh install (no manifest).
  // seedManifest?.features.flags is FlagsRecord at type level; may be absent at runtime
  // for very old manifests not yet healed — ?? null collapses to fresh-install behavior.
  const manifestFlags: FlagsRecord | null = seedManifest?.features.flags ?? null;
  const flags = resolveSeedFlags(manifestFlags);

  const manifestPlugins: string[] | null = seedManifest !== null ? seedManifest.plugins : null;
  const { workflowPlugins, languagePlugins } = resolveSeedPlugins(
    manifestPlugins, seedManifest?.knownPlugins, plugins,
  );

  // viewMode: non-default settings wins; else flags['view-mode']; else 'default'.
  // readViewMode returns 'default' when the entry is absent or null, so we treat
  // 'default' as no-opinion and fall through to the 'default' literal.
  // (deprecated seedManifest?.features.viewMode no longer consulted — Phase 6 removes it)
  const resolvedManifestViewMode = manifestFlags ? readViewMode(manifestFlags) : undefined;
  const viewMode: ViewMode =
    resolveExistingViewMode(settingsSnapshot) ??
    (resolvedManifestViewMode !== 'default' ? resolvedManifestViewMode : undefined) ??
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
    proxy: toggles.proxy ?? base.proxy,
    compliance: toggles.compliance ?? base.compliance,
  };
}
