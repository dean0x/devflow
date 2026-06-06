import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  getConfigPath,
  readConfig,
  writeConfig,
  updateFeature,
  isFeatureEnabled,
  type DreamConfig,
} from '../src/cli/utils/dream-config.js';

describe('getConfigPath', () => {
  it('returns .devflow/dream/config.json under project root', () => {
    const result = getConfigPath('/some/project');
    expect(result).toBe('/some/project/.devflow/dream/config.json');
  });
});

describe('readConfig', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-dream-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns all-true defaults when config file is missing', async () => {
    const config = await readConfig(tmpDir);
    expect(config.memory).toBe(true);
    expect(config.decisions).toBe(true);
    expect(config.knowledge).toBe(true);
  });

  it('reads a valid config file', async () => {
    const dreamDir = path.join(tmpDir, '.devflow', 'dream');
    fs.mkdirSync(dreamDir, { recursive: true });
    fs.writeFileSync(
      path.join(dreamDir, 'config.json'),
      JSON.stringify({ memory: false, decisions: false, knowledge: true }),
    );

    const config = await readConfig(tmpDir);
    expect(config.memory).toBe(false);
    expect(config.decisions).toBe(false);
    expect(config.knowledge).toBe(true);
  });

  it('falls back to defaults for missing keys', async () => {
    const dreamDir = path.join(tmpDir, '.devflow', 'dream');
    fs.mkdirSync(dreamDir, { recursive: true });
    fs.writeFileSync(
      path.join(dreamDir, 'config.json'),
      JSON.stringify({ memory: false }),
    );

    const config = await readConfig(tmpDir);
    expect(config.memory).toBe(false);
    expect(config.decisions).toBe(true); // default
    expect(config.knowledge).toBe(true); // default
  });

  it('returns defaults for malformed JSON', async () => {
    const dreamDir = path.join(tmpDir, '.devflow', 'dream');
    fs.mkdirSync(dreamDir, { recursive: true });
    fs.writeFileSync(path.join(dreamDir, 'config.json'), 'not json at all');

    const config = await readConfig(tmpDir);
    expect(config.memory).toBe(true);
    expect(config.decisions).toBe(true);
    expect(config.knowledge).toBe(true);
  });

  it('returns defaults when config is a non-object JSON value', async () => {
    const dreamDir = path.join(tmpDir, '.devflow', 'dream');
    fs.mkdirSync(dreamDir, { recursive: true });
    fs.writeFileSync(path.join(dreamDir, 'config.json'), '"just a string"');

    const config = await readConfig(tmpDir);
    expect(config.memory).toBe(true);
  });

  it('returns defaults when config is a JSON array', async () => {
    const dreamDir = path.join(tmpDir, '.devflow', 'dream');
    fs.mkdirSync(dreamDir, { recursive: true });
    fs.writeFileSync(path.join(dreamDir, 'config.json'), '[false, true]');

    const config = await readConfig(tmpDir);
    expect(config.memory).toBe(true);
    expect(config.decisions).toBe(true);
    expect(config.knowledge).toBe(true);
  });

  // AC-9 (clean break): sidecar/config.json alone (no dream/config.json) → DEFAULT_CONFIG
  // The rename-sidecar-to-dream-v1 migration moves sidecar/config.json at init time;
  // readConfig no longer falls back (ADR-001 clean break).
  it('AC-9: only sidecar/config.json present (no dream/config.json) → returns DEFAULT_CONFIG', async () => {
    const sidecarDir = path.join(tmpDir, '.devflow', 'sidecar');
    fs.mkdirSync(sidecarDir, { recursive: true });
    fs.writeFileSync(
      path.join(sidecarDir, 'config.json'),
      JSON.stringify({ memory: false, decisions: false, knowledge: false }),
    );
    // No .devflow/dream/config.json present — fallback removed (ADR-001).
    const config = await readConfig(tmpDir);
    expect(config.memory).toBe(true);    // DEFAULT_CONFIG: memory:true
    expect(config.decisions).toBe(true); // DEFAULT_CONFIG: decisions:true
    expect(config.knowledge).toBe(true); // DEFAULT_CONFIG: knowledge:true
  });

  it('coerceConfig silently ignores legacy learning key (AC-C3)', async () => {
    const dreamDir = path.join(tmpDir, '.devflow', 'dream');
    fs.mkdirSync(dreamDir, { recursive: true });
    fs.writeFileSync(
      path.join(dreamDir, 'config.json'),
      JSON.stringify({ memory: false, learning: true, decisions: false, knowledge: true }),
    );

    // Should not throw — learning key is silently ignored
    const config = await readConfig(tmpDir);
    expect(config.memory).toBe(false);
    expect(config.decisions).toBe(false);
    expect(config.knowledge).toBe(true);
    // learning key must not appear in the result type
    expect((config as Record<string, unknown>).learning).toBeUndefined();
  });
});

describe('writeConfig', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-dream-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates directories and writes config', async () => {
    const config: DreamConfig = { memory: false, decisions: false, knowledge: true };
    await writeConfig(tmpDir, config);

    const configPath = getConfigPath(tmpDir);
    expect(fs.existsSync(configPath)).toBe(true);

    const raw = fs.readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw);
    expect(parsed.memory).toBe(false);
    expect(parsed.decisions).toBe(false);
    expect(parsed.knowledge).toBe(true);
    expect(parsed.learning).toBeUndefined(); // no longer written
  });

  it('writes to .devflow/dream/ directory', async () => {
    const config: DreamConfig = { memory: true, decisions: true, knowledge: true };
    await writeConfig(tmpDir, config);
    // Verify it wrote to dream/, not sidecar/
    expect(fs.existsSync(path.join(tmpDir, '.devflow', 'dream', 'config.json'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, '.devflow', 'sidecar', 'config.json'))).toBe(false);
  });

  it('overwrites an existing config', async () => {
    const dreamDir = path.join(tmpDir, '.devflow', 'dream');
    fs.mkdirSync(dreamDir, { recursive: true });
    fs.writeFileSync(
      path.join(dreamDir, 'config.json'),
      JSON.stringify({ memory: true, decisions: true, knowledge: true }),
    );

    const config: DreamConfig = { memory: false, decisions: false, knowledge: false };
    await writeConfig(tmpDir, config);

    const raw = fs.readFileSync(getConfigPath(tmpDir), 'utf-8');
    const parsed = JSON.parse(raw);
    expect(parsed.memory).toBe(false);
    expect(parsed.decisions).toBe(false);
  });
});

describe('updateFeature', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-dream-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('disables a feature from default-enabled state', async () => {
    await updateFeature(tmpDir, 'memory', false);

    const config = await readConfig(tmpDir);
    expect(config.memory).toBe(false);
    expect(config.decisions).toBe(true); // unchanged
    expect(config.knowledge).toBe(true); // unchanged
  });

  it('enables a feature that was disabled', async () => {
    await updateFeature(tmpDir, 'decisions', false);
    await updateFeature(tmpDir, 'decisions', true);

    const config = await readConfig(tmpDir);
    expect(config.decisions).toBe(true);
  });

  it('is idempotent — disabling twice stays disabled', async () => {
    await updateFeature(tmpDir, 'decisions', false);
    await updateFeature(tmpDir, 'decisions', false);

    const config = await readConfig(tmpDir);
    expect(config.decisions).toBe(false);
  });

  it('updates only the specified feature key', async () => {
    await updateFeature(tmpDir, 'knowledge', false);

    const config = await readConfig(tmpDir);
    expect(config.knowledge).toBe(false);
    expect(config.memory).toBe(true);
    expect(config.decisions).toBe(true);
  });
});

describe('isFeatureEnabled', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-dream-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns true by default when config file is missing', async () => {
    expect(await isFeatureEnabled(tmpDir, 'memory')).toBe(true);
    expect(await isFeatureEnabled(tmpDir, 'decisions')).toBe(true);
    expect(await isFeatureEnabled(tmpDir, 'knowledge')).toBe(true);
  });

  it('returns false after feature is disabled', async () => {
    await updateFeature(tmpDir, 'memory', false);
    expect(await isFeatureEnabled(tmpDir, 'memory')).toBe(false);
  });

  it('returns true after feature is re-enabled', async () => {
    await updateFeature(tmpDir, 'decisions', false);
    await updateFeature(tmpDir, 'decisions', true);
    expect(await isFeatureEnabled(tmpDir, 'decisions')).toBe(true);
  });

  it('checks the correct feature key independently', async () => {
    await updateFeature(tmpDir, 'decisions', false);
    expect(await isFeatureEnabled(tmpDir, 'memory')).toBe(true);
    expect(await isFeatureEnabled(tmpDir, 'decisions')).toBe(false);
  });
});

describe('writeConfig atomic pattern', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-dream-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes valid JSON readable by readConfig (atomic pattern produces correct output)', async () => {
    const config: DreamConfig = { memory: false, decisions: false, knowledge: true };
    await writeConfig(tmpDir, config);

    // readConfig should be able to read the atomically-written config
    const read = await readConfig(tmpDir);
    expect(read.memory).toBe(false);
    expect(read.decisions).toBe(false);
    expect(read.knowledge).toBe(true);
  });

  it('leaves no .tmp.* files behind after successful write', async () => {
    const config: DreamConfig = { memory: true, decisions: true, knowledge: false };
    await writeConfig(tmpDir, config);

    const dreamDir = path.join(tmpDir, '.devflow', 'dream');
    const files = fs.readdirSync(dreamDir);
    const tmpFiles = files.filter(f => f.includes('.tmp.'));
    expect(tmpFiles).toHaveLength(0);
  });

  it('overwrites previous config atomically', async () => {
    await writeConfig(tmpDir, { memory: true, decisions: true, knowledge: true });
    await writeConfig(tmpDir, { memory: false, decisions: false, knowledge: false });

    const read = await readConfig(tmpDir);
    expect(read.memory).toBe(false);
    expect(read.decisions).toBe(false);
  });
});
