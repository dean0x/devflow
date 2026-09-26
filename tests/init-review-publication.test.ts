/**
 * End-to-end guards for the per-repo `.devflow/config.json` across `devflow init`.
 *
 * PF-015: a feature value that fans out across artifacts is only correct when
 * every write converges on the POST-GATE binding. reviewPublication has no
 * prompt, so init carries it over — and the carry-over must read the
 * reset-gated snapshot, not the file on disk, or `--reset` silently preserves a
 * publication setting the user asked to discard.
 *
 * PF-071: the same write is a read-modify-write over a user-editable file, so
 * the keys devflow does NOT manage — the hand-written per-repo `tracker`
 * override first among them — must come from the file, never from the declared
 * shape, or a re-init silently deletes them.
 *
 * These tests drive the real CLI end to end (PF-015 again: a test that
 * re-implements init's ordering certifies the author's model, not the shipped
 * one). cwd is a throwaway git repo so the suite never writes the developer's
 * own .devflow/config.json.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync, execFileSync } from 'child_process';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { requireBuiltCli } from './helpers.js';

const CLI = requireBuiltCli();

let tmpHome: string;
let tmpRepo: string;

function runInit(...args: string[]): { status: number | null; stderr: string } {
  // PF-060: init converges a machine-wide tree, so the sandbox is asserted at the
  // call site rather than trusted — a spawn against the real HOME never starts.
  expect(path.resolve(tmpHome), 'init must never run against the real HOME').not.toBe(
    path.resolve(os.homedir()),
  );
  const result = spawnSync('node', [CLI, 'init', ...args], {
    encoding: 'utf-8',
    timeout: 60_000,
    cwd: tmpRepo,
    env: {
      ...process.env,
      HOME: tmpHome,
      DEVFLOW_DIR: path.join(tmpHome, '.devflow'),
      FORCE_COLOR: '0',
      NO_COLOR: '1',
      CI: '1',
    },
  });
  return { status: result.status, stderr: result.stderr ?? '' };
}

async function writeProjectConfig(reviewPublication: string): Promise<void> {
  const devflowDir = path.join(tmpRepo, '.devflow');
  await fs.mkdir(devflowDir, { recursive: true });
  await fs.writeFile(
    path.join(devflowDir, 'config.json'),
    JSON.stringify({ memory: true, learning: true, knowledge: true, reviewPublication }),
    'utf-8',
  );
}

/** Write a whole config body, including keys FeatureConfig does not declare. */
async function writeRawProjectConfig(body: Record<string, unknown>): Promise<void> {
  const devflowDir = path.join(tmpRepo, '.devflow');
  await fs.mkdir(devflowDir, { recursive: true });
  await fs.writeFile(path.join(devflowDir, 'config.json'), JSON.stringify(body), 'utf-8');
}

async function readProjectConfig(): Promise<Record<string, unknown>> {
  const raw = await fs.readFile(path.join(tmpRepo, '.devflow', 'config.json'), 'utf-8');
  return JSON.parse(raw) as Record<string, unknown>;
}

beforeEach(async () => {
  tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'df-revpub-home-'));
  tmpRepo = await fs.mkdtemp(path.join(os.tmpdir(), 'df-revpub-repo-'));
  // init bails with "Claude Code not detected" without a ~/.claude dir
  await fs.mkdir(path.join(tmpHome, '.claude'), { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: tmpRepo });
});

afterEach(async () => {
  await fs.rm(tmpHome, { recursive: true, force: true });
  await fs.rm(tmpRepo, { recursive: true, force: true });
});

describe('devflow init — reviewPublication carry-over', () => {
  it('re-init preserves a non-default reviewPublication ("off")', async () => {
    await writeProjectConfig('off');

    const result = runInit('--recommended');
    expect(result.status, `init failed:\n${result.stderr}`).toBe(0);

    const config = await readProjectConfig();
    expect(
      config.reviewPublication,
      're-init erased reviewPublication — the field has no prompt, so init must carry it over',
    ).toBe('off');
  });

  it('init --reset collapses reviewPublication back to "auto"', async () => {
    await writeProjectConfig('full');
    // Non-vacuous: the pre-state is the value a reset must discard.
    expect((await readProjectConfig()).reviewPublication).toBe('full');

    const result = runInit('--reset');
    expect(result.status, `init --reset failed:\n${result.stderr}`).toBe(0);

    const config = await readProjectConfig();
    expect(
      config.reviewPublication,
      'init --reset preserved reviewPublication — a factory reset must not carry a publication override forward (PF-015)',
    ).toBe('auto');
  });

  it('a fresh repo with no prior config gets the fail-closed default', async () => {
    const result = runInit('--recommended');
    expect(result.status, `init failed:\n${result.stderr}`).toBe(0);

    const config = await readProjectConfig();
    expect(config.reviewPublication, 'fresh install must default to "auto"').toBe('auto');
  });
});

describe('devflow init — keys devflow does not manage survive the config write', () => {
  /** The managed keys, at non-default values so a re-init that reseeds them is visible. */
  const MANAGED = { memory: true, learning: true, knowledge: true, reviewPublication: 'off' };
  const TEAM_NOTE = { owner: 'platform', tags: ['a', 'b'] };

  it('★ re-init keeps the per-repo tracker override and a key devflow does not know', async () => {
    await writeRawProjectConfig({ ...MANAGED, tracker: 'jira', teamNote: TEAM_NOTE });

    const result = runInit('--recommended');
    expect(result.status, `init failed:\n${result.stderr}`).toBe(0);

    const config = await readProjectConfig();
    expect(
      config.tracker,
      're-init erased the per-repo tracker override — the repo silently falls back to the manifest provider',
    ).toBe('jira');
    expect(config.teamNote, 're-init erased a key devflow does not manage').toEqual(TEAM_NOTE);
    // Non-vacuous: the managed keys still converge on init's binding.
    expect(config.reviewPublication).toBe('off');
  });

  it('re-init keeps an INVALID tracker value verbatim — refuse, never repair (PF-071)', async () => {
    await writeRawProjectConfig({ ...MANAGED, tracker: 42 });

    const result = runInit('--recommended');
    expect(result.status, `init failed:\n${result.stderr}`).toBe(0);

    const config = await readProjectConfig();
    expect(
      config.tracker,
      're-init erased an invalid tracker value, and with it the DEGRADED that names the typo',
    ).toBe(42);
  });

  it('init --reset resets the managed keys but keeps the keys devflow does not manage', async () => {
    await writeRawProjectConfig({
      memory: true, learning: true, knowledge: true, reviewPublication: 'full',
      tracker: 'linear', teamNote: TEAM_NOTE,
    });

    const result = runInit('--reset');
    expect(result.status, `init --reset failed:\n${result.stderr}`).toBe(0);

    const config = await readProjectConfig();
    // Non-vacuous: the reset really ran over the managed keys.
    expect(config.reviewPublication).toBe('auto');
    expect(config.tracker, 'a factory reset of devflow state deleted a hand-written override').toBe('linear');
    expect(config.teamNote).toEqual(TEAM_NOTE);
  });
});
