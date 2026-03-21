import * as fs from 'node:fs';
import * as path from 'node:path';

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
}

export function getCacheDir(): string {
  const devflowDir =
    process.env.DEVFLOW_DIR || path.join(process.env.HOME || '~', '.devflow');
  return path.join(devflowDir, 'cache');
}

/**
 * Read a cached value. Returns null if missing or expired.
 */
export function readCache<T>(key: string): T | null {
  try {
    const filePath = path.join(getCacheDir(), `${key}.json`);
    const raw = fs.readFileSync(filePath, 'utf-8');
    const entry = JSON.parse(raw) as CacheEntry<T>;
    if (Date.now() - entry.timestamp < entry.ttl) {
      return entry.data;
    }
    return null;
  } catch {
    return null;
  }
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

/**
 * Read a cached value regardless of TTL (stale data). Returns null if missing.
 */
export function readCacheStale<T>(key: string): T | null {
  try {
    const filePath = path.join(getCacheDir(), `${key}.json`);
    const raw = fs.readFileSync(filePath, 'utf-8');
    const entry = JSON.parse(raw) as CacheEntry<T>;
    return entry.data;
  } catch {
    return null;
  }
}
