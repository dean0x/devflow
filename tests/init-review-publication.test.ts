/**
 * End-to-end guard for reviewPublication's survival across `devflow init`.
 *
 * PF-015: a feature value that fans out across artifacts is only correct when
 * every write converges on the POST-GATE binding. reviewPublication has no
 * prompt, so init carries it over — and the carry-over must read the
 * reset-gated snapshot, not the file on disk, or `--reset` silently preserves a
 * publication setting the user asked to discard.
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

const CLI = path.resolve(import.meta.dirname, '../dist/cli.js');

let tmpHome: string;
let tmpRepo: string;

function runInit(...args: string[]): { status: number | null; stderr: string } {
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

async function readProjectConfig(): Promise<Record<string, unknown>> {
  const raw = await fs.readFile(path.join(tmpRepo, '.devflow', 'config.json'), 'utf-8');
  return JSON.parse(raw) as Record<string, unknown>;
}

describe('devflow init — reviewPublication carry-over', () => {
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
