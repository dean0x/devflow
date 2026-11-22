import { execFile } from 'node:child_process';
import { statSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, isAbsolute } from 'node:path';
import { hudCacheDir, readCache, writeCache } from '../core/cache.js';
import { readTokenmeterBin } from './tokenmeter-bin.js';
import type { CodexUsage, CodexWindow } from './types.js';

const CACHE_KEY = 'tokenmeter-hud';
const DEADLINE_MS = 700;
const MAX_OUTPUT_BYTES = 16 * 1024;
const MAX_FUTURE_MS = 300_000;
const STALE_AFTER_MS = 600_000;
const REFRESH_AFTER_MS = 60_000;
const CACHE_MS = 30_000;
const NEAR_STALE_CACHE_MS = 5_000;
const MAX_PATH_BYTES = 64 * 1024;
const MAX_PATH_ENTRIES = 256;

// Match the usage tool's Codex child env, plus its v1 data directory inputs.
const ENV_KEYS = [
  'HOME', 'TMPDIR', 'LANG', 'LC_ALL', 'TOKENMETER_DATA_DIR', 'XDG_STATE_HOME', 'CODEX_HOME',
  'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'ALL_PROXY',
  'http_proxy', 'https_proxy', 'no_proxy', 'all_proxy', 'SSL_CERT_FILE', 'SSL_CERT_DIR',
] as const;

interface CacheValue {
  readonly usage: CodexUsage | null;
}

function filteredPath(raw: string, uid: number | undefined): string {
  if (uid === undefined || Buffer.byteLength(raw) > MAX_PATH_BYTES) return '';
  const entries = raw.split(delimiter);
  if (entries.length > MAX_PATH_ENTRIES) return '';
  return [...new Set(entries.filter(isAbsolute))].filter((entry) => {
    try {
      const stat = statSync(entry);
      return stat.isDirectory() && (stat.uid === 0 || stat.uid === uid) && (stat.mode & 0o022) === 0;
    } catch {
      return false;
    }
  }).join(delimiter);
}

function childEnv(parent: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  const path = filteredPath(parent.PATH ?? '', process.getuid?.());
  if (path) env.PATH = path;
  for (const key of ENV_KEYS) {
    const value = parent[key];
    if (value) env[key] = value;
  }
  return env;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isEpochTime(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isReadingTime(value: unknown, now: number): value is number {
  return isEpochTime(value) && value <= now + MAX_FUTURE_MS;
}

function isPercent(value: unknown): value is number {
  return typeof value === 'number' && value >= 0 && value <= 100;
}

function isSupportedLength(value: unknown): value is 300 | 10080 {
  return value === 300 || value === 10080;
}

/**
 * D-CODEX-WINDOW-BY-MINUTES: Identify Codex windows by length.
 * Keep only 300- and 10080-minute windows. Skip other lengths without discarding supported windows.
 */
function parseUsage(value: unknown, now: number): CodexUsage | null {
  if (!isRecord(value) || value.schema !== 'tokenmeter.v1' || value.ok !== true) return null;
  const { data } = value;
  if (!isRecord(data) || data.hud !== 1 || !isRecord(data.codex)) return null;
  const { at, limit_reached: reached, windows: rawWindows } = data.codex;
  if (!isReadingTime(at, now) || typeof reached !== 'boolean' || !Array.isArray(rawWindows)) return null;

  const windows: CodexWindow[] = [];
  // Stdout's byte cap also bounds the number of windows. Drop new window lengths.
  for (const raw of rawWindows) {
    if (!isRecord(raw)) return null;
    const minutes = raw.window_minutes;
    if (typeof minutes !== 'number' || !Number.isSafeInteger(minutes) || minutes <= 0) return null;
    if (!isSupportedLength(minutes)) continue;
    const { pct, resets_at: resetsAt, at: observedAt } = raw;
    if (!isPercent(pct) || !isEpochTime(resetsAt) || !isReadingTime(observedAt, now)) return null;
    if (windows.some((window) => window.minutes === minutes)) return null;
    windows.push({ minutes, usedPercent: pct, resetsAt: Math.floor(resetsAt / 1000) });
  }
  if (windows.length === 0) return null;
  return { windows: windows.sort((a, b) => a.minutes - b.minutes), limitReached: reached ? 'reached' : null, observedAt: at };
}

function parseCached(value: unknown, now: number): CacheValue | null {
  if (!isRecord(value)) return null;
  const { usage } = value;
  if (usage === null) return { usage: null };
  if (!isRecord(usage)) return null;
  const { windows: rawWindows, observedAt, limitReached } = usage;
  if (!isReadingTime(observedAt, now) || (limitReached !== null && limitReached !== 'reached')) return null;
  if (!Array.isArray(rawWindows) || rawWindows.length < 1 || rawWindows.length > 2) return null;

  const windows: CodexWindow[] = [];
  let previousMinutes = 0;
  for (const raw of rawWindows) {
    if (!isRecord(raw)) return null;
    const { minutes, usedPercent, resetsAt } = raw;
    if (!isSupportedLength(minutes) || minutes <= previousMinutes || !isPercent(usedPercent)) return null;
    if (!isEpochTime(resetsAt) || resetsAt > Math.floor(Number.MAX_SAFE_INTEGER / 1000)) return null;
    windows.push({ minutes, usedPercent, resetsAt });
    previousMinutes = minutes;
  }
  return { usage: { windows, observedAt, limitReached } };
}

/** D-TOKENMETER-HUD: Read quota only through the verified local tool. Never pass HUD stdin. */
async function fetchUsage(bin: string, now: number): Promise<CodexUsage | null> {
  try {
    const stdout = await new Promise<Buffer | null>((resolve) => {
      const child = execFile(process.execPath, [bin, 'hud'], {
        shell: false,
        cwd: homedir(),
        env: childEnv(process.env),
        encoding: 'buffer',
        timeout: DEADLINE_MS,
        killSignal: 'SIGKILL',
        maxBuffer: MAX_OUTPUT_BYTES,
      }, (error, output) => resolve(error ? null : output));
      child.stdin?.on('error', () => undefined);
      child.stdin?.end();
    });
    if (stdout === null || stdout.length > MAX_OUTPUT_BYTES) return null;
    const parsed: unknown = JSON.parse(stdout.toString('utf8'));
    return parseUsage(parsed, now);
  } catch {
    return null;
  }
}

function cacheTtl(usage: CodexUsage | null, now: number): number {
  if (usage === null) return CACHE_MS;
  const age = now - usage.observedAt;
  if (age < REFRESH_AFTER_MS || age >= STALE_AFTER_MS) return CACHE_MS;
  return Math.min(NEAR_STALE_CACHE_MS, STALE_AFTER_MS - age);
}

export async function gatherTokenmeterUsage(devflowDir: string, now = Date.now()): Promise<CodexUsage | null> {
  const cacheDir = hudCacheDir(devflowDir);
  const cached = readCache(cacheDir, CACHE_KEY, (value) => parseCached(value, now));
  if (cached !== null) return cached.usage;

  const bin = readTokenmeterBin(devflowDir);
  const usage = bin === null ? null : await fetchUsage(bin, now);
  await writeCache(cacheDir, CACHE_KEY, { usage }, cacheTtl(usage, now), now);
  return usage;
}
