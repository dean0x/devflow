import { describe, it, expect } from 'vitest';
import {
  resolveSeedFeatures,
  resolveSeedFlags,
  resolveSeedPlugins,
  resolveInitSeed,
  applyCliToggles,
  FEATURE_DEFAULTS,
  type FeatureSeed,
} from '../src/cli/commands/init-seed.js';
import { DEVFLOW_PLUGINS } from '../src/core/plugins.js';
import { FLAG_REGISTRY, type ClaudeCodeFlag } from '../src/core/flags.js';
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
      flags: ['tui', 'lsp', 'tool-search'],
      viewMode: 'default',
    },
    installedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

// Synthetic flag registry for isolated flag tests
const MOCK_FLAGS: ClaudeCodeFlag[] = [
  { id: 'flag-a', label: 'A', description: '', hint: '', target: { type: 'setting', key: 'a', value: true }, defaultEnabled: true },
  { id: 'flag-b', label: 'B', description: '', hint: '', target: { type: 'setting', key: 'b', value: true }, defaultEnabled: true },
  { id: 'flag-c', label: 'C', description: '', hint: '', target: { type: 'setting', key: 'c', value: false }, defaultEnabled: false },
  { id: 'flag-d', label: 'D', description: '', hint: '', target: { type: 'setting', key: 'd', value: true }, defaultEnabled: true },
];

// ── resolveSeedFeatures ───────────────────────────────────────────────────────

describe('resolveSeedFeatures', () => {
  it('fresh (null, null) → FEATURE_DEFAULTS', () => {
    const result = resolveSeedFeatures(null, null);
    expect(result).toEqual(FEATURE_DEFAULTS);
  });

  it('manifest present, no config → reads ambient/hud/rules and memory/knowledge/learning from manifest', () => {
    const manifest = makeManifest({
      features: {
        ambient: false,
        memory: false,
        hud: false,
        knowledge: false,
        learning: false,
        rules: false,
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
    });
  });

  it('projectConfig present, no manifest → memory/learning/knowledge from config; ambient/hud/rules from defaults', () => {
    const config = { memory: false, learning: false, knowledge: false };
    const result = resolveSeedFeatures(null, config);
    expect(result.memory).toBe(false);
    expect(result.learning).toBe(false);
    expect(result.knowledge).toBe(false);
    // ambient/hud/rules from FEATURE_DEFAULTS when manifest absent
    expect(result.ambient).toBe(FEATURE_DEFAULTS.ambient);
    expect(result.hud).toBe(FEATURE_DEFAULTS.hud);
    expect(result.rules).toBe(FEATURE_DEFAULTS.rules);
  });

  it('both present → config wins for memory/learning/knowledge; manifest wins for ambient/hud/rules', () => {
    const manifest = makeManifest({
      features: {
        ambient: false,
        memory: true, // overridden by config
        hud: false,
        knowledge: true, // overridden by config
        learning: true, // overridden by config
        rules: false,
        flags: [],
      },
    });
    const config = { memory: false, learning: false, knowledge: false };
    const result = resolveSeedFeatures(manifest, config);
    // config wins for memory/learning/knowledge
    expect(result.memory).toBe(false);
    expect(result.learning).toBe(false);
    expect(result.knowledge).toBe(false);
    // manifest wins for ambient/hud/rules
    expect(result.ambient).toBe(false);
    expect(result.hud).toBe(false);
    expect(result.rules).toBe(false);
  });

  it('config with learning: true overrides manifest learning: false (applies ADR-001)', () => {
    const manifest = makeManifest({
      features: { ...makeManifest().features, learning: false },
    });
    const config = { memory: true, learning: true, knowledge: true };
    const result = resolveSeedFeatures(manifest, config);
    expect(result.learning).toBe(true);
  });
});

// ── resolveSeedFlags ──────────────────────────────────────────────────────────

describe('resolveSeedFlags', () => {
  it('fresh (null enabledFlags) → all default-ON flags from registry', () => {
    const result = resolveSeedFlags(null, undefined, MOCK_FLAGS);
    expect(result.sort()).toEqual(['flag-a', 'flag-b', 'flag-d'].sort());
  });

  it('fresh uses real FLAG_REGISTRY when no registry override provided', () => {
    const result = resolveSeedFlags(null, undefined);
    const expected = FLAG_REGISTRY.filter(f => f.defaultEnabled).map(f => f.id);
    expect(result.sort()).toEqual(expected.sort());
  });

  it('knownFlags === undefined (old manifest) → return enabledFlags as-is, adopt nothing', () => {
    const enabled = ['flag-a'];
    const result = resolveSeedFlags(enabled, undefined, MOCK_FLAGS);
    expect(result).toEqual(['flag-a']);
  });

  it('re-init with knownFlags → union of existing + new default-ON not in knownFlags', () => {
    // flag-d is new (not in knownFlags), default-ON → gets adopted
    const enabled = ['flag-a', 'flag-b'];
    const known = ['flag-a', 'flag-b']; // flag-d was added to registry after last install
    const result = resolveSeedFlags(enabled, known, MOCK_FLAGS);
    expect(result.sort()).toEqual(['flag-a', 'flag-b', 'flag-d'].sort());
  });

  it('disabled default-ON flag stays disabled when it is in knownFlags', () => {
    // flag-a was known at last install, user disabled it → should NOT be re-added
    const enabled = ['flag-b']; // flag-a absent (user disabled it)
    const known = ['flag-a', 'flag-b', 'flag-d'];
    const result = resolveSeedFlags(enabled, known, MOCK_FLAGS);
    expect(result).toEqual(['flag-b']); // flag-a stays disabled
  });

  it('default-OFF flag is never auto-added even when absent from knownFlags', () => {
    // flag-c is default-OFF and not in knownFlags → must NOT be added
    const enabled = ['flag-a'];
    const known = ['flag-a']; // flag-c not in known, flag-b and flag-d are new
    const result = resolveSeedFlags(enabled, known, MOCK_FLAGS);
    expect(result).not.toContain('flag-c');
  });

  it('duplicate-safe: existing flag already in result is not duplicated', () => {
    // flag-a is in both enabledFlags and would be "newly adopted" — should appear once
    const enabled = ['flag-a', 'flag-b'];
    const known = []; // all flags are "new" — but enabledFlags already has flag-a
    const result = resolveSeedFlags(enabled, known, MOCK_FLAGS);
    expect(result.filter(f => f === 'flag-a')).toHaveLength(1);
  });

  it('empty enabledFlags + knownFlags → only new default-ON flags adopted', () => {
    const enabled: string[] = [];
    const known: string[] = [];
    const result = resolveSeedFlags(enabled, known, MOCK_FLAGS);
    expect(result.sort()).toEqual(['flag-a', 'flag-b', 'flag-d'].sort());
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

  it('fresh never includes excluded always-installed plugins (core-skills, ambient, audit-claude)', () => {
    const { workflowPlugins, languagePlugins } = resolveSeedPlugins(null, undefined, DEVFLOW_PLUGINS);
    const all = [...workflowPlugins, ...languagePlugins];
    expect(all).not.toContain('devflow-core-skills');
    expect(all).not.toContain('devflow-ambient');
    expect(all).not.toContain('devflow-audit-claude');
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
    // flags: all default-ON from real registry
    const expectedFlags = FLAG_REGISTRY.filter(f => f.defaultEnabled).map(f => f.id);
    expect(seed.flags.sort()).toEqual(expectedFlags.sort());
    // viewMode: 'default' (nothing in settings, no manifest)
    expect(seed.viewMode).toBe('default');
    // plugins: non-optional workflow plugins, empty language
    expect(seed.languagePlugins).toEqual([]);
    expect(seed.workflowPlugins.length).toBeGreaterThan(0);
  });

  it('viewMode: settings.json non-default wins over manifest', () => {
    const manifest = makeManifest({ features: { ...makeManifest().features, viewMode: 'verbose' } });
    const settings = JSON.stringify({ viewMode: 'focus' });
    const seed = resolveInitSeed(manifest, null, settings, DEVFLOW_PLUGINS);
    expect(seed.viewMode).toBe('focus'); // settings beats manifest
  });

  it('viewMode: manifest used when settings.json has no viewMode or "default"', () => {
    const manifest = makeManifest({ features: { ...makeManifest().features, viewMode: 'verbose' } });
    const settings = JSON.stringify({ viewMode: 'default' });
    const seed = resolveInitSeed(manifest, null, settings, DEVFLOW_PLUGINS);
    expect(seed.viewMode).toBe('verbose'); // settings 'default' → fall through to manifest
  });

  it('viewMode: falls back to "default" when neither settings nor manifest has one', () => {
    const manifest = makeManifest(); // viewMode: 'default' in fixture
    const settings = '{}';
    const seed = resolveInitSeed(manifest, null, settings, DEVFLOW_PLUGINS);
    expect(seed.viewMode).toBe('default');
  });

  it('re-init round-trip: re-resolving from the same manifest+config produces the same seed', () => {
    const manifest = makeManifest({
      features: {
        ambient: false,
        memory: true,
        hud: true,
        knowledge: false,
        learning: true,
        rules: false,
        flags: ['tui', 'lsp'],
        viewMode: 'verbose',
      },
    });
    const config = { memory: true, learning: true, knowledge: false };
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
    const allFalse: FeatureSeed = { ambient: false, memory: false, hud: false, knowledge: false, learning: false, rules: false };
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
    // viewMode: 'default' (no settings, no manifest)
    expect(seed.viewMode).toBe('default');
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
    // Other seed fields preserved
    expect(result.ambient).toBe(seed.features.ambient);
    expect(result.learning).toBe(seed.features.learning);
    expect(result.knowledge).toBe(seed.features.knowledge);
  });
});
