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
  const REFERENCES_DIR = path.join(skillsDir(), 'compliance', 'references');
  const EXCLUDED_REFS = new Set(['detection.md', 'sources.md']);

  it('every registry ID has a reference file on disk', async () => {
    for (const fw of COMPLIANCE_FRAMEWORKS) {
      const refPath = path.join(REFERENCES_DIR, `${fw.id}.md`);
      await expect(fs.access(refPath)).resolves.toBeUndefined();
    }
  });

  it('every framework reference file on disk (excluding detection/sources) has a registry entry', async () => {
    const files = await fs.readdir(REFERENCES_DIR);
    const frameworkFiles = files.filter(f => f.endsWith('.md') && !EXCLUDED_REFS.has(f));
    const registryIds = new Set(COMPLIANCE_FRAMEWORKS.map(fw => fw.id));
    for (const file of frameworkFiles) {
      const id = file.replace(/\.md$/, '');
      expect(registryIds.has(id), `Disk file ${file} has no registry entry — id "${id}" not in COMPLIANCE_FRAMEWORKS`).toBe(true);
    }
  });

  it('registry and disk framework IDs are an exact match (no extras in either direction)', async () => {
    const files = await fs.readdir(REFERENCES_DIR);
    const frameworkFiles = files
      .filter(f => f.endsWith('.md') && !EXCLUDED_REFS.has(f))
      .map(f => f.replace(/\.md$/, ''))
      .sort();
    const registryIds = COMPLIANCE_FRAMEWORKS.map(fw => fw.id).sort();
    expect(frameworkFiles).toEqual(registryIds);
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

  it('parses a valid string array', () => {
    const result = parseFrameworkList(['soc2', 'sox']);
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

  it('accepts empty array → empty array', () => {
    const result = parseFrameworkList([]);
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
    const result = parseFrameworkList(['bad-a', 'bad-b']);
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
    const result = parseFrameworkList(all);
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
  it('stamps comma-joined static registry labels (AC-36)', () => {
    const content = `# Compliance\n- Active frameworks: ${PLACEHOLDER} — their controls are binding.`;
    const result = stampComplianceRule(content, ['gdpr', 'soc2']);
    expect(result).toContain('GDPR, SOC 2');
    expect(result).not.toContain(PLACEHOLDER);
  });

  it('stamps all six frameworks in correct label order', () => {
    const ids = COMPLIANCE_FRAMEWORKS.map(fw => fw.id);
    const content = `prefix ${PLACEHOLDER} suffix`;
    const result = stampComplianceRule(content, ids);
    const labels = COMPLIANCE_FRAMEWORKS.map(fw => fw.label).join(', ');
    expect(result).toContain(labels);
  });

  it('empty list → "none declared — generic controls only" (AC-5)', () => {
    const content = `Active: ${PLACEHOLDER}`;
    const result = stampComplianceRule(content, []);
    expect(result).toContain('none declared — generic controls only');
    expect(result).not.toContain(PLACEHOLDER);
  });

  it('content without placeholder returned unchanged', () => {
    const content = '# Compliance\nNo placeholder here.';
    const result = stampComplianceRule(content, ['gdpr']);
    expect(result).toBe(content);
  });

  it('static labels only — no user input echoed into output (AC-36)', () => {
    // Even if the user somehow passes a weird ID, only registry labels appear
    // (parseFrameworkList already validates, so this tests stampComplianceRule in isolation)
    const content = `Active: ${PLACEHOLDER}`;
    const result = stampComplianceRule(content, ['gdpr']);
    expect(result).not.toContain('user-input');
    expect(result).toContain('GDPR');
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
});
