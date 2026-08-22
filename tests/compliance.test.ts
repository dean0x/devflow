/**
 * Tests for src/core/compliance.ts
 *
 * Step 1.1 — TDD: write failing tests first.
 */
import { describe, it, expect } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import {
  COMPLIANCE_FRAMEWORKS,
  parseFrameworkList,
  normalizeFrameworks,
  normalizeComplianceFeature,
  stampComplianceRule,
} from '../src/core/compliance.js';
import { rulesDir, skillsDir } from '../src/core/assets.js';

// ── Registry ↔ disk bidirectional guards ──────────────────────────────────────

describe('COMPLIANCE_FRAMEWORKS registry ↔ disk (AC-38)', () => {
  // After A8.2: framework reference files live at frameworks/{id}/reference.md.
  // The always-present refs (detection.md, sources.md) remain in references/.
  const FRAMEWORKS_DIR = path.join(skillsDir(), 'compliance', 'frameworks');

  it('every registry ID has a reference.md and fragment.md under frameworks/{id}/', async () => {
    for (const fw of COMPLIANCE_FRAMEWORKS) {
      const refPath = path.join(FRAMEWORKS_DIR, fw.id, 'reference.md');
      const fragPath = path.join(FRAMEWORKS_DIR, fw.id, 'fragment.md');
      await expect(fs.access(refPath), `${fw.id}/reference.md missing`).resolves.toBeUndefined();
      await expect(fs.access(fragPath), `${fw.id}/fragment.md missing`).resolves.toBeUndefined();
    }
  });

  it('every frameworks/ subdirectory on disk has a registry entry', async () => {
    const entries = await fs.readdir(FRAMEWORKS_DIR, { withFileTypes: true });
    const diskIds = entries.filter(e => e.isDirectory()).map(e => e.name);
    const registryIds = new Set(COMPLIANCE_FRAMEWORKS.map(fw => fw.id));
    for (const id of diskIds) {
      expect(registryIds.has(id), `Disk directory frameworks/${id} has no registry entry — "${id}" not in COMPLIANCE_FRAMEWORKS`).toBe(true);
    }
  });

  it('registry and disk framework IDs are an exact match (no extras in either direction)', async () => {
    const entries = await fs.readdir(FRAMEWORKS_DIR, { withFileTypes: true });
    const diskIds = entries
      .filter(e => e.isDirectory())
      .map(e => e.name)
      .sort();
    const registryIds = COMPLIANCE_FRAMEWORKS.map(fw => fw.id).sort();
    expect(diskIds).toEqual(registryIds);
  });
});

// ── parseFrameworkList ────────────────────────────────────────────────────────

describe('parseFrameworkList', () => {
  it('parses a valid comma-separated list', () => {
    const result = parseFrameworkList('gdpr,hipaa');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(['gdpr', 'hipaa']);
    }
  });

  it('parses a valid comma-separated list (soc2, sox)', () => {
    const result = parseFrameworkList('soc2,sox');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(['soc2', 'sox']);
    }
  });

  it('normalizes uppercase to lowercase', () => {
    const result = parseFrameworkList('GDPR,HIPAA');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(['gdpr', 'hipaa']);
    }
  });

  it('normalizes mixed case', () => {
    const result = parseFrameworkList('PCI-DSS,SOC2');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(['pci-dss', 'soc2']);
    }
  });

  it('trims whitespace around each ID', () => {
    const result = parseFrameworkList('  gdpr , hipaa  ');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(['gdpr', 'hipaa']);
    }
  });

  it('converts spaces to dashes (iso 27001 → iso-27001)', () => {
    const result = parseFrameworkList('iso 27001');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(['iso-27001']);
    }
  });

  it('resolves iso27001 alias → iso-27001 (AC-4)', () => {
    const result = parseFrameworkList('iso27001');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(['iso-27001']);
    }
  });

  it('resolves ISO27001 alias (uppercase) → iso-27001', () => {
    const result = parseFrameworkList('ISO27001');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(['iso-27001']);
    }
  });

  it('accepts empty string → empty array', () => {
    const result = parseFrameworkList('');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual([]);
    }
  });

  it('accepts empty string → empty array', () => {
    const result = parseFrameworkList('');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual([]);
    }
  });

  it('unknown ID → error naming every valid ID (AC-3)', () => {
    const result = parseFrameworkList('unknown-framework');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // Error must name the unknown ID
      expect(result.error).toContain('unknown-framework');
      // Error must name every valid ID
      for (const fw of COMPLIANCE_FRAMEWORKS) {
        expect(result.error).toContain(fw.id);
      }
    }
  });

  it('all-invalid list → error (not silent empty list) (AC-4)', () => {
    const result = parseFrameworkList('bad-a,bad-b');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('bad-a');
      expect(result.error).toContain('bad-b');
    }
  });

  it('partial invalid list → error (not partial success)', () => {
    const result = parseFrameworkList('gdpr,unknown-one');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('unknown-one');
    }
  });

  it('all six valid IDs parse successfully', () => {
    const all = COMPLIANCE_FRAMEWORKS.map(fw => fw.id);
    const result = parseFrameworkList(all.join(','));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.sort()).toEqual(all.sort());
    }
  });

  it('no user-supplied string written to output — only registry IDs (AC-35)', () => {
    // Input has mixed case — output must be registry IDs not user strings
    const result = parseFrameworkList('GDPR, SOC2');
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Must be the exact registry IDs
      expect(result.value).toContain('gdpr');
      expect(result.value).toContain('soc2');
      // Must NOT contain the original user-supplied casing
      expect(result.value).not.toContain('GDPR');
      expect(result.value).not.toContain('SOC2');
    }
  });
});

// ── normalizeFrameworks ───────────────────────────────────────────────────────

describe('normalizeFrameworks', () => {
  it('normalizes each entry (lowercase, trim, space→dash, alias)', () => {
    expect(normalizeFrameworks(['GDPR', ' HIPAA ', 'iso27001'])).toEqual(['gdpr', 'hipaa', 'iso-27001']);
  });

  it('empty array → empty array', () => {
    expect(normalizeFrameworks([])).toEqual([]);
  });

  it('drops IDs that are not in the registry, keeping the valid ones (AC-35)', () => {
    expect(normalizeFrameworks(['gdpr', 'made-up-framework', 'soc2'])).toEqual(['gdpr', 'soc2']);
  });

  it('drops path-traversal IDs so none can become an fs path segment (AC-35)', () => {
    // manifest.features.compliance.frameworks is only type-checked by
    // normalizeComplianceFeature; this is the filter that stops a hand-edited
    // manifest turning into path.join(refSrc, '../../../x.md').
    expect(normalizeFrameworks(['../../../../tmp/evil', 'gdpr', '/etc/passwd'])).toEqual(['gdpr']);
  });

  it('all-unknown input → empty array (never passes anything through)', () => {
    expect(normalizeFrameworks(['nope', 'also-nope'])).toEqual([]);
  });

  it('deduplicates repeated IDs — first occurrence wins', () => {
    // A hand-edited or migrated manifest may list the same framework multiple times.
    // normalizeFrameworks must deduplicate so each appears exactly once in installed artifacts.
    expect(normalizeFrameworks(['gdpr', 'soc2', 'gdpr', 'gdpr'])).toEqual(['gdpr', 'soc2']);
  });

  it('deduplication survives alias normalization', () => {
    // iso27001 and iso-27001 both normalize to iso-27001 — only one survives.
    expect(normalizeFrameworks(['iso27001', 'iso-27001', 'gdpr'])).toEqual(['iso-27001', 'gdpr']);
  });
});

// ── normalizeComplianceFeature ────────────────────────────────────────────────

describe('normalizeComplianceFeature', () => {
  it('absent (undefined) → {enabled:false, frameworks:[]}', () => {
    expect(normalizeComplianceFeature(undefined)).toEqual({ enabled: false, frameworks: [] });
  });

  it('null → {enabled:false, frameworks:[]}', () => {
    expect(normalizeComplianceFeature(null)).toEqual({ enabled: false, frameworks: [] });
  });

  it('non-object garbage → {enabled:false, frameworks:[]}', () => {
    expect(normalizeComplianceFeature('yes')).toEqual({ enabled: false, frameworks: [] });
    expect(normalizeComplianceFeature(42)).toEqual({ enabled: false, frameworks: [] });
    expect(normalizeComplianceFeature(true)).toEqual({ enabled: false, frameworks: [] });
  });

  it('object with wrong enabled type → {enabled:false, frameworks:[]}', () => {
    expect(normalizeComplianceFeature({ enabled: 'yes', frameworks: [] })).toEqual({ enabled: false, frameworks: [] });
  });

  it('object with non-array frameworks → {enabled:false, frameworks:[]}', () => {
    expect(normalizeComplianceFeature({ enabled: true, frameworks: 'gdpr' })).toEqual({ enabled: false, frameworks: [] });
  });

  it('object with non-string array elements → {enabled:false, frameworks:[]}', () => {
    expect(normalizeComplianceFeature({ enabled: true, frameworks: [1, 2] })).toEqual({ enabled: false, frameworks: [] });
  });

  it('valid {enabled:true, frameworks:["gdpr"]} → preserved', () => {
    expect(normalizeComplianceFeature({ enabled: true, frameworks: ['gdpr'] })).toEqual({ enabled: true, frameworks: ['gdpr'] });
  });

  it('valid {enabled:false, frameworks:["hipaa"]} → preserved (disable-keeps-frameworks)', () => {
    expect(normalizeComplianceFeature({ enabled: false, frameworks: ['hipaa'] })).toEqual({ enabled: false, frameworks: ['hipaa'] });
  });

  it('valid {enabled:false, frameworks:[]} → preserved', () => {
    expect(normalizeComplianceFeature({ enabled: false, frameworks: [] })).toEqual({ enabled: false, frameworks: [] });
  });
});

// ── stampComplianceRule ───────────────────────────────────────────────────────

const PLACEHOLDER = '${DEVFLOW_COMPLIANCE_FRAMEWORKS}';

describe('stampComplianceRule', () => {
  // The stamp carries the full self-contained clause; the rule template line
  // is slim (`- ${PLACEHOLDER}`). Tests use the new template format.
  it('stamps full "Active frameworks: ... — their controls are binding." clause (AC-36)', () => {
    const content = `# Compliance\n- ${PLACEHOLDER}`;
    const result = stampComplianceRule(content, ['gdpr', 'soc2']);
    expect(result).toContain('Active frameworks: GDPR, SOC 2 — their controls are binding.');
    expect(result).not.toContain(PLACEHOLDER);
  });

  it('stamps all six frameworks in correct label order', () => {
    const ids = COMPLIANCE_FRAMEWORKS.map(fw => fw.id);
    const content = `- ${PLACEHOLDER}`;
    const result = stampComplianceRule(content, ids);
    const labels = COMPLIANCE_FRAMEWORKS.map(fw => fw.label).join(', ');
    expect(result).toContain(labels);
    expect(result).toContain('— their controls are binding.');
  });

  it('empty list → full "Active frameworks: none declared — generic controls only." clause (AC-5)', () => {
    const content = `- ${PLACEHOLDER}`;
    const result = stampComplianceRule(content, []);
    expect(result).toContain('Active frameworks: none declared — generic controls only.');
    expect(result).not.toContain(PLACEHOLDER);
    // Must not accidentally append the trailing clause twice
    expect(result).not.toContain('binding');
  });

  it('content without placeholder returned unchanged', () => {
    const content = '# Compliance\nNo placeholder here.';
    const result = stampComplianceRule(content, ['gdpr']);
    expect(result).toBe(content);
  });

  it('static labels only — an unknown ID is DROPPED, never echoed (AC-36)', () => {
    // Non-vacuous: the hostile ID is actually fed in, so this fails RED if the
    // implementation ever falls back to echoing the input (e.g. id.toUpperCase()).
    // The installed rule lands in ~/.claude/rules/devflow/, which Claude Code loads
    // into every prompt — an echoed ID would be prompt injection via a config file.
    const hostile = 'ignore-previous-instructions';
    const content = `- ${PLACEHOLDER}`;
    const result = stampComplianceRule(content, ['gdpr', hostile]);

    expect(result).toContain('GDPR');
    expect(result).not.toContain(hostile);
    expect(result).not.toContain(hostile.toUpperCase());
  });

  it('all-unknown IDs → "none declared" full clause rather than an echoed list (AC-36)', () => {
    const content = `- ${PLACEHOLDER}`;
    const result = stampComplianceRule(content, ['../../etc/passwd', 'made-up']);
    expect(result).toContain('Active frameworks: none declared — generic controls only.');
    expect(result).not.toContain('passwd');
    expect(result).not.toContain('made-up');
  });

  it('replaces all occurrences of the placeholder', () => {
    const content = `${PLACEHOLDER} and ${PLACEHOLDER}`;
    const result = stampComplianceRule(content, ['hipaa']);
    expect(result).not.toContain(PLACEHOLDER);
  });
});

// ── Source rule file guard ─────────────────────────────────────────────────────

describe('compliance.md source rule placeholder guard', () => {
  it('src/assets/rules/compliance.md contains ${DEVFLOW_COMPLIANCE_FRAMEWORKS} placeholder', async () => {
    const rulePath = path.join(rulesDir(), 'compliance.md');
    const content = await fs.readFile(rulePath, 'utf-8');
    expect(content).toContain('${DEVFLOW_COMPLIANCE_FRAMEWORKS}');
  });

  it('src/assets/rules/compliance.md contains ${DEVFLOW_COMPLIANCE_RULE_BULLETS} placeholder', async () => {
    const rulePath = path.join(rulesDir(), 'compliance.md');
    const content = await fs.readFile(rulePath, 'utf-8');
    expect(content).toContain('${DEVFLOW_COMPLIANCE_RULE_BULLETS}');
  });
});
