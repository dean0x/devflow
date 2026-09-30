import { promises as fs, type Dirent } from 'fs';
import * as path from 'path';

/**
 * @file hook-log-dirs.ts
 *
 * The cap on the hooks' per-directory log folders.
 *
 * D-LOG-DIR-CAP: every hook logs under `~/.devflow/logs/<slug>/`, one directory
 * per working directory a session ran in (`log-paths`' devflow_log_dir). Left
 * uncapped they pile up — a machine was found holding 31k of them, most left by
 * test runs in throwaway temp directories — so `devflow init` keeps the
 * {@link MAX_HOOK_LOG_DIRS} most recently written and removes the rest, oldest
 * first. A folder's recency is the newest mtime among the folder and the log
 * files in it: a log that is only ever appended to leaves the folder's own mtime
 * where the file's creation put it, so the folder mtime alone would rank the
 * busiest project as the oldest.
 *
 * Every pass is bounded — at most {@link MAX_LOG_DIRS_SCANNED} folders read and
 * {@link MAX_LOG_DIRS_PRUNED_PER_RUN} removed. The two bounds are equal, so one
 * init clears every folder it scanned beyond the cap: a 31k backlog costs that
 * init about seven seconds (roughly 2.2 s per 10,000 removals), and only a
 * backlog larger than the scan bound is finished by the next init. The pass is
 * the one-time cleanup of an existing backlog and the standing cap alike.
 * Only directories are touched: files at the logs root (`proxy.log`) and symbolic
 * links are left alone.
 */

/** How many hook log folders survive a prune — the most recently written ones. */
export const MAX_HOOK_LOG_DIRS = 200;

/** The most folders one prune reads; beyond it the rest wait for a later run. */
export const MAX_LOG_DIRS_SCANNED = 100_000;

/** The most folders one prune removes — every scanned folder, so one run clears what it read. */
export const MAX_LOG_DIRS_PRUNED_PER_RUN = MAX_LOG_DIRS_SCANNED;

/** The most entries read inside one folder to find its newest log. */
const MAX_FILES_READ_PER_DIR = 64;

/** Folders stat'ed or removed at once. */
const IO_CHUNK = 64;

export interface LogDirPruneOptions {
  readonly keep?: number;
  readonly maxRemovals?: number;
  readonly maxScanned?: number;
}

export interface LogDirPruneReport {
  /** Folders removed by this run. */
  readonly removed: number;
  /** Folders still beyond the cap after this run (a later run removes them). */
  readonly overCap: number;
}

export type LogDirPruneResult =
  | { readonly ok: true; readonly value: LogDirPruneReport }
  | { readonly ok: false; readonly error: string };

interface RankedDir {
  readonly dir: string;
  readonly recency: number;
}

/** The newest mtime among `dir` and the entries in it; -Infinity when unreadable. */
async function recencyOf(dir: string): Promise<number> {
  let newest: number;
  try {
    newest = (await fs.lstat(dir)).mtimeMs;
  } catch {
    return -Infinity;
  }
  let names: string[];
  try {
    names = (await fs.readdir(dir)).slice(0, MAX_FILES_READ_PER_DIR);
  } catch {
    return newest;
  }
  const times = await Promise.all(names.map(name =>
    fs.lstat(path.join(dir, name)).then(st => st.mtimeMs, () => -Infinity)));
  return Math.max(newest, ...times);
}

/** Apply `fn` to every item, `IO_CHUNK` at a time. Bounded by `items.length`. */
async function inChunks<T, R>(items: readonly T[], fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += IO_CHUNK) {
    out.push(...await Promise.all(items.slice(i, i + IO_CHUNK).map(fn)));
  }
  return out;
}

/**
 * Remove the oldest hook log folders under `logsDir` beyond the cap
 * (D-LOG-DIR-CAP). Never throws: a missing logs directory is nothing to do, and
 * a folder that cannot be removed is counted as still over the cap.
 */
export async function pruneHookLogDirs(logsDir: string, opts: LogDirPruneOptions = {}): Promise<LogDirPruneResult> {
  const keep = opts.keep ?? MAX_HOOK_LOG_DIRS;
  const maxRemovals = opts.maxRemovals ?? MAX_LOG_DIRS_PRUNED_PER_RUN;
  const maxScanned = opts.maxScanned ?? MAX_LOG_DIRS_SCANNED;
  if (!path.isAbsolute(logsDir) || path.basename(logsDir) !== 'logs') {
    return { ok: false, error: `not a devflow logs directory: ${logsDir}` };
  }
  if (keep < 0 || maxRemovals < 0 || maxScanned < 0) {
    return { ok: false, error: 'prune bounds must be non-negative' };
  }

  let entries: Dirent[];
  try {
    entries = await fs.readdir(logsDir, { withFileTypes: true });
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { ok: true, value: { removed: 0, overCap: 0 } };
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  const dirs = entries
    .filter(e => e.isDirectory())
    .slice(0, maxScanned)
    .map(e => path.join(logsDir, e.name));
  if (dirs.length <= keep) return { ok: true, value: { removed: 0, overCap: 0 } };

  const recencies = await inChunks(dirs, recencyOf);
  const oldestFirst: RankedDir[] = dirs
    .map((dir, i) => ({ dir, recency: recencies[i] }))
    .sort((a, b) => a.recency - b.recency);
  const overCap = oldestFirst.slice(0, oldestFirst.length - keep);
  const batch = overCap.slice(0, maxRemovals);

  const outcomes = await inChunks(batch, ({ dir }) =>
    fs.rm(dir, { recursive: true, force: true }).then(() => true, () => false));
  const removed = outcomes.filter(Boolean).length;
  return { ok: true, value: { removed, overCap: overCap.length - removed } };
}
