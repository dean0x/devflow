import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { readManifest, writeManifest, mergeManifestPlugins, resolvePluginList, detectUpgrade, type ManifestData } from '../src/cli/utils/manifest.js';

describe('readManifest', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-manifest-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('returns null for missing file', async () => {
    const result = await readManifest(tmpDir);
    expect(result).toBeNull();
  });

  it('returns null for corrupt JSON', async () => {
    await fs.writeFile(path.join(tmpDir, 'manifest.json'), 'not-json{{{', 'utf-8');
    const result = await readManifest(tmpDir);
    expect(result).toBeNull();
  });

  it('returns null for invalid shape (missing required fields)', async () => {
    await fs.writeFile(path.join(tmpDir, 'manifest.json'), JSON.stringify({ foo: 'bar' }), 'utf-8');
    const result = await readManifest(tmpDir);
    expect(result).toBeNull();
  });

  it('returns null when features object is missing', async () => {
    const partial = {
      version: '1.4.0',
      plugins: ['devflow-core-skills'],
      scope: 'user',
      installedAt: '2026-03-13T00:00:00.000Z',
      updatedAt: '2026-03-13T00:00:00.000Z',
    };
    await fs.writeFile(path.join(tmpDir, 'manifest.json'), JSON.stringify(partial), 'utf-8');
    const result = await readManifest(tmpDir);
    expect(result).toBeNull();
  });

  it('returns null when installedAt is missing', async () => {
    const partial = {
      version: '1.4.0',
      plugins: ['devflow-core-skills'],
      scope: 'user',
      features: { teams: false, ambient: true, memory: true },
      updatedAt: '2026-03-13T00:00:00.000Z',
    };
    await fs.writeFile(path.join(tmpDir, 'manifest.json'), JSON.stringify(partial), 'utf-8');
    const result = await readManifest(tmpDir);
    expect(result).toBeNull();
  });

  it('returns null when features has wrong types', async () => {
    const partial = {
      version: '1.4.0',
      plugins: ['devflow-core-skills'],
      scope: 'user',
      features: { teams: 'yes', ambient: true, memory: true },
      installedAt: '2026-03-13T00:00:00.000Z',
      updatedAt: '2026-03-13T00:00:00.000Z',
    };
    await fs.writeFile(path.join(tmpDir, 'manifest.json'), JSON.stringify(partial), 'utf-8');
    const result = await readManifest(tmpDir);
    expect(result).toBeNull();
  });

  it('returns parsed manifest for valid data', async () => {
    const data: ManifestData = {
      version: '1.4.0',
      plugins: ['devflow-core-skills', 'devflow-implement'],
      scope: 'user',
      features: { teams: false, ambient: true, memory: true },
      installedAt: '2026-03-01T00:00:00.000Z',
      updatedAt: '2026-03-13T00:00:00.000Z',
    };
    await fs.writeFile(path.join(tmpDir, 'manifest.json'), JSON.stringify(data), 'utf-8');
    const result = await readManifest(tmpDir);
    expect(result).toEqual(data);
  });
});

describe('writeManifest', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-manifest-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('creates manifest file', async () => {
    const data: ManifestData = {
      version: '1.4.0',
      plugins: ['devflow-core-skills'],
      scope: 'user',
      features: { teams: false, ambient: true, memory: true },
      installedAt: '2026-03-13T00:00:00.000Z',
      updatedAt: '2026-03-13T00:00:00.000Z',
    };
    await writeManifest(tmpDir, data);
    const content = await fs.readFile(path.join(tmpDir, 'manifest.json'), 'utf-8');
    expect(JSON.parse(content)).toEqual(data);
  });

  it('overwrites existing manifest', async () => {
    const old: ManifestData = {
      version: '1.0.0',
      plugins: ['devflow-core-skills'],
      scope: 'user',
      features: { teams: false, ambient: false, memory: false },
      installedAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    await writeManifest(tmpDir, old);

    const updated: ManifestData = { ...old, version: '1.4.0', updatedAt: '2026-03-13T00:00:00.000Z' };
    await writeManifest(tmpDir, updated);

    const result = await readManifest(tmpDir);
    expect(result?.version).toBe('1.4.0');
  });

  it('creates parent directory if needed', async () => {
    const nestedDir = path.join(tmpDir, 'nested', 'devflow');
    const data: ManifestData = {
      version: '1.4.0',
      plugins: [],
      scope: 'local',
      features: { teams: false, ambient: false, memory: false },
      installedAt: '2026-03-13T00:00:00.000Z',
      updatedAt: '2026-03-13T00:00:00.000Z',
    };
    await writeManifest(nestedDir, data);
    const result = await readManifest(nestedDir);
    expect(result?.version).toBe('1.4.0');
  });
});

describe('mergeManifestPlugins', () => {
  it('returns union of existing and new plugins', () => {
    const result = mergeManifestPlugins(
      ['devflow-core-skills', 'devflow-implement'],
      ['devflow-code-review', 'devflow-debug'],
    );
    expect(result).toEqual(['devflow-core-skills', 'devflow-implement', 'devflow-code-review', 'devflow-debug']);
  });

  it('does not create duplicates', () => {
    const result = mergeManifestPlugins(
      ['devflow-core-skills', 'devflow-implement'],
      ['devflow-implement', 'devflow-code-review'],
    );
    expect(result).toEqual(['devflow-core-skills', 'devflow-implement', 'devflow-code-review']);
  });

  it('preserves order (existing first)', () => {
    const result = mergeManifestPlugins(
      ['b', 'a'],
      ['c', 'a'],
    );
    expect(result).toEqual(['b', 'a', 'c']);
  });
});

describe('detectUpgrade', () => {
  it('detects fresh install (no previous version)', () => {
    const result = detectUpgrade('1.4.0', null);
    expect(result).toEqual({
      isUpgrade: false,
      isDowngrade: false,
      isSameVersion: false,
      previousVersion: null,
    });
  });

  it('detects same version', () => {
    const result = detectUpgrade('1.4.0', '1.4.0');
    expect(result.isSameVersion).toBe(true);
    expect(result.isUpgrade).toBe(false);
    expect(result.isDowngrade).toBe(false);
    expect(result.previousVersion).toBe('1.4.0');
  });

  it('detects upgrade (newer version)', () => {
    const result = detectUpgrade('2.0.0', '1.4.0');
    expect(result.isUpgrade).toBe(true);
    expect(result.isDowngrade).toBe(false);
    expect(result.isSameVersion).toBe(false);
    expect(result.previousVersion).toBe('1.4.0');
  });

  it('detects minor upgrade', () => {
    const result = detectUpgrade('1.5.0', '1.4.0');
    expect(result.isUpgrade).toBe(true);
  });

  it('detects patch upgrade', () => {
    const result = detectUpgrade('1.4.1', '1.4.0');
    expect(result.isUpgrade).toBe(true);
  });

  it('detects downgrade', () => {
    const result = detectUpgrade('1.0.0', '1.4.0');
    expect(result.isDowngrade).toBe(true);
    expect(result.isUpgrade).toBe(false);
    expect(result.previousVersion).toBe('1.4.0');
  });

  it('handles unparseable versions gracefully', () => {
    const result = detectUpgrade('not-a-version', '1.4.0');
    expect(result.isUpgrade).toBe(false);
    expect(result.isDowngrade).toBe(false);
    expect(result.isSameVersion).toBe(false);
    expect(result.previousVersion).toBe('1.4.0');
  });
});

describe('resolvePluginList', () => {
  const existingManifest: ManifestData = {
    version: '1.0.0',
    plugins: ['devflow-core-skills', 'devflow-implement'],
    scope: 'user',
    features: { teams: false, ambient: true, memory: true },
    installedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  it('replaces plugin list on full install (no existing manifest)', () => {
    const result = resolvePluginList(
      ['devflow-core-skills', 'devflow-code-review'],
      null,
      false,
    );
    expect(result).toEqual(['devflow-core-skills', 'devflow-code-review']);
  });

  it('replaces plugin list on full install (existing manifest present)', () => {
    const result = resolvePluginList(
      ['devflow-core-skills', 'devflow-code-review'],
      existingManifest,
      false,
    );
    expect(result).toEqual(['devflow-core-skills', 'devflow-code-review']);
  });

  it('merges plugins on partial install with existing manifest', () => {
    const result = resolvePluginList(
      ['devflow-code-review', 'devflow-debug'],
      existingManifest,
      true,
    );
    expect(result).toEqual(['devflow-core-skills', 'devflow-implement', 'devflow-code-review', 'devflow-debug']);
  });

  it('does not duplicate plugins on partial install merge', () => {
    const result = resolvePluginList(
      ['devflow-implement', 'devflow-code-review'],
      existingManifest,
      true,
    );
    expect(result).toEqual(['devflow-core-skills', 'devflow-implement', 'devflow-code-review']);
  });

  it('replaces plugin list on partial install without existing manifest', () => {
    const result = resolvePluginList(
      ['devflow-code-review'],
      null,
      true,
    );
    expect(result).toEqual(['devflow-code-review']);
  });
});
