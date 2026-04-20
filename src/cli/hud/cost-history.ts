import * as fs from 'node:fs';
import * as path from 'node:path';
import { homedir } from 'node:os';
import type { CostAggregation } from './types.js';

const SECONDS_1_HOUR = 3600;
const SECONDS_PER_DAY = 86400;
const SECONDS_7_DAYS = 7 * SECONDS_PER_DAY;
const SECONDS_30_DAYS = 30 * SECONDS_PER_DAY;
const SECONDS_90_DAYS = 90 * SECONDS_PER_DAY;
const ARCHIVE_TRIM_THRESHOLD = 500;
const CACHE_TTL_MS = 30_000;

interface SessionEntry {
  session_id: string;
  cost_usd: number;
  timestamp: number;
  cwd: string;
}

/** Returns the current time as a Unix epoch in whole seconds. */
function nowEpoch(): number {
  return Math.floor(Date.now() / 1000);
}

function isSessionEntry(value: unknown): value is SessionEntry {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.session_id === 'string' &&
    typeof obj.cost_usd === 'number' &&
    typeof obj.timestamp === 'number' &&
    typeof obj.cwd === 'string'
  );
}

let sessionsDirCreated = false;
let cachedAggregation: { value: CostAggregation | null; expiresAt: number } | null = null;

/**
 * Returns the paths used for cost storage.
 * Respects DEVFLOW_DIR env for testability.
 */
export function getCostFilePaths(): { sessionsDir: string; archivePath: string } {
  const devflowDir =
    process.env.DEVFLOW_DIR ||
    path.join(process.env.HOME || homedir(), '.devflow');
  const sessionsDir = path.join(devflowDir, 'costs', 'sessions');
  const archivePath = path.join(devflowDir, 'costs', 'archive.jsonl');
  return { sessionsDir, archivePath };
}

/**
 * Persist the current session cost atomically.
 * Fire-and-forget — all errors are swallowed to avoid blocking HUD render.
 * Periodic cleanup runs every ~50 seconds (when timestamp % 50 === 0).
 */
export function persistSessionCost(
  sessionId: string,
  costUsd: number,
  cwd: string,
): void {
  if (costUsd <= 0 || !Number.isFinite(costUsd)) return;
  // Sanitize sessionId to prevent path traversal (defense-in-depth)
  if (!sessionId || /[/\\]/.test(sessionId)) return;

  try {
    const { sessionsDir } = getCostFilePaths();
    if (!sessionsDirCreated) {
      fs.mkdirSync(sessionsDir, { recursive: true });
      sessionsDirCreated = true;
    }

    const entry: SessionEntry = {
      session_id: sessionId,
      cost_usd: costUsd,
      timestamp: nowEpoch(),
      cwd,
    };

    const filePath = path.join(sessionsDir, `${sessionId}.json`);
    const tmpPath = `${filePath}.tmp`;
    const data = JSON.stringify(entry);

    // Atomic write: write to .tmp then rename
    try {
      fs.writeFileSync(tmpPath, data, { encoding: 'utf-8', flag: 'wx' });
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
        // Stale .tmp from prior crash — unlink and retry once
        try { fs.unlinkSync(tmpPath); } catch { /* race — already removed */ }
        fs.writeFileSync(tmpPath, data, { encoding: 'utf-8', flag: 'wx' });
      } else {
        throw err;
      }
    }
    fs.renameSync(tmpPath, filePath);

    // Periodic cleanup: run every ~50 seconds
    if (entry.timestamp % 50 === 0) {
      runCleanup();
    }
  } catch {
    // Non-fatal: HUD must not block on cost persistence errors
  }
}

/** Remove orphaned .tmp files in sessionsDir that are older than 1 hour. */
function cleanOrphanedTmpFiles(sessionsDir: string, nowSeconds: number, files: string[]): void {
  for (const filename of files) {
    if (!filename.endsWith('.tmp')) continue;
    const filePath = path.join(sessionsDir, filename);
    try {
      const stat = fs.statSync(filePath);
      const ageSeconds = nowSeconds - Math.floor(stat.mtimeMs / 1000);
      if (ageSeconds > SECONDS_1_HOUR) {
        fs.unlinkSync(filePath);
      }
    } catch { /* non-fatal */ }
  }
}

/** Archive session JSON files older than 24 hours into the archive JSONL. */
function archiveStaleSessionFiles(
  sessionsDir: string,
  archivePath: string,
  nowSeconds: number,
  files: string[],
): void {
  for (const filename of files) {
    if (!filename.endsWith('.json')) continue;
    const filePath = path.join(sessionsDir, filename);
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const parsed: unknown = JSON.parse(raw);
      if (!isSessionEntry(parsed)) continue;
      const age = nowSeconds - parsed.timestamp;
      if (age > SECONDS_PER_DAY) {
        fs.mkdirSync(path.dirname(archivePath), { recursive: true });
        fs.appendFileSync(archivePath, JSON.stringify(parsed) + '\n');
        fs.unlinkSync(filePath);
      }
    } catch { /* non-fatal: skip malformed files */ }
  }
}

/**
 * Clean up stale session files, orphaned .tmp files, and trim archive.
 * Called periodically from persistSessionCost.
 */
export function runCleanup(): void {
  try {
    const { sessionsDir, archivePath } = getCostFilePaths();
    const nowSeconds = nowEpoch();

    let sessionFiles: string[];
    try {
      sessionFiles = fs.readdirSync(sessionsDir);
    } catch {
      return;
    }

    cleanOrphanedTmpFiles(sessionsDir, nowSeconds, sessionFiles);
    archiveStaleSessionFiles(sessionsDir, archivePath, nowSeconds, sessionFiles);

    // Trim archive.jsonl when it exceeds threshold
    trimArchive(archivePath, nowSeconds);
  } catch { /* non-fatal */ }
}

function trimArchive(archivePath: string, nowSeconds: number): void {
  try {
    const raw = fs.readFileSync(archivePath, 'utf-8');
    const lines = raw.split('\n').filter((l) => l.trim().length > 0);
    if (lines.length <= ARCHIVE_TRIM_THRESHOLD) return;

    // Remove entries older than 90 days
    const cutoff = nowSeconds - SECONDS_90_DAYS;
    const retained = lines.filter((line) => {
      try {
        const parsed: unknown = JSON.parse(line);
        if (!isSessionEntry(parsed)) return false;
        return parsed.timestamp >= cutoff;
      } catch {
        return false;
      }
    });

    fs.writeFileSync(archivePath, retained.join('\n') + '\n', 'utf-8');
  } catch { /* non-fatal */ }
}

/** Insert or replace entry in map, keeping the one with the higher cost_usd. */
function upsertMax(map: Map<string, SessionEntry>, entry: SessionEntry): void {
  const existing = map.get(entry.session_id);
  if (!existing || entry.cost_usd > existing.cost_usd) {
    map.set(entry.session_id, entry);
  }
}

/** Read all valid SessionEntry objects from the sessions directory. */
function readSessionEntries(sessionsDir: string): Map<string, SessionEntry> {
  const map = new Map<string, SessionEntry>();
  try {
    const files = fs.readdirSync(sessionsDir);
    for (const filename of files) {
      if (!filename.endsWith('.json')) continue;
      try {
        const raw = fs.readFileSync(path.join(sessionsDir, filename), 'utf-8');
        const parsed: unknown = JSON.parse(raw);
        if (isSessionEntry(parsed)) {
          upsertMax(map, parsed);
        }
      } catch { /* skip malformed */ }
    }
  } catch { /* sessions dir may not exist yet */ }
  return map;
}

/** Read all valid SessionEntry objects from the archive JSONL file. */
function readArchiveEntries(archivePath: string): SessionEntry[] {
  const entries: SessionEntry[] = [];
  try {
    const raw = fs.readFileSync(archivePath, 'utf-8');
    const lines = raw.split('\n').filter((l) => l.trim().length > 0);
    for (const line of lines) {
      try {
        const parsed: unknown = JSON.parse(line);
        if (isSessionEntry(parsed)) {
          entries.push(parsed);
        }
      } catch { /* skip malformed JSONL lines */ }
    }
  } catch { /* archive may not exist yet */ }
  return entries;
}

/**
 * Aggregate costs from all session files and archive.
 * The currentSessionId + currentCostUsd parameters are authoritative
 * (from stdin) and override any file-based entry for the same session.
 * Results are cached for CACHE_TTL_MS to avoid repeated filesystem reads.
 */
export function aggregateCosts(
  currentSessionId: string,
  currentCostUsd: number,
): CostAggregation | null {
  // Return cached result if still valid
  if (cachedAggregation !== null && Date.now() < cachedAggregation.expiresAt) {
    return cachedAggregation.value;
  }

  try {
    const { sessionsDir, archivePath } = getCostFilePaths();

    const sessionMap = readSessionEntries(sessionsDir);

    for (const entry of readArchiveEntries(archivePath)) {
      upsertMax(sessionMap, entry);
    }

    // Override/add current session from stdin (authoritative), only when cost > 0
    if (currentCostUsd > 0) {
      const currentEntry: SessionEntry = {
        session_id: currentSessionId,
        cost_usd: currentCostUsd,
        timestamp: nowEpoch(),
        cwd: '',
      };
      const existingCurrent = sessionMap.get(currentSessionId);
      if (!existingCurrent || currentCostUsd >= existingCurrent.cost_usd) {
        sessionMap.set(currentSessionId, currentEntry);
      }
    }

    if (sessionMap.size === 0) {
      cachedAggregation = { value: null, expiresAt: Date.now() + CACHE_TTL_MS };
      return null;
    }

    const nowSeconds = nowEpoch();
    const cutoff7d = nowSeconds - SECONDS_7_DAYS;
    const cutoff30d = nowSeconds - SECONDS_30_DAYS;

    let weeklyCost = 0;
    let monthlyCost = 0;
    let hasWeekly = false;
    let hasMonthly = false;

    for (const entry of sessionMap.values()) {
      if (entry.timestamp >= cutoff30d) {
        monthlyCost += entry.cost_usd;
        hasMonthly = true;
      }
      if (entry.timestamp >= cutoff7d) {
        weeklyCost += entry.cost_usd;
        hasWeekly = true;
      }
    }

    const result: CostAggregation = {
      weeklyCost: hasWeekly ? weeklyCost : null,
      monthlyCost: hasMonthly ? monthlyCost : null,
    };
    cachedAggregation = { value: result, expiresAt: Date.now() + CACHE_TTL_MS };
    return result;
  } catch {
    return null;
  }
}
