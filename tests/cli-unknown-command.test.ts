/**
 * CLI process-level guard: unknown subcommands must exit non-zero.
 *
 * Spawns dist/cli.js as a real child process so we can observe the actual exit
 * code and stderr output. This covers the regression where Commander's root
 * `.action()` swallowed unknown subcommands (e.g. the removed `devflow list`)
 * and exited 0 instead of emitting an error.
 *
 * Requires a build: `npm run build` first (dist/cli.js is spawned as a subprocess).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { requireBuiltCli, sandboxEnv } from './helpers.js';

const CLI = requireBuiltCli();

function runCli(...args: string[]) {
  return spawnSync('node', [CLI, ...args], {
    encoding: 'utf-8',
    env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
  });
}

describe('CLI: bare invocation exits 0 with help', () => {
  it('devflow (no args) exits 0 and prints usage', () => {
    const result = runCli();
    expect(result.status).toBe(0);
    expect(result.stdout + result.stderr).toContain('Usage: devflow');
  });

  it('devflow --help exits 0', () => {
    const result = runCli('--help');
    expect(result.status).toBe(0);
    expect(result.stdout + result.stderr).toContain('Usage: devflow');
  });
});

describe('CLI: unknown subcommand exits 1 with error message', () => {
  it('devflow list (removed command) exits 1', () => {
    const result = runCli('list');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('unknown command');
  });

  it('devflow no-such-cmd exits 1', () => {
    const result = runCli('no-such-cmd');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('unknown command');
  });

  it('error message names the bad subcommand', () => {
    const result = runCli('list');
    expect(result.stderr).toContain("'list'");
  });
});

describe('CLI: real subcommands are unaffected', () => {
  it('devflow init --help exits 0', () => {
    const result = runCli('init', '--help');
    expect(result.status).toBe(0);
  });

  it('devflow flags --help exits 0', () => {
    const result = runCli('flags', '--help');
    expect(result.status).toBe(0);
  });

  it('devflow rules --help exits 0', () => {
    const result = runCli('rules', '--help');
    expect(result.status).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// #529 (TP-20, TP-21): `devflow learning` became `devflow curation`. There is no alias
// and no pointer command for the old name: the old command and both old init flags
// fail with the argument parser's own unknown error, and say nothing more.
// ---------------------------------------------------------------------------

describe('CLI: the retired learning command and flags fail with the parser\'s unknown error (#529)', () => {
  it('devflow learning exits 1 with an unknown command error naming it', () => {
    const result = runCli('learning');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("unknown command 'learning'");
  });

  it.each(['--status', '--list', '--enable', '--disable', '--clear', '--reset', '--configure'])(
    'devflow learning %s exits 1 and runs nothing',
    (flag) => {
      const result = runCli('learning', flag);
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/unknown (command|option)/);
      expect(result.stdout).toBe('');
    },
  );

  it('devflow learning prints no pointer to the new name (no alias, no pointer command)', () => {
    const result = runCli('learning');
    expect(`${result.stdout}${result.stderr}`).not.toMatch(/curation/i);
  });

  it.each(['--learning', '--no-learning'])('devflow init %s exits 1 with an unknown option error', (flag) => {
    const result = runCli('init', flag);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`unknown option '${flag}'`);
  });

  it('the root help lists curation and not learning', () => {
    const result = runCli('--help');
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/^\s+curation\b/m);
    expect(result.stdout).not.toMatch(/^\s+learning\b/m);
  });
});

describe('CLI: the curation forms exit 0 (#529)', () => {
  let home: string;
  let cwd: string;

  beforeEach(() => {
    home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'df-curation-cli-home-')));
    cwd = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'df-curation-cli-cwd-')));
    fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  function runIn(...args: string[]) {
    return spawnSync('node', [CLI, ...args], { encoding: 'utf-8', cwd, env: sandboxEnv(home), timeout: 60_000 });
  }

  it('devflow curation --help exits 0', () => {
    expect(runIn('curation', '--help').status).toBe(0);
  });

  it('devflow curation --status exits 0 and names the new feature word', () => {
    const result = runIn('curation', '--status');
    expect(result.status).toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('Curation: enabled');
  });

  it('devflow init --help lists --curation and --no-curation, and not the old pair', () => {
    const result = runIn('init', '--help');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('--curation');
    expect(result.stdout).toContain('--no-curation');
    expect(result.stdout).not.toMatch(/--(no-)?learning/);
  });
});
