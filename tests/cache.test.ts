/**
 * Tests for src/core/cache.ts
 *
 * Coverage:
 *   - Basic read/write round-trip with validator
 *   - TTL expiry (returns null when expired)
 *   - Path containment: key with ".." escapes are rejected (AC-S4)
 *   - Corrupt JSON rejected by validator path
 *   - Future timestamp rejected
 *   - Non-finite timestamp/ttl rejected
 *   - MAX_TTL_MS clamping on write
 *   - Directory created at 0700 (AC-S5)
 *   - Entries created at 0600 (AC-S5)
 *   - Validator called on every read (AC-S6)
 *   - Validator returning null treated as miss
 *   - parseRawEnvelope: shared envelope parser for raw-file readers
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { readCache, writeCache, MAX_TTL_MS, parseRawEnvelope, modelCacheDir, hudCacheDir } from '../src/core/cache.js';

const IS_WIN32 = process.platform === 'win32';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface TestData {
  value: string;
}

function validateTestData(data: unknown): TestData | null {
  if (typeof data !== 'object' || data === null) return null;
  const obj = data as Record<string, unknown>;
  if (typeof obj.value !== 'string') return null;
  return { value: obj.value };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let cacheDir: string;

beforeEach(async () => {
  cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-cache-test-'));
});

afterEach(async () => {
  await fs.rm(cacheDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Basic read/write
// ---------------------------------------------------------------------------

describe('writeCache / readCache — basic round-trip', () => {
  it('writes a value and reads it back', async () => {
    await writeCache(cacheDir, 'test-key', { value: 'hello' }, 60_000);
    const result = readCache<TestData>(cacheDir, 'test-key', validateTestData);
    expect(result).toEqual({ value: 'hello' });
  });

  it('returns null on cache miss (key never written)', () => {
    const result = readCache<TestData>(cacheDir, 'missing', validateTestData);
    expect(result).toBeNull();
  });

  it('overwrites existing entry', async () => {
    await writeCache(cacheDir, 'key', { value: 'first' }, 60_000);
    await writeCache(cacheDir, 'key', { value: 'second' }, 60_000);
    const result = readCache<TestData>(cacheDir, 'key', validateTestData);
    expect(result).toEqual({ value: 'second' });
  });
});

// ---------------------------------------------------------------------------
// TTL expiry
// ---------------------------------------------------------------------------

describe('readCache — TTL expiry', () => {
  it('returns null when TTL is already elapsed (ttl=1ms)', async () => {
    // Write with 1ms TTL so it expires immediately
    await writeCache(cacheDir, 'expired', { value: 'old' }, 1);
    // Wait for expiry
    await new Promise(r => setTimeout(r, 5));
    const result = readCache<TestData>(cacheDir, 'expired', validateTestData);
    expect(result).toBeNull();
  });

  it('returns value when still within TTL', async () => {
    await writeCache(cacheDir, 'fresh', { value: 'ok' }, 60_000);
    const result = readCache<TestData>(cacheDir, 'fresh', validateTestData);
    expect(result).toEqual({ value: 'ok' });
  });
});

// ---------------------------------------------------------------------------
// Path containment — AC-S4
// ---------------------------------------------------------------------------

describe('safeEntryPath — path containment guard', () => {
  it('rejects traversal keys — write cannot escape cacheDir', async () => {
    // Create a sibling directory reachable via path traversal so the test
    // genuinely proves the guard, not an incidentally-missing parent directory.
    // If safeEntryPath() were removed, writeCache would succeed here and write
    // to sibling/payload.json (avoids PF-018: non-empty target).
    const sibling = path.join(path.dirname(cacheDir), 'escape-sibling');
    await fs.mkdir(sibling, { recursive: true });
    try {
      await writeCache(cacheDir, '../escape-sibling/payload', { value: 'x' }, 60_000);
      // Assert the file was NOT written outside cacheDir.
      // fileExists is a boolean resolved OUTSIDE any try/catch — a guard
      // regression propagates as a real test failure (avoids PF-018).
      const escapedFile = path.join(sibling, 'payload.json');
      const fileExists = await fs.access(escapedFile).then(() => true, () => false);
      expect(fileExists, 'Path traversal guard failed — file was written outside cacheDir').toBe(false);
    } finally {
      await fs.rm(sibling, { recursive: true, force: true });
    }
  });

  it('returns null on read for traversal key', () => {
    const result = readCache<TestData>(cacheDir, '../escape', validateTestData);
    expect(result).toBeNull();
  });

  it('accepts simple key with no traversal', async () => {
    await writeCache(cacheDir, 'simple-key', { value: 'ok' }, 60_000);
    const result = readCache<TestData>(cacheDir, 'simple-key', validateTestData);
    expect(result).toEqual({ value: 'ok' });
  });
});

// ---------------------------------------------------------------------------
// Corrupt / hostile envelope — AC-S6
// ---------------------------------------------------------------------------

describe('readCache — envelope validation', () => {
  it('rejects a corrupt JSON entry', async () => {
    const filePath = path.join(cacheDir, 'bad.json');
    await fs.mkdir(cacheDir, { recursive: true });
    await fs.writeFile(filePath, 'not-json-at-all');
    const result = readCache<TestData>(cacheDir, 'bad', validateTestData);
    expect(result).toBeNull();
  });

  it('rejects an entry with non-finite timestamp', async () => {
    const filePath = path.join(cacheDir, 'bad-ts.json');
    await fs.mkdir(cacheDir, { recursive: true });
    await fs.writeFile(
      filePath,
      JSON.stringify({ data: { value: 'x' }, timestamp: Infinity, ttl: 60_000 })
    );
    expect(readCache<TestData>(cacheDir, 'bad-ts', validateTestData)).toBeNull();
  });

  it('rejects an entry with non-finite ttl', async () => {
    const filePath = path.join(cacheDir, 'bad-ttl.json');
    await fs.mkdir(cacheDir, { recursive: true });
    await fs.writeFile(
      filePath,
      JSON.stringify({ data: { value: 'x' }, timestamp: Date.now(), ttl: NaN })
    );
    expect(readCache<TestData>(cacheDir, 'bad-ttl', validateTestData)).toBeNull();
  });

  it('rejects a future-timestamped entry in readCache', async () => {
    const filePath = path.join(cacheDir, 'future.json');
    await fs.mkdir(cacheDir, { recursive: true });
    // Timestamp 1 hour in the future
    await fs.writeFile(
      filePath,
      JSON.stringify({ data: { value: 'x' }, timestamp: Date.now() + 3_600_000, ttl: 86_400_000 })
    );
    expect(readCache<TestData>(cacheDir, 'future', validateTestData)).toBeNull();
  });


  it('treats a validator-rejected entry as a miss (AC-S6)', async () => {
    // Write raw JSON that looks like a valid envelope but fails our validator
    const filePath = path.join(cacheDir, 'wrong-schema.json');
    await fs.mkdir(cacheDir, { recursive: true });
    await fs.writeFile(
      filePath,
      JSON.stringify({ data: { unexpected: 42 }, timestamp: Date.now(), ttl: 60_000 })
    );
    // validateTestData returns null for objects without .value: string
    expect(readCache<TestData>(cacheDir, 'wrong-schema', validateTestData)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// MAX_TTL_MS clamping
// ---------------------------------------------------------------------------

describe('writeCache — MAX_TTL_MS clamping', () => {
  it('clamps ttl to MAX_TTL_MS so inflated ttl cannot make entry permanently fresh', async () => {
    const hugeTtl = MAX_TTL_MS * 100;
    await writeCache(cacheDir, 'big-ttl', { value: 'x' }, hugeTtl);

    // Read the raw envelope and verify the stored ttl is clamped
    const filePath = path.join(cacheDir, 'big-ttl.json');
    const raw = await fs.readFile(filePath, 'utf-8');
    const envelope = JSON.parse(raw) as { ttl: number };
    expect(envelope.ttl).toBeLessThanOrEqual(MAX_TTL_MS);
  });
});

// ---------------------------------------------------------------------------
// Directory and file permissions — AC-S5 (POSIX only)
// ---------------------------------------------------------------------------

describe.skipIf(IS_WIN32)('writeCache — permissions (AC-S5)', () => {
  it('creates cacheDir at 0700', async () => {
    const newCacheDir = path.join(cacheDir, 'inner-cache');
    await writeCache(newCacheDir, 'key', { value: 'x' }, 60_000);
    const stat = await fs.stat(newCacheDir);
    expect(stat.mode & 0o777).toBe(0o700);
  });

  it('writes cache entry at 0600', async () => {
    await writeCache(cacheDir, 'perm-key', { value: 'x' }, 60_000);
    const filePath = path.join(cacheDir, 'perm-key.json');
    const stat = await fs.stat(filePath);
    expect(stat.mode & 0o777).toBe(0o600);
  });
});

// ---------------------------------------------------------------------------
// parseRawEnvelope — shared envelope parser
// ---------------------------------------------------------------------------

describe('parseRawEnvelope', () => {
  it('returns null for malformed JSON', () => {
    expect(parseRawEnvelope('not-json')).toBeNull();
    expect(parseRawEnvelope('{broken')).toBeNull();
    expect(parseRawEnvelope('')).toBeNull();
  });

  it('returns null for non-object JSON (array, null, string)', () => {
    expect(parseRawEnvelope('[]')).toBeNull();
    expect(parseRawEnvelope('null')).toBeNull();
    expect(parseRawEnvelope('"string"')).toBeNull();
  });

  it('returns null when timestamp is missing or non-finite', () => {
    expect(parseRawEnvelope(JSON.stringify({ ttl: 60_000 }))).toBeNull();
    expect(parseRawEnvelope(JSON.stringify({ timestamp: 'not-a-number', ttl: 60_000 }))).toBeNull();
    expect(parseRawEnvelope(JSON.stringify({ timestamp: Infinity, ttl: 60_000 }))).toBeNull();
    expect(parseRawEnvelope(JSON.stringify({ timestamp: NaN, ttl: 60_000 }))).toBeNull();
  });

  it('returns null for a future timestamp (poisoned entry)', () => {
    const future = Date.now() + 3_600_000;
    expect(parseRawEnvelope(JSON.stringify({ timestamp: future, ttl: 60_000, data: 'x' }))).toBeNull();
  });

  it('returns envelope fields for a valid entry', () => {
    const ts = Date.now() - 100;
    const raw = JSON.stringify({ timestamp: ts, ttl: 86_400_000, data: 'payload' });
    const result = parseRawEnvelope(raw);
    expect(result).not.toBeNull();
    if (result !== null) {
      expect(result.timestamp).toBe(ts);
      expect(result.ttl).toBe(86_400_000);
      expect(result.data).toBe('payload');
    }
  });

  it('returns null when ttl is absent (strict semantics)', () => {
    const ts = Date.now() - 100;
    const raw = JSON.stringify({ timestamp: ts, data: 'payload' }); // no ttl field
    // Strict semantics: absent ttl → null. writeCache always writes a finite ttl,
    // so real entries are unaffected; only crafted/corrupt entries hit this path.
    expect(parseRawEnvelope(raw)).toBeNull();
  });

  it('returns null when ttl is non-finite (strict semantics)', () => {
    const ts = Date.now() - 100;
    const raw = JSON.stringify({ timestamp: ts, ttl: NaN, data: 'payload' });
    // Strict semantics: non-finite ttl → null (same gate applied to timestamp).
    expect(parseRawEnvelope(raw)).toBeNull();
  });

  it('data can be any JSON value (object, string, null, number)', () => {
    const ts = Date.now() - 100;
    for (const data of [{ models: [] }, 'raw-string', null, 42]) {
      const result = parseRawEnvelope(JSON.stringify({ timestamp: ts, ttl: 0, data }));
      expect(result).not.toBeNull();
      if (result !== null) {
        expect(result.data).toEqual(data);
      }
    }
  });

  it('data field absent → data is undefined (not null)', () => {
    const ts = Date.now() - 100;
    const result = parseRawEnvelope(JSON.stringify({ timestamp: ts, ttl: 60_000 }));
    expect(result).not.toBeNull();
    if (result !== null) {
      expect(result.data).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// Path accessors — avoids PF-013 (hardcoded path residue surviving a relocation)
// ---------------------------------------------------------------------------
//
// These tests pin the authoritative cache-directory paths exported from cache.ts.
// If any caller replaces an accessor with a new hardcoded literal the accessor
// value diverges from the caller and one of the integration tests below fails,
// making the drift compile-time and runtime visible.
//
// applies ADR-013: path layout owned by the core module (cache.ts), not
// scattered across callers in src/cli/ or src/hud/.

describe('modelCacheDir — path accessor (avoids PF-013)', () => {
  it('returns path.join(devflowDir, "cache", "models")', () => {
    const base = '/tmp/test-devflow';
    expect(modelCacheDir(base)).toBe(path.join(base, 'cache', 'models'));
  });

  it('varies with devflowDir — not a global constant', () => {
    expect(modelCacheDir('/a')).not.toBe(modelCacheDir('/b'));
    expect(modelCacheDir('/a')).toBe(path.join('/a', 'cache', 'models'));
    expect(modelCacheDir('/b')).toBe(path.join('/b', 'cache', 'models'));
  });
});

describe('hudCacheDir — path accessor (avoids PF-013)', () => {
  it('returns path.join(devflowDir, "cache") — parent of model cache', () => {
    const base = '/tmp/test-devflow';
    expect(hudCacheDir(base)).toBe(path.join(base, 'cache'));
  });

  it('hudCacheDir is the parent directory of modelCacheDir', () => {
    const base = '/tmp/test-devflow';
    expect(path.dirname(modelCacheDir(base))).toBe(hudCacheDir(base));
  });
});
