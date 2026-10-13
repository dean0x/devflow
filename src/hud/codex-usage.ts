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

const MAX_YEAR_DIRS = 3;
const MAX_DAY_DIRS = 14;
const MAX_ROLLOUTS_PER_DAY = 200;
const MAX_ROLLOUTS_READ = 3;

const YEAR_DIR = /^\d{4}$/;
const MONTH_DIR = /^(0[1-9]|1[0-2])$/;
const DAY_DIR = /^(0[1-9]|[12]\d|3[01])$/;
const ROLLOUT_FILE = /^rollout-.*\.jsonl$/;

/**
 * D-CODEX-LOCAL-LOGS-ONLY: Codex usage comes from the rate-limit records the
 * Codex CLI already writes to its own session logs under ~/.codex/sessions. The
 * statusline reads those logs and nothing else: it opens no credential file
 * (auth.json) and makes no network call, so it cannot leak a token or stall on a
 * request. Reason: the HUD runs on every prompt under a 2 s budget, and Codex
 * publishes the account's limits in every model response it logs.
 *
 * The directory is always <home>/.codex, as the proxy's Codex credential check
 * resolves it; a CODEX_HOME override is not honoured.
 */
export function codexSessionsDir(home: string): string {
  return path.join(home, '.codex', 'sessions');
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

function makeUsage(windows: readonly CodexWindow[], limitReached: unknown): CodexUsage | null {
  if (windows.length === 0) return null;
  return {
    windows: [...windows].sort((a, b) => a.minutes - b.minutes),
    limitReached: typeof limitReached === 'string' && limitReached !== '' ? limitReached : null,
  };
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
 */
function parseUsageLine(line: string): CodexUsage | null {
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

  const windows: CodexWindow[] = [];
  for (const slot of [limits.primary, limits.secondary]) {
    const raw = asRecord(slot);
    const parsed = raw && makeWindow(raw.window_minutes, raw.used_percent, raw.resets_at);
    if (parsed) windows.push(parsed);
  }
  return makeUsage(windows, limits.rate_limit_reached_type);
}

/** The last line in `text` that holds a valid record, scanning backwards. */
function lastUsageIn(text: string): CodexUsage | null {
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    // Cheap prefilter: most lines are not token_count events and are never parsed.
    if (!lines[i].includes('"token_count"')) continue;
    const usage = parseUsageLine(lines[i]);
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
function latestUsageInFile(file: string): CodexUsage | null {
  for (const bytes of [CODEX_TAIL_BYTES, CODEX_TAIL_RETRY_BYTES]) {
    const tail = readTail(file, bytes);
    if (tail === null) return null;
    const usage = lastUsageIn(tail.text);
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
function recentRollouts(sessionsDir: string, now: number): string[] {
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
  return rollouts.sort((a, b) => b.mtimeMs - a.mtimeMs).map((r) => r.file);
}

/**
 * Codex's latest rate-limit record, or null when there is none to show: no sessions
 * directory, no rollout modified within CODEX_MAX_AGE_MS, or no valid record in the
 * newest MAX_ROLLOUTS_READ of them (a session that has not yet had a model response
 * holds no record, so the next-newest rollout is tried).
 *
 * @param sessionsDir  Codex's sessions directory (see codexSessionsDir).
 * @param now          Epoch milliseconds, for the rollout age bound.
 */
export function readCodexUsage(sessionsDir: string, now: number): CodexUsage | null {
  for (const file of recentRollouts(sessionsDir, now).slice(0, MAX_ROLLOUTS_READ)) {
    const usage = latestUsageInFile(file);
    if (usage !== null) return usage;
  }
  return null;
}

function validateCodexUsage(data: unknown): CodexUsage | null {
  const obj = asRecord(data);
  if (obj === null || !Array.isArray(obj.windows)) return null;
  const windows: CodexWindow[] = [];
  for (const entry of obj.windows) {
    const raw = asRecord(entry);
    const parsed = raw && makeWindow(raw.minutes, raw.usedPercent, raw.resetsAt);
    if (!parsed) return null;
    windows.push(parsed);
  }
  return makeUsage(windows, obj.limitReached);
}

/**
 * Codex usage for the statusline: the cached read while it is under 30 s old, else
 * a fresh read of the logs, cached when it found a record. A run that finds none
 * caches nothing and rescans, which is a handful of directory reads.
 */
export async function gatherCodexUsage(
  devflowDir: string,
  sessionsDir: string,
  now: number = Date.now(),
): Promise<CodexUsage | null> {
  const cacheDir = hudCacheDir(devflowDir);
  const cached = readCache<CodexUsage>(cacheDir, CODEX_CACHE_KEY, validateCodexUsage);
  if (cached !== null) return cached;

  const usage = readCodexUsage(sessionsDir, now);
  if (usage !== null) await writeCache(cacheDir, CODEX_CACHE_KEY, usage, CODEX_CACHE_TTL_MS);
  return usage;
}
