import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  stripDevflowTeammateModeFromJson,
  stripDevflowTeammateMode,
} from '../src/cli/utils/teammate-mode-cleanup.js';

describe('stripDevflowTeammateModeFromJson (string pipeline)', () => {
  it('removes teammateMode when value is exactly "auto"', () => {
    const input = JSON.stringify({ teammateMode: 'auto', env: { TOOL: 'true' } }, null, 2) + '\n';
    const result = JSON.parse(stripDevflowTeammateModeFromJson(input));
    expect(result.teammateMode).toBeUndefined();
    expect(result.env.TOOL).toBe('true');
  });

  it('preserves teammateMode when value is not "auto"', () => {
    const input = JSON.stringify({ teammateMode: 'tmux' }, null, 2) + '\n';
    const output = stripDevflowTeammateModeFromJson(input);
    expect(JSON.parse(output).teammateMode).toBe('tmux');
  });

  it('is a no-op when teammateMode key is absent', () => {
    const input = JSON.stringify({ hooks: { Stop: [] } }, null, 2) + '\n';
    expect(stripDevflowTeammateModeFromJson(input)).toBe(input);
  });

  it('returns input unchanged for malformed JSON', () => {
    const bad = 'not valid json {{{';
    expect(stripDevflowTeammateModeFromJson(bad)).toBe(bad);
  });
});

describe('stripDevflowTeammateMode (async)', () => {
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

    await stripDevflowTeammateMode(settingsPath);

    const result = JSON.parse(await fs.readFile(settingsPath, 'utf-8'));
    expect(result.teammateMode).toBeUndefined();
    // Other settings preserved
    expect(result.hooks).toEqual({ Stop: [] });
    expect(result.env.ENABLE_TOOL_SEARCH).toBe('true');
  });

  it('preserves teammateMode when value is "tmux" (user-set)', async () => {
    const settings = { teammateMode: 'tmux', hooks: {} };
    await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');

    await stripDevflowTeammateMode(settingsPath);

    const result = JSON.parse(await fs.readFile(settingsPath, 'utf-8'));
    expect(result.teammateMode).toBe('tmux');
  });

  it('preserves teammateMode when value is "in-process" (user-set)', async () => {
    const settings = { teammateMode: 'in-process', hooks: {} };
    await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');

    await stripDevflowTeammateMode(settingsPath);

    const result = JSON.parse(await fs.readFile(settingsPath, 'utf-8'));
    expect(result.teammateMode).toBe('in-process');
  });

  it('is a no-op when teammateMode key is absent', async () => {
    const settings = { hooks: { Stop: [] }, env: { TOOL: 'true' } };
    const original = JSON.stringify(settings, null, 2);
    await fs.writeFile(settingsPath, original, 'utf-8');

    await stripDevflowTeammateMode(settingsPath);

    const content = await fs.readFile(settingsPath, 'utf-8');
    expect(JSON.parse(content)).toEqual(settings);
  });

  it('is a no-op when file does not exist (ENOENT-safe)', async () => {
    const missing = path.join(tmpDir, 'nonexistent.json');
    // Must not throw
    await expect(stripDevflowTeammateMode(missing)).resolves.not.toThrow();
  });

  it('is a no-op for malformed JSON (tolerant)', async () => {
    await fs.writeFile(settingsPath, 'not valid json {{{', 'utf-8');
    // Must not throw
    await expect(stripDevflowTeammateMode(settingsPath)).resolves.not.toThrow();
    // File left unchanged
    const content = await fs.readFile(settingsPath, 'utf-8');
    expect(content).toBe('not valid json {{{');
  });

  it('is idempotent — running twice is safe', async () => {
    const settings = { teammateMode: 'auto', env: { TOOL: 'true' } };
    await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');

    await stripDevflowTeammateMode(settingsPath);
    await stripDevflowTeammateMode(settingsPath); // second call — no-op

    const result = JSON.parse(await fs.readFile(settingsPath, 'utf-8'));
    expect(result.teammateMode).toBeUndefined();
    expect(result.env.TOOL).toBe('true');
  });

  it('propagates write errors (avoids PF-004: swallowed failure masks failed migration)', async () => {
    // Write a valid file with teammateMode:"auto" so a write is attempted.
    const settings = { teammateMode: 'auto' };
    await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');

    // Make the file read-only so readFile succeeds but writeFile rejects.
    await fs.chmod(settingsPath, 0o444);

    try {
      await expect(stripDevflowTeammateMode(settingsPath)).rejects.toThrow();
    } finally {
      // Restore permissions so afterEach cleanup can delete the temp dir.
      await fs.chmod(settingsPath, 0o644);
    }
  });
});
