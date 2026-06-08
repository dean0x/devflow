import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  stripDevflowTeammateMode,
  stripDevflowTeammateModeAsync,
} from '../src/cli/utils/teammate-mode-cleanup.js';

describe('stripDevflowTeammateMode (sync)', () => {
  let tmpDir: string;
  let settingsPath: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-teammate-cleanup-'));
    settingsPath = path.join(tmpDir, 'settings.json');
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('removes teammateMode when value is exactly "auto"', async () => {
    const settings = {
      hooks: { Stop: [] },
      teammateMode: 'auto',
      env: { ENABLE_TOOL_SEARCH: 'true' },
    };
    await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');

    stripDevflowTeammateMode(settingsPath);

    const result = JSON.parse(await fs.readFile(settingsPath, 'utf-8'));
    expect(result.teammateMode).toBeUndefined();
    // Other settings preserved
    expect(result.hooks).toEqual({ Stop: [] });
    expect(result.env.ENABLE_TOOL_SEARCH).toBe('true');
  });

  it('preserves teammateMode when value is "tmux" (user-set)', async () => {
    const settings = { teammateMode: 'tmux', hooks: {} };
    await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');

    stripDevflowTeammateMode(settingsPath);

    const result = JSON.parse(await fs.readFile(settingsPath, 'utf-8'));
    expect(result.teammateMode).toBe('tmux');
  });

  it('preserves teammateMode when value is "in-process" (user-set)', async () => {
    const settings = { teammateMode: 'in-process', hooks: {} };
    await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');

    stripDevflowTeammateMode(settingsPath);

    const result = JSON.parse(await fs.readFile(settingsPath, 'utf-8'));
    expect(result.teammateMode).toBe('in-process');
  });

  it('is a no-op when teammateMode key is absent', async () => {
    const settings = { hooks: { Stop: [] }, env: { TOOL: 'true' } };
    const original = JSON.stringify(settings, null, 2);
    await fs.writeFile(settingsPath, original, 'utf-8');

    stripDevflowTeammateMode(settingsPath);

    const content = await fs.readFile(settingsPath, 'utf-8');
    expect(JSON.parse(content)).toEqual(settings);
  });

  it('is a no-op when file does not exist (ENOENT-safe)', () => {
    const missing = path.join(tmpDir, 'nonexistent.json');
    // Must not throw
    expect(() => stripDevflowTeammateMode(missing)).not.toThrow();
  });

  it('is a no-op for malformed JSON (tolerant)', async () => {
    await fs.writeFile(settingsPath, 'not valid json {{{', 'utf-8');
    // Must not throw
    expect(() => stripDevflowTeammateMode(settingsPath)).not.toThrow();
    // File left unchanged
    const content = await fs.readFile(settingsPath, 'utf-8');
    expect(content).toBe('not valid json {{{');
  });

  it('is idempotent — running twice is safe', async () => {
    const settings = { teammateMode: 'auto', env: { TOOL: 'true' } };
    await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');

    stripDevflowTeammateMode(settingsPath);
    stripDevflowTeammateMode(settingsPath); // second call — no-op

    const result = JSON.parse(await fs.readFile(settingsPath, 'utf-8'));
    expect(result.teammateMode).toBeUndefined();
    expect(result.env.TOOL).toBe('true');
  });
});

describe('stripDevflowTeammateModeAsync (async)', () => {
  let tmpDir: string;
  let settingsPath: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-teammate-async-'));
    settingsPath = path.join(tmpDir, 'settings.json');
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('removes teammateMode when value is exactly "auto"', async () => {
    const settings = { teammateMode: 'auto', hooks: { Stop: [] }, env: { TOOL: 'true' } };
    await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');

    await stripDevflowTeammateModeAsync(settingsPath);

    const result = JSON.parse(await fs.readFile(settingsPath, 'utf-8'));
    expect(result.teammateMode).toBeUndefined();
    expect(result.hooks).toEqual({ Stop: [] });
    expect(result.env.TOOL).toBe('true');
  });

  it('preserves non-"auto" teammateMode values', async () => {
    const settings = { teammateMode: 'tmux' };
    await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');

    await stripDevflowTeammateModeAsync(settingsPath);

    const result = JSON.parse(await fs.readFile(settingsPath, 'utf-8'));
    expect(result.teammateMode).toBe('tmux');
  });

  it('is a no-op when file does not exist (ENOENT-safe)', async () => {
    const missing = path.join(tmpDir, 'nonexistent.json');
    await expect(stripDevflowTeammateModeAsync(missing)).resolves.not.toThrow();
  });

  it('is a no-op for malformed JSON', async () => {
    await fs.writeFile(settingsPath, '{invalid}', 'utf-8');
    await expect(stripDevflowTeammateModeAsync(settingsPath)).resolves.not.toThrow();
    const content = await fs.readFile(settingsPath, 'utf-8');
    expect(content).toBe('{invalid}');
  });

  it('has same semantics as sync variant (parallel correctness)', async () => {
    const settings = { teammateMode: 'auto', otherKey: 'value' };
    await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');

    await stripDevflowTeammateModeAsync(settingsPath);

    const result = JSON.parse(await fs.readFile(settingsPath, 'utf-8'));
    expect(result.teammateMode).toBeUndefined();
    expect(result.otherKey).toBe('value');
  });
});
