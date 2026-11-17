import * as fs from 'node:fs';
import * as path from 'node:path';
import type { CodexUsage, CodexWindow } from './types.js';
import { readCache, writeCache, hudCacheDir } from '../core/cache.js';

const CODEX_CACHE_KEY = 'codex-quota';
const CODEX_CACHE_TTL_MS = 30_000;

/** Rollouts last modified longer ago than this are not read. */
export const CODEX_MAX_AGE_MS = 8 * 24 * 60 * 60 * 1000;
/** The first read of a rollout, and the one larger read when it holds no record. */
export const CODEX_TAIL_BYTES = 1024 * 1024;
export const CODEX_TAIL_RETRY_BYTES = 4 * 1024 * 1024;
/** A proxy snapshot larger than this is not read. */
export const CODEX_SNAPSHOT_MAX_BYTES = 64 * 1024;
/** A record observed further than this in the future is rejected, so a bad clock cannot win the newest-record choice. */
const MAX_CLOCK_SKEW_SEC = 300;

const MAX_YEAR_DIRS = 3;
const MAX_DAY_DIRS = 14;
const MAX_ROLLOUTS_PER_DAY = 200;
const MAX_ROLLOUTS_READ = 3;

const YEAR_DIR = /^\d{4}$/;
const MONTH_DIR = /^(0[1-9]|1[0-2])$/;
const DAY_DIR = /^(0[1-9]|[12]\d|3[01])$/;
/**
 * Plain rollouts only. Codex compresses a rollout to `.jsonl.zst` once its session
 * is done, and a done session is older than the plain rollout of a later one, so
 * the newest record is never in a compressed file.
 */
const ROLLOUT_FILE = /^rollout-.*\.jsonl$/;

/**
 * D-CODEX-LOCAL-LOGS-ONLY: Codex usage comes from local files that already hold
 * Codex's rate-limit records: the Codex CLI's own session logs under
 * ~/.codex/sessions, and the snapshot the proxy writes (D-CODEX-PROXY-SNAPSHOT).
 * The statusline opens no credential file (auth.json) and makes no network call,
 * so it cannot leak a token or stall on a request. Reason: the HUD runs on every
 * prompt under a 2 s budget, and Codex publishes the account's limits in every
 * model response.
 *
 * The directory is always <home>/.codex, as the proxy's Codex credential check
 * resolves it; a CODEX_HOME override is not honoured.
 */
export function codexSessionsDir(home: string): string {
  return path.join(home, '.codex', 'sessions');
}

/**
 * D-CODEX-PROXY-SNAPSHOT: when Codex traffic goes through the proxy (subswitch),
 * the Codex CLI writes no rollout, so the logs stop at the last direct CLI use.
 * The proxy then writes the limits of each Codex response to one snapshot file:
 *
 *   { "version": 1, "observed_at": <epoch s>,
 *     "windows": [{ "window_minutes": n, "used_percent": n, "resets_at": <epoch s> }],
 *     "rate_limit_reached_type": string | null }
 *
 * The file is optional. The HUD takes the snapshot or the newest rollout record,
 * whichever has the later observed_at.
 */
export function codexSnapshotFile(home: string): string {
  return path.join(home, '.cache', 'subswitch', 'codex-quota.json');
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function makeWindow(minutes: unknown, usedPercent: unknown, resetsAt: unknown): CodexWindow | null {
  if (!isFiniteNumber(minutes) || minutes <= 0 || !isFiniteNumber(usedPercent) || !isFiniteNumber(resetsAt)) {
    return null;
  }
  return { minutes, usedPercent: Math.max(0, Math.min(100, usedPercent)), resetsAt };
}

function makeUsage(windows: readonly CodexWindow[], limitReached: unknown, observedAt: number): CodexUsage | null {
  if (windows.length === 0) return null;
  return {
    windows: [...windows].sort((a, b) => a.minutes - b.minutes),
    limitReached: typeof limitReached === 'string' && limitReached !== '' ? limitReached : null,
    observedAt,
  };
}

/** Windows in Codex's own field names (window_minutes, used_percent, resets_at); incomplete ones are skipped. */
function codexWindows(slots: readonly unknown[]): CodexWindow[] {
  const windows: CodexWindow[] = [];
  for (const slot of slots) {
    const raw = asRecord(slot);
    const parsed = raw && makeWindow(raw.window_minutes, raw.used_percent, raw.resets_at);
    if (parsed) windows.push(parsed);
  }
  return windows;
}

/** Epoch seconds of an ISO timestamp, or null. */
function isoToEpochSec(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

/**
 * D-CODEX-WINDOW-BY-MINUTES: a window is identified by its window_minutes, never
 * by the primary/secondary slot it arrives in. Reason: the slots carry different
 * windows per plan (a prolite plan has the weekly window as primary and no
 * secondary, a team plan a 5h primary and a weekly secondary), so a slot-keyed
 * reader would label one plan's weekly window as the other's 5h one.
 *
 * Parses one rollout line into usage. Accepts only a token_count event whose
 * rate_limits are the codex limit with at least one complete window; premium
 * records, null windows, `rate_limits: null` and malformed lines are skipped.
 * The line's timestamp is the observed time; a line without one takes
 * `fallbackObservedAt` (the file's mtime).
 */
function parseUsageLine(line: string, fallbackObservedAt: number): CodexUsage | null {
  let record: unknown;
  try {
    record = JSON.parse(line);
  } catch {
    return null;
  }
  const payload = asRecord(asRecord(record)?.payload);
  if (payload === null || payload.type !== 'token_count') return null;
  const limits = asRecord(payload.rate_limits);
  if (limits === null || limits.limit_id !== 'codex') return null;

  const observedAt = isoToEpochSec(asRecord(record)?.timestamp) ?? fallbackObservedAt;
  return makeUsage(codexWindows([limits.primary, limits.secondary]), limits.rate_limit_reached_type, observedAt);
}

/** The last line in `text` that holds a valid record, scanning backwards. */
function lastUsageIn(text: string, fallbackObservedAt: number): CodexUsage | null {
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    // Cheap prefilter: most lines are not token_count events and are never parsed.
    if (!lines[i].includes('"token_count"')) continue;
    const usage = parseUsageLine(lines[i], fallbackObservedAt);
    if (usage) return usage;
  }
  return null;
}

/** Read the last `bytes` bytes of `file`. `whole` is true when that covered the entire file. */
function readTail(file: string, bytes: number): { text: string; whole: boolean } | null {
  let fd: number;
  try {
    fd = fs.openSync(file, 'r');
  } catch {
    return null;
  }
  try {
    const size = fs.fstatSync(fd).size;
    const length = Math.min(size, bytes);
    const buf = Buffer.alloc(length);
    let total = 0;
    while (total < length) {
      const read = fs.readSync(fd, buf, total, length - total, size - length + total);
      if (read === 0) break;
      total += read;
    }
    return { text: buf.toString('utf-8', 0, total), whole: length === size };
  } catch {
    return null;
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * The newest valid record in `file`, from its tail only. The first read takes
 * CODEX_TAIL_BYTES; if that holds no record and the file is longer, one retry takes
 * CODEX_TAIL_RETRY_BYTES. Rollouts reach tens of MB, and a tail holds the newest
 * records.
 */
function latestUsageInFile(file: string, mtimeMs: number): CodexUsage | null {
  const fallbackObservedAt = Math.floor(mtimeMs / 1000);
  for (const bytes of [CODEX_TAIL_BYTES, CODEX_TAIL_RETRY_BYTES]) {
    const tail = readTail(file, bytes);
    if (tail === null) return null;
    const usage = lastUsageIn(tail.text, fallbackObservedAt);
    if (usage !== null || tail.whole) return usage;
  }
  return null;
}

/** Names of the entries of `dir` of one kind matching `pattern`, newest (greatest) first. */
function listNames(dir: string, kind: 'dir' | 'file', pattern: RegExp): string[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => (kind === 'dir' ? e.isDirectory() : e.isFile()) && pattern.test(e.name))
      .map((e) => e.name)
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

/** The newest MAX_DAY_DIRS day directories, by name: sessions/YYYY/MM/DD. */
function recentDayDirs(sessionsDir: string): string[] {
  const days: string[] = [];
  for (const year of listNames(sessionsDir, 'dir', YEAR_DIR).slice(0, MAX_YEAR_DIRS)) {
    for (const month of listNames(path.join(sessionsDir, year), 'dir', MONTH_DIR)) {
      for (const day of listNames(path.join(sessionsDir, year, month), 'dir', DAY_DIR)) {
        if (days.length >= MAX_DAY_DIRS) return days;
        days.push(path.join(sessionsDir, year, month, day));
      }
    }
  }
  return days;
}

/**
 * D-CODEX-NEWEST-MTIME: the newest data is in the most recently modified rollout,
 * not the newest-named one. Reason: a day directory is named for the day its
 * session started, and Codex keeps appending to a session for days, so a rollout in
 * an older directory can hold today's records. Only the newest MAX_DAY_DIRS day
 * directories are searched and rollouts untouched for CODEX_MAX_AGE_MS are
 * ignored, which bounds the work on a long-lived ~/.codex.
 */
function recentRollouts(sessionsDir: string, now: number): { file: string; mtimeMs: number }[] {
  const rollouts: { file: string; mtimeMs: number }[] = [];
  for (const dayDir of recentDayDirs(sessionsDir)) {
    for (const name of listNames(dayDir, 'file', ROLLOUT_FILE).slice(0, MAX_ROLLOUTS_PER_DAY)) {
      const file = path.join(dayDir, name);
      try {
        const mtimeMs = fs.statSync(file).mtimeMs;
        if (now - mtimeMs <= CODEX_MAX_AGE_MS) rollouts.push({ file, mtimeMs });
      } catch {
        // Rollout vanished between listing and stat.
      }
    }
  }
  return rollouts.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

/**
 * Codex's latest rate-limit record in the session logs, or null when there is none
 * to show: no sessions directory, no rollout modified within CODEX_MAX_AGE_MS, or
 * no valid record in the newest MAX_ROLLOUTS_READ of them (a session that has not
 * yet had a model response holds no record, so the next-newest rollout is tried).
 *
 * @param sessionsDir  Codex's sessions directory (see codexSessionsDir).
 * @param now          Epoch milliseconds, for the rollout age bound.
 */
export function readCodexUsage(sessionsDir: string, now: number): CodexUsage | null {
  for (const { file, mtimeMs } of recentRollouts(sessionsDir, now).slice(0, MAX_ROLLOUTS_READ)) {
    const usage = latestUsageInFile(file, mtimeMs);
    if (usage !== null) return usage;
  }
  return null;
}

/**
 * The proxy's snapshot (D-CODEX-PROXY-SNAPSHOT), or null when it is missing, not a
 * regular file, larger than CODEX_SNAPSHOT_MAX_BYTES, of another version, malformed,
 * observed in the future, or older than CODEX_MAX_AGE_MS.
 *
 * @param file  The snapshot path (see codexSnapshotFile).
 * @param now   Epoch milliseconds.
 */
export function readCodexSnapshot(file: string, now: number): CodexUsage | null {
  let text: string;
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.size > CODEX_SNAPSHOT_MAX_BYTES) return null;
    text = fs.readFileSync(file, 'utf-8');
  } catch {
    return null;
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  const obj = asRecord(data);
  if (obj === null || obj.version !== 1 || !Array.isArray(obj.windows)) return null;
  const observedAt = obj.observed_at;
  const nowSec = Math.floor(now / 1000);
  if (!isFiniteNumber(observedAt) || observedAt > nowSec + MAX_CLOCK_SKEW_SEC) return null;
  if (now - observedAt * 1000 > CODEX_MAX_AGE_MS) return null;
  return makeUsage(codexWindows(obj.windows), obj.rate_limit_reached_type, Math.floor(observedAt));
}

/** The record with the later observedAt; the snapshot wins a tie. */
function newest(snapshot: CodexUsage | null, logs: CodexUsage | null): CodexUsage | null {
  if (snapshot === null) return logs;
  if (logs === null) return snapshot;
  return logs.observedAt > snapshot.observedAt ? logs : snapshot;
}

function validateCodexUsage(data: unknown): CodexUsage | null {
  const obj = asRecord(data);
  if (obj === null || !Array.isArray(obj.windows) || !isFiniteNumber(obj.observedAt)) return null;
  const windows: CodexWindow[] = [];
  for (const entry of obj.windows) {
    const raw = asRecord(entry);
    const parsed = raw && makeWindow(raw.minutes, raw.usedPercent, raw.resetsAt);
    if (!parsed) return null;
    windows.push(parsed);
  }
  return makeUsage(windows, obj.limitReached, obj.observedAt);
}

/**
 * Codex usage for the statusline: the cached read while it is under 30 s old, else
 * a fresh read of the proxy snapshot and the logs, the newer of the two cached when
 * one holds a record. A run that finds none caches nothing and rescans, which is a
 * handful of directory reads.
 */
export async function gatherCodexUsage(
  devflowDir: string,
  sessionsDir: string,
  snapshotFile: string,
  now: number = Date.now(),
): Promise<CodexUsage | null> {
  const cacheDir = hudCacheDir(devflowDir);
  const cached = readCache<CodexUsage>(cacheDir, CODEX_CACHE_KEY, validateCodexUsage);
  if (cached !== null) return cached;

  const usage = newest(readCodexSnapshot(snapshotFile, now), readCodexUsage(sessionsDir, now));
  if (usage !== null) await writeCache(cacheDir, CODEX_CACHE_KEY, usage, CODEX_CACHE_TTL_MS);
  return usage;
}
