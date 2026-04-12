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
    // No Status line before next heading — should count as active
    // Actually, the regex looks for the NEXT Status line. If there's none,
    // statusMatch will be null, so it counts as active.
    expect(helpers.countActiveHeadings(content, 'decision')).toBe(1);
  });
});

describe('crossedThresholds', () => {
  it('returns empty for no change', () => {
    expect(helpers.crossedThresholds(50, 50)).toEqual([]);
  });

  it('returns empty for decrease', () => {
    expect(helpers.crossedThresholds(60, 55)).toEqual([]);
  });

  it('returns single threshold crossing', () => {
    expect(helpers.crossedThresholds(49, 50)).toEqual([50]);
  });

  it('returns multiple threshold crossings', () => {
    expect(helpers.crossedThresholds(49, 61)).toEqual([50, 60]);
  });

  it('handles fine-grained thresholds above 90', () => {
    expect(helpers.crossedThresholds(90, 93)).toEqual([91, 92, 93]);
  });

  it('caps at 100', () => {
    expect(helpers.crossedThresholds(99, 105)).toEqual([100]);
  });
});

describe('usage file read/write', () => {
  let tmpDir: string;
  let memoryDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-test-'));
    memoryDir = path.join(tmpDir, '.memory');
    fs.mkdirSync(memoryDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns default when file missing', () => {
    const data = helpers.readUsageFile(memoryDir);
    expect(data).toEqual({ version: 1, entries: {} });
  });

  it('round-trips data', () => {
    const data = { version: 1, entries: { 'ADR-001': { cites: 3, last_cited: '2026-01-01', created: '2026-01-01' } } };
    helpers.writeUsageFile(memoryDir, data);
    const read = helpers.readUsageFile(memoryDir);
    expect(read).toEqual(data);
  });
});

describe('notifications read/write', () => {
  let tmpDir: string;
  let memoryDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notif-test-'));
    memoryDir = path.join(tmpDir, '.memory');
    fs.mkdirSync(memoryDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns empty object when file missing', () => {
    expect(helpers.readNotifications(memoryDir)).toEqual({});
  });

  it('round-trips notification data', () => {
    const data = { 'knowledge-capacity-decisions': { active: true, threshold: 50, count: 50, ceiling: 100 } };
    helpers.writeNotifications(memoryDir, data);
    expect(helpers.readNotifications(memoryDir)).toEqual(data);
  });
});

describe('registerUsageEntry', () => {
  let tmpDir: string;
  let memoryDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-test-'));
    memoryDir = path.join(tmpDir, '.memory');
    fs.mkdirSync(memoryDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates entry with zero cites', () => {
    helpers.registerUsageEntry(memoryDir, 'ADR-001');
    const data = helpers.readUsageFile(memoryDir);
    expect(data.entries['ADR-001'].cites).toBe(0);
    expect(data.entries['ADR-001'].last_cited).toBeNull();
    expect(data.entries['ADR-001'].created).toBeTruthy();
  });

  it('does not overwrite existing entry', () => {
    const existing = { version: 1, entries: { 'ADR-001': { cites: 5, last_cited: '2026-01-01', created: '2026-01-01' } } };
    helpers.writeUsageFile(memoryDir, existing);
    helpers.registerUsageEntry(memoryDir, 'ADR-001');
    const data = helpers.readUsageFile(memoryDir);
    expect(data.entries['ADR-001'].cites).toBe(5);
  });
});
