/**
 * `devflow init` guards that only the real CLI can prove (PF-018: the green test
 * must exercise the shipped path, not a re-implementation of it).
 *
 *   D-INIT-NOT-HOME — in a git repository rooted at HOME (a dotfiles repo), init
 *   writes no per-repository file: no `~/.devflow/config.json` (the machine
 *   root's), no `~/.claudeignore`, no devflow block in `~/.gitignore`.
 *
 * Every spawn runs under a temp HOME built by `sandboxEnv`, which refuses a real
 * home before anything runs (PF-060). Requires a build (`requireBuiltCli`).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync, execFileSync } from 'child_process';
import { existsSync, promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { requireBuiltCli, sandboxEnv } from './helpers.js';
import { withoutHomeRoots } from '../src/core/same-location.js';

const CLI = requireBuiltCli();

// One budget for the spawn and the test that awaits it (a CLI spawn under load
// runs well past vitest's 5 s default).
const SUBPROCESS_TIMEOUT_MS = 60_000;

/** The minimal non-interactive init: no feature that would add unrelated writes. */
const MINIMAL_INIT = [
  'init', '--recommended', '--no-ambient', '--no-memory', '--no-learning', '--no-knowledge',
  '--no-rules', '--no-hud', '--no-proxy', '--no-compliance', '--security', 'none',
];

let home: string;

function runInit(cwd: string, extra: readonly string[] = []): { status: number | null; out: string } {
  const env = sandboxEnv(home);
  const r = spawnSync(process.execPath, [CLI, ...MINIMAL_INIT, ...extra], {
    cwd, env, encoding: 'utf-8', timeout: SUBPROCESS_TIMEOUT_MS,
  });
  if (r.error) throw r.error;
  return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), 'df-init-guards-home-'));
  // init stops with "Claude Code not detected" without a Claude directory.
  await fs.mkdir(path.join(home, '.claude'), { recursive: true });
});

afterEach(async () => {
  await fs.rm(home, { recursive: true, force: true });
});

describe('D-INIT-NOT-HOME: init in a repository rooted at HOME', () => {
  it('writes no per-repository file into HOME, and says why', async () => {
    execFileSync('git', ['init', '-q'], { cwd: home, env: sandboxEnv(home) });
    // Non-vacuity: git really does report HOME as this repository's root.
    const toplevel = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: home, env: sandboxEnv(home), encoding: 'utf-8' }).trim();
    expect(await fs.realpath(toplevel)).toBe(await fs.realpath(home));

    const run = runInit(home);
    expect(run.status, run.out).toBe(0);

    expect(existsSync(path.join(home, '.devflow', 'manifest.json')), 'the machine install still happens').toBe(true);
    expect(existsSync(path.join(home, '.devflow', 'config.json'))).toBe(false);
    expect(existsSync(path.join(home, '.claudeignore'))).toBe(false);
    expect(existsSync(path.join(home, '.gitignore'))).toBe(false);
    expect(run.out).toContain('rooted at your home directory');
  }, SUBPROCESS_TIMEOUT_MS);

  it('still writes the per-repository files in an ordinary repository (the red probe)', async () => {
    const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'df-init-guards-repo-'));
    try {
      execFileSync('git', ['init', '-q'], { cwd: repo, env: sandboxEnv(home) });

      const run = runInit(repo);
      expect(run.status, run.out).toBe(0);

      expect(existsSync(path.join(repo, '.devflow', 'config.json'))).toBe(true);
      expect(existsSync(path.join(repo, '.gitignore'))).toBe(true);
      expect(run.out).not.toContain('rooted at your home directory');
    } finally {
      await fs.rm(repo, { recursive: true, force: true });
    }
  }, SUBPROCESS_TIMEOUT_MS);
});

describe('withoutHomeRoots', () => {
  it('drops HOME — through a symlink too — and keeps every other root in order', async () => {
    const link = path.join(os.tmpdir(), `df-init-guards-link-${process.pid}`);
    await fs.symlink(home, link);
    try {
      const a = path.join(home, 'a');
      const b = path.join(home, 'b');
      expect(await withoutHomeRoots([a, home, b, link], home)).toEqual([a, b]);
      expect(await withoutHomeRoots([], home)).toEqual([]);
    } finally {
      await fs.unlink(link);
    }
  });
});
