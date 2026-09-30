/**
 * `devflow init` guards that only the real CLI can prove (PF-018: the green test
 * must exercise the shipped path, not a re-implementation of it).
 *
 *   D-INIT-NOT-HOME — in a git repository rooted at HOME (a dotfiles repo), init
 *   writes no per-repository file: no `~/.devflow/config.json` (the machine
 *   root's), no `~/.claudeignore`, no devflow block in `~/.gitignore`.
 *
 *   D-INIT-DOWNGRADE-WARN — when the manifest was written by a newer devflow
 *   than the running CLI, init warns, naming both versions, and still installs.
 *
 *   D-LOG-DIR-CAP — init trims ~/.devflow/logs to the MAX_HOOK_LOG_DIRS most
 *   recently written hook log folders.
 *
 * Every spawn runs under a temp HOME built by `sandboxEnv`, which refuses a real
 * home before anything runs (PF-060). Requires a build (`requireBuiltCli`).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync, execFileSync } from 'child_process';
import { existsSync, promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { makeManifest, requireBuiltCli, sandboxEnv } from './helpers.js';
import { withoutHomeRoots } from '../src/core/same-location.js';
import { formatDowngradeWarning } from '../src/cli/commands/init.js';
import { detectUpgrade } from '../src/core/manifest.js';
import { MAX_HOOK_LOG_DIRS } from '../src/core/hook-log-dirs.js';

const CLI = requireBuiltCli();

// One budget for the spawn and the test that awaits it (a CLI spawn under load
// runs well past vitest's 5 s default).
const SUBPROCESS_TIMEOUT_MS = 60_000;

/**
 * The minimal non-interactive init: no feature that would add unrelated writes.
 * `--security user` keeps the deny list in the sandboxed ~/.claude/settings.json;
 * `none` would reach the real system managed-settings file (D-TESTS-NO-SYSTEM-MANAGED).
 */
const MINIMAL_INIT = [
  'init', '--recommended', '--no-ambient', '--no-memory', '--no-learning', '--no-knowledge',
  '--no-rules', '--no-hud', '--no-proxy', '--no-compliance', '--security', 'user',
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

describe('D-INIT-DOWNGRADE-WARN', () => {
  it('formatDowngradeWarning names both versions only for a downgrade', () => {
    const warning = formatDowngradeWarning(detectUpgrade('2.5.0', '3.1.0'), '2.5.0');
    expect(warning).toContain('v3.1.0');
    expect(warning).toContain('v2.5.0');
    expect(formatDowngradeWarning(detectUpgrade('3.1.0', '2.5.0'), '3.1.0')).toBeNull();
    expect(formatDowngradeWarning(detectUpgrade('2.5.0', '2.5.0'), '2.5.0')).toBeNull();
    expect(formatDowngradeWarning(detectUpgrade('2.5.0', 'not-a-version'), '2.5.0')).toBeNull();
  });

  it('init over a manifest from a newer devflow warns and still installs', async () => {
    await fs.mkdir(path.join(home, '.devflow'), { recursive: true });
    await fs.writeFile(
      path.join(home, '.devflow', 'manifest.json'),
      JSON.stringify(makeManifest({ version: '99.0.0' }), null, 2),
    );
    const nonGit = await fs.mkdtemp(path.join(os.tmpdir(), 'df-init-guards-cwd-'));
    try {
      const run = runInit(nonGit);
      expect(run.status, run.out).toBe(0);
      expect(run.out).toContain('Downgrading: this machine was installed by devflow v99.0.0');
    } finally {
      await fs.rm(nonGit, { recursive: true, force: true });
    }
  }, SUBPROCESS_TIMEOUT_MS);

  it('a same-version re-init prints no downgrade warning', async () => {
    const version = (JSON.parse(await fs.readFile(path.join(import.meta.dirname, '..', 'package.json'), 'utf-8')) as { version: string }).version;
    await fs.mkdir(path.join(home, '.devflow'), { recursive: true });
    await fs.writeFile(path.join(home, '.devflow', 'manifest.json'), JSON.stringify(makeManifest({ version }), null, 2));
    const nonGit = await fs.mkdtemp(path.join(os.tmpdir(), 'df-init-guards-cwd-'));
    try {
      const run = runInit(nonGit);
      expect(run.status, run.out).toBe(0);
      expect(run.out).not.toContain('Downgrading');
    } finally {
      await fs.rm(nonGit, { recursive: true, force: true });
    }
  }, SUBPROCESS_TIMEOUT_MS);
});

describe('D-LOG-DIR-CAP: init caps the hook log folders', () => {
  it('removes the oldest folders beyond the cap and keeps the newest', async () => {
    const logs = path.join(home, '.devflow', 'logs');
    const extra = 5;
    for (let i = 0; i < MAX_HOOK_LOG_DIRS + extra; i++) {
      const dir = path.join(logs, `var-folders-test-${String(i).padStart(4, '0')}`);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, '.capture-turn.log'), 'x\n');
      // Folder i is i minutes old: the highest indices are the oldest.
      const at = new Date(Date.now() - i * 60_000);
      await fs.utimes(path.join(dir, '.capture-turn.log'), at, at);
      await fs.utimes(dir, at, at);
    }
    await fs.writeFile(path.join(logs, 'proxy.log'), 'proxy\n');
    const nonGit = await fs.mkdtemp(path.join(os.tmpdir(), 'df-init-guards-cwd-'));
    try {
      const run = runInit(nonGit);
      expect(run.status, run.out).toBe(0);
      expect(run.out).toContain(`Removed ${extra} old hook log folders`);
    } finally {
      await fs.rm(nonGit, { recursive: true, force: true });
    }

    const left = (await fs.readdir(logs, { withFileTypes: true })).filter(e => e.isDirectory()).map(e => e.name);
    expect(left).toHaveLength(MAX_HOOK_LOG_DIRS);
    expect(left).toContain('var-folders-test-0000');
    expect(left).not.toContain(`var-folders-test-${String(MAX_HOOK_LOG_DIRS + extra - 1).padStart(4, '0')}`);
    expect(existsSync(path.join(logs, 'proxy.log'))).toBe(true);
  }, SUBPROCESS_TIMEOUT_MS);
});
