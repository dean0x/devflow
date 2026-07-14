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
    model: 'opus',
    debug: false,
  };

  it('overrides model string field', () => {
    const result = applyDecisionsConfigLayer(base, JSON.stringify({ model: 'haiku' }));
    expect(result.model).toBe('haiku');
  });

  it('overrides debug boolean field', () => {
    const result = applyDecisionsConfigLayer(base, JSON.stringify({ debug: true }));
    expect(result.debug).toBe(true);
  });

  it('ignores non-boolean debug', () => {
    const result = applyDecisionsConfigLayer(base, JSON.stringify({ debug: 'yes' }));
    expect(result.debug).toBe(false);
  });

  it('ignores non-string model', () => {
    const result = applyDecisionsConfigLayer(base, JSON.stringify({ model: 42 }));
    expect(result.model).toBe('opus');
  });

  it('returns a new object — does not mutate input', () => {
    const input: DecisionsConfig = { ...base };
    const result = applyDecisionsConfigLayer(input, JSON.stringify({ model: 'sonnet' }));
    expect(result.model).toBe('sonnet');
    expect(input.model).toBe('opus'); // not mutated
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

  it('ignores dropped legacy fields (max_daily_runs/throttle_minutes) without error', () => {
    // On-disk configs from before the dream-system simplification may still carry
    // these fields — they must load without error and be silently ignored.
    const result = applyDecisionsConfigLayer(
      base,
      JSON.stringify({ max_daily_runs: 7, throttle_minutes: 15, model: 'haiku' }),
    );
    expect(result).toEqual({ model: 'haiku', debug: false });
    expect((result as Record<string, unknown>).max_daily_runs).toBeUndefined();
    expect((result as Record<string, unknown>).throttle_minutes).toBeUndefined();
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
    ensureDir(path.join(projectCwd, '.devflow', 'learning'));

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
    expect(config.model).toBe('opus');
    expect(config.debug).toBe(false);
  });

  it('global config overrides defaults', () => {
    writeJson(devflowDir, 'learning.json', { model: 'haiku' });
    const config = loadDecisionsConfig(projectCwd);
    expect(config.model).toBe('haiku');
    expect(config.debug).toBe(false); // default preserved
  });

  it('project config overrides global config', () => {
    writeJson(devflowDir, 'learning.json', {
      model: 'haiku',
      debug: true,
    });
    writeJson(path.join(projectCwd, '.devflow', 'learning'), 'learning.json', {
      model: 'sonnet',
    });
    const config = loadDecisionsConfig(projectCwd);
    expect(config.model).toBe('sonnet'); // project wins
    expect(config.debug).toBe(true); // global preserved when project doesn't set
  });

  it('project config alone overrides defaults', () => {
    writeJson(path.join(projectCwd, '.devflow', 'learning'), 'learning.json', {
      model: 'sonnet',
    });
    const config = loadDecisionsConfig(projectCwd);
    expect(config.model).toBe('sonnet');
    expect(config.debug).toBe(false); // default
  });

  it('invalid JSON in global config returns defaults without crashing', () => {
    fs.writeFileSync(
      path.join(devflowDir, 'learning.json'),
      'not json',
      'utf-8',
    );
    const config = loadDecisionsConfig(projectCwd);
    expect(config.model).toBe('opus');
  });

  it('invalid JSON in project config falls back to global + defaults', () => {
    writeJson(devflowDir, 'learning.json', { model: 'haiku' });
    fs.writeFileSync(
      path.join(projectCwd, '.devflow', 'learning', 'learning.json'),
      'bad json',
      'utf-8',
    );
    const config = loadDecisionsConfig(projectCwd);
    expect(config.model).toBe('haiku'); // global applied
  });

  it('partial project override preserves global fields', () => {
    writeJson(devflowDir, 'learning.json', {
      model: 'haiku',
    });
    writeJson(path.join(projectCwd, '.devflow', 'learning'), 'learning.json', {
      debug: true,
    });
    const config = loadDecisionsConfig(projectCwd);
    expect(config.model).toBe('haiku'); // from global
    expect(config.debug).toBe(true); // from project
  });

  it('AC-C5: model defaults to opus (not sonnet) when nothing configures it', () => {
    const config = loadDecisionsConfig(projectCwd);
    expect(config.model).toBe('opus');
  });

  it('on-disk config still containing dropped max_daily_runs/throttle_minutes loads without error', () => {
    writeJson(path.join(projectCwd, '.devflow', 'learning'), 'learning.json', {
      max_daily_runs: 3,
      throttle_minutes: 5,
      model: 'haiku',
    });
    const config = loadDecisionsConfig(projectCwd);
    expect(config.model).toBe('haiku');
    expect((config as Record<string, unknown>).max_daily_runs).toBeUndefined();
    expect((config as Record<string, unknown>).throttle_minutes).toBeUndefined();
  });
});
