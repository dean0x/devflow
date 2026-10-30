/**
 * End to end: the compiled CLI on a clean home makes no backup folder and prints no backup line,
 * twice in a row, and a file of the user's in a devflow folder is moved aside, byte for byte, and
 * named in the output. The second part is the control that gives the first part its meaning: it
 * shows that the output has a backup line to miss.
 *
 * Every spawn gets its env from `sandboxEnv(tmpHome)`, which pins the home to a temp folder.
 * Requires a build (`npm run build`).
 */
import { execFileSync, spawnSync } from 'child_process';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { requireBuiltCli, sandboxEnv } from '../helpers.js';
import { assertTempHome } from '../setup/home-isolation.js';

const CLI = requireBuiltCli();
const SUBPROCESS_TIMEOUT_MS = 60_000;
const MULTI_RUN_TIMEOUT_MS = 4 * SUBPROCESS_TIMEOUT_MS;
const INIT_ARGS = ['init', '--recommended', '--no-ambient', '--no-memory', '--no-knowledge'];

/** The pieces of a backup report in the output of a run. */
const BACKUP_LINES = ['that devflow does not ship', 'Backup folder', 'retired devflow file', 'Could not move'];

let base: string;
let tmpHome: string;
let repo: string;

const backupRoot = (): string => path.join(tmpHome, '.devflow', 'install-backups');
const commandsFolder = (): string => path.join(tmpHome, '.claude', 'commands', 'devflow');

const exists = (target: string): Promise<boolean> => fs.lstat(target).then(() => true, () => false);

beforeEach(async () => {
  base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'df-backup-e2e-')));
  assertTempHome(base);
  tmpHome = path.join(base, 'home');
  repo = path.join(base, 'project');
  console.log(`install-backup-e2e test home: ${tmpHome}`);
  await fs.mkdir(path.join(tmpHome, '.claude'), { recursive: true });
  await fs.mkdir(repo);
  execFileSync('git', ['init', '-q'], { cwd: repo });
});

afterEach(async () => {
  await fs.rm(base, { recursive: true, force: true });
});

function runInit(): string {
  const result = spawnSync('node', [CLI, ...INIT_ARGS], {
    encoding: 'utf-8',
    timeout: SUBPROCESS_TIMEOUT_MS,
    cwd: repo,
    env: sandboxEnv(tmpHome),
  });
  if (result.error) throw result.error;
  const out = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  expect(result.status, `init failed:\n${out}`).toBe(0);
  return out;
}

describe('devflow init on a clean home', () => {
  it('makes no backup folder and prints no backup line, in two runs', { timeout: MULTI_RUN_TIMEOUT_MS }, async () => {
    for (const run of ['first', 'second']) {
      const out = runInit();
      expect(await exists(backupRoot()), `the ${run} run made a backup folder`).toBe(false);
      for (const line of BACKUP_LINES) {
        expect(out, `the ${run} run printed a backup line`).not.toContain(line);
      }
    }
  });
});

describe('devflow init over a file of the user', () => {
  it('moves it to the backup folder with its bytes and names both places', { timeout: MULTI_RUN_TIMEOUT_MS }, async () => {
    runInit();
    const mine = path.join(commandsFolder(), 'mine-own-command.md');
    await fs.writeFile(mine, 'my own command\n', 'utf-8');

    const out = runInit();

    expect(await exists(mine), 'the file left the devflow folder').toBe(false);
    const runs = await fs.readdir(backupRoot());
    expect(runs).toHaveLength(1);
    const kept = path.join(backupRoot(), runs[0], 'commands', 'devflow', 'mine-own-command.md');
    expect(await fs.readFile(kept, 'utf-8')).toBe('my own command\n');
    expect(out).toContain('Moved 1 item(s) that devflow does not ship');
    expect(out).toContain(`${mine} -> ${kept}`);
    expect(out).toContain(`Backup folder: ${path.join(backupRoot(), runs[0])}`);
  });
});
