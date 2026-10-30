/**
 * End to end: the compiled CLI on a clean home makes no backup folder and prints no backup line,
 * twice in a row, and a file of the user's in a devflow folder is moved aside, byte for byte, and
 * named in the output. The second part is the control that gives the first part its meaning: it
 * shows that the output has a backup line to miss. A compliance-off install leaves no posting file,
 * by name or by bytes, anywhere under the home, the backup folder included, and the curation and
 * compliance toggles move a file of the user out of their skill folders and name it.
 *
 * Every spawn gets its env from `sandboxEnv(tmpHome)`, which pins the home to a temp folder.
 * Requires a build (`npm run build`).
 */
import { execFileSync, spawnSync } from 'child_process';
import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { COMPLIANCE_OFF_REMOVED_SKILL_FILES } from '../../src/core/compliance-off-files.js';
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

/** The skill files that only a compliance-on machine holds, by the names the install uses. */
const postingFiles = (): string[] =>
  COMPLIANCE_OFF_REMOVED_SKILL_FILES.map(entry => path.join(tmpHome, '.claude', 'skills', ...entry.split('/')));

function runCli(args: readonly string[]): string {
  const result = spawnSync('node', [CLI, ...args], {
    encoding: 'utf-8',
    timeout: SUBPROCESS_TIMEOUT_MS,
    cwd: repo,
    env: sandboxEnv(tmpHome),
  });
  if (result.error) throw result.error;
  const out = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  expect(result.status, `devflow ${args.join(' ')} failed:\n${out}`).toBe(0);
  return out;
}

/** Every file below `root` as an absolute path. */
async function everyFileBelow(root: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) out.push(...(await everyFileBelow(full)));
    else out.push(full);
  }
  return out;
}

describe('a compliance-off install', () => {
  it('leaves no posting file by name or bytes under the home or the backup folder', { timeout: MULTI_RUN_TIMEOUT_MS }, async () => {
    runCli([...INIT_ARGS, '--compliance', 'hipaa']);
    const hashes = new Set<string>();
    for (const file of postingFiles()) {
      expect(await exists(file), `precondition: ${path.basename(file)} is installed`).toBe(true);
      hashes.add(createHash('sha256').update(await fs.readFile(file)).digest('hex'));
    }
    const mine = path.join(commandsFolder(), 'mine-own-command.md');
    await fs.writeFile(mine, 'my own command\n', 'utf-8');

    runCli([...INIT_ARGS, '--no-compliance']);

    const names = new Set(postingFiles().map(file => path.basename(file)));
    const files = await everyFileBelow(tmpHome);
    expect(files.filter(file => names.has(path.basename(file)))).toEqual([]);
    for (const file of files) {
      expect(hashes.has(createHash('sha256').update(await fs.readFile(file)).digest('hex')), `${file} holds posting bytes`).toBe(false);
    }
    expect(files.some(file => file.startsWith(backupRoot())), 'the file of the user was moved, so the control holds').toBe(true);
  });
});

describe('the toggles over a file of the user', () => {
  const skillFile = (skill: string): string => path.join(tmpHome, '.claude', 'skills', skill, 'mine.md');

  async function expectMovedAndNamed(file: string, out: string, text: string): Promise<void> {
    expect(await exists(file), 'the file left its folder').toBe(false);
    const run = /Backup folder: (.+)/.exec(out)?.[1];
    if (run === undefined) throw new Error(`the output names no backup folder:\n${out}`);
    expect(path.dirname(run), 'the run folder is under the backup root').toBe(backupRoot());
    const kept = path.join(run, path.relative(path.join(tmpHome, '.claude'), file));
    expect(await fs.readFile(kept, 'utf-8')).toBe(text);
    expect(out).toContain(`${file} -> ${kept}`);
  }

  it('devflow curation --disable and --enable move the file of the user out of the skill folder', { timeout: MULTI_RUN_TIMEOUT_MS }, async () => {
    runCli(INIT_ARGS);
    const mine = skillFile('devflow:apply-decisions');
    await fs.writeFile(mine, 'my note on decisions\n', 'utf-8');

    const disabled = runCli(['curation', '--disable']);
    await expectMovedAndNamed(mine, disabled, 'my note on decisions\n');
    expect(await exists(path.dirname(mine)), 'the skill folder is gone').toBe(false);

    runCli(['curation', '--enable']);
    await fs.writeFile(mine, 'my second note\n', 'utf-8');
    const enabled = runCli(['curation', '--enable']);
    await expectMovedAndNamed(mine, enabled, 'my second note\n');
  });

  it('devflow compliance --disable and --enable move the file of the user out of the compliance skill', { timeout: MULTI_RUN_TIMEOUT_MS }, async () => {
    runCli(INIT_ARGS);
    const mine = skillFile('devflow:compliance');
    await fs.writeFile(mine, 'my compliance note\n', 'utf-8');

    const disabled = runCli(['compliance', '--disable']);
    await expectMovedAndNamed(mine, disabled, 'my compliance note\n');

    await fs.writeFile(mine, 'my second compliance note\n', 'utf-8');
    const enabled = runCli(['compliance', '--enable']);
    await expectMovedAndNamed(mine, enabled, 'my second compliance note\n');
  });
});
