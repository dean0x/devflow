import { describe, it, expect } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
  resolveSeedFeatures,
  resolveSeedFlags,
  resolveSeedPlugins,
  resolveInitSeed,
  resolveExistingAttributionSuppression,
  applyCliToggles,
  resolveResetGatedInputs,
  FEATURE_DEFAULTS,
  type FeatureSeed,
} from '../src/cli/commands/init-seed.js';
import { DEVFLOW_PLUGINS } from '../src/core/plugins.js';
import { FLAG_REGISTRY, readViewMode, type ClaudeCodeFlag, type FlagsRecord } from '../src/core/flags.js';
import { type ManifestData } from '../src/core/manifest.js';
import { type TrackerProvider } from '../src/core/tracker.js';

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
      tracker: { provider: 'github' },
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
    // Default-OFF boolean flags are false
    expect(result['brief']).toBe(false);
    expect(result['disable-bundled-skills']).toBe(false);
    expect(result['pin-sonnet-4-6']).toBe(false);
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

  it('does not mutate the manifest flags record (immutability regression — ARCH-S3)', () => {
    // Regression guard: resolveInitSeed previously wrote flags['view-mode'] in place,
    // which would corrupt manifest.features.flags if it was passed by reference.
    const manifestFlags = { tui: true, 'view-mode': 'verbose' as const };
    const manifest = makeManifest({ features: { ...makeManifest().features, flags: manifestFlags } });
    const originalViewMode = manifest.features.flags?.['view-mode'];

    resolveInitSeed(manifest, null, '{}', DEVFLOW_PLUGINS);

    // Manifest flags must be unchanged after the call.
    expect(manifest.features.flags?.['view-mode']).toBe(originalViewMode);
  });

  it('returned flags are a fresh copy — mutating them does not affect the manifest', () => {
    const manifest = makeManifest({ features: { ...makeManifest().features, flags: { 'view-mode': 'verbose' as const } } });
    const seed = resolveInitSeed(manifest, null, '{}', DEVFLOW_PLUGINS);

    (seed.flags as Record<string, unknown>)['view-mode'] = 'focus';

    // Manifest flags must remain unaffected by the caller mutating the returned record.
    expect(manifest.features.flags?.['view-mode']).toBe('verbose');
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
  // Every FeatureSeed key is present. An incomplete fixture annotated
  // `: FeatureSeed` is a TS2739 that nothing in this repo reports (PF-069:
  // tests/ is outside the typechecked project and vitest only transpiles), and
  // at runtime the missing keys come back as `undefined`, which `toEqual`
  // treats as equal to absent — so the manifest-group arms would pass
  // vacuously (PF-018).
  const base: FeatureSeed = {
    ambient: true,
    memory: true,
    hud: true,
    knowledge: true,
    learning: true,
    rules: true,
    proxy: false,
    compliance: { enabled: false, frameworks: [] },
    tracker: { provider: 'github' },
  };

  it('empty toggles → base unchanged', () => {
    const result = applyCliToggles(base, {});
    // toStrictEqual, not toEqual: a key dropped from the result must fail here
    // rather than compare equal to the base's defined value.
    expect(result).toStrictEqual(base);
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
    const allFalse: FeatureSeed = {
      ambient: false, memory: false, hud: false, knowledge: false,
      learning: false, rules: false, proxy: false,
      compliance: { enabled: false, frameworks: [] },
      tracker: { provider: 'jira' },
    };
    const result = applyCliToggles(allFalse, { ambient: true, knowledge: true });
    expect(result.ambient).toBe(true);
    expect(result.knowledge).toBe(true);
    expect(result.memory).toBe(false); // untouched
    expect(result.rules).toBe(false);  // untouched
    expect(result.tracker).toStrictEqual({ provider: 'jira' }); // untouched
  });

  it('immutable: base object is not mutated', () => {
    const original = { ...base };
    applyCliToggles(base, { ambient: false });
    expect(base).toStrictEqual(original);
  });

  // The precedence rule the Recommended path relies on when it calls
  // applyCliToggles with `tracker: cliTrackerOverride ?? wizardTracker`:
  // applyCliToggles supplies the third arm (the seed), so the composed rule is
  // cliOverride ?? wizardResult ?? seed. Both arms of the seam are asserted
  // here — an explicit toggle must win, an absent one must preserve.

  it('explicit tracker toggle wins over the base seed', () => {
    const seeded: FeatureSeed = { ...base, tracker: { provider: 'github' } };
    const result = applyCliToggles(seeded, { tracker: { provider: 'linear' } });
    expect(result.tracker).toStrictEqual({ provider: 'linear' });
    // Not the same object as the toggle's seed-side sibling.
    expect(result.tracker).not.toBe(seeded.tracker);
  });

  it('absent tracker toggle preserves the base seed provider', () => {
    const seeded: FeatureSeed = { ...base, tracker: { provider: 'linear' } };
    const result = applyCliToggles(seeded, { ambient: false });
    expect(result.tracker).toStrictEqual({ provider: 'linear' });
    // Known-bad probe for the vacuity this fixture completion closes: the key
    // must be present, not merely undefined-equals-absent.
    expect(Object.keys(result)).toContain('tracker');
    expect(result.tracker).toBeDefined();
  });

  it('explicit compliance toggle wins while tracker stays on the seed', () => {
    const seeded: FeatureSeed = { ...base, tracker: { provider: 'jira' } };
    const result = applyCliToggles(seeded, {
      compliance: { enabled: true, frameworks: ['gdpr'] },
    });
    expect(result.compliance).toStrictEqual({ enabled: true, frameworks: ['gdpr'] });
    expect(result.tracker).toStrictEqual({ provider: 'jira' });
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

// ── tracker seeding ───────────────────────────────────────────────────────────

describe('tracker seeding', () => {
  /** Manifest fixture with an explicit tracker field. */
  function makeTrackerManifest(tracker: { provider: TrackerProvider }): ManifestData {
    return makeManifest({
      features: {
        ...makeManifest().features,
        tracker,
      },
    });
  }

  it('FEATURE_DEFAULTS.tracker is {provider:"github"} — the silent default for every existing install', () => {
    expect(FEATURE_DEFAULTS.tracker).toEqual({ provider: 'github' });
  });

  it('fresh install (null manifest) → tracker defaults to github', () => {
    const result = resolveSeedFeatures(null, null);
    expect(result.tracker).toEqual({ provider: 'github' });
  });

  it('manifest.features.tracker=jira → seeded as jira (manifest-group, not config-gated)', () => {
    const result = resolveSeedFeatures(makeTrackerManifest({ provider: 'jira' }), null);
    expect(result.tracker).toEqual({ provider: 'jira' });
  });

  it('projectConfig has no effect on tracker (manifest-gated, not config-gated)', () => {
    const config = { memory: false, learning: false, knowledge: false, reviewPublication: 'auto' as const };
    const result = resolveSeedFeatures(null, config);
    expect(result.tracker).toEqual({ provider: 'github' });
  });

  it('populated manifest wins over projectConfig', () => {
    const config = { memory: false, learning: false, knowledge: false, reviewPublication: 'auto' as const };
    const result = resolveSeedFeatures(makeTrackerManifest({ provider: 'linear' }), config);
    expect(result.tracker).toEqual({ provider: 'linear' });
  });

  it('the tracker seed is a defensive copy, never a reference to FEATURE_DEFAULTS.tracker', () => {
    // Without the spread, `manifest?.features.tracker ?? FEATURE_DEFAULTS.tracker`
    // hands back the module-level default BY REFERENCE and a downstream mutation
    // corrupts it process-wide.
    const result = resolveSeedFeatures(null, null);
    expect(result.tracker).not.toBe(FEATURE_DEFAULTS.tracker);
    result.tracker.provider = 'jira';
    expect(FEATURE_DEFAULTS.tracker).toEqual({ provider: 'github' });
  });

  it('the tracker seed is a defensive copy, never a reference to the manifest value', () => {
    const manifest = makeTrackerManifest({ provider: 'jira' });
    const result = resolveSeedFeatures(manifest, null);
    expect(result.tracker).not.toBe(manifest.features.tracker);
  });

  it('--reset (null seedManifest) → tracker falls back to github (AC-3.20 / EC-62)', () => {
    const manifest = makeTrackerManifest({ provider: 'linear' });
    const { seedManifest } = resolveResetGatedInputs(true, manifest, null, '{}');
    const seed = resolveInitSeed(seedManifest, null, '', DEVFLOW_PLUGINS);
    expect(seed.features.tracker).toEqual({ provider: 'github' });
  });

  it('--no-reset preserves the existing manifest provider', () => {
    const manifest = makeTrackerManifest({ provider: 'jira' });
    const { seedManifest } = resolveResetGatedInputs(false, manifest, null, '{}');
    const seed = resolveInitSeed(seedManifest, null, '', DEVFLOW_PLUGINS);
    expect(seed.features.tracker).toEqual({ provider: 'jira' });
  });

  it('applyCliToggles: --tracker jira overrides the seed', () => {
    const seed: FeatureSeed = { ...FEATURE_DEFAULTS, tracker: { provider: 'github' } };
    const result = applyCliToggles(seed, { tracker: { provider: 'jira' } });
    expect(result.tracker).toEqual({ provider: 'jira' });
    // Other fields untouched
    expect(result.ambient).toBe(FEATURE_DEFAULTS.ambient);
    expect(result.compliance).toEqual(FEATURE_DEFAULTS.compliance);
  });

  it('applyCliToggles: --tracker github is the off switch (decision D-E, no --no-tracker)', () => {
    const seed: FeatureSeed = { ...FEATURE_DEFAULTS, tracker: { provider: 'linear' } };
    const result = applyCliToggles(seed, { tracker: { provider: 'github' } });
    expect(result.tracker).toEqual({ provider: 'github' });
  });

  it('applyCliToggles: undefined tracker toggle → seed tracker unchanged', () => {
    const seed: FeatureSeed = { ...FEATURE_DEFAULTS, tracker: { provider: 'jira' } };
    const result = applyCliToggles(seed, {});
    expect(result.tracker).toEqual({ provider: 'jira' });
  });

  it('resolveInitSeed: tracker included in the features result', () => {
    const seed = resolveInitSeed(makeTrackerManifest({ provider: 'linear' }), null, '{}', DEVFLOW_PLUGINS);
    expect(seed.features.tracker).toEqual({ provider: 'linear' });
  });
});

// ── init.ts tracker lifecycle call sites ──────────────────────────────────────
//
// [DR-22] / [DR-10] / P3a-S15: the attempt counter, the presence sentinel and the
// stale-conventions rename each have exactly ONE owner in src/core/tracker.ts,
// and `devflow init` binds each exactly once — into buildTrackerLifecycleIO, the
// single adapter persistManifestThenConvergeTracker drives. These are
// source-level assertions because init.ts's Commander `.action()` body is not
// unit-reachable; they go red if someone inlines an `fs.rm`, duplicates a
// binding, drops one, or reaches an owner outside the seam.
//
// Non-vacuity (PF-018): each "never inlined" assertion is paired with a probe
// showing the same pattern DOES match src/core/tracker.ts, so a renamed constant
// can never make the absence check pass by matching nothing anywhere.

describe('init.ts tracker lifecycle call sites', () => {
  const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
  const INIT_SOURCE = path.join(SRC, 'cli', 'commands', 'init.ts');
  const TRACKER_SOURCE = path.join(SRC, 'core', 'tracker.ts');

  it('binds rearmTrackerInference exactly once and never inlines the removal [DR-22]', async () => {
    const source = await fs.readFile(INIT_SOURCE, 'utf-8');
    expect((source.match(/rearmInference: rearmTrackerInference,/g) ?? []).length).toBe(1);
    expect(source).not.toMatch(/\.tracker\.attempts/);
    // Known-bad probe: the literal exists in the owner module, so the absence
    // assertion above is a statement about init.ts, not about a dead pattern.
    expect(await fs.readFile(TRACKER_SOURCE, 'utf-8')).toMatch(/\.tracker\.attempts/);
  });

  it('binds applyTrackerSentinel exactly once and never inlines the sentinel path [DR-10]', async () => {
    const source = await fs.readFile(INIT_SOURCE, 'utf-8');
    expect((source.match(/applySentinel: applyTrackerSentinel,/g) ?? []).length).toBe(1);
    expect(source).not.toMatch(/\.tracker\.enabled/);
    expect(await fs.readFile(TRACKER_SOURCE, 'utf-8')).toMatch(/\.tracker\.enabled/);
  });

  it('binds the provider-change rename transition exactly once (P3a-S15)', async () => {
    const source = await fs.readFile(INIT_SOURCE, 'utf-8');
    expect((source.match(/renameStaleConventions: renameStaleTrackerConventions,/g) ?? []).length).toBe(1);
  });

  it('reaches every owner through the one injected lifecycle seam', async () => {
    const source = await fs.readFile(INIT_SOURCE, 'utf-8');
    // Three owner calls in init.ts, each through `io.` — no direct invocation
    // that would bypass persistManifestThenConvergeTracker's ordering gate.
    expect((source.match(/\bio\.(rearmInference|applySentinel|renameStaleConventions)\(/g) ?? []).length).toBe(3);
    expect((source.match(/\b(rearmTrackerInference|applyTrackerSentinel|renameStaleTrackerConventions)\(/g) ?? []).length).toBe(0);
  });

  it('writes the manifest only inside the tracker lifecycle seam (PF-015)', async () => {
    const source = await fs.readFile(INIT_SOURCE, 'utf-8');
    // The ordering invariant — converge only what the manifest persisted — is
    // only real while the write and the three owners sit in one function, so the
    // full-install path reaches the writer exclusively through the injected seam.
    expect((source.match(/\bio\.writeManifest\(/g) ?? []).length).toBe(1);
    // One definition, one call site.
    expect((source.match(/persistManifestThenConvergeTracker\(/g) ?? []).length).toBe(2);
    // Exactly one direct write remains: the --hud-only early return, which
    // preserves the prior provider verbatim and therefore owes no convergence.
    // A third write in init.ts would reopen the gap this seam closes.
    expect((source.match(/await writeManifest\(/g) ?? []).length).toBe(1);
  });

  it('gates both wizard paths on the one shared shouldRunTrackerStep predicate', async () => {
    const source = await fs.readFile(INIT_SOURCE, 'utf-8');
    // One predicate call, inside runTrackerStepAt — and two paths reaching it.
    expect((source.match(/shouldRunTrackerStep\(\{/g) ?? []).length).toBe(1);
    expect((source.match(/runTrackerStepAt\(\n?\s*'recommended'/g) ?? []).length).toBe(1);
    expect((source.match(/runTrackerStepAt\('advanced'/g) ?? []).length).toBe(1);
    // One prompt-step invocation total: the shared helper, never a hand-copied
    // second call site.
    expect((source.match(/await runTrackerStep\(\{/g) ?? []).length).toBe(1);
  });
});

// ── resolveExistingAttributionSuppression ─────────────────────────────────────

describe('resolveExistingAttributionSuppression (D27)', () => {
  it('returns true when exact devflow attribution shape present', () => {
    const settings = JSON.stringify({ attribution: { commit: '', pr: '' } });
    expect(resolveExistingAttributionSuppression(settings)).toBe(true);
  });

  it('returns undefined when attribution key is absent', () => {
    const settings = JSON.stringify({ other: 'value' });
    expect(resolveExistingAttributionSuppression(settings)).toBeUndefined();
  });

  it('returns undefined for custom attribution object (shape guard)', () => {
    const settings = JSON.stringify({ attribution: { commit: 'My Org', pr: 'My Org' } });
    expect(resolveExistingAttributionSuppression(settings)).toBeUndefined();
  });

  it('returns undefined for string attribution (legacy/custom)', () => {
    const settings = JSON.stringify({ attribution: 'Devflow' });
    expect(resolveExistingAttributionSuppression(settings)).toBeUndefined();
  });

  it('returns undefined for attribution with extra keys (not exact shape)', () => {
    const settings = JSON.stringify({ attribution: { commit: '', pr: '', extra: 'value' } });
    expect(resolveExistingAttributionSuppression(settings)).toBeUndefined();
  });

  it('returns undefined for attribution with non-empty strings', () => {
    const settings = JSON.stringify({ attribution: { commit: 'x', pr: '' } });
    expect(resolveExistingAttributionSuppression(settings)).toBeUndefined();
  });

  it('returns undefined on malformed JSON', () => {
    expect(resolveExistingAttributionSuppression('not json')).toBeUndefined();
  });

  it('returns undefined for empty settings string', () => {
    expect(resolveExistingAttributionSuppression('')).toBeUndefined();
  });
});

// ── resolveInitSeed — suppress-attribution seeding ───────────────────────────

describe('resolveInitSeed — suppress-attribution seeding (D27)', () => {
  it('fresh install (null manifest) → suppress-attribution defaults to false', () => {
    const seed = resolveInitSeed(null, null, JSON.stringify({}), DEVFLOW_PLUGINS);
    expect(seed.flags['suppress-attribution']).toBe(false);
  });

  it('settings.json with exact devflow attribution → seeds true (overrides manifest false)', () => {
    const settings = JSON.stringify({ attribution: { commit: '', pr: '' } });
    const manifest = makeManifest({ features: { ...makeManifest().features, flags: { 'suppress-attribution': false } } });
    const seed = resolveInitSeed(manifest, null, settings, DEVFLOW_PLUGINS);
    expect(seed.flags['suppress-attribution']).toBe(true);
  });

  it('manifest has suppress-attribution:true, no exact settings shape → seeds true', () => {
    const manifest = makeManifest({
      features: { ...makeManifest().features, flags: { 'suppress-attribution': true } },
    });
    const seed = resolveInitSeed(manifest, null, JSON.stringify({}), DEVFLOW_PLUGINS);
    expect(seed.flags['suppress-attribution']).toBe(true);
  });

  it('custom attribution in settings, manifest flag false → seeds false (shape guard)', () => {
    const settings = JSON.stringify({ attribution: { commit: 'My Org', pr: 'My Org' } });
    const manifest = makeManifest({
      features: { ...makeManifest().features, flags: { 'suppress-attribution': false } },
    });
    const seed = resolveInitSeed(manifest, null, settings, DEVFLOW_PLUGINS);
    expect(seed.flags['suppress-attribution']).toBe(false);
  });

  it('--reset → suppress-attribution defaults to false even when settings has exact shape', () => {
    const settings = JSON.stringify({ attribution: { commit: '', pr: '' } });
    const { seedManifest, seedConfig, seedSettings } = resolveResetGatedInputs(
      true, makeManifest(), null, settings,
    );
    const seed = resolveInitSeed(seedManifest, seedConfig, seedSettings, DEVFLOW_PLUGINS);
    expect(seed.flags['suppress-attribution']).toBe(false);
  });

  it('manifest has suppress-attribution: null (ADR-014 deliberate unset) → resolves to false', () => {
    // ADR-014: null = known + deliberately unset. For this boolean flag, null and false
    // both delete the target settings key; the resolved seed must be exactly false.
    const manifest = makeManifest({
      features: { ...makeManifest().features, flags: { 'suppress-attribution': null, tui: true } },
    });
    const seed = resolveInitSeed(manifest, null, JSON.stringify({}), DEVFLOW_PLUGINS);
    expect(seed.flags['suppress-attribution']).toBe(false);
    // Non-vacuity (PF-018): neighbouring flag from prior manifest survives unchanged.
    expect(seed.flags['tui']).toBe(true);
  });
});
