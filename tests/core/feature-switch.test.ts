/**
 * The machine-wide feature switch (D-FEATURES-NARROW-ONLY).
 *
 * memory, curation and knowledge are switched for the whole machine by
 * `features.<x>` in ~/.devflow/manifest.json; a repository can only narrow that
 * (resolve-settings.cjs, queue_read_gates), never widen it. Only an explicit
 * boolean `false` switches a feature off — the same rule the shell hooks apply
 * in queue_read_gates — and a write touches only that one key.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  isMachineFeatureOn,
  setMachineFeature,
  readMachineFeature,
  writeMachineFeature,
} from '../../src/core/feature-switch.js';
import { getManifestLockPath, MANIFEST_LOCK_STALE_MS, MANIFEST_LOCK_WAIT_MS } from '../../src/core/manifest-lock.js';

describe('isMachineFeatureOn (pure)', () => {
  it('is off only for an explicit boolean false', () => {
    expect(isMachineFeatureOn({ features: { learning: false } }, 'curation')).toBe(false);
    expect(isMachineFeatureOn({ features: { knowledge: false } }, 'knowledge')).toBe(false);
    expect(isMachineFeatureOn({ features: { memory: false } }, 'memory')).toBe(false);
  });

  it('is on for true, a missing key, or a non-boolean value', () => {
    expect(isMachineFeatureOn({ features: { memory: true } }, 'memory')).toBe(true);
    expect(isMachineFeatureOn({ features: {} }, 'memory')).toBe(true);
    expect(isMachineFeatureOn({ features: { memory: 'false' } }, 'memory')).toBe(true);
    expect(isMachineFeatureOn({ features: { learning: 0 } }, 'curation')).toBe(true);
  });

  it('is on for anything that is not a manifest-shaped object (fail-open)', () => {
    for (const raw of [undefined, null, 42, 'x', [], { features: null }, { features: [false] }]) {
      expect(isMachineFeatureOn(raw, 'memory')).toBe(true);
    }
  });

  it('the curation switch honours the legacy features.decisions key exactly as readManifest migrates it (D-LEARNING-LEGACY-DECISIONS)', () => {
    // the legacy `learning` key if boolean, else `decisions` if boolean, else on.
    expect(isMachineFeatureOn({ features: { decisions: false } }, 'curation')).toBe(false);
    expect(isMachineFeatureOn({ features: { decisions: true } }, 'curation')).toBe(true);
    expect(isMachineFeatureOn({ features: { decisions: false, learning: true } }, 'curation')).toBe(true);
    expect(isMachineFeatureOn({ features: { decisions: true, learning: false } }, 'curation')).toBe(false);
    // A non-boolean `learning` key is not a value, so the legacy `decisions` key still decides.
    expect(isMachineFeatureOn({ features: { decisions: false, learning: 'yes' } }, 'curation')).toBe(false);
    // A non-boolean decisions decides nothing.
    expect(isMachineFeatureOn({ features: { decisions: 'false' } }, 'curation')).toBe(true);
    // The legacy key belongs to the curation switch alone.
    expect(isMachineFeatureOn({ features: { decisions: false } }, 'memory')).toBe(true);
    expect(isMachineFeatureOn({ features: { decisions: false } }, 'knowledge')).toBe(true);
  });

  it('knowledge honours the legacy features.kb key exactly as readManifest migrates it (D-KNOWLEDGE-LEGACY-KB)', () => {
    // knowledge if boolean, else kb if boolean, else on.
    expect(isMachineFeatureOn({ features: { kb: false } }, 'knowledge')).toBe(false);
    expect(isMachineFeatureOn({ features: { kb: true } }, 'knowledge')).toBe(true);
    expect(isMachineFeatureOn({ features: { kb: false, knowledge: true } }, 'knowledge')).toBe(true);
    expect(isMachineFeatureOn({ features: { kb: true, knowledge: false } }, 'knowledge')).toBe(false);
    // A non-boolean knowledge is not a value, so the legacy key still decides.
    expect(isMachineFeatureOn({ features: { kb: false, knowledge: 'yes' } }, 'knowledge')).toBe(false);
    // A non-boolean kb decides nothing.
    expect(isMachineFeatureOn({ features: { kb: 'false' } }, 'knowledge')).toBe(true);
    // The legacy key belongs to knowledge alone.
    expect(isMachineFeatureOn({ features: { kb: false } }, 'memory')).toBe(true);
    expect(isMachineFeatureOn({ features: { kb: false } }, 'curation')).toBe(true);
  });

  it('reads each feature independently', () => {
    const raw = { features: { learning: false, knowledge: true } };
    expect(isMachineFeatureOn(raw, 'curation')).toBe(false);
    expect(isMachineFeatureOn(raw, 'knowledge')).toBe(true);
    expect(isMachineFeatureOn(raw, 'memory')).toBe(true);
  });

  describe('the curation key beside the legacy learning key: false wins (TP-10, readers half)', () => {
    // Every cell of the grid: curation x the legacy learning key in {absent, true, false, non-boolean}.
    // The machine switch is off when either current key is a boolean false, on when
    // either is a boolean true and neither is false, and a non-boolean value is
    // ignored for that key only.
    type Cell = 'absent' | 'true' | 'false' | 'text';
    const CELLS: readonly Cell[] = ['absent', 'true', 'false', 'text'];
    const entry = (key: string, cell: Cell): Record<string, unknown> => {
      if (cell === 'absent') return {};
      return { [key]: cell === 'text' ? 'false' : cell === 'true' };
    };
    const featuresOf = (curation: Cell, legacy: Cell): Record<string, unknown> => ({
      ...entry('curation', curation),
      ...entry('learning', legacy),
    });

    for (const curation of CELLS) {
      for (const legacy of CELLS) {
        it(`curation ${curation} x legacy learning key ${legacy}`, () => {
          const booleans = [curation, legacy].filter((c) => c === 'true' || c === 'false');
          const expected = booleans.length === 0 ? true : !booleans.includes('false');
          expect(isMachineFeatureOn({ features: featuresOf(curation, legacy) }, 'curation')).toBe(expected);
        });
      }
    }

    it('a disagreeing pair resolves to off, in either direction', () => {
      expect(isMachineFeatureOn({ features: { curation: true, learning: false } }, 'curation')).toBe(false);
      expect(isMachineFeatureOn({ features: { curation: false, learning: true } }, 'curation')).toBe(false);
    });

    it('the pre-rename decisions key is read only when neither current key is a boolean', () => {
      expect(isMachineFeatureOn({ features: { decisions: false } }, 'curation')).toBe(false);
      expect(isMachineFeatureOn({ features: { curation: 'x', decisions: false } }, 'curation')).toBe(false);
      expect(isMachineFeatureOn({ features: { curation: 'x', learning: 7, decisions: false } }, 'curation')).toBe(false);
      expect(isMachineFeatureOn({ features: { curation: true, decisions: false } }, 'curation')).toBe(true);
      expect(isMachineFeatureOn({ features: { learning: true, decisions: false } }, 'curation')).toBe(true);
      expect(isMachineFeatureOn({ features: { curation: true, learning: true, decisions: false } }, 'curation')).toBe(true);
      expect(isMachineFeatureOn({ features: { curation: false, decisions: true } }, 'curation')).toBe(false);
      expect(isMachineFeatureOn({ features: { decisions: 'false' } }, 'curation')).toBe(true);
    });

    it('the curation key belongs to the curation switch alone', () => {
      expect(isMachineFeatureOn({ features: { curation: false } }, 'memory')).toBe(true);
      expect(isMachineFeatureOn({ features: { curation: false } }, 'knowledge')).toBe(true);
    });

    it('knowledge and memory read exactly as before', () => {
      expect(isMachineFeatureOn({ features: { knowledge: true, kb: false } }, 'knowledge')).toBe(true);
      expect(isMachineFeatureOn({ features: { kb: false } }, 'knowledge')).toBe(false);
      expect(isMachineFeatureOn({ features: { memory: false } }, 'memory')).toBe(false);
    });

    it('anything that is not a manifest-shaped object still reads as on', () => {
      for (const raw of [undefined, null, 42, [], { features: null }, { features: [false] }, { features: 'curation' }]) {
        expect(isMachineFeatureOn(raw, 'curation')).toBe(true);
      }
    });
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

  it('never heals an absent sibling key (an absent curation key stays absent, i.e. on)', () => {
    const next = setMachineFeature({ features: { memory: true } }, 'memory', false, NOW);
    expect(next).not.toBeNull();
    expect((next as { features: Record<string, unknown> }).features).toEqual({ memory: false });
    expect(isMachineFeatureOn(next, 'curation')).toBe(true);
  });

  describe('the curation feature writes both current keys (the manifest mirror, TP-11)', () => {
    it.each([true, false])('curation=%s sets curation and the legacy learning key to the same value and nothing else', (value) => {
      const raw = { version: '3.0.0', features: { ambient: true, memory: true } };
      const next = setMachineFeature(raw, 'curation', value, NOW) as { features: Record<string, unknown>; updatedAt: string };
      expect(next.features).toEqual({ ambient: true, memory: true, curation: value, learning: value });
      expect(next.updatedAt).toBe(NOW);
    });

    it('overwrites a disagreeing pair with the requested value in both keys', () => {
      const raw = { features: { curation: true, learning: false } };
      const next = setMachineFeature(raw, 'curation', true, NOW) as { features: Record<string, unknown> };
      expect(next.features).toEqual({ curation: true, learning: true });
      expect(isMachineFeatureOn(next, 'curation')).toBe(true);
    });

    it('leaves a pre-rename decisions key in place, inert under the booleans just written', () => {
      const next = setMachineFeature({ features: { decisions: false } }, 'curation', true, NOW) as { features: Record<string, unknown> };
      expect(next.features).toEqual({ decisions: false, curation: true, learning: true });
      expect(isMachineFeatureOn(next, 'curation')).toBe(true);
    });

    it('memory and knowledge still write one key', () => {
      expect((setMachineFeature({ features: {} }, 'memory', false, NOW) as { features: unknown }).features).toEqual({ memory: false });
      expect((setMachineFeature({ features: {} }, 'knowledge', false, NOW) as { features: unknown }).features).toEqual({ knowledge: false });
    });
  });

  it('never mutates its input', () => {
    const raw = { features: { memory: true } };
    const snapshot = JSON.stringify(raw);
    setMachineFeature(raw, 'memory', false, NOW);
    expect(JSON.stringify(raw)).toBe(snapshot);
  });

  it('is null when there is no features record to write into', () => {
    for (const raw of [undefined, null, [], 'x', {}, { features: null }, { features: [] }]) {
      expect(setMachineFeature(raw, 'curation', true, NOW)).toBeNull();
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

  it('a manifest holding only the legacy kb:false reads knowledge as off', async () => {
    await writeManifest(JSON.stringify({ version: '1', features: { ambient: true, kb: false } }));
    expect(await readMachineFeature(devflowDir, 'knowledge')).toBe(false);
  });

  it('a malformed manifest reads as on', async () => {
    await writeManifest('{ not json');
    expect(await readMachineFeature(devflowDir, 'knowledge')).toBe(true);
  });

  it('reads the raw key, not a healed default — a manifest lacking the key stays on', async () => {
    // A manifest lacking the key reads on: the switch never applies a healed default.
    await writeManifest(JSON.stringify({ version: '1', features: { ambient: true, memory: true } }));
    expect(await readMachineFeature(devflowDir, 'curation')).toBe(true);
  });

  it('never writes the manifest on read (no heal side effect)', async () => {
    const body = JSON.stringify({ version: '1', features: { kb: false, learning: false } });
    await writeManifest(body);
    await readMachineFeature(devflowDir, 'curation');
    expect(await fs.readFile(manifestPath(), 'utf-8')).toBe(body);
  });

  it('a manifest holding a disagreeing curation key and legacy learning key pair reads off, and a read writes nothing (TP-10)', async () => {
    const body = JSON.stringify({ version: '1', features: { curation: true, learning: false } });
    await writeManifest(body);
    expect(await readMachineFeature(devflowDir, 'curation')).toBe(false);
    expect(await fs.readFile(manifestPath(), 'utf-8')).toBe(body);
  });

  it('a manifest holding only curation:false reads curation as off', async () => {
    await writeManifest(JSON.stringify({ version: '1', features: { ambient: true, curation: false } }));
    expect(await readMachineFeature(devflowDir, 'curation')).toBe(false);
  });

  it('write round-trips through read, for every feature', async () => {
    await writeManifest(JSON.stringify({ version: '1', features: { ambient: true } }));
    for (const feature of ['memory', 'curation', 'knowledge'] as const) {
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
    // An absent curation switch was not healed into an explicit false.
    expect('curation' in after.features).toBe(false);
    expect('learning' in after.features).toBe(false);
  });

  describe('a toggle to the value the manifest already records leaves it untouched (D-NOOP-TOGGLE)', () => {
    // Compact, one-line JSON: a rewrite would re-indent it, so equal bytes prove no write happened.
    const recorded = (features: Record<string, unknown>): string =>
      JSON.stringify({ version: '1', plugins: ['p'], features, updatedAt: 'old' });

    it.each([
      ['memory', true], ['memory', false],
      ['curation', true], ['curation', false],
      ['knowledge', true], ['knowledge', false],
    ] as const)('%s=%s: writeMachineFeature to the same value leaves the manifest byte-identical', async (feature, value) => {
      // The curation switch is recorded in both current keys; a no-op needs both to hold the value.
      const body = recorded({ ambient: true, [feature]: value, ...(feature === 'curation' ? { learning: value } : {}) });
      await writeManifest(body);

      expect(await writeMachineFeature(devflowDir, feature, value)).toEqual({ ok: true, value: undefined });

      expect(await fs.readFile(manifestPath(), 'utf-8')).toBe(body);
    });

    it('a different value is still written to both keys, and refreshes updatedAt', async () => {
      await writeManifest(recorded({ curation: true, learning: true }));
      await writeMachineFeature(devflowDir, 'curation', false);
      const after = await readRaw();
      expect(after.features).toEqual({ curation: false, learning: false });
      expect(after.updatedAt).not.toBe('old');
    });

    it('an absent key is not "already recorded": the explicit value is written to both keys', async () => {
      await writeManifest(recorded({ ambient: true }));
      await writeMachineFeature(devflowDir, 'curation', true);
      expect((await readRaw()).features).toEqual({ ambient: true, curation: true, learning: true });
    });

    it('a manifest holding only the legacy learning key is not "already recorded": the curation key is added', async () => {
      await writeManifest(recorded({ learning: false }));
      await writeMachineFeature(devflowDir, 'curation', false);
      expect((await readRaw()).features).toEqual({ curation: false, learning: false });
    });

    it('a disagreeing pair is not "already recorded" for either value: both keys are rewritten (TP-10)', async () => {
      for (const value of [true, false]) {
        await writeManifest(recorded({ curation: true, learning: false }));
        expect(await writeMachineFeature(devflowDir, 'curation', value)).toEqual({ ok: true, value: undefined });
        const after = await readRaw();
        expect(after.features).toEqual({ curation: value, learning: value });
        expect(after.updatedAt).not.toBe('old');
      }
    });

    it('a legacy key is not "already recorded" either: decisions:false then --disable writes both current keys false', async () => {
      await writeManifest(recorded({ decisions: false }));
      await writeMachineFeature(devflowDir, 'curation', false);
      expect((await readRaw()).features).toEqual({ decisions: false, curation: false, learning: false });
    });

    it('a manifest with the pair equal and a stale decisions key is already recorded: nothing is written', async () => {
      const body = recorded({ decisions: true, curation: false, learning: false });
      await writeManifest(body);
      await writeMachineFeature(devflowDir, 'curation', false);
      expect(await fs.readFile(manifestPath(), 'utf-8')).toBe(body);
    });

    it('a non-boolean value is not "already recorded": it is replaced by the boolean', async () => {
      await writeManifest(recorded({ memory: 'true' }));
      await writeMachineFeature(devflowDir, 'memory', true);
      expect((await readRaw()).features).toEqual({ memory: true });
    });

    it('still refuses with not-installed when the manifest is not manifest-shaped, whatever the value', async () => {
      await writeManifest('{ not json');
      expect(await writeMachineFeature(devflowDir, 'curation', true)).toEqual({ ok: false, error: 'not-installed' });
      expect(await writeMachineFeature(devflowDir, 'curation', false)).toEqual({ ok: false, error: 'not-installed' });
    });
  });

  it('refuses with not-installed when there is no manifest, and creates none', async () => {
    expect(await writeMachineFeature(devflowDir, 'curation', false)).toEqual({ ok: false, error: 'not-installed' });
    await expect(fs.access(manifestPath())).rejects.toThrow();
  });

  it('refuses with not-installed on a malformed manifest, leaving it byte-identical', async () => {
    await writeManifest('{ not json');
    expect(await writeMachineFeature(devflowDir, 'memory', true)).toEqual({ ok: false, error: 'not-installed' });
    expect(await fs.readFile(manifestPath(), 'utf-8')).toBe('{ not json');
  });

  describe('a toggle writes under the manifest lock (no lost update against the heal)', () => {
    const lockDir = (): string => getManifestLockPath(devflowDir);
    const enabledBody = (): string => JSON.stringify({ features: { curation: true, learning: true } });
    const exists = async (p: string): Promise<boolean> => fs.stat(p).then(() => true, () => false);

    it('waits for a lock another writer holds, and writes only after it is released', async () => {
      await writeManifest(enabledBody());
      await fs.mkdir(lockDir());

      const toggled = writeMachineFeature(devflowDir, 'curation', false);
      await new Promise((resolve) => setTimeout(resolve, 200));
      // Still waiting: nothing is written while the other writer holds the lock.
      expect((await readRaw()).features).toEqual({ curation: true, learning: true });

      await fs.rmdir(lockDir());
      expect(await toggled).toEqual({ ok: true, value: undefined });
      expect((await readRaw()).features).toEqual({ curation: false, learning: false });
    });

    it('breaks a lock a dead process left behind, and writes', async () => {
      await writeManifest(enabledBody());
      await fs.mkdir(lockDir());
      const old = new Date(Date.now() - 10 * MANIFEST_LOCK_STALE_MS);
      await fs.utimes(lockDir(), old, old);

      expect(await writeMachineFeature(devflowDir, 'curation', false)).toEqual({ ok: true, value: undefined });
      expect((await readRaw()).features).toEqual({ curation: false, learning: false });
      expect(await exists(lockDir())).toBe(false);
    });

    it('leaves no lock behind after a write, a no-op or a refusal', async () => {
      await writeManifest(enabledBody());
      await writeMachineFeature(devflowDir, 'curation', false);
      await writeMachineFeature(devflowDir, 'curation', false);
      await writeMachineFeature(devflowDir, 'curation', true);
      expect(await exists(lockDir())).toBe(false);
      await fs.rm(manifestPath());
      await writeMachineFeature(devflowDir, 'curation', true);
      expect(await exists(lockDir())).toBe(false);
    });

    it('two toggles at once end with one value in both keys', async () => {
      await writeManifest(enabledBody());
      await Promise.all([
        writeMachineFeature(devflowDir, 'curation', false),
        writeMachineFeature(devflowDir, 'curation', true),
        writeMachineFeature(devflowDir, 'curation', false),
      ]);
      const { features } = await readRaw();
      expect(features.curation).toBe(features.learning);
      expect(typeof features.curation).toBe('boolean');
    });

    it('goes ahead without the lock when the wait ends and the lock cannot be broken', async () => {
      await writeManifest(enabledBody());
      // A stale lock whose directory cannot be moved: the wait runs out.
      await fs.mkdir(lockDir());
      const old = new Date(Date.now() - 10 * MANIFEST_LOCK_STALE_MS);
      await fs.utimes(lockDir(), old, old);
      const realRename = fs.rename.bind(fs);
      vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
        if (String(from) === lockDir()) throw Object.assign(new Error('not permitted'), { code: 'EPERM' });
        return realRename(from, to);
      });

      vi.useFakeTimers({ toFake: ['setTimeout'] });
      try {
        let settled = false;
        const toggled = writeMachineFeature(devflowDir, 'curation', false).finally(() => { settled = true; });
        // Each try ends in one 25 ms sleep. Let real file I/O run until that sleep is
        // set, then move the fake clock past it. Bounded, so a hang fails the test.
        const maxSleeps = Math.ceil(MANIFEST_LOCK_WAIT_MS / 25) * 2;
        for (let sleeps = 0; sleeps < maxSleeps && !settled; sleeps++) {
          for (let turn = 0; turn < 200 && !settled && vi.getTimerCount() === 0; turn++) {
            await fs.stat(devflowDir);
            await new Promise((resolve) => setImmediate(resolve));
          }
          await vi.advanceTimersByTimeAsync(25);
        }
        expect(settled).toBe(true);
        expect(await toggled).toEqual({ ok: true, value: undefined });
      } finally {
        vi.useRealTimers();
      }
      expect((await readRaw()).features).toEqual({ curation: false, learning: false });
    });
  });
});
