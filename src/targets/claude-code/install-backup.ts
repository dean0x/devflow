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
 * non-recursive `rmdir`; a folder that still holds anything stays. A move is a single `rename`:
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

/** What an interrupted write or swap leaves after a name: `.tmp`, `.tmp.<pid>`, `.old` and the overlay's `.<pid>-<time>.tmp`. */
const SIDECAR_SUFFIX = /(?:\.\d+-[0-9a-z]+\.tmp|\.tmp(?:\.\d+)?|\.old)$/;

/**
 * Scratch folders whose base name is no shipped path, matched on the whole path: the curation
 * swap and the workflow folder swap, which sit directly in the Claude dir, and the scratch of the
 * pr-host and cross-cutting reference overlay units, which sits in the tracker references.
 */
const SCRATCH_FOLDER_PATHS: readonly RegExp[] = [
  /^\.devflow-curation-\d+-[0-9a-z]+\.tmp(?:\.old)?$/,
  /^\.devflow-workflow-[a-z0-9._-]{1,64}-\d+-[A-Za-z0-9]{6}(?:\.old)?$/,
  /^skills\/[^/]+\/references\/tracker\/\.(?:pr-host|cross-cutting)\.[a-z0-9-]+\.(?:\d+-[0-9a-z]+\.tmp|old)$/,
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

/** `rel` without its leftover suffix (see {@link SIDECAR_SUFFIX}), or null when it has none. */
function sidecarBase(rel: string): string | null {
  const base = rel.replace(SIDECAR_SUFFIX, '');
  return base === rel || base === '' ? null : base;
}

function isSidecar(rel: string, kind: EntryKind, sets: ClassifySets): boolean {
  if (kind === 'directory' && (rel === COMPLIANCE_SKILL_SIDECAR || SCRATCH_FOLDER_PATHS.some(re => re.test(rel)))) {
    return true;
  }
  const base = sidecarBase(rel);
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
  /** Scan each folder and move the entries devflow did not ship into the run folder. */
  prepass(targets: ReadonlyArray<string | PrepassTarget>): Promise<PrepassResult>;
  /** Remove the entries the scan listed under `folder` and were not kept, then `rmdir` it and its scanned folders. */
  removeListed(folder: string): Promise<RemoveResult>;
  /** Move one entry whole with a single rename and no walk. */
  moveWhole(entry: string): Promise<MoveWholeResult>;
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

function exhaustive(value: never): void {
  void value;
}

/**
 * Open a backup session for one install run.
 *
 * The backup root and the run folder are made when the first move happens, so a run that moves
 * nothing leaves nothing behind. One session makes at most one run folder.
 */
export function createBackupSession(options: BackupSessionOptions): BackupSession {
  const claudeDir = path.resolve(options.claudeDir);
  const backupRoot = path.join(path.resolve(options.devflowDir), BACKUP_ROOT_NAME);
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
  let rootRefusal: RootRefusal | null = null;
  let runFolder: string | null = null;
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
        if (code !== 'EEXIST') return refuse(code, candidate);
      }
    }
    return refuse('run-folder-collisions', backupRoot);
  }

  function ensureBackup(): Promise<ReadyBackup | null> {
    backup ??= openBackup();
    return backup;
  }

  async function moveUnit(source: string, scanRoot: string, atScan: BigIntStats): Promise<MoveOutcome> {
    if (!isContainedIn(scanRoot, source) || !isContainedIn(claudeDir, source)) {
      fail(source, 'move', 'outside-scan-root');
      return { status: 'kept', reason: 'outside-scan-root' };
    }
    const ready = await ensureBackup();
    if (ready === null) {
      kept.add(source);
      return { status: 'kept', reason: rootRefusal?.reason ?? 'backup-unavailable' };
    }
    const destination = path.join(ready.runFolder, ...relFromClaude(source).split('/'));
    if (!isContainedIn(ready.runFolder, destination)) {
      fail(source, 'move', 'outside-run-folder');
      return { status: 'kept', reason: 'outside-run-folder' };
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

    const occupied = await lstatBig(destination);
    if (occupied.ok || occupied.code !== 'ENOENT') {
      const reason = occupied.ok ? 'destination-exists' : occupied.code;
      fail(source, 'move', reason);
      return { status: 'kept', reason };
    }

    try {
      await fs.mkdir(path.dirname(destination), { recursive: true, mode: BACKUP_DIR_MODE });
      await fs.rename(source, destination);
    } catch (err) {
      const reason = errnoCode(err);
      fail(source, 'move', reason);
      return { status: 'kept', reason };
    }
    const unit: MovedUnit = Object.freeze({ original: source, backup: destination, kind: kindOf(current.stats) });
    kept.delete(source);
    moved.push(unit);
    return { status: 'moved', unit };
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
            const sub = await scanFolder(childPath, sidecarBase(childLogical) ?? childLogical, depth + 1, scanRoot, include);
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
      if (!isContainedIn(claudeDir, absolute) || !isContainedIn(claudeDir, stoodAt)) {
        fail(absolute, 'scan', 'outside-claude-dir');
        continue;
      }
      const rel = relFromClaude(stoodAt);
      const logical = classify(rel, 'directory', sets) === 'sidecar' ? sidecarBase(rel) ?? rel : rel;
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
    const folderRemoved = await removeFolder(known, removed);
    return Object.freeze({ removed: freezeList(removed), folderRemoved });
  }

  async function moveWhole(entry: string): Promise<MoveWholeResult> {
    const source = path.resolve(entry);
    if (!isContainedIn(claudeDir, source)) {
      fail(source, 'move', 'outside-claude-dir');
      return wholeResult({ status: 'kept', reason: 'outside-claude-dir' });
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
