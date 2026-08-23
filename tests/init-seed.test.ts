import { describe, it, expect } from 'vitest';
import {
  resolveSeedFeatures,
  resolveSeedFlags,
  resolveSeedPlugins,
  resolveInitSeed,
  applyCliToggles,
  resolveResetGatedInputs,
  FEATURE_DEFAULTS,
  type FeatureSeed,
} from '../src/cli/commands/init-seed.js';
import { DEVFLOW_PLUGINS } from '../src/core/plugins.js';
import { FLAG_REGISTRY, readViewMode, type ClaudeCodeFlag, type FlagsRecord } from '../src/core/flags.js';
import { type ManifestData } from '../src/core/manifest.js';

// ── Test fixtures ─────────────────────────────────────────────────────────────

/** Minimal valid manifest with all features enabled. */
function makeManifest(overrides: Partial<ManifestData> = {}): ManifestData {
  return {
    version: '2.0.0',
    plugins: ['devflow-implement', 'devflow-code-review'],
    scope: 'user',
    features: {
      ambient: true,
      memory: true,
      hud: true,
      knowledge: true,
      learning: true,
      rules: true,
      proxy: false,
      // Phase 2: FlagsRecord (was string[]); no deprecated viewMode field
      flags: { tui: true, lsp: true, 'tool-search': true },
    },
    installedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

// Synthetic flag registry for isolated flag tests (BooleanFlagDef shape post Phase 1)
const MOCK_FLAGS: ClaudeCodeFlag[] = [
  { kind: 'boolean', id: 'flag-a', label: 'A', description: '', hint: '', recommended: true, target: { type: 'setting', key: 'a' }, onPayload: true, defaultValue: true },
  { kind: 'boolean', id: 'flag-b', label: 'B', description: '', hint: '', recommended: true, target: { type: 'setting', key: 'b' }, onPayload: true, defaultValue: true },
  { kind: 'boolean', id: 'flag-c', label: 'C', description: '', hint: '', recommended: false, target: { type: 'setting', key: 'c' }, onPayload: false, defaultValue: false },
  { kind: 'boolean', id: 'flag-d', label: 'D', description: '', hint: '', recommended: true, target: { type: 'setting', key: 'd' }, onPayload: true, defaultValue: true },
];

// ── resolveSeedFeatures ───────────────────────────────────────────────────────

describe('resolveSeedFeatures', () => {
  it('fresh (null, null) → FEATURE_DEFAULTS', () => {
    const result = resolveSeedFeatures(null, null);
    expect(result).toEqual(FEATURE_DEFAULTS);
  });

  it('manifest present, no config → reads ambient/hud/rules/proxy and memory/knowledge/learning from manifest', () => {
    const manifest = makeManifest({
      features: {
        ambient: false,
        memory: false,
        hud: false,
        knowledge: false,
        learning: false,
        rules: false,
        proxy: false,
        flags: [],
      },
    });
    const result = resolveSeedFeatures(manifest, null);
    expect(result).toEqual({
      ambient: false,
      memory: false,
      hud: false,
      knowledge: false,
      learning: false,
      rules: false,
      proxy: false,
      compliance: { enabled: false, frameworks: [] },
    });
  });

  it('projectConfig present, no manifest → memory/learning/knowledge from config; ambient/hud/rules from defaults', () => {
    const config = { memory: false, learning: false, knowledge: false, reviewPublication: 'auto' as const };
    const result = resolveSeedFeatures(null, config);
    expect(result.memory).toBe(false);
    expect(result.learning).toBe(false);
    expect(result.knowledge).toBe(false);
    // ambient/hud/rules from FEATURE_DEFAULTS when manifest absent
    expect(result.ambient).toBe(FEATURE_DEFAULTS.ambient);
    expect(result.hud).toBe(FEATURE_DEFAULTS.hud);
    expect(result.rules).toBe(FEATURE_DEFAULTS.rules);
  });

  it('both present → config wins for memory/learning/knowledge; manifest wins for ambient/hud/rules/proxy', () => {
    const manifest = makeManifest({
      features: {
        ambient: false,
        memory: true, // overridden by config
        hud: false,
        knowledge: true, // overridden by config
        learning: true, // overridden by config
        rules: false,
        proxy: true,  // manifest wins for proxy (not config-gated per ADR-001)
        flags: [],
      },
    });
    const config = { memory: false, learning: false, knowledge: false, reviewPublication: 'auto' as const };
    const result = resolveSeedFeatures(manifest, config);
    // config wins for memory/learning/knowledge
    expect(result.memory).toBe(false);
    expect(result.learning).toBe(false);
    expect(result.knowledge).toBe(false);
    // manifest wins for ambient/hud/rules/proxy
    expect(result.ambient).toBe(false);
    expect(result.hud).toBe(false);
    expect(result.rules).toBe(false);
    expect(result.proxy).toBe(true);
  });

  it('config with learning: true overrides manifest learning: false (applies ADR-001)', () => {
    const manifest = makeManifest({
      features: { ...makeManifest().features, learning: false },
    });
    const config = { memory: true, learning: true, knowledge: true, reviewPublication: 'auto' as const };
    const result = resolveSeedFeatures(manifest, config);
    expect(result.learning).toBe(true);
  });
});

// ── resolveSeedFlags ──────────────────────────────────────────────────────────

// Phase 6: resolveSeedFlags returns FlagsRecord (not string[]).
// ALL registry flags are present with their resolved values.
// FlagsRecord key-presence encodes "known": present key = known, absent = new → adopt default.
describe('resolveSeedFlags', () => {
  it('fresh (null manifestFlags) → all registry flags at their defaults', () => {
    const result = resolveSeedFlags(null, MOCK_FLAGS);
    // All 4 MOCK_FLAGS present with their default values
    expect(result['flag-a']).toBe(true);
    expect(result['flag-b']).toBe(true);
    expect(result['flag-c']).toBe(false);
    expect(result['flag-d']).toBe(true);
    expect(Object.keys(result)).toHaveLength(4);
  });

  it('fresh uses real FLAG_REGISTRY when no registry override provided', () => {
    const result = resolveSeedFlags(null);
    // All registry flags are present in the record
    expect(Object.keys(result)).toHaveLength(FLAG_REGISTRY.length);
    // Default-ON boolean flags are true
    expect(result['tui']).toBe(true);
    expect(result['tool-search']).toBe(true);
    expect(result['lsp']).toBe(true);
    expect(result['prompt-caching-1h']).toBe(true);
    expect(result['show-turn-duration']).toBe(true);
    expect(result['clear-context-on-plan']).toBe(true);
    expect(result['disable-bundled-skills']).toBe(true);
    expect(result['pin-sonnet-4-6']).toBe(true);
    // Default-OFF boolean flags are false
    expect(result['brief']).toBe(false);
    // Number flag with non-neutral default is present
    expect(result['max-concurrent-subagents']).toBe(40);
    // view-mode default is 'default' (neutralValue for the enum)
    expect(result['view-mode']).toBe('default');
  });

  it('all registry flags present in record → existing values kept', () => {
    const record: FlagsRecord = { 'flag-a': true, 'flag-b': false, 'flag-c': false, 'flag-d': false };
    const result = resolveSeedFlags(record, MOCK_FLAGS);
    expect(result['flag-a']).toBe(true);
    expect(result['flag-b']).toBe(false);
    expect(result['flag-c']).toBe(false);
    expect(result['flag-d']).toBe(false);
  });

  it('partial record (absent flags = new) → existing kept + absent flags adopt defaults', () => {
    // flag-c and flag-d absent → adopt defaults (false and true respectively)
    const record: FlagsRecord = { 'flag-a': true, 'flag-b': true };
    const result = resolveSeedFlags(record, MOCK_FLAGS);
    expect(result['flag-a']).toBe(true);
    expect(result['flag-b']).toBe(true);
    expect(result['flag-c']).toBe(false); // adopted default-OFF
    expect(result['flag-d']).toBe(true);  // adopted default-ON
  });

  it('disabled default-ON flag stays disabled when explicitly false in record', () => {
    // flag-a was known at last install, user disabled it → stays false
    const record: FlagsRecord = { 'flag-a': false, 'flag-b': true, 'flag-c': false, 'flag-d': false };
    const result = resolveSeedFlags(record, MOCK_FLAGS);
    expect(result['flag-a']).toBe(false); // stays disabled — PF-023: no resurrection
    expect(result['flag-b']).toBe(true);
  });

  it('default-OFF flag present as false stays false when explicitly set', () => {
    const record: FlagsRecord = { 'flag-a': true, 'flag-b': true, 'flag-c': false, 'flag-d': true };
    const result = resolveSeedFlags(record, MOCK_FLAGS);
    expect(result['flag-c']).toBe(false);
  });

  it('empty record → adopt all registry flags at their defaults (all absent = all new)', () => {
    const result = resolveSeedFlags({}, MOCK_FLAGS);
    expect(result['flag-a']).toBe(true);
    expect(result['flag-b']).toBe(true);
    expect(result['flag-c']).toBe(false);
    expect(result['flag-d']).toBe(true);
  });

  it('unknown IDs from old manifests pass through unchanged (forward-compat)', () => {
    const record: FlagsRecord = { 'flag-a': true, 'future-flag-xyz': true };
    const result = resolveSeedFlags(record, MOCK_FLAGS);
    expect(result['future-flag-xyz']).toBe(true);
  });
});

// ── resolveSeedPlugins ────────────────────────────────────────────────────────

describe('resolveSeedPlugins', () => {
  it('fresh (null manifestPlugins) → non-optional workflow plugins preselected, empty language', () => {
    const { workflowPlugins, languagePlugins } = resolveSeedPlugins(null, undefined, DEVFLOW_PLUGINS);
    expect(languagePlugins).toEqual([]);
    // All returned workflow plugins must be non-optional
    for (const name of workflowPlugins) {
      const plugin = DEVFLOW_PLUGINS.find(p => p.name === name);
      expect(plugin).toBeDefined();
      expect(plugin!.optional).toBeFalsy();
    }
    // Should include core workflow plugins like devflow-implement
    expect(workflowPlugins).toContain('devflow-implement');
  });

  it('fresh never includes excluded always-installed plugins (core-skills, ambient)', () => {
    const { workflowPlugins, languagePlugins } = resolveSeedPlugins(null, undefined, DEVFLOW_PLUGINS);
    const all = [...workflowPlugins, ...languagePlugins];
    expect(all).not.toContain('devflow-core-skills');
    expect(all).not.toContain('devflow-ambient');
  });

  it('knownPlugins === undefined → split existing into buckets, adopt nothing', () => {
    const manifest = ['devflow-implement', 'devflow-code-review', 'devflow-typescript'];
    const { workflowPlugins, languagePlugins } = resolveSeedPlugins(manifest, undefined, DEVFLOW_PLUGINS);
    expect(workflowPlugins.sort()).toEqual(['devflow-code-review', 'devflow-implement'].sort());
    expect(languagePlugins).toEqual(['devflow-typescript']);
  });

  it('re-init with knownPlugins: new non-optional workflow plugin ∉ knownPlugins is adopted', () => {
    // Simulate: devflow-resolve is a new non-optional plugin not seen at last install
    const manifest = ['devflow-implement', 'devflow-code-review'];
    const known = ['devflow-implement', 'devflow-code-review']; // devflow-resolve not in known

    const { workflowPlugins } = resolveSeedPlugins(manifest, known, DEVFLOW_PLUGINS);
    // devflow-resolve is non-optional and not in known → adopted
    expect(workflowPlugins).toContain('devflow-resolve');
  });

  it('optional plugin is never auto-adopted even when absent from knownPlugins', () => {
    const manifest = ['devflow-implement'];
    const known = ['devflow-implement']; // all optional plugins are "new"

    const { workflowPlugins, languagePlugins } = resolveSeedPlugins(manifest, known, DEVFLOW_PLUGINS);
    // devflow-typescript, devflow-rust etc. are optional → not adopted
    const all = [...workflowPlugins, ...languagePlugins];
    for (const name of all) {
      const plugin = DEVFLOW_PLUGINS.find(p => p.name === name);
      if (plugin) {
        // optional plugins must not have been auto-added unless they were in manifest
        if (!manifest.includes(name)) {
          expect(plugin.optional).toBeFalsy();
        }
      }
    }
  });

  it('plugin already in manifestPlugins is not duplicated when re-adopted', () => {
    const manifest = ['devflow-implement', 'devflow-resolve'];
    const known: string[] = []; // all new — but implement and resolve already in manifest

    const { workflowPlugins } = resolveSeedPlugins(manifest, known, DEVFLOW_PLUGINS);
    expect(workflowPlugins.filter(n => n === 'devflow-implement')).toHaveLength(1);
    expect(workflowPlugins.filter(n => n === 'devflow-resolve')).toHaveLength(1);
  });

  it('existing manifest plugin that is no longer selectable is excluded from buckets', () => {
    // devflow-core-skills is in manifest (stored from full install) but not selectable
    const manifest = ['devflow-core-skills', 'devflow-implement'];
    const { workflowPlugins, languagePlugins } = resolveSeedPlugins(manifest, undefined, DEVFLOW_PLUGINS);
    const all = [...workflowPlugins, ...languagePlugins];
    expect(all).not.toContain('devflow-core-skills');
    expect(all).toContain('devflow-implement');
  });
});

// ── resolveInitSeed ───────────────────────────────────────────────────────────

describe('resolveInitSeed', () => {
  it('fresh (null manifest, null config, empty settings) → registry defaults', () => {
    const seed = resolveInitSeed(null, null, '{}', DEVFLOW_PLUGINS);
    // features: FEATURE_DEFAULTS
    expect(seed.features).toEqual(FEATURE_DEFAULTS);
    // flags: FlagsRecord with all registry flags at their defaults
    expect(typeof seed.flags).toBe('object');
    expect(seed.flags['tui']).toBe(true);
    expect(seed.flags['brief']).toBe(false);
    expect(seed.flags['max-concurrent-subagents']).toBe(40);
    expect(Object.keys(seed.flags)).toHaveLength(FLAG_REGISTRY.length);
    // view-mode in flags (not a separate field)
    expect(readViewMode(seed.flags)).toBe('default');
    // plugins: non-optional workflow plugins, empty language
    expect(seed.languagePlugins).toEqual([]);
    expect(seed.workflowPlugins.length).toBeGreaterThan(0);
  });

  it('view-mode: settings.json non-default wins over manifest', () => {
    // view-mode lives in flags['view-mode'] (Phase 6 — no deprecated viewMode field)
    const manifest = makeManifest({ features: { ...makeManifest().features, flags: { ...makeManifest().features.flags, 'view-mode': 'verbose' } } });
    const settings = JSON.stringify({ viewMode: 'focus' });
    const seed = resolveInitSeed(manifest, null, settings, DEVFLOW_PLUGINS);
    expect(readViewMode(seed.flags)).toBe('focus'); // settings beats manifest
  });

  it('view-mode: manifest used when settings.json has no viewMode or "default"', () => {
    // view-mode lives in flags['view-mode'] (Phase 6)
    const manifest = makeManifest({ features: { ...makeManifest().features, flags: { ...makeManifest().features.flags, 'view-mode': 'verbose' } } });
    const settings = JSON.stringify({ viewMode: 'default' });
    const seed = resolveInitSeed(manifest, null, settings, DEVFLOW_PLUGINS);
    expect(readViewMode(seed.flags)).toBe('verbose'); // settings 'default' → fall through to manifest
  });

  it('view-mode: falls back to "default" when neither settings nor manifest has one', () => {
    const manifest = makeManifest(); // no 'view-mode' in flags → resolves to 'default'
    const settings = '{}';
    const seed = resolveInitSeed(manifest, null, settings, DEVFLOW_PLUGINS);
    expect(readViewMode(seed.flags)).toBe('default');
  });

  it('re-init round-trip: re-resolving from the same manifest+config produces the same seed', () => {
    // Phase 2: FlagsRecord (was string[] + viewMode); view-mode in flags record
    const manifest = makeManifest({
      features: {
        ambient: false,
        memory: true,
        hud: true,
        knowledge: false,
        learning: true,
        rules: false,
        proxy: false,
        flags: { tui: true, lsp: true, 'view-mode': 'verbose' },
      },
    });
    const config = { memory: true, learning: true, knowledge: false, reviewPublication: 'auto' as const };
    const settings = '{}';

    const seed1 = resolveInitSeed(manifest, config, settings, DEVFLOW_PLUGINS);
    const seed2 = resolveInitSeed(manifest, config, settings, DEVFLOW_PLUGINS);
    expect(seed1).toEqual(seed2); // pure function — same inputs, same output
  });
});

// ── applyCliToggles ───────────────────────────────────────────────────────────

describe('applyCliToggles', () => {
  const base: FeatureSeed = {
    ambient: true,
    memory: true,
    hud: true,
    knowledge: true,
    learning: true,
    rules: true,
    proxy: false,
  };

  it('empty toggles → base unchanged', () => {
    const result = applyCliToggles(base, {});
    expect(result).toEqual(base);
  });

  it('undefined per-key → base value preserved', () => {
    const result = applyCliToggles(base, { ambient: undefined, memory: undefined });
    expect(result.ambient).toBe(true);
    expect(result.memory).toBe(true);
  });

  it('explicit false overrides base true', () => {
    const result = applyCliToggles(base, { ambient: false, memory: false });
    expect(result.ambient).toBe(false);
    expect(result.memory).toBe(false);
    // other keys untouched
    expect(result.hud).toBe(true);
    expect(result.learning).toBe(true);
  });

  it('explicit true overrides base false', () => {
    const allFalse: FeatureSeed = { ambient: false, memory: false, hud: false, knowledge: false, learning: false, rules: false, proxy: false };
    const result = applyCliToggles(allFalse, { ambient: true, knowledge: true });
    expect(result.ambient).toBe(true);
    expect(result.knowledge).toBe(true);
    expect(result.memory).toBe(false); // untouched
    expect(result.rules).toBe(false);  // untouched
  });

  it('immutable: base object is not mutated', () => {
    const original = { ...base };
    applyCliToggles(base, { ambient: false });
    expect(base).toEqual(original);
  });
});

// ── Phase 4 integration scenarios (WS1 composability) ────────────────────────

describe('resolveInitSeed — re-init composability (WS1)', () => {
  it('non-interactive re-init preserves existing plugin selection via workflowPlugins + languagePlugins', () => {
    // Simulate: user had devflow-implement + devflow-typescript installed; runs non-interactive
    // re-init with --recommended. Seed must carry the prior selection into selectedPlugins.
    const manifest = makeManifest({
      plugins: ['devflow-implement', 'devflow-code-review', 'devflow-typescript'],
      features: { ...makeManifest().features },
    });
    // knownPlugins snapshot written by commit 7b: all current plugin names
    const manifestWithKnown = {
      ...manifest,
      knownPlugins: DEVFLOW_PLUGINS.map(p => p.name),
      features: {
        ...manifest.features,
        knownFlags: FLAG_REGISTRY.map(f => f.id),
      },
    };

    const seed = resolveInitSeed(manifestWithKnown as unknown as typeof manifest, null, '{}', DEVFLOW_PLUGINS);

    // Prior workflow selection is preserved
    expect(seed.workflowPlugins).toContain('devflow-implement');
    expect(seed.workflowPlugins).toContain('devflow-code-review');
    // Prior language selection is preserved
    expect(seed.languagePlugins).toContain('devflow-typescript');
  });

  it('factory reset (--reset): null manifest → fresh seed, not prior state', () => {
    // Simulate --reset: seedManifest = null, seedConfig = null (prior state ignored)
    const seed = resolveInitSeed(null, null, '{}', DEVFLOW_PLUGINS);

    // Features: all FEATURE_DEFAULTS (all true)
    expect(seed.features).toEqual(FEATURE_DEFAULTS);
    // view-mode: 'default' (no settings, no manifest — encoded in flags)
    expect(readViewMode(seed.flags)).toBe('default');
    // workflowPlugins: only non-optional workflow plugins (fresh install defaults)
    for (const name of seed.workflowPlugins) {
      const plugin = DEVFLOW_PLUGINS.find(p => p.name === name);
      expect(plugin?.optional).toBeFalsy();
    }
    // languagePlugins: empty (fresh install)
    expect(seed.languagePlugins).toEqual([]);
  });

  it('composability fix: --no-memory on re-init preserves other prior state via applyCliToggles', () => {
    // The original composability bug: devflow flags --disable tui + devflow memory --disable
    // were reset to defaults on --recommended re-init. After WS1, applyCliToggles(seed, {memory:false})
    // preserves the seed's other values while only overriding memory.
    const seed = resolveInitSeed(null, null, '{}', DEVFLOW_PLUGINS); // fresh seed for this test

    const seedWithMemoryDisabled: FeatureSeed = {
      ...seed.features,
      memory: false,
    };

    const result = applyCliToggles(seed.features, { memory: false });
    expect(result).toEqual(seedWithMemoryDisabled);
    // Other seed fields preserved — pin to hard-coded defaults (FEATURE_DEFAULTS)
    // rather than re-deriving from seed to ensure the assertion is non-tautological.
    expect(result.ambient).toBe(true);
    expect(result.learning).toBe(true);
    expect(result.knowledge).toBe(true);
  });
});

// ── resolveResetGatedInputs ─────────────────────────────────────────────────────

describe('resolveResetGatedInputs', () => {
  it('reset=false: passes manifest, config, and settings through unchanged', () => {
    const manifest = makeManifest();
    const config = { memory: false, learning: false, knowledge: true, reviewPublication: 'auto' as const };
    const settings = JSON.stringify({ viewMode: 'focus' });

    const { seedManifest, seedConfig, seedSettings } = resolveResetGatedInputs(
      false, manifest, config, settings,
    );

    expect(seedManifest).toBe(manifest);
    expect(seedConfig).toBe(config);
    expect(seedSettings).toBe(settings);
  });

  it('reset=true: discards manifest, config, and settings snapshot', () => {
    const manifest = makeManifest();
    const config = { memory: false, learning: false, knowledge: false, reviewPublication: 'auto' as const };
    const settings = JSON.stringify({ viewMode: 'focus' });

    const { seedManifest, seedConfig, seedSettings } = resolveResetGatedInputs(
      true, manifest, config, settings,
    );

    expect(seedManifest).toBeNull();
    expect(seedConfig).toBeNull();
    expect(seedSettings).toBe('');
  });

  it('reset=true forces view-mode "default" even when settings.json has a non-default mode', () => {
    // Regression guard: --reset must not preserve an externally-set /focus mode.
    // The bug was passing the REAL settings snapshot to resolveInitSeed under --reset,
    // which surfaced viewMode:'focus' and (with viewModeExplicit=true) survived the reset.
    const manifest = makeManifest({ features: { ...makeManifest().features } });
    const settings = JSON.stringify({ viewMode: 'focus' });

    const gated = resolveResetGatedInputs(true, manifest, null, settings);
    const seed = resolveInitSeed(gated.seedManifest, gated.seedConfig, gated.seedSettings, DEVFLOW_PLUGINS);

    expect(readViewMode(seed.flags)).toBe('default');
  });

  it('reset=false preserves a non-default view-mode from the settings snapshot', () => {
    // Complement to the reset case: without --reset, an externally-set /focus survives seeding.
    const settings = JSON.stringify({ viewMode: 'focus' });
    const gated = resolveResetGatedInputs(false, null, null, settings);
    const seed = resolveInitSeed(gated.seedManifest, gated.seedConfig, gated.seedSettings, DEVFLOW_PLUGINS);

    expect(readViewMode(seed.flags)).toBe('focus');
  });
});

// ── proxy seeding (resolveSeedFeatures + applyCliToggles) ─────────────────────

describe('proxy seeding', () => {
  it('FEATURE_DEFAULTS.proxy is false (Advanced-only, never auto-enabled)', () => {
    expect(FEATURE_DEFAULTS.proxy).toBe(false);
  });

  it('fresh install (null manifest) → proxy defaults to false', () => {
    const result = resolveSeedFeatures(null, null);
    expect(result.proxy).toBe(false);
  });

  it('manifest.features.proxy=true → seeded as true (manifest group, not config-gated)', () => {
    const manifest = makeManifest({
      features: { ...makeManifest().features, proxy: true },
    });
    const result = resolveSeedFeatures(manifest, null);
    expect(result.proxy).toBe(true);
  });

  it('manifest.features.proxy=false → seeded as false', () => {
    const manifest = makeManifest({
      features: { ...makeManifest().features, proxy: false },
    });
    const result = resolveSeedFeatures(manifest, null);
    expect(result.proxy).toBe(false);
  });

  it('--reset (null manifest) → proxy seeds as false regardless of prior state', () => {
    // --reset passes seedManifest=null via resolveResetGatedInputs; proxy must fall
    // back to FEATURE_DEFAULTS.proxy=false rather than carrying a prior true value.
    const result = resolveSeedFeatures(null, null);
    expect(result.proxy).toBe(false);
  });

  it('project config has no effect on proxy (proxy is manifest-gated, not config-gated)', () => {
    // Proxy is in the manifest group (like ambient/hud/rules), not the config group.
    // Passing a config with memory/learning/knowledge must not affect the proxy seed.
    const config = { memory: false, learning: false, knowledge: false };
    const result = resolveSeedFeatures(null, config);
    expect(result.proxy).toBe(false); // still falls back to FEATURE_DEFAULTS
  });

  it('applyCliToggles: --proxy overrides seed proxy=false', () => {
    const seed: FeatureSeed = { ...FEATURE_DEFAULTS, proxy: false };
    const result = applyCliToggles(seed, { proxy: true });
    expect(result.proxy).toBe(true);
    // other fields untouched
    expect(result.ambient).toBe(FEATURE_DEFAULTS.ambient);
    expect(result.memory).toBe(FEATURE_DEFAULTS.memory);
  });

  it('applyCliToggles: --no-proxy overrides seed proxy=true', () => {
    const seed: FeatureSeed = { ...FEATURE_DEFAULTS, proxy: true };
    const result = applyCliToggles(seed, { proxy: false });
    expect(result.proxy).toBe(false);
  });

  it('applyCliToggles: undefined proxy toggle preserves seed value', () => {
    const seed: FeatureSeed = { ...FEATURE_DEFAULTS, proxy: true };
    const result = applyCliToggles(seed, {}); // no proxy toggle
    expect(result.proxy).toBe(true);
  });

  it('resolveInitSeed: proxy included in features result', () => {
    const manifest = makeManifest({
      features: { ...makeManifest().features, proxy: true },
    });
    const seed = resolveInitSeed(manifest, null, '{}', DEVFLOW_PLUGINS);
    expect(seed.features.proxy).toBe(true);
  });
});

// ── compliance seeding (resolveSeedFeatures + applyCliToggles) ────────────────
// Canonical home for init-seed compliance coverage (moved from compliance-cli.test.ts).
// Compliance is manifest-gated (like proxy), never config.json-gated (ADR-001).

describe('compliance seeding', () => {
  /** Manifest fixture with explicit compliance field (required by ManifestData.features). */
  function makeComplianceManifest(compliance: { enabled: boolean; frameworks: string[] }): ManifestData {
    return makeManifest({
      features: {
        ...makeManifest().features,
        compliance,
      },
    });
  }

  it('FEATURE_DEFAULTS.compliance is {enabled:false, frameworks:[]} (opt-in, never auto-enabled)', () => {
    expect(FEATURE_DEFAULTS.compliance).toEqual({ enabled: false, frameworks: [] });
  });

  it('fresh install (null manifest) → compliance defaults to disabled', () => {
    const result = resolveSeedFeatures(null, null);
    expect(result.compliance).toEqual({ enabled: false, frameworks: [] });
  });

  it('manifest.features.compliance=enabled → seeded as enabled (manifest-group, not config-gated)', () => {
    const manifest = makeComplianceManifest({ enabled: true, frameworks: ['gdpr', 'hipaa'] });
    const result = resolveSeedFeatures(manifest, null);
    expect(result.compliance).toEqual({ enabled: true, frameworks: ['gdpr', 'hipaa'] });
  });

  it('manifest.features.compliance=disabled → seeded as disabled', () => {
    const manifest = makeComplianceManifest({ enabled: false, frameworks: [] });
    const result = resolveSeedFeatures(manifest, null);
    expect(result.compliance).toEqual({ enabled: false, frameworks: [] });
  });

  it('projectConfig has no effect on compliance (manifest-gated, not config-gated)', () => {
    const config = { memory: false, learning: false, knowledge: false, reviewPublication: 'auto' as const };
    const result = resolveSeedFeatures(null, config);
    expect(result.compliance).toEqual({ enabled: false, frameworks: [] }); // FEATURE_DEFAULTS wins
  });

  it('populated manifest wins over projectConfig: compliance comes from manifest, not FEATURE_DEFAULTS', () => {
    // The removed compliance-cli.test.ts variant: both a populated manifest AND a projectConfig are
    // present; compliance must come from the manifest (manifest-group), not from config or FEATURE_DEFAULTS.
    const manifest = makeComplianceManifest({ enabled: true, frameworks: ['sox'] });
    const config = { memory: false, learning: false, knowledge: false, reviewPublication: 'auto' as const };
    const result = resolveSeedFeatures(manifest, config);
    expect(result.compliance).toEqual({ enabled: true, frameworks: ['sox'] });
  });

  it('disable-keeps-frameworks: disabled manifest with non-empty frameworks → seeded with frameworks', () => {
    const manifest = makeComplianceManifest({ enabled: false, frameworks: ['sox', 'hipaa'] });
    const result = resolveSeedFeatures(manifest, null);
    expect(result.compliance).toEqual({ enabled: false, frameworks: ['sox', 'hipaa'] });
  });

  it('resolveSeedFeatures: compliance seed is a defensive copy (not a reference to manifest.features.compliance)', () => {
    const manifest = makeComplianceManifest({ enabled: true, frameworks: ['gdpr'] });
    const result = resolveSeedFeatures(manifest, null);
    expect(result.compliance.frameworks).not.toBe(manifest.features.compliance!.frameworks);
  });

  it('--reset (null seedManifest) → compliance falls back to FEATURE_DEFAULTS', () => {
    const manifest = makeComplianceManifest({ enabled: true, frameworks: ['gdpr', 'sox', 'hipaa'] });
    const { seedManifest } = resolveResetGatedInputs(true, manifest, null, '{}');
    const seed = resolveInitSeed(seedManifest, null, '', DEVFLOW_PLUGINS);
    expect(seed.features.compliance).toEqual({ enabled: false, frameworks: [] });
  });

  it('--no-reset preserves existing manifest compliance', () => {
    const manifest = makeComplianceManifest({ enabled: true, frameworks: ['pci-dss'] });
    const { seedManifest } = resolveResetGatedInputs(false, manifest, null, '{}');
    const seed = resolveInitSeed(seedManifest, null, '', DEVFLOW_PLUGINS);
    expect(seed.features.compliance).toEqual({ enabled: true, frameworks: ['pci-dss'] });
  });

  it('applyCliToggles: --compliance gdpr,soc2 → {enabled:true, frameworks:[gdpr,soc2]}', () => {
    const seed: FeatureSeed = { ...FEATURE_DEFAULTS, compliance: { enabled: false, frameworks: [] } };
    const result = applyCliToggles(seed, { compliance: { enabled: true, frameworks: ['gdpr', 'soc2'] } });
    expect(result.compliance).toEqual({ enabled: true, frameworks: ['gdpr', 'soc2'] });
    // Other fields untouched
    expect(result.ambient).toBe(FEATURE_DEFAULTS.ambient);
    expect(result.proxy).toBe(FEATURE_DEFAULTS.proxy);
  });

  it('applyCliToggles: --no-compliance preserves existing frameworks (disable-keeps-frameworks)', () => {
    const seed: FeatureSeed = { ...FEATURE_DEFAULTS, compliance: { enabled: true, frameworks: ['gdpr'] } };
    const result = applyCliToggles(seed, { compliance: { enabled: false, frameworks: ['gdpr'] } });
    expect(result.compliance.enabled).toBe(false);
    expect(result.compliance.frameworks).toEqual(['gdpr']);
  });

  it('applyCliToggles: --compliance "" (zero frameworks) → {enabled:true, frameworks:[]}', () => {
    const seed: FeatureSeed = { ...FEATURE_DEFAULTS, compliance: { enabled: false, frameworks: [] } };
    const result = applyCliToggles(seed, { compliance: { enabled: true, frameworks: [] } });
    expect(result.compliance).toEqual({ enabled: true, frameworks: [] });
  });

  it('applyCliToggles: undefined compliance toggle → seed compliance unchanged', () => {
    const seed: FeatureSeed = { ...FEATURE_DEFAULTS, compliance: { enabled: true, frameworks: ['sox'] } };
    const result = applyCliToggles(seed, {}); // no compliance toggle
    expect(result.compliance).toEqual({ enabled: true, frameworks: ['sox'] });
  });

  it('resolveInitSeed: compliance included in features result', () => {
    const manifest = makeComplianceManifest({ enabled: true, frameworks: ['gdpr'] });
    const seed = resolveInitSeed(manifest, null, '{}', DEVFLOW_PLUGINS);
    expect(seed.features.compliance).toEqual({ enabled: true, frameworks: ['gdpr'] });
  });
});
