/**
 * Tests for src/core/model-discovery.ts
 *
 * Test strategy:
 *
 *  T1 (real-binary, skip if not available): discoverExternalModels returns
 *     known:true with a live result when the routing runtime is installed and
 *     accessible. Validates the full happy path including cache write.
 *
 *  T2 (real-binary): discoverExternalModels with SUBSWITCH_CONFIG pointing at
 *     a legacy config causes exit 1 → known:false (env stripping test: if the
 *     var were NOT stripped this would never be reachable since scrubChildEnv
 *     strips SUBSWITCH_CONFIG; this test verifies that no caller re-injects it).
 *     Implemented via injectable spawnAndCollect to avoid env leakage.
 *
 *  T3 (real-binary skip): cwd is os.tmpdir(), not devflow's own directory —
 *     a subswitch.config.json in the devflow CWD is not picked up (PF-013).
 *
 *  T4 (real binary skip): stub binary with exitCode != 0 falls back to stale
 *     cache when available, not live result. Validates the degradation path.
 *     Implements PF-016: uses a real binary (shell script) that exits non-zero
 *     rather than a mock that always pretends to exit 0.
 *
 *  T6: spawnAndCollect is ALWAYS called with argv = ['models', '--json'].
 *     Injectable dep captures the actual argv and asserts it is exactly right.
 *     Guards against conditional argv that might degenerate to [] (triggering
 *     the routing runtime's default "serve" dispatch).
 *
 *  T12: pruneOldEntries keeps at most 3 entries after a live write.
 *     Uses injectable resolveProxyBin + spawnAndCollect to run without the
 *     runtime installed. Writes 5 entries upfront; after discovery, exactly 3
 *     remain and they are the newest 3 by embedded timestamp.
 *
 *  AC-P8 (SIGTERM/SIGKILL test): a stub binary that ignores SIGTERM for >2s
 *     is killed by SIGKILL; discoverExternalModels returns known:false (not
 *     a hang). Uses a real shell binary (avoids PF-016).
 *
 * applies PF-016: every path that gates on an exit code exercises a REAL
 *   binary that CAN produce that exit code — not a mock that always returns 0.
 *   In T4 and AC-P8 the real binary is a short shell script written to a temp
 *   file, not a vitest mock.
 *
 * CRITICAL: all tests live in tests/ NOT tests/integration/ — vitest.config.ts
 *   excludes tests/integration/** from npm test. A real-binary test placed there
 *   would never execute, reproducing PF-016 exactly. (avoids PF-016)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fsAsync } from 'fs';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
import {
  parseModelsJson,
  discoverExternalModels,
  getExternalModelsCached,
  SPAWN_TIMEOUT_MS,
  SIGKILL_GRACE_MS,
  type ExternalModelCatalog,
  type ModelDiscoveryDeps,
} from '../src/core/model-discovery.js';
import { resolveProxyBin } from '../src/core/proxy-state.js';
import { writeCache } from '../src/core/cache.js';

// ---------------------------------------------------------------------------
// Constants mirroring model-discovery.ts internals
// ---------------------------------------------------------------------------

const CACHE_KEY_PREFIX = 'external-models-v1-';
const CACHE_TTL_MS = 24 * 60 * 60 * 1_000;
// SPAWN_TIMEOUT_MS and SIGKILL_GRACE_MS are imported from model-discovery.ts (C2-CPLX-8)

// ---------------------------------------------------------------------------
// Minimal valid payload for parser tests
// ---------------------------------------------------------------------------

const VALID_PAYLOAD = JSON.stringify({
  schemaVersion: 1,
  kind: 'models',
  providers: [{ id: 'codex', routing: 'direct' }],
  models: [
    {
      id: 'gpt-5.6-sol',
      provider: 'codex',
      routable: true,
      retired: false,
      aliases: [{ name: 'sol' }, { name: 'v5sol' }],
    },
    {
      id: 'gpt-5.4-terra',
      provider: 'codex',
      routable: true,
      retired: false,
      aliases: [{ name: 'terra' }],
    },
  ],
});

// ---------------------------------------------------------------------------
// Setup — isolated temp directories per test
// ---------------------------------------------------------------------------

let tmpDir: string;
let cacheDir: string;
let logPath: string;

beforeEach(async () => {
  tmpDir = await fsAsync.mkdtemp(path.join(os.tmpdir(), 'devflow-model-discovery-'));
  cacheDir = path.join(tmpDir, 'cache');
  logPath = path.join(tmpDir, 'proxy.log');
  await fsAsync.mkdir(cacheDir, { recursive: true, mode: 0o700 });
});

afterEach(async () => {
  await fsAsync.rm(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// parseModelsJson — pure function tests (no I/O)
// ---------------------------------------------------------------------------

describe('parseModelsJson — happy path', () => {
  it('parses the minimal valid payload and returns ok', () => {
    const result = parseModelsJson(VALID_PAYLOAD);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.models.length).toBe(2);
    expect(result.value.models[0].id).toBe('gpt-5.6-sol');
    expect(result.value.models[0].aliases).toContain('sol');
    expect(result.value.models[0].aliases).toContain('v5sol');
    expect(result.value.models[1].id).toBe('gpt-5.4-terra');
  });

  it('builds aliasToId map covering both aliases and canonical ids', () => {
    const result = parseModelsJson(VALID_PAYLOAD);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const map = result.value.aliasToId;
    expect(map.get('sol')).toBe('gpt-5.6-sol');
    expect(map.get('v5sol')).toBe('gpt-5.6-sol');
    expect(map.get('gpt-5.6-sol')).toBe('gpt-5.6-sol');
    expect(map.get('terra')).toBe('gpt-5.4-terra');
    expect(map.get('gpt-5.4-terra')).toBe('gpt-5.4-terra');
  });

  it('selectableNames: aliases first (registry order), then canonical ids', () => {
    const result = parseModelsJson(VALID_PAYLOAD);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const names = result.value.selectableNames;
    // Aliases: sol, v5sol (model 0), terra (model 1)
    expect(names[0]).toBe('sol');
    expect(names[1]).toBe('v5sol');
    expect(names[2]).toBe('terra');
    // Canonical ids: gpt-5.6-sol, gpt-5.4-terra
    expect(names[3]).toBe('gpt-5.6-sol');
    expect(names[4]).toBe('gpt-5.4-terra');
    // Total: 5 (2 + 1 + 2)
    expect(names.length).toBe(5);
  });

  it('selectableNames contains no duplicates', () => {
    const result = parseModelsJson(VALID_PAYLOAD);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const names = result.value.selectableNames;
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('parseModelsJson — hard gates', () => {
  it('rejects non-JSON', () => {
    const result = parseModelsJson('not json{{{');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('JSON');
  });

  it('rejects non-object root', () => {
    expect(parseModelsJson('"string"').ok).toBe(false);
    expect(parseModelsJson('42').ok).toBe(false);
    expect(parseModelsJson('[]').ok).toBe(false);
    expect(parseModelsJson('null').ok).toBe(false);
  });

  it('rejects schemaVersion !== 1 (strict — string "1" also fails)', () => {
    const badVersion = JSON.stringify({ schemaVersion: '1', kind: 'models', models: [] });
    expect(parseModelsJson(badVersion).ok).toBe(false);
    const badVersion2 = JSON.stringify({ schemaVersion: 2, kind: 'models', models: [] });
    expect(parseModelsJson(badVersion2).ok).toBe(false);
    const missingVersion = JSON.stringify({ kind: 'models', models: [] });
    expect(parseModelsJson(missingVersion).ok).toBe(false);
  });

  it('rejects kind !== "models"', () => {
    const bad = JSON.stringify({ schemaVersion: 1, kind: 'agents', models: [] });
    expect(parseModelsJson(bad).ok).toBe(false);
  });

  it('rejects models that is not an array', () => {
    const bad = JSON.stringify({ schemaVersion: 1, kind: 'models', models: {} });
    expect(parseModelsJson(bad).ok).toBe(false);
  });

  it('rejects payload where zero rows survive row-level filtering', () => {
    const allRetired = JSON.stringify({
      schemaVersion: 1,
      kind: 'models',
      models: [
        { id: 'gpt-5.6-sol', provider: 'codex', routable: true, retired: true, aliases: [] },
      ],
    });
    const result = parseModelsJson(allRetired);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('zero rows');
  });
});

describe('parseModelsJson — row-level tolerance', () => {
  it('skips rows where provider !== codex', () => {
    const payload = JSON.stringify({
      schemaVersion: 1,
      kind: 'models',
      models: [
        { id: 'anthropic-opus', provider: 'anthropic', routable: true, retired: false, aliases: [] },
        { id: 'gpt-5.6-sol', provider: 'codex', routable: true, retired: false, aliases: [] },
      ],
    });
    const result = parseModelsJson(payload);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.models.length).toBe(1);
    expect(result.value.models[0].id).toBe('gpt-5.6-sol');
  });

  it('skips rows where routable !== true or retired !== false', () => {
    const payload = JSON.stringify({
      schemaVersion: 1,
      kind: 'models',
      models: [
        { id: 'gpt-old', provider: 'codex', routable: false, retired: false, aliases: [] },
        { id: 'gpt-retd', provider: 'codex', routable: true, retired: true, aliases: [] },
        { id: 'gpt-5.6-sol', provider: 'codex', routable: true, retired: false, aliases: [] },
      ],
    });
    const result = parseModelsJson(payload);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.models.length).toBe(1);
    expect(result.value.models[0].id).toBe('gpt-5.6-sol');
  });

  it('drops aliases that match MODEL_NAME_RE failure (too long, bad chars)', () => {
    const longName = 'a'.repeat(65);
    const payload = JSON.stringify({
      schemaVersion: 1,
      kind: 'models',
      models: [
        {
          id: 'gpt-5.6-sol',
          provider: 'codex',
          routable: true,
          retired: false,
          aliases: [
            { name: longName },           // too long — dropped
            { name: 'valid-alias' },       // kept
          ],
        },
      ],
    });
    const result = parseModelsJson(payload);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.models[0].aliases).not.toContain(longName);
    expect(result.value.models[0].aliases).toContain('valid-alias');
  });

  it('drops alias whose name equals a canonical id in the payload (two-pass check)', () => {
    // 'gpt-5.4-terra' is both an alias on model 0 and the canonical id of model 1.
    // The two-pass algorithm collects all canonical ids first, so the alias is dropped.
    const payload = JSON.stringify({
      schemaVersion: 1,
      kind: 'models',
      models: [
        {
          id: 'gpt-5.6-sol',
          provider: 'codex',
          routable: true,
          retired: false,
          aliases: [{ name: 'gpt-5.4-terra' }, { name: 'sol' }],
        },
        {
          id: 'gpt-5.4-terra',
          provider: 'codex',
          routable: true,
          retired: false,
          aliases: [{ name: 'terra' }],
        },
      ],
    });
    const result = parseModelsJson(payload);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const solModel = result.value.models.find((m) => m.id === 'gpt-5.6-sol');
    // 'gpt-5.4-terra' must be dropped from model 0's aliases
    expect(solModel?.aliases).not.toContain('gpt-5.4-terra');
    expect(solModel?.aliases).toContain('sol');
  });

  it('drops aliases in CLAUDE_MODEL_ALIASES (haiku, sonnet, opus, fable)', () => {
    const payload = JSON.stringify({
      schemaVersion: 1,
      kind: 'models',
      models: [
        {
          id: 'gpt-5.6-sol',
          provider: 'codex',
          routable: true,
          retired: false,
          aliases: [
            { name: 'haiku' },   // CLAUDE alias — must be dropped
            { name: 'opus' },    // CLAUDE alias — must be dropped
            { name: 'sol' },     // safe alias — kept
          ],
        },
      ],
    });
    const result = parseModelsJson(payload);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const m = result.value.models[0];
    expect(m.aliases).not.toContain('haiku');
    expect(m.aliases).not.toContain('opus');
    expect(m.aliases).toContain('sol');
  });

  it('drops rows where id fails MODEL_NAME_RE (starts with non-alphanumeric, too long)', () => {
    const badId = '-bad-start';
    const longId = 'a'.repeat(65);
    const payload = JSON.stringify({
      schemaVersion: 1,
      kind: 'models',
      models: [
        { id: badId, provider: 'codex', routable: true, retired: false, aliases: [] },
        { id: longId, provider: 'codex', routable: true, retired: false, aliases: [] },
        { id: 'gpt-5.6-sol', provider: 'codex', routable: true, retired: false, aliases: [] },
      ],
    });
    const result = parseModelsJson(payload);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.models.length).toBe(1);
    expect(result.value.models[0].id).toBe('gpt-5.6-sol');
  });

  it('skips rows with passthrough provider', () => {
    const payload = JSON.stringify({
      schemaVersion: 1,
      kind: 'models',
      providers: [{ id: 'codex', routing: 'passthrough' }],
      models: [
        { id: 'gpt-5.6-sol', provider: 'codex', routable: true, retired: false, aliases: [] },
        { id: 'other-ok', provider: 'codex', routable: true, retired: false, aliases: [] },
      ],
    });
    // Both rows are codex but the provider entry says passthrough — both dropped
    const result = parseModelsJson(payload);
    // Zero rows survive → Err
    expect(result.ok).toBe(false);
  });
});

describe('parseModelsJson — branding constraint (AC-F9)', () => {
  it('error messages do not contain the routing runtime package name', () => {
    const result = parseModelsJson('not json');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // 'subswitch' must never appear in user-visible error text
    expect(result.error.toLowerCase()).not.toContain('subswitch');
  });
});

// ---------------------------------------------------------------------------
// getExternalModelsCached — sync, no spawn
// ---------------------------------------------------------------------------

describe('getExternalModelsCached', () => {
  it('returns known:false when cacheDir does not exist', () => {
    const missing = path.join(tmpDir, 'no-such-dir');
    const result = getExternalModelsCached(missing);
    expect(result.known).toBe(false);
  });

  it('returns known:false when cacheDir is empty', () => {
    const result = getExternalModelsCached(cacheDir);
    expect(result.known).toBe(false);
  });

  it('returns the cached catalog when a valid entry exists', async () => {
    await writeCache(cacheDir, `${CACHE_KEY_PREFIX}0.2.0`, VALID_PAYLOAD, CACHE_TTL_MS);
    const result = getExternalModelsCached(cacheDir);
    expect(result.known).toBe(true);
    if (!result.known) return;
    expect(result.models.length).toBe(2);
    // Fresh entry with full 24h TTL must yield 'cache', not 'stale-cache'.
    // Deleting the cache read path would make this fail (avoids PF-018).
    expect(result.source).toBe('cache');
  });

  it('returns source:stale-cache for an expired entry', async () => {
    // Write an expired entry (1ms TTL) and wait for expiry.
    // getExternalModelsCached never deletes on expiry — findStaleFallback still finds
    // the file and returns it as 'stale-cache'. Removing findStaleFallback would cause
    // result.known to be false, making the hard assert below fail (avoids PF-018).
    await writeCache(cacheDir, `${CACHE_KEY_PREFIX}0.1.0`, VALID_PAYLOAD, 1);
    await new Promise((r) => setTimeout(r, 10));
    const result = getExternalModelsCached(cacheDir);
    expect(result.known).toBe(true);
    if (!result.known) return;
    expect(result.source).toBe('stale-cache');
  });

  it('picks the newest entry by embedded timestamp across multiple versions', async () => {
    // Write two entries; the one for version 0.2.0 has the higher timestamp
    const olderPayload = JSON.stringify({
      schemaVersion: 1,
      kind: 'models',
      models: [
        { id: 'gpt-older', provider: 'codex', routable: true, retired: false, aliases: [] },
      ],
    });
    await writeCache(cacheDir, `${CACHE_KEY_PREFIX}0.1.0`, olderPayload, CACHE_TTL_MS);
    await new Promise((r) => setTimeout(r, 5)); // ensure different timestamps
    await writeCache(cacheDir, `${CACHE_KEY_PREFIX}0.2.0`, VALID_PAYLOAD, CACHE_TTL_MS);

    const result = getExternalModelsCached(cacheDir);
    expect(result.known).toBe(true);
    if (!result.known) return;
    // Should return the newer entry's models (gpt-5.6-sol, gpt-5.4-terra)
    const ids = result.models.map((m) => m.id);
    expect(ids).toContain('gpt-5.6-sol');
    expect(ids).not.toContain('gpt-older');
  });

  it('returns known:false when the only entry has a corrupt payload', async () => {
    // Manually write a cache file with corrupt JSON as the data field
    const corruptPayload = JSON.stringify({
      data: 'not-valid-models-json{{{',
      timestamp: Date.now(),
      ttl: CACHE_TTL_MS,
    });
    await fsAsync.writeFile(
      path.join(cacheDir, `${CACHE_KEY_PREFIX}corrupt.json`),
      corruptPayload,
      'utf-8',
    );
    const result = getExternalModelsCached(cacheDir);
    expect(result.known).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// discoverExternalModels — injectable dep tests (no real process spawn)
// ---------------------------------------------------------------------------

describe('discoverExternalModels — injectable deps (no real binary)', () => {
  it('returns known:false when resolveProxyBin returns an error (no binary)', async () => {
    const deps: ModelDiscoveryDeps = {
      resolveProxyBin: async () => ({ ok: false, error: 'routing runtime missing (MODULE_NOT_FOUND)' }),
    };
    const result = await discoverExternalModels(cacheDir, logPath, deps);
    expect(result.known).toBe(false);
  });

  it('returns known:false when spawnAndCollect returns exitCode != 0 and no cache', async () => {
    const deps: ModelDiscoveryDeps = {
      resolveProxyBin: async () => ({
        ok: true,
        value: { binPath: '/fake/bin/path', npxWarning: false, version: '0.2.0' },
      }),
      spawnAndCollect: async () => ({ exitCode: 1, stdout: '', timedOut: false }),
    };
    const result = await discoverExternalModels(cacheDir, logPath, deps);
    expect(result.known).toBe(false);
  });

  it('returns known:true from cache when fresh entry exists (no spawn needed)', async () => {
    // Write a fresh cache entry for version 0.2.0
    await writeCache(cacheDir, `${CACHE_KEY_PREFIX}0.2.0`, VALID_PAYLOAD, CACHE_TTL_MS);

    let spawnCalled = false;
    const deps: ModelDiscoveryDeps = {
      resolveProxyBin: async () => ({
        ok: true,
        value: { binPath: '/fake/bin', npxWarning: false, version: '0.2.0' },
      }),
      spawnAndCollect: async () => {
        spawnCalled = true;
        return { exitCode: 0, stdout: VALID_PAYLOAD, timedOut: false };
      },
    };
    const result = await discoverExternalModels(cacheDir, logPath, deps);
    expect(result.known).toBe(true);
    if (!result.known) return;
    expect(result.source).toBe('cache');
    // spawnAndCollect must NOT have been called — the cache hit short-circuited it
    expect(spawnCalled).toBe(false);
  });

  it('falls back to stale-cache when live spawn fails', async () => {
    // Write an expired entry (1ms TTL) — findStaleFallback finds it regardless of TTL.
    // Removing findStaleFallback would make result.known false, failing the hard assert
    // below and proving the test is no longer vacuous (avoids PF-018).
    await writeCache(cacheDir, `${CACHE_KEY_PREFIX}0.1.0`, VALID_PAYLOAD, 1);
    await new Promise((r) => setTimeout(r, 10));

    const deps: ModelDiscoveryDeps = {
      resolveProxyBin: async () => ({
        ok: true,
        value: { binPath: '/fake/bin', npxWarning: false, version: '0.2.0' },
      }),
      spawnAndCollect: async () => ({ exitCode: 1, stdout: '', timedOut: false }),
    };
    const result = await discoverExternalModels(cacheDir, logPath, deps);
    expect(result.known).toBe(true);
    if (!result.known) return;
    expect(result.source).toBe('stale-cache');
  });

  it('writes to cache on successful live spawn', async () => {
    const deps: ModelDiscoveryDeps = {
      resolveProxyBin: async () => ({
        ok: true,
        value: { binPath: '/fake/bin', npxWarning: false, version: '0.2.0' },
      }),
      spawnAndCollect: async () => ({ exitCode: 0, stdout: VALID_PAYLOAD, timedOut: false }),
    };
    await discoverExternalModels(cacheDir, logPath, deps);

    // After the call, the cache directory should contain a fresh entry
    const entries = fs.readdirSync(cacheDir);
    const cacheEntries = entries.filter(
      (e) => e.startsWith(CACHE_KEY_PREFIX) && e.endsWith('.json'),
    );
    expect(cacheEntries.length).toBeGreaterThan(0);
  });

  it('returns known:true with source:live on successful live spawn', async () => {
    const deps: ModelDiscoveryDeps = {
      resolveProxyBin: async () => ({
        ok: true,
        value: { binPath: '/fake/bin', npxWarning: false, version: '0.2.0' },
      }),
      spawnAndCollect: async () => ({ exitCode: 0, stdout: VALID_PAYLOAD, timedOut: false }),
    };
    const result = await discoverExternalModels(cacheDir, logPath, deps);
    expect(result.known).toBe(true);
    if (!result.known) return;
    expect(result.source).toBe('live');
    expect(result.models.length).toBe(2);
  });

  it('never throws (AC-C8) — even when deps throw internally', async () => {
    const deps: ModelDiscoveryDeps = {
      resolveProxyBin: async () => {
        throw new Error('unexpected dep error');
      },
    };
    // Must resolve, never reject
    await expect(discoverExternalModels(cacheDir, logPath, deps)).resolves.toBeDefined();
    const result = await discoverExternalModels(cacheDir, logPath, deps);
    expect(result.known).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// T6: argv assertion — ALWAYS ['models', '--json']
// ---------------------------------------------------------------------------

describe('T6: spawnAndCollect is always called with argv = ["models", "--json"]', () => {
  it('passes exact argv ["models", "--json"] to spawnAndCollect', async () => {
    let capturedArgv: readonly string[] | undefined;

    const deps: ModelDiscoveryDeps = {
      resolveProxyBin: async () => ({
        ok: true,
        value: { binPath: '/fake/bin', npxWarning: false, version: 'test-only' },
      }),
      spawnAndCollect: async (opts) => {
        capturedArgv = opts.argv;
        return { exitCode: 1, stdout: '', timedOut: false };
      },
    };

    await discoverExternalModels(cacheDir, logPath, deps);
    expect(capturedArgv).toBeDefined();
    expect(Array.isArray(capturedArgv)).toBe(true);
    expect(capturedArgv).toEqual(['models', '--json']);
  });

  it('passes execPath = process.execPath to spawnAndCollect', async () => {
    let capturedExecPath: string | undefined;

    const deps: ModelDiscoveryDeps = {
      resolveProxyBin: async () => ({
        ok: true,
        value: { binPath: '/fake/bin', npxWarning: false, version: 'test-only' },
      }),
      spawnAndCollect: async (opts) => {
        capturedExecPath = opts.execPath;
        return { exitCode: 1, stdout: '', timedOut: false };
      },
    };

    await discoverExternalModels(cacheDir, logPath, deps);
    expect(capturedExecPath).toBe(process.execPath);
  });

  it('passes cwd = os.tmpdir() to spawnAndCollect (PF-013)', async () => {
    let capturedCwd: string | undefined;

    const deps: ModelDiscoveryDeps = {
      resolveProxyBin: async () => ({
        ok: true,
        value: { binPath: '/fake/bin', npxWarning: false, version: 'test-only' },
      }),
      spawnAndCollect: async (opts) => {
        capturedCwd = opts.cwd;
        return { exitCode: 1, stdout: '', timedOut: false };
      },
    };

    await discoverExternalModels(cacheDir, logPath, deps);
    expect(capturedCwd).toBe(os.tmpdir());
  });

  it('env does not contain ANTHROPIC_API_KEY (SEC-2 / scrubChildEnv)', async () => {
    let capturedEnv: NodeJS.ProcessEnv | undefined;

    const deps: ModelDiscoveryDeps = {
      resolveProxyBin: async () => ({
        ok: true,
        value: { binPath: '/fake/bin', npxWarning: false, version: 'test-only' },
      }),
      spawnAndCollect: async (opts) => {
        capturedEnv = opts.env;
        return { exitCode: 1, stdout: '', timedOut: false };
      },
    };

    // Temporarily inject a fake API key into process.env to make the test
    // meaningful — if scrubChildEnv were not called it would pass through.
    const origKey = process.env['ANTHROPIC_API_KEY'];
    process.env['ANTHROPIC_API_KEY'] = 'sk-fake-test-key';
    try {
      await discoverExternalModels(cacheDir, logPath, deps);
    } finally {
      if (origKey === undefined) {
        delete process.env['ANTHROPIC_API_KEY'];
      } else {
        process.env['ANTHROPIC_API_KEY'] = origKey;
      }
    }

    expect(capturedEnv).toBeDefined();
    expect(capturedEnv!['ANTHROPIC_API_KEY']).toBeUndefined();
  });

  it('env contains NO_COLOR=1 (suppresses ANSI in stdout)', async () => {
    let capturedEnv: NodeJS.ProcessEnv | undefined;

    const deps: ModelDiscoveryDeps = {
      resolveProxyBin: async () => ({
        ok: true,
        value: { binPath: '/fake/bin', npxWarning: false, version: 'test-only' },
      }),
      spawnAndCollect: async (opts) => {
        capturedEnv = opts.env;
        return { exitCode: 1, stdout: '', timedOut: false };
      },
    };

    await discoverExternalModels(cacheDir, logPath, deps);
    expect(capturedEnv).toBeDefined();
    expect(capturedEnv!['NO_COLOR']).toBe('1');
  });
});

// ---------------------------------------------------------------------------
// T12: pruneOldEntries keeps at most 3 entries
// ---------------------------------------------------------------------------

describe('T12: pruneOldEntries after live write', () => {
  it('keeps at most 3 external-models-v1-* entries, removing oldest by timestamp', async () => {
    // Write 5 stale entries with distinct timestamps
    for (let i = 0; i < 5; i++) {
      const version = `0.${i}.0`;
      await writeCache(cacheDir, `${CACHE_KEY_PREFIX}${version}`, VALID_PAYLOAD, CACHE_TTL_MS);
      // Ensure distinct timestamps (writeCache uses Date.now())
      await new Promise((r) => setTimeout(r, 5));
    }

    // Verify 5 entries exist before the discovery call
    const before = fs.readdirSync(cacheDir).filter(
      (e) => e.startsWith(CACHE_KEY_PREFIX) && e.endsWith('.json'),
    );
    expect(before.length).toBe(5);

    // Run discoverExternalModels with injectable deps so it does a "live" write
    // This triggers pruneOldEntries which should reduce to 3
    const deps: ModelDiscoveryDeps = {
      resolveProxyBin: async () => ({
        ok: true,
        value: { binPath: '/fake/bin', npxWarning: false, version: '1.0.0' },
      }),
      spawnAndCollect: async () => ({ exitCode: 0, stdout: VALID_PAYLOAD, timedOut: false }),
    };
    await discoverExternalModels(cacheDir, logPath, deps);

    // After pruning: exactly 3 entries remain (5 pre-seeded + 1 live write = 6 total;
    // pruneOldEntries keeps the 3 newest). toBeLessThanOrEqual(3) would pass even if
    // pruning deleted everything — toBe(3) proves pruning ran and kept the right count
    // (avoids PF-018).
    const after = fs.readdirSync(cacheDir).filter(
      (e) => e.startsWith(CACHE_KEY_PREFIX) && e.endsWith('.json'),
    );
    expect(after.length).toBe(3);
  });

  it('keeps the 3 newest entries by embedded timestamp, not alphabetical order', async () => {
    // Write 4 entries; the newest should survive
    const versions = ['0.1.0', '0.2.0', '0.3.0', '0.4.0'];
    for (const v of versions) {
      await writeCache(cacheDir, `${CACHE_KEY_PREFIX}${v}`, VALID_PAYLOAD, CACHE_TTL_MS);
      await new Promise((r) => setTimeout(r, 5));
    }

    const deps: ModelDiscoveryDeps = {
      resolveProxyBin: async () => ({
        ok: true,
        value: { binPath: '/fake/bin', npxWarning: false, version: '1.0.0' },
      }),
      spawnAndCollect: async () => ({ exitCode: 0, stdout: VALID_PAYLOAD, timedOut: false }),
    };
    await discoverExternalModels(cacheDir, logPath, deps);

    const remaining = fs.readdirSync(cacheDir).filter(
      (e) => e.startsWith(CACHE_KEY_PREFIX) && e.endsWith('.json'),
    );
    // The 0.1.0 entry (oldest written) should be gone; 0.2.0, 0.3.0, 0.4.0, and
    // 1.0.0 compete for the 3 surviving slots — 0.1.0 must not be among them
    expect(remaining).not.toContain(`${CACHE_KEY_PREFIX}0.1.0.json`);
  });
});

// ---------------------------------------------------------------------------
// T1: Real-binary happy path (skip if routing runtime not installed)
// ---------------------------------------------------------------------------

describe('T1: Real-binary — discoverExternalModels with live runtime', () => {
  it('returns known:true with live data when routing runtime is installed', async (ctx) => {
    // Resolve the real bin first — use vitest's ctx.skip() so the test reports SKIPPED
    // (not PASSED) when the runtime is absent. A bare `return` masks the skip as PASSED
    // and is a PF-018 vacuous-green mechanism.
    const binResult = await resolveProxyBin();
    if (!binResult.ok) {
      if (binResult.error.includes('MODULE_NOT_FOUND') || binResult.error.includes('routing runtime')) {
        ctx.skip();
        return;
      }
      // Unexpected error — fail the test
      throw new Error(`resolveProxyBin failed unexpectedly: ${binResult.error}`);
    }

    const result = await discoverExternalModels(cacheDir, logPath);

    // subswitch models --json (0.2.0) is a static registry dump: no auth, no relay,
    // no config file required (verified: exit 0, configFileFound:false). The per-test
    // cacheDir is freshly created (beforeEach), so no cache hit is possible — source
    // must be 'live'. Guarding these behind `if (result.known)` would let the test
    // pass vacuously when the live call incorrectly returns known:false (avoids PF-018).
    expect(result.known).toBe(true);
    if (!result.known) return; // TypeScript narrowing only
    expect(result.source).toBe('live');
    expect(result.models.length).toBeGreaterThan(0);
    // selectableNames must be non-empty and duplicate-free
    expect(result.selectableNames.length).toBeGreaterThan(0);
    expect(new Set(result.selectableNames).size).toBe(result.selectableNames.length);
    // aliasToId must cover all selectableNames
    for (const name of result.selectableNames) {
      expect(result.aliasToId.has(name)).toBe(true);
    }
  }, 10_000); // 10s timeout for live spawn
});

// ---------------------------------------------------------------------------
// T3: PF-013 — cwd isolation from devflow directory (real-binary skip)
// ---------------------------------------------------------------------------

describe('T3: PF-013 — cwd is os.tmpdir(), not devflow dir', () => {
  it(
    'spawn cwd is os.tmpdir() even when process cwd contains a legacy config file',
    async () => {
      // Same skip discipline as T1/T2: skip ONLY on MODULE_NOT_FOUND.
      const binResult = await resolveProxyBin();
      if (!binResult.ok) {
        if (binResult.error.includes('MODULE_NOT_FOUND') || binResult.error.includes('routing runtime')) {
          return; // skip — runtime not installed
        }
        throw new Error(`resolveProxyBin failed unexpectedly: ${binResult.error}`);
      }

      if (process.platform === 'win32') return; // shell scripts not available on win32

      // Create a temp dir with a pre-0.2.0 legacy config (the format 0.2.0 hard-fails on
      // when it finds it in the spawn cwd). If production incorrectly used process.cwd()
      // for the spawn, this stub would see the file and exit non-zero → result.known:false.
      // Because production uses os.tmpdir(), the stub sees no config and returns valid JSON.
      const legacyConfigDir = await fsAsync.mkdtemp(
        path.join(os.tmpdir(), 'devflow-t3-legacy-'),
      );
      const originalCwd = process.cwd();

      try {
        await fsAsync.writeFile(
          path.join(legacyConfigDir, 'subswitch.config.json'),
          JSON.stringify({ codex: { apiKey: 'legacy-key' } }),
          'utf-8',
        );

        // Stub: exits 1 if subswitch.config.json exists in cwd (simulates 0.2.0 hard-fail
        // on legacy config), exits 0 and emits valid JSON otherwise (spawn cwd was clean).
        const stubContent = [
          '#!/bin/sh',
          '[ -f "subswitch.config.json" ] && exit 1',
          `echo '${VALID_PAYLOAD}'`,
          'exit 0',
        ].join('\n') + '\n';
        const stub = await writeStubScript(tmpDir, 'stub-t3-cwd-check.sh', stubContent);

        // Change process cwd to the legacy config dir — if the spawn uses process.cwd()
        // instead of os.tmpdir(), the stub would detect the config and exit 1 → known:false.
        process.chdir(legacyConfigDir);

        // shellDeps runs the real shell stub (applies PF-016) — cwd comes from opts.cwd,
        // which production sets to os.tmpdir(). If production used process.cwd() the stub
        // would find subswitch.config.json and exit 1 → known:false (test would catch it).
        const deps = shellDeps(stub);

        const result = await discoverExternalModels(cacheDir, logPath, deps);

        // The stub ran with cwd = os.tmpdir() (no legacy config) → exited 0 → known:true.
        // If production had used process.cwd() (= legacyConfigDir), stub would exit 1 → known:false.
        expect(result.known).toBe(true);
        if (result.known) {
          expect(result.source).toBe('live');
        }
      } finally {
        process.chdir(originalCwd);
        await fsAsync.rm(legacyConfigDir, { recursive: true, force: true });
      }
    },
    10_000,
  );
});

// ---------------------------------------------------------------------------
// T2: Real-binary stub — hostile SUBSWITCH_CONFIG is stripped from child env
// (applies PF-016; discrete test closing the gap noted in prior phase)
// ---------------------------------------------------------------------------

describe('T2: Real-binary stub — hostile SUBSWITCH_CONFIG stripped from child env (PF-016)', () => {
  it(
    'SUBSWITCH_CONFIG is absent from the child env even when set in the parent process',
    async () => {
      if (process.platform === 'win32') return; // shell scripts not available on win32

      // Shell script: exits 0 if SUBSWITCH_CONFIG is absent in env (stripping worked),
      // exits 2 if it leaked through. Either way stdout is empty (not valid models JSON)
      // so discoverExternalModels returns known:false regardless.
      // applies PF-016: real binary — not a vitest mock returning a fixed exit code.
      const stubContent = [
        '#!/bin/sh',
        '[ -z "$SUBSWITCH_CONFIG" ] && exit 0',
        'exit 2',
      ].join('\n') + '\n';
      const stub = await writeStubScript(tmpDir, 'stub-t2-env-check.sh', stubContent);

      // Write a plausible hostile legacy config to point SUBSWITCH_CONFIG at
      const hostileConfigPath = path.join(tmpDir, 't2-legacy-config.json');
      await fsAsync.writeFile(
        hostileConfigPath,
        JSON.stringify({ port: 4141, models: [] }),
        'utf-8',
      );

      // Temporarily inject the hostile config into process.env so scrubChildEnv has
      // something real to strip. If it fails to strip, the child will see it.
      const origVal = process.env['SUBSWITCH_CONFIG'];
      process.env['SUBSWITCH_CONFIG'] = hostileConfigPath;

      let childExitCode: number | undefined;
      try {
        // onExitCode callback captures the raw child exit code so we can distinguish
        // exit 0 (SUBSWITCH_CONFIG absent → stripping worked) from exit 2 (leaked).
        const deps = shellDeps(stub, (code) => { childExitCode = code; });

        const result = await discoverExternalModels(cacheDir, logPath, deps);
        // The stub exits 0 (absent) → empty stdout, JSON parse fails → known:false.
        // The stub exits 2 (present) → exitCode != 0 → known:false.
        // Either way known:false; the discriminator is childExitCode.
        expect(result.known).toBe(false);
      } finally {
        if (origVal === undefined) {
          delete process.env['SUBSWITCH_CONFIG'];
        } else {
          process.env['SUBSWITCH_CONFIG'] = origVal;
        }
      }

      // Exit code 0 → SUBSWITCH_CONFIG was absent from child env (stripping worked).
      // Exit code 2 → leaked through (test failure).
      expect(childExitCode).toBe(0);
    },
    10_000,
  );
});

// ---------------------------------------------------------------------------
// Shared utilities for real-binary shell-stub tests (T2, T3, T4, AC-P8)
// Applies PF-016: real spawned processes, not vitest mocks.
// ---------------------------------------------------------------------------

/**
 * Write a short shell script to a temp path and make it executable.
 * Returns the path to the script.
 */
async function writeStubScript(tmpDir: string, name: string, content: string): Promise<string> {
  const scriptPath = path.join(tmpDir, name);
  await fsAsync.writeFile(scriptPath, content, { mode: 0o755 });
  return scriptPath;
}

/**
 * Build ModelDiscoveryDeps that runs a real shell script via spawnSync.
 * Applies PF-016: a real spawned process is used — not a vitest mock that
 * always returns a fixed exit code without touching OS spawn or pipe plumbing.
 *
 * Previously defined inside the T4 describe block (unreachable from T2/T3).
 * Hoisted to module scope so all shell-stub suites share one definition.
 *
 * @param stubPath Path to the shell script stub to execute
 * @param onExitCode Optional callback receiving the raw child exit code.
 *   Used by T2 to distinguish exit 0 (env stripped) from exit 2 (env leaked).
 */
function shellDeps(stubPath: string, onExitCode?: (code: number) => void): ModelDiscoveryDeps {
  return {
    resolveProxyBin: async () => ({
      ok: true,
      value: { binPath: stubPath, npxWarning: false, version: '0.2.0' },
    }),
    spawnAndCollect: async (opts) => {
      const { spawnSync } = await import('child_process');
      const out = spawnSync('sh', [opts.binPath], {
        encoding: 'utf-8',
        timeout: SPAWN_TIMEOUT_MS + 1_000,
        env: opts.env as Record<string, string>,
        cwd: opts.cwd,
      });
      onExitCode?.(out.status ?? -1);
      return {
        exitCode: out.status ?? 1,
        stdout: out.stdout ?? '',
        timedOut: out.signal === 'SIGTERM' || out.signal === 'SIGKILL',
      };
    },
  };
}

describe('T4: Real-binary stub — stale-cache fallback on spawn failure (applies PF-016)', () => {
  // Pre-seed a stale cache entry so the stale-cache outcome is deterministic.
  // Uses a different version key from the stubs (0.2.0) so it is skipped by the
  // fresh-cache check but found by findStaleFallback. findStaleFallback ignores TTL
  // (ignoreExpiry semantics) so any non-future-timestamped entry is eligible.
  beforeEach(async () => {
    await writeCache(cacheDir, `${CACHE_KEY_PREFIX}stale`, VALID_PAYLOAD, CACHE_TTL_MS);
  });

  // Thin wrapper so T4 tests read as runShellStub(shellDeps(stub)) rather than
  // repeating discoverExternalModels(cacheDir, logPath, deps) at every call site.
  async function runShellStub(
    deps: ModelDiscoveryDeps,
  ): ReturnType<typeof discoverExternalModels> {
    return discoverExternalModels(cacheDir, logPath, deps);
  }

  it('exit-1 → stale-cache (unconditional)', async () => {
    if (process.platform === 'win32') return;

    const stub = await writeStubScript(tmpDir, 'stub-t4-exit1.sh', '#!/bin/sh\nexit 1\n');
    const result = await runShellStub(shellDeps(stub));

    // Stale pre-seeded and valid → must return known:true, source:'stale-cache'
    expect(result.known).toBe(true);
    if (result.known) {
      expect(result.source).toBe('stale-cache');
    }
  });

  it('garbage stdout (binary noise) with exit-0 → stale-cache (unconditional)', async () => {
    if (process.platform === 'win32') return;

    // Emit null bytes + non-UTF-8 noise — parseModelsJson rejects it
    const stub = await writeStubScript(
      tmpDir,
      'stub-t4-garbage.sh',
      '#!/bin/sh\nprintf "\\x00\\xff\\xfe garbage\\n"\nexit 0\n',
    );
    const result = await runShellStub(shellDeps(stub));

    expect(result.known).toBe(true);
    if (result.known) {
      expect(result.source).toBe('stale-cache');
    }
  });

  it('schemaVersion:2 (unsupported) → stale-cache (unconditional)', async () => {
    if (process.platform === 'win32') return;

    const badPayload = JSON.stringify({
      schemaVersion: 2,  // parseModelsJson hard-gates on schemaVersion !== 1
      kind: 'models',
      providers: [],
      models: [],
    });
    const stub = await writeStubScript(
      tmpDir,
      'stub-t4-schema2.sh',
      `#!/bin/sh\necho '${badPayload}'\nexit 0\n`,
    );
    const result = await runShellStub(shellDeps(stub));

    expect(result.known).toBe(true);
    if (result.known) {
      expect(result.source).toBe('stale-cache');
    }
  });

  it('{} payload (missing required fields) → stale-cache (unconditional)', async () => {
    if (process.platform === 'win32') return;

    const stub = await writeStubScript(
      tmpDir,
      'stub-t4-empty.sh',
      `#!/bin/sh\necho '{}'\nexit 0\n`,
    );
    const result = await runShellStub(shellDeps(stub));

    expect(result.known).toBe(true);
    if (result.known) {
      expect(result.source).toBe('stale-cache');
    }
  });

  it('SIGTERM-ignoring child killed by SIGKILL → stale-cache (production spawn path)', async () => {
    // This case uses the PRODUCTION buildRealSpawnAndCollect (no spawnAndCollect injection)
    // so the actual SIGTERM→SIGKILL escalation logic in model-discovery.ts is exercised.
    // Stub is a .js file so production can run it as: process.execPath [stub, 'models', '--json'].
    //
    // The stub writes its own PID so we can verify it is genuinely dead after the test.
    // Production's SIGKILL fires on an unref()'d timer that runs SIGKILL_GRACE_MS after
    // discoverExternalModels returns. Without this check a leaked stub could accumulate
    // over multiple runs and stretch the suite from ~24s to 40+ minutes (real incident,
    // feature KB 'Leaked stub relays' gotcha).
    const pidFile = path.join(tmpDir, 'stub-t4-sigterm.pid');
    const stubContent = [
      '// SIGTERM-ignoring stub (T4)',
      `const fs = require('fs');`,
      `fs.writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));`,
      'process.on("SIGTERM", () => {});  // ignore SIGTERM — must be killed by SIGKILL',
      'setInterval(() => {}, 100000);    // hold event loop open',
    ].join('\n') + '\n';
    const stub = await writeStubScript(tmpDir, 'stub-t4-sigterm.js', stubContent);

    const deps: ModelDiscoveryDeps = {
      resolveProxyBin: async () => ({
        ok: true,
        value: { binPath: stub, npxWarning: false, version: '0.2.0' },
      }),
      // No spawnAndCollect — production buildRealSpawnAndCollect runs
    };

    const before = Date.now();
    const result = await discoverExternalModels(cacheDir, logPath, deps);
    const elapsed = Date.now() - before;

    // Stale pre-seeded and valid → must return known:true, source:'stale-cache'
    expect(result.known).toBe(true);
    if (result.known) {
      expect(result.source).toBe('stale-cache');
    }
    // Must return within: SPAWN_TIMEOUT_MS + SIGKILL_GRACE_MS + 2s headroom
    const upperBound = SPAWN_TIMEOUT_MS + SIGKILL_GRACE_MS + 2_000;
    expect(elapsed).toBeLessThan(upperBound);

    // Verify the child is genuinely dead. Production fires SIGKILL on an unref()'d
    // timer SIGKILL_GRACE_MS after discoverExternalModels returns — wait for it to land,
    // then probe with signal 0 (throws ESRCH when the process is gone). Mirrors AC-P8.
    await new Promise((r) => setTimeout(r, SIGKILL_GRACE_MS + 500));
    if (fs.existsSync(pidFile)) {
      const pid = parseInt(fs.readFileSync(pidFile, 'utf-8').trim(), 10);
      if (Number.isFinite(pid) && pid > 0) {
        let stillAlive = false;
        try {
          process.kill(pid, 0); // throws ESRCH if dead
          stillAlive = true;
        } catch {
          // ESRCH — expected: process is dead
        }
        expect(stillAlive).toBe(false);
      }
    }
  }, SPAWN_TIMEOUT_MS + SIGKILL_GRACE_MS + 5_000);

  it('300KB payload exceeds STDOUT_CAP → overflow kill → stale-cache (production path)', async () => {
    // Tests the STDOUT_CAP (262144) overflow path in buildRealSpawnAndCollect.
    // The production data handler kills the child when stdout > STDOUT_CAP.
    // Result: exitCode:1, stdout:'', timedOut:false → stale-cache fallback.
    // Applies PF-016: real .js process writing real bytes, not a mock that pretends.
    const stubContent = [
      '// 300KB overflow stub (T4)',
      '// Write > STDOUT_CAP (262144) bytes. Hold alive for SIGTERM after overflow kill.',
      'process.stdout.write("A".repeat(263000));',
      'process.on("SIGTERM", () => process.exit(1));',
      'setInterval(() => {}, 1000);',
    ].join('\n') + '\n';
    const stub = await writeStubScript(tmpDir, 'stub-t4-overflow.js', stubContent);

    const deps: ModelDiscoveryDeps = {
      resolveProxyBin: async () => ({
        ok: true,
        value: { binPath: stub, npxWarning: false, version: '0.2.0' },
      }),
      // No spawnAndCollect — production path exercises STDOUT_CAP handling
    };

    const result = await discoverExternalModels(cacheDir, logPath, deps);

    expect(result.known).toBe(true);
    if (result.known) {
      expect(result.source).toBe('stale-cache');
    }
  }, SPAWN_TIMEOUT_MS + SIGKILL_GRACE_MS + 5_000);
});

describe('AC-P8: SIGTERM + SIGKILL escalation on timeout (applies PF-016)', () => {
  it(
    'discoverExternalModels returns known:false (not hang) when process ignores SIGTERM',
    async () => {
      if (process.platform === 'win32') return;

      // .js stub: production spawns it as `process.execPath [stub] models --json`.
      // It writes its own PID, ignores SIGTERM, and hangs. Production must SIGKILL it.
      // No spawnAndCollect injection — the real buildRealSpawnAndCollect path runs.
      const pidFile = path.join(tmpDir, 'stub-p8.pid');
      const stubContent = [
        '// AC-P8 stub: ignore SIGTERM, write PID, hang',
        `const fs = require('fs');`,
        `fs.writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));`,
        `process.on('SIGTERM', () => {});  // ignore SIGTERM — must be SIGKILL'd`,
        `setInterval(() => {}, 100000);    // hold event loop open indefinitely`,
      ].join('\n') + '\n';
      const stub = await writeStubScript(tmpDir, 'stub-p8-sigterm.js', stubContent);

      const deps: ModelDiscoveryDeps = {
        resolveProxyBin: async () => ({
          ok: true,
          value: { binPath: stub, npxWarning: false, version: 'test-only' },
        }),
        // No spawnAndCollect — production buildRealSpawnAndCollect runs SIGTERM→SIGKILL
      };

      const before = Date.now();
      const result = await discoverExternalModels(cacheDir, logPath, deps);
      const elapsed = Date.now() - before;

      // Must return known:false (timed-out spawn, no stale cache pre-seeded in this describe)
      expect(result.known).toBe(false);

      // Must return within: SPAWN_TIMEOUT_MS + SIGKILL_GRACE_MS + 2s headroom
      const upperBound = SPAWN_TIMEOUT_MS + SIGKILL_GRACE_MS + 2_000;
      expect(elapsed).toBeLessThan(upperBound);

      // Wait for SIGKILL to land (unreffed timer in production fires SIGKILL_GRACE_MS
      // after discoverExternalModels returns; add 500ms margin).
      await new Promise((r) => setTimeout(r, SIGKILL_GRACE_MS + 500));
      if (fs.existsSync(pidFile)) {
        const pid = parseInt(fs.readFileSync(pidFile, 'utf-8').trim(), 10);
        if (Number.isFinite(pid) && pid > 0) {
          let stillAlive = false;
          try {
            process.kill(pid, 0); // throws ESRCH if dead
            stillAlive = true;
          } catch {
            // ESRCH — expected: process is dead
          }
          expect(stillAlive).toBe(false);
        }
      }
    },
    // Total budget: SPAWN_TIMEOUT_MS + SIGKILL_GRACE_MS + 2s headroom + 1s verify = ~7.5s
    (SPAWN_TIMEOUT_MS + SIGKILL_GRACE_MS) * 2 + 3_500,
  );
});
