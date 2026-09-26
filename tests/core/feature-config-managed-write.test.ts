/**
 * Every devflow write of `.devflow/config.json` — `devflow init`'s and each
 * feature toggle's — is a read-modify-write over a user-editable file
 * (D-CONFIG-PRESERVE-UNMANAGED, avoids PF-071).
 *
 * devflow owns four keys — memory, learning, knowledge, reviewPublication — and
 * nothing else. Every other key in the file (the hand-written per-repo `tracker`
 * override, a key a newer devflow or the user added) belongs to the FILE, so it
 * must survive the write byte-for-byte, carried by key presence and never by
 * type. The two retired keys devflow itself once wrote (`decisions`,
 * `autoCommit`) are the exception, and `decisions` is why: coerceConfig lets a
 * legacy `decisions` value OVERRIDE `learning`, so carrying it would silently
 * revert the learning value just written on the very next read.
 *
 * The file round trip is asserted, not only the pure merge, because PF-071's
 * lesson is that a direct call exercises an input path no user has.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';

import {
  mergeManagedConfig,
  readConfig,
  updateFeature,
  writeManagedConfig,
  type BooleanFeature,
  type ManagedConfig,
} from '../../src/core/feature-config.js';

const MANAGED: ManagedConfig = {
  memory: false,
  learning: true,
  knowledge: false,
  reviewPublication: 'off',
};

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'devflow-cfg-managed-'));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function configPath(): string {
  return path.join(tmpDir, '.devflow', 'config.json');
}

/** Write a raw `.devflow/config.json` body, bypassing every typed writer. */
function seedConfig(body: string): void {
  mkdirSync(path.join(tmpDir, '.devflow'), { recursive: true });
  writeFileSync(configPath(), body, 'utf-8');
}

function readRaw(): Record<string, unknown> {
  return JSON.parse(readFileSync(configPath(), 'utf-8')) as Record<string, unknown>;
}

describe('mergeManagedConfig: the managed keys come from init, every other key from the file', () => {
  it('keeps the tracker override and an unknown key, overwriting only the managed keys', () => {
    const existing = {
      memory: true,
      learning: false,
      knowledge: true,
      reviewPublication: 'full',
      tracker: 'jira',
      teamNote: { owner: 'platform', tags: ['a', 'b'] },
    };

    expect(mergeManagedConfig(existing, MANAGED)).toEqual({
      ...MANAGED,
      tracker: 'jira',
      teamNote: { owner: 'platform', tags: ['a', 'b'] },
    });
  });

  it.each([
    ['a number', 42],
    ['null', null],
    ['a near-miss provider', 'jira-cloud'],
    ['an empty string', ''],
  ])('carries a tracker value that is %s verbatim — by presence, never by type', (_label, value) => {
    const merged = mergeManagedConfig({ tracker: value }, MANAGED);

    expect(Object.prototype.hasOwnProperty.call(merged, 'tracker')).toBe(true);
    expect(merged.tracker).toBe(value);
  });

  it('never manufactures a tracker key the file does not hold', () => {
    const merged = mergeManagedConfig({ memory: true }, MANAGED);

    expect(Object.prototype.hasOwnProperty.call(merged, 'tracker')).toBe(false);
  });

  it('takes ONLY the managed keys from the binding — the file wins for an unmanaged key', () => {
    // A caller that hands over a whole FeatureConfig must not overwrite the
    // file's override with its in-memory copy.
    const binding = { ...MANAGED, tracker: 'github' } as ManagedConfig;

    expect(mergeManagedConfig({ tracker: 'linear' }, binding).tracker).toBe('linear');
  });

  it('drops the retired keys devflow itself once wrote', () => {
    const merged = mergeManagedConfig({ decisions: false, autoCommit: true, teamNote: 'kept' }, MANAGED);

    expect(merged).toEqual({ ...MANAGED, teamNote: 'kept' });
  });

  it.each([
    ['undefined (absent or unreadable file)', undefined],
    ['null', null],
    ['an array', [1, 2]],
    ['a string', 'config'],
    ['a number', 7],
  ])('treats %s as an empty file, as readConfigIfPresent does', (_label, existing) => {
    expect(mergeManagedConfig(existing, MANAGED)).toEqual(MANAGED);
  });

  it('returns a new object and never mutates the file value it was given', () => {
    const existing = { memory: true, tracker: 'jira' };
    const snapshot = structuredClone(existing);

    const merged = mergeManagedConfig(existing, MANAGED);

    expect(existing).toEqual(snapshot);
    expect(merged).not.toBe(existing);
  });

  it('carries a JSON `__proto__` key as data without touching any prototype', () => {
    const existing: unknown = JSON.parse('{"__proto__": {"polluted": true}}');

    const merged = mergeManagedConfig(existing, MANAGED);

    expect(Object.getPrototypeOf(merged)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(merged, '__proto__')).toBe(true);
    expect(JSON.stringify(merged)).toContain('"__proto__":{"polluted":true}');
  });
});

describe('writeManagedConfig: the read-modify-write through the file', () => {
  it('★ preserves the tracker override and an unknown key on disk', async () => {
    seedConfig(JSON.stringify({ memory: true, tracker: 'jira', teamNote: { tags: ['a'] } }));

    await writeManagedConfig(tmpDir, MANAGED);

    expect(readRaw()).toEqual({ ...MANAGED, tracker: 'jira', teamNote: { tags: ['a'] } });
    expect((await readConfig(tmpDir)).tracker).toBe('jira');
  });

  it('a legacy `decisions` key cannot revert the learning value just written', async () => {
    seedConfig(JSON.stringify({ decisions: false, learning: false }));

    await writeManagedConfig(tmpDir, { ...MANAGED, learning: true });

    expect((await readConfig(tmpDir)).learning).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(readRaw(), 'decisions')).toBe(false);
  });

  it('creates the file with only the managed keys when none exists', async () => {
    expect(existsSync(configPath())).toBe(false);

    await writeManagedConfig(tmpDir, MANAGED);

    expect(readRaw()).toEqual(MANAGED);
  });

  it('replaces a malformed file with the managed keys instead of failing', async () => {
    seedConfig('{ "tracker": "jira", ');

    await writeManagedConfig(tmpDir, MANAGED);

    expect(readRaw()).toEqual(MANAGED);
  });
});

/**
 * The write each feature-toggle command makes. `devflow memory|learning|knowledge
 * --enable|--disable` all reach the file through updateFeature with exactly
 * these arguments, so this table is every toggle's write path.
 */
const TOGGLE_WRITES: readonly { command: string; feature: BooleanFeature; enabled: boolean }[] = [
  { command: 'devflow memory --enable', feature: 'memory', enabled: true },
  { command: 'devflow memory --disable', feature: 'memory', enabled: false },
  { command: 'devflow learning --enable', feature: 'learning', enabled: true },
  { command: 'devflow learning --disable', feature: 'learning', enabled: false },
  { command: 'devflow knowledge --enable', feature: 'knowledge', enabled: true },
  { command: 'devflow knowledge --disable', feature: 'knowledge', enabled: false },
];

/** Keys devflow does not manage, seeded beside the managed ones. */
const UNMANAGED = {
  tracker: 'jira',
  teamNote: { owner: 'platform', tags: ['a', 'b'] },
  futureFlag: 42,
};

describe('updateFeature: every feature toggle keeps the keys it does not manage', () => {
  it.each(TOGGLE_WRITES)('★ $command keeps the tracker override and an unknown key on disk', async ({ feature, enabled }) => {
    // Every boolean starts opposite to the toggle, so the write is a real change.
    seedConfig(JSON.stringify({
      memory: !enabled,
      learning: !enabled,
      knowledge: !enabled,
      reviewPublication: 'full',
      ...UNMANAGED,
    }));

    await updateFeature(tmpDir, feature, enabled);

    expect(readRaw()).toEqual({
      memory: !enabled,
      learning: !enabled,
      knowledge: !enabled,
      reviewPublication: 'full',
      [feature]: enabled,
      ...UNMANAGED,
    });
  });

  it.each(TOGGLE_WRITES)('$command carries a non-string tracker value by presence', async ({ feature, enabled }) => {
    seedConfig(JSON.stringify({ tracker: null, teamNote: 'kept' }));

    await updateFeature(tmpDir, feature, enabled);

    const after = readRaw();
    expect(Object.prototype.hasOwnProperty.call(after, 'tracker')).toBe(true);
    expect(after.tracker).toBeNull();
    expect(after.teamNote).toBe('kept');
  });

  it('drops the retired keys and keeps the legacy `decisions` value as `learning`', async () => {
    // coerceConfig reads `decisions: false` as learning off; the toggle of an
    // unrelated feature must keep that meaning while dropping the retired key.
    seedConfig(JSON.stringify({ decisions: false, learning: true, autoCommit: true, teamNote: 'kept' }));

    await updateFeature(tmpDir, 'memory', false);

    const after = readRaw();
    expect(Object.prototype.hasOwnProperty.call(after, 'decisions')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(after, 'autoCommit')).toBe(false);
    expect(after).toMatchObject({ memory: false, learning: false, teamNote: 'kept' });
  });

  it('creates the file with only the managed keys when none exists', async () => {
    expect(existsSync(configPath())).toBe(false);

    await updateFeature(tmpDir, 'knowledge', false);

    expect(readRaw()).toEqual({ memory: true, learning: true, knowledge: false, reviewPublication: 'auto' });
  });

  it('replaces a malformed file with the defaults plus the toggle instead of failing', async () => {
    seedConfig('{ "teamNote": "lost", ');

    await updateFeature(tmpDir, 'learning', false);

    expect(readRaw()).toEqual({ memory: true, learning: false, knowledge: true, reviewPublication: 'auto' });
  });
});
