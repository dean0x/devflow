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
import { ROOT, requireBuiltCli, sandboxEnv } from '../helpers.js';
import { assertTempHome } from '../setup/home-isolation.js';

const CLI = requireBuiltCli();
const SUBPROCESS_TIMEOUT_MS = 60_000;
const MULTI_RUN_TIMEOUT_MS = 4 * SUBPROCESS_TIMEOUT_MS;
const INIT_ARGS = ['init', '--recommended', '--no-ambient', '--no-memory', '--no-knowledge'];

/**
 * The pieces of a backup report in the output of a run: the moved line, the run folder, the retired
 * line, each warning that starts `Could not ` (move, scan, remove, finish a step, use the backup
 * folder) and the entry-cap warning. A clean run prints none of them.
 */
const BACKUP_LINES = ['that devflow does not ship', 'Backup folder', 'retired devflow file', 'Could not ', 'more than the limit'];

let base: string;
let tmpHome: string;
let repo: string;

const backupRoot = (): string => path.join(tmpHome, '.devflow', 'install-backups');
const commandsFolder = (): string => path.join(tmpHome, '.claude', 'commands', 'devflow');

const exists = (target: string): Promise<boolean> => fs.lstat(target).then(() => true, () => false);

/** The `SKILL.md` that devflow 1.8.3 installed as `skills/python`, byte for byte. */
const RELEASED_PYTHON = path.join(ROOT, 'tests', 'fixtures', 'released-legacy-skills', 'python.SKILL.md');

const skillsFolder = (): string => path.join(tmpHome, '.claude', 'skills');

/** Plant the folder that a release of devflow installed as `skills/python`. Returns the folder. */
async function plantReleasedPython(): Promise<string> {
  const folder = path.join(skillsFolder(), 'python');
  await fs.mkdir(folder, { recursive: true });
  await fs.copyFile(RELEASED_PYTHON, path.join(folder, 'SKILL.md'));
  return folder;
}

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

  it('moves a file named like a name that no release shipped, with its bytes, and does not call it retired', { timeout: MULTI_RUN_TIMEOUT_MS }, async () => {
    runInit();
    const mine = {
      'agents/devflow/tester.md': 'my tester\n',
      'commands/devflow/review.md': 'my review command\n',
    };
    for (const [rel, text] of Object.entries(mine)) await fs.writeFile(path.join(tmpHome, '.claude', rel), text, 'utf-8');

    const out = runInit();

    const runs = await fs.readdir(backupRoot());
    expect(runs).toHaveLength(1);
    for (const [rel, text] of Object.entries(mine)) {
      const original = path.join(tmpHome, '.claude', rel);
      const kept = path.join(backupRoot(), runs[0], rel);
      expect(await exists(original), `${rel} left its folder`).toBe(false);
      expect(await fs.readFile(kept, 'utf-8'), `${rel} kept its bytes`).toBe(text);
      expect(out).toContain(`${original} -> ${kept}`);
    }
    expect(out).not.toContain('retired devflow file');
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

/** The file left its folder, sits in the run folder the output names with the same bytes, and the output names both paths. */
async function expectMovedAndNamed(file: string, out: string, text: string): Promise<void> {
  expect(await exists(file), 'the file left its folder').toBe(false);
  const run = /Backup folder: (.+)/.exec(out)?.[1];
  if (run === undefined) throw new Error(`the output names no backup folder:\n${out}`);
  expect(path.dirname(run), 'the run folder is under the backup root').toBe(backupRoot());
  const kept = path.join(run, path.relative(path.join(tmpHome, '.claude'), file));
  expect(await fs.readFile(kept, 'utf-8')).toBe(text);
  expect(out).toContain(`${file} -> ${kept}`);
}

describe('the toggles over a file of the user', () => {
  const skillFile = (skill: string): string => path.join(tmpHome, '.claude', 'skills', skill, 'mine.md');

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

describe('the rules folder over a file of the user', () => {
  const rulesFolder = (): string => path.join(tmpHome, '.claude', 'rules', 'devflow');
  const mineRule = (): string => path.join(rulesFolder(), 'mine-rule.md');

  it('devflow rules --disable moves the file out, names it and removes the folder', { timeout: MULTI_RUN_TIMEOUT_MS }, async () => {
    runCli(INIT_ARGS);
    expect(await exists(rulesFolder()), 'precondition: init installed the rules').toBe(true);
    await fs.writeFile(mineRule(), 'my rule\n', 'utf-8');

    const out = runCli(['rules', '--disable']);

    await expectMovedAndNamed(mineRule(), out, 'my rule\n');
    expect(await exists(rulesFolder()), 'the folder is gone').toBe(false);
    expect(out).toContain('Rules disabled — removed rules directory');
  });

  it('devflow rules --enable moves the file out, names it and installs the rules', { timeout: MULTI_RUN_TIMEOUT_MS }, async () => {
    runCli(INIT_ARGS);
    await fs.writeFile(mineRule(), 'my rule\n', 'utf-8');

    const out = runCli(['rules', '--enable']);

    await expectMovedAndNamed(mineRule(), out, 'my rule\n');
    expect((await fs.readdir(rulesFolder())).length, 'the rules are installed again').toBeGreaterThan(0);
  });

  it('devflow init with rules off moves the file out, names it and removes the folder', { timeout: MULTI_RUN_TIMEOUT_MS }, async () => {
    runCli(INIT_ARGS);
    await fs.writeFile(mineRule(), 'my rule\n', 'utf-8');

    const out = runCli([...INIT_ARGS, '--plugin=devflow-code-review', '--no-rules']);

    await expectMovedAndNamed(mineRule(), out, 'my rule\n');
    expect(await exists(rulesFolder()), 'the folder is gone').toBe(false);
  });
});

describe('devflow init over files of earlier releases', () => {
  it('moves a legacy skill folder whole and a file of the user into one run folder, names both, and names a removed legacy hook script', { timeout: MULTI_RUN_TIMEOUT_MS }, async () => {
    runInit();
    const legacySkill = await plantReleasedPython();
    const mine = path.join(commandsFolder(), 'mine.md');
    await fs.writeFile(mine, 'my own command\n', 'utf-8');
    const hook = path.join(tmpHome, '.devflow', 'scripts', 'hooks', 'ambient-prompt');
    await fs.mkdir(path.dirname(hook), { recursive: true });
    await fs.writeFile(hook, 'an old hook\n', 'utf-8');

    const out = runInit();

    expect(await exists(legacySkill), 'the folder left skills/').toBe(false);
    expect(await exists(mine), 'the file left the devflow folder').toBe(false);
    expect(await exists(hook), 'the hook script is removed').toBe(false);
    const runs = await fs.readdir(backupRoot());
    expect(runs, 'one init makes one run folder').toHaveLength(1);
    const kept = path.join(backupRoot(), runs[0], 'skills', 'python');
    expect(await fs.readFile(path.join(kept, 'SKILL.md'))).toEqual(await fs.readFile(RELEASED_PYTHON));
    const keptFile = path.join(backupRoot(), runs[0], 'commands', 'devflow', 'mine.md');
    expect(await fs.readFile(keptFile, 'utf-8')).toBe('my own command\n');
    expect(out).toContain('Moved 2 item(s) that devflow does not ship');
    expect(out.match(/Backup folder: /g), 'the output names the run folder once').toHaveLength(1);
    expect(out).toContain(`${mine} -> ${keptFile}`);
    expect(out).toContain(`${legacySkill}/ -> ${kept}/`);
    expect(out).toContain(`Removed 1 retired devflow file(s): ${hook}`);
    expect(await exists(path.join(backupRoot(), runs[0], 'scripts')), 'a removed script is never copied to the backup folder').toBe(false);
  });
});

describe('devflow init over a bare skill folder with a legacy name', () => {
  it('keeps a skill of the user named python, with its bytes, and says nothing about it', { timeout: MULTI_RUN_TIMEOUT_MS }, async () => {
    const mine = path.join(skillsFolder(), 'python');
    await fs.mkdir(path.join(mine, 'references'), { recursive: true });
    await fs.writeFile(path.join(mine, 'SKILL.md'), '---\nname: python\n---\nmy own python skill\n', 'utf-8');
    await fs.writeFile(path.join(mine, 'references', 'notes.md'), 'my notes\n', 'utf-8');

    const first = runInit();
    const second = runInit();

    for (const out of [first, second]) {
      expect(out, 'a skill of the user is not named').not.toContain(mine);
    }
    expect(await fs.readFile(path.join(mine, 'SKILL.md'), 'utf-8')).toBe('---\nname: python\n---\nmy own python skill\n');
    expect(await fs.readFile(path.join(mine, 'references', 'notes.md'), 'utf-8')).toBe('my notes\n');
    expect(await exists(backupRoot()), 'nothing moved, so no backup folder').toBe(false);
  });

  it('moves a python folder that a release made whole, with its bytes, and names it', { timeout: MULTI_RUN_TIMEOUT_MS }, async () => {
    const released = await plantReleasedPython();
    await fs.writeFile(path.join(released, 'mine.md'), 'my note in the folder\n', 'utf-8');

    const out = runInit();

    expect(await exists(released), 'the folder left skills/').toBe(false);
    const runs = await fs.readdir(backupRoot());
    expect(runs).toHaveLength(1);
    const kept = path.join(backupRoot(), runs[0], 'skills', 'python');
    expect(await fs.readFile(path.join(kept, 'SKILL.md'))).toEqual(await fs.readFile(RELEASED_PYTHON));
    expect(await fs.readFile(path.join(kept, 'mine.md'), 'utf-8')).toBe('my note in the folder\n');
    expect(out).toContain(`${released}/ -> ${kept}/`);
    expect(out).not.toContain('could not tell if it made this folder');
  });

  it('keeps a folder with no SKILL.md, with its bytes, and names it on every init', { timeout: MULTI_RUN_TIMEOUT_MS }, async () => {
    const unjudged = path.join(skillsFolder(), 'java');
    await fs.mkdir(unjudged, { recursive: true });
    await fs.writeFile(path.join(unjudged, 'notes.md'), 'no skill file here\n', 'utf-8');

    for (const run of ['first', 'second']) {
      const out = runInit();
      expect(out, `the ${run} init names the folder`).toContain(`Kept ${unjudged}: devflow could not tell if it made this folder`);
      expect(await fs.readFile(path.join(unjudged, 'notes.md'), 'utf-8')).toBe('no skill file here\n');
      expect(await exists(backupRoot()), `the ${run} init moved nothing`).toBe(false);
    }
  });
});
