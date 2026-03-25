import { describe, it, expect } from 'vitest';
import {
  addLearningHook,
  removeLearningHook,
  hasLearningHook,
  parseLearningLog,
  formatLearningStatus,
  loadLearningConfig,
  isLearningObservation,
  applyConfigLayer,
  type LearningObservation,
} from '../src/cli/commands/learn.js';

describe('addLearningHook', () => {
  it('adds hook to empty settings', () => {
    const result = addLearningHook('{}', '/home/user/.devflow');
    const settings = JSON.parse(result);

    expect(settings.hooks.SessionEnd).toHaveLength(1);
    expect(settings.hooks.SessionEnd[0].hooks[0].command).toContain('session-end-learning');
    expect(settings.hooks.SessionEnd[0].hooks[0].timeout).toBe(10);
  });

  it('adds alongside existing hooks (Stop hooks from memory)', () => {
    const input = JSON.stringify({
      hooks: {
        Stop: [{ hooks: [{ type: 'command', command: 'stop-update-memory' }] }],
      },
    });
    const result = addLearningHook(input, '/home/user/.devflow');
    const settings = JSON.parse(result);

    expect(settings.hooks.Stop).toHaveLength(1);
    expect(settings.hooks.SessionEnd).toHaveLength(1);
    expect(settings.hooks.SessionEnd[0].hooks[0].command).toContain('session-end-learning');
  });

  it('is idempotent — does not add duplicate', () => {
    const first = addLearningHook('{}', '/home/user/.devflow');
    const second = addLearningHook(first, '/home/user/.devflow');

    expect(second).toBe(first);
  });

  it('uses correct path via run-hook wrapper', () => {
    const result = addLearningHook('{}', '/custom/path/.devflow');
    const settings = JSON.parse(result);
    const command = settings.hooks.SessionEnd[0].hooks[0].command;

    expect(command).toContain('/custom/path/.devflow/scripts/hooks/run-hook');
    expect(command).toContain('session-end-learning');
  });

  it('preserves other settings', () => {
    const input = JSON.stringify({
      statusLine: { type: 'command', command: 'statusline.sh' },
      env: { SOME_VAR: '1' },
    });
    const result = addLearningHook(input, '/home/user/.devflow');
    const settings = JSON.parse(result);

    expect(settings.statusLine.command).toBe('statusline.sh');
    expect(settings.env.SOME_VAR).toBe('1');
    expect(settings.hooks.SessionEnd).toHaveLength(1);
  });

  it('adds alongside existing SessionEnd hooks', () => {
    const input = JSON.stringify({
      hooks: {
        SessionEnd: [{ hooks: [{ type: 'command', command: 'other-session-end.sh' }] }],
        UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'ambient-prompt' }] }],
      },
    });
    const result = addLearningHook(input, '/home/user/.devflow');
    const settings = JSON.parse(result);

    expect(settings.hooks.SessionEnd).toHaveLength(2);
    expect(settings.hooks.UserPromptSubmit).toHaveLength(1);
  });
});

describe('removeLearningHook', () => {
  it('removes learning hook from SessionEnd', () => {
    const withHook = addLearningHook('{}', '/home/user/.devflow');
    const result = removeLearningHook(withHook);
    const settings = JSON.parse(result);

    expect(settings.hooks).toBeUndefined();
  });

  it('preserves other SessionEnd hooks', () => {
    const input = JSON.stringify({
      hooks: {
        SessionEnd: [
          { hooks: [{ type: 'command', command: 'other-session-end-hook' }] },
          { hooks: [{ type: 'command', command: '/path/to/session-end-learning' }] },
        ],
      },
    });
    const result = removeLearningHook(input);
    const settings = JSON.parse(result);

    expect(settings.hooks.SessionEnd).toHaveLength(1);
    expect(settings.hooks.SessionEnd[0].hooks[0].command).toBe('other-session-end-hook');
  });

  it('cleans empty hooks object when last hook removed', () => {
    const input = JSON.stringify({
      hooks: {
        SessionEnd: [
          { hooks: [{ type: 'command', command: '/path/to/session-end-learning' }] },
        ],
      },
    });
    const result = removeLearningHook(input);
    const settings = JSON.parse(result);

    expect(settings.hooks).toBeUndefined();
  });

  it('preserves other hook event types', () => {
    const input = JSON.stringify({
      hooks: {
        UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'ambient-prompt' }] }],
        SessionEnd: [
          { hooks: [{ type: 'command', command: '/path/to/session-end-learning' }] },
        ],
      },
    });
    const result = removeLearningHook(input);
    const settings = JSON.parse(result);

    expect(settings.hooks.UserPromptSubmit).toHaveLength(1);
    expect(settings.hooks.SessionEnd).toBeUndefined();
  });

  it('is idempotent', () => {
    const input = JSON.stringify({
      hooks: {
        Stop: [{ hooks: [{ type: 'command', command: 'stop-update-memory' }] }],
      },
    });
    const result = removeLearningHook(input);

    expect(result).toBe(input);
  });

  it('cleans up legacy Stop entries', () => {
    const input = JSON.stringify({
      hooks: {
        Stop: [
          { hooks: [{ type: 'command', command: 'stop-update-memory' }] },
          { hooks: [{ type: 'command', command: '/path/to/stop-update-learning' }] },
        ],
      },
    });
    const result = removeLearningHook(input);
    const settings = JSON.parse(result);
    expect(settings.hooks.Stop).toHaveLength(1);
    expect(settings.hooks.Stop[0].hooks[0].command).toBe('stop-update-memory');
  });

  it('cleans both SessionEnd and legacy Stop', () => {
    const input = JSON.stringify({
      hooks: {
        SessionEnd: [
          { hooks: [{ type: 'command', command: '/path/session-end-learning' }] },
        ],
        Stop: [
          { hooks: [{ type: 'command', command: 'stop-update-memory' }] },
          { hooks: [{ type: 'command', command: '/old/path/stop-update-learning' }] },
        ],
      },
    });
    const result = removeLearningHook(input);
    const settings = JSON.parse(result);
    expect(settings.hooks.SessionEnd).toBeUndefined();
    expect(settings.hooks.Stop).toHaveLength(1);
  });
});

describe('hasLearningHook', () => {
  it('returns true when present on SessionEnd', () => {
    const withHook = addLearningHook('{}', '/home/user/.devflow');
    expect(hasLearningHook(withHook)).toBe(true);
  });

  it('returns false when absent', () => {
    expect(hasLearningHook('{}')).toBe(false);
  });

  it('returns false for non-learning SessionEnd hooks', () => {
    const input = JSON.stringify({
      hooks: {
        SessionEnd: [
          { hooks: [{ type: 'command', command: 'some-other-hook' }] },
        ],
      },
    });
    expect(hasLearningHook(input)).toBe(false);
  });

  it('returns true among other SessionEnd hooks', () => {
    const input = JSON.stringify({
      hooks: {
        SessionEnd: [
          { hooks: [{ type: 'command', command: 'some-other-hook' }] },
          { hooks: [{ type: 'command', command: '/path/to/session-end-learning' }] },
        ],
      },
    });
    expect(hasLearningHook(input)).toBe(true);
  });

  it('returns false for legacy Stop hook only', () => {
    const input = JSON.stringify({
      hooks: {
        Stop: [
          { hooks: [{ type: 'command', command: '/path/to/stop-update-learning' }] },
        ],
      },
    });
    expect(hasLearningHook(input)).toBe(false);
  });
});

describe('parseLearningLog', () => {
  it('parses valid JSONL', () => {
    const log = [
      '{"id":"obs_abc123","type":"workflow","pattern":"PR merge flow","confidence":0.66,"observations":2,"first_seen":"2026-03-20T00:00:00Z","last_seen":"2026-03-22T00:00:00Z","status":"observing","evidence":["merge PR"],"details":"steps"}',
      '{"id":"obs_def456","type":"procedural","pattern":"Debug hooks","confidence":0.50,"observations":1,"first_seen":"2026-03-22T00:00:00Z","last_seen":"2026-03-22T00:00:00Z","status":"observing","evidence":["check hooks"],"details":"steps"}',
    ].join('\n');

    const result = parseLearningLog(log);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('obs_abc123');
    expect(result[1].type).toBe('procedural');
  });

  it('skips malformed lines', () => {
    const log = [
      '{"id":"obs_abc123","type":"workflow","pattern":"test","confidence":0.5,"observations":1,"first_seen":"t","last_seen":"t","status":"observing","evidence":[],"details":"d"}',
      'not json at all',
      '',
      '{"id":"obs_def456","type":"procedural","pattern":"test2","confidence":0.5,"observations":1,"first_seen":"t","last_seen":"t","status":"observing","evidence":[],"details":"d"}',
    ].join('\n');

    const result = parseLearningLog(log);
    expect(result).toHaveLength(2);
  });

  it('handles empty input', () => {
    expect(parseLearningLog('')).toEqual([]);
    expect(parseLearningLog('  ')).toEqual([]);
  });

  it('parses single entry', () => {
    const log = '{"id":"obs_abc123","type":"workflow","pattern":"deploy flow","confidence":0.33,"observations":1,"first_seen":"2026-03-22T00:00:00Z","last_seen":"2026-03-22T00:00:00Z","status":"observing","evidence":["deploy"],"details":"steps"}';
    const result = parseLearningLog(log);
    expect(result).toHaveLength(1);
    expect(result[0].pattern).toBe('deploy flow');
  });
});

describe('formatLearningStatus', () => {
  it('shows enabled state', () => {
    const result = formatLearningStatus([], true);
    expect(result).toContain('enabled');
  });

  it('shows disabled state', () => {
    const result = formatLearningStatus([], false);
    expect(result).toContain('disabled');
  });

  it('shows observation counts', () => {
    const observations: LearningObservation[] = [
      { id: 'obs_1', type: 'workflow', pattern: 'p1', confidence: 0.33, observations: 1, first_seen: 't', last_seen: 't', status: 'observing', evidence: [], details: 'd' },
      { id: 'obs_2', type: 'procedural', pattern: 'p2', confidence: 0.50, observations: 1, first_seen: 't', last_seen: 't', status: 'observing', evidence: [], details: 'd' },
      { id: 'obs_3', type: 'workflow', pattern: 'p3', confidence: 0.95, observations: 3, first_seen: 't', last_seen: 't', status: 'ready', evidence: [], details: 'd' },
    ];
    const result = formatLearningStatus(observations, true);
    expect(result).toContain('3 total');
    expect(result).toContain('Workflows: 2');
    expect(result).toContain('Procedural: 1');
  });

  it('shows promoted artifacts count', () => {
    const observations: LearningObservation[] = [
      { id: 'obs_1', type: 'workflow', pattern: 'p1', confidence: 0.95, observations: 3, first_seen: 't', last_seen: 't', status: 'created', evidence: [], details: 'd', artifact_path: '/path' },
      { id: 'obs_2', type: 'procedural', pattern: 'p2', confidence: 0.50, observations: 1, first_seen: 't', last_seen: 't', status: 'observing', evidence: [], details: 'd' },
    ];
    const result = formatLearningStatus(observations, true);
    expect(result).toContain('1 promoted');
    expect(result).toContain('1 observing');
  });

  it('handles empty observations', () => {
    const result = formatLearningStatus([], true);
    expect(result).toContain('none');
  });
});

describe('loadLearningConfig', () => {
  it('returns defaults when no config files', () => {
    const config = loadLearningConfig(null, null);
    expect(config.max_daily_runs).toBe(5);
    expect(config.throttle_minutes).toBe(5);
    expect(config.model).toBe('sonnet');
    expect(config.debug).toBe(false);
  });

  it('loads global config', () => {
    const globalJson = JSON.stringify({ max_daily_runs: 20, model: 'haiku' });
    const config = loadLearningConfig(globalJson, null);
    expect(config.max_daily_runs).toBe(20);
    expect(config.throttle_minutes).toBe(5); // default preserved
    expect(config.model).toBe('haiku');
  });

  it('project config overrides global', () => {
    const globalJson = JSON.stringify({ max_daily_runs: 20, model: 'haiku' });
    const projectJson = JSON.stringify({ max_daily_runs: 5 });
    const config = loadLearningConfig(globalJson, projectJson);
    expect(config.max_daily_runs).toBe(5); // project wins
    expect(config.model).toBe('haiku'); // global preserved when project doesn't set
  });

  it('handles partial override (only some fields)', () => {
    const projectJson = JSON.stringify({ throttle_minutes: 15 });
    const config = loadLearningConfig(null, projectJson);
    expect(config.max_daily_runs).toBe(5); // default
    expect(config.throttle_minutes).toBe(15); // overridden
    expect(config.model).toBe('sonnet'); // default
  });
});

describe('isLearningObservation', () => {
  const validObs = {
    id: 'obs_abc123',
    type: 'workflow',
    pattern: 'test pattern',
    confidence: 0.5,
    observations: 1,
    first_seen: '2026-03-22T00:00:00Z',
    last_seen: '2026-03-22T00:00:00Z',
    status: 'observing',
    evidence: ['some evidence'],
    details: 'details',
  };

  it('accepts valid observation', () => {
    expect(isLearningObservation(validObs)).toBe(true);
  });

  it('rejects null', () => {
    expect(isLearningObservation(null)).toBe(false);
  });

  it('rejects non-object', () => {
    expect(isLearningObservation('string')).toBe(false);
    expect(isLearningObservation(42)).toBe(false);
  });

  it('rejects missing id', () => {
    const { id, ...rest } = validObs;
    expect(isLearningObservation(rest)).toBe(false);
  });

  it('rejects invalid type', () => {
    expect(isLearningObservation({ ...validObs, type: 'unknown' })).toBe(false);
  });

  it('rejects confidence as string', () => {
    expect(isLearningObservation({ ...validObs, confidence: '0.5' })).toBe(false);
  });

  it('rejects invalid status', () => {
    expect(isLearningObservation({ ...validObs, status: 'done' })).toBe(false);
  });

  it('rejects evidence as non-array', () => {
    expect(isLearningObservation({ ...validObs, evidence: 'not array' })).toBe(false);
  });

  it('rejects missing details', () => {
    const { details, ...rest } = validObs;
    expect(isLearningObservation(rest)).toBe(false);
  });

  it('rejects empty id', () => {
    expect(isLearningObservation({ ...validObs, id: '' })).toBe(false);
  });

  it('rejects empty pattern', () => {
    expect(isLearningObservation({ ...validObs, pattern: '' })).toBe(false);
  });
});

describe('parseLearningLog — type guard filtering', () => {
  it('rejects objects with missing required fields', () => {
    const log = '{"id":"obs_1","type":"workflow","pattern":"p"}\n';
    const result = parseLearningLog(log);
    expect(result).toHaveLength(0);
  });

  it('rejects objects with wrong field types', () => {
    const log = JSON.stringify({
      id: 'obs_1', type: 'workflow', pattern: 'p',
      confidence: 'high', observations: 1, first_seen: 't',
      last_seen: 't', status: 'observing', evidence: [], details: 'd',
    }) + '\n';
    const result = parseLearningLog(log);
    expect(result).toHaveLength(0);
  });

  it('filters out entries with empty id or pattern', () => {
    const valid = JSON.stringify({
      id: 'obs_abc123', type: 'workflow', pattern: 'real pattern',
      confidence: 0.5, observations: 1, first_seen: 't',
      last_seen: 't', status: 'observing', evidence: [], details: 'd',
    });
    const emptyId = JSON.stringify({
      id: '', type: 'workflow', pattern: 'some pattern',
      confidence: 0.5, observations: 1, first_seen: 't',
      last_seen: 't', status: 'observing', evidence: [], details: 'd',
    });
    const emptyPattern = JSON.stringify({
      id: 'obs_def456', type: 'procedural', pattern: '',
      confidence: 0.5, observations: 1, first_seen: 't',
      last_seen: 't', status: 'observing', evidence: [], details: 'd',
    });
    const log = [valid, emptyId, emptyPattern].join('\n');
    const result = parseLearningLog(log);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('obs_abc123');
  });
});

describe('applyConfigLayer — immutability', () => {
  it('returns new object without mutating input', () => {
    const original = { max_daily_runs: 10, throttle_minutes: 5, model: 'sonnet', debug: false };
    const result = applyConfigLayer(original, JSON.stringify({ max_daily_runs: 20 }));
    expect(result.max_daily_runs).toBe(20);
    expect(original.max_daily_runs).toBe(10); // not mutated
  });

  it('returns copy on invalid JSON', () => {
    const original = { max_daily_runs: 10, throttle_minutes: 5, model: 'sonnet', debug: false };
    const result = applyConfigLayer(original, 'not json');
    expect(result).toEqual(original);
    expect(result).not.toBe(original); // different reference
  });

  it('ignores wrong-typed fields', () => {
    const original = { max_daily_runs: 10, throttle_minutes: 5, model: 'sonnet', debug: false };
    const result = applyConfigLayer(original, JSON.stringify({ max_daily_runs: 'lots', model: 42 }));
    expect(result.max_daily_runs).toBe(10);
    expect(result.model).toBe('sonnet');
  });

  it('applies debug field when boolean', () => {
    const original = { max_daily_runs: 10, throttle_minutes: 5, model: 'sonnet', debug: false };
    const result = applyConfigLayer(original, JSON.stringify({ debug: true }));
    expect(result.debug).toBe(true);
  });

  it('ignores debug field when non-boolean', () => {
    const original = { max_daily_runs: 10, throttle_minutes: 5, model: 'sonnet', debug: false };
    const result = applyConfigLayer(original, JSON.stringify({ debug: 'yes' }));
    expect(result.debug).toBe(false);
  });
});
