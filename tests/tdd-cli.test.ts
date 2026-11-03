/**
 * `devflow tdd --enable | --disable | --status` (#758): the machine switch for the test-first text.
 * The switch is written first, then the one converge for every axis runs and the result is
 * reported. These drive the command's core against a temp Claude dir, a temp devflow dir and a
 * temp package root, so no real HOME and no real dist/ is read or written; the built CLI is driven
 * for the registration and the flag grammar only.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'child_process';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  applyTddChange,
  readTddStatus,
  resolveTddAction,
  tddCommand,
  type ApplyTddChangeResult,
} from '../src/cli/commands/tdd.js';
import { skillsDir } from '../src/core/assets.js';
import { readInstalledVariants, variantRecordStatus } from '../src/core/installed-variants.js';
import { readManifest } from '../src/core/manifest.js';
import { requireBuiltCli, sandboxEnv, testBackups } from './helpers.js';

const RUNNING = '3.3.0';
const TDD_SKILL = 'test-driven-development';

let tmp: string;
let claudeDir: string;
let devflowDir: string;
let pkg: string;
let warnings: string[];

const warn = (msg: string): void => { warnings.push(msg); };

async function write(file: string, text: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, text, 'utf-8');
}

const exists = (file: string): Promise<boolean> => fs.stat(file).then(() => true, () => false);
const installedCode = (): string => path.join(claudeDir, 'agents', 'devflow', 'code.md');
const installedSkill = (): string => path.join(claudeDir, 'skills', `devflow:${TDD_SKILL}`);
const textOf = (result: ApplyTddChangeResult): string => [...result.messages.map(m => m.text), ...warnings].join('\n');

/**
 * A package with one tdd-armed host (the Code agent), one curation-armed command, and the two
 * gated skill folders. The converge reads the curation tree of the commands whatever the toggle.
 */
async function seedPackage(): Promise<void> {
  await write(path.join(pkg, 'dist', 'agents', 'code.md'), 'code ON\n');
  await write(path.join(pkg, 'dist', 'tdd-off', 'agents', 'code.md'), 'code TDD-OFF\n');
  await write(path.join(pkg, 'dist', 'commands', 'implement.md'), 'implement ON\n');
  await write(path.join(pkg, 'dist', 'curation-off', 'commands', 'implement.md'), 'implement CURATION-OFF\n');
  await write(path.join(skillsDir(pkg), TDD_SKILL, 'SKILL.md'), 'test-driven-development of the temp package\n');
  await write(path.join(skillsDir(pkg), 'apply-decisions', 'SKILL.md'), 'apply-decisions of the temp package\n');
  await write(path.join(pkg, 'dist', 'variant-axes.json'), JSON.stringify({
    version: 1,
    hosts: {
      'agents/code': { curation: false, compliance: false, tdd: true },
      'commands/implement': { curation: true, compliance: false, tdd: false },
    },
  }));
}

async function writeManifest(
  features: Record<string, unknown> = {},
  extra: Record<string, unknown> = {},
  version: string = RUNNING,
): Promise<void> {
  await write(path.join(devflowDir, 'manifest.json'), JSON.stringify({
    version,
    plugins: ['devflow-core-skills'],
    scope: 'user',
    features: {
      ambient: false, memory: false, hud: false, knowledge: true, curation: true, learning: true, rules: false,
      compliance: { enabled: true, frameworks: [] },
      ...features,
    },
    installedAt: '2026-10-10T00:00:00.000Z',
    updatedAt: '2026-10-10T00:00:00.000Z',
    ...extra,
  }));
}

async function installOn(): Promise<void> {
  await write(installedCode(), 'code ON\n');
  await write(path.join(claudeDir, 'commands', 'devflow', 'implement.md'), 'implement ON\n');
  await fs.cp(path.join(skillsDir(pkg), TDD_SKILL), installedSkill(), { recursive: true });
}

async function change(enabled: boolean, runningVersion: string | null = RUNNING): Promise<ApplyTddChangeResult> {
  return applyTddChange({
    claudeDir,
    devflowDir,
    enabled,
    runningVersion,
    packageRoot: pkg,
    warn,
    backups: await testBackups(tmp, { claudeDir, devflowDir }),
  });
}

const recordedSwitch = async (): Promise<boolean | undefined> => (await readManifest(devflowDir))?.features.tdd;
const recordOf = async (): Promise<unknown> => (await readManifest(devflowDir))?.installedVariants;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-tdd-cli-'));
  claudeDir = path.join(tmp, 'claude');
  devflowDir = path.join(tmp, 'devflow');
  pkg = path.join(tmp, 'pkg');
  warnings = [];
  await fs.mkdir(claudeDir, { recursive: true });
  await seedPackage();
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('resolveTddAction', () => {
  it('reads each flag as its action', () => {
    expect(resolveTddAction({ enable: true })).toEqual({ ok: true, value: 'enable' });
    expect(resolveTddAction({ disable: true })).toEqual({ ok: true, value: 'disable' });
    expect(resolveTddAction({ status: true })).toEqual({ ok: true, value: 'status' });
  });

  it('no flag is no action, so the command prints its usage', () => {
    expect(resolveTddAction({})).toEqual({ ok: true, value: null });
  });

  it('more than one flag is an error that names all three', () => {
    for (const options of [{ enable: true, disable: true }, { enable: true, status: true }, { disable: true, status: true }]) {
      const resolved = resolveTddAction(options);
      expect(resolved.ok).toBe(false);
      if (resolved.ok) continue;
      expect(resolved.error).toContain('--enable');
      expect(resolved.error).toContain('--disable');
      expect(resolved.error).toContain('--status');
    }
  });
});

describe('the tdd command flags', () => {
  it('declares exactly --enable, --disable and --status, none of them taking a value', () => {
    expect(tddCommand.options.map(option => option.long)).toEqual(['--enable', '--disable', '--status']);
    for (const option of tddCommand.options) {
      expect(option.required, `${option.long} takes a value`).toBe(false);
      expect(option.optional, `${option.long} takes an optional value`).toBe(false);
    }
  });
});

describe('applyTddChange', () => {
  it('disable records the switch, installs the tdd-off Code file, removes the skill and records the variants', async () => {
    await writeManifest();
    await installOn();

    const result = await change(false);

    expect(result.exitCode, textOf(result)).toBe(0);
    expect(await recordedSwitch()).toBe(false);
    expect(await fs.readFile(installedCode(), 'utf-8')).toBe('code TDD-OFF\n');
    expect(await exists(installedSkill())).toBe(false);
    expect(readInstalledVariants(await recordOf()), warnings.join('\n')).toEqual({ curation: true, compliance: true, tdd: false });
    expect(result.messages.some(m => m.level === 'error')).toBe(false);
    expect(textOf(result)).toContain('TDD disabled');
    expect(textOf(result)).toContain(`the ${TDD_SKILL} skill removed`);
  });

  it('enable restores the on Code file and the skill, and records the variants', async () => {
    await writeManifest({ tdd: false }, { installedVariants: { curation: true, compliance: true, tdd: false } });
    await write(installedCode(), 'code TDD-OFF\n');

    const result = await change(true);

    expect(result.exitCode, textOf(result)).toBe(0);
    expect(await recordedSwitch()).toBe(true);
    expect(await fs.readFile(installedCode(), 'utf-8')).toBe('code ON\n');
    expect(await fs.readFile(path.join(installedSkill(), 'SKILL.md'), 'utf-8')).toBe('test-driven-development of the temp package\n');
    expect(readInstalledVariants(await recordOf())).toEqual({ curation: true, compliance: true, tdd: true });
    expect(textOf(result)).toContain('TDD enabled');
  });

  it('a change to the value already installed exits 0 and reports no installed-file change', async () => {
    await writeManifest();
    await installOn();
    await change(false);

    const again = await change(false);

    expect(again.exitCode).toBe(0);
    expect(again.messages.some(m => m.text.startsWith('Installed prompts:'))).toBe(false);
    expect(await fs.readFile(installedCode(), 'utf-8')).toBe('code TDD-OFF\n');
  });

  it('a version skew converges nothing, exits 1, prints the skew message and keeps the switch recorded', async () => {
    await writeManifest({}, {}, '3.2.0');
    await installOn();

    const result = await change(false);

    expect(result.exitCode).toBe(1);
    const errors = result.messages.filter(m => m.level === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0].text).toContain('3.2.0');
    expect(errors[0].text).toContain('tdd-off');
    expect(textOf(result)).toContain('recorded as off');
    expect(await recordedSwitch(), 'the switch write is not rolled back').toBe(false);
    expect(await fs.readFile(installedCode(), 'utf-8'), 'no installed file changed').toBe('code ON\n');
    expect(await exists(installedSkill())).toBe(true);
  });

  it('an unknown running version is a skew too', async () => {
    await writeManifest();
    await installOn();

    const result = await change(false, null);

    expect(result.exitCode).toBe(1);
    expect(textOf(result)).toContain('unknown version');
    expect(await fs.readFile(installedCode(), 'utf-8')).toBe('code ON\n');
  });

  it('a manifest the reader cannot validate skips the converge, exits 1 and keeps the switch on disk', async () => {
    await write(path.join(devflowDir, 'manifest.json'), JSON.stringify({ features: {} }));
    await installOn();

    const result = await change(false);

    expect(result.exitCode).toBe(1);
    expect(textOf(result)).toContain('No readable install manifest');
    const raw = JSON.parse(await fs.readFile(path.join(devflowDir, 'manifest.json'), 'utf-8')) as { features: Record<string, unknown> };
    expect(raw.features.tdd).toBe(false);
    expect(await fs.readFile(installedCode(), 'utf-8')).toBe('code ON\n');
  });

  it('no manifest at all exits 1, says devflow is not installed and creates no manifest', async () => {
    const result = await change(false);

    expect(result.exitCode).toBe(1);
    expect(textOf(result)).toContain('not installed');
    expect(await exists(path.join(devflowDir, 'manifest.json'))).toBe(false);
  });

  it('known-bad probe: a converge that leaves the skill unconverged exits 1 and keeps the switch', async () => {
    await writeManifest({ tdd: false }, { installedVariants: { curation: true, compliance: true, tdd: false } });
    await fs.rm(path.join(skillsDir(pkg), TDD_SKILL), { recursive: true });

    const result = await change(true);

    expect(result.exitCode).toBe(1);
    expect(textOf(result)).toContain('not all converged');
    expect(warnings.some(w => w.includes(TDD_SKILL))).toBe(true);
    expect(await recordedSwitch()).toBe(true);
    expect(result.messages.some(m => m.level === 'success')).toBe(false);
  });

  it('known-bad probe: the other axes come from the manifest, so a curation-off machine keeps its curation-off state', async () => {
    await writeManifest({ curation: false, learning: false });
    await installOn();

    const result = await change(false);

    expect(result.exitCode, textOf(result)).toBe(0);
    expect(readInstalledVariants(await recordOf())).toEqual({ curation: false, compliance: true, tdd: false });
    expect(await fs.readFile(path.join(claudeDir, 'commands', 'devflow', 'implement.md'), 'utf-8')).toBe('implement CURATION-OFF\n');
    expect(await fs.readFile(installedCode(), 'utf-8')).toBe('code TDD-OFF\n');
  });
});

describe('readTddStatus', () => {
  it('no manifest is not installed', async () => {
    expect(await readTddStatus({ claudeDir, devflowDir })).toEqual({ ok: false, error: 'not-installed' });
  });

  it('a manifest from before the switch reads as on, with no record and no skill: the record is unknown', async () => {
    await writeManifest();

    expect(await readTddStatus({ claudeDir, devflowDir })).toEqual({
      ok: true,
      value: { enabled: true, skillInstalled: false, record: 'unknown' },
    });
  });

  it('an old two-boolean record reads as on, because the installed prompts of that time carried the TDD text', async () => {
    await writeManifest({}, { installedVariants: { curation: true, compliance: true } });
    await installOn();

    expect(await readTddStatus({ claudeDir, devflowDir })).toEqual({
      ok: true,
      value: { enabled: true, skillInstalled: true, record: 'on' },
    });
  });

  it('reads off, skill removed and record off after --disable', async () => {
    await writeManifest();
    await installOn();
    await change(false);

    expect(await readTddStatus({ claudeDir, devflowDir })).toEqual({
      ok: true,
      value: { enabled: false, skillInstalled: false, record: 'off' },
    });
  });

  it('a record that disagrees with the switch is a mismatch', async () => {
    await writeManifest({ tdd: false }, { installedVariants: { curation: true, compliance: true, tdd: true } });

    const status = await readTddStatus({ claudeDir, devflowDir });

    expect(status.ok && status.value.record).toBe('mismatch');
  });

  it('writes nothing', async () => {
    await writeManifest();
    const before = await fs.readFile(path.join(devflowDir, 'manifest.json'), 'utf-8');

    await readTddStatus({ claudeDir, devflowDir });

    expect(await fs.readFile(path.join(devflowDir, 'manifest.json'), 'utf-8')).toBe(before);
  });
});

describe('variantRecordStatus', () => {
  it('names the four states for any axis', () => {
    const record = { curation: true, compliance: false, tdd: true } as const;
    expect(variantRecordStatus(record, 'tdd', true)).toBe('on');
    expect(variantRecordStatus(record, 'compliance', false)).toBe('off');
    expect(variantRecordStatus(record, 'compliance', true)).toBe('mismatch');
    expect(variantRecordStatus(null, 'tdd', true)).toBe('unknown');
  });
});

describe('the built CLI', () => {
  let home: string;
  const CLI = requireBuiltCli();

  const run = (...args: string[]): { status: number | null; out: string } => {
    const result = spawnSync('node', [CLI, ...args], {
      encoding: 'utf-8',
      cwd: home,
      env: sandboxEnv(home),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (result.error) throw result.error;
    return { status: result.status, out: `${result.stdout ?? ''}${result.stderr ?? ''}` };
  };

  beforeEach(async () => {
    home = path.join(tmp, 'home');
    await fs.mkdir(path.join(home, '.claude'), { recursive: true });
  });

  it('registers the command: with no flag it prints the usage and exits 0', () => {
    const { status, out } = run('tdd');
    expect(status, out).toBe(0);
    expect(out).toContain('devflow tdd --enable | --disable | --status');
  }, 60_000);

  it('rejects two flags with exit 1 and a value on a flag with a usage error', () => {
    const both = run('tdd', '--enable', '--disable');
    expect(both.status, both.out).toBe(1);
    expect(both.out).toContain('Use only one of');

    const valued = run('tdd', '--enable=false');
    expect(valued.status, valued.out).not.toBe(0);
  }, 60_000);

  it('--status on a machine without devflow exits 1 and names devflow init', () => {
    const { status, out } = run('tdd', '--status');
    expect(status, out).toBe(1);
    expect(out).toContain('devflow init');
  }, 60_000);
});
