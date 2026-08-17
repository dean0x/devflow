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
// Path accessors — single source of truth for cache directory layout
// ---------------------------------------------------------------------------
//
// All callers that write or read the model-discovery catalog AND the uninstall
// removal target derive their directory paths from these functions. Keeping
// write-site and removal-site in the same module prevents silent orphaning of
// cache data on future relocations (avoids PF-013).
//
// applies ADR-013: path layout owned by the core module, not scattered across
// callers in src/cli/ or src/hud/.

/**
 * Returns the model-discovery cache directory for the given devflowDir.
 *
 * This is the single authoritative path for the external-models cache written
 * by discoverExternalModels and read by getExternalModelsCached. The uninstall
 * removal target in removeDevFlowInstallArtifacts MUST derive its path from
 * this function so that write-site and removal-site cannot drift independently.
 */
export function modelCacheDir(devflowDir: string): string {
  return path.join(devflowDir, 'cache', 'models');
}

/**
 * Returns the HUD component cache directory for the given devflowDir.
 *
 * Used by version-badge.ts for the npm registry version-check cache.
 * Separate from modelCacheDir because the version-check and model-discovery
 * caches live in different subdirectories under devflowDir/cache/.
 */
export function hudCacheDir(devflowDir: string): string {
  return path.join(devflowDir, 'cache');
}

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
// Private read helper
// ---------------------------------------------------------------------------

function readCacheEntry<T>(
  cacheDir: string,
  key: string,
  validate: (data: unknown) => T | null,
): T | null {
  const filePath = safeEntryPath(cacheDir, key);
  if (filePath === null) return null;

  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const envelope = parseRawEnvelope(raw);
    if (envelope === null) return null;
    // parseRawEnvelope guarantees timestamp is not in the future, so age >= 0.
    // Clamp TTL so an inflated value does not make the entry perpetually fresh.
    const age = Date.now() - envelope.timestamp;
    const clampedTtl = Math.min(Math.abs(envelope.ttl), MAX_TTL_MS);
    if (age >= clampedTtl) return null;
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
  return readCacheEntry(cacheDir, key, validate);
}

/**
 * Parse and validate a raw JSON string as a cache envelope.
 *
 * Returns null when:
 *   - JSON is malformed
 *   - timestamp is not a finite number
 *   - timestamp is in the future (poisoned entry)
 *   - ttl is absent or not a finite number
 *
 * The single canonical envelope parser — used by readCacheEntry (which adds
 * the expiry check on top) and exported for model-discovery.ts (stale-fallback
 * and prune sorters) so all callers share one parser and cannot drift.
 *
 * applies ADR-003: eliminated private parseEnvelope duplicate; one parser, one truth.
 */
export function parseRawEnvelope(
  raw: string,
): { data: unknown; timestamp: number; ttl: number } | null {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return null; }
  if (typeof parsed !== 'object' || parsed === null) return null;

  const obj = parsed as Record<string, unknown>;
  const ts = obj['timestamp'];
  if (typeof ts !== 'number' || !Number.isFinite(ts)) return null;
  // Reject future timestamps (poisoned entry — matches writer policy).
  if (ts > Date.now()) return null;

  const rawTtl = obj['ttl'];
  if (typeof rawTtl !== 'number' || !Number.isFinite(rawTtl)) return null;

  return { data: obj['data'], timestamp: ts, ttl: rawTtl };
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
