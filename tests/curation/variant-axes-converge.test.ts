/**
 * The one converge for both axes (#648, AC-27, AC-28, AC-29), against temp trees.
 *
 * `convergeVariantAxes` makes the installed commands, agents and skills match the machine's curation
 * and compliance switches, and answers the fail-closed question of a compliance-off machine: does an
 * installed prompt still post? These tests drive it, and the toggle helper that wraps it, with a temp
 * Claude dir, a temp devflow dir and a temp package root that holds one host of each arm shape, so the
 * file each of the four machines must install is known byte for byte. Nothing touches the real HOME
 * or the real `dist/`.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  applyVariantToggle,
  convergePromptVariants,
  convergeVariantAxes,
  describePostingLeft,
  variantToggleSkew,
  type ConvergeVariantAxesResult,
} from '../../src/targets/claude-code/curation-install.js';
import { bothOffDir, complianceOffDir, curationOffDir, skillsDir } from '../../src/core/assets.js';
import { readInstalledVariants } from '../../src/core/installed-variants.js';
import { readManifest } from '../../src/core/manifest.js';
import { DEVFLOW_PLUGINS, type PluginDefinition } from '../../src/core/plugins.js';
import { assertTempHome } from '../setup/home-isolation.js';

const SKILL = 'apply-decisions';
const SKILL_DIR = 'devflow:apply-decisions';

let tmp: string;
let claudeDir: string;
let devflowDir: string;
let pkg: string;
let warnings: string[];

const warn = (msg: string): void => { warnings.push(msg); };

const FULL_SELECTION: readonly PluginDefinition[] = DEVFLOW_PLUGINS;

async function write(file: string, text: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, text, 'utf-8');
}

const read = (file: string): Promise<string> => fs.readFile(file, 'utf-8');

async function exists(file: string): Promise<boolean> {
  try { await fs.access(file); return true; } catch { return false; }
}

const installedCommand = (name: string): string => path.join(claudeDir, 'commands', 'devflow', `${name}.md`);
const installedAgent = (name: string): string => path.join(claudeDir, 'agents', 'devflow', `${name}.md`);

/** One machine: the two switches. */
interface Machine { readonly curation: boolean; readonly compliance: boolean }

/** The four machines, in the order the matrix walks them. */
const MACHINES: readonly Machine[] = [
  { curation: true, compliance: true },
  { curation: false, compliance: true },
  { curation: true, compliance: false },
  { curation: false, compliance: false },
];

const label = (m: Machine): string => `curation ${m.curation ? 'on' : 'off'}, compliance ${m.compliance ? 'on' : 'off'}`;

/**
 * A package root with one host of each arm shape:
 *   - commands/plan: both arms (four files);
 *   - commands/release: a compliance arm only (on and compliance-off);
 *   - commands/implement and agents/code: a curation arm only;
 *   - commands/no-arm: no arm.
 * and the build manifest that names the arms.
 */
async function seedPackage(): Promise<void> {
  await write(path.join(pkg, 'dist', 'commands', 'plan.md'), 'plan ON\n');
  await write(path.join(curationOffDir('commands', pkg), 'plan.md'), 'plan CURATION-OFF\n');
  await write(path.join(complianceOffDir('commands', pkg), 'plan.md'), 'plan COMPLIANCE-OFF\n');
  await write(path.join(bothOffDir('commands', pkg), 'plan.md'), 'plan BOTH-OFF\n');
  await write(path.join(pkg, 'dist', 'commands', 'release.md'), 'release ON\n');
  await write(path.join(complianceOffDir('commands', pkg), 'release.md'), 'release COMPLIANCE-OFF\n');
  await write(path.join(pkg, 'dist', 'commands', 'implement.md'), 'implement ON\n');
  await write(path.join(curationOffDir('commands', pkg), 'implement.md'), 'implement CURATION-OFF\n');
  await write(path.join(pkg, 'dist', 'commands', 'no-arm.md'), 'no-arm\n');
  await write(path.join(pkg, 'dist', 'agents', 'code.md'), 'code ON\n');
  await write(path.join(curationOffDir('agents', pkg), 'code.md'), 'code CURATION-OFF\n');
  await write(path.join(skillsDir(pkg), SKILL, 'SKILL.md'), 'apply-decisions of the temp package\n');
  await write(path.join(pkg, 'dist', 'variant-axes.json'), JSON.stringify({
    version: 1,
    hosts: {
      'agents/code': { curation: true, compliance: false },
      'commands/implement': { curation: true, compliance: false },
      'commands/plan': { curation: true, compliance: true },
      'commands/release': { curation: false, compliance: true },
    },
  }));
}

/** What each installed prompt holds on a machine. */
function expectedFiles(m: Machine): Record<string, string> {
  const plan = m.curation ? (m.compliance ? 'plan ON' : 'plan COMPLIANCE-OFF') : (m.compliance ? 'plan CURATION-OFF' : 'plan BOTH-OFF');
  return {
    [installedCommand('plan')]: `${plan}\n`,
    [installedCommand('release')]: `${m.compliance ? 'release ON' : 'release COMPLIANCE-OFF'}\n`,
    [installedCommand('implement')]: `${m.curation ? 'implement ON' : 'implement CURATION-OFF'}\n`,
    [installedCommand('no-arm')]: 'no-arm\n',
    [installedAgent('code')]: `${m.curation ? 'code ON' : 'code CURATION-OFF'}\n`,
  };
}

async function installAs(m: Machine): Promise<void> {
  for (const [file, text] of Object.entries(expectedFiles(m))) await write(file, text);
}

const stateOf = (m: Machine, rules = false) => ({
  features: { curation: m.curation, compliance: { enabled: m.compliance, frameworks: [] as string[] }, rules },
});

function converge(m: Machine, plugins: readonly PluginDefinition[] = FULL_SELECTION): Promise<ConvergeVariantAxesResult> {
  return convergeVariantAxes({ claudeDir, devflowDir, manifest: stateOf(m), plugins, warn, packageRoot: pkg });
}

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-variant-axes-'));
  expect(() => assertTempHome(tmp)).not.toThrow();
  claudeDir = path.join(tmp, 'claude');
  devflowDir = path.join(tmp, 'devflow');
  pkg = path.join(tmp, 'pkg');
  warnings = [];
  await fs.mkdir(claudeDir, { recursive: true });
  await fs.mkdir(devflowDir, { recursive: true });
  await seedPackage();
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('convergeVariantAxes: every machine ends on its own files (AC-27)', () => {
  for (const from of MACHINES) {
    for (const to of MACHINES) {
      it(`from ${label(from)} to ${label(to)}`, async () => {
        await installAs(from);

        const result = await converge(to);

        expect(result.converged, warnings.join('\n')).toBe(true);
        expect(result.posting).toEqual({ kind: 'clear' });
        for (const [file, text] of Object.entries(expectedFiles(to))) expect(await read(file), file).toBe(text);
        expect(warnings).toEqual([]);
      });
    }
  }

  it('a second run on the same machine rewrites nothing', async () => {
    await installAs({ curation: true, compliance: true });
    await converge({ curation: false, compliance: false });

    const second = await converge({ curation: false, compliance: false });

    expect(second.commandsRewritten).toEqual([]);
    expect(second.agentsRewritten).toEqual([]);
    expect(second.unchanged).toBe(4);
  });

  it('a both-off machine takes the both-off file for a host with both arms, never the curation-off file', async () => {
    await installAs({ curation: true, compliance: true });

    await converge({ curation: false, compliance: false });

    expect(await read(installedCommand('plan'))).toBe('plan BOTH-OFF\n');
  });

  it('known-bad probe: the compliance-off file of a compliance-armed host is not the on file (the matrix is not vacuous)', async () => {
    await installAs({ curation: true, compliance: true });

    await converge({ curation: true, compliance: false });

    expect(await read(installedCommand('release'))).not.toBe('release ON\n');
    expect(await read(installedCommand('plan'))).toBe('plan COMPLIANCE-OFF\n');
  });

  it('converges the apply-decisions skill with curation and the compliance skill on every machine', async () => {
    await installAs({ curation: true, compliance: true });

    const on = await converge({ curation: true, compliance: true });
    expect(on.skill).toBe('installed');
    expect(await exists(path.join(claudeDir, 'skills', SKILL_DIR))).toBe(true);
    expect(on.compliance.converged).toBe(true);
    expect(await exists(path.join(claudeDir, 'skills', 'devflow:compliance'))).toBe(true);

    const off = await converge({ curation: false, compliance: false });
    expect(off.skill).toBe('removed');
    expect(await exists(path.join(claudeDir, 'skills', SKILL_DIR))).toBe(false);
    expect(await exists(path.join(claudeDir, 'skills', 'devflow:compliance')), 'the compliance skill is installed on every machine').toBe(true);
  });
});

describe('convergeVariantAxes: a compliance-off machine fails closed (AC-28)', () => {
  const OFF: Machine = { curation: true, compliance: false };

  it('an absent compliance-off tree lists the installed compliance-armed prompts that still post, and touches none', async () => {
    await installAs({ curation: true, compliance: true });
    await fs.rm(complianceOffDir('commands', pkg), { recursive: true });
    await fs.rm(bothOffDir('commands', pkg), { recursive: true });

    const result = await converge(OFF);

    expect(result.converged).toBe(false);
    expect(result.posting).toEqual({
      kind: 'left',
      files: [installedCommand('plan'), installedCommand('release')],
    });
    expect(await read(installedCommand('plan'))).toBe('plan ON\n');
    expect(await read(installedCommand('release'))).toBe('release ON\n');
    expect(warnings.some(w => w.includes('no source for commands/release.md'))).toBe(true);
  });

  it('lists only the installed files: a compliance-armed prompt that was never installed cannot post', async () => {
    await write(installedCommand('plan'), 'plan ON\n');
    await fs.rm(path.join(complianceOffDir('commands', pkg), 'release.md'));

    const result = await converge(OFF);

    expect(result.posting).toEqual({ kind: 'clear' });
    expect(result.notInstalled).toBeGreaterThan(0);
    expect(await read(installedCommand('plan'))).toBe('plan COMPLIANCE-OFF\n');
  });

  it('an unusable build manifest cannot name the prompts that post, so the answer is unknown', async () => {
    await installAs({ curation: true, compliance: true });
    await fs.rm(path.join(pkg, 'dist', 'variant-axes.json'));

    const result = await converge(OFF);

    expect(result.converged).toBe(false);
    expect(result.posting.kind).toBe('unknown');
    expect(warnings.some(w => w.includes('variant manifest'))).toBe(true);
  });

  it('an invalid build manifest is unknown as well, never a silent clear', async () => {
    await installAs({ curation: true, compliance: true });
    await write(path.join(pkg, 'dist', 'variant-axes.json'), '{"version":2,"hosts":{}}');

    const result = await converge(OFF);

    expect(result.posting.kind).toBe('unknown');
  });

  it('a curation-only failure stays a warning: the prompt has no compliance arm, so posting is clear', async () => {
    await installAs({ curation: true, compliance: true });
    await fs.rm(installedCommand('implement'));
    await fs.mkdir(installedCommand('implement'));

    const result = await converge({ curation: false, compliance: false });

    expect(result.converged).toBe(false);
    expect(result.posting).toEqual({ kind: 'clear' });
    expect(warnings.some(w => w.includes('commands/implement.md'))).toBe(true);
    expect(await read(installedCommand('plan'))).toBe('plan BOTH-OFF\n');
  });

  it('an unreadable installed compliance-armed prompt is listed: it is not proven free of posting steps', async () => {
    await installAs({ curation: true, compliance: true });
    await fs.rm(installedCommand('release'));
    await fs.mkdir(installedCommand('release'));

    const result = await converge(OFF);

    expect(result.posting).toEqual({ kind: 'left', files: [installedCommand('release')] });
  });

  it('compliance on never reads the build manifest', async () => {
    await installAs({ curation: true, compliance: false });
    await fs.rm(path.join(pkg, 'dist', 'variant-axes.json'));

    const result = await converge({ curation: true, compliance: true });

    expect(result.converged, warnings.join('\n')).toBe(true);
    expect(result.posting).toEqual({ kind: 'clear' });
    expect(await read(installedCommand('release'))).toBe('release ON\n');
  });

  it('a relative claudeDir is refused with a warning, nothing is written, and a compliance-off machine is unknown', async () => {
    await installAs({ curation: true, compliance: true });

    const result = await convergeVariantAxes({
      claudeDir: 'relative/claude', devflowDir, manifest: stateOf(OFF), plugins: FULL_SELECTION, warn, packageRoot: pkg,
    });

    expect(result.converged).toBe(false);
    expect(result.posting.kind).toBe('unknown');
    expect(warnings[0]).toContain('not an absolute path');
    expect(await read(installedCommand('plan'))).toBe('plan ON\n');
  });

  it('the prompt converge alone answers the same question, for a caller that holds no manifest slice', async () => {
    await installAs({ curation: true, compliance: true });
    await fs.rm(complianceOffDir('commands', pkg), { recursive: true });
    await fs.rm(bothOffDir('commands', pkg), { recursive: true });

    const prompts = await convergePromptVariants({ claudeDir, switches: OFF, plugins: FULL_SELECTION, warn, packageRoot: pkg });

    expect(prompts.posting.kind).toBe('left');
  });
});

describe('describePostingLeft', () => {
  it('says nothing when posting is clear', () => {
    expect(describePostingLeft({ kind: 'clear' })).toEqual([]);
  });

  it('names every file that still posts and the remedy', () => {
    const lines = describePostingLeft({ kind: 'left', files: ['/c/commands/devflow/plan.md', '/c/commands/devflow/release.md'] });
    expect(lines[0]).toContain('2 installed prompt(s) still post');
    expect(lines[0]).toContain('plan.md');
    expect(lines[0]).toContain('release.md');
    expect(lines.join('\n')).toContain('devflow init');
  });

  it('names the cause when the files cannot be named', () => {
    const lines = describePostingLeft({ kind: 'unknown', reason: 'the variant manifest does not exist: /p/dist/variant-axes.json' });
    expect(lines.join('\n')).toContain('cannot be named');
    expect(lines.join('\n')).toContain('variant manifest');
  });
});

describe('variantToggleSkew', () => {
  it('names nothing when the versions agree, on either axis', () => {
    expect(variantToggleSkew('3.3.0', '3.3.0', 'compliance', false)).toBeNull();
    expect(variantToggleSkew('3.3.0', '3.3.0', 'curation', true)).toBeNull();
  });

  it('a compliance-off skew says that posting steps remain installed until devflow init', () => {
    const message = variantToggleSkew('3.2.0', '3.3.0', 'compliance', false) ?? '';
    expect(message).toContain('posting steps remain installed until devflow init');
    expect(message).toContain('compliance-off');
  });

  it('a compliance-on skew only says to run devflow init, with no claim about posting', () => {
    const message = variantToggleSkew('3.2.0', '3.3.0', 'compliance', true) ?? '';
    expect(message).toContain('compliance-on');
    expect(message).toContain('Run `devflow init`');
    expect(message).not.toContain('posting steps remain');
  });
});

describe('applyVariantToggle on the compliance axis (AC-27, AC-28, AC-29)', () => {
  async function writeInstallManifest(
    version: string,
    features: Record<string, unknown>,
    extra: Record<string, unknown> = {},
  ): Promise<void> {
    await write(path.join(devflowDir, 'manifest.json'), JSON.stringify({
      version,
      plugins: ['devflow-core-skills'],
      scope: 'user',
      features: { ambient: false, memory: false, hud: false, knowledge: true, curation: true, learning: true, rules: false, ...features },
      installedAt: '2026-10-10T00:00:00.000Z',
      updatedAt: '2026-10-10T00:00:00.000Z',
      ...extra,
    }));
  }

  const toggle = (enabled: boolean, runningVersion: string | null = '3.3.0') =>
    applyVariantToggle({ claudeDir, devflowDir, axis: 'compliance', enabled, runningVersion, warn, packageRoot: pkg });

  it('disable converges the compliance-armed prompts and records the installed variants after the clean converge', async () => {
    await writeInstallManifest('3.3.0', { compliance: { enabled: false, frameworks: [] } });
    await installAs({ curation: true, compliance: true });

    const outcome = await toggle(false);

    expect(outcome.kind).toBe('converged');
    if (outcome.kind !== 'converged') return;
    expect(outcome.result.converged, warnings.join('\n')).toBe(true);
    expect(await read(installedCommand('release'))).toBe('release COMPLIANCE-OFF\n');
    expect(readInstalledVariants((await readManifest(devflowDir))?.installedVariants)).toEqual({ curation: true, compliance: false });
  });

  it('enable restores the on files and records the compliance-on variant', async () => {
    await writeInstallManifest('3.3.0', { compliance: { enabled: true, frameworks: ['gdpr'] } }, { installedVariants: { curation: true, compliance: false } });
    await installAs({ curation: true, compliance: false });

    const outcome = await toggle(true);

    expect(outcome.kind).toBe('converged');
    expect(await read(installedCommand('release'))).toBe('release ON\n');
    expect(readInstalledVariants((await readManifest(devflowDir))?.installedVariants)).toEqual({ curation: true, compliance: true });
  });

  it('the record is written only after a clean converge: an unclean one leaves it as it stood', async () => {
    await writeInstallManifest('3.3.0', { compliance: { enabled: false, frameworks: [] } }, { installedVariants: { curation: true, compliance: true } });
    await installAs({ curation: true, compliance: true });
    await fs.rm(complianceOffDir('commands', pkg), { recursive: true });

    const outcome = await toggle(false);

    expect(outcome.kind).toBe('converged');
    if (outcome.kind !== 'converged') return;
    expect(outcome.result.posting.kind).toBe('left');
    expect(readInstalledVariants((await readManifest(devflowDir))?.installedVariants)).toEqual({ curation: true, compliance: true });
  });

  it('a toggle to the value already installed writes the manifest not at all', async () => {
    await writeInstallManifest('3.3.0', { compliance: { enabled: false, frameworks: [] } }, { installedVariants: { curation: true, compliance: false } });
    await installAs({ curation: true, compliance: false });
    const before = await fs.readFile(path.join(devflowDir, 'manifest.json'));

    await toggle(false);

    expect((await fs.readFile(path.join(devflowDir, 'manifest.json'))).equals(before)).toBe(true);
  });

  it('an old manifest with no record reads as unknown until a clean converge writes it', async () => {
    await writeInstallManifest('3.3.0', { compliance: { enabled: false, frameworks: [] } });
    expect(readInstalledVariants((await readManifest(devflowDir))?.installedVariants)).toBeNull();
    await installAs({ curation: true, compliance: false });

    await toggle(false);

    expect(readInstalledVariants((await readManifest(devflowDir))?.installedVariants)).toEqual({ curation: true, compliance: false });
  });

  it('a version skew converges nothing and a compliance-off skew names the posting steps', async () => {
    await writeInstallManifest('3.2.0', { compliance: { enabled: false, frameworks: [] } });
    await installAs({ curation: true, compliance: true });

    const outcome = await toggle(false);

    expect(outcome.kind).toBe('skipped');
    if (outcome.kind !== 'skipped') return;
    expect(outcome.reason).toBe('version-skew');
    expect(outcome.message).toContain('posting steps remain installed until devflow init');
    expect(await read(installedCommand('release'))).toBe('release ON\n');
    expect(readInstalledVariants((await readManifest(devflowDir))?.installedVariants)).toBeNull();
  });

  it('no manifest converges nothing and a compliance-off toggle names the posting steps', async () => {
    await installAs({ curation: true, compliance: true });

    const outcome = await toggle(false);

    expect(outcome.kind).toBe('skipped');
    if (outcome.kind !== 'skipped') return;
    expect(outcome.reason).toBe('no-manifest');
    expect(outcome.message).toContain('posting steps remain installed until devflow init');
  });

  it('known-bad probe: the other axis comes from the manifest, so a curation-off machine keeps its curation-off files', async () => {
    await writeInstallManifest('3.3.0', { curation: false, learning: false, compliance: { enabled: false, frameworks: [] } });
    await installAs({ curation: false, compliance: true });

    await toggle(false);

    expect(await read(installedCommand('plan'))).toBe('plan BOTH-OFF\n');
    expect(await read(installedCommand('implement'))).toBe('implement CURATION-OFF\n');
  });
});
