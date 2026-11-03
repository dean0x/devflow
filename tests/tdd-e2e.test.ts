/**
 * End to end: `devflow tdd --disable` then `--enable` restores the install byte for byte (#758).
 *
 * Drives the REAL compiled CLI (`node dist/cli.js`) against isolated temp HOMEs, because the unit
 * tests of the command and of the converge call them with hand-built trees and therefore cannot see
 * a wiring mistake between the CLI, the installer and the converge. Every claim here is about what a
 * user's ~/.claude holds afterwards, on each of the four curation and compliance machines:
 *
 *   off   the installed Code agent and Triage are the tdd-off files of the machine (Triage the one
 *         for its curation and compliance state), the test-driven-development skill folder is
 *         gone, and nothing else under ~/.claude changed (the curation and compliance files, the
 *         other skills and the other agents);
 *   on    every file under ~/.claude is byte-identical to the first install, both agents and the
 *         skill folder included.
 *
 * HOME safety: every spawn gets its env from the shared `sandboxEnv(tmpHome)`, which pins HOME to a
 * temp directory and refuses a real home, and the HOME is seeded with `~/.claude` first, because
 * without it init exits 0 at Claude Code detection before reaching the code under test.
 *
 * Requires a build (`npm run build`): the spawned CLI reads dist/ and its variant trees.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHash } from 'crypto';
import { spawnSync } from 'child_process';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';

import { machineVariantKey, variantOffRelPath, type VariantSwitches } from '../src/core/curation-variants.js';
import { requireBuiltCli, sandboxEnv, walkFiles } from './helpers.js';
import { assertTempHome } from './setup/home-isolation.js';

const CLI = requireBuiltCli();
const ROOT = path.resolve(import.meta.dirname, '..');

/** One CLI spawn under load runs well past vitest's 5 s default. */
const SUBPROCESS_TIMEOUT_MS = 120_000;
/** A scenario that chains several spawns gets a budget of several. */
const SCENARIO_TIMEOUT_MS = 8 * SUBPROCESS_TIMEOUT_MS;

/** Flags that keep every install down to the prompts, skills and manifest this file is about. */
const QUIET = ['--no-ambient', '--no-memory', '--no-knowledge', '--no-rules'] as const;

const TDD_SKILL_PREFIX = 'skills/devflow:test-driven-development/';
const CODE_AGENT = 'agents/devflow/code.md';
const TRIAGE_AGENT = 'agents/devflow/triage.md';
const ANSI = /\u001b\[[0-9;]*m/g;

let tmpHome: string;

const claudeDir = (): string => path.join(tmpHome, '.claude');
const devflowDir = (): string => path.join(tmpHome, '.devflow');

function runCli(...args: string[]): { status: number | null; out: string } {
  const result = spawnSync('node', [CLI, ...args], {
    encoding: 'utf-8',
    timeout: SUBPROCESS_TIMEOUT_MS,
    cwd: os.tmpdir(),
    env: sandboxEnv(tmpHome),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error) throw result.error;
  return { status: result.status, out: `${result.stdout ?? ''}${result.stderr ?? ''}`.replace(ANSI, '') };
}

function okCli(...args: string[]): string {
  const { status, out } = runCli(...args);
  expect(status, `devflow ${args.join(' ')} failed:\n${out}`).toBe(0);
  return out;
}

/** `relative path -> sha256` for every file under ~/.claude. */
async function digestOfClaudeDir(): Promise<Map<string, string>> {
  const digest = new Map<string, string>();
  for (const file of walkFiles(claudeDir(), () => true)) {
    digest.set(path.relative(claudeDir(), file).split(path.sep).join('/'), createHash('sha256').update(await fs.readFile(file)).digest('hex'));
  }
  return digest;
}

interface Difference { readonly added: string[]; readonly changed: string[]; readonly removed: string[] }

/** Named collector: how the tree `after` differs from the tree `before`, each list sorted. */
function differences(before: ReadonlyMap<string, string>, after: ReadonlyMap<string, string>): Difference {
  return {
    added: [...after.keys()].filter(file => !before.has(file)).sort(),
    changed: [...after.keys()].filter(file => before.has(file) && before.get(file) !== after.get(file)).sort(),
    removed: [...before.keys()].filter(file => !after.has(file)).sort(),
  };
}

async function features(): Promise<{ tdd?: boolean; curation?: boolean }> {
  const manifest = JSON.parse(await fs.readFile(path.join(devflowDir(), 'manifest.json'), 'utf-8')) as {
    features: { tdd?: boolean; curation?: boolean };
  };
  return manifest.features;
}

async function installedRecord(): Promise<{ tdd?: boolean } | undefined> {
  const manifest = JSON.parse(await fs.readFile(path.join(devflowDir(), 'manifest.json'), 'utf-8')) as { installedVariants?: { tdd?: boolean } };
  return manifest.installedVariants;
}

/** The built file an agent must equal on a machine, from the axes its host carries an arm on. */
async function builtAgent(name: string, arms: VariantSwitches, machine: VariantSwitches): Promise<Buffer> {
  const key = machineVariantKey(machine, arms);
  return fs.readFile(path.join(ROOT, key === 'on' ? path.join('dist', 'agents', `${name}.md`) : variantOffRelPath(key, 'agents', `${name}.md`)));
}

/** Code carries a curation arm and a tdd arm, no compliance arm. */
const builtCode = (machine: VariantSwitches): Promise<Buffer> =>
  builtAgent('code', { curation: true, compliance: false, tdd: true }, machine);

/** Triage carries a curation, a compliance and a tdd arm. */
const builtTriage = (machine: VariantSwitches): Promise<Buffer> =>
  builtAgent('triage', { curation: true, compliance: true, tdd: true }, machine);

const MACHINES: readonly { readonly curation: boolean; readonly compliance: boolean }[] = [
  { curation: true, compliance: false },
  { curation: false, compliance: false },
  { curation: true, compliance: true },
  { curation: false, compliance: true },
];

const labelOf = (m: { curation: boolean; compliance: boolean }): string =>
  `curation ${m.curation ? 'on' : 'off'}, compliance ${m.compliance ? 'on' : 'off'}`;

function init(m: { curation: boolean; compliance: boolean }): string {
  return okCli('init', ...QUIET, '--recommended', ...(m.curation ? [] : ['--no-curation']), ...(m.compliance ? ['--compliance', 'gdpr'] : ['--no-compliance']));
}

beforeEach(async () => {
  tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-tdd-e2e-'));
  expect(() => assertTempHome(tmpHome)).not.toThrow();
  await fs.mkdir(claudeDir(), { recursive: true });
});

afterEach(async () => {
  await fs.rm(tmpHome, { recursive: true, force: true });
});

describe('devflow tdd --disable then --enable (#758, AC-4)', () => {
  it.each(MACHINES)('on a machine with %o: off installs the tdd-off Code file and removes the skill, on restores every byte', async (machine) => {
    init(machine);
    const first = await digestOfClaudeDir();
    const firstCode = await fs.readFile(path.join(claudeDir(), CODE_AGENT));
    const switches: VariantSwitches = { ...machine, tdd: true };
    const firstTriage = await fs.readFile(path.join(claudeDir(), TRIAGE_AGENT));
    expect(firstCode.equals(await builtCode(switches)), `${labelOf(machine)}: a fresh install holds the tdd-on Code file`).toBe(true);
    expect(firstTriage.equals(await builtTriage(switches)), `${labelOf(machine)}: a fresh install holds the tdd-on Triage file`).toBe(true);
    expect([...first.keys()].filter(file => file.startsWith(TDD_SKILL_PREFIX)).length, 'the skill is installed (non-vacuity)').toBeGreaterThan(0);

    const disabled = okCli('tdd', '--disable');
    expect(disabled).toContain('TDD disabled');
    const off = await digestOfClaudeDir();
    const offCode = await fs.readFile(path.join(claudeDir(), CODE_AGENT));
    expect(offCode.equals(await builtCode({ ...machine, tdd: false })), `${labelOf(machine)}: the Code agent is the tdd-off file`).toBe(true);
    expect(offCode.equals(firstCode), 'the tdd-off file differs from the tdd-on file').toBe(false);
    const offTriage = await fs.readFile(path.join(claudeDir(), TRIAGE_AGENT));
    expect(offTriage.equals(await builtTriage({ ...machine, tdd: false })), `${labelOf(machine)}: Triage is the tdd-off file for this machine's curation and compliance state`).toBe(true);
    expect(offTriage.equals(firstTriage), 'the tdd-off Triage file differs from the tdd-on file').toBe(false);
    const turnedOff = differences(first, off);
    expect(turnedOff.added, 'no file is added').toEqual([]);
    expect(turnedOff.changed, 'only the Code agent and Triage change: the other curation and compliance files stay').toEqual([CODE_AGENT, TRIAGE_AGENT]);
    expect(turnedOff.removed.length, 'the skill folder is gone').toBeGreaterThan(0);
    expect(turnedOff.removed.every(file => file.startsWith(TDD_SKILL_PREFIX)), `only the skill folder is removed: ${turnedOff.removed.join(', ')}`).toBe(true);
    expect((await features()).tdd).toBe(false);
    expect((await installedRecord())?.tdd).toBe(false);
    expect(okCli('tdd', '--status')).toMatch(/State: +disabled[\s\S]*Skill: +not installed[\s\S]*Prompts: +off/);

    const enabled = okCli('tdd', '--enable');
    expect(enabled).toContain('TDD enabled');
    expect(differences(first, await digestOfClaudeDir()), 'every file is byte-identical to the first install').toEqual({ added: [], changed: [], removed: [] });
    expect((await features()).tdd).toBe(true);
    expect((await installedRecord())?.tdd).toBe(true);
    expect(okCli('tdd', '--status')).toMatch(/State: +enabled[\s\S]*Skill: +installed[\s\S]*Prompts: +on/);
  }, SCENARIO_TIMEOUT_MS);

  it('a re-init keeps the switch off: the tdd-off Code file and no skill', async () => {
    init(MACHINES[0]);
    okCli('tdd', '--disable');
    const off = await digestOfClaudeDir();

    init(MACHINES[0]);

    expect(differences(off, await digestOfClaudeDir())).toEqual({ added: [], changed: [], removed: [] });
    expect((await features()).tdd).toBe(false);
  }, SCENARIO_TIMEOUT_MS);

  it('disabling twice changes nothing the second time', async () => {
    init(MACHINES[0]);
    okCli('tdd', '--disable');
    const off = await digestOfClaudeDir();

    okCli('tdd', '--disable');

    expect(differences(off, await digestOfClaudeDir())).toEqual({ added: [], changed: [], removed: [] });
  }, SCENARIO_TIMEOUT_MS);
});

describe('devflow tdd on a machine without devflow', () => {
  it('--disable exits 1, names devflow init and creates no manifest', async () => {
    const { status, out } = runCli('tdd', '--disable');

    expect(status, out).toBe(1);
    expect(out).toContain('devflow init');
    await expect(fs.access(path.join(devflowDir(), 'manifest.json'))).rejects.toThrow();
  }, SUBPROCESS_TIMEOUT_MS);
});
