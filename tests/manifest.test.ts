import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { readManifest, writeManifest, mergeManifestPlugins, resolvePluginList, detectUpgrade, syncManifestFeature, type ManifestData } from '../src/core/manifest.js';
import { makeManifest } from './helpers.js';

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
      features: { ambient: true, memory: true },
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
      features: { ambient: 'yes', memory: true },
      installedAt: '2026-03-13T00:00:00.000Z',
      updatedAt: '2026-03-13T00:00:00.000Z',
    };
    await fs.writeFile(path.join(tmpDir, 'manifest.json'), JSON.stringify(partial), 'utf-8');
    const result = await readManifest(tmpDir);
    expect(result).toBeNull();
  });

  it('returns parsed manifest for valid data (without teams)', async () => {
    // Phase 2: use FlagsRecord (not string[]) and no deprecated viewMode field
    // so the round-trip is heal-free and the result deeply equals the input.
    const data: ManifestData = {
      version: '1.4.0',
      plugins: ['devflow-core-skills', 'devflow-implement'],
      scope: 'user',
      features: { ambient: true, memory: true, hud: false, knowledge: false, learning: false, rules: true, flags: {}, proxy: false, compliance: { enabled: false, frameworks: [] } },
      installedAt: '2026-03-01T00:00:00.000Z',
      updatedAt: '2026-03-13T00:00:00.000Z',
    };
    await fs.writeFile(path.join(tmpDir, 'manifest.json'), JSON.stringify(data), 'utf-8');
    const result = await readManifest(tmpDir);
    expect(result).toEqual(data);
  });

  it('parses legacy manifest WITH teams field (key ignored, not rejected)', async () => {
    // Legacy manifests written before the teams field was removed must still parse.
    const legacyData = {
      version: '1.8.0',
      plugins: ['devflow-core-skills'],
      scope: 'user',
      features: { teams: true, ambient: true, memory: true, hud: true, knowledge: false, decisions: false, rules: true, flags: [] },
      installedAt: '2026-03-01T00:00:00.000Z',
      updatedAt: '2026-03-13T00:00:00.000Z',
    };
    await fs.writeFile(path.join(tmpDir, 'manifest.json'), JSON.stringify(legacyData), 'utf-8');
    const result = await readManifest(tmpDir);
    expect(result).not.toBeNull();
    // teams key is silently dropped from the result
    expect((result!.features as Record<string, unknown>)['teams']).toBeUndefined();
    // Other fields preserved
    expect(result!.features.ambient).toBe(true);
    expect(result!.features.memory).toBe(true);
  });

  it('normalizes old manifest without rules to default true', async () => {
    const oldData = {
      version: '2.0.0',
      plugins: ['devflow-core-skills'],
      scope: 'user',
      features: { ambient: true, memory: true, hud: true, knowledge: true, decisions: true, flags: [] },
      installedAt: '2026-03-01T00:00:00.000Z',
      updatedAt: '2026-03-13T00:00:00.000Z',
    };
    await fs.writeFile(path.join(tmpDir, 'manifest.json'), JSON.stringify(oldData), 'utf-8');
    const result = await readManifest(tmpDir);
    expect(result).not.toBeNull();
    expect(result!.features.rules).toBe(true);
  });

  it('normalizes old manifest without hud to defaults', async () => {
    const oldData = {
      version: '1.4.0',
      plugins: ['devflow-core-skills'],
      scope: 'user',
      features: { ambient: true, memory: true },
      installedAt: '2026-03-01T00:00:00.000Z',
      updatedAt: '2026-03-13T00:00:00.000Z',
    };
    await fs.writeFile(path.join(tmpDir, 'manifest.json'), JSON.stringify(oldData), 'utf-8');
    const result = await readManifest(tmpDir);
    expect(result).not.toBeNull();
    expect(result!.features.hud).toBe(false);
    expect(result!.features.knowledge).toBe(false);
    expect(result!.features.learning).toBe(false);
    expect(result!.features.rules).toBe(true);
    // Phase 2: flags migrated from absent (no flags in old JSON) → empty FlagsRecord
    expect(result!.features.flags).toEqual({});
    // learn field no longer exists in manifest
    expect((result!.features as Record<string, unknown>).learn).toBeUndefined();
  });

  it('normalizes old manifest without decisions to default false', async () => {
    const oldData = {
      version: '2.0.0',
      plugins: ['devflow-core-skills'],
      scope: 'user',
      features: { ambient: true, memory: true, hud: true, knowledge: true, flags: [] },
      installedAt: '2026-03-01T00:00:00.000Z',
      updatedAt: '2026-03-13T00:00:00.000Z',
    };
    await fs.writeFile(path.join(tmpDir, 'manifest.json'), JSON.stringify(oldData), 'utf-8');
    const result = await readManifest(tmpDir);
    expect(result).not.toBeNull();
    // 'decisions' was renamed to 'learning' — both absent and old-name fallback to false
    expect(result!.features.learning).toBe(false);
  });

  it('normalizes old manifest without kb to default false', async () => {
    const oldData = {
      version: '1.4.0',
      plugins: ['devflow-core-skills'],
      scope: 'user',
      features: { ambient: true, memory: true, hud: true, flags: [] },
      installedAt: '2026-03-01T00:00:00.000Z',
      updatedAt: '2026-03-13T00:00:00.000Z',
    };
    await fs.writeFile(path.join(tmpDir, 'manifest.json'), JSON.stringify(oldData), 'utf-8');
    const result = await readManifest(tmpDir);
    expect(result).not.toBeNull();
    expect(result!.features.knowledge).toBe(false);
  });

  it('heals features.kb to features.knowledge on disk', async () => {
    const oldData = {
      version: '2.0.0',
      plugins: ['devflow-core-skills'],
      scope: 'user',
      features: { ambient: true, memory: true, hud: true, kb: true, flags: [] },
      installedAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    await fs.writeFile(path.join(tmpDir, 'manifest.json'), JSON.stringify(oldData), 'utf-8');
    const result = await readManifest(tmpDir);
    expect(result).not.toBeNull();
    expect(result!.features.knowledge).toBe(true);

    // Verify the file was healed on disk
    const healed = JSON.parse(await fs.readFile(path.join(tmpDir, 'manifest.json'), 'utf-8'));
    expect(healed.features.knowledge).toBe(true);
    expect(healed.features.kb).toBeUndefined();
  });

  it('normalizes missing viewMode to undefined', async () => {
    const data = {
      version: '1.4.0',
      plugins: ['devflow-core-skills'],
      scope: 'user',
      features: { ambient: true, memory: true, hud: false, knowledge: false, decisions: false, rules: true, flags: [] },
      installedAt: '2026-03-01T00:00:00.000Z',
      updatedAt: '2026-03-13T00:00:00.000Z',
    };
    await fs.writeFile(path.join(tmpDir, 'manifest.json'), JSON.stringify(data), 'utf-8');
    const result = await readManifest(tmpDir);
    expect(result).not.toBeNull();
    expect(result!.features.viewMode).toBeUndefined();
  });

  it('preserves valid viewMode values (verbose, focus, default)', async () => {
    for (const mode of ['verbose', 'focus', 'default'] as const) {
      const data = {
        version: '1.4.0',
        plugins: ['devflow-core-skills'],
        scope: 'user',
        features: { ambient: true, memory: true, hud: false, knowledge: false, decisions: false, rules: true, flags: [], viewMode: mode },
        installedAt: '2026-03-01T00:00:00.000Z',
        updatedAt: '2026-03-13T00:00:00.000Z',
      };
      await fs.writeFile(path.join(tmpDir, 'manifest.json'), JSON.stringify(data), 'utf-8');
      const result = await readManifest(tmpDir);
      expect(result).not.toBeNull();
      // Phase 2: viewMode folded into flags['view-mode']; deprecated field stripped
      expect(result!.features.flags['view-mode']).toBe(mode);
      expect(result!.features.viewMode).toBeUndefined();
    }
  });

  it('normalizes invalid viewMode string to undefined', async () => {
    const data = {
      version: '1.4.0',
      plugins: ['devflow-core-skills'],
      scope: 'user',
      features: { ambient: true, memory: true, hud: false, knowledge: false, decisions: false, rules: true, flags: [], viewMode: 'invalid-mode' },
      installedAt: '2026-03-01T00:00:00.000Z',
      updatedAt: '2026-03-13T00:00:00.000Z',
    };
    await fs.writeFile(path.join(tmpDir, 'manifest.json'), JSON.stringify(data), 'utf-8');
    const result = await readManifest(tmpDir);
    expect(result).not.toBeNull();
    expect(result!.features.viewMode).toBeUndefined();
  });

  it('normalizes non-string viewMode to undefined', async () => {
    const data = {
      version: '1.4.0',
      plugins: ['devflow-core-skills'],
      scope: 'user',
      features: { ambient: true, memory: true, hud: false, knowledge: false, decisions: false, rules: true, flags: [], viewMode: 42 },
      installedAt: '2026-03-01T00:00:00.000Z',
      updatedAt: '2026-03-13T00:00:00.000Z',
    };
    await fs.writeFile(path.join(tmpDir, 'manifest.json'), JSON.stringify(data), 'utf-8');
    const result = await readManifest(tmpDir);
    expect(result).not.toBeNull();
    expect(result!.features.viewMode).toBeUndefined();
  });

  it('parses manifest with security=user', async () => {
    const data = {
      version: '1.4.0',
      plugins: ['devflow-core-skills'],
      scope: 'user',
      features: { ambient: true, memory: true, hud: false, knowledge: false, decisions: false, rules: true, flags: [], security: 'user' },
      installedAt: '2026-03-01T00:00:00.000Z',
      updatedAt: '2026-03-13T00:00:00.000Z',
    };
    await fs.writeFile(path.join(tmpDir, 'manifest.json'), JSON.stringify(data), 'utf-8');
    const result = await readManifest(tmpDir);
    expect(result).not.toBeNull();
    expect(result!.features.security).toBe('user');
  });

  it('parses manifest with security=managed', async () => {
    const data = {
      version: '1.4.0',
      plugins: ['devflow-core-skills'],
      scope: 'user',
      features: { ambient: true, memory: true, hud: false, knowledge: false, decisions: false, rules: true, flags: [], security: 'managed' },
      installedAt: '2026-03-01T00:00:00.000Z',
      updatedAt: '2026-03-13T00:00:00.000Z',
    };
    await fs.writeFile(path.join(tmpDir, 'manifest.json'), JSON.stringify(data), 'utf-8');
    const result = await readManifest(tmpDir);
    expect(result).not.toBeNull();
    expect(result!.features.security).toBe('managed');
  });

  it('parses manifest with security=none', async () => {
    const data = {
      version: '1.4.0',
      plugins: ['devflow-core-skills'],
      scope: 'user',
      features: { ambient: true, memory: true, hud: false, knowledge: false, decisions: false, rules: true, flags: [], security: 'none' },
      installedAt: '2026-03-01T00:00:00.000Z',
      updatedAt: '2026-03-13T00:00:00.000Z',
    };
    await fs.writeFile(path.join(tmpDir, 'manifest.json'), JSON.stringify(data), 'utf-8');
    const result = await readManifest(tmpDir);
    expect(result).not.toBeNull();
    expect(result!.features.security).toBe('none');
  });

  it('normalizes absent security field to undefined (back-compat with pre-Phase-F manifests)', async () => {
    const data = {
      version: '1.4.0',
      plugins: ['devflow-core-skills'],
      scope: 'user',
      features: { ambient: true, memory: true, hud: false, knowledge: false, decisions: false, rules: true, flags: [] },
      installedAt: '2026-03-01T00:00:00.000Z',
      updatedAt: '2026-03-13T00:00:00.000Z',
    };
    await fs.writeFile(path.join(tmpDir, 'manifest.json'), JSON.stringify(data), 'utf-8');
    const result = await readManifest(tmpDir);
    expect(result).not.toBeNull();
    // Pre-Phase-F manifests have no security field → reads as undefined
    expect(result!.features.security).toBeUndefined();
  });

  it('normalizes invalid security value to undefined', async () => {
    const data = {
      version: '1.4.0',
      plugins: ['devflow-core-skills'],
      scope: 'user',
      features: { ambient: true, memory: true, hud: false, knowledge: false, decisions: false, rules: true, flags: [], security: 'invalid-value' },
      installedAt: '2026-03-01T00:00:00.000Z',
      updatedAt: '2026-03-13T00:00:00.000Z',
    };
    await fs.writeFile(path.join(tmpDir, 'manifest.json'), JSON.stringify(data), 'utf-8');
    const result = await readManifest(tmpDir);
    expect(result).not.toBeNull();
    expect(result!.features.security).toBeUndefined();
  });

  it('security field round-trips through write/read', async () => {
    const data: ManifestData = {
      version: '1.4.0',
      plugins: ['devflow-core-skills'],
      scope: 'user',
      features: { ambient: true, memory: true, hud: false, knowledge: false, decisions: false, rules: true, flags: [], security: 'user' },
      installedAt: '2026-03-01T00:00:00.000Z',
      updatedAt: '2026-03-13T00:00:00.000Z',
    };
    await writeManifest(tmpDir, data);
    const result = await readManifest(tmpDir);
    expect(result).not.toBeNull();
    expect(result!.features.security).toBe('user');
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
      features: { ambient: true, memory: true, hud: false, knowledge: false, decisions: false, rules: false, flags: [] },
      installedAt: '2026-03-13T00:00:00.000Z',
      updatedAt: '2026-03-13T00:00:00.000Z',
    };
    await writeManifest(tmpDir, data);
    const content = await fs.readFile(path.join(tmpDir, 'manifest.json'), 'utf-8');
    expect(JSON.parse(content)).toEqual(data);
  });

  it('does NOT include teams field in written output', async () => {
    const data: ManifestData = {
      version: '1.4.0',
      plugins: ['devflow-core-skills'],
      scope: 'user',
      features: { ambient: true, memory: true, hud: false, knowledge: false, decisions: false, rules: false, flags: [] },
      installedAt: '2026-03-13T00:00:00.000Z',
      updatedAt: '2026-03-13T00:00:00.000Z',
    };
    await writeManifest(tmpDir, data);
    const content = JSON.parse(await fs.readFile(path.join(tmpDir, 'manifest.json'), 'utf-8'));
    expect('teams' in (content.features ?? {})).toBe(false);
  });

  it('overwrites existing manifest', async () => {
    const old: ManifestData = {
      version: '1.0.0',
      plugins: ['devflow-core-skills'],
      scope: 'user',
      features: { ambient: false, memory: false, hud: false, knowledge: false, decisions: false, rules: false, flags: [] },
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
      features: { ambient: false, memory: false, hud: false, knowledge: false, decisions: false, rules: false, flags: [] },
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

  it('returns empty array when both inputs are empty', () => {
    const result = mergeManifestPlugins([], []);
    expect(result).toEqual([]);
  });

  it('returns new plugins when existing is empty', () => {
    const result = mergeManifestPlugins([], ['devflow-core-skills', 'devflow-debug']);
    expect(result).toEqual(['devflow-core-skills', 'devflow-debug']);
  });

  it('returns existing plugins when new is empty', () => {
    const result = mergeManifestPlugins(['devflow-core-skills', 'devflow-debug'], []);
    expect(result).toEqual(['devflow-core-skills', 'devflow-debug']);
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

  it('handles unparseable installed version gracefully', () => {
    const result = detectUpgrade('1.4.0', 'garbage');
    expect(result.isUpgrade).toBe(false);
    expect(result.isDowngrade).toBe(false);
    expect(result.isSameVersion).toBe(false);
    expect(result.previousVersion).toBe('garbage');
  });

  it('detects upgrade with v-prefixed current version', () => {
    const result = detectUpgrade('v2.0.0', '1.4.0');
    expect(result.isUpgrade).toBe(true);
    expect(result.isDowngrade).toBe(false);
    expect(result.previousVersion).toBe('1.4.0');
  });

  it('detects upgrade with v-prefixed installed version', () => {
    const result = detectUpgrade('2.0.0', 'v1.4.0');
    expect(result.isUpgrade).toBe(true);
    expect(result.isDowngrade).toBe(false);
    expect(result.previousVersion).toBe('v1.4.0');
  });

  it('detects same version with both v-prefixed', () => {
    const result = detectUpgrade('v1.4.0', 'v1.4.0');
    expect(result.isSameVersion).toBe(true);
    expect(result.isUpgrade).toBe(false);
    expect(result.isDowngrade).toBe(false);
  });

  it('detects downgrade with v-prefixed versions', () => {
    const result = detectUpgrade('v1.0.0', 'v1.4.0');
    expect(result.isDowngrade).toBe(true);
    expect(result.isUpgrade).toBe(false);
  });
});

describe('resolvePluginList', () => {
  const existingManifest: ManifestData = {
    version: '1.0.0',
    plugins: ['devflow-core-skills', 'devflow-implement'],
    scope: 'user',
    features: { ambient: true, memory: true, hud: false, knowledge: false, decisions: false, rules: false, flags: [] },
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

  it('remaps legacy plugin names in existing manifest on partial install', () => {
    const legacyManifest: ManifestData = {
      ...existingManifest,
      plugins: ['devflow-core-skills', 'devflow-frontend-design'],
    };
    const result = resolvePluginList(
      ['devflow-code-review'],
      legacyManifest,
      true,
    );
    expect(result).toEqual(['devflow-core-skills', 'devflow-ui-design', 'devflow-code-review']);
  });
});

describe('syncManifestFeature', () => {
  let tmpDir: string;

  const baseManifest: ManifestData = {
    version: '1.4.0',
    plugins: ['devflow-core-skills'],
    scope: 'user',
    features: {
      ambient: true,
      memory: true,
      hud: false,
      knowledge: false,
      decisions: false,
      rules: true,
      flags: [],
    },
    installedAt: '2026-03-01T00:00:00.000Z',
    updatedAt: '2026-03-01T00:00:00.000Z',
  };

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-sync-feature-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('is a no-op when manifest.json is absent — file must NOT be created', async () => {
    // No manifest.json in tmpDir
    await syncManifestFeature(tmpDir, 'ambient', false);

    // The invariant: toggles never fabricate a manifest from nothing
    let exists = false;
    try {
      await fs.access(path.join(tmpDir, 'manifest.json'));
      exists = true;
    } catch {
      exists = false;
    }
    expect(exists).toBe(false);
  });

  it('updates the target feature field and bumps updatedAt when manifest is present', async () => {
    await writeManifest(tmpDir, baseManifest);

    await syncManifestFeature(tmpDir, 'ambient', false);

    const updated = await readManifest(tmpDir);
    expect(updated).not.toBeNull();
    expect(updated!.features.ambient).toBe(false);
    // updatedAt is refreshed (strictly after the initial value)
    expect(updated!.updatedAt > baseManifest.updatedAt).toBe(true);
    // Other fields are untouched
    expect(updated!.features.memory).toBe(true);
    expect(updated!.features.hud).toBe(false);
    expect(updated!.features.rules).toBe(true);
    expect(updated!.version).toBe('1.4.0');
    expect(updated!.plugins).toEqual(['devflow-core-skills']);
  });

  it('can update the security field in a manifest that has it', async () => {
    const withSecurity: ManifestData = {
      ...baseManifest,
      features: { ...baseManifest.features, security: 'none' },
    };
    await writeManifest(tmpDir, withSecurity);

    await syncManifestFeature(tmpDir, 'security', 'user');

    const updated = await readManifest(tmpDir);
    expect(updated).not.toBeNull();
    expect(updated!.features.security).toBe('user');
  });
});

describe('proxy feature field', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-manifest-proxy-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('self-heals absent proxy field to false', async () => {
    const data = {
      version: '2.0.0',
      plugins: ['devflow-core-skills'],
      scope: 'user',
      features: { ambient: true, memory: true, hud: false, knowledge: false, learning: false, rules: true, flags: [] },
      installedAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    await fs.writeFile(path.join(tmpDir, 'manifest.json'), JSON.stringify(data), 'utf-8');
    const result = await readManifest(tmpDir);
    expect(result).not.toBeNull();
    expect(result!.features.proxy).toBe(false);
  });

  it('preserves proxy: true', async () => {
    const data = {
      version: '2.0.0',
      plugins: ['devflow-core-skills'],
      scope: 'user',
      features: { ambient: true, memory: true, hud: false, knowledge: false, learning: false, rules: true, flags: [], proxy: true },
      installedAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    await fs.writeFile(path.join(tmpDir, 'manifest.json'), JSON.stringify(data), 'utf-8');
    const result = await readManifest(tmpDir);
    expect(result).not.toBeNull();
    expect(result!.features.proxy).toBe(true);
  });

  it('preserves proxy: false', async () => {
    const data = {
      version: '2.0.0',
      plugins: ['devflow-core-skills'],
      scope: 'user',
      features: { ambient: true, memory: true, hud: false, knowledge: false, learning: false, rules: true, flags: [], proxy: false },
      installedAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    await fs.writeFile(path.join(tmpDir, 'manifest.json'), JSON.stringify(data), 'utf-8');
    const result = await readManifest(tmpDir);
    expect(result).not.toBeNull();
    expect(result!.features.proxy).toBe(false);
  });

  it('self-heals non-boolean proxy to false', async () => {
    const data = {
      version: '2.0.0',
      plugins: ['devflow-core-skills'],
      scope: 'user',
      features: { ambient: true, memory: true, hud: false, knowledge: false, learning: false, rules: true, flags: [], proxy: 'yes' },
      installedAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    await fs.writeFile(path.join(tmpDir, 'manifest.json'), JSON.stringify(data), 'utf-8');
    const result = await readManifest(tmpDir);
    expect(result).not.toBeNull();
    expect(result!.features.proxy).toBe(false);
  });

  it('proxy field round-trips through write/read', async () => {
    const data: ManifestData = {
      version: '2.0.0',
      plugins: ['devflow-core-skills'],
      scope: 'user',
      features: { ambient: true, memory: true, hud: false, knowledge: false, learning: false, rules: true, flags: [], proxy: true },
      installedAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    await writeManifest(tmpDir, data);
    const result = await readManifest(tmpDir);
    expect(result).not.toBeNull();
    expect(result!.features.proxy).toBe(true);
  });

  it('syncManifestFeature can toggle proxy', async () => {
    const data: ManifestData = {
      version: '2.0.0',
      plugins: ['devflow-core-skills'],
      scope: 'user',
      features: { ambient: true, memory: true, hud: false, knowledge: false, learning: false, rules: true, flags: [], proxy: false },
      installedAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    await writeManifest(tmpDir, data);
    await syncManifestFeature(tmpDir, 'proxy', true);
    const result = await readManifest(tmpDir);
    expect(result).not.toBeNull();
    expect(result!.features.proxy).toBe(true);
  });
});

describe('knownFlags / knownPlugins schema', () => {
  let tmpDir: string;

  const baseManifest = (): ManifestData => ({
    version: '2.0.0',
    plugins: ['devflow-core-skills', 'devflow-implement'],
    scope: 'user',
    features: {
      ambient: true,
      memory: true,
      hud: false,
      knowledge: false,
      learning: false,
      rules: true,
      // Phase 2: FlagsRecord (was string[])
      flags: { tui: true },
    },
    installedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  });

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-manifest-known-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('write manifest with knownFlags — readManifest strips it (Phase 2 heal)', async () => {
    // Phase 2: knownFlags semantics are encoded in FlagsRecord key-presence.
    // readManifest strips the deprecated knownFlags field on read (needsHeal path).
    const data: ManifestData = {
      ...baseManifest(),
      features: { ...baseManifest().features, knownFlags: ['tui', 'lsp', 'tool-search'] },
    };
    await writeManifest(tmpDir, data);
    const result = await readManifest(tmpDir);
    expect(result).not.toBeNull();
    expect(result!.features.knownFlags).toBeUndefined();
    // flags preserved (baseManifest has { tui: true })
    expect(result!.features.flags).toEqual(expect.objectContaining({ tui: true }));
  });

  it('round-trips knownPlugins through write+read', async () => {
    const data: ManifestData = {
      ...baseManifest(),
      knownPlugins: ['devflow-core-skills', 'devflow-implement', 'devflow-plan'],
    };
    await writeManifest(tmpDir, data);
    const result = await readManifest(tmpDir);
    expect(result).not.toBeNull();
    expect(result!.knownPlugins).toEqual(['devflow-core-skills', 'devflow-implement', 'devflow-plan']);
  });

  it('returns undefined knownFlags when field is absent (pre-7b manifest)', async () => {
    // Write raw JSON without the knownFlags key
    const raw = {
      version: '2.0.0',
      plugins: ['devflow-core-skills'],
      scope: 'user',
      features: { ambient: true, memory: true, hud: false, knowledge: false, learning: false, rules: true, flags: [] },
      installedAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    await fs.writeFile(path.join(tmpDir, 'manifest.json'), JSON.stringify(raw), 'utf-8');
    const result = await readManifest(tmpDir);
    expect(result).not.toBeNull();
    expect(result!.features.knownFlags).toBeUndefined();
  });

  it('returns undefined knownPlugins when field is absent (pre-7b manifest)', async () => {
    const raw = {
      version: '2.0.0',
      plugins: ['devflow-core-skills'],
      scope: 'user',
      features: { ambient: true, memory: true, hud: false, knowledge: false, learning: false, rules: true, flags: [] },
      installedAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    await fs.writeFile(path.join(tmpDir, 'manifest.json'), JSON.stringify(raw), 'utf-8');
    const result = await readManifest(tmpDir);
    expect(result).not.toBeNull();
    expect(result!.knownPlugins).toBeUndefined();
  });

  it('self-heals non-array knownFlags to undefined', async () => {
    const raw = {
      version: '2.0.0',
      plugins: ['devflow-core-skills'],
      scope: 'user',
      features: { ambient: true, memory: true, hud: false, knowledge: false, learning: false, rules: true, flags: [], knownFlags: 'garbage' },
      installedAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    await fs.writeFile(path.join(tmpDir, 'manifest.json'), JSON.stringify(raw), 'utf-8');
    const result = await readManifest(tmpDir);
    expect(result).not.toBeNull();
    expect(result!.features.knownFlags).toBeUndefined();
  });

  it('self-heals mixed-type knownFlags array (non-string elements) to undefined', async () => {
    const raw = {
      version: '2.0.0',
      plugins: ['devflow-core-skills'],
      scope: 'user',
      features: { ambient: true, memory: true, hud: false, knowledge: false, learning: false, rules: true, flags: [], knownFlags: [1, null] },
      installedAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    await fs.writeFile(path.join(tmpDir, 'manifest.json'), JSON.stringify(raw), 'utf-8');
    const result = await readManifest(tmpDir);
    expect(result).not.toBeNull();
    expect(result!.features.knownFlags).toBeUndefined();
  });

  it('self-heals non-array knownPlugins to undefined', async () => {
    const raw = {
      version: '2.0.0',
      plugins: ['devflow-core-skills'],
      scope: 'user',
      knownPlugins: 42,
      features: { ambient: true, memory: true, hud: false, knowledge: false, learning: false, rules: true, flags: [] },
      installedAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    await fs.writeFile(path.join(tmpDir, 'manifest.json'), JSON.stringify(raw), 'utf-8');
    const result = await readManifest(tmpDir);
    expect(result).not.toBeNull();
    expect(result!.knownPlugins).toBeUndefined();
  });

  it('self-heals mixed-type knownPlugins array (non-string elements) to undefined', async () => {
    const raw = {
      version: '2.0.0',
      plugins: ['devflow-core-skills'],
      scope: 'user',
      knownPlugins: [42, 'devflow-core-skills'],
      features: { ambient: true, memory: true, hud: false, knowledge: false, learning: false, rules: true, flags: [] },
      installedAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    await fs.writeFile(path.join(tmpDir, 'manifest.json'), JSON.stringify(raw), 'utf-8');
    const result = await readManifest(tmpDir);
    expect(result).not.toBeNull();
    expect(result!.knownPlugins).toBeUndefined();
  });

  it('write manifest with knownFlags + viewMode — readManifest strips both, folds viewMode into flags', async () => {
    // Phase 2: knownFlags stripped; viewMode folded into flags['view-mode'].
    // Other features fields (security) are preserved unchanged.
    const data: ManifestData = {
      ...baseManifest(),
      features: {
        ...baseManifest().features,
        knownFlags: ['tui'],
        viewMode: 'verbose',
        security: 'user',
      },
    };
    await writeManifest(tmpDir, data);
    const result = await readManifest(tmpDir);
    expect(result).not.toBeNull();
    // Phase 2: knownFlags stripped (semantics encoded in FlagsRecord key-presence)
    expect(result!.features.knownFlags).toBeUndefined();
    // Phase 2: viewMode folded into flags['view-mode']; deprecated field stripped
    expect(result!.features.viewMode).toBeUndefined();
    expect(result!.features.flags['view-mode']).toBe('verbose');
    // Non-flags features preserved
    expect(result!.features.security).toBe('user');
  });
});

describe('compliance feature field', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-manifest-compliance-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('self-heals absent compliance field to {enabled:false, frameworks:[]}', async () => {
    const data = {
      version: '2.0.0',
      plugins: ['devflow-core-skills'],
      scope: 'user',
      features: { ambient: true, memory: true, hud: false, knowledge: false, learning: false, rules: true, flags: [], proxy: false },
      installedAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    await fs.writeFile(path.join(tmpDir, 'manifest.json'), JSON.stringify(data), 'utf-8');
    const result = await readManifest(tmpDir);
    expect(result).not.toBeNull();
    expect(result!.features.compliance).toEqual({ enabled: false, frameworks: [] });
  });

  it('self-heals malformed compliance field', async () => {
    const data = {
      version: '2.0.0',
      plugins: ['devflow-core-skills'],
      scope: 'user',
      features: { ambient: true, memory: true, hud: false, knowledge: false, learning: false, rules: true, flags: [], proxy: false, compliance: 'bad' },
      installedAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    await fs.writeFile(path.join(tmpDir, 'manifest.json'), JSON.stringify(data), 'utf-8');
    const result = await readManifest(tmpDir);
    expect(result).not.toBeNull();
    expect(result!.features.compliance).toEqual({ enabled: false, frameworks: [] });
  });

  it('preserves compliance: {enabled:true, frameworks:["gdpr"]}', async () => {
    const data = {
      version: '2.0.0',
      plugins: ['devflow-core-skills'],
      scope: 'user',
      features: { ambient: true, memory: true, hud: false, knowledge: false, learning: false, rules: true, flags: [], proxy: false, compliance: { enabled: true, frameworks: ['gdpr'] } },
      installedAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    await fs.writeFile(path.join(tmpDir, 'manifest.json'), JSON.stringify(data), 'utf-8');
    const result = await readManifest(tmpDir);
    expect(result).not.toBeNull();
    expect(result!.features.compliance).toEqual({ enabled: true, frameworks: ['gdpr'] });
  });

  it('disable-keeps-frameworks: {enabled:false, frameworks:["hipaa"]} preserved', async () => {
    // Disabling compliance must preserve the selected frameworks so re-enable
    // restores them without requiring re-selection.
    const data = {
      version: '2.0.0',
      plugins: ['devflow-core-skills'],
      scope: 'user',
      features: { ambient: true, memory: true, hud: false, knowledge: false, learning: false, rules: true, flags: [], proxy: false, compliance: { enabled: false, frameworks: ['hipaa'] } },
      installedAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    await fs.writeFile(path.join(tmpDir, 'manifest.json'), JSON.stringify(data), 'utf-8');
    const result = await readManifest(tmpDir);
    expect(result).not.toBeNull();
    expect(result!.features.compliance).toEqual({ enabled: false, frameworks: ['hipaa'] });
  });

  it('compliance field round-trips through writeManifest/readManifest', async () => {
    const data: ManifestData = {
      version: '2.0.0',
      plugins: ['devflow-core-skills'],
      scope: 'user',
      features: {
        ambient: true,
        memory: true,
        hud: false,
        knowledge: false,
        learning: false,
        rules: true,
        flags: [],
        proxy: false,
        compliance: { enabled: true, frameworks: ['gdpr', 'sox'] },
      },
      installedAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    await writeManifest(tmpDir, data);
    const result = await readManifest(tmpDir);
    expect(result).not.toBeNull();
    expect(result!.features.compliance).toEqual({ enabled: true, frameworks: ['gdpr', 'sox'] });
  });
});

// ── Phase 2: FlagsRecord heal round-trip guards ───────────────────────────────

describe('FlagsRecord heal round-trip (Phase 2)', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-manifest-p2-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('canonical makeManifest() round-trips without triggering heal', async () => {
    // makeManifest() uses FlagsRecord + no deprecated fields → no heal cycle → deep-equal.
    const data = makeManifest();
    await writeManifest(tmpDir, data);
    const result = await readManifest(tmpDir);
    expect(result).toEqual(data);
  });

  it('FlagsRecord with false values → deliberate-disable preserved on read', async () => {
    // A flag explicitly set to false is a deliberate user choice — must NOT be auto-enabled.
    const raw = {
      version: '2.0.0',
      plugins: ['devflow-core-skills'],
      scope: 'user',
      features: {
        ambient: true, memory: true, hud: false, knowledge: false, learning: false, rules: true,
        flags: { tui: false, lsp: true, 'tool-search': false },
        proxy: false, compliance: { enabled: false, frameworks: [] },
      },
      installedAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    await fs.writeFile(path.join(tmpDir, 'manifest.json'), JSON.stringify(raw), 'utf-8');
    const result = await readManifest(tmpDir);
    expect(result).not.toBeNull();
    // Deliberate-disable (false) must be preserved — PF-023 sink validation
    expect(result!.features.flags['tui']).toBe(false);
    expect(result!.features.flags['lsp']).toBe(true);
    expect(result!.features.flags['tool-search']).toBe(false);
  });

  it('array→FlagsRecord migration: pre-Phase2 string[] heal is idempotent on second read', async () => {
    // Write a pre-Phase2 manifest (flags as string array).
    // After first read it heals to FlagsRecord; second read must NOT re-trigger heal.
    const raw = {
      version: '2.0.0',
      plugins: ['devflow-core-skills'],
      scope: 'user',
      features: {
        ambient: true, memory: true, hud: false, knowledge: false, learning: false, rules: true,
        flags: ['tui', 'lsp'],
        proxy: false, compliance: { enabled: false, frameworks: [] },
      },
      installedAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    await fs.writeFile(path.join(tmpDir, 'manifest.json'), JSON.stringify(raw), 'utf-8');

    // First read: heals array → FlagsRecord, writes healed manifest to disk
    const result1 = await readManifest(tmpDir);
    expect(result1).not.toBeNull();
    expect(Array.isArray(result1!.features.flags)).toBe(false);

    // Second read: no array → no heal cycle → result is identical
    const result2 = await readManifest(tmpDir);
    expect(result2).not.toBeNull();
    expect(result2).toEqual(result1);
  });

  it('D39: heal-write failure returns migrated manifest (non-null), does not throw', async () => {
    // Write a legacy manifest (array-format flags) that triggers heal-write
    const legacy = {
      version: '2.0.0',
      plugins: ['devflow-core-skills'],
      scope: 'user',
      features: {
        ambient: true, memory: true, hud: false, knowledge: false, learning: false, rules: true,
        flags: ['tui', 'lsp'],  // array format → needs healing
        proxy: false, compliance: { enabled: false, frameworks: [] },
      },
      installedAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    await fs.writeFile(path.join(tmpDir, 'manifest.json'), JSON.stringify(legacy), 'utf-8');

    // Make directory read-only so the heal-write (tmp+rename) fails
    await fs.chmod(tmpDir, 0o555);

    let result: ManifestData | null;
    try {
      result = await readManifest(tmpDir);
    } finally {
      // Restore write permission so afterEach rm can remove the temp dir
      await fs.chmod(tmpDir, 0o755);
    }

    // D39: heal-write failure must NOT return null — migrated in-memory manifest is returned
    expect(result).not.toBeNull();
    // The in-memory manifest has the migrated FlagsRecord (not the legacy array)
    expect(Array.isArray(result!.features.flags)).toBe(false);
    expect(result!.features.flags['tui']).toBe(true);
    expect(result!.features.flags['lsp']).toBe(true);
  });

  it('__proto__ key in flags JSON is stripped by sanitizeFlagsRecord on read', async () => {
    // JSON.parse('{"__proto__": true}') creates an own data property on the parsed object.
    // sanitizeFlagsRecord must skip it to prevent prototype pollution.
    const raw = {
      version: '2.0.0',
      plugins: ['devflow-core-skills'],
      scope: 'user',
      features: {
        ambient: true, memory: true, hud: false, knowledge: false, learning: false, rules: true,
        flags: JSON.parse('{"__proto__": true, "tui": true}'),
        proxy: false, compliance: { enabled: false, frameworks: [] },
      },
      installedAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    await fs.writeFile(path.join(tmpDir, 'manifest.json'), JSON.stringify(raw), 'utf-8');
    const result = await readManifest(tmpDir);
    expect(result).not.toBeNull();
    // tui preserved; __proto__ own-property stripped
    expect(result!.features.flags['tui']).toBe(true);
    expect(Object.hasOwn(result!.features.flags, '__proto__')).toBe(false);
  });
});
