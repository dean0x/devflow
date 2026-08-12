/**
 * @file cache.ts
 *
 * Generic TTL cache — sync reads, async writes.
 *
 * Sync-read / async-write asymmetry:
 *   Reads use readFileSync: a ~1KB cache entry takes ~0.01ms and sits on
 *   the TUI startup path where async I/O would complicate the call site.
 *   Writes use writeFileAtomicExclusive (async): no sync atomic-write variant
 *   exists in this codebase; cache writes always happen in async contexts.
 *
 * Path safety:
 *   Every composed cache-entry path is verified to resolve inside cacheDir.
 *   An unvalidated key is an arbitrary-file-overwrite primitive through
 *   path.join()'s normalization of ".." components. safeEntryPath() enforces
 *   containment and returns null on violation; all callers treat null as a miss.
 *
 * applies ADR-013: core-layer module, no Claude Code adapter concerns.
 * avoids PF-011: entries written via tmp→rename (writeFileAtomicExclusive).
 */

import * as fs from 'node:fs';
import { promises as fsAsync } from 'node:fs';
import * as path from 'node:path';
import { writeFileAtomicExclusive } from './fs-atomic.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Maximum cache TTL: 7 days.
 * Clamps inflated or future-timestamped entries that would otherwise be
 * permanently fresh and never re-fetch. Applied on write; enforced on read.
 */
export const MAX_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface CacheEnvelope {
  data: unknown;
  timestamp: number;
  ttl: number;
}

// ---------------------------------------------------------------------------
// Path containment guard
// ---------------------------------------------------------------------------

/**
 * Returns the resolved entry path for (cacheDir, key) if and only if it is
 * strictly inside cacheDir. Returns null when the key contains path-traversal
 * components ("..", absolute paths, etc.) that escape the cache directory.
 *
 * Uses path.resolve to normalise ".." before comparing, so path.join's
 * normalisation of ".." cannot be used to escape via a crafted key.
 */
function safeEntryPath(cacheDir: string, key: string): string | null {
  const joined = path.join(cacheDir, `${key}.json`);
  const normalizedEntry = path.resolve(joined);
  const normalizedDir = path.resolve(cacheDir);
  // Require strict prefix — the entry must live INSIDE the dir, not at the dir root.
  if (!normalizedEntry.startsWith(normalizedDir + path.sep)) {
    return null;
  }
  return normalizedEntry;
}

// ---------------------------------------------------------------------------
// Envelope validation
// ---------------------------------------------------------------------------

/**
 * Parse and validate a raw cache file's envelope.
 *
 * Returns null when:
 *   - JSON is malformed
 *   - timestamp or ttl are not finite numbers
 *   - age is negative (future timestamp — poisoned entry; rejected even in stale mode)
 *   - ignoreExpiry=false and age >= clamped TTL (expired)
 *
 * The validator function is threaded to callers rather than called here; this
 * function handles only envelope integrity.
 */
function parseEnvelope(raw: string, ignoreExpiry: boolean): CacheEnvelope | null {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return null; }
  if (typeof parsed !== 'object' || parsed === null) return null;

  const obj = parsed as Record<string, unknown>;
  const { timestamp, ttl, data } = obj;

  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) return null;
  if (typeof ttl !== 'number' || !Number.isFinite(ttl)) return null;

  const age = Date.now() - timestamp;
  // Reject future timestamps in both modes: a hostile entry with timestamp far
  // in the future would otherwise be permanently fresh and never re-fetch.
  if (age < 0) return null;

  if (!ignoreExpiry) {
    // Clamp TTL so an inflated value does not make the entry perpetually fresh.
    const clampedTtl = Math.min(Math.abs(ttl), MAX_TTL_MS);
    if (age >= clampedTtl) return null;
  }

  return { data, timestamp, ttl };
}

// ---------------------------------------------------------------------------
// Private read helper
// ---------------------------------------------------------------------------

function readCacheEntry<T>(
  cacheDir: string,
  key: string,
  ignoreExpiry: boolean,
  validate: (data: unknown) => T | null,
): T | null {
  const filePath = safeEntryPath(cacheDir, key);
  if (filePath === null) return null;

  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const envelope = parseEnvelope(raw, ignoreExpiry);
    if (envelope === null) return null;
    return validate(envelope.data);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Read a cached value. Returns null on miss, expiry, or validation failure.
 *
 * @param cacheDir - Absolute directory path for cache entries.
 * @param key - Cache key (becomes `<key>.json` inside cacheDir). Path-traversal
 *   components cause a null return rather than an error — callers treat missing
 *   entries and bad keys identically.
 * @param validate - Called on the raw `data` field from the cache envelope.
 *   Return a typed value on success, null to treat as a miss. Run on every
 *   read — no bypass for corrupt or schema-evolved entries.
 */
export function readCache<T>(
  cacheDir: string,
  key: string,
  validate: (data: unknown) => T | null,
): T | null {
  return readCacheEntry(cacheDir, key, false, validate);
}

/**
 * Read a cached value regardless of TTL (stale data).
 * Returns null only on a missing entry, invalid envelope, or future timestamp.
 * Used as a fallback when a fresh fetch fails and any cached value is useful.
 */
export function readCacheStale<T>(
  cacheDir: string,
  key: string,
  validate: (data: unknown) => T | null,
): T | null {
  return readCacheEntry(cacheDir, key, true, validate);
}

/**
 * Write a value to cache with a TTL in milliseconds.
 *
 * - Creates cacheDir at mode 0700 if absent (owner-only access).
 * - Writes the entry via atomic tmp→rename (avoids PF-011 delete-then-write window).
 * - Hardens the entry to 0600 after the write (owner-only read/write for cache data
 *   that will feed agent frontmatter in later phases).
 * - TTL is clamped to MAX_TTL_MS before storage.
 * - Non-fatal on any I/O error — cache write failure is never surfaced to the user.
 *
 * @param cacheDir - Absolute directory path for cache entries.
 * @param key - Cache key. Path-traversal components are silently rejected.
 * @param data - Value to cache.
 * @param ttlMs - Time-to-live in milliseconds.
 */
export async function writeCache<T>(
  cacheDir: string,
  key: string,
  data: T,
  ttlMs: number,
): Promise<void> {
  const filePath = safeEntryPath(cacheDir, key);
  if (filePath === null) return;

  try {
    await fsAsync.mkdir(cacheDir, { recursive: true, mode: 0o700 });
    const envelope: CacheEnvelope = {
      data,
      timestamp: Date.now(),
      ttl: Math.min(Math.abs(ttlMs), MAX_TTL_MS),
    };
    await writeFileAtomicExclusive(filePath, JSON.stringify(envelope));
  } catch {
    // Cache write failure is non-fatal
    return;
  }
  // Harden entry to 0600 after the atomic write. writeFileAtomicExclusive
  // preserves the existing mode on re-writes; this chmod bootstraps 0600 on
  // the first write to a fresh entry. Best-effort, non-fatal (avoids PF-009).
  try { await fsAsync.chmod(filePath, 0o600); } catch { /* non-fatal */ }
}
