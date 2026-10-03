/**
 * devflow's write of `.devflow/config.json` — `devflow init`'s — is a
 * read-modify-write over a user-editable file (D-CONFIG-PRESERVE-UNMANAGED).
 *
 * devflow owns one key — reviewPublication — and nothing else. Every other key
 * in the file (the hand-written per-repo `tracker` override, a key a newer
 * devflow or the user added) belongs to the FILE, so it must survive the write
 * byte-for-byte, carried by key presence and never by type — the personal
 * `features` narrowing object included (D-FEATURES-NARROW-ONLY). The keys devflow
 * itself once wrote and has retired are the exception: the TOP-LEVEL `memory`,
 * `learning` and `knowledge` (per-repo switches of the per-repo-install era),
 * `decisions` and `autoCommit`. Carrying them would leave a stale
 * `learning: false` in the file that no longer does what it says, so the write
 * drops them.
 *
 * The file round trip is asserted, not only the pure merge, because a direct
 * call exercises an input path no user has.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync, symlinkSync, lstatSync, readlinkSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';

import {
  classifyConfigBytes,
  mergeManagedConfig,
  readConfig,
  readConfigIfPresent,
  writeManagedConfig,
  type ManagedConfig,
} from '../../src/core/feature-config.js';
import { loadProjectConfigLib, type ProjectConfigLib } from '../../src/core/evidence-policy.js';

const MANAGED: ManagedConfig = {
  reviewPublication: 'off',
};

/** Every key devflow once wrote to this file and has retired. */
const RETIRED = { memory: false, learning: false, knowledge: true, decisions: false, autoCommit: true };

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
  it('keeps the tracker override and an unknown key, overwriting only the managed key', () => {
    const existing = {
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
    const merged = mergeManagedConfig({ reviewPublication: 'full' }, MANAGED);

    expect(Object.prototype.hasOwnProperty.call(merged, 'tracker')).toBe(false);
  });

  it('takes ONLY the managed keys from the binding — the file wins for an unmanaged key', () => {
    // A caller that hands over a whole FeatureConfig must not overwrite the
    // file's override with its in-memory copy.
    const binding = { ...MANAGED, tracker: 'github' } as ManagedConfig;

    expect(mergeManagedConfig({ tracker: 'linear' }, binding).tracker).toBe('linear');
  });

  it('carries the personal `features` narrowing verbatim — it is a live key, never a retired one', () => {
    const features = { memory: false, learning: false, knowledge: 'false', extra: [1] };
    const merged = mergeManagedConfig({ reviewPublication: 'full', features, ...RETIRED }, MANAGED);

    expect(merged).toEqual({ ...MANAGED, features });
  });

  it('drops the retired keys devflow itself once wrote — the old per-repo feature switches included', () => {
    const merged = mergeManagedConfig({ ...RETIRED, teamNote: 'kept' }, MANAGED);

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
    const existing = { reviewPublication: 'full', tracker: 'jira' };
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
    seedConfig(JSON.stringify({ reviewPublication: 'full', tracker: 'jira', teamNote: { tags: ['a'] } }));

    await writeManagedConfig(tmpDir, MANAGED);

    expect(readRaw()).toEqual({ ...MANAGED, tracker: 'jira', teamNote: { tags: ['a'] } });
    expect((await readConfig(tmpDir)).tracker).toBe('jira');
  });

  it('★ keeps a hand-written `features` object on disk through the managed write', async () => {
    const body = { reviewPublication: 'full', features: { learning: false, knowledge: false }, tracker: 'jira' };
    seedConfig(JSON.stringify(body));

    await writeManagedConfig(tmpDir, MANAGED);

    expect(readRaw()).toEqual({ ...body, ...MANAGED });
  });

  it('★ drops a stale per-repo feature switch an earlier init or toggle wrote', async () => {
    seedConfig(JSON.stringify({ ...RETIRED, tracker: 'jira' }));

    await writeManagedConfig(tmpDir, MANAGED);

    expect(readRaw()).toEqual({ ...MANAGED, tracker: 'jira' });
  });

  it('creates the file with only the managed keys when none exists', async () => {
    expect(existsSync(configPath())).toBe(false);

    await writeManagedConfig(tmpDir, MANAGED);

    expect(readRaw()).toEqual(MANAGED);
  });

  it('reports success on the happy-path merge', async () => {
    seedConfig(JSON.stringify({ reviewPublication: 'full', tracker: 'jira' }));

    expect(await writeManagedConfig(tmpDir, MANAGED)).toEqual({ ok: true });
    expect(readRaw()).toEqual({ ...MANAGED, tracker: 'jira' });
  });
});

// D-CONFIG-STRICT-PARSE / D-CONFIG-NO-REPAIR: a file the shared strict parser
// rejects is the user's to fix — devflow leaves its bytes exactly as they are.
describe('writeManagedConfig: a malformed file is never rewritten', () => {
  it.each([
    ['a syntax error', '{ "tracker": "jira", '],
    ['a duplicate top-level key (JSON.parse would keep the last)', '{"tracker":"jira","reviewPublication":"off","tracker":"github"}\n'],
    ['a duplicate nested key', '{"features":{"memory":false,"memory":true}}\n'],
    ['a JSON array', '[{"tracker":"jira"}]\n'],
    ['an empty file', ''],
    ['a UTF-8 byte-order mark', '\uFEFF{"tracker":"jira"}\n'],
  ])('%s: bytes stay identical and the Result names the file', async (_label, body) => {
    seedConfig(body);
    const before = readFileSync(configPath());

    const result = await writeManagedConfig(tmpDir, MANAGED);

    expect(result).toEqual({ ok: false, error: { kind: 'malformed', path: configPath() } });
    expect(readFileSync(configPath()).equals(before)).toBe(true);
    // Readers fall back as before: a malformed file configures nothing.
    expect(await readConfigIfPresent(tmpDir)).toBeNull();
  });

  it('an unreadable file is left alone, reported as unreadable', async () => {
    if (process.platform === 'win32' || process.getuid?.() === 0) return;
    seedConfig(JSON.stringify({ tracker: 'jira' }));
    chmodSync(configPath(), 0o000);
    try {
      const result = await writeManagedConfig(tmpDir, MANAGED);
      expect(result.ok).toBe(false);
      expect(!result.ok && result.error.kind).toBe('unreadable');
    } finally {
      chmodSync(configPath(), 0o600);
    }
    expect(JSON.parse(readFileSync(configPath(), 'utf-8'))).toEqual({ tracker: 'jira' });
  });

  it('with no strict parser to judge it, an existing file is left alone', async () => {
    seedConfig(JSON.stringify({ tracker: 'jira' }));
    const before = readFileSync(configPath());

    const result = await writeManagedConfig(tmpDir, MANAGED, {
      ok: false, error: { kind: 'not-found', path: '/nowhere/lib/project-config.cjs' },
    });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.kind).toBe('unreadable');
    expect(readFileSync(configPath()).equals(before)).toBe(true);
  });
});

// D-CONFIG-NO-FOLLOW: config.json is read the way the resolvers read it
// (lib/project-config.cjs readBoundedRegularFile, never followed), so a symlink
// configures nothing here either — and D-CONFIG-NO-REPAIR leaves it in place.
describe('a symlinked config.json is refused, never followed and never replaced', () => {
  const skip = process.platform === 'win32';

  /** Plant `.devflow/config.json` as a symlink to `target`; returns the link path. */
  function seedSymlink(target: string): string {
    mkdirSync(path.join(tmpDir, '.devflow'), { recursive: true });
    symlinkSync(target, configPath());
    return configPath();
  }

  it('a symlink to a valid config: readers configure nothing, the write is refused as unreadable', async () => {
    if (skip) return;
    const target = path.join(tmpDir, 'elsewhere.json');
    writeFileSync(target, JSON.stringify({ reviewPublication: 'off', tracker: 'jira' }), 'utf-8');
    const targetBefore = readFileSync(target);
    seedSymlink(target);

    expect(await readConfigIfPresent(tmpDir)).toBeNull();
    expect(await readConfig(tmpDir)).toEqual({ reviewPublication: 'auto' });

    const result = await writeManagedConfig(tmpDir, { reviewPublication: 'full' });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatchObject({ kind: 'unreadable', path: configPath() });
    expect(!result.ok && result.error.kind === 'unreadable' && result.error.detail).toMatch(/symlink/);

    // Neither written through nor replaced: the link and its target are as they were.
    expect(lstatSync(configPath()).isSymbolicLink()).toBe(true);
    expect(readlinkSync(configPath())).toBe(target);
    expect(readFileSync(target).equals(targetBefore)).toBe(true);
  });

  it('a dangling symlink is not an absent file — the write does not replace it', async () => {
    if (skip) return;
    const target = path.join(tmpDir, 'missing.json');
    seedSymlink(target);

    const result = await writeManagedConfig(tmpDir, MANAGED);

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.kind).toBe('unreadable');
    expect(lstatSync(configPath()).isSymbolicLink()).toBe(true);
    expect(existsSync(target)).toBe(false);
    expect(await readConfigIfPresent(tmpDir)).toBeNull();
  });
});

describe('classifyConfigBytes: the shared strict parser decides', () => {
  const lib = ((): ProjectConfigLib => {
    const loaded = loadProjectConfigLib();
    if (!loaded.ok) throw new Error(`strict parser failed to load: ${loaded.error.path}`);
    return loaded.value;
  })();

  it('no file is absent; a strict JSON object is its value', () => {
    expect(classifyConfigBytes(null, lib)).toEqual({ kind: 'absent' });
    expect(classifyConfigBytes(Buffer.from('{"tracker":"jira","features":{"memory":false}}'), lib))
      .toEqual({ kind: 'object', value: { tracker: 'jira', features: { memory: false } } });
  });

  it('a duplicate key anywhere, or bytes over the parser bound, are malformed', () => {
    expect(classifyConfigBytes(Buffer.from('{"a":1,"a":2}'), lib)).toEqual({ kind: 'malformed' });
    expect(classifyConfigBytes(Buffer.from('{"x":[{"a":1,"a":2}]}'), lib)).toEqual({ kind: 'malformed' });
    const oversize = Buffer.from(JSON.stringify({ note: 'x'.repeat(8192) }));
    expect(classifyConfigBytes(oversize, lib)).toEqual({ kind: 'malformed' });
  });
});
