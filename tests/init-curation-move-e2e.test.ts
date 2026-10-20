/**
 * End-to-end: `devflow init` moves the learning data to the curation names (#529).
 *
 * These drive the REAL compiled CLI with a temp HOME and a temp git repository, so the
 * assertions are about what a user's machine ends up holding: the project's ledger
 * folder under its new name, the global tuning file under its new name, the manifest's
 * two machine keys, the old flags rejected, and a second init that changes nothing.
 *
 * Every spawn gets its env from `sandboxEnv(tmpHome)`, which pins HOME to a temp dir.
 * Requires a build (`npm run build`).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync, execFileSync } from 'child_process';
import { promises as fs, readdirSync } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { requireBuiltCli, sandboxEnv } from './helpers.js';

const CLI = requireBuiltCli();
const SUBPROCESS_TIMEOUT_MS = 60_000;
const MULTI_RUN_TIMEOUT_MS = 4 * SUBPROCESS_TIMEOUT_MS;

const LEDGER_FILE = 'decisions-ledger.jsonl';
const LEDGER = [
  JSON.stringify({
    id: 'obs_a1', type: 'decision', pattern: 'Use a ledger', details: 'one row', anchor_id: 'ADR-001',
    decisions_status: 'Accepted', status: 'created', confidence: 0.9, observations: 1,
  }),
  JSON.stringify({
    id: 'obs_b2', type: 'pitfall', pattern: 'Do not drop rows', details: 'another row', anchor_id: 'PF-001',
    decisions_status: 'Accepted', status: 'created', confidence: 0.9, observations: 1,
  }),
].join('\n') + '\n';
const TUNING = '{"throttle":3}\n';
const QUEUE = ['.pending-turns.jsonl', '.pending-turns.processing', '.pending-turns.owner'] as const;

let base: string;
let tmpHome: string;
let repo: string;

const devflowDir = (): string => path.join(tmpHome, '.devflow');
const oldDir = (root = repo): string => path.join(root, '.devflow', 'learning');
const newDir = (root = repo): string => path.join(root, '.devflow', 'curation');

function runCli(cwd: string, ...args: string[]): { status: number | null; out: string } {
  const result = spawnSync('node', [CLI, ...args], {
    encoding: 'utf-8',
    timeout: SUBPROCESS_TIMEOUT_MS,
    cwd,
    env: sandboxEnv(tmpHome),
  });
  if (result.error) throw result.error;
  return { status: result.status, out: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

const INIT_BASE = ['init', '--recommended', '--no-ambient', '--no-memory', '--no-knowledge', '--no-rules'];

function runInit(cwd: string, ...extra: string[]): string {
  const { status, out } = runCli(cwd, ...INIT_BASE, ...extra);
  expect(status, `init ${extra.join(' ')} failed:\n${out}`).toBe(0);
  return out;
}

async function readManifest(): Promise<{ features: Record<string, unknown> }> {
  return JSON.parse(await fs.readFile(path.join(devflowDir(), 'manifest.json'), 'utf-8')) as { features: Record<string, unknown> };
}

async function exists(target: string): Promise<boolean> {
  return fs.lstat(target).then(() => true, () => false);
}

async function seedOldFolder(root = repo, withClaim = false): Promise<void> {
  await fs.mkdir(oldDir(root), { recursive: true });
  await fs.writeFile(path.join(oldDir(root), LEDGER_FILE), LEDGER, 'utf-8');
  await fs.writeFile(path.join(oldDir(root), 'learning.json'), TUNING, 'utf-8');
  await fs.writeFile(path.join(oldDir(root), '.pending-turns.jsonl'), '{"role":"user","content":"x","ts":1}\n', 'utf-8');
  if (withClaim) {
    await fs.writeFile(path.join(oldDir(root), '.pending-turns.processing'), '{"role":"user","content":"claimed","ts":1}\n', 'utf-8');
    await fs.writeFile(path.join(oldDir(root), '.pending-turns.owner'), 'token\n', 'utf-8');
  }
}

beforeEach(async () => {
  base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'df-curation-move-')));
  tmpHome = path.join(base, 'home');
  repo = path.join(base, 'project');
  await fs.mkdir(path.join(tmpHome, '.claude'), { recursive: true });
  await fs.mkdir(repo);
  execFileSync('git', ['init', '-q'], { cwd: repo });
});

afterEach(async () => {
  await fs.rm(base, { recursive: true, force: true });
});

describe('init moves the project ledger folder (TP-7, TP-8, TP-14)', () => {
  it('moves the ledger, the tuning file and the queue byte for byte, and prints one notice', { timeout: MULTI_RUN_TIMEOUT_MS }, async () => {
    await seedOldFolder();

    const out = runInit(repo, '--curation');

    expect(await fs.readFile(path.join(newDir(), LEDGER_FILE), 'utf-8')).toBe(LEDGER);
    expect(await fs.readFile(path.join(newDir(), 'curation.json'), 'utf-8')).toBe(TUNING);
    expect(await exists(path.join(newDir(), 'learning.json')), 'the tuning file takes the new name').toBe(false);
    expect(await exists(oldDir()), 'the old folder is gone').toBe(false);
    expect(out.split('Moved the curation data of 1 project').length - 1, 'one notice').toBe(1);
  });

  it('moves the data whatever the curation switch says', { timeout: MULTI_RUN_TIMEOUT_MS }, async () => {
    await seedOldFolder();

    runInit(repo, '--no-curation');

    expect(await fs.readFile(path.join(newDir(), LEDGER_FILE), 'utf-8')).toBe(LEDGER);
    expect(await exists(oldDir())).toBe(false);
  });

  it('a second init changes nothing and prints no notice (steady state, TP-33)', { timeout: MULTI_RUN_TIMEOUT_MS }, async () => {
    await seedOldFolder();
    runInit(repo, '--curation');
    const entries = readdirSync(path.join(repo, '.devflow')).sort();
    const ledger = await fs.readFile(path.join(newDir(), LEDGER_FILE), 'utf-8');

    const out = runInit(repo, '--curation');

    expect(out).not.toContain('Moved the curation data');
    expect(readdirSync(path.join(repo, '.devflow')).sort(), 'no backup or other folder appears').toEqual(entries);
    expect(await fs.readFile(path.join(newDir(), LEDGER_FILE), 'utf-8')).toBe(ledger);
  });

  it('when both folders held a ledger, the old ledger goes live and one backup holds the displaced copy of the new folder\'s ledger', { timeout: MULTI_RUN_TIMEOUT_MS }, async () => {
    const newFolderLedger = LEDGER.split('\n')[0] + '\n';
    await seedOldFolder();
    await fs.mkdir(newDir(), { recursive: true });
    await fs.writeFile(path.join(newDir(), LEDGER_FILE), newFolderLedger, 'utf-8');

    const out = runInit(repo, '--curation');

    expect(out).not.toMatch(/Ledger move (failed|refused)/);
    expect(await exists(oldDir()), 'the old folder is not left under its name').toBe(false);
    expect(await fs.readFile(path.join(newDir(), LEDGER_FILE), 'utf-8'), 'the live ledger is the old two-row ledger').toBe(LEDGER);
    const backups = readdirSync(path.join(repo, '.devflow')).filter(name => name.startsWith('learning.backup-'));
    expect(backups, 'exactly one backup folder').toHaveLength(1);
    const backup = path.join(repo, '.devflow', backups[0]);
    const displaced = readdirSync(backup).filter(name => name.startsWith(`${LEDGER_FILE}.displaced-`));
    expect(displaced, 'one displaced copy of the ledger file').toHaveLength(1);
    expect(await fs.readFile(path.join(backup, displaced[0]), 'utf-8'), 'the copy holds the new folder\'s one-row ledger').toBe(newFolderLedger);
  });

  it('refuses a linked old folder, names the root, exits 0 and touches nothing it points at (TP-27)', { timeout: MULTI_RUN_TIMEOUT_MS }, async () => {
    const elsewhere = path.join(base, 'elsewhere');
    await fs.mkdir(elsewhere);
    await fs.writeFile(path.join(elsewhere, LEDGER_FILE), LEDGER, 'utf-8');
    await fs.mkdir(path.join(repo, '.devflow'), { recursive: true });
    await fs.symlink(elsewhere, oldDir());

    const out = runInit(repo, '--curation');

    expect(out).toContain(`Ledger move refused for ${repo}`);
    expect(await fs.readFile(path.join(elsewhere, LEDGER_FILE), 'utf-8')).toBe(LEDGER);
    expect((await fs.lstat(oldDir())).isSymbolicLink()).toBe(true);
    expect(await exists(newDir())).toBe(false);
  });

  it('writes no repository file at HOME', { timeout: MULTI_RUN_TIMEOUT_MS }, async () => {
    execFileSync('git', ['init', '-q'], { cwd: tmpHome });
    await fs.mkdir(oldDir(tmpHome), { recursive: true });
    await fs.writeFile(path.join(oldDir(tmpHome), LEDGER_FILE), LEDGER, 'utf-8');

    runInit(tmpHome, '--curation');

    expect(await exists(path.join(devflowDir(), 'curation', LEDGER_FILE)), 'HOME is never a ledger root').toBe(false);
    expect(await fs.readFile(path.join(oldDir(tmpHome), LEDGER_FILE), 'utf-8')).toBe(LEDGER);
  });
});

// A name a repository holds can carry a terminal escape sequence (an OSC title change, a
// C1 control, a bell) and a newline. No line init or status prints may carry one.
describe('a name read from the repository prints as one clean line', () => {
  /** ESC ] 0 ; pwn BEL, then the C1 control U+009B, then a newline: a title change, a CSI and a line break. */
  const HOSTILE_PART = 'evil\u001b]0;pwn\u0007\u009b31m\nname';
  /** What the printed line holds in its place: each run of control characters is one space. */
  const PRINTED_PART = 'evil ]0;pwn 31m name';
  /** The hostile bytes. A bare ESC is not one: the spinner of the prompts library prints cursor sequences with it. */
  const RAW_ESCAPES = ['\u001b]', '\u0007', '\u009b'] as const;

  it('init: a refused move names the link with no raw control byte', { timeout: MULTI_RUN_TIMEOUT_MS }, async () => {
    await seedOldFolder();
    await fs.symlink(path.join(base, 'elsewhere.txt'), path.join(oldDir(), `${HOSTILE_PART}.txt`));

    const out = runInit(repo, '--curation');

    expect(out).toContain(`Ledger move refused for ${repo}`);
    expect(out).toContain(`${PRINTED_PART}.txt is a symbolic link`);
    for (const raw of RAW_ESCAPES) expect(out.includes(raw), JSON.stringify(raw)).toBe(false);
    expect(await exists(newDir()), 'a refused move changes nothing').toBe(false);
  });

  it('curation --status: a backup folder named with control characters prints as one clean line', { timeout: MULTI_RUN_TIMEOUT_MS }, async () => {
    runInit(repo, '--curation');
    const backup = path.join(repo, '.devflow', `learning.backup-${HOSTILE_PART}`);
    await fs.mkdir(backup);
    await fs.writeFile(path.join(backup, '.pending-turns.jsonl'), '{"role":"user","content":"x","ts":1}\n{"role":"user","content":"y","ts":2}\n', 'utf-8');

    const { status, out } = runCli(repo, 'curation', '--status');

    expect(status, out).toBe(0);
    expect(out).toContain(`Backup: ${path.join(repo, '.devflow', 'learning.backup-')}${PRINTED_PART}: 2 pending rows in the backup`);
    for (const raw of RAW_ESCAPES) expect(out.includes(raw), JSON.stringify(raw)).toBe(false);
  });
});

describe('init and the drain meet the old folder (TP-8)', () => {
  it('--no-curation drains the queue of an old folder whose move a fresh queue claim defers, and keeps the ledger there', { timeout: MULTI_RUN_TIMEOUT_MS }, async () => {
    await seedOldFolder(repo, true);

    const out = runInit(repo, '--no-curation');

    expect(out, 'the claim defers the move').toContain(`Ledger move skipped for ${repo}: a queue claim holds the move.`);
    expect(await exists(oldDir()), 'the old folder stays').toBe(true);
    expect(await exists(newDir()), 'the new folder is not made').toBe(false);
    expect(await fs.readFile(path.join(oldDir(), LEDGER_FILE), 'utf-8'), 'the ledger is never drained').toBe(LEDGER);
    for (const name of QUEUE) {
      expect(await exists(path.join(oldDir(), name)), `${name} is drained from the old folder`).toBe(false);
    }
  });
});

describe('a disable drains the pending rows of the backups a move left', () => {
  const STAMP = '20261017T020304Z';
  const ROW = '{"role":"user","content":"stale","ts":1}\n';
  const backupDir = (): string => path.join(repo, '.devflow', `learning.backup-${STAMP}-ab12cd34`);
  const PENDING = ['.pending-turns.jsonl', '.pending-turns.processing', `.pending-turns.jsonl.overflow-${STAMP}-00000001`] as const;

  async function seedBackup(): Promise<void> {
    await fs.mkdir(backupDir(), { recursive: true });
    for (const name of PENDING) await fs.writeFile(path.join(backupDir(), name), ROW.repeat(3), 'utf-8');
    await fs.writeFile(path.join(backupDir(), LEDGER_FILE), LEDGER, 'utf-8');
  }

  it('--no-curation removes the queue, claim and overflow rows of a backup, and keeps its ledger', { timeout: MULTI_RUN_TIMEOUT_MS }, async () => {
    await seedOldFolder();
    runInit(repo, '--curation');
    await seedBackup();

    runInit(repo, '--no-curation');

    for (const name of PENDING) expect(await exists(path.join(backupDir(), name)), `${name} is drained`).toBe(false);
    expect(await fs.readFile(path.join(backupDir(), LEDGER_FILE), 'utf-8'), 'the backup ledger stays').toBe(LEDGER);
  });

  it('--disable, then --enable and init: no backup row reaches the live queue, and status counts 0 pending rows', { timeout: MULTI_RUN_TIMEOUT_MS }, async () => {
    await seedOldFolder();
    runInit(repo, '--curation');
    await seedBackup();

    expect(runCli(repo, 'curation', '--disable').status).toBe(0);
    expect(runCli(repo, 'curation', '--enable').status).toBe(0);
    runInit(repo, '--curation');

    const live = path.join(newDir(), '.pending-turns.jsonl');
    expect(await exists(live) ? await fs.readFile(live, 'utf-8') : '', 'no backup row reaches the live queue').toBe('');
    const status = runCli(repo, 'curation', '--status');
    expect(status.status, status.out).toBe(0);
    expect(status.out).toContain(`learning.backup-${STAMP}-ab12cd34: 0 pending rows in the backup`);
  });

  it('a backup queue file that is a link: init with curation off deletes nothing and says so', { timeout: MULTI_RUN_TIMEOUT_MS }, async () => {
    await seedOldFolder();
    runInit(repo, '--curation');
    await seedBackup();
    const outside = path.join(base, 'outside-queue');
    await fs.writeFile(outside, ROW, 'utf-8');
    await fs.rm(path.join(backupDir(), PENDING[0]));
    await fs.symlink(outside, path.join(backupDir(), PENDING[0]));

    const out = runInit(repo, '--no-curation');

    expect(out).toContain(`${path.join(backupDir(), PENDING[0])} is a symbolic link`);
    expect(await fs.readFile(outside, 'utf-8')).toBe(ROW);
    expect(await exists(path.join(backupDir(), PENDING[1])), 'a refused drain deletes nothing').toBe(true);
  });
});

describe('init renames the global tuning file (TP-14)', () => {
  it('renames learning.json to curation.json', { timeout: MULTI_RUN_TIMEOUT_MS }, async () => {
    await fs.mkdir(devflowDir(), { recursive: true });
    await fs.writeFile(path.join(devflowDir(), 'learning.json'), TUNING, 'utf-8');

    runInit(repo, '--curation');

    expect(await fs.readFile(path.join(devflowDir(), 'curation.json'), 'utf-8')).toBe(TUNING);
    expect(await exists(path.join(devflowDir(), 'learning.json'))).toBe(false);
  });

  it('with both names present the new one wins, the old one stays, and one line says so', { timeout: MULTI_RUN_TIMEOUT_MS }, async () => {
    await fs.mkdir(devflowDir(), { recursive: true });
    await fs.writeFile(path.join(devflowDir(), 'learning.json'), '{"throttle":1}\n', 'utf-8');
    await fs.writeFile(path.join(devflowDir(), 'curation.json'), TUNING, 'utf-8');

    const out = runInit(repo, '--curation');

    expect(await fs.readFile(path.join(devflowDir(), 'curation.json'), 'utf-8')).toBe(TUNING);
    expect(await fs.readFile(path.join(devflowDir(), 'learning.json'), 'utf-8')).toBe('{"throttle":1}\n');
    expect(out.split('learning.json was left in place').length - 1).toBe(1);
  });
});

describe('init and the manifest keys (TP-10, TP-11)', () => {
  it('writes both machine keys equal, true after --curation and false after --no-curation', { timeout: MULTI_RUN_TIMEOUT_MS }, async () => {
    runInit(repo, '--curation');
    const on = (await readManifest()).features;
    expect([on.curation, on.learning]).toEqual([true, true]);

    runInit(repo, '--no-curation');
    const off = (await readManifest()).features;
    expect([off.curation, off.learning]).toEqual([false, false]);
  });

  it('a manifest that holds only the old key keeps an opt-out and heals to both keys', { timeout: MULTI_RUN_TIMEOUT_MS }, async () => {
    runInit(repo, '--curation');
    const manifestPath = path.join(devflowDir(), 'manifest.json');
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf-8')) as { features: Record<string, unknown> };
    delete manifest.features.curation;
    manifest.features.learning = false;
    await fs.writeFile(manifestPath, JSON.stringify(manifest), 'utf-8');

    runInit(repo);

    const healed = (await readManifest()).features;
    expect([healed.curation, healed.learning]).toEqual([false, false]);
  });
});

describe('the old init flags are unknown (TP-20)', () => {
  it.each(['--learning', '--no-learning'])('%s fails with the unknown option error', { timeout: MULTI_RUN_TIMEOUT_MS }, (flag) => {
    const { status, out } = runCli(repo, ...INIT_BASE, flag);

    expect(status).not.toBe(0);
    expect(out).toContain(`unknown option '${flag}'`);
  });
});
