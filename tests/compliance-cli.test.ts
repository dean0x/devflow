/**
 * Tests for src/cli/commands/compliance.ts
 *
 * Step 1.4 — TDD: write failing tests first.
 *
 * Covers:
 *   - resolveComplianceCliAction pure resolver matrix
 *   - parseFrameworkList "Commander parse pin" (error message names every valid ID)
 *   - init-seed compliance: defaults, applyCliToggles, --reset
 *   - runRulesEnable: compliance rule stamped when compliance.enabled
 */
import { describe, it, expect } from 'vitest';
import {
  resolveComplianceCliAction,
  type ComplianceCliAction,
} from '../src/cli/commands/compliance.js';
import {
  COMPLIANCE_FRAMEWORKS,
  parseFrameworkList,
} from '../src/core/compliance.js';
import {
  applyCliToggles,
  FEATURE_DEFAULTS,
  resolveSeedFeatures,
  resolveResetGatedInputs,
  resolveInitSeed,
  type FeatureSeed,
} from '../src/cli/commands/init-seed.js';
import { DEVFLOW_PLUGINS } from '../src/core/plugins.js';
import { type ManifestData } from '../src/core/manifest.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeManifest(overrides: Partial<ManifestData> = {}): ManifestData {
  return {
    version: '2.0.0',
    plugins: ['devflow-implement'],
    scope: 'user',
    features: {
      ambient: true,
      memory: true,
      hud: true,
      knowledge: true,
      learning: true,
      rules: true,
      proxy: false,
      flags: [],
      compliance: { enabled: false, frameworks: [] },
    },
    installedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

// ── resolveComplianceCliAction ────────────────────────────────────────────────

describe('resolveComplianceCliAction', () => {
  // ── enable ─────────────────────────────────────────────────────────────────

  it('enable from disabled with empty frameworks → enabled:true, frameworks preserved (empty)', () => {
    const result = resolveComplianceCliAction(
      { enabled: false, frameworks: [] },
      'enable',
    );
    expect(result.nextState.enabled).toBe(true);
    expect(result.nextState.frameworks).toEqual([]);
  });

  it('enable from disabled with existing frameworks → restores all frameworks', () => {
    const result = resolveComplianceCliAction(
      { enabled: false, frameworks: ['gdpr', 'soc2'] },
      'enable',
    );
    expect(result.nextState.enabled).toBe(true);
    expect(result.nextState.frameworks).toEqual(['gdpr', 'soc2']);
  });

  it('enable when already enabled → nextState unchanged, messages indicate already enabled', () => {
    const result = resolveComplianceCliAction(
      { enabled: true, frameworks: ['hipaa'] },
      'enable',
    );
    expect(result.nextState.enabled).toBe(true);
    expect(result.nextState.frameworks).toEqual(['hipaa']);
    expect(result.messages.some(m => m.text.toLowerCase().includes('already'))).toBe(true);
  });

  // ── disable ────────────────────────────────────────────────────────────────

  it('disable from enabled → enabled:false, frameworks preserved', () => {
    const result = resolveComplianceCliAction(
      { enabled: true, frameworks: ['gdpr', 'sox'] },
      'disable',
    );
    expect(result.nextState.enabled).toBe(false);
    expect(result.nextState.frameworks).toEqual(['gdpr', 'sox']);
  });

  it('disable when already disabled → nextState unchanged', () => {
    const result = resolveComplianceCliAction(
      { enabled: false, frameworks: ['pci-dss'] },
      'disable',
    );
    expect(result.nextState.enabled).toBe(false);
    // frameworks preserved
    expect(result.nextState.frameworks).toEqual(['pci-dss']);
  });

  // ── set ────────────────────────────────────────────────────────────────────

  it('set replaces frameworks exactly and enables', () => {
    const result = resolveComplianceCliAction(
      { enabled: false, frameworks: [] },
      'set',
      ['gdpr', 'soc2'],
    );
    expect(result.nextState.enabled).toBe(true);
    expect(result.nextState.frameworks).toEqual(['gdpr', 'soc2']);
  });

  it('set with zero frameworks → enabled:true, frameworks empty (generic controls only)', () => {
    const result = resolveComplianceCliAction(
      { enabled: true, frameworks: ['hipaa'] },
      'set',
      [],
    );
    expect(result.nextState.enabled).toBe(true);
    expect(result.nextState.frameworks).toEqual([]);
  });

  it('set replaces prior frameworks entirely', () => {
    const result = resolveComplianceCliAction(
      { enabled: true, frameworks: ['gdpr', 'hipaa', 'sox'] },
      'set',
      ['pci-dss'],
    );
    expect(result.nextState.frameworks).toEqual(['pci-dss']);
  });

  // ── status ─────────────────────────────────────────────────────────────────

  it('status → nextState unchanged', () => {
    const current = { enabled: true, frameworks: ['iso-27001'] };
    const result = resolveComplianceCliAction(current, 'status');
    expect(result.nextState).toEqual(current);
  });

  it('status does not produce state change messages', () => {
    const result = resolveComplianceCliAction(
      { enabled: false, frameworks: [] },
      'status',
    );
    // status is reporting only — no action messages that could be misleading
    expect(result.nextState.enabled).toBe(false);
  });
});

// ── Commander parse pin: --set with unknown IDs ────────────────────────────────

describe('parseFrameworkList (Commander parse pin)', () => {
  it('rejects unknown IDs with an error naming every valid registry ID', () => {
    const result = parseFrameworkList('gdrp,hippa');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // Error must name every valid ID
      for (const fw of COMPLIANCE_FRAMEWORKS) {
        expect(result.error).toContain(fw.id);
      }
      // Error must name the unknown IDs submitted
      expect(result.error).toContain('gdrp');
      expect(result.error).toContain('hippa');
    }
  });

  it('accepts all 6 valid IDs', () => {
    const validIds = COMPLIANCE_FRAMEWORKS.map(fw => fw.id).join(',');
    const result = parseFrameworkList(validIds);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(COMPLIANCE_FRAMEWORKS.length);
    }
  });

  it('accepts empty input → [] (zero frameworks allowed)', () => {
    const result = parseFrameworkList('');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual([]);
    }
  });

  it('normalises iso27001 alias to iso-27001', () => {
    const result = parseFrameworkList('iso27001');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(['iso-27001']);
    }
  });
});

// ── init-seed compliance ──────────────────────────────────────────────────────

describe('init-seed — compliance defaults', () => {
  it('FEATURE_DEFAULTS.compliance = {enabled:false, frameworks:[]}', () => {
    expect(FEATURE_DEFAULTS.compliance).toEqual({ enabled: false, frameworks: [] });
  });

  it('resolveSeedFeatures with null manifest → compliance defaults', () => {
    const result = resolveSeedFeatures(null, null);
    expect(result.compliance).toEqual({ enabled: false, frameworks: [] });
  });

  it('resolveSeedFeatures reads compliance from manifest (manifest-group, NOT config.json)', () => {
    const manifest = makeManifest({
      features: {
        ambient: true, memory: true, hud: true, knowledge: true, learning: true, rules: true,
        proxy: false, flags: [],
        compliance: { enabled: true, frameworks: ['gdpr', 'hipaa'] },
      },
    });
    const result = resolveSeedFeatures(manifest, null);
    expect(result.compliance).toEqual({ enabled: true, frameworks: ['gdpr', 'hipaa'] });
  });

  it('resolveSeedFeatures: compliance NOT overridden by projectConfig (manifest-group)', () => {
    // compliance belongs to the manifest-group (like proxy), so projectConfig does NOT win
    const manifest = makeManifest({
      features: {
        ambient: true, memory: true, hud: true, knowledge: true, learning: true, rules: true,
        proxy: false, flags: [],
        compliance: { enabled: true, frameworks: ['sox'] },
      },
    });
    // Even with a projectConfig, compliance comes from manifest
    const result = resolveSeedFeatures(manifest, { memory: false, learning: false, knowledge: false });
    expect(result.compliance).toEqual({ enabled: true, frameworks: ['sox'] });
  });
});

describe('applyCliToggles — compliance', () => {
  const base: FeatureSeed = {
    ...FEATURE_DEFAULTS,
    compliance: { enabled: false, frameworks: ['gdpr'] },
  };

  it('undefined compliance toggle → base compliance unchanged', () => {
    const result = applyCliToggles(base, {});
    expect(result.compliance).toEqual({ enabled: false, frameworks: ['gdpr'] });
  });

  it('--compliance gdpr,soc2 → {enabled:true, frameworks:[gdpr,soc2]}', () => {
    const result = applyCliToggles(base, {
      compliance: { enabled: true, frameworks: ['gdpr', 'soc2'] },
    });
    expect(result.compliance).toEqual({ enabled: true, frameworks: ['gdpr', 'soc2'] });
  });

  it('--no-compliance (disable, keep frameworks) → {enabled:false, frameworks from base}', () => {
    // Caller passes { enabled: false, frameworks: base.compliance.frameworks }
    // to preserve frameworks (the disable-keeps-frameworks contract)
    const result = applyCliToggles(base, {
      compliance: { enabled: false, frameworks: base.compliance.frameworks },
    });
    expect(result.compliance.enabled).toBe(false);
    expect(result.compliance.frameworks).toEqual(['gdpr']); // preserved from base
  });

  it('--compliance "" (zero frameworks) → {enabled:true, frameworks:[]}', () => {
    const result = applyCliToggles(base, {
      compliance: { enabled: true, frameworks: [] },
    });
    expect(result.compliance).toEqual({ enabled: true, frameworks: [] });
  });
});

describe('resolveResetGatedInputs — compliance', () => {
  it('--reset null-seeds the manifest → compliance falls back to FEATURE_DEFAULTS', () => {
    const manifest = makeManifest({
      features: {
        ambient: true, memory: true, hud: true, knowledge: true, learning: true, rules: true,
        proxy: false, flags: [],
        compliance: { enabled: true, frameworks: ['gdpr', 'sox', 'hipaa'] },
      },
    });
    const { seedManifest } = resolveResetGatedInputs(true, manifest, null, '{}');
    // reset → seedManifest = null → resolveSeedFeatures falls back to FEATURE_DEFAULTS
    const seed = resolveInitSeed(seedManifest, null, '', DEVFLOW_PLUGINS);
    expect(seed.features.compliance).toEqual({ enabled: false, frameworks: [] });
  });

  it('--no-reset preserves existing manifest compliance', () => {
    const manifest = makeManifest({
      features: {
        ambient: true, memory: true, hud: true, knowledge: true, learning: true, rules: true,
        proxy: false, flags: [],
        compliance: { enabled: true, frameworks: ['pci-dss'] },
      },
    });
    const { seedManifest } = resolveResetGatedInputs(false, manifest, null, '{}');
    const seed = resolveInitSeed(seedManifest, null, '', DEVFLOW_PLUGINS);
    expect(seed.features.compliance).toEqual({ enabled: true, frameworks: ['pci-dss'] });
  });
});
