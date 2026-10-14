/**
 * End-to-end: every command that writes ~/.devflow/manifest.json keeps the stored
 * machine gate level (`features.gateLevel`) exactly as it was.
 *
 * The level lives under `features`, and several writers rebuild that record from
 * what their reader models. A writer that dropped the key would lower a stored
 * `full` to the default with no message; a writer that healed a typo would do the
 * same. So each row spawns the REAL compiled CLI over a manifest holding a stored
 * value and compares the raw bytes of the key afterwards. Three stored values
 * cover the cases that differ: a valid level, a capitalised one the fold reads as
 * `full`, and a JSON `null`. `init --reset` is the one writer that removes the key.
 *
 * Every spawn gets its env from `sandboxEnv(tmpHome)`, so HOME is a temp dir and
 * no real install is touched. Requires a build (`npm run build`).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync, execFileSync } from 'child_process';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { requireBuiltCli, sandboxEnv } from './helpers.js';

const CLI = requireBuiltCli();

/** One CLI spawn under load runs well past vitest's 5 s default. */
const SUBPROCESS_TIMEOUT_MS = 60_000;
/** A test that chains a dozen spawns gets a budget of a dozen. */
const WRITER_TABLE_TIMEOUT_MS = 12 * SUBPROCESS_TIMEOUT_MS;

let tmpHome: string;
let repo: string;

const devflowDir = (): string => path.join(tmpHome, '.devflow');
const manifestPath = (): string => path.join(devflowDir(), 'manifest.json');

function runCli(...args: string[]): { status: number | null; out: string } {
  const result = spawnSync('node', [CLI, ...args], {
    encoding: 'utf-8',
    timeout: SUBPROCESS_TIMEOUT_MS,
    cwd: repo,
    env: sandboxEnv(tmpHome),
  });
  if (result.error) throw result.error;
  return { status: result.status, out: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

interface RawManifest {
  updatedAt: string;
  features: Record<string, unknown>;
}

async function readRaw(): Promise<RawManifest> {
  return JSON.parse(await fs.readFile(manifestPath(), 'utf-8')) as RawManifest;
}

/** Store `value` under `features.gateLevel`, byte-for-byte, or remove the key. */
async function storeGateLevel(value: unknown): Promise<void> {
  const manifest = await readRaw();
  await fs.writeFile(
    manifestPath(),
    JSON.stringify({ ...manifest, features: { ...manifest.features, gateLevel: value } }, null, 2) + '\n',
    'utf-8',
  );
}

/** The stored values to carry. `lean` is valid; `Lean` and `null` the fold reads as `full`. */
const STORED: ReadonlyArray<{ label: string; value: unknown }> = [
  { label: 'a valid level', value: 'lean' },
  { label: 'a capitalised level the fold reads as full', value: 'Lean' },
  { label: 'a JSON null', value: null },
];

/** Each writer, in an order where no step undoes the next one's precondition. */
const WRITERS: ReadonlyArray<{ name: string; args: readonly string[] }> = [
  { name: 'plain init', args: ['init', '--recommended'] },
  { name: 'init --hud-only', args: ['init', '--hud-only'] },
  { name: 'tracker --set', args: ['tracker', '--set', 'jira'] },
  { name: 'hud --enable', args: ['hud', '--enable'] },
  { name: 'memory --disable', args: ['memory', '--disable'] },
  { name: 'ambient --disable', args: ['ambient', '--disable'] },
  { name: 'compliance --enable', args: ['compliance', '--enable'] },
  { name: 'flags --enable', args: ['flags', '--enable', 'lsp'] },
  { name: 'rules --disable', args: ['rules', '--disable'] },
  { name: 'security --enable --user', args: ['security', '--enable', '--user'] },
];

beforeEach(async () => {
  tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'df-gate-writers-home-'));
  repo = await fs.mkdtemp(path.join(os.tmpdir(), 'df-gate-writers-repo-'));
  // init bails with "Claude Code not detected" without a ~/.claude dir
  await fs.mkdir(path.join(tmpHome, '.claude'), { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: repo });
});

afterEach(async () => {
  for (const dir of [tmpHome, repo]) {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

describe.each(STORED)('a stored gate level of $label', ({ value }) => {
  it('survives every manifest writer, byte for byte, and init --reset removes it', async () => {
    const setup = runCli('init', '--recommended');
    expect(setup.status, `setup init failed:\n${setup.out}`).toBe(0);
    await storeGateLevel(value);

    for (const writer of WRITERS) {
      const before = await readRaw();
      const run = runCli(...writer.args);
      expect(run.status, `${writer.name} failed:\n${run.out}`).toBe(0);

      const after = await readRaw();
      // Non-vacuity: this writer really rewrote the manifest.
      expect(after.updatedAt, `${writer.name} did not rewrite the manifest`).not.toBe(before.updatedAt);
      expect(Object.hasOwn(after.features, 'gateLevel'), `${writer.name} dropped the key`).toBe(true);
      expect(after.features.gateLevel, `${writer.name} changed the stored value`).toStrictEqual(value);
    }

    const reset = runCli('init', '--reset', '--recommended');
    expect(reset.status, `init --reset failed:\n${reset.out}`).toBe(0);
    const afterReset = await readRaw();
    expect(Object.hasOwn(afterReset.features, 'gateLevel'), 'init --reset kept the key').toBe(false);
  }, WRITER_TABLE_TIMEOUT_MS);
});

describe('a manifest with no stored gate level', () => {
  it('stays without the key after every writer', async () => {
    const setup = runCli('init', '--recommended');
    expect(setup.status, `setup init failed:\n${setup.out}`).toBe(0);
    expect(Object.hasOwn((await readRaw()).features, 'gateLevel')).toBe(false);

    for (const writer of WRITERS) {
      const run = runCli(...writer.args);
      expect(run.status, `${writer.name} failed:\n${run.out}`).toBe(0);
      expect(
        Object.hasOwn((await readRaw()).features, 'gateLevel'),
        `${writer.name} wrote a key that was absent`,
      ).toBe(false);
    }
  }, WRITER_TABLE_TIMEOUT_MS);
});
