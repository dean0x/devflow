/**
 * The behavior rule is an OPT-IN machine switch (D-BEHAVIOR-OPT-IN): `features.behavior`
 * in ~/.devflow/manifest.json, default OFF. The memory, learning and knowledge switches
 * read an absent key as ON; this one reads it as OFF, and a malformed value heals to OFF
 * without making the manifest read as missing.
 *
 * All tests use temp dirs; none touches the real HOME.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  isOptInFeatureOn,
  readOptInFeature,
  writeMachineFeature,
  isMachineFeatureOn,
} from '../src/core/feature-switch.js';
import { readManifest } from '../src/core/manifest.js';

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-behavior-switch-'));
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

/** A manifest readManifest accepts, with `features` overridden by the caller. */
function manifestWith(features: Record<string, unknown>): Record<string, unknown> {
  return {
    version: '3.4.0',
    plugins: ['devflow-core-skills'],
    scope: 'user',
    features: { ambient: true, memory: true, hud: false, knowledge: true, curation: true, learning: true, rules: true, ...features },
    installedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

async function writeRaw(body: unknown): Promise<void> {
  await fs.writeFile(path.join(tmp, 'manifest.json'), typeof body === 'string' ? body : JSON.stringify(body), 'utf-8');
}

async function readRaw(): Promise<{ features: Record<string, unknown>; updatedAt: string }> {
  return JSON.parse(await fs.readFile(path.join(tmp, 'manifest.json'), 'utf-8')) as {
    features: Record<string, unknown>;
    updatedAt: string;
  };
}

describe('isOptInFeatureOn (default OFF)', () => {
  it('reads only an explicit boolean true as on', () => {
    expect(isOptInFeatureOn(manifestWith({ behavior: true }), 'behavior')).toBe(true);
  });

  it.each([
    ['an explicit false', manifestWith({ behavior: false })],
    ['an absent key', manifestWith({})],
    ['the string "true"', manifestWith({ behavior: 'true' })],
    ['the number 1', manifestWith({ behavior: 1 })],
    ['null', manifestWith({ behavior: null })],
    ['an object', manifestWith({ behavior: { enabled: true } })],
    ['no features record', { version: '3.4.0' }],
    ['a non-object manifest', 'garbage'],
    ['null', null],
    ['undefined', undefined],
  ])('reads %s as off', (_label, raw) => {
    expect(isOptInFeatureOn(raw, 'behavior')).toBe(false);
  });

  it('is the opposite default of the fail-open machine switches', () => {
    const absent = manifestWith({});
    expect(isMachineFeatureOn(absent, 'knowledge')).toBe(true);
    expect(isOptInFeatureOn(absent, 'behavior')).toBe(false);
  });
});

describe('readOptInFeature', () => {
  it('reads off when the manifest is absent', async () => {
    expect(await readOptInFeature(tmp, 'behavior')).toBe(false);
  });

  it('reads off when the manifest is not JSON', async () => {
    await writeRaw('{ not json');
    expect(await readOptInFeature(tmp, 'behavior')).toBe(false);
  });

  it('reads the recorded boolean', async () => {
    await writeRaw(manifestWith({ behavior: true }));
    expect(await readOptInFeature(tmp, 'behavior')).toBe(true);
  });
});

describe('writeMachineFeature for the opt-in switch', () => {
  it('records the boolean and moves updatedAt', async () => {
    await writeRaw(manifestWith({}));
    const result = await writeMachineFeature(tmp, 'behavior', true);
    expect(result).toEqual({ ok: true, value: undefined });
    const after = await readRaw();
    expect(after.features.behavior).toBe(true);
    expect(after.updatedAt).not.toBe('2026-01-01T00:00:00.000Z');
  });

  it('writes nothing when the manifest already records that value (D-NOOP-TOGGLE)', async () => {
    await writeRaw(manifestWith({ behavior: false }));
    const before = await fs.readFile(path.join(tmp, 'manifest.json'), 'utf-8');
    expect(await writeMachineFeature(tmp, 'behavior', false)).toEqual({ ok: true, value: undefined });
    expect(await fs.readFile(path.join(tmp, 'manifest.json'), 'utf-8')).toBe(before);
  });

  it('writes the explicit false over an absent key, because absence is not a recorded value', async () => {
    await writeRaw(manifestWith({}));
    await writeMachineFeature(tmp, 'behavior', false);
    expect((await readRaw()).features.behavior).toBe(false);
  });

  it('refuses with not-installed when there is no manifest', async () => {
    expect(await writeMachineFeature(tmp, 'behavior', true)).toEqual({ ok: false, error: 'not-installed' });
    await expect(fs.access(path.join(tmp, 'manifest.json'))).rejects.toThrow();
  });

  it('carries every other key verbatim', async () => {
    await writeRaw({ ...manifestWith({ proxy: true }), futureKey: { a: 1 } });
    await writeMachineFeature(tmp, 'behavior', true);
    const after = (await readRaw()) as unknown as Record<string, unknown>;
    expect(after.futureKey).toEqual({ a: 1 });
    expect((after.features as Record<string, unknown>).proxy).toBe(true);
  });
});

describe('readManifest and features.behavior', () => {
  it('reads an absent key as off, and does not heal the file for it', async () => {
    await writeRaw(manifestWith({}));
    const before = await fs.readFile(path.join(tmp, 'manifest.json'), 'utf-8');
    const manifest = await readManifest(tmp);
    expect(manifest?.features.behavior).toBe(false);
    expect(await fs.readFile(path.join(tmp, 'manifest.json'), 'utf-8')).toBe(before);
  });

  it('keeps a recorded true', async () => {
    await writeRaw(manifestWith({ behavior: true }));
    expect((await readManifest(tmp))?.features.behavior).toBe(true);
  });

  it('keeps a recorded false', async () => {
    await writeRaw(manifestWith({ behavior: false }));
    expect((await readManifest(tmp))?.features.behavior).toBe(false);
  });

  it.each([['"yes"', 'yes'], ['1', 1], ['null', null], ['an object', { on: true }]])(
    'heals a malformed value (%s) to off on disk, and the manifest still reads',
    async (_label, bad) => {
      await writeRaw(manifestWith({ behavior: bad }));
      const manifest = await readManifest(tmp);
      expect(manifest, 'a malformed behavior value must not make the manifest read as missing').not.toBeNull();
      expect(manifest?.features.behavior).toBe(false);
      expect(manifest?.features.knowledge).toBe(true);
      expect((await readRaw()).features.behavior).toBe(false);
    },
  );
});
