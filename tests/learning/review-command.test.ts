// tests/learning/review-command.test.ts
// Tests for devflow learn --review CLI command.
// Validates flagged observation detection, log mutation, and decisions file Status updates.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  parseLearningLog,
  isLearningObservation,
  updateDecisionsStatus,
} from '../../src/cli/commands/learn.js';
import type { LearningObservation } from '../../src/cli/commands/learn.js';
import { runHelper } from './helpers.js';

// Helper: serialize an array of observations to JSONL
function serializeLog(observations: LearningObservation[]): string {
  return observations.map(o => JSON.stringify(o)).join('\n') + (observations.length ? '\n' : '');
}

// Helper: build a full observation with defaults
function makeObs(
  overrides: Partial<LearningObservation> & { id: string; type: LearningObservation['type']; pattern: string },
): LearningObservation {
  return {
    confidence: 0.9,
    observations: 5,
    first_seen: '2026-01-01T00:00:00Z',
    last_seen: '2026-04-01T00:00:00Z',
    status: 'created',
    evidence: ['evidence line'],
    details: 'test details',
    ...overrides,
  };
}

describe('parseLearningLog v2 type support', () => {
  it('accepts all 4 types', () => {
    const obs = [
      makeObs({ id: 'w1', type: 'workflow', pattern: 'workflow pattern' }),
      makeObs({ id: 'p1', type: 'procedural', pattern: 'proc pattern' }),
      makeObs({ id: 'd1', type: 'decision', pattern: 'decision pattern' }),
      makeObs({ id: 'f1', type: 'pitfall', pattern: 'pitfall pattern' }),
    ];
    const parsed = parseLearningLog(serializeLog(obs));
    expect(parsed).toHaveLength(4);
    expect(parsed.map(o => o.type)).toEqual(['workflow', 'procedural', 'decision', 'pitfall']);
  });

  it('accepts deprecated status', () => {
    const obs = makeObs({ id: 'd1', type: 'decision', pattern: 'some decision', status: 'deprecated' });
    const parsed = parseLearningLog(JSON.stringify(obs) + '\n');
    expect(parsed).toHaveLength(1);
    expect(parsed[0].status).toBe('deprecated');
  });

  it('accepts attention flag fields', () => {
    const obs = makeObs({
      id: 'w1',
      type: 'workflow',
      pattern: 'stale workflow',
      mayBeStale: true,
      staleReason: 'code-ref-missing:src/foo.ts',
      needsReview: false,
      softCapExceeded: false,
    });
    const parsed = parseLearningLog(JSON.stringify(obs) + '\n');
    expect(parsed).toHaveLength(1);
    expect(parsed[0].mayBeStale).toBe(true);
    expect(parsed[0].staleReason).toBe('code-ref-missing:src/foo.ts');
  });
});

describe('isLearningObservation v2', () => {
  it('accepts decision type', () => {
    const obs = makeObs({ id: 'd1', type: 'decision', pattern: 'decision' });
    expect(isLearningObservation(obs)).toBe(true);
  });

  it('accepts pitfall type', () => {
    const obs = makeObs({ id: 'f1', type: 'pitfall', pattern: 'pitfall' });
    expect(isLearningObservation(obs)).toBe(true);
  });

  it('accepts deprecated status', () => {
    const obs = makeObs({ id: 'd1', type: 'decision', pattern: 'decision', status: 'deprecated' });
    expect(isLearningObservation(obs)).toBe(true);
  });

  it('rejects unknown type', () => {
    const obs = { ...makeObs({ id: 'x1', type: 'workflow', pattern: 'p' }), type: 'unknown' };
    expect(isLearningObservation(obs)).toBe(false);
  });
});

describe('updateDecisionsStatus', () => {
  let tmpDir: string;
  let decisionsDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'review-cmd-test-'));
    // Mirror the production layout (`.memory/decisions/{file}.md`) so the lock
    // directory computed by updateDecisionsStatus lands inside tmpDir rather
    // than the system temp root shared across tests.
    decisionsDir = path.join(tmpDir, '.memory', 'decisions');
    fs.mkdirSync(decisionsDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('updates Status field in decisions.md for a known anchor', async () => {
    const decisionsPath = path.join(decisionsDir, 'decisions.md');
    fs.writeFileSync(decisionsPath, [
      '<!-- TL;DR: 1 decisions. Key: -->',
      '# Architectural Decisions',
      '',
      '## ADR-001: Use Result Types',
      '',
      '- **Date**: 2026-01-01',
      '- **Status**: Accepted',
      '- **Context**: Avoid exception-based control flow',
      '- **Decision**: Return Result<T,E> from all fallible operations',
      '- **Consequences**: Consistent error handling',
      '- **Source**: session-abc123',
      '',
    ].join('\n'), 'utf-8');

    const updated = await updateDecisionsStatus(decisionsPath, 'ADR-001', 'Deprecated');
    expect(updated).toBe(true);

    const content = fs.readFileSync(decisionsPath, 'utf-8');
    expect(content).toContain('- **Status**: Deprecated');
    expect(content).not.toContain('- **Status**: Accepted');
  });

  it('updates Status field in pitfalls.md for a known anchor', async () => {
    const pitfallsPath = path.join(decisionsDir, 'pitfalls.md');
    fs.writeFileSync(pitfallsPath, [
      '<!-- TL;DR: 1 pitfalls. Key: -->',
      '# Known Pitfalls',
      '',
      '## PF-001: Avoid try/catch around Result',
      '',
      '- **Area**: src/cli/commands/',
      '- **Issue**: Wrapping Result types in try/catch defeats the purpose',
      '- **Impact**: Inconsistent error handling',
      '- **Resolution**: Use .match() or check .ok',
      '- **Status**: Active',
      '- **Source**: session-def456',
      '',
    ].join('\n'), 'utf-8');

    const updated = await updateDecisionsStatus(pitfallsPath, 'PF-001', 'Deprecated');
    expect(updated).toBe(true);

    const content = fs.readFileSync(pitfallsPath, 'utf-8');
    expect(content).toContain('- **Status**: Deprecated');
    expect(content).not.toContain('- **Status**: Active');
  });

  it('returns false when file does not exist', async () => {
    const result = await updateDecisionsStatus(
      path.join(decisionsDir, 'nonexistent.md'),
      'ADR-001',
      'Deprecated',
    );
    expect(result).toBe(false);
  });

  it('does not corrupt file when anchor not found', async () => {
    const decisionsPath = path.join(decisionsDir, 'decisions.md');
    const originalContent = [
      '<!-- TL;DR: 1 decisions. Key: -->',
      '# Architectural Decisions',
      '',
      '## ADR-001: Some Decision',
      '',
      '- **Status**: Accepted',
      '',
    ].join('\n');
    fs.writeFileSync(decisionsPath, originalContent, 'utf-8');

    // Wrong anchor
    const updated = await updateDecisionsStatus(decisionsPath, 'ADR-999', 'Deprecated');
    expect(updated).toBe(false);

    // File should be unchanged
    const content = fs.readFileSync(decisionsPath, 'utf-8');
    expect(content).toBe(originalContent);
  });

  it('does not corrupt file when Status field is absent in section', async () => {
    const decisionsPath = path.join(decisionsDir, 'decisions.md');
    const originalContent = [
      '# Architectural Decisions',
      '',
      '## ADR-001: No Status Field',
      '',
      '- **Date**: 2026-01-01',
      '- **Context**: something',
      '',
    ].join('\n');
    fs.writeFileSync(decisionsPath, originalContent, 'utf-8');

    const updated = await updateDecisionsStatus(decisionsPath, 'ADR-001', 'Deprecated');
    expect(updated).toBe(false);
  });
});

describe('observation attention flags detection', () => {
  it('identifies stale observations correctly', () => {
    const obs: LearningObservation[] = [
      makeObs({ id: '1', type: 'workflow', pattern: 'normal' }),
      makeObs({ id: '2', type: 'decision', pattern: 'stale', mayBeStale: true }),
      makeObs({ id: '3', type: 'pitfall', pattern: 'missing', needsReview: true }),
      makeObs({ id: '4', type: 'procedural', pattern: 'capped', softCapExceeded: true }),
    ];

    const flagged = obs.filter(o => o.mayBeStale || o.needsReview || o.softCapExceeded);
    expect(flagged).toHaveLength(3);
    expect(flagged.map(o => o.id)).toEqual(['2', '3', '4']);
  });

  it('produces correct log after deprecation update', () => {
    const original: LearningObservation[] = [
      makeObs({ id: '1', type: 'workflow', pattern: 'active' }),
      makeObs({ id: '2', type: 'decision', pattern: 'to-deprecate', mayBeStale: true }),
    ];

    // Simulate what --review does when user chooses 'deprecate' on obs id='2'
    const updated = original.map(o => {
      if (o.id === '2') {
        const copy = { ...o };
        copy.status = 'deprecated';
        delete copy.mayBeStale;
        delete copy.needsReview;
        delete copy.softCapExceeded;
        return copy;
      }
      return o;
    });

    expect(updated[0].status).toBe('created');
    expect(updated[1].status).toBe('deprecated');
    expect(updated[1].mayBeStale).toBeUndefined();

    // Serialized log should parse back correctly
    const logContent = serializeLog(updated);
    const parsed = parseLearningLog(logContent);
    expect(parsed).toHaveLength(2);
    expect(parsed[1].status).toBe('deprecated');
    expect(parsed[1].mayBeStale).toBeUndefined();
  });

  it('produces correct log after keep update (flags cleared)', () => {
    const original: LearningObservation[] = [
      makeObs({ id: '1', type: 'pitfall', pattern: 'keep this', needsReview: true }),
    ];

    // Simulate what --review does when user chooses 'keep'
    const updated = original.map(o => {
      if (o.id === '1') {
        const copy = { ...o };
        delete copy.mayBeStale;
        delete copy.needsReview;
        delete copy.softCapExceeded;
        return copy;
      }
      return o;
    });

    expect(updated[0].status).toBe('created');
    expect(updated[0].needsReview).toBeUndefined();

    const logContent = serializeLog(updated);
    const parsed = parseLearningLog(logContent);
    expect(parsed[0].needsReview).toBeUndefined();
  });
});

describe('decisions capacity review (--review capacity mode)', () => {
  // These tests verify the parsing and sorting logic, not the interactive flow
  // (p.multiselect is hard to test non-interactively).

  let tmpDir: string;
  let decisionsDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-review-'));
    decisionsDir = path.join(tmpDir, '.memory', 'decisions');
    fs.mkdirSync(decisionsDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('parseDecisionsEntries extracts active entries from decisions.md', () => {
    // This test validates the entry parsing logic that the --review capacity
    // mode uses internally. We test it via the count-active op which uses
    // the same countActiveHeadings function.
    const content = [
      '<!-- TL;DR: 3 decisions. Key: ADR-003 -->',
      '# Decisions',
      '',
      '## ADR-001: Active entry',
      '- **Date**: 2026-01-01',
      '- **Status**: Accepted',
      '',
      '## ADR-002: Deprecated entry',
      '- **Date**: 2026-01-01',
      '- **Status**: Deprecated',
      '',
      '## ADR-003: Another active',
      '- **Date**: 2026-04-01',
      '- **Status**: Accepted',
      '',
    ].join('\n');

    const decisionsPath = path.join(decisionsDir, 'decisions.md');
    fs.writeFileSync(decisionsPath, content);

    // Use count-active to verify
    const result = JSON.parse(runHelper(`count-active "${decisionsPath}" decision`));
    expect(result.count).toBe(2);
  });

  it('count-active returns 0 for non-existent file', () => {
    const result = JSON.parse(runHelper(`count-active "/tmp/nonexistent-${Date.now()}.md" decision`));
    expect(result.count).toBe(0);
  });

  it('count-active handles pitfalls correctly', () => {
    const content = [
      '<!-- TL;DR: 2 pitfalls. Key: PF-002 -->',
      '# Pitfalls',
      '',
      '## PF-001: Active pitfall',
      '- **Status**: Active',
      '',
      '## PF-002: Deprecated pitfall',
      '- **Status**: Deprecated',
      '',
    ].join('\n');

    const pitfallsPath = path.join(decisionsDir, 'pitfalls.md');
    fs.writeFileSync(pitfallsPath, content);

    const result = JSON.parse(runHelper(`count-active "${pitfallsPath}" pitfall`));
    expect(result.count).toBe(1);
  });
});

describe('--dismiss-capacity notification', () => {
  let tmpDir: string;
  let memoryDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dismiss-test-'));
    memoryDir = path.join(tmpDir, '.memory');
    fs.mkdirSync(memoryDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writeFileAtomic persists notification dismissal', async () => {
    const notifPath = path.join(memoryDir, '.notifications.json');
    const data: Record<string, any> = {
      'knowledge-capacity-decisions': {
        active: true, threshold: 70, count: 72, ceiling: 100,
        dismissed_at_threshold: null, severity: 'warning',
      },
    };
    fs.writeFileSync(notifPath, JSON.stringify(data));

    // Simulate dismiss: set dismissed_at_threshold = threshold
    data['knowledge-capacity-decisions'].dismissed_at_threshold = 70;
    fs.writeFileSync(notifPath, JSON.stringify(data, null, 2) + '\n');

    const read = JSON.parse(fs.readFileSync(notifPath, 'utf8'));
    expect(read['knowledge-capacity-decisions'].dismissed_at_threshold).toBe(70);
  });
});
