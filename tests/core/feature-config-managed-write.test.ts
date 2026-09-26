/**
 * `devflow init`'s write of `.devflow/config.json` is a read-modify-write over a
 * user-editable file (D-CONFIG-PRESERVE-UNMANAGED, avoids PF-071).
 *
 * init owns four keys — memory, learning, knowledge, reviewPublication — and
 * nothing else. Every other key in the file (the hand-written per-repo `tracker`
 * override, a key a newer devflow or the user added) belongs to the FILE, so it
 * must survive the write byte-for-byte, carried by key presence and never by
 * type. The two retired keys devflow itself once wrote (`decisions`,
 * `autoCommit`) are the exception, and `decisions` is why: coerceConfig lets a
 * legacy `decisions` value OVERRIDE `learning`, so carrying it would silently
 * revert the learning value init just wrote on the very next read.
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
  writeManagedConfig,
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
