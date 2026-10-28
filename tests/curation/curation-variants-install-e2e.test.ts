/**
 * End to end: the machine's curation and compliance switches decide which prompts and
 * which skill the install carries (D-LEARNING-VARIANT-INSTALL, plan section 3.B, and #648).
 *
 * Drives the REAL compiled CLI (`node dist/cli.js`) against isolated temp HOMEs, because
 * the unit tests in curation-variants-install.test.ts call the converge with hand-built
 * trees and therefore cannot see a wiring mistake between the CLI, the installer and the
 * converge. Every claim here is about what a user's ~/.claude holds afterwards.
 *
 * A fresh machine has compliance off, so the file an installed prompt must equal is the one
 * built for the machine's two recorded switches, not the curation-only tree: `expectedFile`
 * reads the switches from the manifest and picks the tree with `machineVariantKey`.
 *
 * HOME safety (the near-miss in the pitfalls ledger): every spawn gets its env from the
 * shared `sandboxEnv(tmpHome)`, which pins HOME to a temp directory and refuses a real
 * home, and the HOME is seeded with `~/.claude` first, because without it init exits 0
 * at Claude Code detection before reaching the code under test. The first assertion of
 * each scenario is on installed bytes, never on an exit code a short-circuit also returns.
 *
 * Requires a build (`npm run build`): the spawned CLI reads dist/ and dist/curation-off.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { createHash } from 'crypto';
import { spawnSync } from 'child_process';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  machineVariantKey,
  parseVariantManifest,
  variantOffRelPath,
  type VariantManifestHost,
  type VariantSwitches,
} from '../../src/core/curation-variants.js';
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

/** The compiled hosts of the package under test, from the build manifest `dist/variant-axes.json`. */
async function builtHosts(): Promise<readonly VariantManifestHost[]> {
  const parsed = parseVariantManifest(await fs.readFile(path.join(ROOT, 'dist', 'variant-axes.json'), 'utf-8'));
  if (!parsed.ok) throw new Error(`dist/variant-axes.json is unusable: ${parsed.error.kind}`);
  return parsed.value;
}

/** The files of one kind that carry a curation arm: the roster the curation switch is asserted on. */
async function rosterOf(kind: Kind): Promise<string[]> {
  return (await builtHosts()).filter(h => h.kind === kind && h.axes.curation).map(h => `${h.name}.md`).sort();
}

/** The built file an installed prompt must equal on a machine with these two switches (AC-27). */
async function expectedFile(kind: Kind, file: string, machine: VariantSwitches): Promise<Buffer> {
  const host = (await builtHosts()).find(h => h.kind === kind && `${h.name}.md` === file);
  const key = machineVariantKey(machine, host?.axes ?? { curation: false, compliance: false });
  return fs.readFile(path.join(ROOT, key === 'on' ? path.join('dist', kind, file) : variantOffRelPath(key, kind, file)));
}

/** Which curation variant the installed file is, on the compliance switch the manifest records. */
async function variantOf(kind: Kind, file: string): Promise<Variant> {
  let installed: Buffer;
  try { installed = await fs.readFile(installedPrompt(kind, file)); } catch { return 'missing'; }
  const { compliance } = await machineOf();
  if (installed.equals(await expectedFile(kind, file, { curation: false, compliance }))) return 'off';
  if (installed.equals(await expectedFile(kind, file, { curation: true, compliance }))) return 'on';
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

const manifestFile = (): string => path.join(devflowDir(), 'manifest.json');

/** The machine switch as the manifest records it. */
async function manifestCuration(): Promise<boolean | undefined> {
  const manifest = JSON.parse(await fs.readFile(manifestFile(), 'utf-8')) as {
    features: { learning?: boolean };
  };
  return manifest.features.learning;
}

/** Both switches as the manifest records them. A fresh machine has compliance off. */
async function machineOf(): Promise<VariantSwitches> {
  const manifest = JSON.parse(await fs.readFile(manifestFile(), 'utf-8')) as {
    features: { learning?: boolean; curation?: boolean; compliance?: { enabled?: boolean } };
  };
  return {
    curation: manifest.features.curation ?? manifest.features.learning ?? true,
    compliance: manifest.features.compliance?.enabled === true,
  };
}

/** Assert every installed roster file is the given variant, and that enough of them exist to mean it. */
async function expectAll(variant: 'on' | 'off', minimum = 15): Promise<void> {
  const groups = await installedVariants();
  const other = variant === 'on' ? 'off' : 'on';
  expect(groups[other], `files still the curation-${other} variant`).toEqual([]);
  expect(groups.other, 'files that are neither variant').toEqual([]);
  expect(groups[variant].length, `installed curation-${variant} files (non-vacuity)`).toBeGreaterThanOrEqual(minimum);
}

beforeEach(async () => {
  tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-curation-e2e-'));
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
  it('init --no-curation installs the curation-off prompts and no apply-decisions skill', async () => {
    init('--recommended', '--no-curation');

    await expectAll('off');
    expect(await exists(skillDir()), 'the skill has no reader on a curation-off machine').toBe(false);
    expect(await manifestCuration()).toBe(false);
  }, SCENARIO_TIMEOUT_MS);

  it('init with curation on installs the curation-on prompts and the skill, byte for byte', async () => {
    init('--recommended');

    await expectAll('on');
    expect(await fs.readFile(path.join(skillDir(), 'SKILL.md'), 'utf-8')).toBe(await fs.readFile(SKILL_SOURCE, 'utf-8'));
    expect(await manifestCuration()).toBe(true);
  }, SCENARIO_TIMEOUT_MS);

  it('a prompt with no curation-off file is installed once, the same on both sides of the switch', async () => {
    init('--recommended', '--no-curation');
    const offInstall = await fs.readFile(installedPrompt('agents', 'evaluate.md'));
    init('--recommended');
    const onInstall = await fs.readFile(installedPrompt('agents', 'evaluate.md'));

    expect(await exists(path.join(ROOT, 'dist', 'curation-off', 'agents', 'evaluate.md'))).toBe(false);
    expect(offInstall.equals(onInstall)).toBe(true);
  }, SCENARIO_TIMEOUT_MS);

  it('init --no-curation over a full curation-on install converges the prompts it did not copy (--plugin)', async () => {
    init('--recommended');
    await expectAll('on');
    expect(await exists(skillDir())).toBe(true);

    // A partial install copies one plugin's files; every other plugin's installed file
    // is the converge's to flip, and the skill the copy skipped is the converge's to remove.
    init('--no-curation', '--plugin=implement');

    await expectAll('off');
    expect(await exists(skillDir())).toBe(false);
    expect(await manifestCuration()).toBe(false);
  }, SCENARIO_TIMEOUT_MS);

  it('a re-init on the same switch moves nothing: every installed prompt and the file list are identical', async () => {
    init('--recommended', '--no-curation');
    const before = await promptDigest();
    expect(before.size, 'non-vacuity: prompts were installed').toBeGreaterThan(20);

    init('--recommended', '--no-curation');

    expect(await promptDigest()).toEqual(before);
    expect(await installedTree()).toEqual([...new Set(await installedTree())]);
  }, SCENARIO_TIMEOUT_MS);
});

// ---------------------------------------------------------------------------
// devflow curation --enable / --disable
// ---------------------------------------------------------------------------

describe('devflow curation --enable/--disable converges the install (AC-140, AC-141)', () => {
  it('--enable brings back the curation-on prompts and the skill, and --disable reverses it', async () => {
    init('--recommended', '--no-curation');
    await expectAll('off');

    const enabled = okCli(os.tmpdir(), 'curation', '--enable');
    await expectAll('on');
    expect(await fs.readFile(path.join(skillDir(), 'SKILL.md'), 'utf-8')).toBe(await fs.readFile(SKILL_SOURCE, 'utf-8'));
    expect(await manifestCuration()).toBe(true);
    expect(enabled).toContain('Installed prompts');

    okCli(os.tmpdir(), 'curation', '--disable');
    await expectAll('off');
    expect(await exists(skillDir())).toBe(false);
    expect(await manifestCuration()).toBe(false);
  }, SCENARIO_TIMEOUT_MS);

  it('a toggle to the value already installed prints nothing about prompts and writes nothing', async () => {
    init('--recommended', '--no-curation');
    const tree = await installedTree();
    const manifest = await fs.readFile(manifestFile());

    const again = okCli(os.tmpdir(), 'curation', '--disable');

    expect(again).not.toContain('Installed prompts');
    expect(await installedTree()).toEqual(tree);
    await expectAll('off');
    expect((await fs.readFile(manifestFile())).equals(manifest), 'the manifest, updatedAt included, is byte-identical').toBe(true);
  }, SCENARIO_TIMEOUT_MS);

  it('--enable on an enabled machine and --disable on a disabled one leave manifest.json byte-identical (D-NOOP-TOGGLE)', async () => {
    init('--recommended');
    const enabledManifest = await fs.readFile(manifestFile());
    expect(await manifestCuration(), 'non-vacuity: curation is recorded on').toBe(true);

    okCli(os.tmpdir(), 'curation', '--enable');
    expect((await fs.readFile(manifestFile())).equals(enabledManifest), 'enable over enabled').toBe(true);

    okCli(os.tmpdir(), 'curation', '--disable');
    expect(await manifestCuration(), 'a real toggle is still recorded').toBe(false);
    const disabledManifest = await fs.readFile(manifestFile());
    expect(disabledManifest.equals(enabledManifest), 'a real toggle changes the manifest').toBe(false);

    okCli(os.tmpdir(), 'curation', '--disable');
    expect((await fs.readFile(manifestFile())).equals(disabledManifest), 'disable over disabled').toBe(true);
  }, SCENARIO_TIMEOUT_MS);

  it('an agent model/effort override survives a toggle in both directions (AC-142)', async () => {
    init('--recommended');
    okCli(os.tmpdir(), 'agents', '--set', 'code', '--effort', 'low');
    const frontmatterOf = async (): Promise<string> => (await fs.readFile(installedPrompt('agents', 'code.md'), 'utf-8')).split('\n---\n')[0];
    expect(await frontmatterOf(), 'the override is in the installed file before the toggle').toMatch(/^effort: low$/m);

    okCli(os.tmpdir(), 'curation', '--disable');
    const off = await fs.readFile(installedPrompt('agents', 'code.md'), 'utf-8');
    expect(off, 'still the override').toMatch(/^effort: low$/m);
    expect(off, 'and the curation-off body, with no apply-decisions preload').not.toContain('apply-decisions');

    okCli(os.tmpdir(), 'curation', '--enable');
    const on = await fs.readFile(installedPrompt('agents', 'code.md'), 'utf-8');
    expect(on).toMatch(/^effort: low$/m);
    expect(on, 'back to the curation-on body').toContain('devflow:apply-decisions');
  }, SCENARIO_TIMEOUT_MS);

  it('a --plugin install gains no other plugin\'s files when the switch is toggled (AC-143)', async () => {
    init('--plugin=implement');
    const installed = await installedTree();
    expect(installed, 'a partial install carries one plugin\'s command').toContain('commands/implement.md');
    expect(installed).not.toContain('commands/research.md');

    okCli(os.tmpdir(), 'curation', '--disable');
    expect(await installedTree(), 'no file added; the skill removed').toEqual(installed.filter(f => f !== 'skills/devflow:apply-decisions'));
    expect(await variantOf('commands', 'implement.md')).toBe('off');
    expect(await variantOf('agents', 'code.md')).toBe('off');

    okCli(os.tmpdir(), 'curation', '--enable');
    expect(await installedTree(), 'enabling restores exactly what the install carried').toEqual(installed);
    expect(await variantOf('commands', 'implement.md')).toBe('on');
  }, SCENARIO_TIMEOUT_MS);

  it('a repository that narrows curation off changes nothing installed on a curation-on machine (AC-144)', async () => {
    const repo = path.join(tmpHome, 'repo');
    await fs.mkdir(path.join(repo, '.devflow'), { recursive: true });
    await fs.writeFile(path.join(repo, '.devflow', 'project.json'), '{"features":{"learning":false}}\n');
    expect(spawnSync('git', ['init', '-q'], { cwd: repo, env: sandboxEnv(tmpHome) }).status).toBe(0);

    okCli(repo, 'init', ...QUIET, '--recommended');

    // Non-vacuity: the repository really does narrow curation off here.
    expect(okCli(repo, 'curation', '--status')).toContain('Effective here: disabled');
    await expectAll('on');
    expect(await exists(skillDir())).toBe(true);
    expect(await manifestCuration()).toBe(true);
  }, SCENARIO_TIMEOUT_MS);

  it('a manifest from another version skips the converge with a run-devflow-init message (AC-145)', async () => {
    init('--recommended');
    const manifestPath = path.join(devflowDir(), 'manifest.json');
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf-8')) as { version: string };
    await fs.writeFile(manifestPath, JSON.stringify({ ...manifest, version: '0.0.1' }, null, 2));

    const out = okCli(os.tmpdir(), 'curation', '--disable');

    expect(out).toContain('devflow init');
    expect(out).toContain('0.0.1');
    await expectAll('on');
    expect(await exists(skillDir())).toBe(true);
    expect(await manifestCuration(), 'the switch itself is still recorded').toBe(false);
  }, SCENARIO_TIMEOUT_MS);

  it('a converge failure only warns: the toggle exits 0, records the switch and converges the rest (AC-146)', async () => {
    init('--recommended');
    // A directory where an installed agent belongs: it cannot be read as the file it should be.
    await fs.rm(installedPrompt('agents', 'code.md'));
    await fs.mkdir(installedPrompt('agents', 'code.md'));

    const { status, out } = runCli(os.tmpdir(), 'curation', '--disable');

    expect(status, out).toBe(0);
    expect(out).toContain('code.md');
    expect(await manifestCuration()).toBe(false);
    expect(await variantOf('commands', 'implement.md'), 'the rest of the fan-out still converged').toBe('off');
    expect(await exists(skillDir())).toBe(false);
  }, SCENARIO_TIMEOUT_MS);
});

// ---------------------------------------------------------------------------
// Shadows
// ---------------------------------------------------------------------------

describe('a skill shadow follows the switch', () => {
  it('stays dormant under curation off, is never deleted, and is installed again on enable', async () => {
    const shadow = path.join(devflowDir(), 'skills', 'apply-decisions', 'SKILL.md');
    await fs.mkdir(path.dirname(shadow), { recursive: true });
    await fs.writeFile(shadow, '---\nname: apply-decisions\ndescription: mine\n---\nmy own apply-decisions\n');

    init('--recommended', '--no-curation');
    expect(await exists(skillDir()), 'not installed with curation off').toBe(false);
    expect(await fs.readFile(shadow, 'utf-8'), 'a shadow is user content').toContain('my own apply-decisions');

    okCli(os.tmpdir(), 'curation', '--enable');
    expect(await fs.readFile(path.join(skillDir(), 'SKILL.md'), 'utf-8')).toContain('my own apply-decisions');

    okCli(os.tmpdir(), 'curation', '--disable');
    expect(await exists(skillDir())).toBe(false);
    expect(await exists(shadow)).toBe(true);
  }, SCENARIO_TIMEOUT_MS);
});

// ---------------------------------------------------------------------------
// The compliance switch (#648)
// ---------------------------------------------------------------------------

/** The fixed line every compliance-off command records when the repository requires evidence (AC-18). */
const DEGRADED_LINE = 'compliance off on this machine; the repository requires evidence';

/** The four machines: both switches, each way. */
const MACHINES: readonly VariantSwitches[] = [
  { curation: true, compliance: true },
  { curation: false, compliance: true },
  { curation: true, compliance: false },
  { curation: false, compliance: false },
];

const labelOf = (m: VariantSwitches): string => `curation ${m.curation ? 'on' : 'off'}, compliance ${m.compliance ? 'on' : 'off'}`;

/** A fresh init of one machine. Compliance on names one framework, so a bare `--compliance` never prompts. */
function initMachine(m: VariantSwitches): string {
  return init('--recommended', ...(m.curation ? [] : ['--no-curation']), ...(m.compliance ? ['--compliance', 'gdpr'] : ['--no-compliance']));
}

/** Toggle an installed machine to another with the real `curation` and `compliance` commands, one axis at a time. */
function toggleMachine(from: VariantSwitches, to: VariantSwitches): void {
  if (from.curation !== to.curation) okCli(os.tmpdir(), 'curation', to.curation ? '--enable' : '--disable');
  if (from.compliance !== to.compliance) {
    if (to.compliance) okCli(os.tmpdir(), 'compliance', '--set', 'gdpr');
    else okCli(os.tmpdir(), 'compliance', '--disable');
  }
}

/** The folders under ~/.claude that the switches decide, as installed. */
const DIGEST_ROOTS = ['commands/devflow', 'agents/devflow', 'skills', 'rules'] as const;
/** The deepest folder the digest walks below a root: skills nest a references folder. */
const MAX_DIGEST_DEPTH = 6;

async function digestInto(dir: string, rel: string, depth: number, out: Map<string, string>): Promise<void> {
  expect(depth, `the install tree under ${rel} is deeper than ${MAX_DIGEST_DEPTH}`).toBeLessThanOrEqual(MAX_DIGEST_DEPTH);
  for (const entry of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const entryRel = `${rel}/${entry.name}`;
    if (entry.isDirectory()) await digestInto(path.join(dir, entry.name), entryRel, depth + 1, out);
    else out.set(entryRel, createHash('sha256').update(await fs.readFile(path.join(dir, entry.name))).digest('hex'));
  }
}

/** `relative path -> sha256` of every installed command, agent, skill and rule. */
async function installDigest(): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const root of DIGEST_ROOTS) await digestInto(path.join(claudeDir(), root), root, 0, out);
  return out;
}

/** The record of installed variants the manifest carries. */
async function installedRecord(): Promise<unknown> {
  return (JSON.parse(await fs.readFile(manifestFile(), 'utf-8')) as { installedVariants?: unknown }).installedVariants;
}

const stripAnsi = (text: string): string => text.replace(/\u001b\[[0-9;]*m/g, '');

describe('a toggled install equals a fresh init of the same machine (TP-40, AC-27, AC-29)', () => {
  const freshDigest = new Map<string, Map<string, string>>();
  const freshRecord = new Map<string, unknown>();

  beforeAll(async () => {
    for (const machine of MACHINES) {
      tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-curation-e2e-fresh-'));
      expect(() => assertTempHome(tmpHome)).not.toThrow();
      await fs.mkdir(claudeDir(), { recursive: true });
      try {
        initMachine(machine);
        freshDigest.set(labelOf(machine), await installDigest());
        freshRecord.set(labelOf(machine), await installedRecord());
      } finally {
        await fs.rm(tmpHome, { recursive: true, force: true });
      }
    }
  }, 4 * SCENARIO_TIMEOUT_MS);

  it('non-vacuity: the four fresh machines install four different trees', () => {
    const trees = MACHINES.map(m => JSON.stringify([...(freshDigest.get(labelOf(m)) ?? new Map())]));
    expect(new Set(trees).size).toBe(MACHINES.length);
    for (const tree of freshDigest.values()) expect(tree.size).toBeGreaterThan(20);
  });

  for (const from of MACHINES) {
    for (const to of MACHINES) {
      if (from === to) continue;
      it(`${labelOf(from)} toggled to ${labelOf(to)}`, async () => {
        initMachine(from);
        expect(await machineOf(), 'the start machine is the one asked for').toEqual(from);

        toggleMachine(from, to);

        expect(await machineOf()).toEqual(to);
        expect(await installDigest()).toEqual(freshDigest.get(labelOf(to)));
        expect(await installedRecord(), 'the record says what the converge installed').toEqual(to);
      }, SCENARIO_TIMEOUT_MS);
    }
  }

  it('a fresh init of each machine records the variants it installed', () => {
    for (const machine of MACHINES) expect(freshRecord.get(labelOf(machine)), labelOf(machine)).toEqual(machine);
  });
});

describe('devflow compliance converges the install (AC-27, AC-28, AC-31)', () => {
  it('a compliance-off install records the fixed degraded line once in plan and release, and --set takes it away', async () => {
    init('--recommended', '--no-compliance');
    const readCommand = (name: string): Promise<string> => fs.readFile(installedPrompt('commands', `${name}.md`), 'utf-8');
    for (const name of ['plan', 'release']) {
      const text = await readCommand(name);
      expect(text.split(DEGRADED_LINE).length - 1, `${name} records the line once`).toBe(1);
    }
    expect(await readCommand('plan'), 'the compliance-off plan has no reviewer focus areas').not.toContain('Reviewer Focus Areas');

    okCli(os.tmpdir(), 'compliance', '--set', 'gdpr');

    for (const name of ['plan', 'release']) expect(await readCommand(name), name).not.toContain(DEGRADED_LINE);
    expect(await readCommand('plan')).toContain('Reviewer Focus Areas');
  }, SCENARIO_TIMEOUT_MS);

  it('--disable says the posting steps were removed, and --status reads the record', async () => {
    init('--recommended', '--compliance', 'gdpr');
    expect(stripAnsi(okCli(os.tmpdir(), 'compliance', '--status'))).toMatch(/Posting: +installed +│/);

    const out = okCli(os.tmpdir(), 'compliance', '--disable');

    expect(out).toContain('every posting step removed');
    expect(stripAnsi(okCli(os.tmpdir(), 'compliance', '--status'))).toMatch(/Posting: +not installed +│/);
  }, SCENARIO_TIMEOUT_MS);

  it('--status of an install with no record says unknown and names devflow init', async () => {
    init('--recommended', '--compliance', 'gdpr');
    const manifest = JSON.parse(await fs.readFile(manifestFile(), 'utf-8')) as Record<string, unknown>;
    delete manifest.installedVariants;
    await fs.writeFile(manifestFile(), JSON.stringify(manifest, null, 2));

    expect(stripAnsi(okCli(os.tmpdir(), 'compliance', '--status'))).toMatch(/Posting: +unknown \(run devflow init\) +│/);
  }, SCENARIO_TIMEOUT_MS);

  it('a manifest from another version exits non-zero on disable and names the posting steps (TP-42)', async () => {
    init('--recommended', '--compliance', 'gdpr');
    const manifest = JSON.parse(await fs.readFile(manifestFile(), 'utf-8')) as { version: string };
    await fs.writeFile(manifestFile(), JSON.stringify({ ...manifest, version: '0.0.1' }, null, 2));

    const { status, out } = runCli(os.tmpdir(), 'compliance', '--disable');

    expect(status, out).toBe(1);
    expect(out).toContain('posting steps remain installed until devflow init');
    expect(out).not.toContain('Compliance disabled');
    const plan = await fs.readFile(installedPrompt('commands', 'plan.md'));
    expect(plan.equals(await expectedFile('commands', 'plan.md', { curation: true, compliance: true })), 'nothing was converged: the installed plan is still the compliance-on one').toBe(true);
    expect(JSON.parse(await fs.readFile(manifestFile(), 'utf-8')).features.compliance.enabled, 'the switch itself is still recorded').toBe(false);
  }, SCENARIO_TIMEOUT_MS);
});
