/**
 * Tests for `devflow debug`.
 *
 * The pure half (applyDebugTrace / stripDebugTrace / readDebugStatus) is tested
 * on plain JSON strings. The command itself is driven through the built CLI
 * under a temp HOME (`sandboxEnv`), because what matters there is what
 * lands on disk: a rejected settings file keeps its bytes, and an accepted one
 * is swapped in by a rename (D-SETTINGS-ATOMIC), through a symlink when it is one.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawnSync } from 'child_process';
import {
  applyDebugTrace,
  stripDebugTrace,
  readDebugStatus,
  type DebugSettingsEdit,
} from '../src/cli/commands/debug.js';
import { requireBuiltCli, sandboxEnv } from './helpers.js';

const SUBPROCESS_TIMEOUT_MS = 60_000;

/** The edited settings, parsed; fails the test on a rejected edit. */
function edited(result: DebugSettingsEdit): Record<string, unknown> {
  if (!result.ok) throw new Error(`edit rejected: ${result.error.kind}`);
  return JSON.parse(result.value) as Record<string, unknown>;
}

// ─── applyDebugTrace ──────────────────────────────────────────────────────────

describe('applyDebugTrace', () => {
  it('sets DEVFLOW_HOOK_DEBUG=1 in env', () => {
    const result = edited(applyDebugTrace(JSON.stringify({ hooks: {} })));
    expect((result.env as Record<string, string>).DEVFLOW_HOOK_DEBUG).toBe('1');
  });

  it('preserves existing env vars when enabling', () => {
    const input = JSON.stringify({ hooks: {}, env: { EXISTING_VAR: 'keep' } });
    const env = edited(applyDebugTrace(input)).env as Record<string, string>;
    expect(env.DEVFLOW_HOOK_DEBUG).toBe('1');
    expect(env.EXISTING_VAR).toBe('keep');
  });

  it('creates env object when settings has none', () => {
    const result = edited(applyDebugTrace(JSON.stringify({})));
    expect((result.env as Record<string, string>).DEVFLOW_HOOK_DEBUG).toBe('1');
  });

  it('is idempotent — double apply keeps DEVFLOW_HOOK_DEBUG=1', () => {
    const once = applyDebugTrace(JSON.stringify({ hooks: {} }));
    if (!once.ok) throw new Error('first apply rejected');
    const result = edited(applyDebugTrace(once.value));
    expect((result.env as Record<string, string>).DEVFLOW_HOOK_DEBUG).toBe('1');
  });

  it('is malformed, never a throw, on invalid JSON or a non-object document', () => {
    expect(applyDebugTrace('not json')).toEqual({ ok: false, error: { kind: 'malformed' } });
    expect(applyDebugTrace('[]')).toEqual({ ok: false, error: { kind: 'malformed' } });
  });

  it.each([
    ['an array', []],
    ['null', null],
    ['a string', 'DEVFLOW_HOOK_DEBUG=1'],
    ['a number', 1],
  ])('rejects an env that is %s rather than writing through or replacing it (D-DEBUG-ENV-OBJECT)', (_label, env) => {
    expect(applyDebugTrace(JSON.stringify({ env }))).toEqual({ ok: false, error: { kind: 'env-not-object' } });
  });
});

// ─── stripDebugTrace ─────────────────────────────────────────────────────────

describe('stripDebugTrace', () => {
  it('removes DEVFLOW_HOOK_DEBUG from env', () => {
    const input = JSON.stringify({ hooks: {}, env: { DEVFLOW_HOOK_DEBUG: '1', OTHER_VAR: 'keep' } });
    const env = edited(stripDebugTrace(input)).env as Record<string, unknown>;
    expect(env.DEVFLOW_HOOK_DEBUG).toBeUndefined();
    expect(env.OTHER_VAR).toBe('keep');
  });

  it('removes env object entirely when DEVFLOW_HOOK_DEBUG was the only key', () => {
    const input = JSON.stringify({ hooks: {}, env: { DEVFLOW_HOOK_DEBUG: '1' } });
    const result = edited(stripDebugTrace(input));
    expect(result.env).toBeUndefined();
    expect(result.hooks).toEqual({});
  });

  it('is a no-op when DEVFLOW_HOOK_DEBUG was not set', () => {
    const input = JSON.stringify({ hooks: {}, env: { OTHER_VAR: 'keep' } });
    expect(edited(stripDebugTrace(input))).toEqual({ hooks: {}, env: { OTHER_VAR: 'keep' } });
  });

  it('leaves a settings file with no env without one', () => {
    expect(edited(stripDebugTrace('{}'))).toEqual({});
  });

  it('is malformed, never a throw, on invalid JSON', () => {
    expect(stripDebugTrace('not json')).toEqual({ ok: false, error: { kind: 'malformed' } });
  });

  it('rejects a non-object env', () => {
    expect(stripDebugTrace(JSON.stringify({ env: [] }))).toEqual({ ok: false, error: { kind: 'env-not-object' } });
  });
});

// ─── readDebugStatus ─────────────────────────────────────────────────────────

describe('readDebugStatus', () => {
  it('returns true when DEVFLOW_HOOK_DEBUG=1 is in settings', () => {
    expect(readDebugStatus(JSON.stringify({ env: { DEVFLOW_HOOK_DEBUG: '1' } }))).toBe(true);
  });

  it('returns false when DEVFLOW_HOOK_DEBUG is absent', () => {
    expect(readDebugStatus(JSON.stringify({ hooks: {} }))).toBe(false);
  });

  it('returns false when env is missing', () => {
    expect(readDebugStatus(JSON.stringify({}))).toBe(false);
  });

  it('returns false when env is not an object', () => {
    expect(readDebugStatus(JSON.stringify({ env: 'string' }))).toBe(false);
  });

  it('returns false when env is an array', () => {
    expect(readDebugStatus(JSON.stringify({ env: [] }))).toBe(false);
  });

  it('returns false when DEVFLOW_HOOK_DEBUG is a non-1 value', () => {
    expect(readDebugStatus(JSON.stringify({ env: { DEVFLOW_HOOK_DEBUG: 'true' } }))).toBe(false);
    expect(readDebugStatus(JSON.stringify({ env: { DEVFLOW_HOOK_DEBUG: '0' } }))).toBe(false);
  });

  it('throws on malformed JSON', () => {
    expect(() => readDebugStatus('not json')).toThrow(SyntaxError);
  });
});

// ─── apply→strip roundtrip ───────────────────────────────────────────────────

describe('applyDebugTrace → stripDebugTrace roundtrip', () => {
  it('removes the key after enable-then-disable', () => {
    const enabled = applyDebugTrace(JSON.stringify({ hooks: {} }));
    if (!enabled.ok) throw new Error('apply rejected');
    expect(readDebugStatus(enabled.value)).toBe(true);
    const disabled = stripDebugTrace(enabled.value);
    if (!disabled.ok) throw new Error('strip rejected');
    expect(readDebugStatus(disabled.value)).toBe(false);
  });
});

// ─── The command, through the built CLI ──────────────────────────────────────

describe('devflow debug — the built CLI', () => {
  const cli = requireBuiltCli();
  let home: string;
  let settingsPath: string;

  function runDebug(flag: string): { status: number | null; out: string } {
    const r = spawnSync(process.execPath, [cli, 'debug', flag], {
      cwd: home, env: sandboxEnv(home), encoding: 'utf-8', timeout: SUBPROCESS_TIMEOUT_MS,
    });
    if (r.error) throw r.error;
    return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
  }

  beforeEach(async () => {
    home = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-debug-home-'));
    await fs.mkdir(path.join(home, '.claude'));
    settingsPath = path.join(home, '.claude', 'settings.json');
  });

  afterEach(async () => {
    await fs.rm(home, { recursive: true, force: true });
  });

  it.each(['--enable', '--disable'])('%s with "env": [] exits 1 and leaves the bytes untouched', async (flag) => {
    const body = '{\n  "env": [],\n  "hooks": {}\n}\n';
    await fs.writeFile(settingsPath, body);

    const run = runDebug(flag);

    expect(run.status, run.out).toBe(1);
    expect(run.out).toContain('"env" that is not an object');
    expect(await fs.readFile(settingsPath, 'utf-8')).toBe(body);
  }, SUBPROCESS_TIMEOUT_MS);

  it('--enable swaps the file in by rename: a hard link to the old file keeps the old bytes', async () => {
    const before = JSON.stringify({ env: { KEEP: '1' } });
    await fs.writeFile(settingsPath, before);
    const hardLink = path.join(home, 'settings.before');
    await fs.link(settingsPath, hardLink);

    const run = runDebug('--enable');

    expect(run.status, run.out).toBe(0);
    expect(JSON.parse(await fs.readFile(settingsPath, 'utf-8'))).toEqual({ env: { KEEP: '1', DEVFLOW_HOOK_DEBUG: '1' } });
    // An in-place write would have changed the shared inode; a rename leaves it alone.
    expect(await fs.readFile(hardLink, 'utf-8')).toBe(before);
  }, SUBPROCESS_TIMEOUT_MS);

  it('--enable keeps a symlinked settings.json a symlink and writes its target', async () => {
    const dotfiles = path.join(home, 'dotfiles');
    await fs.mkdir(dotfiles);
    const target = path.join(dotfiles, 'claude-settings.json');
    await fs.writeFile(target, '{}');
    await fs.symlink(target, settingsPath);

    const run = runDebug('--enable');

    expect(run.status, run.out).toBe(0);
    expect((await fs.lstat(settingsPath)).isSymbolicLink()).toBe(true);
    expect(JSON.parse(await fs.readFile(target, 'utf-8'))).toEqual({ env: { DEVFLOW_HOOK_DEBUG: '1' } });
  }, SUBPROCESS_TIMEOUT_MS);
});
