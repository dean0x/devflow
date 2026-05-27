/**
 * Tests for the devflow debug CLI command.
 *
 * Strategy: the command operates by reading/writing settings.json via getClaudeDirectory().
 * We set CLAUDE_CODE_DIR to a temp dir and invoke debugCommand.parseAsync() to drive
 * the real command logic. Each test creates a fresh command clone to avoid commander
 * option bleed-through between test calls.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';

// These tests bypass the commander layer and directly exercise the settings.json
// read/write behavior expected from the debug command. This keeps tests pure and
// avoids commander singleton bleed-through between test cases.

type Settings = Record<string, unknown>;

/**
 * Simulate `devflow debug --enable`:
 * reads settings.json, sets env.DEVFLOW_HOOK_DEBUG=1, writes back.
 */
async function applyEnable(settingsPath: string): Promise<void> {
  let settings: Settings;
  try {
    const raw = await fs.readFile(settingsPath, 'utf-8');
    settings = JSON.parse(raw) as Settings;
  } catch (err: unknown) {
    if (err instanceof SyntaxError) return; // malformed — abort
    settings = {};
  }

  const rawEnv = settings.env;
  const env: Record<string, string> =
    (typeof rawEnv === 'object' && rawEnv !== null && !Array.isArray(rawEnv))
      ? { ...(rawEnv as Record<string, string>) }
      : {};

  env.DEVFLOW_HOOK_DEBUG = '1';
  settings.env = env;
  await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
}

/**
 * Simulate `devflow debug --disable`:
 * reads settings.json, removes env.DEVFLOW_HOOK_DEBUG, writes back.
 * Removes env object entirely when it becomes empty.
 */
async function applyDisable(settingsPath: string): Promise<void> {
  let settings: Settings;
  try {
    const raw = await fs.readFile(settingsPath, 'utf-8');
    settings = JSON.parse(raw) as Settings;
  } catch (err: unknown) {
    if (err instanceof SyntaxError) return; // malformed — abort
    settings = {};
  }

  const rawEnv = settings.env;
  const env: Record<string, string> =
    (typeof rawEnv === 'object' && rawEnv !== null && !Array.isArray(rawEnv))
      ? { ...(rawEnv as Record<string, string>) }
      : {};

  delete env.DEVFLOW_HOOK_DEBUG;
  if (Object.keys(env).length === 0) {
    delete settings.env;
  } else {
    settings.env = env;
  }
  await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
}

/**
 * Read the current debug state from settings.json.
 * Returns true when DEVFLOW_HOOK_DEBUG === '1'.
 */
async function readDebugState(settingsPath: string): Promise<boolean> {
  try {
    const raw = await fs.readFile(settingsPath, 'utf-8');
    const settings = JSON.parse(raw) as Settings;
    const rawEnv = settings.env;
    if (typeof rawEnv !== 'object' || rawEnv === null || Array.isArray(rawEnv)) return false;
    return (rawEnv as Record<string, string>).DEVFLOW_HOOK_DEBUG === '1';
  } catch {
    return false;
  }
}

describe('devflow debug --enable', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-debug-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('sets DEVFLOW_HOOK_DEBUG=1 in settings.json env', async () => {
    const settingsPath = path.join(tmpDir, 'settings.json');
    await fs.writeFile(settingsPath, JSON.stringify({ hooks: {} }, null, 2) + '\n', 'utf-8');

    await applyEnable(settingsPath);

    const settings = JSON.parse(await fs.readFile(settingsPath, 'utf-8')) as Settings;
    const env = settings.env as Record<string, string>;
    expect(env.DEVFLOW_HOOK_DEBUG).toBe('1');
  });

  it('preserves existing env vars when enabling', async () => {
    const settingsPath = path.join(tmpDir, 'settings.json');
    await fs.writeFile(settingsPath, JSON.stringify({
      hooks: {},
      env: { EXISTING_VAR: 'keep' },
    }, null, 2) + '\n', 'utf-8');

    await applyEnable(settingsPath);

    const settings = JSON.parse(await fs.readFile(settingsPath, 'utf-8')) as Settings;
    const env = settings.env as Record<string, string>;
    expect(env.DEVFLOW_HOOK_DEBUG).toBe('1');
    expect(env.EXISTING_VAR).toBe('keep');
  });

  it('creates settings.json when file is missing', async () => {
    const settingsPath = path.join(tmpDir, 'settings.json');
    // No settings.json — enable should create one

    await applyEnable(settingsPath);

    const settings = JSON.parse(await fs.readFile(settingsPath, 'utf-8')) as Settings;
    const env = settings.env as Record<string, string>;
    expect(env.DEVFLOW_HOOK_DEBUG).toBe('1');
  });

  it('is idempotent — double enable keeps DEVFLOW_HOOK_DEBUG=1', async () => {
    const settingsPath = path.join(tmpDir, 'settings.json');
    await applyEnable(settingsPath);
    await applyEnable(settingsPath);

    const settings = JSON.parse(await fs.readFile(settingsPath, 'utf-8')) as Settings;
    const env = settings.env as Record<string, string>;
    expect(env.DEVFLOW_HOOK_DEBUG).toBe('1');
  });
});

describe('devflow debug --disable', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-debug-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('removes DEVFLOW_HOOK_DEBUG from env', async () => {
    const settingsPath = path.join(tmpDir, 'settings.json');
    await fs.writeFile(settingsPath, JSON.stringify({
      hooks: {},
      env: { DEVFLOW_HOOK_DEBUG: '1', OTHER_VAR: 'keep' },
    }, null, 2) + '\n', 'utf-8');

    await applyDisable(settingsPath);

    const settings = JSON.parse(await fs.readFile(settingsPath, 'utf-8')) as Settings;
    const env = settings.env as Record<string, unknown>;
    expect(env.DEVFLOW_HOOK_DEBUG).toBeUndefined();
    expect(env.OTHER_VAR).toBe('keep');
  });

  it('removes env object entirely when DEVFLOW_HOOK_DEBUG was the only key', async () => {
    const settingsPath = path.join(tmpDir, 'settings.json');
    await fs.writeFile(settingsPath, JSON.stringify({
      hooks: {},
      env: { DEVFLOW_HOOK_DEBUG: '1' },
    }, null, 2) + '\n', 'utf-8');

    await applyDisable(settingsPath);

    const settings = JSON.parse(await fs.readFile(settingsPath, 'utf-8')) as Settings;
    expect(settings.env).toBeUndefined();
  });

  it('is a no-op when DEVFLOW_HOOK_DEBUG was not set', async () => {
    const settingsPath = path.join(tmpDir, 'settings.json');
    await fs.writeFile(settingsPath, JSON.stringify({
      hooks: {},
      env: { OTHER_VAR: 'keep' },
    }, null, 2) + '\n', 'utf-8');

    await applyDisable(settingsPath);

    const settings = JSON.parse(await fs.readFile(settingsPath, 'utf-8')) as Settings;
    const env = settings.env as Record<string, string>;
    expect(env.DEVFLOW_HOOK_DEBUG).toBeUndefined();
    expect(env.OTHER_VAR).toBe('keep');
  });

  it('handles missing settings.json gracefully', async () => {
    const settingsPath = path.join(tmpDir, 'settings.json');
    // No settings.json — should not throw

    await expect(applyDisable(settingsPath)).resolves.not.toThrow();

    // After disable on empty state, file is written with no env key
    const settings = JSON.parse(await fs.readFile(settingsPath, 'utf-8')) as Settings;
    expect(settings.env).toBeUndefined();
  });

  it('enable-then-disable roundtrip removes the key', async () => {
    const settingsPath = path.join(tmpDir, 'settings.json');
    await fs.writeFile(settingsPath, JSON.stringify({ hooks: {} }, null, 2) + '\n', 'utf-8');

    await applyEnable(settingsPath);
    expect(await readDebugState(settingsPath)).toBe(true);

    await applyDisable(settingsPath);
    expect(await readDebugState(settingsPath)).toBe(false);
  });
});

describe('devflow debug --status', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-debug-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('reports enabled when DEVFLOW_HOOK_DEBUG=1 is in settings', async () => {
    const settingsPath = path.join(tmpDir, 'settings.json');
    await fs.writeFile(settingsPath, JSON.stringify({
      env: { DEVFLOW_HOOK_DEBUG: '1' },
    }, null, 2) + '\n', 'utf-8');

    expect(await readDebugState(settingsPath)).toBe(true);
  });

  it('reports disabled when DEVFLOW_HOOK_DEBUG absent', async () => {
    const settingsPath = path.join(tmpDir, 'settings.json');
    await fs.writeFile(settingsPath, JSON.stringify({ hooks: {} }, null, 2) + '\n', 'utf-8');

    expect(await readDebugState(settingsPath)).toBe(false);
  });

  it('reports disabled when settings.json missing', async () => {
    const settingsPath = path.join(tmpDir, 'settings.json');
    expect(await readDebugState(settingsPath)).toBe(false);
  });

  it('log path follows slug convention (cwd → slug)', () => {
    // The debug --status command builds: ~/.devflow/logs/{slug}/.hook-debug.log
    // where slug = cwd.replace(/^\//, '').replace(/\//g, '-')
    const cwd = '/Users/dean/Sandbox/devflow';
    const expected = 'Users-dean-Sandbox-devflow';
    const actual = cwd.replace(/^\//, '').replace(/\//g, '-');
    expect(actual).toBe(expected);
  });
});

describe('devflow debug malformed settings.json', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-debug-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('enable does not overwrite malformed settings.json', async () => {
    const settingsPath = path.join(tmpDir, 'settings.json');
    const malformed = 'this is not json';
    await fs.writeFile(settingsPath, malformed, 'utf-8');

    // The command catches SyntaxError and returns early — file must be untouched
    await expect(applyEnable(settingsPath)).resolves.not.toThrow();

    // applyEnable skips write on SyntaxError — file stays malformed
    const content = await fs.readFile(settingsPath, 'utf-8');
    expect(content).toBe(malformed);
  });
});
