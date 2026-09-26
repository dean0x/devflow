/**
 * The machine-wide feature switch (D-FEATURES-MACHINE-WIDE).
 *
 * memory, learning and knowledge are switched for the whole machine by
 * `features.<x>` in ~/.devflow/manifest.json and nothing else. Only an explicit
 * boolean `false` switches a feature off — the same rule the shell hooks apply
 * in queue_read_gates — and a write touches only that one key.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  isMachineFeatureOn,
  setMachineFeature,
  readMachineFeature,
  writeMachineFeature,
} from '../../src/core/feature-switch.js';

describe('isMachineFeatureOn (pure)', () => {
  it('is off only for an explicit boolean false', () => {
    expect(isMachineFeatureOn({ features: { learning: false } }, 'learning')).toBe(false);
    expect(isMachineFeatureOn({ features: { knowledge: false } }, 'knowledge')).toBe(false);
    expect(isMachineFeatureOn({ features: { memory: false } }, 'memory')).toBe(false);
  });

  it('is on for true, a missing key, or a non-boolean value', () => {
    expect(isMachineFeatureOn({ features: { memory: true } }, 'memory')).toBe(true);
    expect(isMachineFeatureOn({ features: {} }, 'memory')).toBe(true);
    expect(isMachineFeatureOn({ features: { memory: 'false' } }, 'memory')).toBe(true);
    expect(isMachineFeatureOn({ features: { learning: 0 } }, 'learning')).toBe(true);
  });

  it('is on for anything that is not a manifest-shaped object (fail-open)', () => {
    for (const raw of [undefined, null, 42, 'x', [], { features: null }, { features: [false] }]) {
      expect(isMachineFeatureOn(raw, 'memory')).toBe(true);
    }
  });

  it('learning honours the legacy features.decisions key exactly as readManifest migrates it (D-LEARNING-LEGACY-DECISIONS)', () => {
    // learning if boolean, else decisions if boolean, else on.
    expect(isMachineFeatureOn({ features: { decisions: false } }, 'learning')).toBe(false);
    expect(isMachineFeatureOn({ features: { decisions: true } }, 'learning')).toBe(true);
    expect(isMachineFeatureOn({ features: { decisions: false, learning: true } }, 'learning')).toBe(true);
    expect(isMachineFeatureOn({ features: { decisions: true, learning: false } }, 'learning')).toBe(false);
    // A non-boolean learning is not a value, so the legacy key still decides.
    expect(isMachineFeatureOn({ features: { decisions: false, learning: 'yes' } }, 'learning')).toBe(false);
    // A non-boolean decisions decides nothing.
    expect(isMachineFeatureOn({ features: { decisions: 'false' } }, 'learning')).toBe(true);
    // The legacy key belongs to learning alone.
    expect(isMachineFeatureOn({ features: { decisions: false } }, 'memory')).toBe(true);
    expect(isMachineFeatureOn({ features: { decisions: false } }, 'knowledge')).toBe(true);
  });

  it('reads each feature independently', () => {
    const raw = { features: { learning: false, knowledge: true } };
    expect(isMachineFeatureOn(raw, 'learning')).toBe(false);
    expect(isMachineFeatureOn(raw, 'knowledge')).toBe(true);
    expect(isMachineFeatureOn(raw, 'memory')).toBe(true);
  });
});

describe('setMachineFeature (pure)', () => {
  const NOW = '2026-09-26T00:00:00.000Z';

  it('sets only the one feature and updatedAt, carrying every other key verbatim', () => {
    const raw = { version: '3.0.0', plugins: ['a'], extra: { keep: 1 }, features: { ambient: true, tracker: { provider: 'jira' } } };
    expect(setMachineFeature(raw, 'memory', false, NOW)).toEqual({
      ...raw,
      features: { ...raw.features, memory: false },
      updatedAt: NOW,
    });
  });

  it('never heals an absent sibling key (an absent learning key stays absent, i.e. on)', () => {
    const next = setMachineFeature({ features: { memory: true } }, 'memory', false, NOW);
    expect(next).not.toBeNull();
    expect((next as { features: Record<string, unknown> }).features).toEqual({ memory: false });
    expect(isMachineFeatureOn(next, 'learning')).toBe(true);
  });

  it('never mutates its input', () => {
    const raw = { features: { memory: true } };
    const snapshot = JSON.stringify(raw);
    setMachineFeature(raw, 'memory', false, NOW);
    expect(JSON.stringify(raw)).toBe(snapshot);
  });

  it('is null when there is no features record to write into', () => {
    for (const raw of [undefined, null, [], 'x', {}, { features: null }, { features: [] }]) {
      expect(setMachineFeature(raw, 'learning', true, NOW)).toBeNull();
    }
  });
});

describe('readMachineFeature / writeMachineFeature (I/O)', () => {
  let devflowDir: string;

  beforeEach(async () => {
    devflowDir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-switch-home-'));
  });

  afterEach(async () => {
    await fs.rm(devflowDir, { recursive: true, force: true });
  });

  const manifestPath = (): string => path.join(devflowDir, 'manifest.json');
  const writeManifest = (body: string) => fs.writeFile(manifestPath(), body, 'utf-8');
  const readRaw = async (): Promise<{ features: Record<string, unknown>; updatedAt?: string }> =>
    JSON.parse(await fs.readFile(manifestPath(), 'utf-8'));

  it('a missing manifest reads as on', async () => {
    expect(await readMachineFeature(devflowDir, 'memory')).toBe(true);
  });

  it('a malformed manifest reads as on', async () => {
    await writeManifest('{ not json');
    expect(await readMachineFeature(devflowDir, 'knowledge')).toBe(true);
  });

  it('reads the raw key, not a healed default — a manifest lacking the key stays on', async () => {
    // readManifest() heals an absent learning key to false; the switch must not.
    await writeManifest(JSON.stringify({ version: '1', features: { ambient: true, memory: true } }));
    expect(await readMachineFeature(devflowDir, 'learning')).toBe(true);
  });

  it('never writes the manifest on read (no heal side effect)', async () => {
    const body = JSON.stringify({ version: '1', features: { kb: false, learning: false } });
    await writeManifest(body);
    await readMachineFeature(devflowDir, 'learning');
    expect(await fs.readFile(manifestPath(), 'utf-8')).toBe(body);
  });

  it('write round-trips through read, for every feature', async () => {
    await writeManifest(JSON.stringify({ version: '1', features: { ambient: true } }));
    for (const feature of ['memory', 'learning', 'knowledge'] as const) {
      expect((await writeMachineFeature(devflowDir, feature, false)).ok).toBe(true);
      expect(await readMachineFeature(devflowDir, feature)).toBe(false);
      expect((await writeMachineFeature(devflowDir, feature, true)).ok).toBe(true);
      expect(await readMachineFeature(devflowDir, feature)).toBe(true);
    }
  });

  it('a write touches only its own key and updatedAt', async () => {
    await writeManifest(JSON.stringify({
      version: '1', plugins: ['p'], features: { ambient: false, memory: true, tracker: { provider: 'linear' } },
      updatedAt: 'old',
    }));
    await writeMachineFeature(devflowDir, 'memory', false);
    const after = await readRaw();
    expect(after.features).toEqual({ ambient: false, memory: false, tracker: { provider: 'linear' } });
    expect(after.updatedAt).not.toBe('old');
    // An absent learning key was not healed into an explicit false.
    expect('learning' in after.features).toBe(false);
  });

  it('refuses with not-installed when there is no manifest, and creates none', async () => {
    expect(await writeMachineFeature(devflowDir, 'learning', false)).toEqual({ ok: false, error: 'not-installed' });
    await expect(fs.access(manifestPath())).rejects.toThrow();
  });

  it('refuses with not-installed on a malformed manifest, leaving it byte-identical', async () => {
    await writeManifest('{ not json');
    expect(await writeMachineFeature(devflowDir, 'memory', true)).toEqual({ ok: false, error: 'not-installed' });
    expect(await fs.readFile(manifestPath(), 'utf-8')).toBe('{ not json');
  });
});
