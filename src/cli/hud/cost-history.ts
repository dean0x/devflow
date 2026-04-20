import * as fs from 'node:fs';
import * as path from 'node:path';
import { homedir } from 'node:os';
import type { CostAggregation } from './types.js';

const SECONDS_PER_DAY = 86400;
const SECONDS_7_DAYS = 7 * SECONDS_PER_DAY;
const SECONDS_30_DAYS = 30 * SECONDS_PER_DAY;
const SECONDS_90_DAYS = 90 * SECONDS_PER_DAY;
const SECONDS_24_HOURS = 24 * SECONDS_PER_DAY;
const SECONDS_1_HOUR = 3600;
const ARCHIVE_TRIM_THRESHOLD = 500;

interface SessionEntry {
  session_id: string;
  cost_usd: number;
  timestamp: number;
  cwd: string;
}

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
  if (!costUsd) return;

  try {
    const { sessionsDir } = getCostFilePaths();
    fs.mkdirSync(sessionsDir, { recursive: true });

    const entry: SessionEntry = {
      session_id: sessionId,
      cost_usd: costUsd,
      timestamp: Math.floor(Date.now() / 1000),
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

/**
 * Clean up stale session files, orphaned .tmp files, and trim archive.
 * Called periodically from persistSessionCost.
 */
function runCleanup(): void {
  try {
    const { sessionsDir, archivePath } = getCostFilePaths();
    const nowSeconds = Math.floor(Date.now() / 1000);

    let sessionFiles: string[];
    try {
      sessionFiles = fs.readdirSync(sessionsDir);
    } catch {
      return;
    }

    for (const filename of sessionFiles) {
      const filePath = path.join(sessionsDir, filename);

      // Clean orphaned .tmp files older than 1 hour
      if (filename.endsWith('.tmp')) {
        try {
          const stat = fs.statSync(filePath);
          const ageSeconds = nowSeconds - Math.floor(stat.mtimeMs / 1000);
          if (ageSeconds > SECONDS_1_HOUR) {
            fs.unlinkSync(filePath);
          }
        } catch { /* non-fatal */ }
        continue;
      }

      if (!filename.endsWith('.json')) continue;

      // Archive session files older than 24 hours
      try {
        const raw = fs.readFileSync(filePath, 'utf-8');
        const entry = JSON.parse(raw) as SessionEntry;
        const age = nowSeconds - entry.timestamp;
        if (age > SECONDS_24_HOURS) {
          fs.mkdirSync(path.dirname(archivePath), { recursive: true });
          fs.appendFileSync(archivePath, JSON.stringify(entry) + '\n');
          fs.unlinkSync(filePath);
        }
      } catch { /* non-fatal: skip malformed files */ }
    }

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
        const entry = JSON.parse(line) as SessionEntry;
        return entry.timestamp >= cutoff;
      } catch {
        return false;
      }
    });

    fs.writeFileSync(archivePath, retained.join('\n') + '\n', 'utf-8');
  } catch { /* non-fatal */ }
}

/**
 * Aggregate costs from all session files and archive.
 * The currentSessionId + currentCostUsd parameters are authoritative
 * (from stdin) and override any file-based entry for the same session.
 */
export function aggregateCosts(
  currentSessionId: string,
  currentCostUsd: number,
): CostAggregation | null {
  try {
    const { sessionsDir, archivePath } = getCostFilePaths();

    const sessionMap = new Map<string, SessionEntry>();

    // Read active session files
    try {
      const files = fs.readdirSync(sessionsDir);
      for (const filename of files) {
        if (!filename.endsWith('.json')) continue;
        try {
          const raw = fs.readFileSync(path.join(sessionsDir, filename), 'utf-8');
          const entry = JSON.parse(raw) as SessionEntry;
          if (typeof entry.session_id === 'string' && typeof entry.cost_usd === 'number') {
            const existing = sessionMap.get(entry.session_id);
            // Take the max cost entry for deduplication
            if (!existing || entry.cost_usd > existing.cost_usd) {
              sessionMap.set(entry.session_id, entry);
            }
          }
        } catch { /* skip malformed */ }
      }
    } catch { /* sessions dir may not exist yet */ }

    // Read archive entries
    try {
      const raw = fs.readFileSync(archivePath, 'utf-8');
      const lines = raw.split('\n').filter((l) => l.trim().length > 0);
      for (const line of lines) {
        try {
          const entry = JSON.parse(line) as SessionEntry;
          if (typeof entry.session_id === 'string' && typeof entry.cost_usd === 'number') {
            const existing = sessionMap.get(entry.session_id);
            if (!existing || entry.cost_usd > existing.cost_usd) {
              sessionMap.set(entry.session_id, entry);
            }
          }
        } catch { /* skip malformed JSONL lines */ }
      }
    } catch { /* archive may not exist yet */ }

    if (sessionMap.size === 0 && !currentCostUsd) return null;

    // Override/add current session from stdin (authoritative), only when cost > 0
    if (currentCostUsd > 0) {
      const currentEntry: SessionEntry = {
        session_id: currentSessionId,
        cost_usd: currentCostUsd,
        timestamp: Math.floor(Date.now() / 1000),
        cwd: '',
      };
      const existingCurrent = sessionMap.get(currentSessionId);
      if (!existingCurrent || currentCostUsd >= existingCurrent.cost_usd) {
        sessionMap.set(currentSessionId, currentEntry);
      }
    }

    if (sessionMap.size === 0) return null;

    const nowSeconds = Math.floor(Date.now() / 1000);
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

    return {
      weeklyCost: hasWeekly ? weeklyCost : null,
      monthlyCost: hasMonthly ? monthlyCost : null,
    };
  } catch {
    return null;
  }
}
