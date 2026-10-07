import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  DEFAULT_CONFIG,
  getConfigPath,
  readConfig,
  readConfigIfPresent,
  writeManagedConfig,
} from '../src/core/feature-config.js';

/**
 * The per-repo `.devflow/config.json`: facts about one repository
 * (`reviewPublication`, the hand-written `tracker` override) — never a feature
 * switch at the top level. D-FEATURES-NARROW-ONLY keeps its `memory`,
 * `learning` and `knowledge` keys retired (with the older `decisions` /
 * `autoCommit`): no reader surfaces them and a managed write drops them. Only
 * the new `features` namespace can narrow a switch.
 */

/** Create .devflow/ and write data as config.json under projectDir. */
function writeDevflowConfig(projectDir: string, data: unknown): void {
  const devflowDir = path.join(projectDir, '.devflow');
  fs.mkdirSync(devflowDir, { recursive: true });
  fs.writeFileSync(path.join(devflowDir, 'config.json'), JSON.stringify(data));
}

function readRaw(projectDir: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(getConfigPath(projectDir), 'utf-8')) as Record<string, unknown>;
}

const RETIRED = ['memory', 'learning', 'knowledge', 'decisions', 'autoCommit'] as const;

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-feature-config-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('getConfigPath', () => {
  it('returns .devflow/config.json under project root', () => {
    expect(getConfigPath('/some/project')).toBe('/some/project/.devflow/config.json');
  });
});

describe('readConfig', () => {
  it('returns DEFAULT_CONFIG when the file is missing', async () => {
    expect(await readConfig(tmpDir)).toEqual(DEFAULT_CONFIG);
  });

  it('returns defaults for malformed JSON, a non-object, or an array', async () => {
    fs.mkdirSync(path.join(tmpDir, '.devflow'), { recursive: true });
    for (const body of ['not json at all', '"just a string"', '[false, true]']) {
      fs.writeFileSync(getConfigPath(tmpDir), body);
      expect(await readConfig(tmpDir), body).toEqual(DEFAULT_CONFIG);
    }
  });

  it('never surfaces a retired feature key — a stale learning:false decides nothing', async () => {
    writeDevflowConfig(tmpDir, { memory: false, learning: false, knowledge: false, decisions: false, autoCommit: true });
    const config = await readConfig(tmpDir) as unknown as Record<string, unknown>;
    for (const key of RETIRED) {
      expect(config[key], key).toBeUndefined();
    }
  });

  // AC-9 (clean break): readConfig reads only .devflow/config.json, never the
  // retired dream/config.json location.
  it('AC-9: only dream/config.json present (no .devflow/config.json) → DEFAULT_CONFIG', async () => {
    const dreamDir = path.join(tmpDir, '.devflow', 'dream');
    fs.mkdirSync(dreamDir, { recursive: true });
    fs.writeFileSync(path.join(dreamDir, 'config.json'), JSON.stringify({ reviewPublication: 'full' }));
    expect(await readConfig(tmpDir)).toEqual(DEFAULT_CONFIG);
  });
});

describe('writeManagedConfig', () => {
  it('creates .devflow/config.json (neutral root, not inside learning/)', async () => {
    await writeManagedConfig(tmpDir, { reviewPublication: 'full' });
    expect(readRaw(tmpDir)).toEqual({ reviewPublication: 'full' });
    expect(fs.existsSync(path.join(tmpDir, '.devflow', 'learning', 'config.json'))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, '.devflow', 'dream', 'config.json'))).toBe(false);
  });

  it('drops the retired feature keys a pre-#378 init or toggle left in the file', async () => {
    writeDevflowConfig(tmpDir, {
      memory: false, learning: false, knowledge: true, decisions: false, autoCommit: true,
      reviewPublication: 'off',
    });
    await writeManagedConfig(tmpDir, { reviewPublication: 'off' });
    expect(readRaw(tmpDir)).toEqual({ reviewPublication: 'off' });
  });

  it('overwrites the managed key', async () => {
    await writeManagedConfig(tmpDir, { reviewPublication: 'auto' });
    await writeManagedConfig(tmpDir, { reviewPublication: 'off' });
    expect((await readConfig(tmpDir)).reviewPublication).toBe('off');
  });

  it('leaves no .tmp.* files behind after a successful write', async () => {
    await writeManagedConfig(tmpDir, { reviewPublication: 'auto' });
    const tmpFiles = fs.readdirSync(path.join(tmpDir, '.devflow')).filter(f => f.includes('.tmp.'));
    expect(tmpFiles).toHaveLength(0);
  });

  // Once a write has created its copy, a failure after that removes the copy again, so
  // a failed write leaves nothing beside config.json and the old file stands as it was.
  describe('a write that fails after its copy exists', () => {
    const copyPath = (): string => `${getConfigPath(tmpDir)}.tmp.${process.pid}`;

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('a failed rename removes the copy, keeps config.json as it was, and the Result says why', async () => {
      writeDevflowConfig(tmpDir, { reviewPublication: 'full', tracker: 'jira' });
      const before = fs.readFileSync(getConfigPath(tmpDir), 'utf-8');
      let copyExisted = false;
      vi.spyOn(fs.promises, 'rename').mockImplementationOnce(async from => {
        copyExisted = fs.existsSync(String(from));
        throw new Error('EXDEV: cross-device link not permitted');
      });

      const result = await writeManagedConfig(tmpDir, { reviewPublication: 'off' });

      expect(copyExisted, 'the copy existed when the rename failed').toBe(true);
      expect(fs.readdirSync(path.join(tmpDir, '.devflow')), 'no copy is left beside config.json').toEqual(['config.json']);
      expect(fs.readFileSync(getConfigPath(tmpDir), 'utf-8'), 'config.json is kept as it was').toBe(before);
      expect(result).toEqual({
        ok: false,
        error: { kind: 'write-failed', path: getConfigPath(tmpDir), detail: 'EXDEV: cross-device link not permitted' },
      });
    });

    it('a failed write removes the copy, keeps config.json as it was, and the Result says why', async () => {
      writeDevflowConfig(tmpDir, { reviewPublication: 'full', tracker: 'jira' });
      const before = fs.readFileSync(getConfigPath(tmpDir), 'utf-8');
      let copyExisted = false;
      vi.spyOn(fs.promises, 'writeFile').mockImplementationOnce(async () => {
        copyExisted = fs.existsSync(copyPath());
        throw new Error('ENOSPC: no space left on device');
      });

      const result = await writeManagedConfig(tmpDir, { reviewPublication: 'off' });

      expect(copyExisted, 'the copy existed when the write failed').toBe(true);
      expect(fs.readdirSync(path.join(tmpDir, '.devflow')), 'no copy is left beside config.json').toEqual(['config.json']);
      expect(fs.readFileSync(getConfigPath(tmpDir), 'utf-8'), 'config.json is kept as it was').toBe(before);
      expect(result).toEqual({
        ok: false,
        error: { kind: 'write-failed', path: getConfigPath(tmpDir), detail: 'ENOSPC: no space left on device' },
      });
    });

    it('a copy that cannot be removed either is named in the Result', async () => {
      vi.spyOn(fs.promises, 'rename').mockRejectedValueOnce(new Error('EXDEV: cross-device link not permitted'));
      vi.spyOn(fs.promises, 'rm').mockRejectedValueOnce(new Error('EPERM: operation not permitted'));

      const result = await writeManagedConfig(tmpDir, { reviewPublication: 'off' });

      expect(result).toEqual({
        ok: false,
        error: {
          kind: 'write-failed',
          path: getConfigPath(tmpDir),
          detail: `EXDEV: cross-device link not permitted; its copy ${copyPath()} could not be removed: EPERM: operation not permitted`,
        },
      });
    });
  });

  // D-CLI-NO-SYMLINK: a repository can commit .devflow as a link to a folder
  // elsewhere, or plant a link at the name of the copy init writes before renaming
  // it into place; init writes nothing through either.
  describe('never through a symbolic link (D-CLI-NO-SYMLINK)', () => {
    const KEEP = '{"keep": "a file outside the project"}\n';
    let outside: string;

    beforeEach(() => {
      outside = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-feature-config-outside-'));
      vi.stubEnv('HOME', path.join(outside, 'home'));
    });

    afterEach(() => {
      vi.unstubAllEnvs();
      fs.rmSync(outside, { recursive: true, force: true });
    });

    it('a linked .devflow: writes and creates nothing where it points, and the Result says why', async () => {
      fs.writeFileSync(path.join(outside, 'config.json'), KEEP);
      fs.symlinkSync(outside, path.join(tmpDir, '.devflow'));

      const result = await writeManagedConfig(tmpDir, { reviewPublication: 'off' });

      expect(fs.readFileSync(path.join(outside, 'config.json'), 'utf-8'), 'nothing is written through the link').toBe(KEEP);
      expect(fs.readdirSync(outside), 'nothing is created there').toEqual(['config.json']);
      expect(result).toEqual({
        ok: false,
        error: { kind: 'unreadable', path: getConfigPath(tmpDir), detail: expect.stringContaining(`${path.join(tmpDir, '.devflow')} is a symbolic link`) },
      });
    });

    it('a link planted at the name of the copy: nothing is written through it, and the Result says the write failed', async () => {
      const target = path.join(outside, 'target');
      const planted = `${getConfigPath(tmpDir)}.tmp.${process.pid}`;
      fs.writeFileSync(target, KEEP);
      fs.mkdirSync(path.join(tmpDir, '.devflow'));
      fs.symlinkSync(target, planted);

      const result = await writeManagedConfig(tmpDir, { reviewPublication: 'off' });

      expect(fs.readFileSync(target, 'utf-8'), 'nothing is written through the planted link').toBe(KEEP);
      expect(fs.lstatSync(planted).isSymbolicLink(), 'an entry this run did not create is left where it is').toBe(true);
      expect(fs.existsSync(getConfigPath(tmpDir)), 'no config.json was renamed into place').toBe(false);
      expect(result).toMatchObject({ ok: false, error: { kind: 'write-failed', path: getConfigPath(tmpDir) } });
    });
  });
});

describe('readConfigIfPresent', () => {
  it('returns null when config.json is absent (distinct from DEFAULT_CONFIG)', async () => {
    expect(await readConfigIfPresent(tmpDir)).toBeNull();
    fs.mkdirSync(path.join(tmpDir, '.devflow'), { recursive: true });
    expect(await readConfigIfPresent(tmpDir)).toBeNull();
  });

  it('returns the coerced config when config.json is present', async () => {
    await writeManagedConfig(tmpDir, { reviewPublication: 'full' });
    expect(await readConfigIfPresent(tmpDir)).toEqual({ reviewPublication: 'full' });
  });

  it('returns null for malformed JSON or non-object JSON', async () => {
    fs.mkdirSync(path.join(tmpDir, '.devflow'), { recursive: true });
    fs.writeFileSync(getConfigPath(tmpDir), 'not-valid-json{{{');
    expect(await readConfigIfPresent(tmpDir)).toBeNull();
    fs.writeFileSync(getConfigPath(tmpDir), JSON.stringify([1, 2, 3]));
    expect(await readConfigIfPresent(tmpDir)).toBeNull();
  });

  it('never throws even for unreadable paths (returns null)', async () => {
    await expect(readConfigIfPresent('/nonexistent/project/path/xyz')).resolves.toBeNull();
  });
});

describe('reviewPublication coercion', () => {
  it('absent, invalid string or non-string coerces to "auto"', async () => {
    for (const body of [{}, { reviewPublication: 'banana' }, { reviewPublication: 42 }]) {
      writeDevflowConfig(tmpDir, body);
      expect((await readConfig(tmpDir)).reviewPublication, JSON.stringify(body)).toBe('auto');
    }
  });

  it.each(['auto', 'full', 'off'] as const)('valid value "%s" round-trips through read/write', async (value) => {
    await writeManagedConfig(tmpDir, { reviewPublication: value });
    expect((await readConfig(tmpDir)).reviewPublication).toBe(value);
  });

  it('DEFAULT_CONFIG has reviewPublication "auto" (the fail-closed default)', () => {
    // Assert on the shipped constant — "full" would publish full reports on
    // public repos by default (no locally-declared literal stand-in).
    expect(DEFAULT_CONFIG.reviewPublication).toBe('auto');
  });
});
