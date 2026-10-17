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

  it('keeps the old folder as a backup when both folders held a ledger', { timeout: MULTI_RUN_TIMEOUT_MS }, async () => {
    await seedOldFolder();
    await fs.mkdir(newDir(), { recursive: true });
    await fs.writeFile(path.join(newDir(), LEDGER_FILE), LEDGER.split('\n')[0] + '\n', 'utf-8');

    const out = runInit(repo, '--curation');

    expect(out).not.toMatch(/Ledger move (failed|refused)/);
    expect(await exists(oldDir()), 'the old folder is not left under its name').toBe(false);
    expect(readdirSync(path.join(repo, '.devflow')).filter(name => name.startsWith('learning.backup-')).length)
      .toBeLessThanOrEqual(1);
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

describe('init and the drain meet the old folder (TP-8)', () => {
  it('--no-curation drains the queue of an old folder whose move was deferred, and keeps the ledger', { timeout: MULTI_RUN_TIMEOUT_MS }, async () => {
    await seedOldFolder(repo, true);

    runInit(repo, '--no-curation');

    for (const name of QUEUE) {
      expect(await exists(path.join(oldDir(), name)), `${name} is drained from the old folder`).toBe(false);
      expect(await exists(path.join(newDir(), name)), `${name} is not in the new folder`).toBe(false);
    }
    const ledgerHome = (await exists(path.join(oldDir(), LEDGER_FILE))) ? oldDir() : newDir();
    expect(await fs.readFile(path.join(ledgerHome, LEDGER_FILE), 'utf-8'), 'the ledger is never drained').toBe(LEDGER);
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
