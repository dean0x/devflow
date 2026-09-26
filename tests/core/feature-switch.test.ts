/**
 * The machine-wide feature switch (D-LEARNING-MASTER-SWITCH, D-KNOWLEDGE-MASTER-SWITCH).
 *
 * `devflow init` records learning/knowledge in ~/.devflow/manifest.json; a repo's
 * .devflow/config.json can additionally turn a feature off for that repo only. A
 * feature is effective in a repo iff BOTH allow it, and only an explicit boolean
 * `false` in the manifest switches it off — the same rule the shell hooks apply.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  isMachineSwitchOn,
  readMachineSwitch,
  combineFeatureSwitch,
  readFeatureSwitchState,
} from '../../src/core/feature-switch.js';

describe('isMachineSwitchOn (pure)', () => {
  it('is off only for an explicit boolean false', () => {
    expect(isMachineSwitchOn({ features: { learning: false } }, 'learning')).toBe(false);
    expect(isMachineSwitchOn({ features: { knowledge: false } }, 'knowledge')).toBe(false);
  });

  it('is on for true, a missing key, or a non-boolean value', () => {
    expect(isMachineSwitchOn({ features: { learning: true } }, 'learning')).toBe(true);
    expect(isMachineSwitchOn({ features: {} }, 'learning')).toBe(true);
    expect(isMachineSwitchOn({ features: { learning: 'false' } }, 'learning')).toBe(true);
    expect(isMachineSwitchOn({ features: { learning: 0 } }, 'learning')).toBe(true);
  });

  it('is on for anything that is not a manifest-shaped object (fail-open)', () => {
    for (const raw of [undefined, null, 42, 'x', [], { features: null }, { features: [false] }]) {
      expect(isMachineSwitchOn(raw, 'learning')).toBe(true);
    }
  });

  it('reads each feature independently', () => {
    const raw = { features: { learning: false, knowledge: true } };
    expect(isMachineSwitchOn(raw, 'learning')).toBe(false);
    expect(isMachineSwitchOn(raw, 'knowledge')).toBe(true);
  });
});

describe('combineFeatureSwitch (pure)', () => {
  it('is effective only when both the machine and the repo allow it', () => {
    expect(combineFeatureSwitch(true, true)).toEqual({ machineWide: true, repo: true, effective: true });
    expect(combineFeatureSwitch(false, true)).toEqual({ machineWide: false, repo: true, effective: false });
    expect(combineFeatureSwitch(true, false)).toEqual({ machineWide: true, repo: false, effective: false });
    expect(combineFeatureSwitch(false, false)).toEqual({ machineWide: false, repo: false, effective: false });
  });
});

describe('readMachineSwitch / readFeatureSwitchState (I/O)', () => {
  let devflowDir: string;
  let repo: string;

  beforeEach(async () => {
    devflowDir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-switch-home-'));
    repo = await fs.mkdtemp(path.join(os.tmpdir(), 'df-switch-repo-'));
  });

  afterEach(async () => {
    await fs.rm(devflowDir, { recursive: true, force: true });
    await fs.rm(repo, { recursive: true, force: true });
  });

  const writeManifest = (body: string) => fs.writeFile(path.join(devflowDir, 'manifest.json'), body, 'utf-8');
  const writeRepoConfig = async (body: Record<string, unknown>) => {
    await fs.mkdir(path.join(repo, '.devflow'), { recursive: true });
    await fs.writeFile(path.join(repo, '.devflow', 'config.json'), JSON.stringify(body), 'utf-8');
  };

  it('a missing manifest reads as on', async () => {
    expect(await readMachineSwitch(devflowDir, 'learning')).toBe(true);
  });

  it('a malformed manifest reads as on', async () => {
    await writeManifest('{ not json');
    expect(await readMachineSwitch(devflowDir, 'knowledge')).toBe(true);
  });

  it('reads the raw key, not a healed default — a manifest lacking the key stays on', async () => {
    // readManifest() heals an absent learning key to false; the switch must not.
    await writeManifest(JSON.stringify({ version: '1', features: { ambient: true, memory: true } }));
    expect(await readMachineSwitch(devflowDir, 'learning')).toBe(true);
  });

  it('never writes the manifest (no heal side effect)', async () => {
    const body = JSON.stringify({ version: '1', features: { kb: false, learning: false } });
    await writeManifest(body);
    await readMachineSwitch(devflowDir, 'learning');
    expect(await fs.readFile(path.join(devflowDir, 'manifest.json'), 'utf-8')).toBe(body);
  });

  it('state: machine off wins over a repo that says true', async () => {
    await writeManifest(JSON.stringify({ features: { learning: false } }));
    await writeRepoConfig({ learning: true });
    expect(await readFeatureSwitchState(devflowDir, repo, 'learning')).toEqual({
      machineWide: false, repo: true, effective: false,
    });
  });

  it('state: a repo with no config follows the machine switch', async () => {
    await writeManifest(JSON.stringify({ features: { knowledge: true } }));
    expect(await readFeatureSwitchState(devflowDir, repo, 'knowledge')).toEqual({
      machineWide: true, repo: true, effective: true,
    });
  });

  it('state: a repo that turned the feature off stays off under a machine-wide on', async () => {
    await writeManifest(JSON.stringify({ features: { knowledge: true } }));
    await writeRepoConfig({ knowledge: false });
    expect(await readFeatureSwitchState(devflowDir, repo, 'knowledge')).toEqual({
      machineWide: true, repo: false, effective: false,
    });
  });
});
