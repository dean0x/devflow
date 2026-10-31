import { promises as fs } from 'fs';
import type { BigIntStats } from 'fs';
import * as path from 'path';

import { isContainedIn } from '../../core/paths.js';
import { createPathSet, type PathSet, type RetiredSet, type ShippedSet } from '../../core/path-set.js';

/**
 * @file install-backup.ts
 *
 * The backup session of one install run: before a step removes files from a folder devflow
 * installs into, the session moves every file devflow did not ship out of that folder into a
 * run folder under `<devflowDir>/install-backups/`, and records what it moved, what it could
 * not move and what it removed.
 *
 * Nothing here deletes a file the user may own. Removal is limited to the entries the scan
 * listed as shipped, retired, a devflow leftover (sidecar) or `.DS_Store` junk, then a
 * non-recursive `rmdir`; a folder that still holds anything stays. The one other removal is a file
 * the caller names by its exact path from a frozen list of retired names
 * ({@link BackupSession.removeExact}). A move is a single `rename`:
 * no copy, so a rename that fails (another volume, no permission) leaves the file where it is.
 * Nothing is read through a link, and a special file is renamed, never opened.
 *
 * Failures are records in {@link BackupSession.snapshot}, never throws.
 *
 * This module imports only node builtins and `core/`. The installer and the converge steps import
 * it, so the shipped and retired sets reach it as {@link PathSet} inputs, a type that `core/path-set`
 * declares and this module re-exports.
 */

/** Entry cap for one walked known folder. */
export const DEFAULT_ENTRY_CAP = 10_000;

/** The deepest known folder a scan descends into, counting the scanned root as 0. */
export const MAX_WALK_DEPTH = 8;

/** Run folder names tried before the move step gives up. */
export const MAX_RUN_FOLDER_ATTEMPTS = 5;

/** The folder under the devflow dir that holds the run folders. */
export const BACKUP_ROOT_NAME = 'install-backups';

const BACKUP_DIR_MODE = 0o700;
const RUN_FOLDER_BYTES = 4;
const MAX_ANCESTOR_STEPS = 256;
const SHOWN_NAMES = 5;
const JUNK_FILE_NAME = '.DS_Store';
const COMPLIANCE_SKILL_SIDECAR = 'skills/devflow:compliance.tmp';

/**
 * What an interrupted write leaves after a file name: `.tmp.<pid>`, the temp file of the atomic
 * writers. No devflow code writes a file named `.old`, a bare `.tmp` or `.<pid>-<time>.tmp`, so a
 * file or a link with such a name is the user's.
 */
const FILE_SIDECAR_SUFFIX = /\.tmp\.\d+$/;

/**
 * What an interrupted swap leaves after a folder name: `.tmp`, `.old` and the reference overlay's
 * `.<pid>-<time>.tmp`. Every folder swap in the installer makes a folder.
 */
const DIRECTORY_SIDECAR_SUFFIX = /(?:\.\d+-[0-9a-z]+\.tmp|\.tmp|\.old)$/;

/**
 * The scratch folder of a pr-host or cross-cutting reference overlay unit, which sits in the
 * tracker references: `.<kind>.<slug>` with `.old` (the displaced copy of a directory unit) or
 * `.<pid>-<time>.tmp` (the staging tree). The installer makes the slug from the unit's folder with
 * `/` written as `-`, and `root` for the references folder. Group 1 is the references folder, group
 * 2 the slug.
 */
const OVERLAY_SCRATCH_FOLDER = /^(skills\/[^/]+\/references)\/tracker\/\.(?:pr-host|cross-cutting)\.([a-z0-9-]+)\.(?:\d+-[0-9a-z]+\.tmp|old)$/;
const OVERLAY_ROOT_SLUG = 'root';

/**
 * Scratch folders whose base name is no shipped path, matched on the whole path: the curation
 * swap and the workflow folder swap, which sit directly in the Claude dir, and the scratch of the
 * pr-host and cross-cutting reference overlay units.
 */
const SCRATCH_FOLDER_PATHS: readonly RegExp[] = [
  /^\.devflow-curation-\d+-[0-9a-z]+\.tmp(?:\.old)?$/,
  /^\.devflow-workflow-[a-z0-9._-]{1,64}-\d+-[A-Za-z0-9]{6}(?:\.old)?$/,
  OVERLAY_SCRATCH_FOLDER,
];
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/g;

export { createPathSet };
export type { PathSet, ShippedSet, RetiredSet };

/** What an entry is on disk, taken with `lstat`, so a link is a link. */
export type EntryKind = 'file' | 'directory' | 'link' | 'special';

/** What the scan does with an entry. */
export type Classification = 'shipped' | 'retired' | 'sidecar' | 'junk' | 'unknown';

/** The two sets {@link classify} reads. */
export interface ClassifySets {
  readonly shipped: ShippedSet;
  readonly retired: RetiredSet;
}

interface KindProbe {
  isSymbolicLink(): boolean;
  isDirectory(): boolean;
  isFile(): boolean;
}

function kindOf(probe: KindProbe): EntryKind {
  if (probe.isSymbolicLink()) return 'link';
  if (probe.isDirectory()) return 'directory';
  return probe.isFile() ? 'file' : 'special';
}

/**
 * Whether `rel` is named by `set`. A folder is named when the set holds it. A file or a special
 * file is named only when it is a listed file path. A link is named at a listed file path and at a
 * folder the set holds: it stands in the place of an entry devflow writes, and is unlinked as the
 * entry it is, never followed.
 */
function inSet(set: PathSet, rel: string, kind: EntryKind): boolean {
  switch (kind) {
    case 'directory':
    case 'link':
      return set.holds(rel);
    case 'file':
    case 'special':
      return set.files.has(rel);
    default: {
      const unreachable: never = kind;
      return unreachable;
    }
  }
}

/** The leftover suffix that devflow makes for an entry of this kind. */
function sidecarSuffixFor(kind: EntryKind): RegExp {
  switch (kind) {
    case 'directory':
      return DIRECTORY_SIDECAR_SUFFIX;
    case 'file':
    case 'link':
    case 'special':
      return FILE_SIDECAR_SUFFIX;
    default: {
      const unreachable: never = kind;
      return unreachable;
    }
  }
}

/** `rel` without the leftover suffix of its kind (see {@link sidecarSuffixFor}), or null when it has none. */
function sidecarBase(rel: string, kind: EntryKind): string | null {
  const base = rel.replace(sidecarSuffixFor(kind), '');
  return base === rel || base === '' ? null : base;
}

/**
 * The path that tells the entries of a leftover folder apart: the shipped path of the folder it was
 * made from. An overlay scratch folder holds the files of one unit (`.pr-host.pr` the `pr/` folder,
 * `.cross-cutting.tracker` the documents directly in `tracker/`, `.cross-cutting.root` those
 * directly in the references folder), so its entries are told apart as entries of that folder.
 * Another leftover folder is told apart by the name it copies, and any other folder by its own path.
 */
function leftoverLogicalPath(rel: string): string {
  const scratch = OVERLAY_SCRATCH_FOLDER.exec(rel);
  if (scratch !== null) {
    const [, references, slug] = scratch;
    return slug === OVERLAY_ROOT_SLUG ? references : `${references}/${slug.split('-').join('/')}`;
  }
  return sidecarBase(rel, 'directory') ?? rel;
}

function isSidecar(rel: string, kind: EntryKind, sets: ClassifySets): boolean {
  if (kind === 'directory' && (rel === COMPLIANCE_SKILL_SIDECAR || SCRATCH_FOLDER_PATHS.some(re => re.test(rel)))) {
    return true;
  }
  const base = sidecarBase(rel, kind);
  if (base === null) return false;
  return inSet(sets.shipped, base, kind) || inSet(sets.retired, base, kind);
}

/**
 * Decide what the scan does with the entry at `relPath` (relative to the Claude dir, `/`
 * separators). The order is fixed: shipped, retired, sidecar, junk, unknown. A name in both sets
 * is shipped. Only `.DS_Store` is junk, and only as a file; any other dot file is unknown.
 */
export function classify(relPath: string, kind: EntryKind, sets: ClassifySets): Classification {
  if (inSet(sets.shipped, relPath, kind)) return 'shipped';
  if (inSet(sets.retired, relPath, kind)) return 'retired';
  if (isSidecar(relPath, kind, sets)) return 'sidecar';
  if (kind === 'file' && relPath.split('/').pop() === JUNK_FILE_NAME) return 'junk';
  return 'unknown';
}

/** Print form of a file name: ESC, C0 and C1 control characters as `\xNN`. The file keeps its name. */
export function escapeName(name: string): string {
  return name.replace(CONTROL_CHARACTERS, ch => `\\x${ch.charCodeAt(0).toString(16).padStart(2, '0')}`);
}

/** `YYYYMMDDTHHMMSSZ-<8 hex>` from a UTC clock reading and four random bytes. Missing bytes read as zero. */
export function runFolderName(now: Date, bytes: Uint8Array): string {
  const two = (n: number): string => String(n).padStart(2, '0');
  const valid = !Number.isNaN(now.getTime());
  const stamp = valid
    ? `${String(now.getUTCFullYear()).padStart(4, '0')}${two(now.getUTCMonth() + 1)}${two(now.getUTCDate())}` +
      `T${two(now.getUTCHours())}${two(now.getUTCMinutes())}${two(now.getUTCSeconds())}Z`
    : '00000000T000000Z';
  const hex = Array.from(bytes.subarray(0, RUN_FOLDER_BYTES), b => b.toString(16).padStart(2, '0')).join('');
  return `${stamp}-${hex.padEnd(RUN_FOLDER_BYTES * 2, '0')}`;
}

/** The first five names (escaped) and `N more` for the rest, joined with commas. */
export function formatCappedList(names: readonly string[], shown: number = SHOWN_NAMES): string {
  const head = names.slice(0, shown).map(escapeName);
  const rest = names.length - head.length;
  return rest > 0 ? [...head, `${rest} more`].join(', ') : head.join(', ');
}

/** One unit the session moved: a file, a link or a whole folder, from `original` to `backup`. */
export interface MovedUnit {
  readonly original: string;
  readonly backup: string;
  readonly kind: EntryKind;
}

export type FailureAction = 'scan' | 'move' | 'remove';

/** Something the session could not do. The entry stays where it is. `reason` is an errno code or a short word. */
export interface FailureRecord {
  readonly path: string;
  readonly action: FailureAction;
  readonly reason: string;
}

/** A known folder with more entries than the cap. It stays whole: no move and no removal in it. */
export interface CapHit {
  readonly folder: string;
  readonly entries: number;
  readonly cap: number;
}

/** Why nothing moves in this run: the backup root or the run folder is unusable. */
export interface RootRefusal {
  readonly path: string;
  readonly reason: string;
}

export interface BackupSnapshot {
  readonly backupRoot: string;
  readonly runFolder: string | null;
  readonly moved: readonly MovedUnit[];
  /** Retired files the session removed. They are named, never moved. */
  readonly retiredRemoved: readonly string[];
  readonly failures: readonly FailureRecord[];
  readonly capHits: readonly CapHit[];
  readonly rootRefusal: RootRefusal | null;
}

export interface PrepassResult {
  readonly moved: readonly MovedUnit[];
  readonly failures: readonly FailureRecord[];
  readonly capHits: readonly CapHit[];
}

/**
 * One folder to scan, and which of its entries the scan may touch.
 *
 * `include` is asked about every entry the scan meets below `folder`, with the entry's path
 * relative to `folder` (`/` separators) and its kind. An entry it refuses is left alone whole: not
 * moved, not entered and not listed for removal, so a later {@link BackupSession.removeListed}
 * keeps it too. Without `include` the scan takes every entry.
 *
 * `displacedFrom` is for a folder that was renamed away from the place devflow ships it: the scan
 * tells its entries apart as if the folder still stood at that path, so the files devflow shipped
 * there are listed and the rest move. Entries it moves keep the path they have now.
 */
export interface PrepassTarget {
  readonly folder: string;
  readonly include?: (relative: string, kind: EntryKind) => boolean;
  readonly displacedFrom?: string;
}

export interface RemoveResult {
  /** The listed entries this call removed. */
  readonly removed: readonly string[];
  /** True when the folder is gone after the call. */
  readonly folderRemoved: boolean;
}

export type MoveWholeResult =
  | { readonly status: 'moved'; readonly unit: MovedUnit }
  | { readonly status: 'absent' }
  | { readonly status: 'kept'; readonly reason: string };

export type RemoveExactResult =
  | { readonly status: 'removed' }
  | { readonly status: 'absent' }
  | { readonly status: 'kept'; readonly reason: string };

export interface BackupSessionOptions {
  readonly shipped: ShippedSet;
  readonly retired: RetiredSet;
  readonly claudeDir: string;
  readonly devflowDir: string;
  readonly now: () => Date;
  readonly bytes: (size: number) => Uint8Array;
  readonly entryCap?: number;
}

export interface BackupSession {
  /** Scan each folder and move the entries devflow did not ship into the run folder. A folder below a link stays unscanned. */
  prepass(targets: ReadonlyArray<string | PrepassTarget>): Promise<PrepassResult>;
  /** Remove the entries the scan listed under `folder` and were not kept, then `rmdir` it and its scanned folders. */
  removeListed(folder: string): Promise<RemoveResult>;
  /** Move one entry whole with a single rename and no walk. An entry the session kept, one below a kept folder and one below a link stay. */
  moveWhole(entry: string): Promise<MoveWholeResult>;
  /**
   * Remove one file by its exact path and name it with the retired files. The caller takes the path
   * from a frozen list of names an earlier release installed; nothing here matches by pattern. The
   * path must lie in the Claude dir or the devflow dir, outside the backup root, below real
   * folders: a link at any path part between the install folder and the file refuses it. A link
   * at the file itself is unlinked, never followed. A folder, a path kept by an earlier failure and a
   * failed `unlink` stay as they are, and the failed `unlink` is recorded.
   */
  removeExact(file: string): Promise<RemoveExactResult>;
  /** Paths at or below `folder` that stay because their move failed, the folder was capped or could not be scanned. */
  keptUnder(folder: string): readonly string[];
  isKept(entry: string): boolean;
  classify(relPath: string, kind: EntryKind): Classification;
  /** {@link BackupSession.classify} for the entry at an absolute path; a path outside the Claude dir is unknown. */
  classifyAt(entry: string, kind: EntryKind): Classification;
  snapshot(): BackupSnapshot;
}

interface Identity {
  readonly dev: bigint;
  readonly ino: bigint;
}

interface ListedEntry {
  readonly path: string;
  readonly retired: boolean;
}

interface ScannedFolder {
  readonly path: string;
  readonly identity: Identity;
  readonly listed: ListedEntry[];
  readonly dirs: ScannedFolder[];
  readonly capped: boolean;
}

interface ReadyBackup {
  readonly runFolder: string;
}

type StatResult =
  | { readonly ok: true; readonly stats: BigIntStats }
  | { readonly ok: false; readonly code: string };

type MoveOutcome =
  | { readonly status: 'moved'; readonly unit: MovedUnit }
  | { readonly status: 'vanished' }
  | { readonly status: 'kept'; readonly reason: string };

function errnoCode(err: unknown): string {
  const code = typeof err === 'object' && err !== null ? (err as { code?: unknown }).code : undefined;
  return typeof code === 'string' ? code : 'UNKNOWN';
}

async function lstatBig(target: string): Promise<StatResult> {
  try {
    return { ok: true, stats: await fs.lstat(target, { bigint: true }) };
  } catch (err) {
    return { ok: false, code: errnoCode(err) };
  }
}

const sameIdentity = (a: Identity, b: Identity): boolean => a.dev === b.dev && a.ino === b.ino;

const toPosix = (rel: string): string => rel.split(path.sep).join('/');

const freezeList = <T>(items: readonly T[]): readonly T[] => Object.freeze(items.slice());

const wholeResult = (result: MoveWholeResult): MoveWholeResult => Object.freeze(result);

const exactResult = (result: RemoveExactResult): RemoveExactResult => Object.freeze(result);

function exhaustive(value: never): void {
  void value;
}

const shownPath = (value: string): string => (value === '' ? '(empty)' : value);

/**
 * Why a session over these two folders must change nothing, or null. Both folders must be absolute:
 * `path.resolve` turns an empty or relative path into the working directory. The backup root must
 * neither lie inside the Claude dir nor hold it, or a move would put a file inside the folder it
 * leaves, or sweep the backup folder itself.
 */
function sessionPathsFault(claudeDirOption: string, devflowDirOption: string): RootRefusal | null {
  if (!path.isAbsolute(claudeDirOption)) {
    return Object.freeze({ path: shownPath(claudeDirOption), reason: 'claude-dir-not-absolute' });
  }
  if (!path.isAbsolute(devflowDirOption)) {
    return Object.freeze({ path: shownPath(devflowDirOption), reason: 'devflow-dir-not-absolute' });
  }
  const claude = path.resolve(claudeDirOption);
  const root = path.join(path.resolve(devflowDirOption), BACKUP_ROOT_NAME);
  if (root === claude || isContainedIn(claude, root) || isContainedIn(root, claude)) {
    return Object.freeze({ path: root, reason: 'backup-root-overlaps-claude-dir' });
  }
  return null;
}

type AncestorCheck = { readonly ok: true } | { readonly ok: false; readonly reason: string };

/**
 * Open a backup session for one install run.
 *
 * The backup root and the run folder are made when the first move is ready to rename, after the
 * checks of its source. A move that fails removes the parent folders it made, and a run folder
 * that holds no move is removed again with the backup root this session made, each with a
 * non-recursive `rmdir`, so a run that moves nothing leaves nothing behind. One session holds at
 * most one run folder.
 *
 * A session whose folders fail {@link sessionPathsFault} changes nothing: it reports the fault as
 * the root refusal, and every step records the fault and keeps its path.
 *
 * Every step that changes a path also refuses a target with a link at a path part between the
 * install folder (the Claude dir or the devflow dir, which may be a link) and the target, with the
 * reason `linked-ancestor`. The containment checks compare paths as text and do not see such a link.
 */
export function createBackupSession(options: BackupSessionOptions): BackupSession {
  const claudeDir = path.resolve(options.claudeDir);
  const devflowDir = path.resolve(options.devflowDir);
  const backupRoot = path.join(devflowDir, BACKUP_ROOT_NAME);
  const pathsFault = sessionPathsFault(options.claudeDir, options.devflowDir);
  const sets: ClassifySets = { shipped: options.shipped, retired: options.retired };
  const requestedCap = options.entryCap ?? DEFAULT_ENTRY_CAP;
  const entryCap = Number.isInteger(requestedCap) && requestedCap > 0 ? requestedCap : DEFAULT_ENTRY_CAP;

  const scanned = new Map<string, ScannedFolder>();
  const kept = new Set<string>();
  const moved: MovedUnit[] = [];
  const retiredRemoved: string[] = [];
  const failures: FailureRecord[] = [];
  const failureKeys = new Set<string>();
  const capHits: CapHit[] = [];
  const capKeys = new Set<string>();
  let rootRefusal: RootRefusal | null = pathsFault;
  let runFolder: string | null = null;
  let rootMade = false;
  let backup: Promise<ReadyBackup | null> | null = null;

  const relFromClaude = (target: string): string => toPosix(path.relative(claudeDir, target));

  function fail(target: string, action: FailureAction, reason: string, keep = true): void {
    if (keep) kept.add(target);
    const key = `${action}:${target}`;
    if (failureKeys.has(key)) return;
    failureKeys.add(key);
    failures.push(Object.freeze({ path: target, action, reason }));
  }

  function refuse(reason: string, at: string): null {
    rootRefusal = Object.freeze({ path: at, reason });
    return null;
  }

  /** `rmdir` without recursion. True when the folder is gone; false when it holds something or could not go. */
  async function removeEmptyFolder(target: string): Promise<boolean> {
    try {
      await fs.rmdir(target);
      return true;
    } catch (err) {
      const code = errnoCode(err);
      if (code === 'ENOENT') return true;
      if (code !== 'ENOTEMPTY' && code !== 'EEXIST') fail(target, 'remove', code, false);
      return false;
    }
  }

  async function dropMadeRoot(): Promise<void> {
    if (rootMade && (await removeEmptyFolder(backupRoot))) rootMade = false;
  }

  async function refuseOpening(reason: string, at: string): Promise<null> {
    await dropMadeRoot();
    return refuse(reason, at);
  }

  async function openBackup(): Promise<ReadyBackup | null> {
    const existing = await lstatBig(backupRoot);
    if (existing.ok) {
      if (existing.stats.isSymbolicLink()) return refuse('link', backupRoot);
      if (!existing.stats.isDirectory()) return refuse('not-a-directory', backupRoot);
    } else if (existing.code !== 'ENOENT') {
      return refuse(existing.code, backupRoot);
    } else {
      try {
        await fs.mkdir(backupRoot, { recursive: true, mode: BACKUP_DIR_MODE });
        rootMade = true;
      } catch (err) {
        return refuse(errnoCode(err), backupRoot);
      }
    }
    for (let attempt = 0; attempt < MAX_RUN_FOLDER_ATTEMPTS; attempt++) {
      const candidate = path.join(backupRoot, runFolderName(options.now(), options.bytes(RUN_FOLDER_BYTES)));
      try {
        await fs.mkdir(candidate, { mode: BACKUP_DIR_MODE });
        runFolder = candidate;
        return { runFolder: candidate };
      } catch (err) {
        const code = errnoCode(err);
        if (code !== 'EEXIST') return refuseOpening(code, candidate);
      }
    }
    return refuseOpening('run-folder-collisions', backupRoot);
  }

  function ensureBackup(): Promise<ReadyBackup | null> {
    backup ??= pathsFault === null ? openBackup() : Promise.resolve(null);
    return backup;
  }

  /** The install folder that holds `target`: the Claude dir first, then the devflow dir. */
  function installRootOf(target: string): string | null {
    if (isContainedIn(claudeDir, target)) return claudeDir;
    return isContainedIn(devflowDir, target) ? devflowDir : null;
  }

  /**
   * Walk up from `target` to its install folder, both left out, and refuse a link at any step. An
   * ancestor that is absent passes, as the target below it is then absent too. One that cannot be
   * inspected, and a walk that ends at the step bound, refuse.
   */
  async function checkAncestors(target: string): Promise<AncestorCheck> {
    const root = installRootOf(target);
    if (root === null) return { ok: false, reason: 'outside-install-dirs' };
    let current = path.dirname(target);
    for (let step = 0; step < MAX_ANCESTOR_STEPS; step++) {
      if (!isContainedIn(root, current)) return { ok: true };
      const probe = await lstatBig(current);
      if (probe.ok) {
        if (probe.stats.isSymbolicLink()) return { ok: false, reason: 'linked-ancestor' };
      } else if (probe.code !== 'ENOENT') {
        return { ok: false, reason: probe.code };
      }
      current = path.dirname(current);
    }
    return { ok: false, reason: 'ancestor-depth-bound' };
  }

  /**
   * Remove the run folder, and the backup root this session made, when no move succeeded. A
   * folder that holds anything stays, and the next move reuses it.
   */
  async function releaseEmptyRun(): Promise<void> {
    if (moved.length > 0 || runFolder === null) return;
    if (!(await removeEmptyFolder(runFolder))) return;
    runFolder = null;
    backup = null;
    await dropMadeRoot();
  }

  /**
   * Make the folders of `parent` that are missing below `runDir`, one `mkdir` each from the top.
   * `made` lists the folders this call made, top first, also when a later `mkdir` failed.
   */
  async function makeMissingParents(parent: string, runDir: string): Promise<{ made: string[]; code: string | null }> {
    const missing: string[] = [];
    let current = parent;
    for (let step = 0; step < MAX_ANCESTOR_STEPS && isContainedIn(runDir, current); step++) {
      const probe = await lstatBig(current);
      if (probe.ok) break;
      if (probe.code !== 'ENOENT') return { made: [], code: probe.code };
      missing.push(current);
      current = path.dirname(current);
    }
    const made: string[] = [];
    for (const folder of [...missing].reverse()) {
      try {
        await fs.mkdir(folder, { mode: BACKUP_DIR_MODE });
        made.push(folder);
      } catch (err) {
        return { made, code: errnoCode(err) };
      }
    }
    return { made, code: null };
  }

  /** `rmdir` the folders a failed move made, deepest first, up to the first one that holds something. */
  async function removeMadeParents(made: readonly string[]): Promise<void> {
    for (const folder of [...made].reverse()) {
      if (!(await removeEmptyFolder(folder))) return;
    }
  }

  async function placeInRun(source: string, kind: EntryKind, runDir: string): Promise<MoveOutcome> {
    const destination = path.join(runDir, ...relFromClaude(source).split('/'));
    if (!isContainedIn(runDir, destination)) {
      fail(source, 'move', 'outside-run-folder');
      return { status: 'kept', reason: 'outside-run-folder' };
    }
    const occupied = await lstatBig(destination);
    if (occupied.ok || occupied.code !== 'ENOENT') {
      const reason = occupied.ok ? 'destination-exists' : occupied.code;
      fail(source, 'move', reason);
      return { status: 'kept', reason };
    }

    const parents = await makeMissingParents(path.dirname(destination), runDir);
    let failure = parents.code;
    if (failure === null) {
      try {
        await fs.rename(source, destination);
      } catch (err) {
        failure = errnoCode(err);
      }
    }
    if (failure !== null) {
      fail(source, 'move', failure);
      await removeMadeParents(parents.made);
      return { status: 'kept', reason: failure };
    }
    const unit: MovedUnit = Object.freeze({ original: source, backup: destination, kind });
    kept.delete(source);
    moved.push(unit);
    return { status: 'moved', unit };
  }

  async function moveUnit(source: string, scanRoot: string, atScan: BigIntStats): Promise<MoveOutcome> {
    if (!isContainedIn(scanRoot, source) || !isContainedIn(claudeDir, source)) {
      fail(source, 'move', 'outside-scan-root');
      return { status: 'kept', reason: 'outside-scan-root' };
    }
    const current = await lstatBig(source);
    if (!current.ok) {
      if (current.code === 'ENOENT') return { status: 'vanished' };
      fail(source, 'move', current.code);
      return { status: 'kept', reason: current.code };
    }
    if (!sameIdentity(current.stats, atScan)) {
      fail(source, 'move', 'changed-since-scan');
      return { status: 'kept', reason: 'changed-since-scan' };
    }

    const ready = await ensureBackup();
    if (ready === null) {
      kept.add(source);
      return { status: 'kept', reason: rootRefusal?.reason ?? 'backup-unavailable' };
    }
    const outcome = await placeInRun(source, kindOf(current.stats), ready.runFolder);
    if (outcome.status !== 'moved') await releaseEmptyRun();
    return outcome;
  }

  async function scanFolder(
    dirPath: string,
    logicalRel: string,
    depth: number,
    scanRoot: string,
    include: PrepassTarget['include'],
  ): Promise<ScannedFolder | null> {
    if (depth > MAX_WALK_DEPTH) {
      fail(dirPath, 'scan', 'depth-bound');
      return null;
    }
    const own = await lstatBig(dirPath);
    if (!own.ok) {
      if (own.code !== 'ENOENT') fail(dirPath, 'scan', own.code);
      return null;
    }
    if (!own.stats.isDirectory()) {
      fail(dirPath, 'scan', 'not-a-real-folder');
      return null;
    }
    const identity: Identity = { dev: own.stats.dev, ino: own.stats.ino };

    let entries;
    try {
      entries = await fs.readdir(dirPath, { withFileTypes: true });
    } catch (err) {
      fail(dirPath, 'scan', errnoCode(err));
      return null;
    }
    if (entries.length > entryCap) {
      kept.add(dirPath);
      if (!capKeys.has(dirPath)) {
        capKeys.add(dirPath);
        capHits.push(Object.freeze({ folder: dirPath, entries: entries.length, cap: entryCap }));
      }
      const whole: ScannedFolder = { path: dirPath, identity, listed: [], dirs: [], capped: true };
      scanned.set(dirPath, whole);
      return whole;
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

    const folder: ScannedFolder = { path: dirPath, identity, listed: [], dirs: [], capped: false };
    scanned.set(dirPath, folder);
    const toMove: Array<{ readonly path: string; readonly stats: BigIntStats }> = [];

    for (const entry of entries) {
      const childPath = path.join(dirPath, entry.name);
      const childLogical = logicalRel === '' ? entry.name : `${logicalRel}/${entry.name}`;
      const kind = kindOf(entry);
      if (include !== undefined && !include(toPosix(path.relative(scanRoot, childPath)), kind)) continue;
      const verdict = classify(childLogical, kind, sets);
      switch (verdict) {
        case 'shipped':
        case 'retired': {
          if (kind === 'directory') {
            const sub = await scanFolder(childPath, childLogical, depth + 1, scanRoot, include);
            if (sub !== null) folder.dirs.push(sub);
          } else {
            folder.listed.push({ path: childPath, retired: verdict === 'retired' });
          }
          break;
        }
        case 'sidecar': {
          if (kind === 'directory') {
            const sub = await scanFolder(childPath, leftoverLogicalPath(childLogical), depth + 1, scanRoot, include);
            if (sub !== null) folder.dirs.push(sub);
          } else {
            folder.listed.push({ path: childPath, retired: false });
          }
          break;
        }
        case 'junk':
          folder.listed.push({ path: childPath, retired: false });
          break;
        case 'unknown': {
          const found = await lstatBig(childPath);
          if (found.ok) toMove.push({ path: childPath, stats: found.stats });
          else if (found.code !== 'ENOENT') fail(childPath, 'scan', found.code);
          break;
        }
        default:
          exhaustive(verdict);
      }
    }

    for (const unit of toMove) {
      await moveUnit(unit.path, scanRoot, unit.stats);
    }
    return folder;
  }

  async function prepass(targets: ReadonlyArray<string | PrepassTarget>): Promise<PrepassResult> {
    const movedBefore = moved.length;
    const failuresBefore = failures.length;
    const capsBefore = capHits.length;
    for (const target of targets) {
      const { folder, include, displacedFrom } = typeof target === 'string' ? { folder: target, include: undefined, displacedFrom: undefined } : target;
      const absolute = path.resolve(folder);
      const stoodAt = displacedFrom === undefined ? absolute : path.resolve(displacedFrom);
      if (pathsFault !== null) {
        fail(absolute, 'scan', pathsFault.reason);
        continue;
      }
      if (!isContainedIn(claudeDir, absolute) || !isContainedIn(claudeDir, stoodAt)) {
        fail(absolute, 'scan', 'outside-claude-dir');
        continue;
      }
      const ancestors = await checkAncestors(absolute);
      if (!ancestors.ok) {
        fail(absolute, 'scan', ancestors.reason);
        continue;
      }
      const rel = relFromClaude(stoodAt);
      const logical = classify(rel, 'directory', sets) === 'sidecar' ? leftoverLogicalPath(rel) : rel;
      await scanFolder(absolute, logical, 0, absolute, include);
    }
    return Object.freeze({
      moved: freezeList(moved.slice(movedBefore)),
      failures: freezeList(failures.slice(failuresBefore)),
      capHits: freezeList(capHits.slice(capsBefore)),
    });
  }

  async function removeFolder(folder: ScannedFolder, removed: string[]): Promise<boolean> {
    if (folder.capped) return false;
    const current = await lstatBig(folder.path);
    if (!current.ok) {
      if (current.code === 'ENOENT') return true;
      fail(folder.path, 'remove', current.code);
      return false;
    }
    if (!sameIdentity(current.stats, folder.identity)) {
      fail(folder.path, 'remove', 'changed-since-scan');
      return false;
    }
    for (const entry of folder.listed) {
      if (kept.has(entry.path)) continue;
      try {
        await fs.unlink(entry.path);
        removed.push(entry.path);
        if (entry.retired) retiredRemoved.push(entry.path);
      } catch (err) {
        const code = errnoCode(err);
        if (code !== 'ENOENT') fail(entry.path, 'remove', code);
      }
    }
    for (const sub of folder.dirs) {
      await removeFolder(sub, removed);
    }
    try {
      await fs.rmdir(folder.path);
      return true;
    } catch (err) {
      const code = errnoCode(err);
      if (code === 'ENOENT') return true;
      if (code !== 'ENOTEMPTY' && code !== 'EEXIST') fail(folder.path, 'remove', code);
      return false;
    }
  }

  async function removeListed(folder: string): Promise<RemoveResult> {
    const target = path.resolve(folder);
    const removed: string[] = [];
    const known = scanned.get(target);
    if (known === undefined) {
      const state = await lstatBig(target);
      return Object.freeze({ removed: freezeList(removed), folderRemoved: !state.ok && state.code === 'ENOENT' });
    }
    const ancestors = await checkAncestors(target);
    if (!ancestors.ok) {
      fail(target, 'remove', ancestors.reason);
      return Object.freeze({ removed: freezeList(removed), folderRemoved: false });
    }
    const folderRemoved = await removeFolder(known, removed);
    return Object.freeze({ removed: freezeList(removed), folderRemoved });
  }

  async function moveWhole(entry: string): Promise<MoveWholeResult> {
    const source = path.resolve(entry);
    if (pathsFault !== null) {
      fail(source, 'move', pathsFault.reason);
      return wholeResult({ status: 'kept', reason: pathsFault.reason });
    }
    if (!isContainedIn(claudeDir, source)) {
      fail(source, 'move', 'outside-claude-dir');
      return wholeResult({ status: 'kept', reason: 'outside-claude-dir' });
    }
    if (isKept(source)) return wholeResult({ status: 'kept', reason: 'kept-by-earlier-failure' });
    const ancestors = await checkAncestors(source);
    if (!ancestors.ok) {
      fail(source, 'move', ancestors.reason);
      return wholeResult({ status: 'kept', reason: ancestors.reason });
    }
    const found = await lstatBig(source);
    if (!found.ok) {
      if (found.code === 'ENOENT') return wholeResult({ status: 'absent' });
      fail(source, 'move', found.code);
      return wholeResult({ status: 'kept', reason: found.code });
    }
    const outcome = await moveUnit(source, claudeDir, found.stats);
    switch (outcome.status) {
      case 'moved':
        return wholeResult({ status: 'moved', unit: outcome.unit });
      case 'vanished':
        return wholeResult({ status: 'absent' });
      case 'kept':
        return wholeResult({ status: 'kept', reason: outcome.reason });
    }
  }

  async function removeExact(file: string): Promise<RemoveExactResult> {
    const target = path.resolve(file);
    if (pathsFault !== null) {
      fail(target, 'remove', pathsFault.reason);
      return exactResult({ status: 'kept', reason: pathsFault.reason });
    }
    const inInstallDirs = isContainedIn(claudeDir, target) || isContainedIn(devflowDir, target);
    if (!inInstallDirs || isContainedIn(backupRoot, target)) {
      fail(target, 'remove', 'outside-install-dirs');
      return exactResult({ status: 'kept', reason: 'outside-install-dirs' });
    }
    if (isKept(target)) return exactResult({ status: 'kept', reason: 'kept-by-earlier-failure' });

    const parent = await lstatBig(path.dirname(target));
    if (!parent.ok) {
      if (parent.code === 'ENOENT') return exactResult({ status: 'absent' });
      fail(target, 'remove', parent.code);
      return exactResult({ status: 'kept', reason: parent.code });
    }
    if (!parent.stats.isDirectory()) {
      fail(target, 'remove', 'parent-not-a-folder');
      return exactResult({ status: 'kept', reason: 'parent-not-a-folder' });
    }
    const ancestors = await checkAncestors(target);
    if (!ancestors.ok) {
      fail(target, 'remove', ancestors.reason);
      return exactResult({ status: 'kept', reason: ancestors.reason });
    }
    const found = await lstatBig(target);
    if (!found.ok) {
      if (found.code === 'ENOENT') return exactResult({ status: 'absent' });
      fail(target, 'remove', found.code);
      return exactResult({ status: 'kept', reason: found.code });
    }
    if (found.stats.isDirectory()) return exactResult({ status: 'kept', reason: 'is-a-folder' });

    try {
      await fs.unlink(target);
    } catch (err) {
      const code = errnoCode(err);
      if (code === 'ENOENT') return exactResult({ status: 'absent' });
      fail(target, 'remove', code);
      return exactResult({ status: 'kept', reason: code });
    }
    retiredRemoved.push(target);
    return exactResult({ status: 'removed' });
  }

  function keptUnder(folder: string): readonly string[] {
    const base = path.resolve(folder);
    const inside = [...kept].filter(entry => entry === base || entry.startsWith(base + path.sep));
    return freezeList(inside.sort());
  }

  function isKept(entry: string): boolean {
    let current = path.resolve(entry);
    for (let step = 0; step < MAX_ANCESTOR_STEPS; step++) {
      if (kept.has(current)) return true;
      const parent = path.dirname(current);
      if (parent === current || current === claudeDir) return false;
      current = parent;
    }
    return false;
  }

  function snapshot(): BackupSnapshot {
    return Object.freeze({
      backupRoot,
      runFolder,
      moved: freezeList(moved),
      retiredRemoved: freezeList(retiredRemoved),
      failures: freezeList(failures),
      capHits: freezeList(capHits),
      rootRefusal,
    });
  }

  return Object.freeze({
    prepass,
    removeListed,
    moveWhole,
    removeExact,
    keptUnder,
    isKept,
    classify: (relPath: string, kind: EntryKind): Classification => classify(relPath, kind, sets),
    classifyAt: (entry: string, kind: EntryKind): Classification => {
      const absolute = path.resolve(entry);
      return isContainedIn(claudeDir, absolute) ? classify(relFromClaude(absolute), kind, sets) : 'unknown';
    },
    snapshot,
  });
}
