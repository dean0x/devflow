/**
 * The gate-level module (src/core/gate-level.ts): the closed level set, the strict
 * parser, the machine layer's raw reader and writer, and the manifest predicate the
 * reader shares with readManifest().
 *
 * The reader and writer touch the file system and must never throw, so every
 * outcome is a row here. The CommonJS twin of the reader lives in
 * lib/project-config.cjs; its bound and its BOM rule are held to this module's by
 * the parity rows below.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'module';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';

import {
  DEFAULT_GATE_LEVEL,
  GATE_LEVELS,
  MALFORMED_GATE_LEVEL_READS_AS,
  MAX_MANIFEST_BYTES,
  machineGateLevel,
  parseGateLevel,
  readGateManifest,
  setMachineGateLevel,
  writeMachineGateLevel,
} from '../src/core/gate-level.js';
import { hasRequiredManifestFields, readManifest } from '../src/core/manifest.js';
import { makeManifest } from './helpers.js';
import { PROJECT_CONFIG_LIB, SETTINGS_SCRIPT } from './evidence-policy/scripted-shim.js';

const NOW = '2026-10-14T00:00:00.000Z';

/** A manifest object readManifest() accepts, with the caller's extra keys. */
function validManifest(extraFeatures: Record<string, unknown> = {}, extraTop: Record<string, unknown> = {}): Record<string, unknown> {
  const base = makeManifest();
  return { ...base, features: { ...base.features, ...extraFeatures }, ...extraTop };
}

describe('the level registry', () => {
  it('holds exactly full, standard and lean, frozen, with standard as the default', () => {
    expect([...GATE_LEVELS]).toEqual(['full', 'standard', 'lean']);
    expect(Object.isFrozen(GATE_LEVELS)).toBe(true);
    expect(DEFAULT_GATE_LEVEL).toBe('standard');
    expect(GATE_LEVELS).toContain(DEFAULT_GATE_LEVEL);
    expect(MAX_MANIFEST_BYTES).toBe(1048576);
  });

  it('folds a value that is not a level to the strictest level, the same one the settings resolver folds it to', () => {
    expect(MALFORMED_GATE_LEVEL_READS_AS).toBe(GATE_LEVELS[0]);
    expect(MALFORMED_GATE_LEVEL_READS_AS).toBe('full');
    const resolver = createRequire(import.meta.url)(SETTINGS_SCRIPT) as {
      foldGateLevel(personal: unknown, manifest: unknown): { gateLevel: string; gateLevelInvalid: boolean };
    };
    const folded = resolver.foldGateLevel({ kind: 'absent' }, { features: { gateLevel: 'Lean' } });
    expect(folded.gateLevelInvalid).toBe(true);
    expect(folded.gateLevel).toBe(MALFORMED_GATE_LEVEL_READS_AS);
  });
});

describe('parseGateLevel', () => {
  it.each(['full', 'standard', 'lean'])('accepts %s', word => {
    expect(parseGateLevel(word)).toEqual({ ok: true, value: word });
  });

  const REJECTED: ReadonlyArray<readonly [string, unknown]> = [
    ['a capitalised level', 'Lean'],
    ['an upper-case level', 'FULL'],
    ['a trailing space', 'lean '],
    ['a leading space', ' lean'],
    ['a trailing newline', 'lean\n'],
    ['an empty string', ''],
    ['undefined', undefined],
    ['null', null],
    ['a number', 1],
    ['a boolean', true],
    ['an array holding a level', ['lean']],
    ['an unknown word', 'minimal'],
  ];

  it.each(REJECTED)('rejects %s, and the message names all three levels', (_label, value) => {
    const r = parseGateLevel(value);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    for (const level of GATE_LEVELS) expect(r.error).toContain(level);
  });

  it('echoes an offending string without its control bytes, and never a non-string value', () => {
    const control = parseGateLevel('le\u001b[31man\u0000');
    expect(control.ok).toBe(false);
    // eslint-disable-next-line no-control-regex
    if (!control.ok) expect(control.error).not.toMatch(/[\u0000-\u001f\u007f]/);
    const object = parseGateLevel({ toString: () => 'lean' });
    expect(object.ok).toBe(false);
    if (!object.ok) expect(object.error).toContain('<object>');
  });
});

describe('machineGateLevel', () => {
  const ROWS: ReadonlyArray<readonly [string, unknown, string | null]> = [
    ['no manifest at all (null)', null, null],
    ['a top-level array', [], null],
    ['a top-level string', 'lean', null],
    ['no features key', {}, null],
    ['features set to a string', { features: 'lean' }, null],
    ['features set to an array', { features: [] }, null],
    ['features without a gateLevel key', { features: {} }, null],
    ['full', { features: { gateLevel: 'full' } }, 'full'],
    ['standard', { features: { gateLevel: 'standard' } }, 'standard'],
    ['lean', { features: { gateLevel: 'lean' } }, 'lean'],
    ['a capitalised level', { features: { gateLevel: 'Lean' } }, 'invalid'],
    ['a number', { features: { gateLevel: 5 } }, 'invalid'],
    ['null', { features: { gateLevel: null } }, 'invalid'],
    ['a boolean', { features: { gateLevel: true } }, 'invalid'],
    ['an empty string', { features: { gateLevel: '' } }, 'invalid'],
    ['an object', { features: { gateLevel: { level: 'lean' } } }, 'invalid'],
    ['an array', { features: { gateLevel: ['lean'] } }, 'invalid'],
  ];

  it.each(ROWS)('%s', (_label, raw, expected) => {
    expect(machineGateLevel(raw)).toBe(expected);
  });

  it('reads an inherited key as not recorded', () => {
    const features = Object.create({ gateLevel: 'lean' }) as Record<string, unknown>;
    expect(machineGateLevel({ features })).toBeNull();
  });

  it('reads a level from a manifest that readManifest() would reject', () => {
    expect(machineGateLevel({ features: { gateLevel: 'lean' } })).toBe('lean');
  });
});

describe('setMachineGateLevel', () => {
  it('sets features.gateLevel and updatedAt, keeps every other key, and never mutates its input', () => {
    const input = validManifest({ gateLevel: 'Lean', futureKey: { nested: [1, 2] } }, { unmodelled: 'kept' });
    const frozen = structuredClone(input);
    const next = setMachineGateLevel(input, 'lean', NOW);
    expect(input).toEqual(frozen);
    expect(next).not.toBeNull();
    const out = next as Record<string, unknown>;
    expect(out).not.toBe(input);
    expect((out.features as Record<string, unknown>).gateLevel).toBe('lean');
    expect(out.updatedAt).toBe(NOW);
    expect({ ...out, features: { ...(out.features as object), gateLevel: undefined }, updatedAt: undefined })
      .toEqual({ ...input, features: { ...(input.features as object), gateLevel: undefined }, updatedAt: undefined });
  });

  it('returns null when the top level or features is not a plain object', () => {
    expect(setMachineGateLevel({ features: 'x' }, 'lean', NOW)).toBeNull();
    expect(setMachineGateLevel({ features: [] }, 'lean', NOW)).toBeNull();
    expect(setMachineGateLevel({}, 'lean', NOW)).toBeNull();
    expect(setMachineGateLevel([] as unknown as Record<string, unknown>, 'lean', NOW)).toBeNull();
  });
});

describe('the file-system functions', () => {
  let dir: string;
  let manifestPath: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-gate-level-'));
    manifestPath = path.join(dir, 'manifest.json');
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(dir, { recursive: true, force: true });
  });

  const write = (body: string | Buffer): Promise<void> => fs.writeFile(manifestPath, body);

  describe('readGateManifest', () => {
    it('reads no file, and a devflow directory that is missing or is a file, as absent', async () => {
      expect(await readGateManifest(dir)).toEqual({ kind: 'absent' });
      expect(await readGateManifest(path.join(dir, 'missing'))).toEqual({ kind: 'absent' });
      await fs.writeFile(path.join(dir, 'file'), 'x');
      expect(await readGateManifest(path.join(dir, 'file'))).toEqual({ kind: 'absent' });
    });

    const CORRUPT_ROWS: ReadonlyArray<readonly [string, () => string | Buffer]> = [
      ['unparseable JSON', () => 'not-json{{{'],
      ['an empty file', () => ''],
      ['a top-level array', () => '[]'],
      ['a top-level null', () => 'null'],
      ['no features key', () => JSON.stringify({ version: '1' })],
      ['features set to a string', () => JSON.stringify({ features: 'x' })],
      ['features set to an array', () => JSON.stringify({ features: [] })],
      ['bytes that are not UTF-8', () => Buffer.concat([Buffer.from('{"features":{},"x":"'), Buffer.from([0xc3, 0x28]), Buffer.from('"}')])],
    ];

    it.each(CORRUPT_ROWS)('reads %s as corrupt', async (_label, body) => {
      await write(body());
      expect(await readGateManifest(dir)).toEqual({ kind: 'corrupt' });
    });

    it('reads a directory at the manifest path as corrupt', async () => {
      await fs.mkdir(manifestPath);
      expect(await readGateManifest(dir)).toEqual({ kind: 'corrupt' });
    });

    it('reads a dangling link as absent and a link loop as corrupt', async () => {
      await fs.symlink(path.join(dir, 'nowhere.json'), manifestPath);
      expect(await readGateManifest(dir)).toEqual({ kind: 'absent' });
      await fs.rm(manifestPath);
      await fs.symlink(manifestPath, manifestPath);
      expect(await readGateManifest(dir)).toEqual({ kind: 'corrupt' });
    });

    it('follows a link to a regular file', async () => {
      const real = path.join(dir, 'real.json');
      await fs.writeFile(real, JSON.stringify(validManifest()));
      await fs.symlink(real, manifestPath);
      expect((await readGateManifest(dir)).kind).toBe('object');
    });

    it('reads a plain object that readManifest() accepts as object, and keeps every key raw', async () => {
      const manifest = validManifest({ gateLevel: null, future: [1] }, { extra: { a: 1 } });
      await write(JSON.stringify(manifest));
      expect(await readGateManifest(dir)).toEqual({ kind: 'object', raw: manifest });
    });

    it('reads a plain object that readManifest() rejects as rejected, with its raw keys', async () => {
      const manifest = { features: { gateLevel: 'lean' }, other: 1 };
      await write(JSON.stringify(manifest));
      expect(await readGateManifest(dir)).toEqual({ kind: 'rejected', raw: manifest });
    });

    it('never heals: a manifest readManifest() would rewrite is left byte-identical', async () => {
      const body = JSON.stringify(validManifest({ kb: true, decisions: false, viewMode: 'default' })) + '\n';
      await write(body);
      await readGateManifest(dir);
      expect(await fs.readFile(manifestPath, 'utf-8')).toBe(body);
    });

    it('accepts a file of exactly MAX_MANIFEST_BYTES and refuses one byte more', async () => {
      const padTo = (size: number): string => {
        const head = JSON.stringify(validManifest({}, { pad: '' }));
        return JSON.stringify(validManifest({}, { pad: 'x'.repeat(size - head.length) }));
      };
      const exact = padTo(MAX_MANIFEST_BYTES);
      expect(Buffer.byteLength(exact)).toBe(MAX_MANIFEST_BYTES);
      await write(exact);
      expect((await readGateManifest(dir)).kind).toBe('object');
      await write(padTo(MAX_MANIFEST_BYTES + 1));
      expect(await readGateManifest(dir)).toEqual({ kind: 'corrupt' });
    });

    it('reads a file with a leading BOM as rejected, keeping its level, because readManifest() cannot parse it', async () => {
      const manifest = validManifest({ gateLevel: 'lean' });
      await write(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(JSON.stringify(manifest))]));
      const read = await readGateManifest(dir);
      expect(read).toEqual({ kind: 'rejected', raw: manifest });
      expect(machineGateLevel('raw' in read ? read.raw : null)).toBe('lean');
      expect(await readManifest(dir)).toBeNull();
    });

    it('never throws when the file system refuses', async () => {
      vi.spyOn(fs, 'stat').mockRejectedValueOnce(Object.assign(new Error('denied'), { code: 'EACCES' }));
      expect(await readGateManifest(dir)).toEqual({ kind: 'corrupt' });
      vi.spyOn(fs, 'open').mockRejectedValueOnce(Object.assign(new Error('denied'), { code: 'EACCES' }));
      await write(JSON.stringify(validManifest()));
      expect(await readGateManifest(dir)).toEqual({ kind: 'corrupt' });
    });
  });

  describe('parity with the resolver library reader', () => {
    const lib = createRequire(import.meta.url)(PROJECT_CONFIG_LIB) as {
      MAX_MANIFEST_BYTES: number;
      GATE_LEVELS: readonly string[];
      readMachineManifest(): unknown;
    };
    let savedHome: string | undefined;

    beforeEach(() => {
      savedHome = process.env.HOME;
      process.env.HOME = dir;
      return fs.mkdir(path.join(dir, '.devflow'));
    });

    afterEach(() => {
      if (savedHome === undefined) delete process.env.HOME;
      else process.env.HOME = savedHome;
    });

    it('shares the byte bound and the level list', () => {
      expect(lib.MAX_MANIFEST_BYTES).toBe(MAX_MANIFEST_BYTES);
      expect([...lib.GATE_LEVELS]).toEqual([...GATE_LEVELS]);
    });

    const isReadable = (v: unknown): boolean => typeof v === 'object' && v !== null && !Array.isArray(v);

    it.each<readonly [string, () => string | Buffer]>([
      ['a plain manifest', () => JSON.stringify(validManifest({ gateLevel: 'lean' }))],
      ['a leading BOM', () => Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(JSON.stringify(validManifest()))])],
      ['a file over the bound', () => JSON.stringify(validManifest({}, { pad: 'x'.repeat(MAX_MANIFEST_BYTES) }))],
      ['unparseable JSON', () => '{'],
      ['bytes that are not UTF-8', () => Buffer.from([0x7b, 0xc3, 0x28, 0x7d])],
    ])('both readers agree on %s', async (_label, body) => {
      const p = path.join(dir, '.devflow', 'manifest.json');
      await fs.writeFile(p, body());
      const viaLib = lib.readMachineManifest();
      const viaGate = await readGateManifest(path.join(dir, '.devflow'));
      expect(viaGate.kind === 'object' || viaGate.kind === 'rejected').toBe(isReadable(viaLib));
    });
  });

  describe('writeMachineGateLevel', () => {
    const tick = (): string => NOW;

    it('writes only features.gateLevel and updatedAt, and keeps every other key', async () => {
      const before = validManifest({ future: { deep: [1] } }, { unmodelled: 'kept' });
      await write(JSON.stringify(before, null, 2) + '\n');
      expect(await writeMachineGateLevel(dir, 'lean', tick)).toEqual({ kind: 'written' });
      const after = JSON.parse(await fs.readFile(manifestPath, 'utf-8')) as Record<string, unknown>;
      expect(after.updatedAt).toBe(NOW);
      expect((after.features as Record<string, unknown>).gateLevel).toBe('lean');
      expect({ ...after, updatedAt: null, features: { ...(after.features as object), gateLevel: null } })
        .toEqual({ ...before, updatedAt: null, features: { ...(before.features as object), gateLevel: null } });
      expect(await fs.readFile(manifestPath, 'utf-8')).toMatch(/\n$/);
    });

    it('writes an explicit standard when the key is absent', async () => {
      await write(JSON.stringify(validManifest()));
      expect(await writeMachineGateLevel(dir, 'standard', tick)).toEqual({ kind: 'written' });
      expect(machineGateLevel(JSON.parse(await fs.readFile(manifestPath, 'utf-8')))).toBe('standard');
    });

    it('replaces a malformed stored value with the level asked for', async () => {
      await write(JSON.stringify(validManifest({ gateLevel: 'Lean' })));
      expect(await writeMachineGateLevel(dir, 'lean', tick)).toEqual({ kind: 'written' });
      expect(machineGateLevel(JSON.parse(await fs.readFile(manifestPath, 'utf-8')))).toBe('lean');
    });

    it('writes into a manifest that readManifest() rejects, keeping its other keys', async () => {
      await write(JSON.stringify({ features: { gateLevel: 'full', other: 1 }, keep: true }));
      expect(await writeMachineGateLevel(dir, 'lean', tick)).toEqual({ kind: 'written' });
      const after = JSON.parse(await fs.readFile(manifestPath, 'utf-8')) as Record<string, unknown>;
      expect(after.keep).toBe(true);
      expect(after.features).toEqual({ gateLevel: 'lean', other: 1 });
    });

    it('writes nothing, and does not read the clock, when the level is already recorded', async () => {
      const body = JSON.stringify(validManifest({ gateLevel: 'lean' }), null, 2) + '\n';
      await write(body);
      const before = await fs.stat(manifestPath);
      const clock = vi.fn(tick);
      expect(await writeMachineGateLevel(dir, 'lean', clock)).toEqual({ kind: 'unchanged' });
      expect(clock).not.toHaveBeenCalled();
      expect(await fs.readFile(manifestPath, 'utf-8')).toBe(body);
      expect((await fs.stat(manifestPath)).mtimeMs).toBe(before.mtimeMs);
    });

    it('returns not-installed when there is no manifest, and creates none', async () => {
      expect(await writeMachineGateLevel(dir, 'lean', tick)).toEqual({ kind: 'not-installed' });
      await expect(fs.stat(manifestPath)).rejects.toThrow();
    });

    it.each<readonly [string, string]>([
      ['unparseable JSON', 'not-json{{{'],
      ['features set to a string', JSON.stringify({ features: 'x' })],
      ['a top-level array', '[]'],
    ])('returns unreadable with the path for %s, and writes nothing', async (_label, body) => {
      await write(body);
      expect(await writeMachineGateLevel(dir, 'lean', tick)).toEqual({ kind: 'unreadable', path: manifestPath });
      expect(await fs.readFile(manifestPath, 'utf-8')).toBe(body);
    });

    it.each<readonly [string, unknown]>([
      ['a capitalised level', 'Lean'],
      ['an empty string', ''],
      ['undefined', undefined],
      ['a number', 1],
      ['an object', { toString: () => 'lean' }],
    ])('refuses %s with invalid-level, before any I/O, and never throws', async (_label, level) => {
      const body = JSON.stringify(validManifest({ gateLevel: 'full' }));
      await write(body);
      const clock = vi.fn(tick);
      expect(await writeMachineGateLevel(dir, level as never, clock)).toEqual({ kind: 'invalid-level' });
      expect(clock).not.toHaveBeenCalled();
      expect(await fs.readFile(manifestPath, 'utf-8')).toBe(body);
    });

    it('refuses an invalid level even where no manifest exists, and creates none', async () => {
      expect(await writeMachineGateLevel(dir, 'minimal' as never, tick)).toEqual({ kind: 'invalid-level' });
      await expect(fs.stat(manifestPath)).rejects.toThrow();
    });

    it('returns write-failed with the path and an error code, without throwing', async () => {
      const body = JSON.stringify(validManifest());
      await write(body);
      // A directory where the temp file goes makes the atomic write fail whoever runs the test.
      await fs.mkdir(`${manifestPath}.tmp.${process.pid}`);
      const result = await writeMachineGateLevel(dir, 'lean', tick);
      expect(result).toEqual({ kind: 'write-failed', path: manifestPath, reason: expect.stringMatching(/^[A-Z]+$/) });
      expect(await fs.readFile(manifestPath, 'utf-8')).toBe(body);
    });

    it('returns write-failed when the clock throws, without throwing', async () => {
      const body = JSON.stringify(validManifest());
      await write(body);
      const result = await writeMachineGateLevel(dir, 'lean', () => { throw new Error('no clock'); });
      expect(result).toEqual({ kind: 'write-failed', path: manifestPath, reason: 'unknown error' });
      expect(await fs.readFile(manifestPath, 'utf-8')).toBe(body);
    });
  });
});

describe('hasRequiredManifestFields', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-manifest-shape-'));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  const without = (key: string): Record<string, unknown> => {
    const { [key]: _dropped, ...rest } = validManifest();
    return rest;
  };
  const withoutFeature = (key: string): Record<string, unknown> => {
    const m = validManifest();
    const { [key]: _dropped, ...features } = m.features as Record<string, unknown>;
    return { ...m, features };
  };

  const ROWS: ReadonlyArray<readonly [string, Record<string, unknown>, boolean]> = [
    ['a full manifest', validManifest(), true],
    ['no version', without('version'), false],
    ['an empty version', { ...validManifest(), version: '' }, false],
    ['plugins that is not an array', { ...validManifest(), plugins: 'x' }, false],
    ['no installedAt', without('installedAt'), false],
    ['installedAt that is a number', { ...validManifest(), installedAt: 1 }, false],
    ['no updatedAt', without('updatedAt'), false],
    ['no features', without('features'), false],
    ['features that is null', { ...validManifest(), features: null }, false],
    ['features that is a string', { ...validManifest(), features: 'x' }, false],
    ['no features.ambient', withoutFeature('ambient'), false],
    ['features.memory that is a string', validManifest({ memory: 'on' }), false],
    ['features without the optional keys', { ...validManifest(), features: { ambient: true, memory: false } }, true],
  ];

  it.each(ROWS)('%s', async (_label, manifest, expected) => {
    expect(hasRequiredManifestFields(manifest)).toBe(expected);
    await fs.writeFile(path.join(dir, 'manifest.json'), JSON.stringify(manifest));
    expect(await readManifest(dir) !== null, 'readManifest agrees with the predicate').toBe(expected);
  });
});
