import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  addLearningHook,
  removeLearningHook,
  hasLearningHook,
  parseLearningLog,
  loadAndCountObservations,
  formatLearningStatus,
  loadLearningConfig,
  isLearningObservation,
  applyConfigLayer,
  type LearningObservation,
} from '../src/cli/commands/learn.js';
import { cleanSelfLearningArtifacts, AUTO_GENERATED_MARKER } from '../src/cli/utils/learning-cleanup.js';

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
        UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'preamble' }] }],
      },
    });
    const result = addLearningHook(input, '/home/user/.devflow');
    const settings = JSON.parse(result);

    expect(settings.hooks.SessionEnd).toHaveLength(2);
    expect(settings.hooks.UserPromptSubmit).toHaveLength(1);
  });

  it('self-upgrades legacy Stop hook to SessionEnd', () => {
    const input = JSON.stringify({
      hooks: {
        Stop: [
          { hooks: [{ type: 'command', command: 'stop-update-memory' }] },
          { hooks: [{ type: 'command', command: '/old/path/stop-update-learning' }] },
        ],
      },
    });
    const result = addLearningHook(input, '/home/user/.devflow');
    const settings = JSON.parse(result);

    // Legacy Stop learning hook removed, memory hook preserved
    expect(settings.hooks.Stop).toHaveLength(1);
    expect(settings.hooks.Stop[0].hooks[0].command).toBe('stop-update-memory');
    // New SessionEnd hook added
    expect(settings.hooks.SessionEnd).toHaveLength(1);
    expect(settings.hooks.SessionEnd[0].hooks[0].command).toContain('session-end-learning');
  });

  it('self-upgrades legacy Stop hook and preserves other events', () => {
    const input = JSON.stringify({
      hooks: {
        Stop: [
          { hooks: [{ type: 'command', command: '/old/path/stop-update-learning' }] },
        ],
        UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'preamble' }] }],
      },
    });
    const result = addLearningHook(input, '/home/user/.devflow');
    const settings = JSON.parse(result);

    // Legacy Stop hook removed entirely (was the only Stop entry)
    expect(settings.hooks.Stop).toBeUndefined();
    // New SessionEnd hook added
    expect(settings.hooks.SessionEnd).toHaveLength(1);
    // Other hooks preserved
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
        UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'preamble' }] }],
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
  it('returns current when present on SessionEnd', () => {
    const withHook = addLearningHook('{}', '/home/user/.devflow');
    expect(hasLearningHook(withHook)).toBe('current');
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

  it('returns current among other SessionEnd hooks', () => {
    const input = JSON.stringify({
      hooks: {
        SessionEnd: [
          { hooks: [{ type: 'command', command: 'some-other-hook' }] },
          { hooks: [{ type: 'command', command: '/path/to/session-end-learning' }] },
        ],
      },
    });
    expect(hasLearningHook(input)).toBe('current');
  });

  it('returns legacy for Stop hook with stop-update-learning', () => {
    const input = JSON.stringify({
      hooks: {
        Stop: [
          { hooks: [{ type: 'command', command: '/path/to/stop-update-learning' }] },
        ],
      },
    });
    expect(hasLearningHook(input)).toBe('legacy');
  });

  it('returns current when both SessionEnd and legacy Stop present', () => {
    const input = JSON.stringify({
      hooks: {
        SessionEnd: [
          { hooks: [{ type: 'command', command: '/path/to/session-end-learning' }] },
        ],
        Stop: [
          { hooks: [{ type: 'command', command: '/path/to/stop-update-learning' }] },
        ],
      },
    });
    expect(hasLearningHook(input)).toBe('current');
  });

  it('returns false for non-learning Stop hooks', () => {
    const input = JSON.stringify({
      hooks: {
        Stop: [
          { hooks: [{ type: 'command', command: 'stop-update-memory' }] },
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

describe('loadAndCountObservations', () => {
  it('counts mixed valid and invalid lines', () => {
    const valid = JSON.stringify({
      id: 'obs_1', type: 'workflow', pattern: 'p1',
      confidence: 0.5, observations: 1, first_seen: 't',
      last_seen: 't', status: 'observing', evidence: [], details: 'd',
    });
    const invalid = 'not json at all';
    const incomplete = JSON.stringify({ id: 'obs_2', type: 'workflow' });
    const log = [valid, invalid, incomplete].join('\n');
    const result = loadAndCountObservations(log);
    expect(result.observations).toHaveLength(1);
    expect(result.observations[0].id).toBe('obs_1');
    expect(result.invalidCount).toBe(2);
  });

  it('returns zero invalid count for all-valid lines', () => {
    const lines = [
      JSON.stringify({
        id: 'obs_1', type: 'workflow', pattern: 'p1',
        confidence: 0.5, observations: 1, first_seen: 't',
        last_seen: 't', status: 'observing', evidence: [], details: 'd',
      }),
      JSON.stringify({
        id: 'obs_2', type: 'procedural', pattern: 'p2',
        confidence: 0.8, observations: 2, first_seen: 't',
        last_seen: 't', status: 'ready', evidence: ['e1'], details: 'd2',
      }),
    ].join('\n');
    const result = loadAndCountObservations(lines);
    expect(result.observations).toHaveLength(2);
    expect(result.invalidCount).toBe(0);
  });

  it('handles empty input', () => {
    const result = loadAndCountObservations('');
    expect(result.observations).toHaveLength(0);
    expect(result.invalidCount).toBe(0);
  });

  it('calculates invalidCount as rawLines minus valid observations', () => {
    const valid = JSON.stringify({
      id: 'obs_1', type: 'workflow', pattern: 'p1',
      confidence: 0.5, observations: 1, first_seen: 't',
      last_seen: 't', status: 'observing', evidence: [], details: 'd',
    });
    const log = [valid, 'bad1', 'bad2', 'bad3'].join('\n');
    const result = loadAndCountObservations(log);
    expect(result.observations).toHaveLength(1);
    expect(result.invalidCount).toBe(3);
  });
});

describe('formatLearningStatus', () => {
  it('shows enabled state for current hook', () => {
    const result = formatLearningStatus([], 'current');
    expect(result).toContain('enabled');
    expect(result).not.toContain('legacy');
  });

  it('shows disabled state', () => {
    const result = formatLearningStatus([], false);
    expect(result).toContain('disabled');
  });

  it('shows legacy upgrade message for legacy hook', () => {
    const result = formatLearningStatus([], 'legacy');
    expect(result).toContain('legacy');
    expect(result).toContain('devflow learn --disable && devflow learn --enable');
  });

  it('shows observation counts', () => {
    const observations: LearningObservation[] = [
      { id: 'obs_1', type: 'workflow', pattern: 'p1', confidence: 0.33, observations: 1, first_seen: 't', last_seen: 't', status: 'observing', evidence: [], details: 'd' },
      { id: 'obs_2', type: 'procedural', pattern: 'p2', confidence: 0.50, observations: 1, first_seen: 't', last_seen: 't', status: 'observing', evidence: [], details: 'd' },
      { id: 'obs_3', type: 'workflow', pattern: 'p3', confidence: 0.95, observations: 3, first_seen: 't', last_seen: 't', status: 'ready', evidence: [], details: 'd' },
    ];
    const result = formatLearningStatus(observations, 'current');
    expect(result).toContain('3 total');
    expect(result).toContain('Workflows: 2');
    expect(result).toContain('Procedural: 1');
  });

  it('shows promoted artifacts count', () => {
    const observations: LearningObservation[] = [
      { id: 'obs_1', type: 'workflow', pattern: 'p1', confidence: 0.95, observations: 3, first_seen: 't', last_seen: 't', status: 'created', evidence: [], details: 'd', artifact_path: '/path' },
      { id: 'obs_2', type: 'procedural', pattern: 'p2', confidence: 0.50, observations: 1, first_seen: 't', last_seen: 't', status: 'observing', evidence: [], details: 'd' },
    ];
    const result = formatLearningStatus(observations, 'current');
    expect(result).toContain('1 promoted');
    expect(result).toContain('1 observing');
  });

  it('handles empty observations', () => {
    const result = formatLearningStatus([], 'current');
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
    expect(config.batch_size).toBe(3);
  });

  it('loads global config', () => {
    const globalJson = JSON.stringify({ max_daily_runs: 20, model: 'haiku' });
    const config = loadLearningConfig(globalJson, null);
    expect(config.max_daily_runs).toBe(20);
    expect(config.throttle_minutes).toBe(5); // default preserved
    expect(config.model).toBe('haiku');
    expect(config.batch_size).toBe(3); // default preserved
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

  it('loads batch_size from config', () => {
    const projectJson = JSON.stringify({ batch_size: 5 });
    const config = loadLearningConfig(null, projectJson);
    expect(config.batch_size).toBe(5);
  });

  it('ignores non-numeric batch_size', () => {
    const projectJson = JSON.stringify({ batch_size: 'large' });
    const config = loadLearningConfig(null, projectJson);
    expect(config.batch_size).toBe(3); // default preserved
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
    const original = { max_daily_runs: 10, throttle_minutes: 5, model: 'sonnet', debug: false, batch_size: 3 };
    const result = applyConfigLayer(original, JSON.stringify({ max_daily_runs: 20 }));
    expect(result.max_daily_runs).toBe(20);
    expect(original.max_daily_runs).toBe(10); // not mutated
  });

  it('returns copy on invalid JSON', () => {
    const original = { max_daily_runs: 10, throttle_minutes: 5, model: 'sonnet', debug: false, batch_size: 3 };
    const result = applyConfigLayer(original, 'not json');
    expect(result).toEqual(original);
    expect(result).not.toBe(original); // different reference
  });

  it('ignores wrong-typed fields', () => {
    const original = { max_daily_runs: 10, throttle_minutes: 5, model: 'sonnet', debug: false, batch_size: 3 };
    const result = applyConfigLayer(original, JSON.stringify({ max_daily_runs: 'lots', model: 42 }));
    expect(result.max_daily_runs).toBe(10);
    expect(result.model).toBe('sonnet');
  });

  it('applies debug field when boolean', () => {
    const original = { max_daily_runs: 10, throttle_minutes: 5, model: 'sonnet', debug: false, batch_size: 3 };
    const result = applyConfigLayer(original, JSON.stringify({ debug: true }));
    expect(result.debug).toBe(true);
  });

  it('ignores debug field when non-boolean', () => {
    const original = { max_daily_runs: 10, throttle_minutes: 5, model: 'sonnet', debug: false, batch_size: 3 };
    const result = applyConfigLayer(original, JSON.stringify({ debug: 'yes' }));
    expect(result.debug).toBe(false);
  });

  it('applies batch_size field when number', () => {
    const original = { max_daily_runs: 10, throttle_minutes: 5, model: 'sonnet', debug: false, batch_size: 3 };
    const result = applyConfigLayer(original, JSON.stringify({ batch_size: 5 }));
    expect(result.batch_size).toBe(5);
  });

  it('ignores batch_size field when non-number', () => {
    const original = { max_daily_runs: 10, throttle_minutes: 5, model: 'sonnet', debug: false, batch_size: 3 };
    const result = applyConfigLayer(original, JSON.stringify({ batch_size: 'large' }));
    expect(result.batch_size).toBe(3);
  });
});

describe('cleanSelfLearningArtifacts', () => {
  function makeTmpClaudeDir(): string {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-clean-test-'));
    fs.mkdirSync(path.join(tmpDir, 'skills'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'commands', 'self-learning'), { recursive: true });
    return tmpDir;
  }

  it('removes skills with auto-generated marker', async () => {
    const claudeDir = makeTmpClaudeDir();
    try {
      const skillDir = path.join(claudeDir, 'skills', 'test-skill');
      fs.mkdirSync(skillDir, { recursive: true });
      fs.writeFileSync(path.join(skillDir, 'SKILL.md'), [
        '---',
        'name: self-learning:test-skill',
        `# ${AUTO_GENERATED_MARKER} (2026-04-01, confidence: 0.95, obs: 5)`,
        '---',
        '',
        '# Test Skill',
      ].join('\n'));

      const result = await cleanSelfLearningArtifacts(claudeDir);
      expect(result.removed).toBe(1);
      expect(fs.existsSync(skillDir)).toBe(false);
    } finally {
      fs.rmSync(claudeDir, { recursive: true, force: true });
    }
  });

  it('removes commands with auto-generated marker', async () => {
    const claudeDir = makeTmpClaudeDir();
    try {
      const cmdFile = path.join(claudeDir, 'commands', 'self-learning', 'deploy.md');
      fs.writeFileSync(cmdFile, [
        '---',
        'description: "Deploy workflow"',
        `# ${AUTO_GENERATED_MARKER} (2026-04-01, confidence: 0.95, obs: 5)`,
        '---',
        '',
        '# Deploy',
      ].join('\n'));

      const result = await cleanSelfLearningArtifacts(claudeDir);
      expect(result.removed).toBe(1);
      expect(fs.existsSync(cmdFile)).toBe(false);
    } finally {
      fs.rmSync(claudeDir, { recursive: true, force: true });
    }
  });

  it('preserves devflow-namespaced skills', async () => {
    const claudeDir = makeTmpClaudeDir();
    try {
      const skillDir = path.join(claudeDir, 'skills', 'devflow:quality-gates');
      fs.mkdirSync(skillDir, { recursive: true });
      fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# Quality Gates');

      const result = await cleanSelfLearningArtifacts(claudeDir);
      expect(result.removed).toBe(0);
      expect(fs.existsSync(skillDir)).toBe(true);
    } finally {
      fs.rmSync(claudeDir, { recursive: true, force: true });
    }
  });

  it('preserves skills without auto-generated marker', async () => {
    const claudeDir = makeTmpClaudeDir();
    try {
      const skillDir = path.join(claudeDir, 'skills', 'user-skill');
      fs.mkdirSync(skillDir, { recursive: true });
      fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '---\nname: user-skill\n---\n# User Skill');

      const result = await cleanSelfLearningArtifacts(claudeDir);
      expect(result.removed).toBe(0);
      expect(fs.existsSync(skillDir)).toBe(true);
    } finally {
      fs.rmSync(claudeDir, { recursive: true, force: true });
    }
  });

  it('removes empty self-learning commands dir', async () => {
    const claudeDir = makeTmpClaudeDir();
    try {
      const cmdFile = path.join(claudeDir, 'commands', 'self-learning', 'test.md');
      fs.writeFileSync(cmdFile, `---\n# ${AUTO_GENERATED_MARKER}\n---\nTest`);

      await cleanSelfLearningArtifacts(claudeDir);
      const selfLearningDir = path.join(claudeDir, 'commands', 'self-learning');
      expect(fs.existsSync(selfLearningDir)).toBe(false);
    } finally {
      fs.rmSync(claudeDir, { recursive: true, force: true });
    }
  });

  it('handles missing directories gracefully', async () => {
    const claudeDir = path.join(os.tmpdir(), `devflow-nonexistent-${Date.now()}`);
    const result = await cleanSelfLearningArtifacts(claudeDir);
    expect(result.removed).toBe(0);
    expect(result.paths).toEqual([]);
  });

  it('returns paths of all removed artifacts', async () => {
    const claudeDir = makeTmpClaudeDir();
    try {
      // Create a skill
      const skillDir = path.join(claudeDir, 'skills', 'learned-skill');
      fs.mkdirSync(skillDir, { recursive: true });
      fs.writeFileSync(path.join(skillDir, 'SKILL.md'), `---\n# ${AUTO_GENERATED_MARKER}\n---\nSkill`);

      // Create a command
      const cmdFile = path.join(claudeDir, 'commands', 'self-learning', 'learned-cmd.md');
      fs.writeFileSync(cmdFile, `---\n# ${AUTO_GENERATED_MARKER}\n---\nCmd`);

      const result = await cleanSelfLearningArtifacts(claudeDir);
      expect(result.removed).toBe(2);
      expect(result.paths).toHaveLength(2);
      expect(result.paths.some(p => p.includes('learned-skill'))).toBe(true);
      expect(result.paths.some(p => p.includes('learned-cmd'))).toBe(true);
    } finally {
      fs.rmSync(claudeDir, { recursive: true, force: true });
    }
  });
});
