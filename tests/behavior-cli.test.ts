/**
 * `devflow behavior --enable | --disable | --status` (D-BEHAVIOR-OPT-IN): writes the
 * machine switch and converges the installed rule file at once. These drive the
 * command's core against temp dirs; the built CLI is driven in behavior-e2e.test.ts.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runBehaviorSwitch, behaviorCommand } from '../src/cli/commands/behavior.js';

let tmp: string;
let claudeDir: string;
let devflowDir: string;

const ruleFile = (): string => path.join(claudeDir, 'rules', 'devflow', 'behavior.md');
const SOURCE = path.join(import.meta.dirname, '..', 'src', 'assets', 'rules', 'behavior.md');

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

async function writeManifest(features: Record<string, unknown>): Promise<void> {
  await fs.mkdir(devflowDir, { recursive: true });
  await fs.writeFile(
    path.join(devflowDir, 'manifest.json'),
    JSON.stringify({
      version: '3.4.0',
      plugins: ['devflow-core-skills'],
      scope: 'user',
      features: { ambient: true, memory: true, hud: false, knowledge: true, learning: true, rules: true, ...features },
      installedAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }),
    'utf-8',
  );
}

async function recordedSwitch(): Promise<unknown> {
  const raw = JSON.parse(await fs.readFile(path.join(devflowDir, 'manifest.json'), 'utf-8')) as { features: Record<string, unknown> };
  return raw.features.behavior;
}

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-behavior-cli-'));
  claudeDir = path.join(tmp, '.claude');
  devflowDir = path.join(tmp, '.devflow');
  await fs.mkdir(claudeDir, { recursive: true });
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('runBehaviorSwitch', () => {
  it('--status on a fresh install reports off and not installed', async () => {
    await writeManifest({});
    const result = await runBehaviorSwitch({ action: 'status', claudeDir, devflowDir });
    expect(result).toEqual({ ok: true, value: { enabled: false, installed: false, warnings: [] } });
  });

  it('--enable records the switch and installs the file at once', async () => {
    await writeManifest({});
    const result = await runBehaviorSwitch({ action: 'enable', claudeDir, devflowDir });
    expect(result).toEqual({ ok: true, value: { enabled: true, installed: true, rulesEnabled: true, warnings: [] } });
    expect(await recordedSwitch()).toBe(true);
    expect(await fs.readFile(ruleFile(), 'utf-8')).toBe(await fs.readFile(SOURCE, 'utf-8'));
  });

  it('--status after --enable reports on and installed', async () => {
    await writeManifest({});
    await runBehaviorSwitch({ action: 'enable', claudeDir, devflowDir });
    const result = await runBehaviorSwitch({ action: 'status', claudeDir, devflowDir });
    expect(result).toEqual({ ok: true, value: { enabled: true, installed: true, warnings: [] } });
  });

  it('--disable records off and removes the file at once', async () => {
    await writeManifest({});
    await runBehaviorSwitch({ action: 'enable', claudeDir, devflowDir });
    const result = await runBehaviorSwitch({ action: 'disable', claudeDir, devflowDir });
    expect(result).toEqual({ ok: true, value: { enabled: false, installed: false, rulesEnabled: true, warnings: [] } });
    expect(await recordedSwitch()).toBe(false);
    expect(await exists(ruleFile())).toBe(false);
  });

  it('--disable leaves the other installed rules alone', async () => {
    await writeManifest({ behavior: true });
    await fs.mkdir(path.dirname(ruleFile()), { recursive: true });
    await fs.writeFile(ruleFile(), 'x', 'utf-8');
    await fs.writeFile(path.join(path.dirname(ruleFile()), 'quality.md'), 'keep', 'utf-8');
    await runBehaviorSwitch({ action: 'disable', claudeDir, devflowDir });
    expect(await fs.readFile(path.join(path.dirname(ruleFile()), 'quality.md'), 'utf-8')).toBe('keep');
  });

  it('--enable with rules off records the switch but installs no file', async () => {
    await writeManifest({ rules: false });
    const result = await runBehaviorSwitch({ action: 'enable', claudeDir, devflowDir });
    expect(result).toEqual({ ok: true, value: { enabled: true, installed: false, rulesEnabled: false, warnings: [] } });
    expect(await recordedSwitch()).toBe(true);
    expect(await exists(ruleFile())).toBe(false);
  });

  it('--enable and --disable refuse when devflow is not installed, and write nothing', async () => {
    expect(await runBehaviorSwitch({ action: 'enable', claudeDir, devflowDir })).toEqual({ ok: false, error: 'not-installed' });
    expect(await runBehaviorSwitch({ action: 'disable', claudeDir, devflowDir })).toEqual({ ok: false, error: 'not-installed' });
    expect(await exists(path.join(devflowDir, 'manifest.json'))).toBe(false);
    expect(await exists(ruleFile())).toBe(false);
  });

  it('--status works without a manifest: off, not installed', async () => {
    const result = await runBehaviorSwitch({ action: 'status', claudeDir, devflowDir });
    expect(result).toEqual({ ok: true, value: { enabled: false, installed: false, warnings: [] } });
  });

  it('--status reports a file that is installed while the switch is off (a leftover) as installed', async () => {
    await writeManifest({});
    await fs.mkdir(path.dirname(ruleFile()), { recursive: true });
    await fs.writeFile(ruleFile(), 'x', 'utf-8');
    const result = await runBehaviorSwitch({ action: 'status', claudeDir, devflowDir });
    expect(result).toEqual({ ok: true, value: { enabled: false, installed: true, warnings: [] } });
  });

  it('--enable twice is a no-op the second time', async () => {
    await writeManifest({});
    await runBehaviorSwitch({ action: 'enable', claudeDir, devflowDir });
    const before = await fs.readFile(path.join(devflowDir, 'manifest.json'), 'utf-8');
    const again = await runBehaviorSwitch({ action: 'enable', claudeDir, devflowDir });
    expect(again).toMatchObject({ ok: true, value: { enabled: true, installed: true } });
    expect(await fs.readFile(path.join(devflowDir, 'manifest.json'), 'utf-8')).toBe(before);
  });
});

describe('behaviorCommand', () => {
  it('is named behavior and offers --enable, --disable and --status', () => {
    expect(behaviorCommand.name()).toBe('behavior');
    const flags = behaviorCommand.options.map(o => o.long);
    expect(flags).toEqual(expect.arrayContaining(['--enable', '--disable', '--status']));
  });

  it('says the rule is opt-in and covers replies only', () => {
    const help = [behaviorCommand.description(), ...behaviorCommand.options.map(o => o.description)].join('\n');
    expect(help).toContain('ASD-STE100');
  });
});
