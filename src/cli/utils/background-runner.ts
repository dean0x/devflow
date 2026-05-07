/**
 * Shared background pipeline utilities.
 *
 * Extracted from scripts/hooks/background-learning (bash) so the same locking,
 * daily-cap, and log-maintenance logic can be reused by both
 * `devflow learn --run-background` and `devflow decisions --run-background`
 * without duplication.
 *
 * These functions intentionally use simple throw/catch rather than Result types
 * because they are internal infrastructure utilities, not domain-facing APIs.
 * Callers should wrap in try/finally and release locks on failure.
 */

import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Lock management
// ---------------------------------------------------------------------------

/**
 * Acquire a mkdir-based lock directory.
 *
 * mkdir is POSIX-atomic: only one process will succeed when multiple race.
 * If the lock directory already exists but its mtime is older than
 * `staleThreshold` seconds, it is removed (stale lock breaking for zombie
 * processes). Retries every 1 s until `timeout` seconds elapse.
 *
 * Stale threshold intentionally mirrors the STALE_THRESHOLD=300 used by the
 * bash background-learning script — that script holds the lock for the full
 * Sonnet pipeline which can take up to 180 s.
 *
 * @throws {Error} When lock acquisition times out.
 */
export async function acquireBackgroundLock(
  lockDir: string,
  staleThreshold = 300,
  timeout = 90,
): Promise<void> {
  // Break stale lock before first attempt.
  _breakStaleLock(lockDir, staleThreshold);

  const deadline = Date.now() + timeout * 1_000;
  while (true) {
    try {
      fs.mkdirSync(lockDir);
      return; // acquired
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw err;
      }
    }

    if (Date.now() >= deadline) {
      throw new Error(
        `acquireBackgroundLock: timeout after ${timeout}s waiting for ${lockDir}`,
      );
    }

    // Stale check on every retry in case the holder just died.
    _breakStaleLock(lockDir, staleThreshold);
    await _sleep(1_000);
  }
}

/**
 * Release the lock directory.
 * ENOENT is silently ignored — double-release is safe.
 */
export function releaseBackgroundLock(lockDir: string): void {
  try {
    fs.rmdirSync(lockDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw err;
    }
  }
}

/**
 * Register SIGTERM / SIGINT / uncaughtException handlers that release the lock
 * and call an optional `onExit` callback before terminating.
 *
 * Returns a cleanup function that removes the handlers. Call it inside a
 * `finally` block to avoid handler leaks in long-running processes.
 *
 * Usage:
 * ```ts
 * const cleanupLock = registerLockCleanup(lockDir);
 * try { ... } finally { cleanupLock(); releaseBackgroundLock(lockDir); }
 * ```
 */
export function registerLockCleanup(
  lockDir: string,
  onExit?: () => void,
): () => void {
  const handler = () => {
    try {
      releaseBackgroundLock(lockDir);
    } catch {
      // best-effort
    }
    onExit?.();
  };

  const uncaughtHandler = (err: Error) => {
    console.error('[background-runner] uncaught exception:', err.message);
    handler();
    process.exit(1);
  };

  const signalHandler = () => {
    handler();
    process.exit(0);
  };

  process.on('SIGTERM', signalHandler);
  process.on('SIGINT', signalHandler);
  process.on('uncaughtException', uncaughtHandler);

  return () => {
    process.off('SIGTERM', signalHandler);
    process.off('SIGINT', signalHandler);
    process.off('uncaughtException', uncaughtHandler);
  };
}

// ---------------------------------------------------------------------------
// Daily cap management
//
// Cap file format: two tab-separated values on a single line —
//   DATE\tCOUNT
// (matches the session-end-learning bash script's printf '%s\t%d\n' format)
// ---------------------------------------------------------------------------

/**
 * Check whether the daily run cap has been reached.
 *
 * Returns `true` when another run is allowed, `false` when at or over the cap.
 * If the cap file's date is not today, the count is treated as 0.
 */
export function checkDailyCap(capsFile: string, maxDaily: number): boolean {
  const today = _todayString();
  try {
    const content = fs.readFileSync(capsFile, 'utf-8').trim();
    const [date, countStr] = content.split('\t');
    if (date === today) {
      const count = parseInt(countStr, 10);
      if (!isNaN(count) && count >= maxDaily) {
        return false;
      }
    }
    // Different date — treat as 0 runs today.
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn(
        `[background-runner] warning: could not read caps file ${capsFile}: ${(err as Error).message}`,
      );
    }
    return true; // absent means 0 runs today
  }
}

/**
 * Increment the daily run counter in the cap file.
 * Resets the date and count when the stored date differs from today.
 * Writes atomically via a `.tmp` sibling + rename.
 */
export function incrementDailyCap(capsFile: string): void {
  const today = _todayString();
  let count = 0;

  try {
    const content = fs.readFileSync(capsFile, 'utf-8').trim();
    const [date, countStr] = content.split('\t');
    if (date === today) {
      count = parseInt(countStr, 10) || 0;
    }
    // If date differs, count stays 0 (reset to new day).
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn(
        `[background-runner] warning: could not read caps file ${capsFile}: ${(err as Error).message}`,
      );
    }
  }

  const newContent = `${today}\t${count + 1}\n`;
  const tmp = `${capsFile}.tmp`;
  fs.writeFileSync(tmp, newContent, 'utf-8');
  fs.renameSync(tmp, capsFile);
}

// ---------------------------------------------------------------------------
// Transcript extraction
// ---------------------------------------------------------------------------

/**
 * Encode a filesystem path to the Claude Code project directory name convention.
 * Claude Code strips the leading `/` and replaces remaining `/` with `-`, then
 * prepends `-` so the directory name starts with `-`.
 *
 * Example: `/home/user/my-project` → `-home-user-my-project`
 */
export function encodeCwdForClaude(cwd: string): string {
  // Strip leading slash, replace all remaining slashes with dashes.
  const stripped = cwd.replace(/^\//, '').replace(/\//g, '-');
  return `-${stripped}`;
}

/**
 * Extract user signals and dialog pairs from batch session transcripts.
 *
 * Reads session IDs from `batchIdsFile` (one ID per line), locates each
 * session's `.jsonl` transcript in
 * `~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl`, and calls
 * `transcript-filter.cjs extractChannels` on each transcript.
 *
 * @param batchIdsFile - Path to the file containing session IDs (one per line).
 * @param cwd - Project working directory (used to locate transcripts).
 * @param filterModulePath - Optional override for transcript-filter.cjs path.
 *   Defaults to `~/.devflow/scripts/hooks/lib/transcript-filter.cjs`.
 * @returns Merged channels across all sessions in the batch.
 */
export async function extractBatchMessages(
  batchIdsFile: string,
  cwd: string,
  filterModulePath?: string,
): Promise<{
  userSignals: string[];
  dialogPairs: Array<{ prior: string; user: string }>;
}> {
  const home = process.env.HOME ?? '';
  const encodedCwd = encodeCwdForClaude(cwd);
  const projectsDir = path.join(home, '.claude', 'projects', encodedCwd);
  const filterModule =
    filterModulePath ??
    path.join(home, '.devflow', 'scripts', 'hooks', 'lib', 'transcript-filter.cjs');

  // Load transcript-filter.cjs in-process to avoid per-session child process overhead.
  // The module is pure data transformation (no I/O) and safe to require() directly.
  const { extractChannels } = require(filterModule) as {
    extractChannels: (content: string) => {
      userSignals: string[];
      dialogPairs: Array<{ prior: string; user: string }>;
    };
  };

  const batchContent = await fs.promises.readFile(batchIdsFile, 'utf-8');
  const sessionIds = batchContent
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);

  const allUserSignals: string[] = [];
  const allDialogPairs: Array<{ prior: string; user: string }> = [];

  for (const sid of sessionIds) {
    const transcriptPath = path.join(projectsDir, `${sid}.jsonl`);
    let transcriptContent: string;
    try {
      transcriptContent = await fs.promises.readFile(transcriptPath, 'utf-8');
    } catch {
      // Transcript not present — skip this session.
      continue;
    }

    try {
      const result = extractChannels(transcriptContent);
      allUserSignals.push(...result.userSignals);
      allDialogPairs.push(...result.dialogPairs);
    } catch {
      // Non-fatal — skip this session transcript.
    }
  }

  return { userSignals: allUserSignals, dialogPairs: allDialogPairs };
}

// ---------------------------------------------------------------------------
// Log maintenance
// ---------------------------------------------------------------------------

/**
 * Apply temporal decay to learning log entries.
 *
 * Delegates to `json-helper.cjs temporal-decay <logFile>`.
 * The helper accepts the log file path directly as its argument.
 *
 * @param jsonHelperPath - Path to json-helper.cjs.
 * @param logFile - Path to the JSONL learning log.
 */
export async function applyTemporalDecay(
  jsonHelperPath: string,
  logFile: string,
): Promise<void> {
  await execFileAsync('node', [jsonHelperPath, 'temporal-decay', logFile]);
}

/**
 * Cap a JSONL log file to at most `max` lines by keeping the last `max` lines.
 *
 * Rewrites atomically via a `.tmp` sibling + rename.
 * No-ops when line count is at or below the cap.
 */
export function capEntries(logFile: string, max = 100): void {
  let content: string;
  try {
    content = fs.readFileSync(logFile, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw err;
    }
    return; // file absent — nothing to cap
  }

  const lines = content.split('\n').filter((l) => l.trim().length > 0);
  if (lines.length <= max) {
    return;
  }

  const capped = lines.slice(lines.length - max).join('\n') + '\n';
  const tmp = `${logFile}.tmp`;
  fs.writeFileSync(tmp, capped, 'utf-8');
  fs.renameSync(tmp, logFile);
}

/**
 * Run the staleness checker against the learning log.
 *
 * Delegates to `lib/staleness.cjs <logFile> <cwd>` if the module exists.
 * Errors are caught and logged non-fatally.
 *
 * @param stalenessModulePath - Path to staleness.cjs.
 * @param logFile - Path to the JSONL learning log.
 * @param cwd - Project working directory passed to staleness checker.
 */
export async function checkStaleness(
  stalenessModulePath: string,
  logFile: string,
  cwd: string,
): Promise<void> {
  if (!fs.existsSync(stalenessModulePath)) {
    return;
  }
  try {
    await execFileAsync('node', [stalenessModulePath, logFile, cwd]);
  } catch (err) {
    console.warn(
      `[background-runner] staleness check failed: ${(err as Error).message}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Observation loading (shared by learning-agent.ts and decisions-agent.ts)
// ---------------------------------------------------------------------------

/**
 * Load existing observations from a log file, filtered by type, for deduplication context.
 * Tries json-helper.cjs filter-observations first; falls back to direct log read.
 *
 * @param jsonHelperPath - Path to json-helper.cjs.
 * @param logFile - Path to the JSONL log file.
 * @param types - Observation types to include (e.g. ['workflow', 'procedural']).
 * @returns JSON string of filtered observations.
 */
export async function loadExistingObservations(
  jsonHelperPath: string,
  logFile: string,
  types: string[],
): Promise<string> {
  try {
    const { stdout } = await execFileAsync('node', [jsonHelperPath, 'filter-observations', logFile, 'confidence', '30'], {
      timeout: 10_000,
    });
    const parsed: unknown = JSON.parse(stdout.trim() || '[]');
    if (!Array.isArray(parsed)) return '[]';
    const filtered = parsed.filter(
      (entry): entry is Record<string, unknown> =>
        typeof entry === 'object' && entry !== null &&
        types.includes(String((entry as Record<string, unknown>)['type'])),
    );
    return JSON.stringify(filtered);
  } catch {
    return _loadObservationsFromLog(logFile, types);
  }
}

async function _loadObservationsFromLog(logFile: string, types: string[]): Promise<string> {
  try {
    const content = await fs.promises.readFile(logFile, 'utf-8');
    const lines = content.split('\n').filter(Boolean);
    const observations: unknown[] = [];
    for (const line of lines) {
      try {
        const entry: unknown = JSON.parse(line);
        if (
          typeof entry === 'object' && entry !== null &&
          types.includes(String((entry as Record<string, unknown>)['type'])) &&
          (entry as Record<string, unknown>)['status'] === 'observing'
        ) {
          observations.push(entry);
        }
      } catch {
        // Skip malformed lines.
      }
    }
    return JSON.stringify(observations);
  } catch {
    return '[]';
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function _breakStaleLock(lockDir: string, staleThresholdSeconds: number): void {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(lockDir);
  } catch {
    return; // lock doesn't exist — nothing to break
  }

  const ageSeconds = (Date.now() - stat.mtimeMs) / 1_000;
  if (ageSeconds > staleThresholdSeconds) {
    try {
      fs.rmdirSync(lockDir);
    } catch {
      // Race — another process may have already removed it.
    }
  }
}

function _sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function _todayString(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}
