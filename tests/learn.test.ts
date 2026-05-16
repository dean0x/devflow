import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  formatLearningStatus,
  loadLearningConfig,
  applyConfigLayer,
} from '../src/cli/commands/learn.js';
import {
  parseLearningLog,
  loadAndCountObservations,
  isLearningObservation,
  type LearningObservation,
} from '../src/cli/utils/observations.js';
import { cleanSelfLearningArtifacts, AUTO_GENERATED_MARKER } from '../src/cli/utils/learning-cleanup.js';

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

  it('shows decision and pitfall counts', () => {
    const observations: LearningObservation[] = [
      { id: 'obs_1', type: 'decision', pattern: 'use Result types for error handling', confidence: 0.80, observations: 2, first_seen: 't', last_seen: 't', status: 'observing', evidence: ['User chose Result over throw'], details: 'ADR-001' },
      { id: 'obs_2', type: 'pitfall', pattern: 'avoid circular deps in services', confidence: 0.70, observations: 2, first_seen: 't', last_seen: 't', status: 'observing', evidence: ['Circular dep caused build fail'], details: 'PF-001' },
      { id: 'obs_3', type: 'decision', pattern: 'inject all deps via constructor', confidence: 0.95, observations: 3, first_seen: 't', last_seen: 't', status: 'ready', evidence: ['Consistent DI across services'], details: 'ADR-002' },
    ];
    const result = formatLearningStatus(observations, true);
    expect(result).toContain('3 total');
    expect(result).toContain('Decisions: 2');
    expect(result).toContain('Pitfalls: 1');
  });

  it('shows all 4 type counts together', () => {
    const observations: LearningObservation[] = [
      { id: 'obs_1', type: 'workflow', pattern: 'w1', confidence: 0.5, observations: 1, first_seen: 't', last_seen: 't', status: 'observing', evidence: [], details: 'd' },
      { id: 'obs_2', type: 'procedural', pattern: 'p1', confidence: 0.5, observations: 1, first_seen: 't', last_seen: 't', status: 'observing', evidence: [], details: 'd' },
      { id: 'obs_3', type: 'decision', pattern: 'd1', confidence: 0.5, observations: 1, first_seen: 't', last_seen: 't', status: 'observing', evidence: [], details: 'd' },
      { id: 'obs_4', type: 'pitfall', pattern: 'f1', confidence: 0.5, observations: 1, first_seen: 't', last_seen: 't', status: 'observing', evidence: [], details: 'd' },
    ];
    const result = formatLearningStatus(observations, true);
    expect(result).toContain('4 total');
    expect(result).toContain('Workflows: 1');
    expect(result).toContain('Procedural: 1');
    expect(result).toContain('Decisions: 1');
    expect(result).toContain('Pitfalls: 1');
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

  it('counts decision and pitfall promoted entries', () => {
    const observations: LearningObservation[] = [
      { id: 'obs_1', type: 'decision', pattern: 'use Result types', confidence: 0.95, observations: 3, first_seen: 't', last_seen: 't', status: 'created', evidence: [], details: 'd', artifact_path: '.memory/decisions/decisions.md#adr-001' },
      { id: 'obs_2', type: 'pitfall', pattern: 'avoid mutating state', confidence: 0.90, observations: 3, first_seen: 't', last_seen: 't', status: 'created', evidence: [], details: 'd', artifact_path: '.memory/decisions/pitfalls.md#pf-001' },
      { id: 'obs_3', type: 'workflow', pattern: 'w1', confidence: 0.50, observations: 1, first_seen: 't', last_seen: 't', status: 'observing', evidence: [], details: 'd' },
    ];
    const result = formatLearningStatus(observations, true);
    expect(result).toContain('2 promoted');
    expect(result).toContain('Decisions: 1');
    expect(result).toContain('Pitfalls: 1');
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

  it('accepts decision type', () => {
    expect(isLearningObservation({ ...validObs, type: 'decision' })).toBe(true);
  });

  it('accepts pitfall type', () => {
    expect(isLearningObservation({ ...validObs, type: 'pitfall' })).toBe(true);
  });

  it('accepts deprecated status', () => {
    expect(isLearningObservation({ ...validObs, status: 'deprecated' })).toBe(true);
  });

  it('accepts quality_ok field when present', () => {
    expect(isLearningObservation({ ...validObs, quality_ok: true })).toBe(true);
    expect(isLearningObservation({ ...validObs, quality_ok: false })).toBe(true);
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
