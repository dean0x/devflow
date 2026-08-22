/**
 * Tests for src/cli/commands/compliance.ts
 *
 * Covers:
 *   - resolveComplianceCliAction pure resolver matrix
 *   - parseFrameworkList "Commander parse pin" (error message names every valid ID)
 *   - classifyDriftMissing invalid-ID classification
 *
 * Init-seed compliance seeding coverage (resolveSeedFeatures, applyCliToggles,
 * resolveResetGatedInputs) lives in tests/init-seed.test.ts — compliance seeding section.
 */
import { describe, it, expect } from 'vitest';
import {
  resolveComplianceCliAction,
  classifyDriftMissing,
} from '../src/cli/commands/compliance.js';
import {
  COMPLIANCE_FRAMEWORKS,
  parseFrameworkList,
} from '../src/core/compliance.js';

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
    // status is reporting only — messages must be empty (no enable/disable/set side-effect text)
    expect(result.nextState.enabled).toBe(false);
    expect(result.messages).toHaveLength(0);
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

// ── classifyDriftMissing — invalid-ID reporting path ─────────────────────────────

describe('classifyDriftMissing', () => {
  const REGISTRY = new Set(COMPLIANCE_FRAMEWORKS.map(fw => fw.id));

  it('all manifest IDs installed → both lists empty', () => {
    const result = classifyDriftMissing(['gdpr', 'hipaa'], ['gdpr', 'hipaa'], REGISTRY);
    expect(result.validMissing).toEqual([]);
    expect(result.invalidIds).toEqual([]);
  });

  it('valid ID in manifest not installed → validMissing (--enable can reconcile)', () => {
    const result = classifyDriftMissing(['gdpr', 'soc2'], ['gdpr'], REGISTRY);
    expect(result.validMissing).toEqual(['soc2']);
    expect(result.invalidIds).toEqual([]);
  });

  it('unknown ID in manifest → invalidIds (--set required to remove)', () => {
    const result = classifyDriftMissing(['gdpr', 'not-a-framework'], ['gdpr'], REGISTRY);
    expect(result.validMissing).toEqual([]);
    expect(result.invalidIds).toEqual(['not-a-framework']);
  });

  it('mixed: one valid missing + one invalid → split across both lists', () => {
    const result = classifyDriftMissing(
      ['gdpr', 'sox', 'hand-edited-id'],
      ['gdpr'],
      REGISTRY,
    );
    expect(result.validMissing).toEqual(['sox']);
    expect(result.invalidIds).toEqual(['hand-edited-id']);
  });

  it('empty manifest → both lists empty', () => {
    const result = classifyDriftMissing([], ['gdpr'], REGISTRY);
    expect(result.validMissing).toEqual([]);
    expect(result.invalidIds).toEqual([]);
  });

  it('all manifest IDs are invalid → validMissing empty, invalidIds lists all', () => {
    const result = classifyDriftMissing(['foo', 'bar'], [], REGISTRY);
    expect(result.validMissing).toEqual([]);
    expect(result.invalidIds).toEqual(['foo', 'bar']);
  });
});
