/**
 * End to end: the machine's learning switch decides which prompts and which skill
 * the install carries (D-LEARNING-VARIANT-INSTALL, plan section 3.B).
 *
 * Drives the REAL compiled CLI (`node dist/cli.js`) against isolated temp HOMEs, because
 * the unit tests in learning-variants-install.test.ts call the converge with hand-built
 * trees and therefore cannot see a wiring mistake between the CLI, the installer and the
 * converge. Every claim here is about what a user's ~/.claude holds afterwards.
 *
 * HOME safety (the near-miss in the pitfalls ledger): every spawn gets its env from the
 * shared `sandboxEnv(tmpHome)`, which pins HOME to a temp directory and refuses a real
 * home, and the HOME is seeded with `~/.claude` first, because without it init exits 0
 * at Claude Code detection before reaching the code under test. The first assertion of
 * each scenario is on installed bytes, never on an exit code a short-circuit also returns.
 *
 * Requires a build (`npm run build`): the spawned CLI reads dist/ and dist/learning-off.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHash } from 'crypto';
import { spawnSync } from 'child_process';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';

import { requireBuiltCli, sandboxEnv } from '../helpers.js';
import { assertTempHome } from '../setup/home-isolation.js';

const CLI = requireBuiltCli();
const ROOT = path.resolve(import.meta.dirname, '../..');
const SKILL_SOURCE = path.join(ROOT, 'src', 'assets', 'skills', 'apply-decisions', 'SKILL.md');

/** One CLI spawn under load runs well past vitest's 5 s default. */
const SUBPROCESS_TIMEOUT_MS = 120_000;
/** A scenario that chains several spawns gets a budget of several. */
const SCENARIO_TIMEOUT_MS = 4 * SUBPROCESS_TIMEOUT_MS;

/** Flags that keep every install down to the prompts, skills and manifest this file is about. */
const QUIET = ['--no-ambient', '--no-memory', '--no-knowledge', '--no-rules'] as const;

type Kind = 'commands' | 'agents';
type Variant = 'on' | 'off' | 'other' | 'missing';

let tmpHome: string;

const claudeDir = (): string => path.join(tmpHome, '.claude');
const devflowDir = (): string => path.join(tmpHome, '.devflow');
const installedPrompt = (kind: Kind, file: string): string => path.join(claudeDir(), kind, 'devflow', file);
const skillDir = (): string => path.join(claudeDir(), 'skills', 'devflow:apply-decisions');

interface Run { status: number | null; out: string }

function runCli(cwd: string, ...args: string[]): Run {
  const result = spawnSync('node', [CLI, ...args], {
    encoding: 'utf-8',
    timeout: SUBPROCESS_TIMEOUT_MS,
    cwd,
    env: sandboxEnv(tmpHome),
  });
  if (result.error) throw result.error;
  return { status: result.status, out: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

function okCli(cwd: string, ...args: string[]): string {
  const { status, out } = runCli(cwd, ...args);
  expect(status, `devflow ${args.join(' ')} failed:\n${out}`).toBe(0);
  return out;
}

const init = (...flags: string[]): string => okCli(os.tmpdir(), 'init', ...QUIET, ...flags);

async function exists(p: string): Promise<boolean> {
  try { await fs.access(p); return true; } catch { return false; }
}

async function rosterOf(kind: Kind): Promise<string[]> {
  return (await fs.readdir(path.join(ROOT, 'dist', 'learning-off', kind))).filter(f => f.endsWith('.md')).sort();
}

/** Which variant the installed file is, by comparing its bytes with both build outputs. */
async function variantOf(kind: Kind, file: string): Promise<Variant> {
  let installed: Buffer;
  try { installed = await fs.readFile(installedPrompt(kind, file)); } catch { return 'missing'; }
  const off = await fs.readFile(path.join(ROOT, 'dist', 'learning-off', kind, file));
  const on = await fs.readFile(path.join(ROOT, 'dist', kind, file));
  if (installed.equals(off)) return 'off';
  if (installed.equals(on)) return 'on';
  return 'other';
}

/** Every roster file grouped by the variant it is installed as. */
async function installedVariants(): Promise<Record<Variant, string[]>> {
  const groups: Record<Variant, string[]> = { on: [], off: [], other: [], missing: [] };
  for (const kind of ['commands', 'agents'] as const) {
    for (const file of await rosterOf(kind)) groups[await variantOf(kind, file)].push(`${kind}/${file}`);
  }
  return groups;
}

/** The sorted `kind/file` list of everything installed under commands, agents and skills. */
async function installedTree(): Promise<string[]> {
  const out: string[] = [];
  for (const kind of ['commands', 'agents'] as const) {
    for (const file of await fs.readdir(path.join(claudeDir(), kind, 'devflow')).catch(() => [] as string[])) out.push(`${kind}/${file}`);
  }
  for (const skill of await fs.readdir(path.join(claudeDir(), 'skills')).catch(() => [] as string[])) out.push(`skills/${skill}`);
  return out.sort();
}

/** `kind/file -> sha256` for every installed command and agent. */
async function promptDigest(): Promise<Map<string, string>> {
  const digest = new Map<string, string>();
  for (const kind of ['commands', 'agents'] as const) {
    const dir = path.join(claudeDir(), kind, 'devflow');
    for (const file of await fs.readdir(dir).catch(() => [] as string[])) {
      digest.set(`${kind}/${file}`, createHash('sha256').update(await fs.readFile(path.join(dir, file))).digest('hex'));
    }
  }
  return digest;
}

/** The machine switch as the manifest records it. */
async function manifestLearning(): Promise<boolean | undefined> {
  const manifest = JSON.parse(await fs.readFile(path.join(devflowDir(), 'manifest.json'), 'utf-8')) as {
    features: { learning?: boolean };
  };
  return manifest.features.learning;
}

/** Assert every installed roster file is the given variant, and that enough of them exist to mean it. */
async function expectAll(variant: 'on' | 'off', minimum = 15): Promise<void> {
  const groups = await installedVariants();
  const other = variant === 'on' ? 'off' : 'on';
  expect(groups[other], `files still the learning-${other} variant`).toEqual([]);
  expect(groups.other, 'files that are neither variant').toEqual([]);
  expect(groups[variant].length, `installed learning-${variant} files (non-vacuity)`).toBeGreaterThanOrEqual(minimum);
}

beforeEach(async () => {
  tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-learning-e2e-'));
  expect(() => assertTempHome(tmpHome)).not.toThrow();
  // init refuses a HOME with no ~/.claude: Claude Code's presence check, not under test.
  await fs.mkdir(claudeDir(), { recursive: true });
});

afterEach(async () => {
  await fs.rm(tmpHome, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// init
// ---------------------------------------------------------------------------

describe('init follows the machine switch (AC-139, AC-148)', () => {
  it('init --no-learning installs the learning-off prompts and no apply-decisions skill', async () => {
    init('--recommended', '--no-learning');

    await expectAll('off');
    expect(await exists(skillDir()), 'the skill has no reader on a learning-off machine').toBe(false);
    expect(await manifestLearning()).toBe(false);
  }, SCENARIO_TIMEOUT_MS);

  it('init with learning on installs the learning-on prompts and the skill, byte for byte', async () => {
    init('--recommended');

    await expectAll('on');
    expect(await fs.readFile(path.join(skillDir(), 'SKILL.md'), 'utf-8')).toBe(await fs.readFile(SKILL_SOURCE, 'utf-8'));
    expect(await manifestLearning()).toBe(true);
  }, SCENARIO_TIMEOUT_MS);

  it('a prompt with no learning-off file is installed once, the same on both sides of the switch', async () => {
    init('--recommended', '--no-learning');
    const offInstall = await fs.readFile(installedPrompt('agents', 'evaluate.md'));
    init('--recommended');
    const onInstall = await fs.readFile(installedPrompt('agents', 'evaluate.md'));

    expect(await exists(path.join(ROOT, 'dist', 'learning-off', 'agents', 'evaluate.md'))).toBe(false);
    expect(offInstall.equals(onInstall)).toBe(true);
  }, SCENARIO_TIMEOUT_MS);

  it('init --no-learning over a full learning-on install converges the prompts it did not copy (--plugin)', async () => {
    init('--recommended');
    await expectAll('on');
    expect(await exists(skillDir())).toBe(true);

    // A partial install copies one plugin's files; every other plugin's installed file
    // is the converge's to flip, and the skill the copy skipped is the converge's to remove.
    init('--no-learning', '--plugin=implement');

    await expectAll('off');
    expect(await exists(skillDir())).toBe(false);
    expect(await manifestLearning()).toBe(false);
  }, SCENARIO_TIMEOUT_MS);

  it('a re-init on the same switch moves nothing: every installed prompt and the file list are identical', async () => {
    init('--recommended', '--no-learning');
    const before = await promptDigest();
    expect(before.size, 'non-vacuity: prompts were installed').toBeGreaterThan(20);

    init('--recommended', '--no-learning');

    expect(await promptDigest()).toEqual(before);
    expect(await installedTree()).toEqual([...new Set(await installedTree())]);
  }, SCENARIO_TIMEOUT_MS);
});

// ---------------------------------------------------------------------------
// devflow learning --enable / --disable
// ---------------------------------------------------------------------------

describe('devflow learning --enable/--disable converges the install (AC-140, AC-141)', () => {
  it('--enable brings back the learning-on prompts and the skill, and --disable reverses it', async () => {
    init('--recommended', '--no-learning');
    await expectAll('off');

    const enabled = okCli(os.tmpdir(), 'learning', '--enable');
    await expectAll('on');
    expect(await fs.readFile(path.join(skillDir(), 'SKILL.md'), 'utf-8')).toBe(await fs.readFile(SKILL_SOURCE, 'utf-8'));
    expect(await manifestLearning()).toBe(true);
    expect(enabled).toContain('Installed prompts');

    okCli(os.tmpdir(), 'learning', '--disable');
    await expectAll('off');
    expect(await exists(skillDir())).toBe(false);
    expect(await manifestLearning()).toBe(false);
  }, SCENARIO_TIMEOUT_MS);

  it('a toggle to the value already installed prints nothing about prompts and writes nothing', async () => {
    init('--recommended', '--no-learning');
    const tree = await installedTree();

    const again = okCli(os.tmpdir(), 'learning', '--disable');

    expect(again).not.toContain('Installed prompts');
    expect(await installedTree()).toEqual(tree);
    await expectAll('off');
  }, SCENARIO_TIMEOUT_MS);

  it('an agent model/effort override survives a toggle in both directions (AC-142)', async () => {
    init('--recommended');
    okCli(os.tmpdir(), 'agents', '--set', 'code', '--effort', 'low');
    const frontmatterOf = async (): Promise<string> => (await fs.readFile(installedPrompt('agents', 'code.md'), 'utf-8')).split('\n---\n')[0];
    expect(await frontmatterOf(), 'the override is in the installed file before the toggle').toMatch(/^effort: low$/m);

    okCli(os.tmpdir(), 'learning', '--disable');
    const off = await fs.readFile(installedPrompt('agents', 'code.md'), 'utf-8');
    expect(off, 'still the override').toMatch(/^effort: low$/m);
    expect(off, 'and the learning-off body, with no apply-decisions preload').not.toContain('apply-decisions');

    okCli(os.tmpdir(), 'learning', '--enable');
    const on = await fs.readFile(installedPrompt('agents', 'code.md'), 'utf-8');
    expect(on).toMatch(/^effort: low$/m);
    expect(on, 'back to the learning-on body').toContain('devflow:apply-decisions');
  }, SCENARIO_TIMEOUT_MS);

  it('a --plugin install gains no other plugin\'s files when the switch is toggled (AC-143)', async () => {
    init('--plugin=implement');
    const installed = await installedTree();
    expect(installed, 'a partial install carries one plugin\'s command').toContain('commands/implement.md');
    expect(installed).not.toContain('commands/research.md');

    okCli(os.tmpdir(), 'learning', '--disable');
    expect(await installedTree(), 'no file added; the skill removed').toEqual(installed.filter(f => f !== 'skills/devflow:apply-decisions'));
    expect(await variantOf('commands', 'implement.md')).toBe('off');
    expect(await variantOf('agents', 'code.md')).toBe('off');

    okCli(os.tmpdir(), 'learning', '--enable');
    expect(await installedTree(), 'enabling restores exactly what the install carried').toEqual(installed);
    expect(await variantOf('commands', 'implement.md')).toBe('on');
  }, SCENARIO_TIMEOUT_MS);

  it('a repository that narrows learning off changes nothing installed on a learning-on machine (AC-144)', async () => {
    const repo = path.join(tmpHome, 'repo');
    await fs.mkdir(path.join(repo, '.devflow'), { recursive: true });
    await fs.writeFile(path.join(repo, '.devflow', 'project.json'), '{"features":{"learning":false}}\n');
    expect(spawnSync('git', ['init', '-q'], { cwd: repo, env: sandboxEnv(tmpHome) }).status).toBe(0);

    okCli(repo, 'init', ...QUIET, '--recommended');

    // Non-vacuity: the repository really does narrow learning off here.
    expect(okCli(repo, 'learning', '--status')).toContain('Effective here: disabled');
    await expectAll('on');
    expect(await exists(skillDir())).toBe(true);
    expect(await manifestLearning()).toBe(true);
  }, SCENARIO_TIMEOUT_MS);

  it('a manifest from another version skips the converge with a run-devflow-init message (AC-145)', async () => {
    init('--recommended');
    const manifestPath = path.join(devflowDir(), 'manifest.json');
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf-8')) as { version: string };
    await fs.writeFile(manifestPath, JSON.stringify({ ...manifest, version: '0.0.1' }, null, 2));

    const out = okCli(os.tmpdir(), 'learning', '--disable');

    expect(out).toContain('devflow init');
    expect(out).toContain('0.0.1');
    await expectAll('on');
    expect(await exists(skillDir())).toBe(true);
    expect(await manifestLearning(), 'the switch itself is still recorded').toBe(false);
  }, SCENARIO_TIMEOUT_MS);

  it('a converge failure only warns: the toggle exits 0, records the switch and converges the rest (AC-146)', async () => {
    init('--recommended');
    // A directory where an installed agent belongs: it cannot be read as the file it should be.
    await fs.rm(installedPrompt('agents', 'code.md'));
    await fs.mkdir(installedPrompt('agents', 'code.md'));

    const { status, out } = runCli(os.tmpdir(), 'learning', '--disable');

    expect(status, out).toBe(0);
    expect(out).toContain('code.md');
    expect(await manifestLearning()).toBe(false);
    expect(await variantOf('commands', 'implement.md'), 'the rest of the fan-out still converged').toBe('off');
    expect(await exists(skillDir())).toBe(false);
  }, SCENARIO_TIMEOUT_MS);
});

// ---------------------------------------------------------------------------
// Shadows
// ---------------------------------------------------------------------------

describe('a skill shadow follows the switch', () => {
  it('stays dormant under learning off, is never deleted, and is installed again on enable', async () => {
    const shadow = path.join(devflowDir(), 'skills', 'apply-decisions', 'SKILL.md');
    await fs.mkdir(path.dirname(shadow), { recursive: true });
    await fs.writeFile(shadow, '---\nname: apply-decisions\ndescription: mine\n---\nmy own apply-decisions\n');

    init('--recommended', '--no-learning');
    expect(await exists(skillDir()), 'not installed with learning off').toBe(false);
    expect(await fs.readFile(shadow, 'utf-8'), 'a shadow is user content').toContain('my own apply-decisions');

    okCli(os.tmpdir(), 'learning', '--enable');
    expect(await fs.readFile(path.join(skillDir(), 'SKILL.md'), 'utf-8')).toContain('my own apply-decisions');

    okCli(os.tmpdir(), 'learning', '--disable');
    expect(await exists(skillDir())).toBe(false);
    expect(await exists(shadow)).toBe(true);
  }, SCENARIO_TIMEOUT_MS);
});
