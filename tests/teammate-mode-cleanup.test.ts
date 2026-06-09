import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import { writeFile } from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import {
  stripDevflowTeammateModeFromJson,
  stripDevflowTeammateMode,
} from '../src/cli/utils/teammate-mode-cleanup.js';

// vi.mock is auto-hoisted before imports so the production module's named
// writeFile binding resolves through this intercepted module copy.
// writeFile is wrapped as vi.fn (delegates to real by default) so individual
// tests can override it with mockRejectedValueOnce for uid-independent failure
// simulation (avoids PF-004 test fragility from chmod-based root bypass).
vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs/promises')>();
  return { ...actual, writeFile: vi.fn(actual.writeFile) };
});

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

  it('returns input unchanged and does not throw for valid-JSON non-object roots (null, array, primitive)', () => {
    // Regression for JSON.parse("null") → null → null['teammateMode'] TypeError.
    // These inputs parse successfully but must be treated as no-ops because only
    // plain-object roots can carry the key.
    expect(stripDevflowTeammateModeFromJson('null')).toBe('null');
    expect(stripDevflowTeammateModeFromJson('[]')).toBe('[]');
    expect(stripDevflowTeammateModeFromJson('42')).toBe('42');
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

    // Reject deterministically via vi.mocked — chmod(0o444) is bypassed by root
    // (common in CI Docker), making that approach uid-dependent. The vi.mock at
    // module level routes the production module's writeFile through this mocked
    // copy so mockRejectedValueOnce intercepts exactly one call.
    const writeError = new Error('EACCES: permission denied') as NodeJS.ErrnoException;
    writeError.code = 'EACCES';
    vi.mocked(writeFile).mockRejectedValueOnce(writeError);

    await expect(stripDevflowTeammateMode(settingsPath)).rejects.toThrow();
  });
});
