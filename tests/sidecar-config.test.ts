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
  type SidecarConfig,
} from '../src/cli/utils/sidecar-config.js';

describe('getConfigPath', () => {
  it('returns .memory/.sidecar/config.json under project root', () => {
    const result = getConfigPath('/some/project');
    expect(result).toBe('/some/project/.memory/.sidecar/config.json');
  });
});

describe('readConfig', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-sidecar-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns all-true defaults when config file is missing', async () => {
    const config = await readConfig(tmpDir);
    expect(config.memory).toBe(true);
    expect(config.learning).toBe(true);
    expect(config.decisions).toBe(true);
    expect(config.knowledge).toBe(true);
  });

  it('reads a valid config file', async () => {
    const sidecarDir = path.join(tmpDir, '.memory', '.sidecar');
    fs.mkdirSync(sidecarDir, { recursive: true });
    fs.writeFileSync(
      path.join(sidecarDir, 'config.json'),
      JSON.stringify({ memory: false, learning: true, decisions: false, knowledge: true }),
    );

    const config = await readConfig(tmpDir);
    expect(config.memory).toBe(false);
    expect(config.learning).toBe(true);
    expect(config.decisions).toBe(false);
    expect(config.knowledge).toBe(true);
  });

  it('falls back to defaults for missing keys', async () => {
    const sidecarDir = path.join(tmpDir, '.memory', '.sidecar');
    fs.mkdirSync(sidecarDir, { recursive: true });
    fs.writeFileSync(
      path.join(sidecarDir, 'config.json'),
      JSON.stringify({ memory: false }),
    );

    const config = await readConfig(tmpDir);
    expect(config.memory).toBe(false);
    expect(config.learning).toBe(true); // default
    expect(config.decisions).toBe(true); // default
    expect(config.knowledge).toBe(true); // default
  });

  it('returns defaults for malformed JSON', async () => {
    const sidecarDir = path.join(tmpDir, '.memory', '.sidecar');
    fs.mkdirSync(sidecarDir, { recursive: true });
    fs.writeFileSync(path.join(sidecarDir, 'config.json'), 'not json at all');

    const config = await readConfig(tmpDir);
    expect(config.memory).toBe(true);
    expect(config.learning).toBe(true);
    expect(config.decisions).toBe(true);
    expect(config.knowledge).toBe(true);
  });

  it('returns defaults when config is a non-object JSON value', async () => {
    const sidecarDir = path.join(tmpDir, '.memory', '.sidecar');
    fs.mkdirSync(sidecarDir, { recursive: true });
    fs.writeFileSync(path.join(sidecarDir, 'config.json'), '"just a string"');

    const config = await readConfig(tmpDir);
    expect(config.memory).toBe(true);
  });

  it('returns defaults when config is a JSON array', async () => {
    const sidecarDir = path.join(tmpDir, '.memory', '.sidecar');
    fs.mkdirSync(sidecarDir, { recursive: true });
    fs.writeFileSync(path.join(sidecarDir, 'config.json'), '[false, true]');

    const config = await readConfig(tmpDir);
    expect(config.memory).toBe(true);
    expect(config.learning).toBe(true);
    expect(config.decisions).toBe(true);
    expect(config.knowledge).toBe(true);
  });
});

describe('writeConfig', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-sidecar-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates directories and writes config', async () => {
    const config: SidecarConfig = { memory: false, learning: true, decisions: false, knowledge: true };
    await writeConfig(tmpDir, config);

    const configPath = getConfigPath(tmpDir);
    expect(fs.existsSync(configPath)).toBe(true);

    const raw = fs.readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw);
    expect(parsed.memory).toBe(false);
    expect(parsed.learning).toBe(true);
    expect(parsed.decisions).toBe(false);
    expect(parsed.knowledge).toBe(true);
  });

  it('overwrites an existing config', async () => {
    const sidecarDir = path.join(tmpDir, '.memory', '.sidecar');
    fs.mkdirSync(sidecarDir, { recursive: true });
    fs.writeFileSync(
      path.join(sidecarDir, 'config.json'),
      JSON.stringify({ memory: true, learning: true, decisions: true, knowledge: true }),
    );

    const config: SidecarConfig = { memory: false, learning: false, decisions: false, knowledge: false };
    await writeConfig(tmpDir, config);

    const raw = fs.readFileSync(getConfigPath(tmpDir), 'utf-8');
    const parsed = JSON.parse(raw);
    expect(parsed.memory).toBe(false);
    expect(parsed.learning).toBe(false);
  });
});

describe('updateFeature', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-sidecar-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('disables a feature from default-enabled state', async () => {
    await updateFeature(tmpDir, 'memory', false);

    const config = await readConfig(tmpDir);
    expect(config.memory).toBe(false);
    expect(config.learning).toBe(true); // unchanged
    expect(config.decisions).toBe(true); // unchanged
    expect(config.knowledge).toBe(true); // unchanged
  });

  it('enables a feature that was disabled', async () => {
    await updateFeature(tmpDir, 'learning', false);
    await updateFeature(tmpDir, 'learning', true);

    const config = await readConfig(tmpDir);
    expect(config.learning).toBe(true);
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
    expect(config.learning).toBe(true);
    expect(config.decisions).toBe(true);
  });
});

describe('isFeatureEnabled', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-sidecar-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns true by default when config file is missing', async () => {
    expect(await isFeatureEnabled(tmpDir, 'memory')).toBe(true);
    expect(await isFeatureEnabled(tmpDir, 'learning')).toBe(true);
    expect(await isFeatureEnabled(tmpDir, 'decisions')).toBe(true);
    expect(await isFeatureEnabled(tmpDir, 'knowledge')).toBe(true);
  });

  it('returns false after feature is disabled', async () => {
    await updateFeature(tmpDir, 'memory', false);
    expect(await isFeatureEnabled(tmpDir, 'memory')).toBe(false);
  });

  it('returns true after feature is re-enabled', async () => {
    await updateFeature(tmpDir, 'learning', false);
    await updateFeature(tmpDir, 'learning', true);
    expect(await isFeatureEnabled(tmpDir, 'learning')).toBe(true);
  });

  it('checks the correct feature key independently', async () => {
    await updateFeature(tmpDir, 'decisions', false);
    expect(await isFeatureEnabled(tmpDir, 'memory')).toBe(true);
    expect(await isFeatureEnabled(tmpDir, 'decisions')).toBe(false);
  });
});
