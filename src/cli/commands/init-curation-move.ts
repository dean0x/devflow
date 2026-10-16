/**
 * @file init-curation-move.ts
 *
 * The init step that moves each project's ledger folder to the curation name:
 * `moveProjectLedgers(opts, io)`. It lives in its own module, not in init.ts, so the
 * ordering tests inject their own I/O (the shape of `drainDisabledFeatureQueues`)
 * and so the golden-red commit that wires it does not also move it.
 *
 * The step is purity-bounded like init-seed.ts: it imports no `fs`, no `os` and no
 * store. It reaches the machine only through the `io` it is given, so it has no
 * hidden effect. Every answer is a value. Nothing here throws: a store call or a
 * probe that throws becomes an `error` outcome for that project, and the rest go on.
 *
 * The step is state-checked, never run-once. A run-once record would mark a run with
 * no target as done, and later projects would never move. Each init asks the store
 * about each target again, and the store answers `none` where nothing is left to do.
 *
 * Targets: the discovered project roots plus the current repository's own ledger
 * root, each mapped to its ledger root (a linked worktree keeps its ledger in the
 * main checkout) and listed once by physical path. The home directory and the
 * machine directory are never targets, and neither is a project whose git root is
 * null: init writes no repository file at HOME.
 *
 * Per target the step runs the move, then, when a backup folder exists, the backup
 * sweep. The store takes every lock with no wait, so a busy project is reported and
 * moves at its next event. A per-project outcome never decides init's exit code.
 *
 * Nothing calls this module yet; init.ts wires it in a later commit.
 */

import * as path from 'path';
import { pooled } from '../../core/migrations.js';
import { LEGACY_NAMES } from '../../core/project-paths.js';
import type {
  LearningStoreModule,
  LedgerMoveOptions,
  LedgerMoveOutcome,
  LedgerSweepOutcome,
} from '../../core/learning-store.js';

/** At most this many projects are probed or moved at once (the migration runner's pool). */
export const MOVE_POOL_LIMIT = 16;

/** The folder-name rule the store applies: a plain name of at most 64 characters. */
const FOLDER_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProjectLedgerMoveOptions {
  /** The project roots init targets (`projectRoots` in init.ts): discovered projects, else the current repository. */
  readonly projectRoots: readonly string[];
  /** The current repository's own ledger root, or null outside git. */
  readonly ownLedgerRoot: string | null;
  /** The home directory; never a target. Absolute. */
  readonly homeDir: string;
  /** The machine directory (`~/.devflow`), which holds the move lock; never a target. Absolute. */
  readonly machineDir: string;
  /** The old folder name under `.devflow`. */
  readonly oldName: string;
  /** The new folder name under `.devflow`. */
  readonly newName: string;
}

/** The I/O the step uses. Every member is total: it answers a value and does not throw. */
export interface ProjectLedgerMoveIO {
  /** The ledger root of a project (the main checkout for a linked worktree), or null when it has no git root. */
  ledgerRootOf(projectRoot: string): Promise<string | null>;
  /** The physical path of a path, or null when it cannot be resolved. */
  realpath(target: string): Promise<string | null>;
  /** The names directly inside a directory, or null when it cannot be listed. */
  readdir(dir: string): Promise<readonly string[] | null>;
  /** The store's two move operations. */
  readonly store: Pick<LearningStoreModule, 'moveLedger' | 'sweepLedgerBackups'>;
  /** Epoch milliseconds. */
  now(): number;
}

/** What the backup sweep did for one project. A sweep that found nothing is not reported. */
export type BackupSweepReport =
  | { readonly state: 'swept'; readonly files: number; readonly merged: number; readonly overflowed: number; readonly notes: readonly string[] }
  | { readonly state: 'busy' }
  | { readonly state: 'failed'; readonly message: string };

/**
 * What happened to one project. `moved`: the folder moved (`mode`), or the new folder
 * won and the old one became the backup; `rendered` is false when the index was not
 * rebuilt after the rename, and the move stays done. `unchanged`: no old folder, so
 * nothing moved. `busy`: a lock is held; the project moves at its next event.
 * `refused`: a link or another unsafe state; nothing changed. `error`: an I/O failure;
 * nothing was copied and the old folder is whole.
 */
export type ProjectMoveOutcome =
  | {
    readonly kind: 'moved';
    readonly root: string;
    readonly mode: 'whole-folder' | 'kept-new' | 'moved-in';
    readonly backup: string | null;
    readonly rendered: boolean;
    readonly notes: readonly string[];
    readonly sweep: BackupSweepReport | null;
  }
  | { readonly kind: 'unchanged'; readonly root: string; readonly sweep: BackupSweepReport | null }
  | { readonly kind: 'busy'; readonly root: string }
  | { readonly kind: 'refused'; readonly root: string; readonly message: string }
  | { readonly kind: 'error'; readonly root: string; readonly message: string };

export interface ProjectLedgerMoveReport {
  /** One outcome per target, in target order. */
  readonly outcomes: readonly ProjectMoveOutcome[];
  /** The projects that moved. The caller prints the move notice once per run when this is above zero. */
  readonly movedCount: number;
  /** One line for each project that did not move cleanly, in target order. The caller prints them. */
  readonly lines: readonly string[];
}

export interface ProjectLedgerMoveError {
  readonly kind: 'invalid-input';
  readonly message: string;
}

export type ProjectLedgerMoveResult =
  | { readonly ok: true; readonly value: ProjectLedgerMoveReport }
  | { readonly ok: false; readonly error: ProjectLedgerMoveError };

// ---------------------------------------------------------------------------
// The step
// ---------------------------------------------------------------------------

/**
 * Move every target project's ledger folder to the new name. Answers an error only
 * for options that cannot be right (the same checks the store makes, made once, so a
 * bad call changes nothing); every per-project failure is an outcome in the report.
 */
export async function moveProjectLedgers(
  opts: ProjectLedgerMoveOptions,
  io: ProjectLedgerMoveIO,
): Promise<ProjectLedgerMoveResult> {
  const invalid = checkOptions(opts);
  if (invalid !== null) return { ok: false, error: { kind: 'invalid-input', message: invalid } };

  const targets = await resolveTargets(opts, io);
  const settled = await pooled([...targets], MOVE_POOL_LIMIT, root => moveOne(root, opts, io));
  const outcomes = settled.map((entry, index): ProjectMoveOutcome =>
    entry.status === 'fulfilled'
      ? entry.value
      : { kind: 'error', root: targets[index], message: describeFailure(entry.reason) });

  return {
    ok: true,
    value: {
      outcomes,
      movedCount: outcomes.filter(outcome => outcome.kind === 'moved').length,
      lines: outcomes.flatMap(describeOutcome),
    },
  };
}

function checkOptions(opts: ProjectLedgerMoveOptions): string | null {
  if (!FOLDER_NAME_RE.test(opts.oldName) || !FOLDER_NAME_RE.test(opts.newName) || opts.oldName === opts.newName) {
    return 'the old and new folder names must be two different plain names';
  }
  if (!path.isAbsolute(opts.homeDir) || !path.isAbsolute(opts.machineDir)) {
    return 'the home directory and the machine directory must be absolute paths';
  }
  return null;
}

/**
 * The ledger roots init moves, once each. The current repository comes first, then
 * the projects in the order given. A root is listed once by its physical path, and
 * the home directory and the machine directory are dropped by the same test.
 */
async function resolveTargets(opts: ProjectLedgerMoveOptions, io: ProjectLedgerMoveIO): Promise<readonly string[]> {
  const mapped = await pooled([...opts.projectRoots], MOVE_POOL_LIMIT, project => io.ledgerRootOf(project));
  const candidates: string[] = opts.ownLedgerRoot === null ? [] : [opts.ownLedgerRoot];
  for (const entry of mapped) {
    if (entry.status === 'fulfilled' && entry.value !== null) candidates.push(entry.value);
  }

  const [homeReal, machineReal] = await Promise.all([physicalOf(opts.homeDir, io), physicalOf(opts.machineDir, io)]);
  const physicals = await pooled(candidates, MOVE_POOL_LIMIT, candidate => physicalOf(candidate, io));

  const seen = new Set<string>([homeReal, machineReal]);
  const targets: string[] = [];
  candidates.forEach((candidate, index) => {
    const entry = physicals[index];
    const real = entry.status === 'fulfilled' ? entry.value : candidate;
    if (seen.has(real)) return;
    seen.add(real);
    targets.push(candidate);
  });
  return targets;
}

/** The physical path of a path, or the path itself when it cannot be resolved. */
async function physicalOf(target: string, io: ProjectLedgerMoveIO): Promise<string> {
  try {
    return (await io.realpath(target)) ?? target;
  } catch {
    return target;
  }
}

/** Move one project's ledger folder, then sweep its backups when one exists. */
async function moveOne(root: string, opts: ProjectLedgerMoveOptions, io: ProjectLedgerMoveIO): Promise<ProjectMoveOutcome> {
  const storeOpts = (): LedgerMoveOptions => ({
    oldName: opts.oldName,
    newName: opts.newName,
    machineDir: opts.machineDir,
    homeDir: opts.homeDir,
    now: io.now(),
  });

  let moved: ReturnType<ProjectLedgerMoveIO['store']['moveLedger']>;
  try {
    moved = io.store.moveLedger(root, storeOpts());
  } catch (error) {
    return { kind: 'error', root, message: describeFailure(error) };
  }
  if (!moved.ok) {
    return moved.error.kind === 'refused'
      ? { kind: 'refused', root, message: moved.error.message }
      : { kind: 'error', root, message: moved.error.message };
  }
  const answer: LedgerMoveOutcome = moved.value;
  if (answer.state === 'busy') return { kind: 'busy', root };

  const sweep = await sweepIfBackup(root, opts, io, storeOpts);
  if (answer.state === 'moved') {
    return { kind: 'moved', root, mode: answer.mode, backup: answer.backup, rendered: answer.rendered, notes: answer.notes, sweep };
  }
  return { kind: 'unchanged', root, sweep };
}

/** Run the backup sweep when `.devflow` holds a backup folder; answer null when there is nothing to report. */
async function sweepIfBackup(
  root: string,
  opts: ProjectLedgerMoveOptions,
  io: ProjectLedgerMoveIO,
  storeOpts: () => LedgerMoveOptions,
): Promise<BackupSweepReport | null> {
  let entries: readonly string[] | null;
  try {
    entries = await io.readdir(path.join(root, '.devflow'));
  } catch {
    entries = null;
  }
  if (entries === null || !entries.some(name => name.startsWith(LEGACY_NAMES.backupPrefix))) return null;

  let swept: ReturnType<ProjectLedgerMoveIO['store']['sweepLedgerBackups']>;
  try {
    swept = io.store.sweepLedgerBackups(root, storeOpts());
  } catch (error) {
    return { state: 'failed', message: describeFailure(error) };
  }
  if (!swept.ok) return { state: 'failed', message: swept.error.message };
  return reportSweep(swept.value);
}

function reportSweep(swept: LedgerSweepOutcome): BackupSweepReport | null {
  switch (swept.state) {
    case 'none':
      return null;
    case 'busy':
      return { state: 'busy' };
    case 'swept':
      return { state: 'swept', files: swept.files, merged: swept.merged, overflowed: swept.overflowed, notes: swept.notes };
    default: {
      const unreachable: never = swept.state;
      return unreachable;
    }
  }
}

function describeFailure(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ---------------------------------------------------------------------------
// The lines init prints
// ---------------------------------------------------------------------------

/** The lines for one project: none when it moved cleanly or had nothing to move. */
function describeOutcome(outcome: ProjectMoveOutcome): string[] {
  const lines: string[] = [];
  switch (outcome.kind) {
    case 'busy':
      lines.push(`Ledger move skipped for ${outcome.root}: a lock is held. The project moves at its next session.`);
      break;
    case 'refused':
      lines.push(`Ledger move refused for ${outcome.root}: ${outcome.message}. Nothing was changed.`);
      break;
    case 'error':
      lines.push(`Ledger move failed for ${outcome.root}: ${outcome.message}. Nothing was copied. The next init tries again.`);
      break;
    case 'moved':
      if (!outcome.rendered) {
        lines.push(`Ledger moved for ${outcome.root}, but the index was not rebuilt. The next ledger write rebuilds it.`);
      }
      break;
    case 'unchanged':
      break;
    default: {
      const unreachable: never = outcome;
      return unreachable;
    }
  }
  if (outcome.kind === 'moved' || outcome.kind === 'unchanged') {
    const sweep = outcome.sweep;
    if (sweep?.state === 'failed') {
      lines.push(`Backup merge stopped for ${outcome.root}: ${sweep.message}. The next init finishes it.`);
    } else if (sweep?.state === 'busy') {
      lines.push(`Backup merge skipped for ${outcome.root}: a lock is held. The next init tries again.`);
    }
  }
  return lines;
}
