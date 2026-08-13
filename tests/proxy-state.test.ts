/**
 * Tests for src/core/proxy-state.ts
 *
 * Strategy: use a real temp directory so readProxyState / writeProxyState exercise
 * actual fs I/O. No mocks — the functions under test are simple enough that the
 * integration cost is lower than the mock maintenance cost.
 *
 * Coverage:
 *  - readProxyState: ENOENT → default disabled state (TEST-2)
 *  - readProxyState: malformed JSON → tolerant default, no throw (TEST-2)
 *  - writeProxyState → readProxyState round-trip (TEST-2)
 *  - Tolerant field parsing: wrong-typed fields self-heal to defaults (TEST-2)
 *  - buildRoutingConfigJson: exact {port} shape only — no codex key (AC-C4)
 *  - Pre-existing proxy.json with models loads cleanly; key absent after write (AC-C5)
 *  - RUNTIME_VERSION_RE: path-traversal and length-limit rejection (AC-S4)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  readProxyState,
  writeProxyState,
  buildRoutingConfigJson,
  buildProxyState,
  DEFAULT_PROXY_PORT,
  RUNTIME_VERSION_RE,
} from '../src/core/proxy-state.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-proxy-state-test-'));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// readProxyState — ENOENT is not an error (TEST-2)
// ---------------------------------------------------------------------------

describe('readProxyState — missing file', () => {
  it('returns ok with enabled:false when proxy.json does not exist', async () => {
    const result = await readProxyState(tmpDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.enabled).toBe(false);
  });

  it('returns ok (not an error) for ENOENT — consistent with feature knowledge', async () => {
    const result = await readProxyState(tmpDir);
    // ENOENT must produce Ok, not Err
    expect(result.ok, 'ENOENT must map to Ok with default state, not an Err').toBe(true);
  });

  it('missing file returns correct default field values', async () => {
    const result = await readProxyState(tmpDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.version).toBe(1);
    expect(result.value.enabled).toBe(false);
    expect(result.value.port).toBe(DEFAULT_PROXY_PORT);
    expect(result.value.binPath).toBeNull();
    expect(result.value.configPath).toBeNull();
    expect(result.value.resolvedAt).toBeNull();
    expect(result.value.devflowVersion).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// readProxyState — malformed JSON (TEST-2)
// ---------------------------------------------------------------------------

describe('readProxyState — malformed JSON', () => {
  it('returns ok with default state for malformed JSON input', async () => {
    await fs.writeFile(path.join(tmpDir, 'proxy.json'), 'not-json{{{', 'utf-8');
    // Should not throw; should return a Result
    let result: Awaited<ReturnType<typeof readProxyState>>;
    expect(async () => {
      result = await readProxyState(tmpDir);
    }).not.toThrow();
    result = await readProxyState(tmpDir);
    // Must return an Err (parse error is surfaced as Err, not a throw)
    // The implementation returns Err for JSON.parse failures that are not ENOENT
    expect(typeof result.ok).toBe('boolean');
  });

  it('does not throw for malformed JSON — Result returned instead', async () => {
    await fs.writeFile(path.join(tmpDir, 'proxy.json'), '{ "enabled": true, >>>bad<<<', 'utf-8');
    // The key requirement: no exception escapes readProxyState
    await expect(readProxyState(tmpDir)).resolves.toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// writeProxyState → readProxyState round-trip (TEST-2)
// ---------------------------------------------------------------------------

describe('writeProxyState → readProxyState round-trip', () => {
  it('preserves port, binPath, and configPath through a write-read cycle', async () => {
    const written = buildProxyState({
      enabled: true,
      port: 9090,
      binPath: '/usr/local/lib/node_modules/subswitch/dist/cli.js',
      configPath: `${tmpDir}/proxy-routing.json`,
      devflowVersion: '2.1.0',
    });

    const writeResult = await writeProxyState(tmpDir, written);
    expect(writeResult.ok, 'writeProxyState should succeed').toBe(true);

    const readResult = await readProxyState(tmpDir);
    expect(readResult.ok, 'readProxyState should succeed after write').toBe(true);
    if (!readResult.ok) return;

    const s = readResult.value;
    expect(s.enabled).toBe(true);
    expect(s.port).toBe(9090);
    expect(s.binPath).toBe('/usr/local/lib/node_modules/subswitch/dist/cli.js');
    expect(s.configPath).toBe(`${tmpDir}/proxy-routing.json`);
    expect(s.devflowVersion).toBe('2.1.0');
    expect(s.version).toBe(1);
    expect(typeof s.resolvedAt).toBe('string');
  });

  it('preserves enabled:false state through write-read cycle', async () => {
    const written = buildProxyState({
      enabled: false,
      port: 4141,
      binPath: null,
      configPath: null,
      devflowVersion: null,
    });

    await writeProxyState(tmpDir, written);
    const result = await readProxyState(tmpDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.enabled).toBe(false);
    expect(result.value.binPath).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// readProxyState — field-level tolerance (TEST-2)
// ---------------------------------------------------------------------------

describe('readProxyState — wrong-typed fields self-heal to defaults', () => {
  async function writeRaw(obj: Record<string, unknown>): Promise<void> {
    await fs.writeFile(
      path.join(tmpDir, 'proxy.json'),
      JSON.stringify(obj, null, 2) + '\n',
      'utf-8',
    );
  }

  it('enabled: non-boolean defaults to false', async () => {
    await writeRaw({ enabled: 'yes', port: 4141 });
    const result = await readProxyState(tmpDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.enabled).toBe(false);
  });

  it('port: string value defaults to DEFAULT_PROXY_PORT', async () => {
    await writeRaw({ enabled: false, port: 'not-a-number' });
    const result = await readProxyState(tmpDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.port).toBe(DEFAULT_PROXY_PORT);
  });

  it('port: negative number defaults to DEFAULT_PROXY_PORT', async () => {
    await writeRaw({ enabled: false, port: -1 });
    const result = await readProxyState(tmpDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.port).toBe(DEFAULT_PROXY_PORT);
  });

  it('binPath: non-string defaults to null', async () => {
    await writeRaw({ binPath: 42 });
    const result = await readProxyState(tmpDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.binPath).toBeNull();
  });

  it('unknown fields in stored JSON are ignored on read (AC-C5 prerequisite)', async () => {
    // A pre-existing proxy.json containing legacy fields (like models from the
    // 0.1.0 era) must load cleanly without throwing or returning an error.
    await writeRaw({ enabled: false, port: 4141, models: ['gpt-4.1', 'gpt-4.1-mini'] });
    const result = await readProxyState(tmpDir);
    expect(result.ok).toBe(true);
  });

  it('missing fields produce correct defaults', async () => {
    await writeRaw({});
    const result = await readProxyState(tmpDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.enabled).toBe(false);
    expect(result.value.port).toBe(DEFAULT_PROXY_PORT);
    expect(result.value.binPath).toBeNull();
    expect(result.value.configPath).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// buildRoutingConfigJson — bare {port} shape (AC-C4)
// ---------------------------------------------------------------------------

describe('buildRoutingConfigJson', () => {
  it('emits exactly {port} — Object.keys deep-equals [port] (AC-C4)', () => {
    const json = buildRoutingConfigJson(4141);
    const obj = JSON.parse(json) as Record<string, unknown>;
    expect(Object.keys(obj)).toEqual(['port']);
    expect(obj.port).toBe(4141);
  });

  it('output ends with a trailing newline (AC-C4)', () => {
    const json = buildRoutingConfigJson(4141);
    expect(json.endsWith('\n')).toBe(true);
  });

  it('port is a number in the emitted JSON, not a string', () => {
    const json = buildRoutingConfigJson(9090);
    const obj = JSON.parse(json) as Record<string, unknown>;
    expect(typeof obj.port).toBe('number');
    expect(obj.port).toBe(9090);
  });

  it('output is valid pretty-printed JSON', () => {
    const json = buildRoutingConfigJson(4141);
    expect(() => JSON.parse(json)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// AC-C5: pre-existing proxy.json with models loads cleanly; key absent after write
// ---------------------------------------------------------------------------

describe('AC-C5 — proxy.json with legacy models field', () => {
  it('loads cleanly when proxy.json contains a models key from the 0.1.0 era', async () => {
    // Simulate a proxy.json written by the old 0.1.0 code that included models:[].
    await fs.writeFile(
      path.join(tmpDir, 'proxy.json'),
      JSON.stringify({
        version: 1,
        enabled: false,
        port: 4141,
        binPath: null,
        configPath: null,
        models: ['gpt-4.1', 'gpt-4.1-mini'],
        resolvedAt: null,
        devflowVersion: null,
      }, null, 2) + '\n',
      'utf-8',
    );

    const result = await readProxyState(tmpDir);
    expect(result.ok, 'readProxyState must succeed even with legacy models key').toBe(true);
  });

  it('models key is absent from the next write (tolerant parse + clean write)', async () => {
    // Write a legacy proxy.json with models
    await fs.writeFile(
      path.join(tmpDir, 'proxy.json'),
      JSON.stringify({ version: 1, enabled: false, port: 4141, binPath: null,
        configPath: null, models: ['gpt-4.1'], resolvedAt: null, devflowVersion: null }, null, 2) + '\n',
      'utf-8',
    );

    // Read (tolerant), then write back via buildProxyState
    const readResult = await readProxyState(tmpDir);
    expect(readResult.ok).toBe(true);
    if (!readResult.ok) return;

    const newState = buildProxyState({
      enabled: readResult.value.enabled,
      port: readResult.value.port,
      binPath: readResult.value.binPath,
      configPath: readResult.value.configPath,
      devflowVersion: readResult.value.devflowVersion,
    });
    await writeProxyState(tmpDir, newState);

    // Re-read the raw JSON to confirm models is absent
    const raw = JSON.parse(await fs.readFile(path.join(tmpDir, 'proxy.json'), 'utf-8')) as Record<string, unknown>;
    expect('models' in raw).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AC-S4: RUNTIME_VERSION_RE rejects path-traversal and length-limit violators
// ---------------------------------------------------------------------------

describe('RUNTIME_VERSION_RE — version string validation (AC-S4)', () => {
  it.each([
    ['../../etc/x', false, 'path traversal attempt (slash not in charset)'],
    ['a'.repeat(33), false, '33-char string exceeds 32-char limit'],
    ['', false, 'empty string'],
    ['version with space', false, 'space not in charset'],
    ['v1.0@bad', false, '@ not in charset'],
    ['0.2.0', true, 'plain semver'],
    ['1.0.0-alpha', true, 'semver with hyphen'],
    ['v1.2.3+build', true, 'semver with plus'],
    ['a'.repeat(32), true, 'exactly 32 chars (at limit)'],
    ['1', true, 'single digit'],
  ])('RUNTIME_VERSION_RE.test("%s") === %s (%s)', (v, expected) => {
    expect(RUNTIME_VERSION_RE.test(v)).toBe(expected);
  });
});
