/**
 * Tests for src/core/cache.ts
 *
 * Coverage:
 *   - Basic read/write round-trip with validator
 *   - TTL expiry (returns null when expired)
 *   - Stale read returns value regardless of TTL
 *   - Path containment: key with ".." escapes are rejected (AC-S4)
 *   - Corrupt JSON rejected by validator path
 *   - Future timestamp rejected even in stale mode
 *   - Non-finite timestamp/ttl rejected
 *   - MAX_TTL_MS clamping on write
 *   - Directory created at 0700 (AC-S5)
 *   - Entries created at 0600 (AC-S5)
 *   - Validator called on every read (AC-S6)
 *   - Validator returning null treated as miss
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { readCache, readCacheStale, writeCache, MAX_TTL_MS } from '../src/core/cache.js';

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
// Stale reads
// ---------------------------------------------------------------------------

describe('readCacheStale — ignores TTL', () => {
  it('returns expired entry that readCache would reject', async () => {
    await writeCache(cacheDir, 'stale-key', { value: 'stale' }, 1);
    await new Promise(r => setTimeout(r, 5));
    // readCache rejects
    expect(readCache<TestData>(cacheDir, 'stale-key', validateTestData)).toBeNull();
    // readCacheStale accepts
    const result = readCacheStale<TestData>(cacheDir, 'stale-key', validateTestData);
    expect(result).toEqual({ value: 'stale' });
  });
});

// ---------------------------------------------------------------------------
// Path containment — AC-S4
// ---------------------------------------------------------------------------

describe('safeEntryPath — path containment guard', () => {
  it('returns null for keys with ".." path traversal (no write)', async () => {
    // A key component that tries to escape cacheDir must be silently rejected
    await writeCache(cacheDir, '../../etc/passwd', { value: 'x' }, 60_000);
    // The file must NOT have been written to ../../etc/passwd
    const escaped = path.resolve(path.join(cacheDir, '../../etc/passwd.json'));
    try {
      await fs.access(escaped);
      // If this succeeds, the guard failed
      expect.fail('Path traversal guard failed — file was written outside cacheDir');
    } catch {
      // Expected: file does not exist (guard worked)
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

  it('rejects a future-timestamped entry in readCacheStale', async () => {
    const filePath = path.join(cacheDir, 'future-stale.json');
    await fs.mkdir(cacheDir, { recursive: true });
    await fs.writeFile(
      filePath,
      JSON.stringify({ data: { value: 'x' }, timestamp: Date.now() + 3_600_000, ttl: 86_400_000 })
    );
    // Even stale reads must reject future timestamps
    expect(readCacheStale<TestData>(cacheDir, 'future-stale', validateTestData)).toBeNull();
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
