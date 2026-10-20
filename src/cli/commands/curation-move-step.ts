/**
 * @file curation-move-step.ts
 *
 * The move of a project's ledger folder to the curation name, as steps over injected
 * I/O: `moveProjectLedgers(opts, io)`, the init step for every project, and
 * `moveLedgerRoot(root, opts, io)`, the one-root move the curation command runs, with
 * the lines each outcome prints (`describeOutcome`). Init and the curation command share
 * it, so neither owns it. It lives in its own module, not in init.ts, so the
 * ordering tests inject their own I/O (the shape of `drainDisabledFeatureQueues`).
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
 * null: init writes no repository file at HOME. A project whose git root lookup does
 * not answer in time (a hung mount) is skipped, named in the lines init prints and
 * never counted as moved.
 *
 * Per target the step runs the move, then, when a backup folder exists, the backup
 * sweep. The store takes every lock with no wait, so a busy project is reported and
 * moves at its next event. A per-project outcome never decides init's exit code.
 *
 * Callers: init.ts runs {@link runInitCurationMove} between its legacy sweep and the
 * manifest write, and the curation command runs {@link moveLedgerRoot} for one root
 * (configure and the toggles). The real I/O is built in curation-move-io.ts.
 */

import * as path from 'path';
import { pooled } from '../../core/pool.js';
import { describeEchoedValue } from '../../core/echo-value.js';
import type { LedgerRootLookup } from '../../core/ledger-root.js';
import { CURATION_DIR_NAME, CURATION_TUNING_FILE_NAME, LEGACY_NAMES, getGlobalCurateTuningConfigPath } from '../../core/project-paths.js';
import type {
  CurationMoveModule,
  LedgerMoveOptions,
  LedgerMoveOutcome,
  LedgerSweepOutcome,
} from '../../core/curation-move.js';

/** At most this many projects are probed or moved at once (the migration runner's pool). */
export const MOVE_POOL_LIMIT = 16;

/** The most code points of one name, message or line the step echoes. A path of 4096 bytes fits. */
const MAX_MOVE_TEXT = 4096;

/**
 * A name, a message or a line from a project's repository, made safe to print: control
 * characters (terminal escapes, a newline) become `?`, C1 included, and the text is cut
 * at MAX_MOVE_TEXT. Every echoed root, store message and entry name goes through it.
 */
export function describeMoveText(raw: unknown): string {
  return describeEchoedValue(raw, MAX_MOVE_TEXT);
}

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
}

/** The I/O the step uses. Every member is total: it answers a value and does not throw. */
export interface ProjectLedgerMoveIO {
  /**
   * The ledger root of a project (the main checkout for a linked worktree): `no-root` when
   * it has no git root, `timed-out` when git did not answer in time.
   */
  ledgerRootOf(projectRoot: string): Promise<LedgerRootLookup>;
  /** The physical path of a path, or null when it cannot be resolved. */
  realpath(target: string): Promise<string | null>;
  /** The names directly inside a directory, or null when it cannot be listed. */
  readdir(dir: string): Promise<readonly string[] | null>;
  /** The store's two move operations. */
  readonly store: Pick<CurationMoveModule, 'moveLedger' | 'sweepLedgerBackups'>;
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
 * nothing moved. `busy`: a lock is held and the project moves at its next event, or, with
 * `reason` `claim`, a queue claim holds the move and it runs after Curate finishes.
 * `refused`: a link or another unsafe state; nothing changed. `error`: an I/O failure;
 * nothing was copied and the old folder is whole. `skipped`: the project's git root
 * lookup did not answer in time, so its ledger root is unknown and nothing was tried;
 * `root` is the project root init was given.
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
  | { readonly kind: 'busy'; readonly root: string; readonly reason?: 'claim' }
  | { readonly kind: 'refused'; readonly root: string; readonly message: string }
  | { readonly kind: 'error'; readonly root: string; readonly message: string }
  | { readonly kind: 'skipped'; readonly root: string; readonly reason: 'git-root-timed-out' };

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
 * for options that cannot be right (the two directories must be absolute paths, so a
 * bad call changes nothing); every per-project failure is an outcome in the report.
 */
export async function moveProjectLedgers(
  opts: ProjectLedgerMoveOptions,
  io: ProjectLedgerMoveIO,
): Promise<ProjectLedgerMoveResult> {
  const invalid = checkOptions(opts);
  if (invalid !== null) return { ok: false, error: { kind: 'invalid-input', message: invalid } };

  const { targets, stalled } = await resolveTargets(opts, io);
  const settled = await pooled([...targets], MOVE_POOL_LIMIT, root => moveOne(root, opts, io));
  const moves = settled.map((entry, index): ProjectMoveOutcome =>
    entry.status === 'fulfilled'
      ? entry.value
      : { kind: 'error', root: targets[index], message: describeFailure(entry.reason) });
  const skipped = stalled.map((root): ProjectMoveOutcome => ({ kind: 'skipped', root, reason: 'git-root-timed-out' }));
  const outcomes = [...moves, ...skipped];

  return {
    ok: true,
    value: {
      outcomes,
      movedCount: outcomes.filter(outcome => outcome.kind === 'moved').length,
      lines: outcomes.flatMap(describeOutcome),
    },
  };
}

function checkOptions(opts: SharedMoveOptions): string | null {
  if (!path.isAbsolute(opts.homeDir) || !path.isAbsolute(opts.machineDir)) {
    return 'the home directory and the machine directory must be absolute paths';
  }
  return null;
}

/** The ledger roots init moves, and the projects whose lookup timed out. */
interface ResolvedTargets {
  readonly targets: readonly string[];
  /** The project roots whose git root lookup did not answer in time, in the order given. */
  readonly stalled: readonly string[];
}

/**
 * The ledger roots init moves, once each. The current repository comes first, then
 * the projects in the order given. A root is listed once by its physical path, and
 * the home directory and the machine directory are dropped by the same test. A project
 * whose lookup timed out has no known ledger root: it is no target, and is listed apart.
 */
async function resolveTargets(opts: ProjectLedgerMoveOptions, io: ProjectLedgerMoveIO): Promise<ResolvedTargets> {
  const mapped = await pooled([...opts.projectRoots], MOVE_POOL_LIMIT, project => io.ledgerRootOf(project));
  const candidates: string[] = opts.ownLedgerRoot === null ? [] : [opts.ownLedgerRoot];
  const stalled: string[] = [];
  mapped.forEach((entry, index) => {
    if (entry.status !== 'fulfilled') return;
    if (entry.value.kind === 'root') candidates.push(entry.value.root);
    else if (entry.value.kind === 'timed-out') stalled.push(opts.projectRoots[index]);
  });

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
  return { targets, stalled };
}

/** The physical path of a path, or the path itself when it cannot be resolved. */
async function physicalOf(target: string, io: ProjectLedgerMoveIO): Promise<string> {
  try {
    return (await io.realpath(target)) ?? target;
  } catch {
    return target;
  }
}

/** The options one root's move needs: the two directories the store refuses as a root. */
export type SharedMoveOptions = Pick<ProjectLedgerMoveOptions, 'homeDir' | 'machineDir'>;

/** The I/O one root's move needs. */
export type SharedMoveIO = Pick<ProjectLedgerMoveIO, 'readdir' | 'store' | 'now'>;

/**
 * Move one ledger root's folder, then sweep its backups when one exists. The one move
 * that init (per project) and the curation command (configure and the toggles, for
 * the current project) share. Takes every lock with no wait; never throws.
 */
export async function moveLedgerRoot(root: string, opts: SharedMoveOptions, io: SharedMoveIO): Promise<ProjectMoveOutcome> {
  const invalid = checkOptions(opts);
  if (invalid !== null) return { kind: 'error', root, message: invalid };
  return moveOne(root, opts, io);
}

/** Move one project's ledger folder, then sweep its backups when one exists. */
async function moveOne(root: string, opts: SharedMoveOptions, io: SharedMoveIO): Promise<ProjectMoveOutcome> {
  const storeOpts = (): LedgerMoveOptions => ({
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
  if (answer.state === 'busy') return answer.reason === 'claim' ? { kind: 'busy', root, reason: 'claim' } : { kind: 'busy', root };

  const sweep = await sweepIfBackup(root, io, storeOpts);
  if (answer.state === 'moved') {
    return { kind: 'moved', root, mode: answer.mode, backup: answer.backup, rendered: answer.rendered, notes: answer.notes, sweep };
  }
  return { kind: 'unchanged', root, sweep };
}

/** Run the backup sweep when `.devflow` holds a backup folder; answer null when there is nothing to report. */
async function sweepIfBackup(
  root: string,
  io: SharedMoveIO,
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

export function describeFailure(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ---------------------------------------------------------------------------
// The lines init prints
// ---------------------------------------------------------------------------

/** The lines for one project: none when it moved cleanly or had nothing to move. */
export function describeOutcome(outcome: ProjectMoveOutcome): string[] {
  const lines: string[] = [];
  switch (outcome.kind) {
    case 'busy':
      lines.push(outcome.reason === 'claim'
        ? `Ledger move skipped for ${describeMoveText(outcome.root)}: a queue claim holds the move. The project moves after Curate finishes.`
        : `Ledger move skipped for ${describeMoveText(outcome.root)}: a lock is held. The project moves at its next session.`);
      break;
    case 'refused':
      lines.push(`Ledger move refused for ${describeMoveText(outcome.root)}: ${describeMoveText(outcome.message)}. Nothing was changed.`);
      break;
    case 'error':
      lines.push(
        `Ledger move failed for ${describeMoveText(outcome.root)}: ${describeMoveText(outcome.message)}. ` +
        'Nothing was copied. The next init tries again.',
      );
      break;
    case 'skipped':
      lines.push(
        `Ledger move skipped for ${describeMoveText(outcome.root)}: git did not answer in time. ` +
        'Nothing was moved. The next init tries again.',
      );
      break;
    case 'moved':
      if (!outcome.rendered) {
        lines.push(`Ledger moved for ${describeMoveText(outcome.root)}, but the index was not rebuilt. The next ledger write rebuilds it.`);
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
      lines.push(`Backup merge stopped for ${describeMoveText(outcome.root)}: ${describeMoveText(sweep.message)}. The next init finishes it.`);
    } else if (sweep?.state === 'busy') {
      lines.push(`Backup merge skipped for ${describeMoveText(outcome.root)}: a lock is held. The next init tries again.`);
    }
  }
  return lines;
}

// ---------------------------------------------------------------------------
// The global tuning file
// ---------------------------------------------------------------------------

/** What sits at a path, without following a link: a regular file, anything else, nothing, or a probe that failed. */
export type TuningPathKind = 'file' | 'other' | 'absent' | 'error';

export type RenameIfAbsentResult =
  | { readonly state: 'renamed' }
  | { readonly state: 'exists' }
  | { readonly state: 'failed'; readonly message: string };

/** The I/O the global tuning file's rename uses. Every member is total: it answers a value and does not throw. */
export interface GlobalTuningMoveIO {
  kindOf(target: string): Promise<TuningPathKind>;
  /** Rename `from` to `to` unless `to` exists. Never replaces a file. */
  renameIfAbsent(from: string, to: string): Promise<RenameIfAbsentResult>;
}

export type GlobalTuningOutcome =
  | { readonly kind: 'none' }
  | { readonly kind: 'renamed' }
  | { readonly kind: 'kept-new' }
  | { readonly kind: 'left-alone' }
  | { readonly kind: 'error'; readonly message: string };

export interface GlobalTuningMoveReport {
  readonly outcome: GlobalTuningOutcome;
  /** One line when the outcome needs a word, else none. */
  readonly lines: readonly string[];
}

/**
 * Rename the global curate tuning file from its old name to the new one, inside the
 * machine directory. State-checked, never run-once: an old file with no new one is
 * renamed; with both present the new name wins, the old file stays and one line says
 * so; with no old file there is nothing to do. The rename never replaces a file, so
 * two inits at once cannot lose the new one. A link or another non-file under the old
 * name is left alone, never followed; one line says its settings no longer apply.
 */
export async function moveGlobalTuningFile(machineDir: string, io: GlobalTuningMoveIO): Promise<GlobalTuningMoveReport> {
  const oldPath = path.join(machineDir, LEGACY_NAMES.tuningFile);
  const newPath = getGlobalCurateTuningConfigPath(machineDir);
  const done = (outcome: GlobalTuningOutcome, ...lines: string[]): GlobalTuningMoveReport => ({ outcome, lines });

  const oldKind = await probeKind(oldPath, io);
  if (oldKind === 'absent') return done({ kind: 'none' });
  if (oldKind === 'error') {
    return done({ kind: 'error', message: 'the file could not be checked' },
      `The global tuning file ${oldPath} could not be checked. The next init tries again.`);
  }
  if (oldKind === 'other') {
    return done({ kind: 'left-alone' },
      `The global tuning file ${oldPath} is not a regular file. It was not renamed to ${CURATION_TUNING_FILE_NAME}, ` +
        `so its settings no longer apply. Copy them into ${CURATION_TUNING_FILE_NAME}.`);
  }

  const newKind = await probeKind(newPath, io);
  if (newKind === 'error') {
    return done({ kind: 'error', message: 'the new name could not be checked' },
      `The global tuning file ${newPath} could not be checked. The next init tries again.`);
  }
  if (newKind !== 'absent') return done({ kind: 'kept-new' }, keptNewLine(machineDir));

  let renamed: RenameIfAbsentResult;
  try {
    renamed = await io.renameIfAbsent(oldPath, newPath);
  } catch (error) {
    renamed = { state: 'failed', message: describeFailure(error) };
  }
  switch (renamed.state) {
    case 'renamed':
      return done({ kind: 'renamed' });
    case 'exists':
      return done({ kind: 'kept-new' }, keptNewLine(machineDir));
    case 'failed':
      return done({ kind: 'error', message: renamed.message },
        `The global tuning file ${oldPath} could not be renamed: ${renamed.message}. The next init tries again.`);
    default: {
      const unreachable: never = renamed;
      return unreachable;
    }
  }
}

async function probeKind(target: string, io: GlobalTuningMoveIO): Promise<TuningPathKind> {
  try {
    return await io.kindOf(target);
  } catch {
    return 'error';
  }
}

function keptNewLine(machineDir: string): string {
  return `Both ${LEGACY_NAMES.tuningFile} and ${CURATION_TUNING_FILE_NAME} exist in ${machineDir}. ` +
    `${CURATION_TUNING_FILE_NAME} is used, and ${LEGACY_NAMES.tuningFile} was left in place.`;
}

// ---------------------------------------------------------------------------
// The whole init step
// ---------------------------------------------------------------------------

export interface InitCurationMoveIO {
  /** The per-project move's I/O, or the reason the store could not be loaded (one line, not one per project). */
  readonly ledger: ProjectLedgerMoveIO | { readonly unavailable: string };
  readonly tuning: GlobalTuningMoveIO;
}

export interface InitCurationMoveReport {
  /** The lines init prints, in order: the tuning file first, then one for each project that did not move cleanly. */
  readonly lines: readonly string[];
  /** The move notice, printed once per run: set only when at least one project moved. */
  readonly notice: string | null;
  readonly movedCount: number;
}

/** The notice init prints once when a project moved. */
export function moveNotice(movedCount: number): string {
  return `Moved the curation data of ${movedCount} project${movedCount === 1 ? '' : 's'} ` +
    `from .devflow/${LEGACY_NAMES.folder}/ to .devflow/${CURATION_DIR_NAME}/. ` +
    'Where a project already had both folders, the old one was kept as a backup.';
}

/**
 * The init step: rename the global tuning file, then move every target project's
 * ledger folder. Answers lines and one notice; it never throws and never decides
 * init's exit code. A step that cannot run (bad options) becomes one line.
 */
export async function runInitCurationMove(
  opts: ProjectLedgerMoveOptions,
  io: InitCurationMoveIO,
): Promise<InitCurationMoveReport> {
  const lines: string[] = [];
  try {
    lines.push(...(await moveGlobalTuningFile(opts.machineDir, io.tuning)).lines);
  } catch (error) {
    lines.push(`The global tuning file was not renamed: ${describeFailure(error)}.`);
  }
  let movedCount = 0;
  if ('unavailable' in io.ledger) {
    lines.push(`The ledger move did not run: ${io.ledger.unavailable}. The next init tries again.`);
    return { lines, notice: null, movedCount };
  }
  try {
    const result = await moveProjectLedgers(opts, io.ledger);
    if (result.ok) {
      lines.push(...result.value.lines);
      movedCount = result.value.movedCount;
    } else {
      lines.push(`The ledger move did not run: ${result.error.message}.`);
    }
  } catch (error) {
    lines.push(`The ledger move did not run: ${describeMoveText(describeFailure(error))}.`);
  }
  return { lines, notice: movedCount > 0 ? moveNotice(movedCount) : null, movedCount };
}
