import * as fs from 'node:fs';
import * as path from 'node:path';
import { homedir } from 'node:os';

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
}

export function getCacheDir(): string {
  const devflowDir =
    process.env.DEVFLOW_DIR || path.join(process.env.HOME || homedir(), '.devflow');
  return path.join(devflowDir, 'cache');
}

/**
 * Read a cached value. Returns null if missing or expired.
 * When `ignoreExpiry` is true, returns data regardless of TTL (stale read).
 */
function readCacheEntry<T>(key: string, ignoreExpiry: boolean): T | null {
  try {
    const filePath = path.join(getCacheDir(), `${key}.json`);
    const raw = fs.readFileSync(filePath, 'utf-8');
    const entry = JSON.parse(raw) as CacheEntry<T>;
    if (ignoreExpiry || Date.now() - entry.timestamp < entry.ttl) {
      return entry.data;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Read a cached value. Returns null if missing or expired.
 */
export function readCache<T>(key: string): T | null {
  return readCacheEntry<T>(key, false);
}

/**
 * Read a cached value regardless of TTL (stale data). Returns null if missing.
 */
export function readCacheStale<T>(key: string): T | null {
  return readCacheEntry<T>(key, true);
}

/**
 * Write a value to cache with a TTL in milliseconds.
 */
export function writeCache<T>(key: string, data: T, ttlMs: number): void {
  try {
    const dir = getCacheDir();
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const entry: CacheEntry<T> = { data, timestamp: Date.now(), ttl: ttlMs };
    fs.writeFileSync(path.join(dir, `${key}.json`), JSON.stringify(entry));
  } catch {
    // Cache write failure is non-fatal
  }
}
