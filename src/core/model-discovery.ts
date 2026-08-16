/**
 * @file model-discovery.ts
 *
 * Discovers routable external models from the routing runtime.
 * The only impure piece of the external-model-routing design.
 *
 * applies ADR-013: pure core-layer module — no adapter imports.
 * applies PF-013: cwd = os.tmpdir() so discovery never assumes the devflow
 *   directory exists (the --set read path never mkdirs, so the dir may not
 *   exist; os.tmpdir() also prevents a stale subswitch.config.json in any
 *   particular working directory from causing exit 1 in the routing runtime).
 * avoids PF-009: discoverExternalModels never throws or rejects — every
 *   failure path returns { known: false }.
 * avoids PF-016: real-binary tests (T1–T4) live in tests/, never in
 *   tests/integration/ which is excluded from npm test by vitest.config.ts.
 *
 * Branding constraint: the routing runtime package name ("subswitch") must
 * NEVER appear in user-visible strings, CLI output, or error messages. It is
 * permitted in logs (proxy.log), code comments, and env var names.
 */

import * as fs from 'node:fs';
import { promises as fsAsync } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { spawn as cpSpawn } from 'node:child_process';
import { MODEL_NAME_RE } from './agent-frontmatter.js';
import { CLAUDE_MODEL_ALIASES } from './external-models.js';
import { readCache, writeCache, parseRawEnvelope, MAX_TTL_MS } from './cache.js';
import { resolveProxyBin } from './proxy-state.js';
import { openProxyLog, scrubChildEnv } from './proxy-log.js';

// ---------------------------------------------------------------------------
// Result type (local pattern, mirrors proxy-state.ts)
// ---------------------------------------------------------------------------

export type Result<T, E = string> = { ok: true; value: T } | { ok: false; error: E };

function Ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

function Err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Prefix for all discovery cache keys. */
const CACHE_KEY_PREFIX = 'external-models-v1-';

/** TTL for live discovery results. 24 h is the effective invalidator; version
 *  changes are the REAL invalidator since the model registry ships in the
 *  routing runtime package, so it cannot change without the version changing. */
const CACHE_TTL_MS = 24 * 60 * 60 * 1_000;

/**
 * Maximum number of discovery cache entries to retain.
 * Oldest entries beyond this limit are pruned after each successful live write
 * so the cache directory has a fixed upper bound.
 */
const CACHE_PRUNE_KEEP = 3;

/**
 * Maximum bytes buffered from the discovery command's stdout.
 * The live payload is ~1 KB; 256× headroom caps a malformed or hostile
 * response without allowing unbounded allocation. Exceeding this cap causes
 * the result to be treated as a spawn failure.
 */
const STDOUT_CAP = 262_144;

/**
 * Discovery spawn timeout (ms). A child that does not close its stdout pipe
 * within this window receives SIGTERM followed by a SIGKILL escalation after
 * SIGKILL_GRACE_MS. Zero retries — the stale cache is the retry.
 *
 * Exported so tests can derive timing bounds without mirroring the literal.
 */
export const SPAWN_TIMEOUT_MS = 2_000;

/**
 * Grace period (ms) between SIGTERM and SIGKILL escalation. Unreffed so the
 * timer never prevents the Node.js event loop from exiting on its own.
 *
 * Exported so tests can derive timing bounds without mirroring the literal.
 */
export const SIGKILL_GRACE_MS = 2_000;

/**
 * Maximum bytes written per log failure message. Prevents a single log write
 * from growing proxy.log unexpectedly. Discovery runs while the relay is up
 * so rotateProxyLogIfLarge MUST NOT be called here (PRE-SPAWN ONLY invariant).
 */
const LOG_WRITE_CAP = 2_048;

/**
 * Maximum bytes for a single cache-entry read in the discovery scanner.
 * The live payload is ~1 KB; 64 KB is 64× headroom. Entries exceeding this
 * cap are treated as corrupt and skipped. Enforced via parseDiscoveryFileContent,
 * the shared helper used by all three enumeration sites.
 */
const MAX_ENTRY_BYTES = 65_536;

/** The exact argv passed to the routing runtime for model discovery.
 *  Must be ['models', '--json'], always, unconditionally.
 *
 *  SAFETY: the routing runtime's CLI dispatch is `positionals[0] ?? "serve"`,
 *  so an empty positional list would default to starting a relay. The argv
 *  constant pins this and T6 asserts it via injectable deps. */
const DISCOVERY_ARGV: readonly ['models', '--json'] = ['models', '--json'];

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * A single routable external model with its aliases.
 * Aliases are already deduplicated and validated (MODEL_NAME_RE, no CLAUDE_MODEL_ALIASES
 * collision, no alias-equals-canonical-id).
 */
export interface ExternalModel {
  /** Canonical routing-runtime model ID, e.g. 'gpt-5.6-sol'. */
  readonly id: string;
  /** Short-form aliases in registry order, e.g. ['sol']. May be empty. */
  readonly aliases: readonly string[];
}

/**
 * Result of a model-discovery attempt.
 *
 * { known: false } when the runtime is unavailable, the spawn fails, all
 * cache entries are absent/stale, or the payload contains zero valid rows.
 * This keeps the known vs. unknown distinction explicit — [] would conflate
 * "runtime reports no models" with "could not ask".
 */
export type ExternalModelCatalog =
  | {
      readonly known: true;
      /** Filtered, validated model list. */
      readonly models: readonly ExternalModel[];
      /**
       * Map from every selectable name to its canonical id.
       * Covers both aliases (e.g. 'sol' → 'gpt-5.6-sol') and canonical ids
       * (e.g. 'gpt-5.6-sol' → 'gpt-5.6-sol').
       */
      readonly aliasToId: ReadonlyMap<string, string>;
      /**
       * Flat list of selectable names for the TUI picker cycle.
       * Order: aliases (registry order, all models), then canonical ids.
       * Guaranteed unique — duplicates break cycleNext/cyclePrev indexOf.
       */
      readonly selectableNames: readonly string[];
      /** Where the catalog came from. */
      readonly source: 'live' | 'cache' | 'stale-cache';
    }
  | { readonly known: false };

// ---------------------------------------------------------------------------
// Injectable dependencies (for testing without real processes)
// ---------------------------------------------------------------------------

/** Return type of resolveProxyBin — derived rather than duplicated (applies ADR-003). */
type ResolveProxyBinResult = Awaited<ReturnType<typeof resolveProxyBin>>;

/**
 * Injectable seam for discoverExternalModels.
 * All fields are optional; omit a field to use the production implementation.
 *
 * Exposes the spawn call so tests can:
 *  - Assert exact argv (T6: guards against conditional argv that degenerates
 *    to [] which triggers the relay's default "serve" dispatch).
 *  - Feed stub binaries covering each degradation path (T4).
 *  - Control the bin resolver to test cache pruning independently of the
 *    installed runtime version (T12/AC-P7).
 */
export interface ModelDiscoveryDeps {
  /**
   * Override proxy-bin resolution. Default: real resolveProxyBin() from
   * proxy-state.ts (reads from devflow's own node_modules, never proxy.json).
   */
  resolveProxyBin?(): Promise<ResolveProxyBinResult>;

  /**
   * Spawn the routing runtime and collect stdout.
   * The production implementation:
   *  - Caps stdout at STDOUT_CAP bytes (overflow → failure, not error).
   *  - Enforces SPAWN_TIMEOUT_MS; sends SIGTERM then SIGKILL after SIGKILL_GRACE_MS.
   *  - Routes stderr to proxy.log (via openProxyLog fd, not bare appendFile).
   *  - Never throws — all OS errors resolve to exitCode: -1.
   *
   * argv is always DISCOVERY_ARGV (['models', '--json']). T6 asserts this.
   */
  spawnAndCollect?(opts: {
    execPath: string;
    binPath: string;
    argv: readonly string[];
    env: NodeJS.ProcessEnv;
    cwd: string;
  }): Promise<{ exitCode: number; stdout: string; timedOut: boolean }>;
}

// ---------------------------------------------------------------------------
// Parsed-catalog internal type (source is added by callers)
// ---------------------------------------------------------------------------

export interface ParsedCatalog {
  readonly models: readonly ExternalModel[];
  readonly aliasToId: ReadonlyMap<string, string>;
  readonly selectableNames: readonly string[];
}

// ---------------------------------------------------------------------------
// parseModelsJson — pure, tolerant, never throws
// ---------------------------------------------------------------------------

/**
 * Parse and validate a raw `models --json` payload.
 *
 * Hard-gates (return Err immediately):
 *  - Non-JSON or non-object root
 *  - schemaVersion !== 1 (integer 1; the string "1" also fails)
 *  - kind !== 'models'
 *  - models is not an array
 *  - Zero rows survive row-level filtering
 *
 * Tolerant (drop the offending row, not the payload):
 *  - Missing or wrong-typed required fields on a row
 *  - provider !== 'codex'
 *  - routable !== true or retired !== false
 *  - id or alias.name fails MODEL_NAME_RE
 *  - alias.name equals a canonical id in the payload
 *  - alias.name is in CLAUDE_MODEL_ALIASES (prevents picker collisions)
 *  - model's provider has routing === 'passthrough' in the providers array
 *
 * Pure function: no I/O, no state, never throws.
 */
export function parseModelsJson(raw: string): Result<ParsedCatalog, string> {
  // --- Parse JSON ---
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return Err('invalid JSON');
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return Err('root is not an object');
  }

  const root = parsed as Record<string, unknown>;

  // --- Hard gates ---
  if (root['schemaVersion'] !== 1) {
    return Err(`unexpected schemaVersion: ${String(root['schemaVersion'])}`);
  }
  if (root['kind'] !== 'models') {
    return Err(`unexpected kind: ${String(root['kind'])}`);
  }
  if (!Array.isArray(root['models'])) {
    return Err('models is not an array');
  }

  // --- Check whether the codex provider is marked passthrough ---
  // Row selection hard-gates on provider === 'codex', so only codex entries ever
  // reach the passthrough filter. Compute once before the per-row loop instead of
  // re-evaluating passthroughProviders.has('codex') identically on every row.
  const passthroughProviders = new Set<string>();
  if (Array.isArray(root['providers'])) {
    for (const p of root['providers'] as unknown[]) {
      if (typeof p !== 'object' || p === null) continue;
      const pObj = p as Record<string, unknown>;
      if (typeof pObj['id'] === 'string' && pObj['routing'] === 'passthrough') {
        passthroughProviders.add(pObj['id']);
      }
    }
  }
  const codexIsPassthrough = passthroughProviders.has('codex');

  // --- First pass: collect canonical ids of qualifying rows ---
  // Pre-collecting canonical ids allows the alias-dedup check ("drop alias
  // that equals a canonical id") to cover ALL models in the payload, not just
  // models processed before the current one.
  const canonicalIds = new Set<string>();
  const qualifyingRows: Record<string, unknown>[] = [];

  for (const row of root['models'] as unknown[]) {
    if (typeof row !== 'object' || row === null) continue;
    const m = row as Record<string, unknown>;
    if (typeof m['id'] !== 'string') continue;
    if (!MODEL_NAME_RE.test(m['id'] as string)) continue;
    if (m['provider'] !== 'codex') continue;
    if (codexIsPassthrough) continue;
    if (m['routable'] !== true) continue;
    if (m['retired'] !== false) continue;
    canonicalIds.add(m['id'] as string);
    qualifyingRows.push(m);
  }

  // --- Second pass: build ExternalModel with validated aliases ---
  const CLAUDE_ALIAS_SET = new Set<string>(CLAUDE_MODEL_ALIASES);
  const models: ExternalModel[] = [];

  for (const m of qualifyingRows) {
    const id = m['id'] as string;
    const rawAliases = Array.isArray(m['aliases']) ? m['aliases'] as unknown[] : [];
    const aliases: string[] = [];

    for (const a of rawAliases) {
      if (typeof a !== 'object' || a === null) continue;
      const aObj = a as Record<string, unknown>;
      if (typeof aObj['name'] !== 'string') continue;
      const aliasName = aObj['name'] as string;

      if (!MODEL_NAME_RE.test(aliasName)) continue;
      // Drop alias equal to any canonical id in the payload
      if (canonicalIds.has(aliasName)) continue;
      // Drop alias in the Claude passthrough set (prevents picker collisions)
      if (CLAUDE_ALIAS_SET.has(aliasName)) continue;

      aliases.push(aliasName);
    }

    models.push({ id, aliases });
  }

  if (models.length === 0) {
    return Err('zero rows survived filtering');
  }

  // --- Build selectableNames and aliasToId ---
  // Order: aliases (registry order, across all models), then canonical ids.
  // The `seen` set guarantees uniqueness — duplicates break cycleNext/cyclePrev.
  const seen = new Set<string>();
  const selectableNames: string[] = [];
  const aliasToId = new Map<string, string>();

  // Aliases first (registry order)
  for (const model of models) {
    for (const alias of model.aliases) {
      if (!seen.has(alias)) {
        seen.add(alias);
        selectableNames.push(alias);
        aliasToId.set(alias, model.id);
      }
    }
  }

  // Canonical ids (registry order)
  for (const model of models) {
    if (!seen.has(model.id) && !CLAUDE_ALIAS_SET.has(model.id)) {
      seen.add(model.id);
      selectableNames.push(model.id);
      aliasToId.set(model.id, model.id);
    }
  }

  return Ok({
    models,
    aliasToId: aliasToId as ReadonlyMap<string, string>,
    selectableNames,
  });
}

// ---------------------------------------------------------------------------
// Cache helpers
// ---------------------------------------------------------------------------

/** Validate that a cache-envelope `data` field is a string (raw JSON stdout). */
function validateCachedString(data: unknown): string | null {
  return typeof data === 'string' ? data : null;
}

/**
 * Parse raw bytes from a discovery cache file.
 *
 * Single shared helper for all three enumeration sites. Enforces MAX_ENTRY_BYTES
 * to bound memory allocation on corrupt or oversized entries. Pure: no I/O.
 * Callers own the read (sync or async).
 *
 * Returns null when the entry exceeds the size cap, fails JSON/envelope
 * parsing, or contains a non-string data field.
 */
function parseDiscoveryFileContent(
  buf: Buffer,
): { data: string; timestamp: number; ttl: number } | null {
  if (buf.length > MAX_ENTRY_BYTES) return null;
  const envelope = parseRawEnvelope(buf.toString('utf-8'));
  if (envelope === null || typeof envelope.data !== 'string') return null;
  return { data: envelope.data, timestamp: envelope.timestamp, ttl: envelope.ttl };
}

/**
 * Scan cacheDir for the newest external-models-v1-* entry (by embedded
 * envelope timestamp, not file mtime) that is not skipKey and whose data is
 * a parseable string. Returns the raw stdout string or null.
 *
 * Uses embedded timestamp rather than file mtime because mtime is trivially
 * settable — relying on it would let a hostile cache file masquerade as newer.
 */
async function findStaleFallback(
  cacheDir: string,
  skipKey: string | null,
): Promise<string | null> {
  let entries: string[];
  try {
    entries = await fsAsync.readdir(cacheDir);
  } catch {
    return null;
  }

  let bestTimestamp = -Infinity;
  let bestRaw: string | null = null;

  for (const entry of entries) {
    if (!entry.startsWith(CACHE_KEY_PREFIX) || !entry.endsWith('.json')) continue;
    const key = entry.slice(0, -'.json'.length);
    if (skipKey !== null && key === skipKey) continue;

    try {
      const buf = await fsAsync.readFile(path.join(cacheDir, entry));
      const parsed = parseDiscoveryFileContent(buf);
      if (parsed === null) continue;
      if (parsed.timestamp > bestTimestamp) {
        bestTimestamp = parsed.timestamp;
        bestRaw = parsed.data;
      }
    } catch {
      // Skip unreadable entries — they do not prevent other entries from being used
    }
  }

  return bestRaw;
}

/**
 * Prune external-models-v1-* cache entries to at most CACHE_PRUNE_KEEP
 * (3) entries, keeping the newest by embedded envelope timestamp.
 * Called after each successful live write. Best-effort, non-fatal.
 */
async function pruneOldEntries(cacheDir: string): Promise<void> {
  try {
    const entries = await fsAsync.readdir(cacheDir);
    const candidates: Array<{ filename: string; timestamp: number }> = [];

    for (const entry of entries) {
      if (!entry.startsWith(CACHE_KEY_PREFIX)) continue;

      // Reap orphaned atomic-write temp files (<key>.json.tmp.<pid>).
      // These accumulate when the writer is interrupted between the tmp write
      // and the rename (e.g., Ctrl-C during enable).
      if (entry.includes('.json.tmp.')) {
        try { await fsAsync.unlink(path.join(cacheDir, entry)); } catch { /* non-fatal */ }
        continue;
      }

      if (!entry.endsWith('.json')) continue;

      try {
        const buf = await fsAsync.readFile(path.join(cacheDir, entry));
        const parsed = parseDiscoveryFileContent(buf);
        if (parsed !== null) {
          candidates.push({ filename: entry, timestamp: parsed.timestamp });
        }
      } catch {
        // Skip unreadable entries
      }
    }

    if (candidates.length <= CACHE_PRUNE_KEEP) return;

    // Sort newest-first; keep first CACHE_PRUNE_KEEP, delete the rest
    candidates.sort((a, b) => b.timestamp - a.timestamp);
    for (let i = CACHE_PRUNE_KEEP; i < candidates.length; i++) {
      try {
        await fsAsync.unlink(path.join(cacheDir, candidates[i].filename));
      } catch {
        // Non-fatal — an entry that cannot be deleted is benign
      }
    }
  } catch {
    // Pruning failure is non-fatal
  }
}

// ---------------------------------------------------------------------------
// Log helper
// ---------------------------------------------------------------------------

/**
 * Append a failure reason to proxy.log.
 *
 * Uses openProxyLog (not bare appendFile) to preserve the 0600 mode
 * hardening from commit 2120891. Caps writes to LOG_WRITE_CAP bytes.
 * MUST NOT call rotateProxyLogIfLarge — that carries a PRE-SPAWN ONLY
 * invariant; discovery runs while the relay is up.
 * Non-fatal: a log-write failure must never surface to the caller.
 */
async function appendToLog(logPath: string, msg: string): Promise<void> {
  try {
    const handle = await openProxyLog(logPath);
    try {
      const line = `${msg}\n`;
      // Encode first, then slice bytes — slicing the JS string first would
      // slice UTF-16 code units before encoding, allowing up to ~4× the intended
      // byte cap for non-ASCII content.
      await handle.write(Buffer.from(line).subarray(0, LOG_WRITE_CAP));
    } finally {
      await handle.close();
    }
  } catch {
    // Non-fatal
  }
}

// ---------------------------------------------------------------------------
// Real spawn implementation
// ---------------------------------------------------------------------------

/**
 * Build the production spawnAndCollect function for a given log path.
 *
 * Spawns `process.execPath [binPath, ...argv]` with the scrubbed env and
 * os.tmpdir() as cwd. Caps stdout at STDOUT_CAP bytes; enforces
 * SPAWN_TIMEOUT_MS with SIGKILL escalation after SIGKILL_GRACE_MS.
 *
 * The child's stderr goes to proxy.log via logFd so failure reasons are
 * visible without bloating the log with normal-operation output.
 *
 * Never throws — all OS-level failures resolve to exitCode: -1.
 */
function buildRealSpawnAndCollect(
  logPath: string,
): NonNullable<ModelDiscoveryDeps['spawnAndCollect']> {
  return async (opts) => {
    let logHandle: Awaited<ReturnType<typeof openProxyLog>> | null = null;
    try {
      logHandle = await openProxyLog(logPath);
    } catch {
      // If proxy.log cannot be opened, spawn without a log fd (stderr → pipe)
    }

    try {
      return await new Promise<{ exitCode: number; stdout: string; timedOut: boolean }>(
        (resolve) => {
          const proc = cpSpawn(
            opts.execPath,
            [opts.binPath, ...opts.argv],
            {
              env: opts.env,
              // stderr goes to proxy.log fd; stdout is piped for collection
              stdio: ['ignore', 'pipe', logHandle ? logHandle.fd : 'pipe'],
              cwd: opts.cwd,
            },
          );

          let resolved = false;
          let stdout = '';
          let overflowed = false;

          proc.stdout?.on('data', (chunk: Buffer) => {
            if (overflowed || resolved) return;
            stdout += chunk.toString('utf-8');
            if (stdout.length > STDOUT_CAP) {
              overflowed = true;
              stdout = '';
              // Trigger SIGTERM; the timeout handler fires after SPAWN_TIMEOUT_MS
              // and will schedule SIGKILL. This avoids duplicating the escalation
              // logic here.
              try { proc.kill(); } catch { /* already dead */ }
            }
          });

          const timer = setTimeout(() => {
            if (!resolved) {
              resolved = true;
              try { proc.kill(); } catch { /* already dead */ }
              // SIGKILL escalation after grace — unreffed so it does not hold
              // the event loop open if everything else has settled.
              const sigkill = setTimeout(() => {
                try { proc.kill('SIGKILL'); } catch { /* already dead */ }
              }, SIGKILL_GRACE_MS);
              sigkill.unref();
              resolve({ exitCode: 1, stdout: '', timedOut: true });
            }
          }, SPAWN_TIMEOUT_MS);

          proc.on('close', (code) => {
            if (!resolved) {
              resolved = true;
              clearTimeout(timer);
              if (overflowed) {
                resolve({ exitCode: 1, stdout: '', timedOut: false });
              } else {
                resolve({ exitCode: code ?? 1, stdout, timedOut: false });
              }
            }
          });

          // OS-level spawn failure (EMFILE, ENOMEM, EAGAIN): must be caught or
          // it becomes an uncaught exception. Resolve cleanly with exitCode: -1.
          proc.on('error', () => {
            if (!resolved) {
              resolved = true;
              clearTimeout(timer);
              resolve({ exitCode: -1, stdout: '', timedOut: false });
            }
          });
        },
      );
    } finally {
      if (logHandle) {
        await logHandle.close();
      }
    }
  };
}

// ---------------------------------------------------------------------------
// discoverExternalModels — the impure entry point
// ---------------------------------------------------------------------------

/**
 * Discover routable external models from the routing runtime.
 *
 * Algorithm:
 *  1. resolveProxyBin() — if Err, return { known: false } (no binary).
 *  2. Check fresh cache for the current version key.
 *  3. Collect stale-cache fallback (newest entry by embedded timestamp).
 *  4. Live spawn: `process.execPath [binPath, 'models', '--json']`.
 *  5. On success: write to cache, prune to CACHE_PRUNE_KEEP entries.
 *  6. On failure: return stale-cache if available, else { known: false }.
 *
 * Cache key: `external-models-v1-<validatedRuntimeVersion>`.
 * TTL: 24 h. Version is the real invalidator (registry ships in the package).
 * Raw validated stdout is cached; parseModelsJson runs on every read (no bypass).
 *
 * Failure behaviour:
 *  - spawn failure, timeout, overflow → log reason to proxy.log.
 *  - parse failure on live payload → log reason to proxy.log.
 *  - All failures degrade to stale-cache then { known: false } — never throw.
 *
 * applies PF-013: cwd = os.tmpdir() (not devflow dir, which may not exist on
 *   the cold --set path; also prevents legacy subswitch.config.json in cwd
 *   from causing exit 1 in the routing runtime).
 *
 * AC-C7: resolveProxyBin() is called live every invocation, never proxy.json.binPath.
 * AC-C8: never throws or rejects.
 *
 * @param cacheDir  Absolute path to the discovery cache directory (caller-supplied).
 * @param logPath   Absolute path to proxy.log for failure logging (caller-supplied).
 * @param deps      Optional injectable seam for testing.
 */
export async function discoverExternalModels(
  cacheDir: string,
  logPath: string,
  deps?: ModelDiscoveryDeps,
): Promise<ExternalModelCatalog> {
  try {
    return await _discoverInternal(cacheDir, logPath, deps);
  } catch {
    // Catch-all: discoverExternalModels MUST NOT throw (avoids PF-009).
    return { known: false };
  }
}

async function _discoverInternal(
  cacheDir: string,
  logPath: string,
  deps?: ModelDiscoveryDeps,
): Promise<ExternalModelCatalog> {
  // AC-C7: call resolveProxyBin() live (never proxy.json.binPath)
  const resolveFn = deps?.resolveProxyBin ?? resolveProxyBin;
  const binResult = await resolveFn();
  if (!binResult.ok) return { known: false };

  const { binPath, version } = binResult.value;
  const currentKey = version != null ? `${CACHE_KEY_PREFIX}${version}` : null;

  // --- Fresh cache check ---
  if (currentKey !== null) {
    const fresh = readCache(cacheDir, currentKey, validateCachedString);
    if (fresh !== null) {
      const parsed = parseModelsJson(fresh);
      if (parsed.ok) {
        return { known: true, ...parsed.value, source: 'cache' };
      }
    }
  }

  // --- Stale-cache fallback — started concurrently with spawn, awaited only on failure ---
  // Happy path returns before the await below; running the lookup concurrently
  // with the spawn means the failure path incurs no extra latency (findStaleFallback
  // completes during the spawn's SPAWN_TIMEOUT_MS window).
  const staleRawP = findStaleFallback(cacheDir, currentKey);

  // --- Live spawn ---
  const env: NodeJS.ProcessEnv = { ...scrubChildEnv(), NO_COLOR: '1' };
  const spawnFn = deps?.spawnAndCollect ?? buildRealSpawnAndCollect(logPath);

  let spawnResult: { exitCode: number; stdout: string; timedOut: boolean };
  try {
    spawnResult = await spawnFn({
      execPath: process.execPath,
      binPath,
      argv: DISCOVERY_ARGV,
      env,
      cwd: os.tmpdir(),
    });
  } catch {
    spawnResult = { exitCode: -1, stdout: '', timedOut: false };
  }

  // --- Handle live result ---
  if (spawnResult.exitCode === 0 && spawnResult.stdout.length > 0) {
    const parsed = parseModelsJson(spawnResult.stdout);
    if (parsed.ok) {
      // Success — write to cache and prune
      if (currentKey !== null) {
        await writeCache(cacheDir, currentKey, spawnResult.stdout, CACHE_TTL_MS);
        await pruneOldEntries(cacheDir);
      }
      return { known: true, ...parsed.value, source: 'live' };
    }
    // Parse failed even though spawn succeeded.
    // Strip control characters from untrusted runtime output before embedding
    // in the log line to prevent log-line injection (LOG_WRITE_CAP bounds total
    // length but not embedded newlines).
    // eslint-disable-next-line no-control-regex
    const safeError = parsed.error.replace(/[\x00-\x1f\x7f]/g, ' ');
    await appendToLog(logPath, `[model-discovery] parse failed: ${safeError}`);
  } else {
    const reason = spawnResult.timedOut
      ? 'spawn timed out'
      : `spawn exited ${spawnResult.exitCode}`;
    await appendToLog(logPath, `[model-discovery] ${reason}`);
  }

  // --- Stale-cache fallback (only reached on failure path) ---
  const staleRaw = await staleRawP;
  if (staleRaw !== null) {
    const parsed = parseModelsJson(staleRaw);
    if (parsed.ok) {
      return { known: true, ...parsed.value, source: 'stale-cache' };
    }
  }

  return { known: false };
}

// ---------------------------------------------------------------------------
// getExternalModelsCached — cache-only query, no spawn
// ---------------------------------------------------------------------------

/**
 * Return the most recently cached model catalog without spawning the runtime.
 *
 * Used by the --set path in agents.ts which runs regardless of proxy state and
 * must not trigger a live fetch. Returns the newest valid entry across all
 * external-models-v1-* keys regardless of TTL (stale is acceptable here —
 * the TUI will surface staleness via the dormancy indicator).
 *
 * Synchronous — suitable for startup paths that must not go async.
 * Returns { known: false } when no valid cache entry exists.
 */
export function getExternalModelsCached(cacheDir: string): ExternalModelCatalog {
  let entries: string[];
  try {
    entries = fs.readdirSync(cacheDir);
  } catch {
    return { known: false };
  }

  let best: { raw: string; timestamp: number; ttl: number } | null = null;

  for (const entry of entries) {
    if (!entry.startsWith(CACHE_KEY_PREFIX) || !entry.endsWith('.json')) continue;
    try {
      // Sync read is intentional; size guard and parsing via the shared helper.
      const buf = fs.readFileSync(path.join(cacheDir, entry));
      const result = parseDiscoveryFileContent(buf);
      if (result === null) continue;
      if (best === null || result.timestamp > best.timestamp) {
        best = { raw: result.data, timestamp: result.timestamp, ttl: result.ttl };
      }
    } catch {
      // Skip unreadable entries
    }
  }

  if (best === null) return { known: false };

  const parsed = parseModelsJson(best.raw);
  if (!parsed.ok) return { known: false };

  const age = Date.now() - best.timestamp;
  const ttlClamped = Math.min(Math.abs(best.ttl), MAX_TTL_MS);
  const source: 'cache' | 'stale-cache' = age < ttlClamped ? 'cache' : 'stale-cache';

  return { known: true, ...parsed.value, source };
}
