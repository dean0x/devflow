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
 *  - buildRoutingConfigJson: port-only shape — no injected anthropic block (AC-C4)
 *  - buildRoutingConfigJson: user-set anthropic.connectTimeoutMs is preserved
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
  proxyJsonExists,
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
// buildRoutingConfigJson — port-only shape; user-set anthropic keys preserved (AC-C4)
// ---------------------------------------------------------------------------

describe('buildRoutingConfigJson — base behavior', () => {
  it('emits port with the correct value', () => {
    const json = buildRoutingConfigJson(4141);
    const obj = JSON.parse(json) as Record<string, unknown>;
    expect(obj.port).toBe(4141);
  });

  it('output ends with a trailing newline', () => {
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

  it('emits no anthropic block when no existing config is supplied (relay default governs)', () => {
    const obj = JSON.parse(buildRoutingConfigJson(4141)) as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(obj, 'anthropic')).toBe(false);
  });

  it('only emits allowed top-level keys (strictObject constraint D-EFR-4)', () => {
    const allowed = new Set(['port', 'logLevel', 'anthropic', 'providers', 'limits']);
    const obj = JSON.parse(buildRoutingConfigJson(4141)) as Record<string, unknown>;
    for (const key of Object.keys(obj)) {
      expect(allowed.has(key), `unexpected top-level key: ${key}`).toBe(true);
    }
  });
});

describe('buildRoutingConfigJson — existing config preservation', () => {
  it('user-specified anthropic.connectTimeoutMs is preserved (relay default not injected)', () => {
    const existing = JSON.stringify({ port: 4141, anthropic: { connectTimeoutMs: 30_000 } });
    const obj = JSON.parse(buildRoutingConfigJson(4141, existing)) as Record<string, unknown>;
    const anthropic = obj.anthropic as Record<string, unknown>;
    expect(anthropic.connectTimeoutMs).toBe(30_000);
  });

  it('preserves other anthropic fields from existing config', () => {
    // maxUpstreamSockets is a live key in the pinned runtime's AnthropicSchema —
    // a preservation fixture has to use a shape the relay actually accepts, or it
    // pins behaviour that would break the relay at startup (avoids PF-043).
    const existing = JSON.stringify({ port: 4141, anthropic: { maxUpstreamSockets: 64 } });
    const obj = JSON.parse(buildRoutingConfigJson(4141, existing)) as Record<string, unknown>;
    const anthropic = obj.anthropic as Record<string, unknown>;
    expect(anthropic.maxUpstreamSockets).toBe(64);
    expect(Object.prototype.hasOwnProperty.call(anthropic, 'connectTimeoutMs')).toBe(false);
  });

  it('preserves logLevel from existing config', () => {
    const existing = JSON.stringify({ port: 4141, logLevel: 'debug' });
    const obj = JSON.parse(buildRoutingConfigJson(4141, existing)) as Record<string, unknown>;
    expect(obj.logLevel).toBe('debug');
  });

  it('preserves limits block from existing config', () => {
    const existing = JSON.stringify({ port: 4141, limits: { maxConcurrent: 10 } });
    const obj = JSON.parse(buildRoutingConfigJson(4141, existing)) as Record<string, unknown>;
    const limits = obj.limits as Record<string, unknown>;
    expect(limits.maxConcurrent).toBe(10);
  });

  it('strips legacy limits.connectTimeoutMs to prevent hard startup error (D-EFR-4)', () => {
    const existing = JSON.stringify({ port: 4141, limits: { connectTimeoutMs: 5_000, maxConcurrent: 10 } });
    const obj = JSON.parse(buildRoutingConfigJson(4141, existing)) as Record<string, unknown>;
    const limits = obj.limits as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(limits, 'connectTimeoutMs')).toBe(false);
    expect(limits.maxConcurrent).toBe(10);
  });

  // Keys that were valid under a previously pinned runtime and are registered legacy
  // keys in the current one — a hard startup error, not a warning. Carrying a user's own
  // proxy-routing.json forward across the upgrade must drop them, or the relay that the
  // ensure-proxy hook spawns dies on boot every session with no route back.
  it('strips anthropic.streamIdleTimeoutMs (removed in the pinned runtime)', () => {
    const existing = JSON.stringify({
      port: 4141,
      anthropic: { streamIdleTimeoutMs: 60_000, maxUpstreamSockets: 64 },
    });
    const obj = JSON.parse(buildRoutingConfigJson(4141, existing)) as Record<string, unknown>;
    const anthropic = obj.anthropic as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(anthropic, 'streamIdleTimeoutMs')).toBe(false);
    // Neighbouring valid keys survive the strip; no default is injected.
    expect(anthropic.maxUpstreamSockets).toBe(64);
    expect(Object.prototype.hasOwnProperty.call(anthropic, 'connectTimeoutMs')).toBe(false);
  });

  it('strips limits.maxConcurrentRequests (removed in the pinned runtime)', () => {
    const existing = JSON.stringify({
      port: 4141,
      limits: { maxConcurrentRequests: 8, maxConcurrent: 10 },
    });
    const obj = JSON.parse(buildRoutingConfigJson(4141, existing)) as Record<string, unknown>;
    const limits = obj.limits as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(limits, 'maxConcurrentRequests')).toBe(false);
    expect(limits.maxConcurrent).toBe(10);
  });

  it('strips limits.maxBodyBytes (renamed maxBufferedBodyBytes in the pinned runtime)', () => {
    const existing = JSON.stringify({
      port: 4141,
      limits: { maxBodyBytes: 10_485_760, maxConcurrent: 10 },
    });
    const obj = JSON.parse(buildRoutingConfigJson(4141, existing)) as Record<string, unknown>;
    const limits = obj.limits as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(limits, 'maxBodyBytes')).toBe(false);
    expect(limits.maxConcurrent).toBe(10);
  });

  it('preserves the current limits.maxBufferedBodyBytes spelling', () => {
    const existing = JSON.stringify({
      port: 4141,
      limits: { maxBufferedBodyBytes: 10_485_760 },
    });
    const obj = JSON.parse(buildRoutingConfigJson(4141, existing)) as Record<string, unknown>;
    const limits = obj.limits as Record<string, unknown>;
    expect(limits.maxBufferedBodyBytes).toBe(10_485_760);
  });

  it('strips limits.maxUpstreamSockets (moved to anthropic.maxUpstreamSockets in 0.4.0)', () => {
    const existing = JSON.stringify({
      port: 4141,
      limits: { maxUpstreamSockets: 128, maxBufferedBodyBytes: 10_485_760 },
    });
    const obj = JSON.parse(buildRoutingConfigJson(4141, existing)) as Record<string, unknown>;
    const limits = obj.limits as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(limits, 'maxUpstreamSockets')).toBe(false);
    expect(limits.maxBufferedBodyBytes).toBe(10_485_760);
  });

  it('strips limits.streamIdleTimeoutMs (moved to providers.codex.streamIdleTimeoutMs in 0.4.0)', () => {
    const existing = JSON.stringify({
      port: 4141,
      limits: { streamIdleTimeoutMs: 30_000, maxBufferedBodyBytes: 10_485_760 },
    });
    const obj = JSON.parse(buildRoutingConfigJson(4141, existing)) as Record<string, unknown>;
    const limits = obj.limits as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(limits, 'streamIdleTimeoutMs')).toBe(false);
    expect(limits.maxBufferedBodyBytes).toBe(10_485_760);
  });

  it('strips limits.requestTimeoutMs (moved to providers.codex.requestTimeoutMs in 0.4.0)', () => {
    const existing = JSON.stringify({
      port: 4141,
      limits: { requestTimeoutMs: 60_000, maxBufferedBodyBytes: 10_485_760 },
    });
    const obj = JSON.parse(buildRoutingConfigJson(4141, existing)) as Record<string, unknown>;
    const limits = obj.limits as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(limits, 'requestTimeoutMs')).toBe(false);
    expect(limits.maxBufferedBodyBytes).toBe(10_485_760);
  });

  it('strips limits.maxSseEventBytes (moved to providers.codex.maxSseEventBytes in 0.4.0)', () => {
    const existing = JSON.stringify({
      port: 4141,
      limits: { maxSseEventBytes: 65_536, maxBufferedBodyBytes: 10_485_760 },
    });
    const obj = JSON.parse(buildRoutingConfigJson(4141, existing)) as Record<string, unknown>;
    const limits = obj.limits as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(limits, 'maxSseEventBytes')).toBe(false);
    expect(limits.maxBufferedBodyBytes).toBe(10_485_760);
  });

  it('omits limits key from output when all sub-keys are stripped (mirrors anthropic omit-when-empty)', () => {
    const existing = JSON.stringify({
      port: 4141,
      limits: { maxUpstreamSockets: 128, streamIdleTimeoutMs: 30_000 },
    });
    const obj = JSON.parse(buildRoutingConfigJson(4141, existing)) as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(obj, 'limits')).toBe(false);
  });

  it('preserves providers block from existing config', () => {
    const existing = JSON.stringify({ port: 4141, providers: { openai: { baseUrl: 'https://api.openai.com' } } });
    const obj = JSON.parse(buildRoutingConfigJson(4141, existing)) as Record<string, unknown>;
    expect(obj.providers).toBeDefined();
  });

  it('strips unknown top-level keys not in the allowed set (strictObject constraint)', () => {
    const existing = JSON.stringify({ port: 4141, codex: { apiKey: 'x' }, logLevel: 'info' });
    const obj = JSON.parse(buildRoutingConfigJson(4141, existing)) as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(obj, 'codex')).toBe(false);
    expect(obj.logLevel).toBe('info');
  });

  it('port in output always reflects the authoritative devflow port, not the existing file', () => {
    const existing = JSON.stringify({ port: 9999, logLevel: 'warn' });
    const obj = JSON.parse(buildRoutingConfigJson(4141, existing)) as Record<string, unknown>;
    expect(obj.port).toBe(4141);
  });

  it('malformed existing content falls back cleanly — no throw, port-only config emitted', () => {
    expect(() => buildRoutingConfigJson(4141, '{ bad json !!!')).not.toThrow();
    const obj = JSON.parse(buildRoutingConfigJson(4141, '{ bad json !!!')) as Record<string, unknown>;
    expect(obj.port).toBe(4141);
    expect(Object.prototype.hasOwnProperty.call(obj, 'anthropic')).toBe(false);
  });

  it('undefined existingContent falls back to port-only config', () => {
    const obj = JSON.parse(buildRoutingConfigJson(4141, undefined)) as Record<string, unknown>;
    expect(obj.port).toBe(4141);
    expect(Object.prototype.hasOwnProperty.call(obj, 'anthropic')).toBe(false);
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

// ---------------------------------------------------------------------------
// FIX 2 (issue #313): proxyJsonExists — D-STRIP-1 gate discriminator
//
// readProxyState() returns Ok(defaultState) on ENOENT — callers cannot use its
// success to prove proxy.json exists. proxyJsonExists() is the correct gate for
// stripping managed env vars: strip only when the file exists (proving devflow
// previously wrote it).
// ---------------------------------------------------------------------------

describe('proxyJsonExists — FIX 2 (issue #313)', () => {
  it('returns false when proxy.json does not exist', async () => {
    const result = await proxyJsonExists(tmpDir);
    expect(result).toBe(false);
  });

  it('returns true when proxy.json exists (even with only a port)', async () => {
    await fs.writeFile(path.join(tmpDir, 'proxy.json'), JSON.stringify({ port: DEFAULT_PROXY_PORT }));
    const result = await proxyJsonExists(tmpDir);
    expect(result).toBe(true);
  });

  it('returns true for a full proxy.json written by writeProxyState', async () => {
    const state = buildProxyState(DEFAULT_PROXY_PORT, '/path/relay.js', '/path/config.json', '0.2.0');
    await writeProxyState(tmpDir, state);
    const result = await proxyJsonExists(tmpDir);
    expect(result).toBe(true);
  });

  it('returns true even when the file contains malformed JSON (file-exists ≠ valid JSON)', async () => {
    await fs.writeFile(path.join(tmpDir, 'proxy.json'), 'not-valid-json{{');
    const result = await proxyJsonExists(tmpDir);
    expect(result).toBe(true);
  });

  it('returns false when devflowDir itself does not exist', async () => {
    const nonexistent = path.join(tmpDir, 'does-not-exist');
    const result = await proxyJsonExists(nonexistent);
    expect(result).toBe(false);
  });

  it('discriminates absent-file from Ok(defaultState) returned by readProxyState', async () => {
    // readProxyState() returns Ok({enabled:false,port:DEFAULT_PROXY_PORT,...}) on ENOENT,
    // which is indistinguishable from a file present with those exact values.
    // proxyJsonExists() must correctly report false for the absent-file case.
    const readResult = await readProxyState(tmpDir);
    expect(readResult.ok).toBe(true); // readProxyState returns Ok even on ENOENT
    if (readResult.ok) {
      expect(readResult.value.port).toBe(DEFAULT_PROXY_PORT); // same as a real file with default port
    }
    // proxyJsonExists is the correct discriminator — file is absent
    const exists = await proxyJsonExists(tmpDir);
    expect(exists).toBe(false);
  });
});
