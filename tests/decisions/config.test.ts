import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  loadDecisionsConfig,
  applyDecisionsConfigLayer,
  type DecisionsConfig,
} from '../../src/cli/utils/decisions-config.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a temp directory, write a JSON file, and return the dir path. */
function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'decisions-config-test-'));
}

function writeJson(dir: string, filename: string, data: unknown): void {
  fs.writeFileSync(path.join(dir, filename), JSON.stringify(data), 'utf-8');
}

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

// ---------------------------------------------------------------------------
// applyDecisionsConfigLayer
// ---------------------------------------------------------------------------

describe('applyDecisionsConfigLayer', () => {
  const base: DecisionsConfig = {
    max_daily_runs: 3,
    throttle_minutes: 5,
    model: 'sonnet',
    debug: false,
    batch_size: 1,
  };

  it('overrides individual numeric fields', () => {
    const result = applyDecisionsConfigLayer(
      base,
      JSON.stringify({ max_daily_runs: 10 }),
    );
    expect(result.max_daily_runs).toBe(10);
    expect(result.throttle_minutes).toBe(5); // unchanged
  });

  it('overrides model string field', () => {
    const result = applyDecisionsConfigLayer(base, JSON.stringify({ model: 'haiku' }));
    expect(result.model).toBe('haiku');
  });

  it('overrides debug boolean field', () => {
    const result = applyDecisionsConfigLayer(base, JSON.stringify({ debug: true }));
    expect(result.debug).toBe(true);
  });

  it('overrides batch_size numeric field', () => {
    const result = applyDecisionsConfigLayer(base, JSON.stringify({ batch_size: 5 }));
    expect(result.batch_size).toBe(5);
  });

  it('ignores non-numeric max_daily_runs', () => {
    const result = applyDecisionsConfigLayer(
      base,
      JSON.stringify({ max_daily_runs: 'lots' }),
    );
    expect(result.max_daily_runs).toBe(3);
  });

  it('ignores non-boolean debug', () => {
    const result = applyDecisionsConfigLayer(base, JSON.stringify({ debug: 'yes' }));
    expect(result.debug).toBe(false);
  });

  it('ignores non-string model', () => {
    const result = applyDecisionsConfigLayer(base, JSON.stringify({ model: 42 }));
    expect(result.model).toBe('sonnet');
  });

  it('returns a new object — does not mutate input', () => {
    const input: DecisionsConfig = { ...base };
    const result = applyDecisionsConfigLayer(input, JSON.stringify({ max_daily_runs: 99 }));
    expect(result.max_daily_runs).toBe(99);
    expect(input.max_daily_runs).toBe(3); // not mutated
    expect(result).not.toBe(input);
  });

  it('returns a copy on invalid JSON without throwing', () => {
    const result = applyDecisionsConfigLayer(base, 'not valid json');
    expect(result).toEqual(base);
    expect(result).not.toBe(base); // different reference
  });

  it('handles empty JSON object — preserves all defaults', () => {
    const result = applyDecisionsConfigLayer(base, '{}');
    expect(result).toEqual(base);
  });
});

// ---------------------------------------------------------------------------
// loadDecisionsConfig — file-system tests
// ---------------------------------------------------------------------------

describe('loadDecisionsConfig', () => {
  let devflowDir: string;
  let projectCwd: string;
  let originalDevflowDir: string | undefined;

  beforeEach(() => {
    devflowDir = makeTmpDir();
    projectCwd = makeTmpDir();
    ensureDir(path.join(projectCwd, '.memory'));

    // Override the DEVFLOW_DIR env var so loadDecisionsConfig reads from our
    // temp directory instead of ~/.devflow.
    originalDevflowDir = process.env.DEVFLOW_DIR;
    process.env.DEVFLOW_DIR = devflowDir;
  });

  afterEach(() => {
    // Restore env var.
    if (originalDevflowDir === undefined) {
      delete process.env.DEVFLOW_DIR;
    } else {
      process.env.DEVFLOW_DIR = originalDevflowDir;
    }
    // Clean up temp dirs.
    fs.rmSync(devflowDir, { recursive: true, force: true });
    fs.rmSync(projectCwd, { recursive: true, force: true });
  });

  it('returns all defaults when no config files exist', () => {
    const config = loadDecisionsConfig(projectCwd);
    expect(config.max_daily_runs).toBe(3);
    expect(config.throttle_minutes).toBe(5);
    expect(config.model).toBe('sonnet');
    expect(config.debug).toBe(false);
    expect(config.batch_size).toBe(1);
  });

  it('global config overrides defaults', () => {
    writeJson(devflowDir, 'decisions.json', { max_daily_runs: 7 });
    const config = loadDecisionsConfig(projectCwd);
    expect(config.max_daily_runs).toBe(7);
    expect(config.throttle_minutes).toBe(5); // default preserved
  });

  it('project config overrides global config', () => {
    writeJson(devflowDir, 'decisions.json', {
      max_daily_runs: 7,
      model: 'haiku',
    });
    writeJson(path.join(projectCwd, '.memory'), 'decisions.json', {
      max_daily_runs: 2,
    });
    const config = loadDecisionsConfig(projectCwd);
    expect(config.max_daily_runs).toBe(2); // project wins
    expect(config.model).toBe('haiku'); // global preserved when project doesn't set
  });

  it('project config alone overrides defaults', () => {
    writeJson(path.join(projectCwd, '.memory'), 'decisions.json', {
      model: 'opus',
    });
    const config = loadDecisionsConfig(projectCwd);
    expect(config.model).toBe('opus');
    expect(config.max_daily_runs).toBe(3); // default
  });

  it('invalid JSON in global config returns defaults without crashing', () => {
    fs.writeFileSync(
      path.join(devflowDir, 'decisions.json'),
      'not json',
      'utf-8',
    );
    const config = loadDecisionsConfig(projectCwd);
    expect(config.max_daily_runs).toBe(3);
    expect(config.model).toBe('sonnet');
  });

  it('invalid JSON in project config falls back to global + defaults', () => {
    writeJson(devflowDir, 'decisions.json', { max_daily_runs: 7 });
    fs.writeFileSync(
      path.join(projectCwd, '.memory', 'decisions.json'),
      'bad json',
      'utf-8',
    );
    const config = loadDecisionsConfig(projectCwd);
    expect(config.max_daily_runs).toBe(7); // global applied
    expect(config.model).toBe('sonnet'); // default
  });

  it('partial project override preserves global fields', () => {
    writeJson(devflowDir, 'decisions.json', {
      throttle_minutes: 15,
      model: 'haiku',
    });
    writeJson(path.join(projectCwd, '.memory'), 'decisions.json', {
      debug: true,
    });
    const config = loadDecisionsConfig(projectCwd);
    expect(config.throttle_minutes).toBe(15); // from global
    expect(config.model).toBe('haiku'); // from global
    expect(config.debug).toBe(true); // from project
    expect(config.max_daily_runs).toBe(3); // default
  });

  it('batch_size defaults to 1 (not 3 like learning)', () => {
    const config = loadDecisionsConfig(projectCwd);
    expect(config.batch_size).toBe(1);
  });

  it('batch_size can be overridden via project config', () => {
    writeJson(path.join(projectCwd, '.memory'), 'decisions.json', {
      batch_size: 3,
    });
    const config = loadDecisionsConfig(projectCwd);
    expect(config.batch_size).toBe(3);
  });
});
