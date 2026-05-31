// tests/learning/capacity-thresholds.test.ts
// Tests for countActiveHeadings, usage file read/write, and registerUsageEntry.
// Phase 3: capacity notification tests and render-ready capacity integration removed
// (capacity enforcement was part of the deterministic judgment layer, now replaced by LLM).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// json-helper.cjs is a CJS script — require it for the exported helpers
// @ts-expect-error — CJS module without type declarations
const helpers = require('../../scripts/hooks/json-helper.cjs');

describe('countActiveHeadings', () => {
  it('counts only active decision headings', () => {
    const content = [
      '# Decisions',
      '## ADR-001: Active',
      '- **Status**: Accepted',
      '## ADR-002: Deprecated',
      '- **Status**: Deprecated',
      '## ADR-003: Also Active',
      '- **Status**: Accepted',
    ].join('\n');
    expect(helpers.countActiveHeadings(content, 'decision')).toBe(2);
  });

  it('counts only active pitfall headings', () => {
    const content = [
      '# Pitfalls',
      '## PF-001: Active pitfall',
      '- **Status**: Active',
      '## PF-002: Old pitfall',
      '- **Status**: Deprecated',
    ].join('\n');
    expect(helpers.countActiveHeadings(content, 'pitfall')).toBe(1);
  });

  it('excludes Superseded entries', () => {
    const content = [
      '## ADR-001: Old',
      '- **Status**: Superseded',
      '## ADR-002: Current',
      '- **Status**: Accepted',
    ].join('\n');
    expect(helpers.countActiveHeadings(content, 'decision')).toBe(1);
  });

  it('returns 0 for empty content', () => {
    expect(helpers.countActiveHeadings('', 'decision')).toBe(0);
  });

  it('counts headings with no Status field as active', () => {
    const content = '## ADR-001: No status\n- **Date**: 2026-01-01\n';
    expect(helpers.countActiveHeadings(content, 'decision')).toBe(1);
  });

  it('does not bleed status from a later entry into an earlier one', () => {
    const content = [
      '## ADR-001: Active without Status field',
      '- **Date**: 2026-01-01',
      '- **Context**: something',
      '',
      '## ADR-002: Deprecated entry',
      '- **Date**: 2026-01-01',
      '- **Status**: Deprecated',
    ].join('\n');
    expect(helpers.countActiveHeadings(content, 'decision')).toBe(1);
  });
});

describe('usage file read/write', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-test-'));
    fs.mkdirSync(path.join(tmpDir, '.devflow', 'decisions'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns default when file missing', () => {
    const data = helpers.readUsageFile(tmpDir);
    expect(data).toEqual({ version: 1, entries: {} });
  });

  it('round-trips data', () => {
    const data = { version: 1, entries: { 'ADR-001': { cites: 3, last_cited: '2026-01-01', created: '2026-01-01' } } };
    helpers.writeUsageFile(tmpDir, data);
    const read = helpers.readUsageFile(tmpDir);
    expect(read).toEqual(data);
  });
});

describe('registerUsageEntry', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-test-'));
    fs.mkdirSync(path.join(tmpDir, '.devflow', 'decisions'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates entry with zero cites', () => {
    helpers.registerUsageEntry(tmpDir, 'ADR-001');
    const data = helpers.readUsageFile(tmpDir);
    expect(data.entries['ADR-001'].cites).toBe(0);
    expect(data.entries['ADR-001'].last_cited).toBeNull();
    expect(data.entries['ADR-001'].created).toBeTruthy();
  });

  it('does not overwrite existing entry', () => {
    const existing = { version: 1, entries: { 'ADR-001': { cites: 5, last_cited: '2026-01-01', created: '2026-01-01' } } };
    helpers.writeUsageFile(tmpDir, existing);
    helpers.registerUsageEntry(tmpDir, 'ADR-001');
    const data = helpers.readUsageFile(tmpDir);
    expect(data.entries['ADR-001'].cites).toBe(5);
  });
});
