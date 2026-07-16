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
  type FeatureConfig,
} from '../src/cli/utils/feature-config.js';

describe('getConfigPath', () => {
  it('returns .devflow/config.json under project root', () => {
    const result = getConfigPath('/some/project');
    expect(result).toBe('/some/project/.devflow/config.json');
  });
});

describe('readConfig', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-feature-config-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns all-true defaults when config file is missing', async () => {
    const config = await readConfig(tmpDir);
    expect(config.memory).toBe(true);
    expect(config.learning).toBe(true);
    expect(config.knowledge).toBe(true);
  });

  it('reads a valid config file', async () => {
    const devflowDir = path.join(tmpDir, '.devflow');
    fs.mkdirSync(devflowDir, { recursive: true });
    fs.writeFileSync(
      path.join(devflowDir, 'config.json'),
      JSON.stringify({ memory: false, learning: false, knowledge: true }),
    );

    const config = await readConfig(tmpDir);
    expect(config.memory).toBe(false);
    expect(config.learning).toBe(false);
    expect(config.knowledge).toBe(true);
  });

  it('falls back to defaults for missing keys', async () => {
    const devflowDir = path.join(tmpDir, '.devflow');
    fs.mkdirSync(devflowDir, { recursive: true });
    fs.writeFileSync(
      path.join(devflowDir, 'config.json'),
      JSON.stringify({ memory: false }),
    );

    const config = await readConfig(tmpDir);
    expect(config.memory).toBe(false);
    expect(config.learning).toBe(true); // default
    expect(config.knowledge).toBe(true); // default
  });

  it('returns defaults for malformed JSON', async () => {
    const devflowDir = path.join(tmpDir, '.devflow');
    fs.mkdirSync(devflowDir, { recursive: true });
    fs.writeFileSync(path.join(devflowDir, 'config.json'), 'not json at all');

    const config = await readConfig(tmpDir);
    expect(config.memory).toBe(true);
    expect(config.learning).toBe(true);
    expect(config.knowledge).toBe(true);
  });

  it('returns defaults when config is a non-object JSON value', async () => {
    const devflowDir = path.join(tmpDir, '.devflow');
    fs.mkdirSync(devflowDir, { recursive: true });
    fs.writeFileSync(path.join(devflowDir, 'config.json'), '"just a string"');

    const config = await readConfig(tmpDir);
    expect(config.memory).toBe(true);
  });

  it('returns defaults when config is a JSON array', async () => {
    const devflowDir = path.join(tmpDir, '.devflow');
    fs.mkdirSync(devflowDir, { recursive: true });
    fs.writeFileSync(path.join(devflowDir, 'config.json'), '[false, true]');

    const config = await readConfig(tmpDir);
    expect(config.memory).toBe(true);
    expect(config.learning).toBe(true);
    expect(config.knowledge).toBe(true);
  });

  // AC-9 (clean break): old dream/config.json alone (no .devflow/config.json) → DEFAULT_CONFIG
  // The consolidate-dream-decisions-to-learning-v1 migration writes .devflow/config.json at init time;
  // readConfig no longer falls back (ADR-001 clean break).
  it('AC-9: only dream/config.json present (no .devflow/config.json) → returns DEFAULT_CONFIG', async () => {
    const dreamDir = path.join(tmpDir, '.devflow', 'dream');
    fs.mkdirSync(dreamDir, { recursive: true });
    fs.writeFileSync(
      path.join(dreamDir, 'config.json'),
      JSON.stringify({ memory: false, learning: false, knowledge: false }),
    );
    // No .devflow/config.json present — fallback removed (ADR-001).
    const config = await readConfig(tmpDir);
    expect(config.memory).toBe(true);    // DEFAULT_CONFIG: memory:true
    expect(config.learning).toBe(true);  // DEFAULT_CONFIG: learning:true
    expect(config.knowledge).toBe(true); // DEFAULT_CONFIG: knowledge:true
  });

  // Coalesce: legacy decisions key wins over learning key when both present
  it('coerceConfig: decisions wins over learning when both present', async () => {
    const devflowDir = path.join(tmpDir, '.devflow');
    fs.mkdirSync(devflowDir, { recursive: true });
    fs.writeFileSync(
      path.join(devflowDir, 'config.json'),
      JSON.stringify({ memory: true, learning: true, decisions: false, knowledge: true }),
    );

    const config = await readConfig(tmpDir);
    // decisions: false wins over learning: true
    expect(config.learning).toBe(false);
    expect(config.memory).toBe(true);
    expect(config.knowledge).toBe(true);
  });

  // Coalesce: decisions key alone (no learning key) is read correctly
  it('coerceConfig: legacy decisions key alone is coalesced into learning', async () => {
    const devflowDir = path.join(tmpDir, '.devflow');
    fs.mkdirSync(devflowDir, { recursive: true });
    fs.writeFileSync(
      path.join(devflowDir, 'config.json'),
      JSON.stringify({ memory: true, decisions: false, knowledge: true }),
    );

    const config = await readConfig(tmpDir);
    expect(config.learning).toBe(false); // from legacy decisions key
    expect(config.memory).toBe(true);
    expect(config.knowledge).toBe(true);
    // decisions key must not appear in the result type
    expect((config as Record<string, unknown>).decisions).toBeUndefined();
  });

  // Coalesce: autoCommit silently ignored
  it('coerceConfig silently ignores legacy autoCommit key', async () => {
    const devflowDir = path.join(tmpDir, '.devflow');
    fs.mkdirSync(devflowDir, { recursive: true });
    fs.writeFileSync(
      path.join(devflowDir, 'config.json'),
      JSON.stringify({ memory: false, learning: false, knowledge: true, autoCommit: true }),
    );

    const config = await readConfig(tmpDir);
    expect(config.memory).toBe(false);
    expect(config.learning).toBe(false);
    expect(config.knowledge).toBe(true);
    expect((config as Record<string, unknown>).autoCommit).toBeUndefined();
  });
});

describe('writeConfig', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-feature-config-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates directories and writes config', async () => {
    const config: FeatureConfig = { memory: false, learning: false, knowledge: true };
    await writeConfig(tmpDir, config);

    const configPath = getConfigPath(tmpDir);
    expect(fs.existsSync(configPath)).toBe(true);

    const raw = fs.readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw);
    expect(parsed.memory).toBe(false);
    expect(parsed.learning).toBe(false);
    expect(parsed.knowledge).toBe(true);
    expect(parsed.decisions).toBeUndefined(); // old key not written
  });

  it('writes to .devflow/config.json (neutral root, not inside learning/)', async () => {
    const config: FeatureConfig = { memory: true, learning: true, knowledge: true };
    await writeConfig(tmpDir, config);
    // Verify it wrote to .devflow/config.json, not sidecar/ or dream/ or learning/
    expect(fs.existsSync(path.join(tmpDir, '.devflow', 'config.json'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, '.devflow', 'learning', 'config.json'))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, '.devflow', 'dream', 'config.json'))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, '.devflow', 'sidecar', 'config.json'))).toBe(false);
  });

  it('overwrites an existing config', async () => {
    const devflowDir = path.join(tmpDir, '.devflow');
    fs.mkdirSync(devflowDir, { recursive: true });
    fs.writeFileSync(
      path.join(devflowDir, 'config.json'),
      JSON.stringify({ memory: true, learning: true, knowledge: true }),
    );

    const config: FeatureConfig = { memory: false, learning: false, knowledge: false };
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
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-feature-config-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('disables a feature from default-enabled state', async () => {
    await updateFeature(tmpDir, 'memory', false);

    const config = await readConfig(tmpDir);
    expect(config.memory).toBe(false);
    expect(config.learning).toBe(true); // unchanged
    expect(config.knowledge).toBe(true); // unchanged
  });

  it('enables a feature that was disabled', async () => {
    await updateFeature(tmpDir, 'learning', false);
    await updateFeature(tmpDir, 'learning', true);

    const config = await readConfig(tmpDir);
    expect(config.learning).toBe(true);
  });

  it('is idempotent — disabling twice stays disabled', async () => {
    await updateFeature(tmpDir, 'learning', false);
    await updateFeature(tmpDir, 'learning', false);

    const config = await readConfig(tmpDir);
    expect(config.learning).toBe(false);
  });

  it('updates only the specified feature key', async () => {
    await updateFeature(tmpDir, 'knowledge', false);

    const config = await readConfig(tmpDir);
    expect(config.knowledge).toBe(false);
    expect(config.memory).toBe(true);
    expect(config.learning).toBe(true);
  });
});

describe('isFeatureEnabled', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-feature-config-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns true by default when config file is missing', async () => {
    expect(await isFeatureEnabled(tmpDir, 'memory')).toBe(true);
    expect(await isFeatureEnabled(tmpDir, 'learning')).toBe(true);
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
    await updateFeature(tmpDir, 'learning', false);
    expect(await isFeatureEnabled(tmpDir, 'memory')).toBe(true);
    expect(await isFeatureEnabled(tmpDir, 'learning')).toBe(false);
  });
});

describe('writeConfig atomic pattern', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-feature-config-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes valid JSON readable by readConfig (atomic pattern produces correct output)', async () => {
    const config: FeatureConfig = { memory: false, learning: false, knowledge: true };
    await writeConfig(tmpDir, config);

    // readConfig should be able to read the atomically-written config
    const read = await readConfig(tmpDir);
    expect(read.memory).toBe(false);
    expect(read.learning).toBe(false);
    expect(read.knowledge).toBe(true);
  });

  it('leaves no .tmp.* files behind after successful write', async () => {
    const config: FeatureConfig = { memory: true, learning: true, knowledge: false };
    await writeConfig(tmpDir, config);

    const devflowDir = path.join(tmpDir, '.devflow');
    const files = fs.readdirSync(devflowDir);
    const tmpFiles = files.filter(f => f.includes('.tmp.'));
    expect(tmpFiles).toHaveLength(0);
  });

  it('overwrites previous config atomically', async () => {
    await writeConfig(tmpDir, { memory: true, learning: true, knowledge: true });
    await writeConfig(tmpDir, { memory: false, learning: false, knowledge: false });

    const read = await readConfig(tmpDir);
    expect(read.memory).toBe(false);
    expect(read.learning).toBe(false);
  });
});
