/**
 * End-to-end: `devflow init` and the machine gate level (#543).
 *
 * `devflow init --gate-level <level>` sets `features.gateLevel` in
 * ~/.devflow/manifest.json, the field `devflow gates --set` writes. Without the
 * flag, a non-interactive init (`--recommended`, or no TTY) shows no prompt and
 * keeps the stored value. The interactive prompt itself is covered by
 * gate-level-prompts.test.ts, which drives both wizard paths with fake prompts; a
 * spawned child here has no TTY.
 *
 * A manifest that readManifest refuses (a missing required field, a byte-order mark, or text
 * that is not JSON) must never cost the machine level a user chose: init keeps a level it can
 * still read, and says so when it cannot read one.
 *
 * These drive the REAL compiled CLI. Every spawn gets its env from the shared
 * `sandboxEnv(tmpHome)` — an allowlist with HOME pinned to a temp dir — and the
 * helper asserts that HOME is not a real home before a run can start. Requires a
 * build (`npm run build`).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync, execFileSync } from 'child_process';
import { promises as fs, existsSync } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { requireBuiltCli, sandboxEnv } from './helpers.js';

const CLI = requireBuiltCli();

/** One CLI spawn under load runs well past vitest's 5 s default. */
const SUBPROCESS_TIMEOUT_MS = 60_000;
/** Tests that chain several init runs get a budget of several spawns. */
const MULTI_RUN_TIMEOUT_MS = 4 * SUBPROCESS_TIMEOUT_MS;

let tmpHome: string;
let repo: string;

const devflowDir = (): string => path.join(tmpHome, '.devflow');
const claudeDir = (): string => path.join(tmpHome, '.claude');
const manifestPath = (): string => path.join(devflowDir(), 'manifest.json');

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

function runInit(cwd: string, ...args: string[]): string {
  const { status, out } = runCli(cwd, 'init', ...args);
  expect(status, `init ${args.join(' ')} failed:\n${out}`).toBe(0);
  return out;
}

async function readFeatures(): Promise<Record<string, unknown>> {
  return (JSON.parse(await fs.readFile(manifestPath(), 'utf-8')) as { features: Record<string, unknown> }).features;
}

/** Rewrite the manifest init wrote, as a hand edit, an older devflow or a broken disk would leave it. */
async function writeManifestText(text: string): Promise<void> {
  await fs.writeFile(manifestPath(), text, 'utf-8');
}

/** The manifest init wrote, parsed, with `mutate` applied, as text with two-space indent. */
async function editedManifestText(mutate: (raw: Record<string, unknown>) => void): Promise<string> {
  const raw = JSON.parse(await fs.readFile(manifestPath(), 'utf-8')) as Record<string, unknown>;
  mutate(raw);
  return JSON.stringify(raw, null, 2) + '\n';
}

beforeEach(async () => {
  tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'df-gate-home-'));
  repo = await fs.mkdtemp(path.join(os.tmpdir(), 'df-gate-repo-'));
  // init bails with "Claude Code not detected" without a ~/.claude dir
  await fs.mkdir(claudeDir(), { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: repo });
});

afterEach(async () => {
  for (const dir of [tmpHome, repo]) {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

describe('init --help', () => {
  it('describes the --gate-level flag and the three levels', () => {
    const { status, out } = runCli(repo, 'init', '--help');
    expect(status).toBe(0);
    // commander wraps a long description, so compare the flattened text.
    const flat = out.replace(/\s+/g, ' ');
    const at = flat.indexOf('--gate-level <level>');
    expect(at, 'init --help does not list --gate-level').toBeGreaterThanOrEqual(0);
    const description = flat.slice(at, flat.indexOf(' --', at + 1));
    for (const level of ['full', 'standard', 'lean']) expect(description).toContain(level);
    expect(description).toContain('prompt');
  });
});

describe('init --gate-level <level>', () => {
  it('sets the machine level with no prompt, and the summary shows it', async () => {
    const out = runInit(repo, '--recommended', '--gate-level', 'lean');
    expect(await readFeatures()).toMatchObject({ gateLevel: 'lean' });
    expect(out).toMatch(/Gate level: lean\b/);
    // `devflow gates` reads the same field.
    const status = runCli(repo, 'gates', '--status');
    expect(status.status).toBe(0);
    expect(status.out).toContain('Machine:   lean');
  }, MULTI_RUN_TIMEOUT_MS);

  it('sets the level on a non-interactive run with no mode flag', async () => {
    runInit(repo, '--gate-level', 'full');
    expect(await readFeatures()).toMatchObject({ gateLevel: 'full' });
  }, MULTI_RUN_TIMEOUT_MS);

  it('replaces a level that devflow gates --set wrote', async () => {
    runInit(repo, '--recommended');
    expect(runCli(repo, 'gates', '--set', 'lean').status).toBe(0);
    runInit(repo, '--recommended', '--gate-level', 'full');
    expect(await readFeatures()).toMatchObject({ gateLevel: 'full' });
  }, MULTI_RUN_TIMEOUT_MS);

  it('exits 1 on an invalid level, names the valid ones, and writes nothing', async () => {
    for (const bad of ['Lean', 'strict', '']) {
      const { status, out } = runCli(repo, 'init', '--recommended', '--gate-level', bad);
      expect(status, `expected --gate-level ${JSON.stringify(bad)} to exit 1:\n${out}`).toBe(1);
      expect(out).toContain('Valid levels: full, standard, lean');
    }
    expect(existsSync(devflowDir()), 'a rejected run created ~/.devflow').toBe(false);
    expect(existsSync(path.join(claudeDir(), 'settings.json')), 'a rejected run wrote settings.json').toBe(false);
  }, MULTI_RUN_TIMEOUT_MS);

  it('leaves an existing install byte-for-byte unchanged on an invalid level', async () => {
    runInit(repo, '--recommended', '--gate-level', 'lean');
    const before = await fs.readFile(manifestPath(), 'utf-8');
    const { status } = runCli(repo, 'init', '--recommended', '--gate-level', 'Lean');
    expect(status).toBe(1);
    expect(await fs.readFile(manifestPath(), 'utf-8')).toBe(before);
  }, MULTI_RUN_TIMEOUT_MS);

  it('is refused with --hud-only, which writes no level, before anything is written', async () => {
    const { status, out } = runCli(repo, 'init', '--hud-only', '--gate-level', 'lean');
    expect(status).toBe(1);
    expect(out).toContain('--hud-only');
    expect(existsSync(devflowDir())).toBe(false);
  }, MULTI_RUN_TIMEOUT_MS);

  it('--reset then --gate-level sets the new level', async () => {
    runInit(repo, '--recommended', '--gate-level', 'full');
    runInit(repo, '--reset', '--recommended', '--gate-level', 'lean');
    expect(await readFeatures()).toMatchObject({ gateLevel: 'lean' });
  }, MULTI_RUN_TIMEOUT_MS);
});

describe('init without --gate-level, with no prompt', () => {
  it('a first install records no level and the summary names the default', async () => {
    const out = runInit(repo, '--recommended');
    expect(Object.hasOwn(await readFeatures(), 'gateLevel')).toBe(false);
    expect(out).toContain('Gate level: standard (default)');
  }, MULTI_RUN_TIMEOUT_MS);

  it('--recommended and a non-TTY init both keep a stored level', async () => {
    runInit(repo, '--recommended', '--gate-level', 'lean');
    runInit(repo, '--recommended');
    expect(await readFeatures()).toMatchObject({ gateLevel: 'lean' });
    // No mode flag: the spawned child has no TTY, so this is the non-interactive fallback.
    const out = runInit(repo);
    expect(await readFeatures()).toMatchObject({ gateLevel: 'lean' });
    expect(out).toMatch(/Gate level: lean\b/);
  }, MULTI_RUN_TIMEOUT_MS);

  it('keeps a malformed stored level as written, and the summary says how it reads', async () => {
    runInit(repo, '--recommended');
    const raw = JSON.parse(await fs.readFile(manifestPath(), 'utf-8')) as { features: Record<string, unknown> };
    raw.features.gateLevel = 'ZZ-raw-canary';
    await fs.writeFile(manifestPath(), JSON.stringify(raw, null, 2) + '\n', 'utf-8');

    const out = runInit(repo, '--recommended');

    expect(await readFeatures()).toMatchObject({ gateLevel: 'ZZ-raw-canary' });
    expect(out).toContain('Gate level: full');
    expect(out).not.toContain('ZZ-raw-canary');
  }, MULTI_RUN_TIMEOUT_MS);

  it('--reset removes the level', async () => {
    runInit(repo, '--recommended', '--gate-level', 'lean');
    runInit(repo, '--reset', '--recommended');
    expect(Object.hasOwn(await readFeatures(), 'gateLevel')).toBe(false);
  }, MULTI_RUN_TIMEOUT_MS);
});

describe('init over a manifest readManifest refuses', () => {
  const KEPT_WARNING = /kept the stored gate level/;

  it('a manifest missing a required field keeps its stored level on a promptless re-init, and warns', async () => {
    runInit(repo, '--recommended', '--gate-level', 'full');
    await writeManifestText(await editedManifestText(raw => { delete raw.installedAt; }));

    const out = runInit(repo, '--recommended');

    expect(await readFeatures()).toMatchObject({ gateLevel: 'full' });
    expect(out).toMatch(/Gate level: full\b/);
    expect(out).not.toContain('standard (default)');
    expect(out.replace(/\s+/g, ' ')).toMatch(KEPT_WARNING);
    // `devflow gates` reads the same level from the file init wrote.
    expect(runCli(repo, 'gates', '--status').out).toContain('Machine:   full');
  }, MULTI_RUN_TIMEOUT_MS);

  it('a manifest with a leading byte-order mark keeps its stored level on a promptless re-init, and warns', async () => {
    runInit(repo, '--recommended', '--gate-level', 'full');
    await writeManifestText('\ufeff' + await editedManifestText(() => undefined));

    const out = runInit(repo, '--recommended');

    expect(await readFeatures()).toMatchObject({ gateLevel: 'full' });
    expect(out).toMatch(/Gate level: full\b/);
    expect(out.replace(/\s+/g, ' ')).toMatch(KEPT_WARNING);
  }, MULTI_RUN_TIMEOUT_MS);

  it('--reset still removes a level stored in a refused manifest, and does not claim to keep it', async () => {
    runInit(repo, '--recommended', '--gate-level', 'full');
    await writeManifestText(await editedManifestText(raw => { delete raw.installedAt; }));

    const out = runInit(repo, '--reset', '--recommended');

    expect(Object.hasOwn(await readFeatures(), 'gateLevel')).toBe(false);
    expect(out.replace(/\s+/g, ' ')).not.toMatch(KEPT_WARNING);
  }, MULTI_RUN_TIMEOUT_MS);

  it('--gate-level sets the level over a manifest that is not JSON', async () => {
    runInit(repo, '--recommended');
    await writeManifestText('{not json');

    const out = runInit(repo, '--recommended', '--gate-level', 'lean');

    expect(await readFeatures()).toMatchObject({ gateLevel: 'lean' });
    expect(out).toMatch(/Gate level: lean\b/);
    expect(out).not.toContain('could not be read');
  }, MULTI_RUN_TIMEOUT_MS);

  it('a promptless re-init over a manifest that is not JSON writes no level, and says how to set it again', async () => {
    runInit(repo, '--recommended', '--gate-level', 'full');
    await writeManifestText('{not json');

    const out = runInit(repo, '--recommended');

    expect(Object.hasOwn(await readFeatures(), 'gateLevel')).toBe(false);
    expect(out).not.toContain('standard (default)');
    const flat = out.replace(/\s+/g, ' ');
    expect(flat).toContain('stored gate level could not be read');
    expect(flat).toContain('standard');
    expect(flat).toContain('devflow gates --set <level>');
    // The hint works: the manifest init wrote takes the level.
    expect(runCli(repo, 'gates', '--set', 'lean').status).toBe(0);
    expect(await readFeatures()).toMatchObject({ gateLevel: 'lean' });
  }, MULTI_RUN_TIMEOUT_MS);
});

describe('the Recommended settings note names the gate level', () => {
  const ROW = (text: string): RegExp => new RegExp(`Gate level: {6}${text}`);

  it('shows the default on a first install', () => {
    expect(runInit(repo, '--recommended')).toMatch(ROW('standard \\(default\\)'));
  }, MULTI_RUN_TIMEOUT_MS);

  it('shows the level --gate-level sets', () => {
    expect(runInit(repo, '--recommended', '--gate-level', 'lean')).toMatch(ROW('lean\\b'));
  }, MULTI_RUN_TIMEOUT_MS);

  it('shows the stored level a promptless re-init keeps', () => {
    runInit(repo, '--recommended', '--gate-level', 'full');
    expect(runInit(repo, '--recommended')).toMatch(ROW('full\\b'));
  }, MULTI_RUN_TIMEOUT_MS);

  it('shows an unreadable stored level as unknown, never as the default', async () => {
    runInit(repo, '--recommended', '--gate-level', 'full');
    await writeManifestText('{not json');

    const out = runInit(repo, '--recommended');

    expect(out).toMatch(ROW('unknown'));
    expect(out).not.toMatch(ROW('standard'));
  }, MULTI_RUN_TIMEOUT_MS);
});

describe('a personal gateLevel still wins over the machine level init sets', () => {
  it('keeps the personal key and reports it as the level in effect', async () => {
    await fs.mkdir(path.join(repo, '.devflow'), { recursive: true });
    const personal = path.join(repo, '.devflow', 'config.json');
    await fs.writeFile(personal, '{"gateLevel":"full"}\n', 'utf-8');

    runInit(repo, '--recommended', '--gate-level', 'lean');

    // init writes the machine level only; the personal file keeps its key.
    expect(await readFeatures()).toMatchObject({ gateLevel: 'lean' });
    const config = JSON.parse(await fs.readFile(personal, 'utf-8')) as Record<string, unknown>;
    expect(config.gateLevel).toBe('full');
    // The resolver still lets the personal key decide.
    const status = runCli(repo, 'gates', '--status');
    expect(status.status).toBe(0);
    expect(status.out).toContain('Effective: full (personal)');
    expect(status.out).toContain('Machine:   lean');
  }, MULTI_RUN_TIMEOUT_MS);

  it('init does not write a gateLevel into a repository config that has none', async () => {
    runInit(repo, '--recommended', '--gate-level', 'lean');
    const personal = path.join(repo, '.devflow', 'config.json');
    if (existsSync(personal)) {
      const config = JSON.parse(await fs.readFile(personal, 'utf-8')) as Record<string, unknown>;
      expect(Object.hasOwn(config, 'gateLevel')).toBe(false);
    }
  }, MULTI_RUN_TIMEOUT_MS);
});
