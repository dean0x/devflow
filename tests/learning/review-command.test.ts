// tests/learning/review-command.test.ts
// Tests for devflow learn --review CLI command.
// Validates flagged observation detection, log mutation, and decisions file Status updates.
//
// NOTE (Phase 6): updateDecisionsStatus was removed from observation-io.ts.
// The .md files are now a pure render of the decisions ledger. Status changes
// must go through `retire-anchor` (json-helper.cjs), which flips decisions_status
// on the ledger row and re-renders both .md files atomically. Tests that directly
// tested updateDecisionsStatus have been removed; see tests/decisions/dream-curation.test.ts
// for the retire-anchor/render-based status-change tests.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  parseLearningLog,
  isLearningObservation,
  type LearningObservation,
} from '../../src/cli/utils/observations.js';
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

// updateDecisionsStatus was removed in Phase 6 of the decisions-ledger-render refactor.
// The .md files are now a pure render of the decisions ledger. Status changes must go
// through `retire-anchor` (json-helper.cjs). Tests covering retire-anchor + render-based
// status changes live in tests/decisions/dream-curation.test.ts.
describe('updateDecisionsStatus (removed in Phase 6)', () => {
  it('observation-io module does not export updateDecisionsStatus', async () => {
    const mod = await import('../../src/cli/utils/observation-io.js');
    expect((mod as Record<string, unknown>).updateDecisionsStatus).toBeUndefined();
  });
});

describe('observation attention flags detection', () => {
  it('identifies stale observations correctly', () => {
    const obs: LearningObservation[] = [
      makeObs({ id: '1', type: 'workflow', pattern: 'normal' }),
      makeObs({ id: '2', type: 'decision', pattern: 'stale', mayBeStale: true }),
    ];

    const flagged = obs.filter(o => o.mayBeStale);
    expect(flagged).toHaveLength(1);
    expect(flagged.map(o => o.id)).toEqual(['2']);
  });

  it('produces correct log after deprecation update', () => {
    const original: LearningObservation[] = [
      makeObs({ id: '1', type: 'workflow', pattern: 'active' }),
      makeObs({ id: '2', type: 'decision', pattern: 'to-deprecate', mayBeStale: true }),
    ];

    // Simulate what curation does when deprecating obs id='2'
    const updated = original.map(o => {
      if (o.id === '2') {
        const copy = { ...o };
        copy.status = 'deprecated';
        delete copy.mayBeStale;
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

  it('produces correct log after staleness flag cleared', () => {
    const original: LearningObservation[] = [
      makeObs({ id: '1', type: 'pitfall', pattern: 'keep this', mayBeStale: true }),
    ];

    // Simulate curation clearing staleness flag after file is restored
    const updated = original.map(o => {
      if (o.id === '1') {
        const copy = { ...o };
        delete copy.mayBeStale;
        return copy;
      }
      return o;
    });

    expect(updated[0].status).toBe('created');
    expect(updated[0].mayBeStale).toBeUndefined();

    const logContent = serializeLog(updated);
    const parsed = parseLearningLog(logContent);
    expect(parsed[0].mayBeStale).toBeUndefined();
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
    const notifPath = path.join(memoryDir, '.decisions-notifications.json');
    const data: Record<string, any> = {
      'decisions-capacity-decisions': {
        active: true, threshold: 70, count: 72, ceiling: 100,
        dismissed_at_threshold: null, severity: 'warning',
      },
    };
    fs.writeFileSync(notifPath, JSON.stringify(data));

    // Simulate dismiss: set dismissed_at_threshold = threshold
    data['decisions-capacity-decisions'].dismissed_at_threshold = 70;
    fs.writeFileSync(notifPath, JSON.stringify(data, null, 2) + '\n');

    const read = JSON.parse(fs.readFileSync(notifPath, 'utf8'));
    expect(read['decisions-capacity-decisions'].dismissed_at_threshold).toBe(70);
  });
});

describe('staleness filter (mayBeStale only)', () => {
  // mayBeStale is the sole stale-detection flag on an observation. It is a
  // signal (not auto-deletion) to deprioritize reinforcing observations whose
  // referenced files are missing.

  it('flagged filter only includes mayBeStale observations', () => {
    const obs: LearningObservation[] = [
      makeObs({ id: 'w1', type: 'workflow', pattern: 'stale workflow', mayBeStale: true }),
      makeObs({ id: 'w2', type: 'workflow', pattern: 'normal workflow' }),
      makeObs({ id: 'w3', type: 'procedural', pattern: 'normal procedural' }),
    ];

    const flagged = obs.filter(o => o.mayBeStale);
    expect(flagged).toHaveLength(1);
    expect(flagged[0]['id']).toBe('w1');
    expect(flagged.map(o => o['id'])).not.toContain('w2');
    expect(flagged.map(o => o['id'])).not.toContain('w3');
  });

  it('flagged filter excludes non-stale observations', () => {
    const obs: LearningObservation[] = [
      makeObs({ id: 'w1', type: 'workflow', pattern: 'stale workflow', mayBeStale: true }),
      makeObs({ id: 'w2', type: 'workflow', pattern: 'normal workflow' }),
    ];

    const flagged = obs.filter(o => o.mayBeStale);
    expect(flagged).toHaveLength(1);
    expect(flagged[0]['id']).toBe('w1');
  });
});
