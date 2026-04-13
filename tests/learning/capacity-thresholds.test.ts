import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runHelper } from './helpers.js';

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
    // Regression: when entry N has no Status line, the lookup must not find
    // entry N+1's Deprecated status and incorrectly skip entry N.
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

describe('render-ready capacity integration', () => {
  let tmpDir: string;
  let logFile: string;
  let knowledgeDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-integ-'));
    knowledgeDir = path.join(tmpDir, '.memory', 'knowledge');
    fs.mkdirSync(knowledgeDir, { recursive: true });
    logFile = path.join(tmpDir, 'learning-log.jsonl');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeReadyDecision(id: string, pattern: string) {
    return {
      id, type: 'decision', pattern,
      confidence: 0.95, observations: 3, status: 'ready',
      first_seen: '2026-01-01T00:00:00Z', last_seen: '2026-04-01T00:00:00Z',
      evidence: ['e1', 'e2', 'e3'], quality_ok: true,
      details: 'context: test; decision: test; rationale: test',
    };
  }

  it('appending at 49→50 succeeds and fires notification', () => {
    const header = '<!-- TL;DR: 49 decisions. Key: ADR-049 -->\n# Architectural Decisions\n\nAppend-only.\n';
    let entries = '';
    for (let i = 1; i <= 49; i++) {
      const n = i.toString().padStart(3, '0');
      entries += `\n## ADR-${n}: entry ${i}\n\n- **Date**: 2026-01-01\n- **Status**: Accepted\n- **Source**: test\n`;
    }
    fs.writeFileSync(path.join(knowledgeDir, 'decisions.md'), header + entries);
    const obs = makeReadyDecision('obs_at49', 'crossing 50');
    fs.writeFileSync(logFile, JSON.stringify(obs) + '\n');

    const result = JSON.parse(runHelper(`render-ready "${logFile}" "${tmpDir}"`));
    expect(result.rendered).toHaveLength(1);

    const notifPath = path.join(tmpDir, '.memory', '.notifications.json');
    expect(fs.existsSync(notifPath)).toBe(true);
    const notif = JSON.parse(fs.readFileSync(notifPath, 'utf8'));
    expect(notif['knowledge-capacity-decisions'].active).toBe(true);
    expect(notif['knowledge-capacity-decisions'].threshold).toBe(50);
  });

  it('appending at 99→100 succeeds (ceiling not yet hit)', () => {
    const header = '<!-- TL;DR: 99 decisions. Key: ADR-099 -->\n# Architectural Decisions\n\nAppend-only.\n';
    let entries = '';
    for (let i = 1; i <= 99; i++) {
      const n = i.toString().padStart(3, '0');
      entries += `\n## ADR-${n}: entry ${i}\n\n- **Date**: 2026-01-01\n- **Status**: Accepted\n- **Source**: test\n`;
    }
    fs.writeFileSync(path.join(knowledgeDir, 'decisions.md'), header + entries);
    const obs = makeReadyDecision('obs_at99', 'the 100th entry');
    fs.writeFileSync(logFile, JSON.stringify(obs) + '\n');

    const result = JSON.parse(runHelper(`render-ready "${logFile}" "${tmpDir}"`));
    expect(result.rendered).toHaveLength(1);
  });

  it('skips at 100 (hard ceiling)', () => {
    const header = '<!-- TL;DR: 100 decisions. Key: ADR-100 -->\n# Architectural Decisions\n\nAppend-only.\n';
    let entries = '';
    for (let i = 1; i <= 100; i++) {
      const n = i.toString().padStart(3, '0');
      entries += `\n## ADR-${n}: entry ${i}\n\n- **Date**: 2026-01-01\n- **Status**: Accepted\n- **Source**: test\n`;
    }
    fs.writeFileSync(path.join(knowledgeDir, 'decisions.md'), header + entries);
    const obs = makeReadyDecision('obs_past100', 'should be blocked');
    fs.writeFileSync(logFile, JSON.stringify(obs) + '\n');

    const result = JSON.parse(runHelper(`render-ready "${logFile}" "${tmpDir}"`));
    expect(result.skipped).toBe(1);

    const updated = JSON.parse(fs.readFileSync(logFile, 'utf8').trim());
    expect(updated.softCapExceeded).toBe(true);
  });

  it('deprecated entries do not count toward capacity (D18)', () => {
    const header = '<!-- TL;DR: 100 decisions. Key: ADR-100 -->\n# Architectural Decisions\n\nAppend-only.\n';
    let entries = '';
    for (let i = 1; i <= 100; i++) {
      const n = i.toString().padStart(3, '0');
      // Make 5 entries Deprecated — effective active count = 95
      const status = i <= 5 ? 'Deprecated' : 'Accepted';
      entries += `\n## ADR-${n}: entry ${i}\n\n- **Date**: 2026-01-01\n- **Status**: ${status}\n- **Source**: test\n`;
    }
    fs.writeFileSync(path.join(knowledgeDir, 'decisions.md'), header + entries);
    const obs = makeReadyDecision('obs_deprecated_gap', 'should succeed because deprecated entries free slots');
    fs.writeFileSync(logFile, JSON.stringify(obs) + '\n');

    const result = JSON.parse(runHelper(`render-ready "${logFile}" "${tmpDir}"`));
    // Active count is 95, which is < 100, so entry should succeed
    expect(result.rendered).toHaveLength(1);
  });

  it('first-run seed fires notification immediately (D21)', () => {
    // Simulate a project that already has 60 entries but no .notifications.json
    const header = '<!-- TL;DR: 60 decisions. Key: ADR-060 -->\n# Architectural Decisions\n\nAppend-only.\n';
    let entries = '';
    for (let i = 1; i <= 60; i++) {
      const n = i.toString().padStart(3, '0');
      entries += `\n## ADR-${n}: entry ${i}\n\n- **Date**: 2026-01-01\n- **Status**: Accepted\n- **Source**: test\n`;
    }
    fs.writeFileSync(path.join(knowledgeDir, 'decisions.md'), header + entries);
    // No .notifications.json exists (first-run)

    const obs = makeReadyDecision('obs_seed', 'triggering seed');
    fs.writeFileSync(logFile, JSON.stringify(obs) + '\n');

    const result = JSON.parse(runHelper(`render-ready "${logFile}" "${tmpDir}"`));
    expect(result.rendered).toHaveLength(1);

    // Notification should fire for the highest crossed threshold
    const notifPath = path.join(tmpDir, '.memory', '.notifications.json');
    expect(fs.existsSync(notifPath)).toBe(true);
    const notif = JSON.parse(fs.readFileSync(notifPath, 'utf8'));
    expect(notif['knowledge-capacity-decisions'].active).toBe(true);
    // After seed, previous_count = 0 so all thresholds up to 61 fire
    expect(notif['knowledge-capacity-decisions'].threshold).toBe(60);
  });

  it('TL;DR shows active-only count (D26)', () => {
    const header = '<!-- TL;DR: 5 decisions. Key: ADR-005 -->\n# Architectural Decisions\n\nAppend-only.\n';
    let entries = '';
    for (let i = 1; i <= 5; i++) {
      const n = i.toString().padStart(3, '0');
      const status = i <= 2 ? 'Deprecated' : 'Accepted';
      entries += `\n## ADR-${n}: entry ${i}\n\n- **Date**: 2026-01-01\n- **Status**: ${status}\n- **Source**: test\n`;
    }
    fs.writeFileSync(path.join(knowledgeDir, 'decisions.md'), header + entries);

    const obs = makeReadyDecision('obs_tldr', 'new entry');
    fs.writeFileSync(logFile, JSON.stringify(obs) + '\n');

    const result = JSON.parse(runHelper(`render-ready "${logFile}" "${tmpDir}"`));
    expect(result.rendered).toHaveLength(1);

    const content = fs.readFileSync(path.join(knowledgeDir, 'decisions.md'), 'utf8');
    // 3 active + 1 new = 4 active (2 deprecated don't count)
    expect(content).toMatch(/<!-- TL;DR: 4 decisions\./);
  });
});
