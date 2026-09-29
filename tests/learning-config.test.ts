import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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
    // public repos by default (PF-018: no locally-declared literal stand-in).
    expect(DEFAULT_CONFIG.reviewPublication).toBe('auto');
  });
});
