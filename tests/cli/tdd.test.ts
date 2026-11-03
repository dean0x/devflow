/**
 * `devflow tdd --enable | --disable | --status`: the machine TDD switch,
 * `features.tdd` in ~/.devflow/manifest.json. An absent key reads as ON, like
 * `knowledge`; only a boolean false turns it off. No repository file changes it.
 *
 * These drive the command's core against temp dirs; none touches the real HOME.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runTddSwitch, parseTddAction, tddCommand } from '../../src/cli/commands/tdd.js';
import { readMachineFeature } from '../../src/core/feature-switch.js';

let tmp: string;
let devflowDir: string;

async function writeRawManifest(features: Record<string, unknown>): Promise<void> {
  await fs.mkdir(devflowDir, { recursive: true });
  await fs.writeFile(
    path.join(devflowDir, 'manifest.json'),
    JSON.stringify({
      version: '3.4.0',
      plugins: ['devflow-core-skills'],
      scope: 'user',
      features: { ambient: true, memory: true, hud: false, knowledge: true, curation: true, learning: true, rules: true, ...features },
      installedAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }),
    'utf-8',
  );
}

async function recorded(): Promise<unknown> {
  const raw = JSON.parse(await fs.readFile(path.join(devflowDir, 'manifest.json'), 'utf-8')) as { features: Record<string, unknown> };
  return raw.features.tdd;
}

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-tdd-cli-'));
  devflowDir = path.join(tmp, '.devflow');
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('runTddSwitch', () => {
  it('--status on a manifest with no tdd key reports enabled', async () => {
    await writeRawManifest({});
    expect(await runTddSwitch({ action: 'status', devflowDir })).toEqual({ ok: true, value: { enabled: true } });
  });

  it('--status with no manifest at all reports enabled and writes nothing', async () => {
    expect(await runTddSwitch({ action: 'status', devflowDir })).toEqual({ ok: true, value: { enabled: true } });
    await expect(fs.access(path.join(devflowDir, 'manifest.json'))).rejects.toThrow();
  });

  it('--disable records an explicit false', async () => {
    await writeRawManifest({});
    expect(await runTddSwitch({ action: 'disable', devflowDir })).toEqual({ ok: true, value: { enabled: false } });
    expect(await recorded()).toBe(false);
  });

  it('--status after --disable reports disabled', async () => {
    await writeRawManifest({});
    await runTddSwitch({ action: 'disable', devflowDir });
    expect(await runTddSwitch({ action: 'status', devflowDir })).toEqual({ ok: true, value: { enabled: false } });
  });

  it('--enable after --disable records an explicit true', async () => {
    await writeRawManifest({ tdd: false });
    expect(await runTddSwitch({ action: 'enable', devflowDir })).toEqual({ ok: true, value: { enabled: true } });
    expect(await recorded()).toBe(true);
    expect(await readMachineFeature(devflowDir, 'tdd')).toBe(true);
  });

  it('--enable twice leaves the manifest bytes alone the second time', async () => {
    await writeRawManifest({});
    await runTddSwitch({ action: 'enable', devflowDir });
    const before = await fs.readFile(path.join(devflowDir, 'manifest.json'), 'utf-8');
    await runTddSwitch({ action: 'enable', devflowDir });
    expect(await fs.readFile(path.join(devflowDir, 'manifest.json'), 'utf-8')).toBe(before);
  });

  it('--enable and --disable refuse when devflow is not installed, and write nothing', async () => {
    expect(await runTddSwitch({ action: 'enable', devflowDir })).toEqual({ ok: false, error: 'not-installed' });
    expect(await runTddSwitch({ action: 'disable', devflowDir })).toEqual({ ok: false, error: 'not-installed' });
    await expect(fs.access(path.join(devflowDir, 'manifest.json'))).rejects.toThrow();
  });

  it('writes no other switch', async () => {
    await writeRawManifest({});
    await runTddSwitch({ action: 'disable', devflowDir });
    const raw = JSON.parse(await fs.readFile(path.join(devflowDir, 'manifest.json'), 'utf-8')) as { features: Record<string, unknown> };
    expect(raw.features).toMatchObject({ memory: true, knowledge: true, curation: true, learning: true, tdd: false });
  });
});

describe('the machine reading of features.tdd', () => {
  it.each([
    ['absent', {}, true],
    ['a boolean true', { tdd: true }, true],
    ['a boolean false', { tdd: false }, false],
    ['the string "false"', { tdd: 'false' }, true],
    ['the number 0', { tdd: 0 }, true],
    ['null', { tdd: null }, true],
    ['an object', { tdd: { enabled: false } }, true],
  ])('reads %s as %s', async (_label, features, expected) => {
    await writeRawManifest(features);
    expect(await readMachineFeature(devflowDir, 'tdd')).toBe(expected);
  });

  it('reads an unparseable manifest as on', async () => {
    await fs.mkdir(devflowDir, { recursive: true });
    await fs.writeFile(path.join(devflowDir, 'manifest.json'), '{ not json', 'utf-8');
    expect(await readMachineFeature(devflowDir, 'tdd')).toBe(true);
  });

  it('is not read from the legacy or sibling keys', async () => {
    await writeRawManifest({ knowledge: false, kb: false, curation: false, learning: false, memory: false });
    expect(await readMachineFeature(devflowDir, 'tdd')).toBe(true);
  });
});

describe('parseTddAction', () => {
  it.each([
    [{ enable: true }, 'enable'],
    [{ disable: true }, 'disable'],
    [{ status: true }, 'status'],
    [{}, null],
  ])('maps %j to %s', (options, expected) => {
    expect(parseTddAction(options)).toEqual({ ok: true, value: expected });
  });

  it('refuses more than one action', () => {
    expect(parseTddAction({ enable: true, disable: true })).toEqual({ ok: false, error: 'conflicting-actions' });
    expect(parseTddAction({ enable: true, status: true })).toEqual({ ok: false, error: 'conflicting-actions' });
  });

  it('counts only a boolean true as a flag', () => {
    expect(parseTddAction({ enable: 'yes' as unknown as boolean })).toEqual({ ok: true, value: null });
    expect(parseTddAction({ disable: false })).toEqual({ ok: true, value: null });
  });
});

describe('tddCommand', () => {
  it('is named tdd and offers --enable, --disable and --status', () => {
    expect(tddCommand.name()).toBe('tdd');
    expect(tddCommand.options.map(o => o.long)).toEqual(expect.arrayContaining(['--enable', '--disable', '--status']));
  });

  it('says what a switched-off TDD allows and keeps', () => {
    const help = [tddCommand.description(), ...tddCommand.options.map(o => o.description)].join('\n');
    expect(help).toContain('tests after the code');
    expect(help).toContain('the test plan and the bug-fix regression test stay');
  });
});
