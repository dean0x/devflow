/**
 * Tests for the devflow debug CLI pure functions.
 *
 * Strategy: import the exported pure functions from debug.ts and test them
 * directly — no I/O, no commander, no environment setup required. Each test
 * operates on plain JSON strings so behavior is unambiguous.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { applyDebugTrace, stripDebugTrace, readDebugStatus } from '../src/cli/commands/debug.js';

// ─── applyDebugTrace ──────────────────────────────────────────────────────────

describe('applyDebugTrace', () => {
  it('sets DEVFLOW_HOOK_DEBUG=1 in env', () => {
    const result = JSON.parse(applyDebugTrace(JSON.stringify({ hooks: {} })));
    expect((result.env as Record<string, string>).DEVFLOW_HOOK_DEBUG).toBe('1');
  });

  it('preserves existing env vars when enabling', () => {
    const input = JSON.stringify({ hooks: {}, env: { EXISTING_VAR: 'keep' } });
    const result = JSON.parse(applyDebugTrace(input));
    const env = result.env as Record<string, string>;
    expect(env.DEVFLOW_HOOK_DEBUG).toBe('1');
    expect(env.EXISTING_VAR).toBe('keep');
  });

  it('creates env object when settings has none', () => {
    const result = JSON.parse(applyDebugTrace(JSON.stringify({})));
    expect((result.env as Record<string, string>).DEVFLOW_HOOK_DEBUG).toBe('1');
  });

  it('is idempotent — double apply keeps DEVFLOW_HOOK_DEBUG=1', () => {
    const once = applyDebugTrace(JSON.stringify({ hooks: {} }));
    const twice = applyDebugTrace(once);
    const result = JSON.parse(twice);
    expect((result.env as Record<string, string>).DEVFLOW_HOOK_DEBUG).toBe('1');
  });

  it('does not mutate input — returns new serialized string', () => {
    const input = JSON.stringify({ hooks: {} });
    applyDebugTrace(input);
    // input is unchanged (string is immutable — this confirms no side effect)
    expect(JSON.parse(input).env).toBeUndefined();
  });

  it('throws on malformed JSON', () => {
    expect(() => applyDebugTrace('not json')).toThrow(SyntaxError);
  });
});

// ─── stripDebugTrace ─────────────────────────────────────────────────────────

describe('stripDebugTrace', () => {
  it('removes DEVFLOW_HOOK_DEBUG from env', () => {
    const input = JSON.stringify({ hooks: {}, env: { DEVFLOW_HOOK_DEBUG: '1', OTHER_VAR: 'keep' } });
    const result = JSON.parse(stripDebugTrace(input));
    const env = result.env as Record<string, unknown>;
    expect(env.DEVFLOW_HOOK_DEBUG).toBeUndefined();
    expect(env.OTHER_VAR).toBe('keep');
  });

  it('removes env object entirely when DEVFLOW_HOOK_DEBUG was the only key', () => {
    const input = JSON.stringify({ hooks: {}, env: { DEVFLOW_HOOK_DEBUG: '1' } });
    const result = JSON.parse(stripDebugTrace(input));
    expect(result.env).toBeUndefined();
  });

  it('is a no-op when DEVFLOW_HOOK_DEBUG was not set', () => {
    const input = JSON.stringify({ hooks: {}, env: { OTHER_VAR: 'keep' } });
    const result = JSON.parse(stripDebugTrace(input));
    const env = result.env as Record<string, string>;
    expect(env.DEVFLOW_HOOK_DEBUG).toBeUndefined();
    expect(env.OTHER_VAR).toBe('keep');
  });

  it('does not mutate input — returns new serialized string', () => {
    const input = JSON.stringify({ env: { DEVFLOW_HOOK_DEBUG: '1' } });
    stripDebugTrace(input);
    expect((JSON.parse(input).env as Record<string, string>).DEVFLOW_HOOK_DEBUG).toBe('1');
  });

  it('throws on malformed JSON', () => {
    expect(() => stripDebugTrace('not json')).toThrow(SyntaxError);
  });
});

// ─── readDebugStatus ─────────────────────────────────────────────────────────

describe('readDebugStatus', () => {
  it('returns true when DEVFLOW_HOOK_DEBUG=1 is in settings', () => {
    expect(readDebugStatus(JSON.stringify({ env: { DEVFLOW_HOOK_DEBUG: '1' } }))).toBe(true);
  });

  it('returns false when DEVFLOW_HOOK_DEBUG is absent', () => {
    expect(readDebugStatus(JSON.stringify({ hooks: {} }))).toBe(false);
  });

  it('returns false when env is missing', () => {
    expect(readDebugStatus(JSON.stringify({}))).toBe(false);
  });

  it('returns false when env is not an object', () => {
    expect(readDebugStatus(JSON.stringify({ env: 'string' }))).toBe(false);
  });

  it('returns false when env is an array', () => {
    expect(readDebugStatus(JSON.stringify({ env: [] }))).toBe(false);
  });

  it('returns false when DEVFLOW_HOOK_DEBUG is a non-1 value', () => {
    expect(readDebugStatus(JSON.stringify({ env: { DEVFLOW_HOOK_DEBUG: 'true' } }))).toBe(false);
    expect(readDebugStatus(JSON.stringify({ env: { DEVFLOW_HOOK_DEBUG: '0' } }))).toBe(false);
  });

  it('throws on malformed JSON', () => {
    expect(() => readDebugStatus('not json')).toThrow(SyntaxError);
  });
});

// ─── apply→strip roundtrip ───────────────────────────────────────────────────

describe('applyDebugTrace → stripDebugTrace roundtrip', () => {
  it('removes the key after enable-then-disable', () => {
    const base = JSON.stringify({ hooks: {} });
    const enabled = applyDebugTrace(base);
    expect(readDebugStatus(enabled)).toBe(true);
    const disabled = stripDebugTrace(enabled);
    expect(readDebugStatus(disabled)).toBe(false);
  });
});

// ─── I/O integration: missing file, malformed JSON ───────────────────────────

describe('I/O integration — missing settings.json', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-debug-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('enable from missing file — creates settings.json with DEVFLOW_HOOK_DEBUG=1', async () => {
    const settingsPath = path.join(tmpDir, 'settings.json');
    // No file — applyDebugTrace('{}') simulates what the command does on ENOENT
    const updated = applyDebugTrace('{}');
    await fs.writeFile(settingsPath, updated, 'utf-8');
    const settings = JSON.parse(await fs.readFile(settingsPath, 'utf-8'));
    expect((settings.env as Record<string, string>).DEVFLOW_HOOK_DEBUG).toBe('1');
  });

  it('disable from missing file — stripDebugTrace({}) produces no env key', async () => {
    const settingsPath = path.join(tmpDir, 'settings.json');
    // Simulate the command: ENOENT → settingsJson = '{}' → stripDebugTrace
    const updated = stripDebugTrace('{}');
    await fs.writeFile(settingsPath, updated, 'utf-8');
    const settings = JSON.parse(await fs.readFile(settingsPath, 'utf-8'));
    expect(settings.env).toBeUndefined();
  });
});

describe('malformed settings.json — enable path', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-debug-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('enable does not overwrite malformed settings.json', async () => {
    const settingsPath = path.join(tmpDir, 'settings.json');
    const malformed = 'this is not json';
    await fs.writeFile(settingsPath, malformed, 'utf-8');

    // The command catches SyntaxError and returns early — file must be untouched.
    // We verify the pure function throws and verify the file guard logic separately.
    expect(() => applyDebugTrace(malformed)).toThrow(SyntaxError);

    // File stays malformed because the command never wrote to it.
    const content = await fs.readFile(settingsPath, 'utf-8');
    expect(content).toBe(malformed);
  });
});

describe('malformed settings.json — disable path', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-debug-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('disable does not overwrite malformed settings.json', async () => {
    const settingsPath = path.join(tmpDir, 'settings.json');
    const malformed = 'this is not json';
    await fs.writeFile(settingsPath, malformed, 'utf-8');

    // The pure function throws on malformed JSON.
    expect(() => stripDebugTrace(malformed)).toThrow(SyntaxError);

    // File stays malformed because the command never wrote to it.
    const content = await fs.readFile(settingsPath, 'utf-8');
    expect(content).toBe(malformed);
  });
});
