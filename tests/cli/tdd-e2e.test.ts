/**
 * End-to-end: `devflow tdd` and the machine TDD switch (#756, AC8).
 *
 * `devflow tdd --enable | --disable | --status` writes and reads `features.tdd` in
 * ~/.devflow/manifest.json. `devflow init` has no flag and no prompt for it, so a re-init must
 * carry a stored value forward and `--reset` must forget it. The installed settings resolver reads
 * the same value onto the settings line.
 *
 * These drive the REAL compiled CLI. Every spawn gets its env from the shared `sandboxEnv(tmpHome)`,
 * an allowlist with HOME pinned to a temp dir, so the real ~/.devflow is never touched. Requires a
 * build (`npm run build`).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync, execFileSync } from 'child_process';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { requireBuiltCli, sandboxEnv } from '../helpers.js';

const CLI = requireBuiltCli();

/** One CLI spawn under load runs well past vitest's 5 s default. */
const SUBPROCESS_TIMEOUT_MS = 60_000;
/** Tests that chain several spawns get a budget of several. */
const MULTI_RUN_TIMEOUT_MS = 6 * SUBPROCESS_TIMEOUT_MS;

let tmpHome: string;
let repo: string;

const devflowDir = (): string => path.join(tmpHome, '.devflow');
const manifestPath = (): string => path.join(devflowDir(), 'manifest.json');

function runNode(args: string[]): { status: number | null; out: string } {
  const result = spawnSync('node', args, {
    encoding: 'utf-8',
    timeout: SUBPROCESS_TIMEOUT_MS,
    cwd: repo,
    env: sandboxEnv(tmpHome),
  });
  if (result.error) throw result.error;
  return { status: result.status, out: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

const runCli = (...args: string[]): { status: number | null; out: string } => runNode([CLI, ...args]);

function runInit(...args: string[]): void {
  const { status, out } = runCli('init', ...args);
  expect(status, `init ${args.join(' ')} failed:\n${out}`).toBe(0);
}

async function readFeatures(): Promise<Record<string, unknown>> {
  return (JSON.parse(await fs.readFile(manifestPath(), 'utf-8')) as { features: Record<string, unknown> }).features;
}

/** The settings line the INSTALLED resolver prints for the repository, as a Claude prompt would read it. */
function settingsLine(): string {
  const { status, out } = runNode([path.join(devflowDir(), 'scripts', 'resolve-settings.cjs'), repo]);
  expect(status, out).toBe(0);
  return out.trim();
}

beforeEach(async () => {
  tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'df-tdd-home-'));
  repo = await fs.mkdtemp(path.join(os.tmpdir(), 'df-tdd-repo-'));
  // init bails with "Claude Code not detected" without a ~/.claude dir
  await fs.mkdir(path.join(tmpHome, '.claude'), { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: repo });
});

afterEach(async () => {
  for (const dir of [tmpHome, repo]) {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

describe('devflow tdd without an install', () => {
  it('--status reads as enabled and writes nothing; --enable and --disable refuse with exit 1', () => {
    const status = runCli('tdd', '--status');
    expect(status.status).toBe(0);
    expect(status.out).toContain('enabled');
    for (const flag of ['--enable', '--disable']) {
      const refused = runCli('tdd', flag);
      expect(refused.status, refused.out).toBe(1);
      expect(refused.out).toContain('not installed');
    }
  });
});

describe('devflow tdd after an install', () => {
  it('toggles the machine switch, and the installed settings line follows it', async () => {
    runInit('--recommended');
    expect(Object.hasOwn(await readFeatures(), 'tdd')).toBe(false);
    expect(runCli('tdd', '--status').out).toContain('enabled');
    expect(settingsLine()).toMatch(/ KNOWLEDGE=on TDD=on GATE_LEVEL=\w+$/);

    expect(runCli('tdd', '--disable').status).toBe(0);
    expect((await readFeatures()).tdd).toBe(false);
    expect(runCli('tdd', '--status').out).toContain('disabled');
    expect(settingsLine()).toMatch(/ KNOWLEDGE=on TDD=off GATE_LEVEL=\w+$/);

    expect(runCli('tdd', '--enable').status).toBe(0);
    expect((await readFeatures()).tdd).toBe(true);
    expect(settingsLine()).toMatch(/ TDD=on /);
  }, MULTI_RUN_TIMEOUT_MS);

  it('a repository file with a tdd key does not change the line', async () => {
    runInit('--recommended');
    runCli('tdd', '--disable');
    await fs.mkdir(path.join(repo, '.devflow'), { recursive: true });
    await fs.writeFile(path.join(repo, '.devflow', 'project.json'), '{"version":1,"features":{"tdd":true},"tdd":true}\n', 'utf-8');
    await fs.writeFile(path.join(repo, '.devflow', 'config.json'), '{"features":{"tdd":true},"tdd":true}\n', 'utf-8');
    expect(settingsLine()).toMatch(/ TDD=off /);
  }, MULTI_RUN_TIMEOUT_MS);

  it('a re-init keeps a disabled switch, and init --reset forgets it', async () => {
    runInit('--recommended');
    runCli('tdd', '--disable');
    runInit('--recommended');
    expect((await readFeatures()).tdd).toBe(false);
    runInit('--recommended', '--reset');
    expect(Object.hasOwn(await readFeatures(), 'tdd')).toBe(false);
    expect(runCli('tdd', '--status').out).toContain('enabled');
  }, MULTI_RUN_TIMEOUT_MS);

  it('refuses two actions at once and leaves the manifest bytes alone', async () => {
    runInit('--recommended');
    const before = await fs.readFile(manifestPath(), 'utf-8');
    const refused = runCli('tdd', '--enable', '--disable');
    expect(refused.status, refused.out).toBe(1);
    expect(await fs.readFile(manifestPath(), 'utf-8')).toBe(before);
  }, MULTI_RUN_TIMEOUT_MS);

  it('is listed by devflow --help', () => {
    expect(runCli('--help').out).toMatch(/^\s+tdd\b/m);
  });
});
