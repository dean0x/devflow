// tests/decisions/curation-move.test.ts
//
// The one-time ledger move: moveLedger renames a project's old ledger folder to
// the new name, or merges it into a new folder that already exists, and
// sweepLedgerBackups merges what is left in the backup the move leaves behind.
// Both live in the move module (hooks/lib/curation-move.cjs). They take no folder
// names: the old and new folders are the two names the path helpers hold, and the
// journal, the backup prefix, the tuning file and the locks stand on the same pair.
// Every test builds its own project and its own machine directory in a
// temp tree: nothing reads or writes the real HOME or a real project.
//
// A "crash" is simulated by making one fs call fail, the way an I/O error would
// stop the process between two renames; the rerun then runs with the real fs.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'module';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { spawnSync } from 'child_process';

import {
  GIT_ENV, JSON_HELPER, CURATION_STORE, CURATION_MOVE, PROJECT_PATHS, git, makeV2LedgerRow, makeV2LogRow, toJsonl,
} from './curation-fixtures.js';

// ---------------------------------------------------------------------------
// The move module's surface, and the store's guard, as the tests call them
// ---------------------------------------------------------------------------

type Res<T> = { ok: true; value: T } | { ok: false; error: { kind: string; message: string } };

interface MoveOpts {
  machineDir?: string;
  homeDir?: string;
  now?: number;
}

type MovedMode = 'whole-folder' | 'kept-new' | 'moved-in';

type MoveValue =
  | { state: 'none'; notes: string[] }
  | { state: 'busy'; reason?: 'claim'; notes: string[] }
  | { state: 'moved'; mode: MovedMode; backup: string | null; rendered: boolean; notes: string[] };

interface SweepValue {
  state: 'none' | 'busy' | 'swept';
  files: number;
  merged: number;
  overflowed: number;
  notes: string[];
}

interface Mover {
  moveLedger(root: unknown, opts: MoveOpts): Res<MoveValue>;
  sweepLedgerBackups(root: string, opts: MoveOpts): Res<SweepValue>;
  backupPendingRows(root: string): Res<{ backups: Array<{ name: string; pendingRows: number }> }>;
  QUEUE_MERGE_CAP_LINES: number;
}

interface Store {
  withDecisionsLock(opName: string, root: string, fn: () => Res<null>): Res<null>;
  CLAIM_STALE_SECS: number;
}

const nodeRequire = createRequire(import.meta.url);
const mover = nodeRequire(CURATION_MOVE) as Mover;
const store = nodeRequire(CURATION_STORE) as Store;
const { curationMoveLockKey } = nodeRequire(PROJECT_PATHS) as { curationMoveLockKey(realRoot: string): string };
/** The fs module object the store calls into: a spy on it reaches the store. */
const nodeFs = nodeRequire('fs') as typeof fs;
/** The child_process module object the move calls git through: a spy on it reaches the move. */
const nodeChildProcess = nodeRequire('child_process') as typeof import('child_process');
/** The crypto module object the move draws its name tails from: a spy on it reaches the move. */
const nodeCrypto = nodeRequire('crypto') as typeof import('crypto');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const OLD = 'learning';
const NEW = 'curation';

const LOG = 'decisions-log.jsonl';
const ARCHIVE = 'decisions-log.archive.jsonl';
const HISTORY = 'decisions-history.jsonl';
const LEDGER = 'decisions-ledger.jsonl';
const QUEUE = '.pending-turns.jsonl';
const CLAIM = '.pending-turns.processing';
const OWNER = '.pending-turns.owner';

interface Site {
  tmp: string;
  home: string;
  machineDir: string;
  root: string;
  devflow: string;
  oldDir: string;
  newDir: string;
}

let site: Site;

beforeEach(() => {
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'curation-move-')));
  const home = path.join(tmp, 'home');
  const root = path.join(tmp, 'project');
  fs.mkdirSync(home);
  fs.mkdirSync(root);
  const devflow = path.join(root, '.devflow');
  site = {
    tmp,
    home,
    machineDir: path.join(home, '.devflow'),
    root,
    devflow,
    oldDir: path.join(devflow, OLD),
    newDir: path.join(devflow, NEW),
  };
  // The store's write guard finds the machine-side move journal under $HOME/.devflow.
  vi.stubEnv('HOME', home);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  fs.rmSync(site.tmp, { recursive: true, force: true });
});

/** The options a move takes: the site's directories, plus overrides. */
function opts(extra: MoveOpts = {}): MoveOpts {
  return { machineDir: site.machineDir, homeDir: site.home, ...extra };
}

function move(extra: MoveOpts = {}): Res<MoveValue> {
  return mover.moveLedger(site.root, opts(extra));
}

/** A move that must succeed. */
function movedValue(extra: MoveOpts = {}): Extract<MoveValue, { state: 'moved' }> {
  const result = move(extra);
  if (!result.ok) throw new Error(`the move failed: ${result.error.message}`);
  if (result.value.state !== 'moved') throw new Error(`expected a move, got ${result.value.state}`);
  return result.value;
}

/** A move that must have stopped with an error result. */
function failure(extra: MoveOpts = {}): { kind: string; message: string } {
  const result = move(extra);
  if (result.ok) throw new Error(`expected an error, got ${JSON.stringify(result.value)}`);
  return result.error;
}

/** Write `files` (name to content) into `dir`, creating it. Content `null` makes a folder. */
function seed(dir: string, files: Record<string, string | null>): void {
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    const file = path.join(dir, name);
    if (content === null) fs.mkdirSync(file);
    else fs.writeFileSync(file, content, { mode: 0o600 });
  }
}

const seedOld = (files: Record<string, string | null>): void => seed(site.oldDir, files);
const seedNew = (files: Record<string, string | null>): void => seed(site.newDir, files);

const read = (file: string): string => fs.readFileSync(file, 'utf8');

/**
 * Every entry under `dir` and what it holds: a folder as '', a link as its target
 * (never followed), a file as its bytes. A refused move must leave this unchanged.
 */
function snapshotTree(dir: string): Map<string, string> {
  const entries = new Map<string, string>();
  const walk = (rel: string): void => {
    for (const entry of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const child = rel ? path.join(rel, entry.name) : entry.name;
      const abs = path.join(dir, child);
      if (entry.isSymbolicLink()) entries.set(child, `-> ${fs.readlinkSync(abs)}`);
      else if (entry.isDirectory()) {
        entries.set(child + path.sep, '');
        walk(child);
      } else entries.set(child, fs.readFileSync(abs, 'latin1'));
    }
  };
  walk('');
  return entries;
}
const exists = (file: string): boolean => fs.existsSync(file) || isLink(file);
const isLink = (file: string): boolean => {
  try {
    return fs.lstatSync(file).isSymbolicLink();
  } catch {
    return false;
  }
};
const mode = (file: string): number => fs.statSync(file).mode & 0o777;
const names = (dir: string): string[] => fs.readdirSync(dir).sort();

/** Set a file's or folder's mtime to `ageMs` before now. */
function age(target: string, ageMs: number): void {
  const at = new Date(Date.now() - ageMs);
  fs.utimesSync(target, at, at);
}

/** The lines of a JSONL-ish file, or none when it is absent. */
function linesOf(file: string): string[] {
  return exists(file) ? read(file).split('\n').filter(Boolean) : [];
}

/** One captured turn as the capture hooks queue it. */
const turn = (n: number): string => JSON.stringify({ role: 'user', content: `turn ${n}`, ts: n });
/** The text of turns `from` .. `to - 1`, one per line. */
const turns = (from: number, to: number): string =>
  Array.from({ length: to - from }, (_, i) => `${turn(from + i)}\n`).join('');

/** A winning ledger set: a log, a ledger, an archive and a history, each distinct. */
function ledgerSet(tag: string): Record<string, string> {
  const id = `obs_${tag}`;
  return {
    [LOG]: toJsonl([makeV2LogRow({ id })]),
    [LEDGER]: toJsonl([makeV2LedgerRow({ id, anchor_id: 'ADR-001', title: `Decision ${tag}` })]),
    [ARCHIVE]: toJsonl([makeV2LogRow({ id: `${id}_archived` })]),
    [HISTORY]: toJsonl([{ id, version: tag }]),
  };
}

/** The lock directory the move takes under the machine directory. */
const moveLockDir = (): string =>
  path.join(site.machineDir, `.curation-move-${curationMoveLockKey(fs.realpathSync(site.root))}.lock`);

/**
 * The machine-side journal of an unfinished set move: next to the move lock, keyed
 * the same way. A journal in the repository's old folder is never this file.
 */
const moveJournalFile = (): string =>
  path.join(site.machineDir, `.curation-move-${curationMoveLockKey(fs.realpathSync(site.root))}.journal`);

/** Hold a lock directory, optionally aged so it counts as abandoned. */
function holdLock(dir: string, ageMs = 0): void {
  fs.mkdirSync(dir, { recursive: true });
  if (ageMs > 0) age(dir, ageMs);
}

/** A file outside the project that a link points at, and its content. */
function outsideFile(name = 'outside.jsonl', content = '{"secret":true}\n'): string {
  const file = path.join(site.tmp, name);
  fs.writeFileSync(file, content);
  return file;
}

/** Assert a refused move changed nothing in the project, and made no machine directory. */
function expectRefused(extra: MoveOpts = {}, pattern?: RegExp): void {
  const before = snapshotTree(site.root);
  const error = failure(extra);
  expect(error.kind).toBe('refused');
  if (pattern) expect(error.message).toMatch(pattern);
  expect(snapshotTree(site.root)).toEqual(before);
  expect(exists(site.machineDir)).toBe(false);
}

// ---------------------------------------------------------------------------
// Entry: the probe, the refusal set, the lock key
// ---------------------------------------------------------------------------

describe('moveLedger — entry and probe', () => {
  it('answers none, and takes no lock or machine directory, when there is no old folder', () => {
    seed(site.devflow, {});
    const result = move();
    expect(result).toEqual({ ok: true, value: { state: 'none', notes: [] } });
    expect(exists(site.machineDir)).toBe(false);
  });

  it('answers none when the project has no .devflow at all', () => {
    expect(move()).toEqual({ ok: true, value: { state: 'none', notes: [] } });
    expect(exists(site.devflow)).toBe(false);
  });

  it('a run after a complete move finds no old folder and does nothing', () => {
    seedOld(ledgerSet('one'));
    movedValue();
    const before = snapshotTree(site.root);
    expect(move()).toEqual({ ok: true, value: { state: 'none', notes: [] } });
    expect(snapshotTree(site.root)).toEqual(before);
  });

  it('answers none for a project whose old folder is gone without a realpath or a directory read', () => {
    seed(site.newDir, ledgerSet('one'));
    seed(path.join(site.devflow, 'learning.backup-20261017T020304Z-0a1b2c3d'), {});
    const before = snapshotTree(site.root);
    const realpath = vi.spyOn(nodeFs, 'realpathSync');
    const readdir = vi.spyOn(nodeFs, 'readdirSync');
    expect(move()).toEqual({ ok: true, value: { state: 'none', notes: [] } });
    expect(realpath).not.toHaveBeenCalled();
    expect(readdir).not.toHaveBeenCalled();
    expect(snapshotTree(site.root)).toEqual(before);
    expect(exists(site.machineDir)).toBe(false);
  });

  it('still refuses a root that is missing, a link or not absolute when it has no old folder', () => {
    const alias = path.join(site.tmp, 'alias');
    fs.symlinkSync(site.root, alias);
    for (const root of ['relative/project', alias, path.join(site.tmp, 'missing')]) {
      const result = mover.moveLedger(root, opts());
      expect(result.ok, root).toBe(false);
      expect(!result.ok && result.error.kind, root).toBe('refused');
    }
  });

  it('takes both folder names from the path helpers: names in the options redirect nothing', () => {
    seedOld(ledgerSet('one'));
    const result = mover.moveLedger(site.root, { ...opts(), oldName: NEW, newName: '../x' } as MoveOpts);
    expect(result).toMatchObject({ ok: true, value: { state: 'moved', mode: 'whole-folder' } });
    expect(exists(site.oldDir)).toBe(false);
    expect(exists(site.newDir)).toBe(true);
    expect(exists(path.join(site.root, 'x'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The setup both ops share (no machine directory, a refused root)
// ---------------------------------------------------------------------------

describe('both ops: the shared setup answers the same errors, each prefixed with its own op name', () => {
  /** A machine where no home directory is known: no HOME, and no passwd entry. */
  function withoutHome(): void {
    vi.stubEnv('HOME', '');
    vi.spyOn(nodeRequire('os') as typeof os, 'homedir').mockReturnValue('');
  }

  it.each([
    ['moveLedger', 'move-ledger', () => mover.moveLedger(site.root, {})],
    ['sweepLedgerBackups', 'sweep-backups', () => mover.sweepLedgerBackups(site.root, {})],
  ])('%s with no home directory answers an io-error and creates nothing', (_name, opName, run) => {
    seedOld(ledgerSet('one'));
    const before = snapshotTree(site.root);
    withoutHome();
    expect(run()).toEqual({
      ok: false,
      error: { kind: 'io-error', message: `${opName}: no home directory is set, so the machine directory is unknown` },
    });
    expect(snapshotTree(site.root)).toEqual(before);
  });

  it.each([
    ['moveLedger', 'move-ledger', (root: string) => mover.moveLedger(root, opts())],
    ['sweepLedgerBackups', 'sweep-backups', (root: string) => mover.sweepLedgerBackups(root, opts())],
  ])('%s refuses a relative root, a root that is a link and a missing root, in a message that starts with its op name', (_name, opName, run) => {
    seedOld(ledgerSet('one'));
    const alias = path.join(site.tmp, 'alias');
    fs.symlinkSync(site.root, alias);
    for (const root of ['relative/project', alias, path.join(site.tmp, 'missing')]) {
      const result = run(root);
      expect(result.ok, root).toBe(false);
      expect(!result.ok && result.error.kind, root).toBe('refused');
      expect(!result.ok && result.error.message, root).toMatch(new RegExp(`^${opName}: .*; nothing was changed$`));
    }
  });

  it.each([
    ['moveLedger', 'move-ledger', () => mover.moveLedger(site.root, opts())],
    ['sweepLedgerBackups', 'sweep-backups', () => mover.sweepLedgerBackups(site.root, opts())],
  ])('%s turns a failing file system call into an io-error that starts with its op name', (_name, opName, run) => {
    seedOld(ledgerSet('one'));
    seed(site.newDir, {});
    seed(path.join(site.devflow, 'learning.backup-20261017T020304Z-0a1b2c3d'), { [QUEUE]: turns(1, 2) });
    vi.spyOn(nodeFs, 'readdirSync').mockImplementation(() => {
      throw Object.assign(new Error('boom'), { code: 'EIO' });
    });
    expect(run()).toEqual({ ok: false, error: { kind: 'io-error', message: `${opName}: EIO: boom` } });
  });

  it('backupPendingRows refuses a relative root and maps a failing read the same way, under its own op name', () => {
    expect(mover.backupPendingRows('relative/project')).toEqual({
      ok: false,
      error: { kind: 'refused', message: 'backup-rows: the ledger root must be an absolute path' },
    });
    seed(site.devflow, {});
    vi.spyOn(nodeFs, 'readdirSync').mockImplementation(() => {
      throw Object.assign(new Error('boom'), { code: 'EIO' });
    });
    expect(mover.backupPendingRows(site.root)).toEqual({ ok: false, error: { kind: 'io-error', message: 'backup-rows: EIO: boom' } });
  });
});

describe('moveLedger — the root is a real ledger root', () => {
  beforeEach(() => seedOld(ledgerSet('one')));

  it('refuses a missing, empty or relative root', () => {
    for (const root of [null, undefined, '', 'relative/project', path.join(site.tmp, 'missing')]) {
      const result = mover.moveLedger(root, opts());
      expect(result.ok, String(root)).toBe(false);
      expect(!result.ok && result.error.kind, String(root)).toBe('refused');
    }
  });

  it('refuses a root that is a symbolic link, with the same files behind it untouched', () => {
    const alias = path.join(site.tmp, 'alias');
    fs.symlinkSync(site.root, alias);
    const before = snapshotTree(site.root);
    const result = mover.moveLedger(alias, opts());
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.kind).toBe('refused');
    expect(snapshotTree(site.root)).toEqual(before);
  });

  it('refuses the home directory, even when a linked parent spells it differently', () => {
    const parent = path.join(site.tmp, 'parent-link');
    fs.symlinkSync(site.tmp, parent);
    for (const root of [site.home, path.join(parent, 'home')]) {
      fs.mkdirSync(path.join(root, '.devflow', OLD), { recursive: true });
      const result = mover.moveLedger(root, opts());
      expect(result.ok, root).toBe(false);
      expect(!result.ok && result.error.message, root).toMatch(/home directory/);
    }
    expect(exists(path.join(site.home, '.devflow', NEW))).toBe(false);
  });

  it('refuses the machine directory as a root', () => {
    seed(path.join(site.machineDir, '.devflow'), { [OLD]: null });
    const result = mover.moveLedger(site.machineDir, opts());
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.message).toMatch(/machine directory/);
  });

  it('does not refuse a machine directory that is itself a link (a dotfile manager may link it)', () => {
    const elsewhere = path.join(site.tmp, 'dotfiles-devflow');
    fs.mkdirSync(elsewhere);
    fs.symlinkSync(elsewhere, site.machineDir);
    expect(movedValue().mode).toBe('whole-folder');
    expect(exists(site.newDir)).toBe(true);
    expect(names(elsewhere)).toEqual([]);
  });
});

describe('moveLedger — a link anywhere in the set refuses the move and changes nothing', () => {
  it('a .devflow that is a link', () => {
    const real = path.join(site.tmp, 'real-devflow');
    fs.mkdirSync(path.join(real, OLD), { recursive: true });
    fs.symlinkSync(real, site.devflow);
    expectRefused({}, /\.devflow/);
  });

  it('a linked source folder (TP-26)', () => {
    const real = path.join(site.tmp, 'real-learning');
    seed(real, ledgerSet('one'));
    fs.mkdirSync(site.devflow);
    fs.symlinkSync(real, site.oldDir);
    const before = snapshotTree(real);
    expectRefused({}, /learning/);
    expect(snapshotTree(real)).toEqual(before);
  });

  it('a linked new folder', () => {
    seedOld(ledgerSet('one'));
    const real = path.join(site.tmp, 'real-curation');
    fs.mkdirSync(real);
    fs.symlinkSync(real, site.newDir);
    expectRefused({}, /curation/);
    expect(names(real)).toEqual([]);
  });

  it('a linked target queue (TP-26): the file behind the link keeps its content', () => {
    seedOld({ ...ledgerSet('old'), [QUEUE]: turns(1, 3) });
    seedNew({ [QUEUE]: null });
    fs.rmdirSync(path.join(site.newDir, QUEUE));
    const target = outsideFile();
    fs.symlinkSync(target, path.join(site.newDir, QUEUE));
    expectRefused({}, /\.pending-turns\.jsonl/);
    expect(read(target)).toBe('{"secret":true}\n');
  });

  it('a linked source file (TP-26), whatever the allowlisted entry', () => {
    for (const name of [QUEUE, LEDGER, LOG, 'learning.json', CLAIM, OWNER, 'old.pre-v2.jsonl']) {
      fs.rmSync(site.devflow, { recursive: true, force: true });
      seedOld({ [LOG]: '', keep: 'x' });
      seedNew({ [LOG]: '' });
      const target = outsideFile(`behind-${name}.txt`);
      fs.rmSync(path.join(site.oldDir, name), { force: true });
      fs.symlinkSync(target, path.join(site.oldDir, name));
      expectRefused({}, new RegExp(name.replace(/\./g, '\\.')));
      expect(read(target)).toBe('{"secret":true}\n');
    }
  });

  it('in the whole-folder case a link directly inside the old folder refuses, whatever its name', () => {
    seedOld(ledgerSet('one'));
    fs.symlinkSync(outsideFile(), path.join(site.oldDir, 'notes.txt'));
    expectRefused({}, /notes\.txt/);
  });

  it('a lock path that is a link, or a plain file, refuses rather than hangs', () => {
    seedOld(ledgerSet('one'));
    const target = outsideFile();
    fs.symlinkSync(target, path.join(site.oldDir, '.decisions.lock'));
    expectRefused({}, /\.decisions\.lock/);

    fs.rmSync(path.join(site.oldDir, '.decisions.lock'));
    fs.writeFileSync(path.join(site.oldDir, '.pending-turns.jsonl.lock'), 'x');
    age(path.join(site.oldDir, '.pending-turns.jsonl.lock'), 10 * 60 * 1000);
    expectRefused({}, /\.pending-turns\.jsonl\.lock/);
  });

  it('a lock directory that holds files refuses rather than retrying for ever', () => {
    seedOld(ledgerSet('one'));
    const lock = path.join(site.oldDir, '.decisions.lock');
    fs.mkdirSync(lock);
    fs.writeFileSync(path.join(lock, 'planted'), 'x');
    age(lock, 10 * 60 * 1000);
    const started = Date.now();
    expectRefused({}, /\.decisions\.lock/);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('a move lock that is a link refuses, and the machine directory stays as it was', () => {
    seedOld(ledgerSet('one'));
    fs.mkdirSync(site.machineDir, { recursive: true });
    fs.symlinkSync(outsideFile(), moveLockDir());
    const before = snapshotTree(site.machineDir);
    const error = failure();
    expect(error.kind).toBe('refused');
    expect(snapshotTree(site.machineDir)).toEqual(before);
    expect(exists(site.oldDir)).toBe(true);
  });
});

describe('the lock key', () => {
  it('is the first 16 hex characters of the sha256 of the root path', async () => {
    const { createHash } = await import('crypto');
    const real = fs.realpathSync(site.root);
    expect(curationMoveLockKey(real)).toBe(createHash('sha256').update(real).digest('hex').slice(0, 16));
    expect(curationMoveLockKey(real)).toMatch(/^[0-9a-f]{16}$/);
  });

  it('is the same for two spellings of one root, so two movers meet at one lock (TP-37)', () => {
    seedOld(ledgerSet('one'));
    const alias = path.join(site.tmp, 'alias-of-tmp');
    fs.symlinkSync(site.tmp, alias);
    const spelled = path.join(alias, 'project');
    // Hold the lock under the physical spelling's key; the other spelling must find it busy.
    holdLock(moveLockDir());
    const result = mover.moveLedger(spelled, opts());
    expect(result).toEqual({ ok: true, value: { state: 'busy', notes: [] } });
    expect(exists(site.oldDir)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Locks: every lock is taken with no wait, before any rename
// ---------------------------------------------------------------------------

describe('moveLedger — locks (TP-31, TP-38)', () => {
  beforeEach(() => seedOld({ ...ledgerSet('one'), [QUEUE]: turns(1, 3) }));

  it('creates the machine directory on a fresh machine and moves (TP-38)', () => {
    expect(exists(site.machineDir)).toBe(false);
    expect(movedValue().mode).toBe('whole-folder');
    expect(fs.statSync(site.machineDir).isDirectory()).toBe(true);
    expect(exists(site.newDir)).toBe(true);
  });

  it('a machine directory that cannot be made is an error result with nothing moved (TP-38)', () => {
    fs.writeFileSync(path.join(site.home, '.devflow'), 'a file where the directory belongs');
    const error = failure();
    expect(error.kind).toBe('io-error');
    expect(exists(site.oldDir)).toBe(true);
    expect(exists(site.newDir)).toBe(false);
  });

  it('a held move lock makes the move busy, changing nothing, and returns at once', () => {
    holdLock(moveLockDir());
    const before = snapshotTree(site.root);
    const started = Date.now();
    const result = move();
    expect(result).toEqual({ ok: true, value: { state: 'busy', notes: [] } });
    expect(result.ok && 'reason' in result.value, 'a held lock keeps the plain busy answer').toBe(false);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(snapshotTree(site.root)).toEqual(before);
  });

  it('a move lock older than 60 s counts as abandoned and is broken', () => {
    holdLock(moveLockDir(), 61_000);
    expect(movedValue().mode).toBe('whole-folder');
    expect(exists(moveLockDir())).toBe(false);
  });

  it('a move lock younger than 60 s is respected', () => {
    holdLock(moveLockDir(), 30_000);
    expect(move()).toEqual({ ok: true, value: { state: 'busy', notes: [] } });
  });

  it.each([
    ['the old folder store lock', () => path.join(site.oldDir, '.decisions.lock')],
    ['the old folder queue lock, in the whole-folder case too', () => path.join(site.oldDir, '.pending-turns.jsonl.lock')],
  ])('%s held: busy, nothing changed, and the locks it took are released', (_label, lock) => {
    holdLock(lock());
    const started = Date.now();
    expect(move()).toEqual({ ok: true, value: { state: 'busy', notes: [] } });
    expect(Date.now() - started).toBeLessThan(1000);
    expect(exists(moveLockDir())).toBe(false);
    expect(exists(site.newDir)).toBe(false);
    expect(exists(path.join(site.oldDir, LEDGER))).toBe(true);
  });

  it.each([
    ['the new folder store lock', '.decisions.lock'],
    ['the new folder queue lock', '.pending-turns.jsonl.lock'],
  ])('%s held while the new folder exists: busy, and the old locks it took are released', (_label, name) => {
    seedNew({});
    holdLock(path.join(site.newDir, name));
    expect(move()).toEqual({ ok: true, value: { state: 'busy', notes: [] } });
    expect(exists(moveLockDir())).toBe(false);
    expect(names(site.oldDir).filter(entry => entry.endsWith('.lock'))).toEqual([]);
  });

  it('releases every lock once the move is done, at the path each has after the last rename', () => {
    movedValue();
    expect(exists(moveLockDir())).toBe(false);
    expect(names(site.newDir).filter(entry => entry.endsWith('.lock'))).toEqual([]);
  });

  it('names the move lock with a leading dot, a fixed prefix, 16 hex characters and a suffix', () => {
    const spy = vi.spyOn(nodeFs, 'mkdirSync');
    movedValue();
    const made = spy.mock.calls.map(call => String(call[0])).filter(p => p.startsWith(site.machineDir + path.sep));
    expect(made.map(p => path.basename(p))).toContainEqual(expect.stringMatching(/^\.curation-move-[0-9a-f]{16}\.lock$/));
  });

  it('a fresh claim in the old folder makes the move busy, with its own reason (TP-31)', () => {
    seedOld({ [CLAIM]: turns(1, 2), [OWNER]: 'aaaaaaaaaaaaaaaa\n' });
    age(path.join(site.oldDir, CLAIM), 10_000);
    expect(move()).toEqual({ ok: true, value: { state: 'busy', reason: 'claim', notes: [] } });
    expect(exists(site.newDir)).toBe(false);
    expect(exists(moveLockDir())).toBe(false);
  });

  it('a fresh claim in the new folder makes the move busy, with its own reason (TP-31)', () => {
    seedNew({ [CLAIM]: turns(1, 2), [OWNER]: 'bbbbbbbbbbbbbbbb\n' });
    age(path.join(site.newDir, CLAIM), 10_000);
    expect(move()).toEqual({ ok: true, value: { state: 'busy', reason: 'claim', notes: [] } });
    expect(exists(path.join(site.oldDir, LEDGER))).toBe(true);
  });

  it('a claim that is stale does not make the move busy', () => {
    seedOld({ [CLAIM]: turns(1, 2), [OWNER]: 'aaaaaaaaaaaaaaaa\n' });
    age(path.join(site.oldDir, CLAIM), (store.CLAIM_STALE_SECS + 60) * 1000);
    expect(movedValue().mode).toBe('whole-folder');
  });

  describe('a folder that changes between the choice of the locks and the move (the re-probe)', () => {
    const lockEntries = (dir: string): string[] => names(dir).filter(entry => entry.endsWith('.lock'));

    /** Run `change` once, when the mkdir of `lockDir` is called: `before` the call is forwarded or after it. */
    function changeAtLock(lockDir: string, when: 'before' | 'after', change: () => void): void {
      const real = nodeFs.mkdirSync;
      vi.spyOn(nodeFs, 'mkdirSync').mockImplementation(((...args: Parameters<typeof fs.mkdirSync>) => {
        if (String(args[0]) !== lockDir) return real(...args);
        if (when === 'before') change();
        const made = real(...args);
        if (when === 'after') change();
        return made;
      }) as never);
    }

    it('a new folder that appears after the locks were chosen makes the move busy: no rename, every lock released', () => {
      changeAtLock(moveLockDir(), 'before', () => nodeFs.mkdirSync(site.newDir));
      const renames = vi.spyOn(nodeFs, 'renameSync');

      expect(move()).toEqual({ ok: true, value: { state: 'busy', notes: [] } });

      expect(renames.mock.calls).toEqual([]);
      expect(exists(path.join(site.oldDir, LEDGER))).toBe(true);
      expect(names(site.newDir)).toEqual([]);
      expect(exists(moveLockDir())).toBe(false);
      expect(lockEntries(site.oldDir)).toEqual([]);
      expect(lockEntries(site.machineDir)).toEqual([]);
    });

    it('an old folder that is gone once the locks are held answers none: no rename, every lock released', () => {
      changeAtLock(path.join(site.oldDir, '.pending-turns.jsonl.lock'), 'after', () => fs.rmSync(site.oldDir, { recursive: true }));
      const renames = vi.spyOn(nodeFs, 'renameSync');

      expect(move()).toEqual({ ok: true, value: { state: 'none', notes: [] } });

      expect(renames.mock.calls).toEqual([]);
      expect(exists(site.oldDir)).toBe(false);
      expect(exists(site.newDir)).toBe(false);
      expect(exists(moveLockDir())).toBe(false);
      expect(lockEntries(site.machineDir)).toEqual([]);
    });
  });
});

// ---------------------------------------------------------------------------
// The whole-folder case: the new folder is absent
// ---------------------------------------------------------------------------

describe('moveLedger — whole folder (TP-7 index half)', () => {
  it('renames the folder: every file arrives byte-identical, IDs unchanged', () => {
    const files = {
      ...ledgerSet('one'),
      [QUEUE]: turns(1, 4),
      'decisions-log.rejected.jsonl': 'bad line\n',
      'decisions-log.pre-v2.jsonl': '{}\n',
      'learning.json': '{"model":"sonnet"}\n',
    };
    seedOld(files);
    const value = movedValue();
    expect(value).toMatchObject({ state: 'moved', mode: 'whole-folder', backup: null });
    expect(exists(site.oldDir)).toBe(false);
    for (const [name, content] of Object.entries(files)) {
      if (name === 'learning.json') continue;
      expect(read(path.join(site.newDir, name)), name).toBe(content);
    }
    expect(JSON.parse(read(path.join(site.newDir, LEDGER)).trim()).anchor_id).toBe('ADR-001');
  });

  it('renames the tuning file first, so the folder arrives with its curation name', () => {
    seedOld({ ...ledgerSet('one'), 'learning.json': '{"model":"sonnet"}\n' });
    movedValue();
    expect(read(path.join(site.newDir, 'curation.json'))).toBe('{"model":"sonnet"}\n');
    expect(exists(path.join(site.newDir, 'learning.json'))).toBe(false);
  });

  it('a crash between the tuning rename and the folder rename: a rerun renames only the folder', () => {
    seedOld({ ...ledgerSet('one'), 'learning.json': '{"model":"sonnet"}\n' });
    const real = nodeFs.renameSync;
    vi.spyOn(nodeFs, 'renameSync').mockImplementation((from, to) => {
      if (String(from) === site.oldDir) throw Object.assign(new Error('input/output error'), { code: 'EIO' });
      return real(from, to);
    });
    expect(failure().kind).toBe('io-error');
    vi.restoreAllMocks();
    expect(names(site.oldDir)).toContain('curation.json');
    expect(names(site.oldDir)).not.toContain('learning.json');
    expect(exists(site.newDir)).toBe(false);

    expect(movedValue().mode).toBe('whole-folder');
    expect(read(path.join(site.newDir, 'curation.json'))).toBe('{"model":"sonnet"}\n');
  });

  it('leaves a curation.json already in the old folder as the tuning file and keeps learning.json beside it', () => {
    seedOld({ ...ledgerSet('one'), 'learning.json': 'old\n', 'curation.json': 'already\n' });
    movedValue();
    expect(read(path.join(site.newDir, 'curation.json'))).toBe('already\n');
    expect(read(path.join(site.newDir, 'learning.json'))).toBe('old\n');
  });

  it.each([
    ['a private queue file', '.pending-turns.jsonl.merging-20261016T120000Z-1a2b3c4d'],
    ['a swept queue file', '.pending-turns.jsonl.swept-20261016T120000Z-1a2b3c4d'],
    ['an overflow queue file', '.pending-turns.jsonl.overflow-20261016T120000Z-1a2b3c4d'],
    ['a private claim file', '.pending-turns.processing.merging-20261016T120000Z-1a2b3c4d'],
  ])('refuses with nothing renamed while %s sits directly in the old folder', (_label, name) => {
    seedOld({ ...ledgerSet('one'), [name]: turns(1, 2), 'learning.json': 'x\n' });
    const before = snapshotTree(site.root);
    const error = failure();
    expect(error.kind).toBe('refused');
    expect(snapshotTree(site.root)).toEqual(before);
    expect(exists(site.newDir)).toBe(false);
  });

  it('rebuilds the rendered files in the new folder: the index names it and never the old one', () => {
    seedOld(ledgerSet('one'));
    const value = movedValue();
    expect(value.rendered).toBe(true);
    const index = read(path.join(site.newDir, 'index.md'));
    expect(index).toContain(path.join(site.newDir, 'decisions.md'));
    expect(index).not.toContain(site.oldDir);
    expect(read(path.join(site.newDir, 'decisions.md'))).toContain('ADR-001');
  });

  it('a failed re-render keeps the move and says so', () => {
    seedOld({ ...ledgerSet('one'), 'index.md': null });
    const value = movedValue();
    expect(value.rendered).toBe(false);
    expect(value.notes.join('\n')).toMatch(/re-render|rendered/i);
    expect(exists(site.oldDir)).toBe(false);
    expect(read(path.join(site.newDir, LEDGER))).toBe(ledgerSet('one')[LEDGER]);
    expect(exists(moveLockDir())).toBe(false);
  });

  it('an error from the rename (EXDEV, EBUSY, EACCES, EROFS) copies nothing and keeps the old folder (TP-28)', () => {
    for (const code of ['EXDEV', 'EBUSY', 'EACCES', 'EROFS']) {
      fs.rmSync(site.devflow, { recursive: true, force: true });
      seedOld({ ...ledgerSet('one'), [QUEUE]: turns(1, 3) });
      const real = nodeFs.renameSync;
      const copy = vi.spyOn(nodeFs, 'copyFileSync');
      vi.spyOn(nodeFs, 'renameSync').mockImplementation((from, to) => {
        if (String(from) === site.oldDir) throw Object.assign(new Error(`${code}: simulated`), { code });
        return real(from, to);
      });
      const error = failure();
      expect(error.kind, code).toBe('io-error');
      expect(error.message, code).toContain(code);
      expect(copy, code).not.toHaveBeenCalled();
      expect(read(path.join(site.oldDir, LEDGER)), code).toBe(ledgerSet('one')[LEDGER]);
      expect(exists(site.newDir), code).toBe(false);
      expect(exists(moveLockDir()), code).toBe(false);
      vi.restoreAllMocks();
    }
  });
});

// ---------------------------------------------------------------------------
// The per-entry case: the new folder exists
// ---------------------------------------------------------------------------

const BACKUP_RE = /^learning\.backup-\d{8}T\d{6}Z-[0-9a-f]{8}$/;
const JOURNAL = '.curation-move.journal';

/** The backup folder a merge left, from the move's answer. */
function backupOf(value: Extract<MoveValue, { state: 'moved' }>): string {
  expect(value.backup).toMatch(BACKUP_RE);
  return path.join(site.devflow, value.backup as string);
}

describe('moveLedger — the new folder wins when its observation log has data (TP-15, TP-29)', () => {
  beforeEach(() => {
    seedOld({ ...ledgerSet('old'), [QUEUE]: turns(1, 4), 'decisions.md': 'old rendered\n' });
    seedNew({ ...ledgerSet('new'), [QUEUE]: turns(10, 12) });
  });

  it('keeps the new set byte-identical and turns the old folder into a timestamped backup', () => {
    const before = Object.fromEntries(Object.keys(ledgerSet('new')).map(name => [name, read(path.join(site.newDir, name))]));
    const value = movedValue({ now: Date.parse('2026-10-16T12:30:45Z') });
    expect(value.mode).toBe('kept-new');
    expect(value.backup).toMatch(/^learning\.backup-20261016T123045Z-[0-9a-f]{8}$/);
    for (const [name, content] of Object.entries(before)) expect(read(path.join(site.newDir, name)), name).toBe(content);
    expect(exists(site.oldDir)).toBe(false);
  });

  it('merges no ledger: the losing set and its IDs are only in the backup (TP-29)', () => {
    const backup = backupOf(movedValue());
    expect(read(path.join(backup, LEDGER))).toBe(ledgerSet('old')[LEDGER]);
    expect(read(path.join(backup, LOG))).toBe(ledgerSet('old')[LOG]);
    for (const name of Object.keys(ledgerSet('old'))) {
      expect(read(path.join(site.newDir, name)), name).not.toContain('obs_old');
    }
    expect(read(path.join(site.newDir, 'decisions.md'))).not.toContain('Decision old');
  });

  it('never moves rendered files: the backup keeps the old one and the new folder rebuilds its own', () => {
    const value = movedValue();
    expect(read(path.join(backupOf(value), 'decisions.md'))).toBe('old rendered\n');
    expect(value.rendered).toBe(true);
    expect(read(path.join(site.newDir, 'index.md'))).toContain(path.join(site.newDir, 'decisions.md'));
    expect(read(path.join(site.newDir, 'index.md'))).not.toContain(site.oldDir);
  });

  it('merges the pending rows into the winner and logs one line about the backup', () => {
    const value = movedValue();
    expect(linesOf(path.join(site.newDir, QUEUE))).toEqual([turn(10), turn(11), turn(1), turn(2), turn(3)]);
    expect(value.notes.filter(note => note.includes(value.backup as string))).toHaveLength(1);
  });

  it('releases the locks it took at the new path and at the backup path', () => {
    const value = movedValue();
    expect(exists(moveLockDir())).toBe(false);
    expect(names(site.newDir).filter(name => name.endsWith('.lock'))).toEqual([]);
    expect(names(backupOf(value)).filter(name => name.endsWith('.lock'))).toEqual([]);
  });
});

describe('moveLedger — the old set moves in when the new folder has no log data (TP-16)', () => {
  const newSet = (): Record<string, string> => ({
    [LOG]: '',
    [LEDGER]: toJsonl([makeV2LedgerRow({ id: 'obs_empty', anchor_id: 'ADR-009' })]),
    [ARCHIVE]: toJsonl([makeV2LogRow({ id: 'obs_new_archived' })]),
    [HISTORY]: toJsonl([{ id: 'obs_new', version: 'new' }]),
  });

  beforeEach(() => {
    seedOld({ ...ledgerSet('old'), [QUEUE]: turns(1, 4) });
    seedNew({ ...newSet(), [QUEUE]: turns(1, 2), 'decisions.md': 'stale rendered\n' });
  });

  it('renames the four members in, in the fixed order: log, archive, history, ledger last', () => {
    const renames = vi.spyOn(nodeFs, 'renameSync');
    movedValue();
    const moved = renames.mock.calls
      .filter(([from, to]) => String(to).startsWith(site.newDir + path.sep) && String(from).startsWith(site.oldDir + path.sep))
      .map(([from]) => path.basename(String(from)))
      .filter(name => SET.includes(name));
    expect(moved).toEqual([LOG, ARCHIVE, HISTORY, LEDGER]);
  });

  it('arrives byte-identical, with the new folder\'s own copies displaced into the backup, never overwritten', () => {
    const value = movedValue();
    const backup = backupOf(value);
    for (const [name, content] of Object.entries(ledgerSet('old'))) {
      expect(read(path.join(site.newDir, name)), name).toBe(content);
    }
    for (const [name, content] of Object.entries(newSet())) {
      const displaced = names(backup).filter(entry => entry.startsWith(`${name}.displaced-`));
      expect(displaced, name).toHaveLength(1);
      expect(displaced[0]).toMatch(new RegExp(`^${name.replace(/\./g, '\\.')}\\.displaced-\\d{8}T\\d{6}Z-[0-9a-f]{8}$`));
      expect(read(path.join(backup, displaced[0])), name).toBe(content);
    }
    expect(value.mode).toBe('moved-in');
  });

  it('appends only the queue lines the new folder has not seen, and rebuilds the rendered files', () => {
    const value = movedValue();
    expect(linesOf(path.join(site.newDir, QUEUE))).toEqual([turn(1), turn(2), turn(3)]);
    expect(read(path.join(site.newDir, 'decisions.md'))).toContain('Decision old');
    expect(read(path.join(site.newDir, 'index.md'))).not.toContain(site.oldDir);
    expect(exists(path.join(backupOf(value), 'decisions.md'))).toBe(false);
  });

  it('moves a member the new folder lacks without displacing anything', () => {
    fs.rmSync(path.join(site.newDir, HISTORY));
    const value = movedValue();
    expect(names(backupOf(value)).filter(name => name.startsWith(`${HISTORY}.displaced-`))).toEqual([]);
    expect(read(path.join(site.newDir, HISTORY))).toBe(ledgerSet('old')[HISTORY]);
  });

  it('leaves no journal behind once the set is complete', () => {
    const value = movedValue();
    expect(exists(moveJournalFile())).toBe(false);
    expect(exists(path.join(site.newDir, JOURNAL))).toBe(false);
    expect(exists(path.join(backupOf(value), JOURNAL))).toBe(false);
  });
});

const SET = [LOG, ARCHIVE, HISTORY, LEDGER];

describe('moveLedger — an interrupted set move resumes from its journal (TP-40)', () => {
  const newSet = (): Record<string, string> => ({
    [LOG]: '',
    [ARCHIVE]: toJsonl([makeV2LogRow({ id: 'obs_new_archived' })]),
    [HISTORY]: toJsonl([{ id: 'obs_new', version: 'new' }]),
    [LEDGER]: toJsonl([makeV2LedgerRow({ id: 'obs_new_ledger', anchor_id: 'ADR-009' })]),
  });

  /** Fail the (n + 1)th rename of a set member or a displaced copy; earlier ones go through. */
  function failAfterSetRenames(n: number): void {
    const real = nodeFs.renameSync;
    let done = 0;
    vi.spyOn(nodeFs, 'renameSync').mockImplementation((from, to) => {
      const isSetStep = SET.includes(path.basename(String(from))) || /\.displaced-/.test(String(to));
      if (isSetStep) {
        if (done === n) throw Object.assign(new Error('input/output error'), { code: 'EIO' });
        done++;
      }
      return real(from, to);
    });
  }

  beforeEach(() => {
    seedOld(ledgerSet('old'));
    seedNew(newSet());
  });

  it('writes the journal in the machine directory at mode 0600 before the first rename, listing displacements then moves', () => {
    failAfterSetRenames(0);
    expect(failure().kind).toBe('io-error');
    // An error before the first rename removes the journal, so read it at the first rename instead.
    vi.restoreAllMocks();
    const real = nodeFs.renameSync;
    let seen: { text: string; mode: number; inOldFolder: boolean } | null = null;
    vi.spyOn(nodeFs, 'renameSync').mockImplementation((from, to) => {
      const journal = moveJournalFile();
      if (seen === null && exists(journal)) {
        seen = { text: read(journal), mode: mode(journal), inOldFolder: exists(path.join(site.oldDir, JOURNAL)) };
      }
      return real(from, to);
    });
    movedValue();
    expect(seen).not.toBeNull();
    expect(seen!.mode).toBe(0o600);
    expect(seen!.inOldFolder, 'the old folder never holds a journal').toBe(false);
    const steps = (JSON.parse(seen!.text) as { steps: Array<{ op: string; name: string }> }).steps;
    expect(steps.map(step => `${step.op}:${step.name}`)).toEqual([
      ...SET.map(name => `displace:${name}`),
      ...SET.map(name => `move:${name}`),
    ]);
  });

  it('an error before the first rename removes the journal and changes nothing', () => {
    failAfterSetRenames(0);
    const before = snapshotTree(site.devflow);
    expect(failure().kind).toBe('io-error');
    expect(exists(moveJournalFile())).toBe(false);
    expect(exists(path.join(site.oldDir, JOURNAL))).toBe(false);
    expect(snapshotTree(site.devflow)).toEqual(before);
  });

  it.each([1, 2, 3, 4, 5, 6, 7])('stopped after rename %i: the journal stays, store writes are busy, a rerun completes the set', (done) => {
    failAfterSetRenames(done);
    expect(failure().kind).toBe('io-error');
    vi.restoreAllMocks();

    expect(exists(moveJournalFile())).toBe(true);
    expect(exists(path.join(site.oldDir, JOURNAL))).toBe(false);
    const write = store.withDecisionsLock('put-observation', site.root, () => ({ ok: true, value: null }));
    expect(write.ok).toBe(false);
    expect(!write.ok && write.error.kind).toBe('busy');
    expect(!write.ok && write.error.message).toMatch(/unfinished/);

    const value = movedValue();
    for (const [name, content] of Object.entries(ledgerSet('old'))) {
      expect(read(path.join(site.newDir, name)), name).toBe(content);
    }
    const backup = backupOf(value);
    expect(names(backup).filter(name => SET.includes(name))).toEqual([]);
    for (const [name, content] of Object.entries(newSet())) {
      const displaced = names(backup).filter(entry => entry.startsWith(`${name}.displaced-`));
      expect(displaced.map(entry => read(path.join(backup, entry))), name).toEqual([content]);
    }
    expect(exists(moveJournalFile())).toBe(false);
    expect(exists(path.join(backup, JOURNAL))).toBe(false);
    expect(exists(path.join(site.newDir, JOURNAL))).toBe(false);
    expect(value.notes.join('\n'), 'a normal resume has no split set to report').not.toMatch(/left in place/);
    const after = store.withDecisionsLock('put-observation', site.root, () => ({ ok: true, value: null }));
    expect(after.ok).toBe(true);
  });

  it('a resumed move step whose member sits in both folders leaves both in place and names the member', () => {
    failAfterSetRenames(SET.length);
    expect(failure().kind).toBe('io-error');
    vi.restoreAllMocks();
    expect(exists(path.join(site.newDir, LOG))).toBe(false);
    fs.writeFileSync(path.join(site.newDir, LOG), 'arrived while the move was stopped\n');

    const value = movedValue();

    expect(value.mode).toBe('moved-in');
    expect(value.notes.filter(note => note.includes(LOG) && /left in place/.test(note))).toHaveLength(1);
    expect(read(path.join(site.newDir, LOG))).toBe('arrived while the move was stopped\n');
    expect(read(path.join(backupOf(value), LOG))).toBe(ledgerSet('old')[LOG]);
    for (const name of [ARCHIVE, HISTORY, LEDGER]) {
      expect(read(path.join(site.newDir, name)), name).toBe(ledgerSet('old')[name]);
    }
  });

  it('a writer that took the lock after a move stopped part way through the set is busy, and runs nothing', () => {
    // The writer finds no journal, then waits on the lock while a move starts and
    // stops after its first rename: the journal appears just before the lock is taken.
    const lockDir = path.join(site.newDir, '.decisions.lock');
    const journal = moveJournalFile();
    fs.mkdirSync(site.machineDir, { recursive: true });
    const real = nodeFs.mkdirSync;
    vi.spyOn(nodeFs, 'mkdirSync').mockImplementation(((target: fs.PathLike, opts?: fs.MakeDirectoryOptions) => {
      if (String(target) === lockDir && !exists(journal)) fs.writeFileSync(journal, '{"version":1,"steps":[]}');
      return real(target, opts);
    }) as typeof nodeFs.mkdirSync);
    let ran = false;
    const write = store.withDecisionsLock('put-observation', site.root, () => { ran = true; return { ok: true, value: null }; });
    vi.restoreAllMocks();
    expect(write.ok).toBe(false);
    expect(!write.ok && write.error.kind).toBe('busy');
    expect(!write.ok && write.error.message).toMatch(/unfinished/);
    expect(ran).toBe(false);
    expect(exists(lockDir)).toBe(false);
  });

  it('a resume does not decide the winner again: the log that moved in does not make the new folder win', () => {
    failAfterSetRenames(5);
    failure();
    vi.restoreAllMocks();
    expect(read(path.join(site.newDir, LOG))).toBe(ledgerSet('old')[LOG]);
    expect(movedValue().mode).toBe('moved-in');
  });

  it('a journal that cannot be read is removed and the move decides afresh', () => {
    fs.mkdirSync(site.machineDir, { recursive: true });
    fs.writeFileSync(moveJournalFile(), '');
    const value = movedValue();
    expect(value.mode).toBe('moved-in');
    for (const [name, content] of Object.entries(ledgerSet('old'))) {
      expect(read(path.join(site.newDir, name)), name).toBe(content);
    }
    expect(exists(moveJournalFile())).toBe(false);
    expect(value.notes).toContain('removed an unreadable move journal; no rename had been recorded');
  });

  it('a journal that names anything but set members is not followed, is removed, and the move decides afresh', () => {
    const outside = outsideFile('victim.txt', 'keep me\n');
    fs.mkdirSync(site.machineDir, { recursive: true });
    fs.writeFileSync(moveJournalFile(), JSON.stringify({
      version: 1,
      steps: [{ op: 'move', name: '../../../victim.txt' }, { op: 'displace', name: LEDGER, to: path.join(site.tmp, 'elsewhere') }],
    }));
    const value = movedValue();
    expect(read(outside)).toBe('keep me\n');
    expect(exists(path.join(site.tmp, 'elsewhere'))).toBe(false);
    expect(exists(moveJournalFile())).toBe(false);
    expect(value.mode).toBe('moved-in');
    for (const [name, content] of Object.entries(ledgerSet('old'))) {
      expect(read(path.join(site.newDir, name)), name).toBe(content);
    }
    expect(value.notes).toContain('removed an unreadable move journal; no rename had been recorded');
  });

  it('a journal that is a link, or is not a regular file, refuses the move and changes nothing', () => {
    const outside = outsideFile('journal-target.txt', 'keep me\n');
    fs.mkdirSync(site.machineDir, { recursive: true });
    fs.symlinkSync(outside, moveJournalFile());
    const before = snapshotTree(site.root);
    const error = failure();
    expect(error.kind).toBe('refused');
    expect(error.message).toMatch(/\.journal is not a regular file/);
    expect(snapshotTree(site.root)).toEqual(before);
    expect(read(outside)).toBe('keep me\n');

    fs.rmSync(moveJournalFile());
    fs.mkdirSync(moveJournalFile());
    expect(failure().kind).toBe('refused');
    expect(snapshotTree(site.root)).toEqual(before);
  });

  it('a whole-folder move drops a journal that an earlier pass left, so store writes are not stuck busy', () => {
    fs.rmSync(site.newDir, { recursive: true });
    fs.mkdirSync(site.machineDir, { recursive: true });
    fs.writeFileSync(moveJournalFile(), '{"version":1,"steps":[]}');
    expect(movedValue().mode).toBe('whole-folder');
    expect(exists(moveJournalFile())).toBe(false);
    expect(store.withDecisionsLock('put-observation', site.root, () => ({ ok: true, value: null })).ok).toBe(true);
  });

  it('a journal counts only while the old folder exists: with it gone, the next store write removes the journal and goes on', () => {
    failAfterSetRenames(2);
    expect(failure().kind).toBe('io-error');
    vi.restoreAllMocks();
    expect(exists(moveJournalFile())).toBe(true);
    fs.rmSync(site.oldDir, { recursive: true });

    const write = store.withDecisionsLock('put-observation', site.root, () => ({ ok: true, value: null }));

    expect(write.ok).toBe(true);
    expect(exists(moveJournalFile())).toBe(false);
  });

  it('a move with the old folder gone answers none and leaves a stale journal for the next store write to drop', () => {
    failAfterSetRenames(2);
    expect(failure().kind).toBe('io-error');
    vi.restoreAllMocks();
    fs.rmSync(site.oldDir, { recursive: true });

    expect(move()).toEqual({ ok: true, value: { state: 'none', notes: [] } });
    expect(exists(moveJournalFile())).toBe(true);

    const write = store.withDecisionsLock('put-observation', site.root, () => ({ ok: true, value: null }));
    expect(write.ok).toBe(true);
    expect(exists(moveJournalFile())).toBe(false);
  });

  it('a stale journal that is a link is not followed or removed, and the write goes on', () => {
    const outside = outsideFile('journal-target.txt', 'keep me\n');
    fs.mkdirSync(site.machineDir, { recursive: true });
    fs.symlinkSync(outside, moveJournalFile());
    fs.rmSync(site.oldDir, { recursive: true });

    const write = store.withDecisionsLock('put-observation', site.root, () => ({ ok: true, value: null }));

    expect(write.ok).toBe(true);
    expect(isLink(moveJournalFile())).toBe(true);
    expect(read(outside)).toBe('keep me\n');
  });
});

describe('moveLedger — a journal in the repository\'s old folder is never read', () => {
  /** A journal that looks valid and would, if followed, displace the new folder's set and move the old one in. */
  const lookalike = (): string => JSON.stringify({
    version: 1,
    steps: [
      ...SET.map(name => ({ op: 'displace', name, to: `${name}.displaced-20261001T000000Z-deadbeef` })),
      ...SET.map(name => ({ op: 'move', name })),
    ],
  });

  it('the new folder with data wins, byte-identical, and nothing is displaced', () => {
    seedOld({ ...ledgerSet('old'), [JOURNAL]: lookalike() });
    seedNew(ledgerSet('new'));
    const before = Object.fromEntries(SET.map(name => [name, read(path.join(site.newDir, name))]));

    const value = movedValue();

    expect(value.mode).toBe('kept-new');
    for (const [name, content] of Object.entries(before)) expect(read(path.join(site.newDir, name)), name).toBe(content);
    const backup = backupOf(value);
    expect(names(backup).filter(name => name.includes('.displaced-'))).toEqual([]);
    expect(names(site.newDir).filter(name => name.includes('.displaced-'))).toEqual([]);
    expect(read(path.join(backup, LEDGER))).toBe(ledgerSet('old')[LEDGER]);
    expect(read(path.join(backup, JOURNAL))).toBe(lookalike());
    expect(value.notes.join('\n')).toMatch(/left in the backup, not moved: .*\.curation-move\.journal/);
    expect(exists(moveJournalFile())).toBe(false);
  });

  it('does not refuse a whole-folder move: the set moves in, and the file stays in the backup, out of the live folder', () => {
    seedOld({ ...ledgerSet('old'), [QUEUE]: turns(1, 3), 'learning.json': 'tuning\n', [JOURNAL]: lookalike() });
    expect(exists(site.newDir)).toBe(false);

    const value = movedValue();

    expect(value.mode).toBe('moved-in');
    const backup = backupOf(value);
    for (const [name, content] of Object.entries(ledgerSet('old'))) expect(read(path.join(site.newDir, name)), name).toBe(content);
    expect(linesOf(path.join(site.newDir, QUEUE))).toEqual([turn(1), turn(2)]);
    expect(read(path.join(site.newDir, 'curation.json'))).toBe('tuning\n');
    expect(exists(path.join(site.newDir, JOURNAL))).toBe(false);
    expect(read(path.join(backup, JOURNAL))).toBe(lookalike());
    expect(value.notes.join('\n')).toMatch(/left in the backup, not moved: .*\.curation-move\.journal/);
    expect(exists(moveLockDir())).toBe(false);
    expect(exists(moveJournalFile())).toBe(false);
  });

  it('is no reason for a store write to be busy', () => {
    seedOld({ ...ledgerSet('old'), [JOURNAL]: lookalike() });
    seedNew(ledgerSet('new'));
    expect(store.withDecisionsLock('put-observation', site.root, () => ({ ok: true, value: null })).ok).toBe(true);
  });

  it('does not decide what moves when the new folder has no log data: the move plans its own steps', () => {
    seedOld({ ...ledgerSet('old'), [JOURNAL]: JSON.stringify({ version: 1, steps: [{ op: 'move', name: LEDGER }] }) });
    seedNew({ [LOG]: '' });
    const value = movedValue();
    expect(value.mode).toBe('moved-in');
    for (const [name, content] of Object.entries(ledgerSet('old'))) expect(read(path.join(site.newDir, name)), name).toBe(content);
    expect(exists(path.join(backupOf(value), JOURNAL))).toBe(true);
  });
});

describe('moveLedger — other entries follow the per-entry rule', () => {
  beforeEach(() => {
    seedOld(ledgerSet('old'));
    seedNew({ [LOG]: '' });
  });

  it('moves the project tuning file in under its curation name when the new folder lacks it', () => {
    fs.writeFileSync(path.join(site.oldDir, 'learning.json'), '{"model":"haiku"}\n');
    movedValue();
    expect(read(path.join(site.newDir, 'curation.json'))).toBe('{"model":"haiku"}\n');
    expect(exists(path.join(site.newDir, 'learning.json'))).toBe(false);
  });

  it('treats an old-folder curation.json (left by a crash) as the tuning file', () => {
    fs.writeFileSync(path.join(site.oldDir, 'curation.json'), '{"model":"haiku"}\n');
    movedValue();
    expect(read(path.join(site.newDir, 'curation.json'))).toBe('{"model":"haiku"}\n');
  });

  it('keeps the new folder\'s own tuning file and leaves the old one in the backup with one log line', () => {
    fs.writeFileSync(path.join(site.oldDir, 'learning.json'), '{"model":"haiku"}\n');
    fs.writeFileSync(path.join(site.newDir, 'curation.json'), '{"model":"opus"}\n');
    const value = movedValue();
    expect(read(path.join(site.newDir, 'curation.json'))).toBe('{"model":"opus"}\n');
    expect(read(path.join(backupOf(value), 'learning.json'))).toBe('{"model":"haiku"}\n');
    expect(value.notes.filter(note => /curation\.json/.test(note))).toHaveLength(1);
  });

  it('moves a recovery file the new folder lacks, and leaves one it has in the backup', () => {
    fs.writeFileSync(path.join(site.oldDir, 'decisions-log.rejected.jsonl'), 'bad one\n');
    fs.writeFileSync(path.join(site.oldDir, 'decisions-ledger.pre-v2.jsonl'), 'v1 old\n');
    fs.writeFileSync(path.join(site.newDir, 'decisions-ledger.pre-v2.jsonl'), 'v1 new\n');
    const value = movedValue();
    expect(read(path.join(site.newDir, 'decisions-log.rejected.jsonl'))).toBe('bad one\n');
    expect(read(path.join(site.newDir, 'decisions-ledger.pre-v2.jsonl'))).toBe('v1 new\n');
    expect(read(path.join(backupOf(value), 'decisions-ledger.pre-v2.jsonl'))).toBe('v1 old\n');
  });

  it('leaves an unknown entry in the backup and logs its name', () => {
    fs.writeFileSync(path.join(site.oldDir, 'notes.txt'), 'mine\n');
    const value = movedValue();
    expect(read(path.join(backupOf(value), 'notes.txt'))).toBe('mine\n');
    expect(exists(path.join(site.newDir, 'notes.txt'))).toBe(false);
    expect(value.notes.some(note => note.includes('notes.txt'))).toBe(true);
  });

  it('never moves a lock directory into the new folder', () => {
    movedValue();
    expect(names(site.newDir).filter(name => name.endsWith('.lock'))).toEqual([]);
  });

  it('is refused when an allowlisted entry of the new folder is a link, with nothing changed', () => {
    fs.symlinkSync(outsideFile(), path.join(site.newDir, 'curation.json'));
    const before = snapshotTree(site.devflow);
    expect(failure().kind).toBe('refused');
    expect(snapshotTree(site.devflow)).toEqual(before);
  });
});

describe('moveLedger — claims in the per-entry case (TP-31)', () => {
  beforeEach(() => {
    seedOld({ ...ledgerSet('old'), [QUEUE]: turns(1, 2) });
    seedNew({ [LOG]: '', [QUEUE]: turns(1, 2) });
  });

  it('a stale claim in the old folder: its rows join the pending queue and its owner marker goes', () => {
    fs.writeFileSync(path.join(site.oldDir, CLAIM), turns(5, 7));
    fs.writeFileSync(path.join(site.oldDir, OWNER), 'aaaaaaaaaaaaaaaa\n');
    age(path.join(site.oldDir, CLAIM), (store.CLAIM_STALE_SECS + 100) * 1000);
    const value = movedValue();
    expect(linesOf(path.join(site.newDir, QUEUE))).toEqual([turn(1), turn(5), turn(6)]);
    const backup = backupOf(value);
    expect(exists(path.join(backup, OWNER))).toBe(false);
    expect(exists(path.join(backup, CLAIM))).toBe(false);
    expect(exists(path.join(site.newDir, CLAIM))).toBe(false);
  });

  it('a stale claim in the new folder is left to the store\'s own recovery', () => {
    fs.writeFileSync(path.join(site.newDir, CLAIM), turns(8, 9));
    fs.writeFileSync(path.join(site.newDir, OWNER), 'bbbbbbbbbbbbbbbb\n');
    age(path.join(site.newDir, CLAIM), (store.CLAIM_STALE_SECS + 100) * 1000);
    movedValue();
    expect(read(path.join(site.newDir, CLAIM))).toBe(turns(8, 9));
    expect(read(path.join(site.newDir, OWNER))).toBe('bbbbbbbbbbbbbbbb\n');
  });
});

// ---------------------------------------------------------------------------
// The queue rule
// ---------------------------------------------------------------------------

const PRIVATE_RE = /^\.pending-turns\.jsonl\.merging-\d{8}T\d{6}Z-[0-9a-f]{8}$/;
const SWEPT_RE = /^\.pending-turns\.jsonl\.swept-\d{8}T\d{6}Z-[0-9a-f]{8}$/;
const OVERFLOW_RE = /^\.pending-turns\.jsonl\.overflow-\d{8}T\d{6}Z-[0-9a-f]{8}$/;
const REJECTED = '.pending-turns.rejected.jsonl';

/** Files of `dir` whose names match `pattern`, sorted. */
const matching = (dir: string, pattern: RegExp): string[] => names(dir).filter(name => pattern.test(name));

/** A project whose new folder wins (it has log data), so the merge is the whole move. */
function seedKeptNew(oldQueue: string | null, newQueue: string | null): void {
  seedOld({ ...ledgerSet('old'), ...(oldQueue === null ? {} : { [QUEUE]: oldQueue }) });
  seedNew({ ...ledgerSet('new'), ...(newQueue === null ? {} : { [QUEUE]: newQueue }) });
}

/** Simulate a bounded I/O failure of one fs call by name, on the calls `when` accepts. */
function failCall(method: 'openSync' | 'linkSync' | 'renameSync', code: string, when: (args: unknown[]) => boolean): void {
  const real = nodeFs[method] as (...args: unknown[]) => unknown;
  vi.spyOn(nodeFs, method as 'openSync').mockImplementation(((...args: unknown[]) => {
    if (when(args)) throw Object.assign(new Error(`${code}: simulated`), { code });
    return real(...args);
  }) as never);
}

describe('the queue rule — private names, no deletes (TP-39)', () => {
  it('renames the queue to a unique private name before it reads, and the lines end up swept, never deleted', () => {
    seedKeptNew(turns(1, 4), turns(10, 11));
    const reads = vi.spyOn(nodeFs, 'openSync');
    const value = movedValue();
    const readOfLiveQueue = reads.mock.calls.filter(([file, flags]) =>
      String(file) === path.join(site.oldDir, QUEUE) && typeof flags === 'number' && (flags & fs.constants.O_WRONLY) === 0);
    expect(readOfLiveQueue).toEqual([]);
    const backup = backupOf(value);
    expect(exists(path.join(backup, QUEUE))).toBe(false);
    const swept = matching(backup, SWEPT_RE);
    expect(swept).toHaveLength(1);
    expect(read(path.join(backup, swept[0]))).toBe(turns(1, 4));
    expect(linesOf(path.join(site.newDir, QUEUE))).toEqual([turn(10), turn(1), turn(2), turn(3)]);
  });

  it('keeps an append that lands in the private file while the merge runs', () => {
    seedKeptNew(turns(1, 3), null);
    const real = nodeFs.openSync;
    let appended = false;
    vi.spyOn(nodeFs, 'openSync').mockImplementation(((file: fs.PathLike, ...rest: unknown[]) => {
      if (!appended && String(file) === path.join(site.newDir, QUEUE)) {
        appended = true;
        const live = matching(site.oldDir, PRIVATE_RE)[0];
        const fd = (real as (...a: unknown[]) => number)(path.join(site.oldDir, live), 'a');
        fs.writeSync(fd, turn(99) + '\n');
        fs.closeSync(fd);
      }
      return (real as (...a: unknown[]) => number)(file, ...rest);
    }) as never);
    const value = movedValue();
    expect(appended).toBe(true);
    expect(linesOf(path.join(site.newDir, QUEUE))).toEqual([turn(1), turn(2), turn(99)]);
    expect(read(path.join(backupOf(value), matching(backupOf(value), SWEPT_RE)[0]))).toBe(turns(1, 3) + turn(99) + '\n');
  });

  it('a second sweep keeps the earlier swept file and adds nothing', () => {
    seedKeptNew(turns(1, 3), null);
    const backup = backupOf(movedValue());
    const queueBefore = read(path.join(site.newDir, QUEUE));
    const sweptBefore = matching(backup, SWEPT_RE);
    const sweep = mover.sweepLedgerBackups(site.root, opts());
    expect(sweep.ok && sweep.value.merged).toBe(0);
    expect(matching(backup, SWEPT_RE)).toEqual(sweptBefore);
    expect(read(path.join(backup, sweptBefore[0]))).toBe(turns(1, 3));
    expect(read(path.join(site.newDir, QUEUE))).toBe(queueBefore);
  });

  it('merges each private file left by an earlier crash first, before it makes a new private name', () => {
    seedKeptNew(turns(5, 6), turns(1, 2));
    const left = '.pending-turns.jsonl.merging-20261001T000000Z-deadbeef';
    fs.writeFileSync(path.join(site.oldDir, left), turns(2, 4));
    const value = movedValue();
    expect(linesOf(path.join(site.newDir, QUEUE))).toEqual([turn(1), turn(2), turn(3), turn(5)]);
    expect(matching(backupOf(value), SWEPT_RE)).toHaveLength(2);
    expect(matching(backupOf(value), PRIVATE_RE)).toEqual([]);
  });

  it('does not append a line the new folder\'s pending or processing file already holds verbatim', () => {
    seedKeptNew(turns(1, 5), turns(2, 3));
    fs.writeFileSync(path.join(site.newDir, CLAIM), turns(3, 4));
    age(path.join(site.newDir, CLAIM), (store.CLAIM_STALE_SECS + 100) * 1000);
    movedValue();
    expect(linesOf(path.join(site.newDir, QUEUE))).toEqual([turn(2), turn(1), turn(4)]);
  });

  it('merges only newline-terminated lines: a trailing fragment stays, and the file stays unswept', () => {
    seedKeptNew(`${turns(1, 3)}{"role":"user","con`, null);
    const value = movedValue();
    expect(linesOf(path.join(site.newDir, QUEUE))).toEqual([turn(1), turn(2)]);
    const backup = backupOf(value);
    expect(matching(backup, SWEPT_RE)).toEqual([]);
    expect(read(path.join(backup, matching(backup, PRIVATE_RE)[0]))).toBe(`${turns(1, 3)}{"role":"user","con`);
  });

  it('creates the pending queue it appends to at mode 0600', () => {
    seedKeptNew(turns(1, 3), null);
    movedValue();
    expect(mode(path.join(site.newDir, QUEUE))).toBe(0o600);
  });
});

describe('the queue rule — a crash, an append, a rerun (TP-32)', () => {
  it('merges every row exactly once, the append included, at mode 0600', () => {
    seedKeptNew(turns(1, 4), null);
    failCall('openSync', 'EIO', ([file]) => String(file) === path.join(site.newDir, QUEUE));
    expect(failure().kind).toBe('io-error');
    vi.restoreAllMocks();

    expect(matching(site.oldDir, PRIVATE_RE)).toHaveLength(1);
    fs.writeFileSync(path.join(site.oldDir, QUEUE), turn(50) + '\n');

    const value = movedValue();
    expect(linesOf(path.join(site.newDir, QUEUE)).sort()).toEqual([1, 2, 3, 50].map(turn).sort());
    expect(mode(path.join(site.newDir, QUEUE))).toBe(0o600);
    const backup = backupOf(value);
    expect(matching(backup, SWEPT_RE)).toHaveLength(2);
    expect(matching(backup, PRIVATE_RE)).toEqual([]);

    const again = mover.sweepLedgerBackups(site.root, opts());
    expect(again.ok && again.value.merged).toBe(0);
    expect(linesOf(path.join(site.newDir, QUEUE))).toHaveLength(4);
  });

  it('writes a dead fragment to the queue\'s rejected file once, over two sweeps', () => {
    seedKeptNew(`${turns(1, 2)}half a li`, null);
    const backup = backupOf(movedValue());
    const privateFile = path.join(backup, matching(backup, PRIVATE_RE)[0]);
    age(privateFile, 2 * 60 * 1000);

    const first = mover.sweepLedgerBackups(site.root, opts());
    expect(first.ok && first.value.files).toBe(1);
    const rejected = linesOf(path.join(backup, REJECTED)).map(line => JSON.parse(line) as { text: string });
    expect(rejected.map(record => record.text)).toEqual(['half a li']);
    expect(matching(backup, SWEPT_RE)).toHaveLength(1);

    mover.sweepLedgerBackups(site.root, opts());
    expect(linesOf(path.join(backup, REJECTED))).toHaveLength(1);
    expect(linesOf(path.join(site.newDir, QUEUE))).toEqual([turn(1)]);
  });

  it('leaves a fragment touched within the last 60 s for the next run', () => {
    seedKeptNew(`${turns(1, 2)}half a li`, null);
    const backup = backupOf(movedValue());
    mover.sweepLedgerBackups(site.root, opts());
    expect(exists(path.join(backup, REJECTED))).toBe(false);
    expect(matching(backup, PRIVATE_RE)).toHaveLength(1);
  });
});

/** The queue rows `from` .. `to - 1`, as the lines of a queue file. */
const rows = (from: number, to: number): string[] => Array.from({ length: to - from }, (_, i) => turn(from + i));

/** The hooks directory: the shared capture helper `queue-append` lives there. */
const HOOKS_DIR = path.dirname(path.dirname(CURATION_STORE));

/**
 * One capture through the real hook helper: `queue_append_row`, sourced with the chain
 * it needs, appends one row to `queue` and runs the trim when the file is past 200 lines.
 */
function captureThroughHook(queue: string, content: string, ts: number): void {
  const source = ['json-parse', 'get-mtime', 'curation-lock', 'queue-append']
    .map(name => `source "${path.join(HOOKS_DIR, name)}"`).join('\n');
  const script = `set -e\nlog() { :; }\ndbg() { :; }\n${source}\nqueue_append_row "$1" "$2" user "$3" "$4"\n`;
  const run = spawnSync('bash', ['-c', script, 'bash', site.root, queue, content, String(ts)], {
    env: { ...process.env, HOME: site.home },
    encoding: 'utf8',
    timeout: 60_000,
  });
  if (run.error || run.status !== 0) throw new Error(`the capture failed: ${run.error?.message ?? run.stderr}`);
}

describe('the queue rule — the merge cap (the size a capture trim keeps)', () => {
  it('equals the number of lines the capture trim keeps, and the trim still starts above 200', () => {
    const queueAppend = read(path.join(HOOKS_DIR, 'queue-append'));
    const keep = /tail -(\d+) "\$_qar_file"/.exec(queueAppend);
    expect(keep, 'queue-append keeps the newest lines with tail').not.toBeNull();
    expect(mover.QUEUE_MERGE_CAP_LINES).toBe(Number(keep?.[1]));
    const triggers = [...queueAppend.matchAll(/"\$_qar_lines" -gt (\d+)/g)].map(match => Number(match[1]));
    expect(triggers).toEqual([200, 200]);
  });

  it('fills the pending queue to 100 lines and keeps the rest in an overflow file in the backup, dropping no row', () => {
    seedKeptNew(turns(1, 11), turns(100, 195));
    const value = movedValue();
    const queue = linesOf(path.join(site.newDir, QUEUE));
    expect(queue).toHaveLength(100);
    expect(queue.slice(95)).toEqual(rows(1, 6));
    const backup = backupOf(value);
    const overflow = matching(backup, OVERFLOW_RE);
    expect(overflow).toHaveLength(1);
    expect(linesOf(path.join(backup, overflow[0]))).toEqual(rows(6, 11));
    expect(mode(path.join(backup, overflow[0]))).toBe(0o600);
  });

  it('60 pending rows and 150 old rows: 100 stay pending, the rest are counted overflow, and a capture after the move loses no merged row', () => {
    seedKeptNew(turns(1, 151), turns(1000, 1060));
    const value = movedValue();
    const queue = linesOf(path.join(site.newDir, QUEUE));
    expect(queue).toEqual([...rows(1000, 1060), ...rows(1, 41)]);

    const backup = backupOf(value);
    const overflow = matching(backup, OVERFLOW_RE);
    expect(overflow).toHaveLength(1);
    expect(linesOf(path.join(backup, overflow[0]))).toEqual(rows(41, 151));
    const status = mover.backupPendingRows(site.root);
    expect(status.ok && status.value.backups).toEqual([{ name: value.backup, pendingRows: 110 }]);

    captureThroughHook(path.join(site.newDir, QUEUE), 'after the move', 5000);

    const after = linesOf(path.join(site.newDir, QUEUE));
    expect(after, 'the capture is appended and no trim runs').toHaveLength(101);
    expect(after.slice(0, 100)).toEqual(queue);
    expect(JSON.parse(after[100])).toMatchObject({ role: 'user', content: 'after the move', ts: 5000 });
  });

  it('a pending queue at or above the cap receives no row: every old row goes to the overflow file', () => {
    seedKeptNew(turns(1, 11), turns(100, 250));
    const value = movedValue();
    expect(linesOf(path.join(site.newDir, QUEUE))).toEqual(rows(100, 250));
    const backup = backupOf(value);
    expect(linesOf(path.join(backup, matching(backup, OVERFLOW_RE)[0]))).toEqual(rows(1, 11));
  });

  it('a later sweep merges the overflow file once the queue has room, and only once', () => {
    seedKeptNew(turns(1, 11), turns(100, 195));
    const backup = backupOf(movedValue());
    const overflow = matching(backup, OVERFLOW_RE)[0];

    const blocked = mover.sweepLedgerBackups(site.root, opts());
    expect(blocked.ok && blocked.value.merged).toBe(0);
    expect(exists(path.join(backup, overflow))).toBe(true);

    fs.writeFileSync(path.join(site.newDir, QUEUE), turns(100, 190));
    const swept = mover.sweepLedgerBackups(site.root, opts());
    expect(swept.ok && swept.value.merged).toBe(5);
    expect(linesOf(path.join(site.newDir, QUEUE)).slice(90)).toEqual(rows(6, 11));
    expect(exists(path.join(backup, overflow))).toBe(false);

    const again = mover.sweepLedgerBackups(site.root, opts());
    expect(again.ok && again.value.merged).toBe(0);
    expect(linesOf(path.join(site.newDir, QUEUE))).toHaveLength(95);
  });

  it('puts the lines that still do not fit into a new overflow file and sweeps the old one', () => {
    seedKeptNew(turns(1, 11), turns(100, 195));
    const backup = backupOf(movedValue());
    const first = matching(backup, OVERFLOW_RE)[0];
    fs.writeFileSync(path.join(site.newDir, QUEUE), turns(100, 197));
    const swept = mover.sweepLedgerBackups(site.root, opts());
    expect(swept.ok && swept.value.merged).toBe(3);
    expect(swept.ok && swept.value.overflowed).toBe(2);
    expect(linesOf(path.join(site.newDir, QUEUE))).toHaveLength(100);
    expect(exists(path.join(backup, first))).toBe(false);
    const rest = matching(backup, OVERFLOW_RE);
    expect(rest).toHaveLength(1);
    expect(linesOf(path.join(backup, rest[0]))).toEqual(rows(9, 11));
  });

  it('an init backup sweep of overflow files fills the queue to 100, counts the rest, and a capture after it loses no row', () => {
    seedNew({ ...ledgerSet('new'), [QUEUE]: turns(2000, 2090) });
    const backup = path.join(site.devflow, 'learning.backup-20261001T000000Z-abcdef12');
    seed(backup, { '.pending-turns.jsonl.overflow-20261001T000000Z-deadbeef': turns(1, 51) });

    const swept = mover.sweepLedgerBackups(site.root, opts());
    expect(swept.ok && swept.value.merged).toBe(10);
    expect(swept.ok && swept.value.overflowed).toBe(40);
    const queue = linesOf(path.join(site.newDir, QUEUE));
    expect(queue).toEqual([...rows(2000, 2090), ...rows(1, 11)]);
    const rest = matching(backup, OVERFLOW_RE);
    expect(rest).toHaveLength(1);
    expect(linesOf(path.join(backup, rest[0]))).toEqual(rows(11, 51));
    const status = mover.backupPendingRows(site.root);
    expect(status.ok && status.value.backups).toEqual([{ name: path.basename(backup), pendingRows: 40 }]);

    captureThroughHook(path.join(site.newDir, QUEUE), 'after the sweep', 6000);

    const after = linesOf(path.join(site.newDir, QUEUE));
    expect(after).toHaveLength(101);
    expect(after.slice(0, 100)).toEqual(queue);
  });

  it('counts the pending queue again before each append: a capture that lands during the merge counts against the cap', () => {
    seedKeptNew(turns(1, 41), turns(1000, 1050));
    const real = nodeFs.openSync as (...args: unknown[]) => number;
    let landed = false;
    vi.spyOn(nodeFs, 'openSync').mockImplementation(((file: fs.PathLike, ...rest: unknown[]) => {
      const flags = rest[0];
      if (!landed && String(file) === path.join(site.newDir, QUEUE) && typeof flags === 'number' && (flags & fs.constants.O_APPEND) !== 0) {
        landed = true;
        // The first append is about to run. Rows reach the private file (the next step's input) and the live queue (captures).
        for (const [target, text] of [
          [path.join(site.oldDir, matching(site.oldDir, PRIVATE_RE)[0]), turns(41, 71)],
          [path.join(site.newDir, QUEUE), turns(2000, 2008)],
        ] as const) {
          const fd = real(target, 'a');
          fs.writeSync(fd, text);
          fs.closeSync(fd);
        }
      }
      return real(file, ...rest);
    }) as never);
    const value = movedValue();
    expect(landed).toBe(true);
    const queue = linesOf(path.join(site.newDir, QUEUE));
    expect(queue).toHaveLength(100);
    expect(queue.slice(50, 58)).toEqual(rows(2000, 2008));
    expect(queue.slice(98)).toEqual(rows(41, 43));
    const backup = backupOf(value);
    const overflow = matching(backup, OVERFLOW_RE).flatMap(name => linesOf(path.join(backup, name)));
    expect(overflow).toEqual(rows(43, 71));
  });

  it('reads the target\'s processing file once for each queue file it merges', () => {
    seedKeptNew(turns(1, 4), turns(10, 11));
    fs.writeFileSync(path.join(site.newDir, CLAIM), turns(50, 52));
    age(path.join(site.newDir, CLAIM), (store.CLAIM_STALE_SECS + 100) * 1000);
    const opens = vi.spyOn(nodeFs, 'openSync');
    const value = movedValue();
    const claimReads = opens.mock.calls.filter(([file]) => String(file) === path.join(site.newDir, CLAIM));
    expect(claimReads).toHaveLength(1);
    expect(linesOf(path.join(site.newDir, QUEUE))).toEqual([turn(10), turn(1), turn(2), turn(3)]);
    expect(matching(backupOf(value), SWEPT_RE)).toHaveLength(1);
  });
});

describe('the queue rule — no-replace renames', () => {
  it.each(['EPERM', 'ENOTSUP'])('falls back to a rename when link(2) fails with %s, only where the name is free', (code) => {
    seedKeptNew(turns(1, 3), null);
    failCall('linkSync', code, () => true);
    const value = movedValue();
    expect(linesOf(path.join(site.newDir, QUEUE))).toEqual([turn(1), turn(2)]);
    expect(read(path.join(backupOf(value), matching(backupOf(value), SWEPT_RE)[0]))).toBe(turns(1, 3));
  });

  it('any other link failure leaves the queue where it is and stops the pass', () => {
    seedKeptNew(turns(1, 3), turns(10, 11));
    failCall('linkSync', 'EXDEV', () => true);
    expect(failure().kind).toBe('io-error');
    expect(read(path.join(site.oldDir, QUEUE))).toBe(turns(1, 3));
    expect(read(path.join(site.newDir, QUEUE))).toBe(turns(10, 11));
    expect(exists(moveLockDir())).toBe(false);
  });
});

describe('the finish — the backup and the race-close sweep', () => {
  it('turns the old folder into a backup named from the legacy prefix, a UTC stamp and a random suffix', () => {
    seedKeptNew(null, null);
    const first = backupOf(movedValue({ now: Date.parse('2026-10-16T01:02:03Z') }));
    expect(path.basename(first)).toMatch(/^learning\.backup-20261016T010203Z-[0-9a-f]{8}$/);
    fs.mkdirSync(site.oldDir);
    fs.writeFileSync(path.join(site.oldDir, LOG), '');
    const second = backupOf(movedValue({ now: Date.parse('2026-10-16T01:02:03Z') }));
    expect(second).not.toBe(first);
  });

  it('merges an append that lands in the old folder\'s queue just after the backup rename (race close)', () => {
    seedKeptNew(turns(1, 3), turns(10, 11));
    const real = nodeFs.renameSync;
    vi.spyOn(nodeFs, 'renameSync').mockImplementation((from, to) => {
      real(from, to);
      if (String(from) === site.oldDir) fs.appendFileSync(path.join(String(to), QUEUE), turn(77) + '\n');
    });
    const value = movedValue();
    expect(linesOf(path.join(site.newDir, QUEUE))).toEqual([turn(10), turn(1), turn(2), turn(77)]);
    expect(exists(path.join(backupOf(value), QUEUE))).toBe(false);
  });

  describe('a ledger above the render cap', () => {
    const CAP = 64 * 1024 * 1024;
    const RENDERED = { 'decisions.md': 'rendered before\n', 'pitfalls.md': 'rendered before\n', 'index.md': 'rendered before\n' };
    const snapshotRendered = (): Record<string, string> =>
      Object.fromEntries(Object.keys(RENDERED).map(name => [name, read(path.join(site.newDir, name))]));

    it('is not read by the whole-folder move: rendered is false, the note names the cap, the rendered files stay', () => {
      seedOld({ ...ledgerSet('one'), ...RENDERED });
      fs.truncateSync(path.join(site.oldDir, LEDGER), CAP + 1);
      const readFile = vi.spyOn(nodeFs, 'readFileSync');

      const value = movedValue();

      expect(value.mode).toBe('whole-folder');
      expect(value.rendered).toBe(false);
      expect(value.notes.filter(note => note.includes(String(CAP)))).toHaveLength(1);
      expect(snapshotRendered()).toEqual(RENDERED);
      expect(readFile.mock.calls.filter(([file]) => String(file).endsWith(LEDGER))).toEqual([]);
    });

    it('is not read by the per-entry move either, and the backup is still made', () => {
      seedOld({ ...ledgerSet('old'), ...RENDERED });
      seedNew({ [LOG]: '' });
      fs.truncateSync(path.join(site.oldDir, LEDGER), CAP + 1);

      const value = movedValue();

      expect(value.mode).toBe('moved-in');
      expect(value.rendered).toBe(false);
      expect(value.notes.join('\n')).toContain(String(CAP));
      expect(value.backup).toMatch(BACKUP_RE);
      expect(exists(site.oldDir)).toBe(false);
      // Nothing was rendered from the skipped read: the new folder holds no empty rendered file.
      for (const name of Object.keys(RENDERED)) expect(exists(path.join(site.newDir, name)), name).toBe(false);
    });

    it('a ledger exactly at the cap is still rendered', () => {
      seedOld(ledgerSet('one'));
      fs.truncateSync(path.join(site.oldDir, LEDGER), CAP);
      const value = movedValue();
      expect(value.rendered).toBe(true);
      expect(exists(path.join(site.newDir, 'decisions.md'))).toBe(true);
    });
  });

  it('keeps the move when the backup sweep fails, and says so', () => {
    seedKeptNew(turns(1, 3), turns(10, 11));
    const real = nodeFs.renameSync;
    vi.spyOn(nodeFs, 'renameSync').mockImplementation((from, to) => {
      real(from, to);
      if (String(from) === site.oldDir) fs.appendFileSync(path.join(String(to), QUEUE), turn(77) + '\n');
    });
    failCall('openSync', 'EIO', ([file, flags]) =>
      String(file) === path.join(site.newDir, QUEUE) && typeof flags === 'number' && (flags & fs.constants.O_APPEND) !== 0
      && linesOf(path.join(site.newDir, QUEUE)).length >= 3);
    const value = movedValue();
    expect(value.backup).toMatch(BACKUP_RE);
    expect(value.notes.join('\n')).toMatch(/sweep/);
  });

  describe('a backup rename that fails, and the rerun (TP-32)', () => {
    const lockEntries = (dir: string): string[] => names(dir).filter(entry => entry.endsWith('.lock'));
    const backupsUnder = (): string[] => names(site.devflow).filter(entry => entry.startsWith('learning.backup-'));
    const seedMovedIn = (): void => {
      seedOld({ ...ledgerSet('old'), [QUEUE]: turns(1, 3) });
      seedNew({ [LOG]: '', [QUEUE]: turns(10, 11) });
    };

    it.each([
      ['kept-new', () => seedKeptNew(turns(1, 3), turns(10, 11)), ledgerSet('new')[LEDGER]],
      ['moved-in', seedMovedIn, ledgerSet('old')[LEDGER]],
    ] as const)('%s: an I/O error is an io-error that leaves the old folder and no lock, and a rerun makes one backup', (_mode, arrange, winnerLedger) => {
      arrange();
      failCall('renameSync', 'EIO', ([from]) => String(from) === site.oldDir);

      expect(failure().kind).toBe('io-error');

      expect(exists(site.oldDir)).toBe(true);
      expect(backupsUnder()).toEqual([]);
      expect(lockEntries(site.oldDir)).toEqual([]);
      expect(lockEntries(site.newDir)).toEqual([]);
      expect(lockEntries(site.machineDir)).toEqual([]);
      expect(read(path.join(site.newDir, LEDGER))).toBe(winnerLedger);

      vi.restoreAllMocks();
      const value = movedValue();

      expect(backupsUnder()).toEqual([value.backup]);
      expect(exists(site.oldDir)).toBe(false);
      expect(linesOf(path.join(site.newDir, QUEUE))).toEqual([turn(10), turn(1), turn(2)]);
      expect(read(path.join(site.newDir, LEDGER))).toBe(winnerLedger);
      expect(lockEntries(site.newDir)).toEqual([]);
      expect(lockEntries(site.machineDir)).toEqual([]);
    });

    it('with no free backup name in 5 tries, the pass is an io-error that leaves the old folder and no lock, and a rerun succeeds', () => {
      seedKeptNew(turns(1, 3), turns(10, 11));
      const taken = 'learning.backup-20261016T123045Z-deadbeef';
      seed(path.join(site.devflow, taken), {});
      vi.spyOn(nodeCrypto, 'randomBytes').mockReturnValue(Buffer.from('deadbeef', 'hex') as never);
      const probes = vi.spyOn(nodeFs, 'lstatSync');

      const error = failure({ now: Date.parse('2026-10-16T12:30:45Z') });

      expect(error.kind).toBe('io-error');
      expect(error.message).toContain('no free backup name');
      expect(probes.mock.calls.filter(([file]) => String(file) === path.join(site.devflow, taken))).toHaveLength(5);
      expect(exists(site.oldDir)).toBe(true);
      expect(backupsUnder()).toEqual([taken]);
      expect(lockEntries(site.oldDir)).toEqual([]);
      expect(lockEntries(site.newDir)).toEqual([]);
      expect(lockEntries(site.machineDir)).toEqual([]);

      vi.restoreAllMocks();
      const value = movedValue();

      expect(value.backup).not.toBe(taken);
      expect(backupsUnder()).toEqual([taken, value.backup].sort());
      expect(exists(site.oldDir)).toBe(false);
      expect(linesOf(path.join(site.newDir, QUEUE))).toEqual([turn(10), turn(1), turn(2)]);
    });
  });
});

describe('sweepLedgerBackups', () => {
  it('answers none when there is no backup, and none when the new folder is absent', () => {
    seedNew({ [LOG]: '' });
    expect(mover.sweepLedgerBackups(site.root, opts())).toEqual({ ok: true, value: { state: 'none', files: 0, merged: 0, overflowed: 0, notes: [] } });
    fs.rmSync(site.newDir, { recursive: true });
    fs.mkdirSync(path.join(site.devflow, 'learning.backup-20261001T000000Z-abcdef12'));
    expect(mover.sweepLedgerBackups(site.root, opts()).ok).toBe(true);
    const result = mover.sweepLedgerBackups(site.root, opts());
    expect(result.ok && result.value.state).toBe('none');
  });

  it('is busy, merging nothing, while the new folder\'s queue lock is held', () => {
    seedKeptNew(turns(1, 3), null);
    const backup = backupOf(movedValue());
    const private1 = '.pending-turns.jsonl.merging-20261001T000000Z-deadbeef';
    fs.writeFileSync(path.join(backup, private1), turns(7, 8));
    holdLock(path.join(site.newDir, '.pending-turns.jsonl.lock'));
    expect(mover.sweepLedgerBackups(site.root, opts())).toEqual({ ok: true, value: { state: 'busy', files: 0, merged: 0, overflowed: 0, notes: [] } });
    expect(exists(path.join(backup, private1))).toBe(true);
  });

  it('reaches a backup with rows past the per-pass limit, because a backup with nothing to merge does not count', () => {
    seedNew({ [LOG]: '' });
    const stamp = (i: number): string => `learning.backup-20261001T0000${String(i).padStart(2, '0')}Z-${String(i).padStart(8, '0')}`;
    for (let i = 0; i < 51; i++) {
      seed(path.join(site.devflow, stamp(i)), i % 2 === 0 ? {} : { [`${QUEUE}.swept-20261001T000000Z-${String(i).padStart(8, '0')}`]: turns(1, 3) });
    }
    seed(path.join(site.devflow, stamp(51)), { [QUEUE]: turns(7, 10) });

    const result = mover.sweepLedgerBackups(site.root, opts());

    expect(result.ok && result.value).toMatchObject({ state: 'swept', files: 1, merged: 3 });
    expect(linesOf(path.join(site.newDir, QUEUE))).toEqual([turn(7), turn(8), turn(9)]);
    expect(matching(path.join(site.devflow, stamp(51)), SWEPT_RE)).toHaveLength(1);
  });

  it('merges at most 50 backups that hold rows in one pass, oldest first, and the next pass takes the rest', () => {
    seedNew({ [LOG]: '' });
    const stamp = (i: number): string => `learning.backup-20261001T0000${String(i).padStart(2, '0')}Z-${String(i).padStart(8, '0')}`;
    for (let i = 0; i < 52; i++) seed(path.join(site.devflow, stamp(i)), { [QUEUE]: `${turn(1000 + i)}\n` });
    const swept = (i: number): boolean => matching(path.join(site.devflow, stamp(i)), SWEPT_RE).length > 0;

    const first = mover.sweepLedgerBackups(site.root, opts());
    expect(first.ok && first.value).toMatchObject({ state: 'swept', files: 50, merged: 50 });
    expect(swept(0)).toBe(true);
    expect(swept(49)).toBe(true);
    expect(swept(50)).toBe(false);
    expect(swept(51)).toBe(false);

    const second = mover.sweepLedgerBackups(site.root, opts());
    expect(second.ok && second.value).toMatchObject({ state: 'swept', files: 2, merged: 2 });
    expect(swept(50) && swept(51)).toBe(true);
  });

  it('refuses a linked root or backup, changing nothing', () => {
    seedKeptNew(turns(1, 3), null);
    const backup = backupOf(movedValue());
    fs.writeFileSync(path.join(backup, '.pending-turns.jsonl.merging-20261001T000000Z-deadbeef'), turns(7, 8));
    fs.symlinkSync(outsideFile(), path.join(backup, QUEUE));
    const before = snapshotTree(site.devflow);
    const result = mover.sweepLedgerBackups(site.root, opts());
    expect(result.ok).toBe(false);
    expect(snapshotTree(site.devflow)).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// Queue files a repository supplies: a file git tracks is not merged
// ---------------------------------------------------------------------------

describe('the queue rule — a queue file that git tracks is not merged', () => {
  const TRACKED_OLD_QUEUE = `.devflow/${OLD}/${QUEUE}`;

  /** Make the project a git repository with `rels` (paths relative to the root, written if absent) committed. */
  function commitInRepo(...rels: string[]): void {
    git(site.root, ['-c', 'init.defaultBranch=main', 'init', '-q']);
    for (const rel of rels) {
      const file = path.join(site.root, rel);
      if (!exists(file)) {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, 'supplied by the repository\n');
      }
    }
    git(site.root, ['add', '-f', '--', ...rels]);
    git(site.root, ['commit', '-q', '-m', 'supply files']);
  }

  /** The git calls the move made: every spawnSync call whose command is git. */
  const gitCalls = (spy: { mock: { calls: unknown[][] } }): unknown[][] => spy.mock.calls.filter(([command]) => command === 'git');

  const newQueue = (): string[] => linesOf(path.join(site.newDir, QUEUE));

  it('skips a committed pending queue in the old folder: it stays in the backup under its name and a note counts it', () => {
    seedKeptNew(turns(1, 4), turns(10, 11));
    commitInRepo(TRACKED_OLD_QUEUE);

    const value = movedValue();

    expect(newQueue()).toEqual([turn(10)]);
    const backup = backupOf(value);
    expect(read(path.join(backup, QUEUE))).toBe(turns(1, 4));
    expect(matching(backup, SWEPT_RE)).toEqual([]);
    expect(matching(backup, PRIVATE_RE)).toEqual([]);
    const notes = value.notes.filter(note => /tracked by git/.test(note));
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatch(/^1 queue file tracked by git stayed in learning, not merged: \.pending-turns\.jsonl$/);
  });

  it('skips a tracked overflow or private file but merges an untracked one beside it', () => {
    const tail = '20261001T000000Z-deadbeef';
    const tracked = `${QUEUE}.overflow-${tail}`;
    const untracked = `${QUEUE}.merging-20261001T000000Z-cafebabe`;
    seedKeptNew(null, null);
    fs.writeFileSync(path.join(site.oldDir, tracked), turns(1, 3));
    fs.writeFileSync(path.join(site.oldDir, untracked), turns(5, 7));
    commitInRepo(`.devflow/${OLD}/${tracked}`);

    const value = movedValue();

    expect(newQueue()).toEqual([turn(5), turn(6)]);
    expect(read(path.join(backupOf(value), tracked))).toBe(turns(1, 3));
    expect(value.notes.some(note => note.includes(tracked))).toBe(true);
  });

  it('merges an untracked queue in a repository that tracks other files', () => {
    seedKeptNew(turns(1, 4), turns(10, 11));
    commitInRepo('README.txt');

    const value = movedValue();

    expect(newQueue()).toEqual([turn(10), turn(1), turn(2), turn(3)]);
    expect(value.notes.some(note => /tracked by git/.test(note))).toBe(false);
  });

  it('merges as before when the project is not a git repository', () => {
    seedKeptNew(turns(1, 4), turns(10, 11));
    const calls = vi.spyOn(nodeChildProcess, 'spawnSync');

    const value = movedValue();

    expect(gitCalls(calls)).toHaveLength(1);
    expect(newQueue()).toEqual([turn(10), turn(1), turn(2), turn(3)]);
    expect(value.notes.some(note => /git/.test(note))).toBe(false);
  });

  it.each([
    ['git is not installed', 'git is not installed', { error: Object.assign(new Error('spawn git ENOENT'), { code: 'ENOENT' }), status: null }],
    ['git times out', 'git timed out', { error: Object.assign(new Error('spawnSync git ETIMEDOUT'), { code: 'ETIMEDOUT' }), status: null }],
    ['git fails', 'git ls-files exited with 1', { error: undefined, status: 1, stdout: '', stderr: 'fatal: something else\n' }],
    ['git is refused for the repository owner', 'git ls-files exited with 128', { error: undefined, status: 128, stdout: '', stderr: 'fatal: detected dubious ownership in repository\n' }],
  ])('merges nothing from the folder when %s, says so, and the next pass retries', (_name, reason, answer) => {
    seedKeptNew(turns(1, 4), turns(10, 11));
    const real = nodeChildProcess.spawnSync;
    vi.spyOn(nodeChildProcess, 'spawnSync').mockImplementation(((command: string, ...rest: unknown[]) => {
      if (command === 'git') return { pid: 0, output: [], stdout: '', stderr: '', signal: null, ...answer };
      return (real as (...a: unknown[]) => unknown)(command, ...rest);
    }) as never);

    const value = movedValue();

    expect(newQueue()).toEqual([turn(10)]);
    const backup = backupOf(value);
    expect(matching(backup, SWEPT_RE)).toEqual([]);
    expect(read(path.join(backup, QUEUE))).toBe(turns(1, 4));
    const notes = value.notes.filter(note => /could not tell/.test(note));
    expect(notes.length).toBeGreaterThan(0);
    for (const note of notes) expect(note).toContain(reason);

    vi.restoreAllMocks();
    const sweep = mover.sweepLedgerBackups(site.root, opts());
    expect(sweep.ok && sweep.value.merged).toBe(3);
    expect(newQueue()).toEqual([turn(10), turn(1), turn(2), turn(3)]);
  });

  it('asks git once for the whole pass, with a bound, an argv and no shell', () => {
    seedKeptNew(turns(1, 3), turns(10, 11));
    const real = nodeFs.renameSync;
    vi.spyOn(nodeFs, 'renameSync').mockImplementation((from, to) => {
      real(from, to);
      if (String(from) === site.oldDir) fs.appendFileSync(path.join(String(to), QUEUE), turn(77) + '\n');
    });
    const calls = vi.spyOn(nodeChildProcess, 'spawnSync');

    movedValue();

    expect(newQueue()).toContain(turn(77));
    const made = gitCalls(calls);
    expect(made).toHaveLength(1);
    const [, args, options] = made[0] as [string, string[], { cwd: string; timeout: number; shell?: boolean; maxBuffer: number }];
    expect(args).toEqual(['-c', 'core.fsmonitor=false', 'ls-files', '-z', '--', '.devflow']);
    expect(options.cwd).toBe(site.root);
    expect(options.timeout).toBeGreaterThan(0);
    expect(options.timeout).toBeLessThanOrEqual(10_000);
    expect(options.maxBuffer).toBeGreaterThan(0);
    expect(options.shell).toBeFalsy();
  });

  it('does not run git when the pass has no queue file to merge', () => {
    seedKeptNew(null, null);
    const calls = vi.spyOn(nodeChildProcess, 'spawnSync');
    movedValue();
    expect(gitCalls(calls)).toEqual([]);
  });

  it('the backup sweep skips a file git tracks under the old folder\'s name, merges the rest, and asks git once', () => {
    seedNew({ [LOG]: '' });
    const first = path.join(site.devflow, 'learning.backup-20261001T000001Z-00000001');
    const second = path.join(site.devflow, 'learning.backup-20261001T000002Z-00000002');
    seed(first, { [QUEUE]: turns(1, 3) });
    seed(second, { [`${QUEUE}.merging-20261001T000000Z-cafebabe`]: turns(5, 7) });
    commitInRepo(TRACKED_OLD_QUEUE);
    fs.rmSync(path.join(site.root, TRACKED_OLD_QUEUE));
    fs.rmdirSync(site.oldDir);
    const calls = vi.spyOn(nodeChildProcess, 'spawnSync');

    const result = mover.sweepLedgerBackups(site.root, opts());

    expect(gitCalls(calls)).toHaveLength(1);
    expect(result.ok && result.value.merged).toBe(2);
    expect(newQueue()).toEqual([turn(5), turn(6)]);
    expect(read(path.join(first, QUEUE))).toBe(turns(1, 3));
    expect(result.ok && result.value.notes.filter(note => /tracked by git/.test(note))).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// One classifier: what the move does with each entry of an old or a backup folder
// ---------------------------------------------------------------------------

interface EntryClassifier {
  moveEntryClass(name: string): string;
  isLinkChecked(cls: string): boolean;
  MOVE_ENTRY_CLASSES: Record<string, { linkChecked: boolean; leftBehind: boolean }>;
}
const classifier = mover as unknown as EntryClassifier;

describe('moveEntryClass — one sample name per class', () => {
  const TAIL = '20261001T000000Z-deadbeef';
  const SAMPLES: Array<[cls: string, name: string]> = [
    ['set-member', LOG], ['set-member', ARCHIVE], ['set-member', HISTORY], ['set-member', LEDGER],
    ['queue', QUEUE], ['queue', CLAIM],
    ['known', OWNER], ['known', 'learning.json'], ['known', 'curation.json'],
    ['lock', '.decisions.lock'], ['lock', '.pending-turns.jsonl.lock'],
    ['recovery', 'decisions-log.rejected.jsonl'], ['recovery', 'old.pre-v2.jsonl'],
    ['queue-form', `${QUEUE}.merging-${TAIL}`], ['queue-form', `${CLAIM}.merging-${TAIL}`],
    ['queue-form', `${QUEUE}.swept-${TAIL}`], ['queue-form', `${QUEUE}.overflow-${TAIL}`],
    ['displaced', `${LOG}.displaced-${TAIL}`], ['displaced', `${LEDGER}.displaced-${TAIL}`],
    ['rendered', 'decisions.md'], ['rendered', 'pitfalls.md'], ['rendered', 'index.md'],
    ['journal', JOURNAL],
    ['unknown', 'notes.txt'], ['unknown', `${QUEUE}.merging-not-a-stamp`], ['unknown', `${LOG}.displaced-`],
    ['unknown', `${JOURNAL}.bak`], ['unknown', '.decisions.lock.old'], ['unknown', `${LOG}.bak`],
  ];

  it.each(SAMPLES)('classes %s: %s', (cls, name) => {
    expect(classifier.moveEntryClass(name)).toBe(cls);
  });

  it('has a sample for every class the table names, and the table names every sampled class', () => {
    expect(Object.keys(classifier.MOVE_ENTRY_CLASSES).sort()).toEqual([...new Set(SAMPLES.map(([cls]) => cls))].sort());
  });
});

describe('the link refusal covers every class a move path renames', () => {
  const TAIL = '20261001T000000Z-deadbeef';
  const CASES: Array<[cls: string, name: string, lockDir: boolean]> = [
    ['set-member', LEDGER, false], ['set-member', ARCHIVE, false],
    ['queue', QUEUE, false], ['queue', CLAIM, false],
    ['known', OWNER, false], ['known', 'learning.json', false],
    ['lock', '.decisions.lock', true], ['lock', '.pending-turns.jsonl.lock', true],
    ['recovery', 'decisions-log.rejected.jsonl', false],
    ['queue-form', `${QUEUE}.merging-${TAIL}`, false], ['queue-form', `${QUEUE}.swept-${TAIL}`, false],
    ['queue-form', `${QUEUE}.overflow-${TAIL}`, false],
    ['displaced', `${LOG}.displaced-${TAIL}`, false],
    ['rendered', 'decisions.md', false],
    ['journal', JOURNAL, false],
    ['unknown', 'notes.txt', false],
  ];

  /** The old folder with a ledger and `name` as a regular file with rows (a stale claim where it is one), the new folder empty. */
  function seedRegular(name: string): void {
    seedOld({ [LEDGER]: ledgerSet('old')[LEDGER], [name]: name === LEDGER ? ledgerSet('old')[LEDGER] : turns(1, 3) });
    seedNew({});
    if (name === CLAIM) age(path.join(site.oldDir, name), 20 * 60 * 1000);
  }

  /** The same, with `name` a link to a file outside the project (a link takes the place of a regular ledger). */
  function seedLinked(name: string, target: string): void {
    seedOld(name === LEDGER ? {} : { [LEDGER]: ledgerSet('old')[LEDGER] });
    seedNew({});
    fs.symlinkSync(target, path.join(site.oldDir, name));
  }

  it.each(CASES)('%s: %s is refused as a link exactly when its class is link-checked, and when a move renames it', (cls, name, lockDir) => {
    const checked = classifier.isLinkChecked(classifier.moveEntryClass(name));
    expect(classifier.moveEntryClass(name)).toBe(cls);

    // Pass 1: a regular entry. Is it renamed out of the old folder by some move path?
    let renamed = false;
    if (!lockDir) {
      seedRegular(name);
      const backup = backupOf(movedValue());
      renamed = !exists(path.join(backup, name));
    }
    if (renamed) expect(checked, `a move renames a ${cls} entry`).toBe(true);

    // Pass 2: the same name as a link. A link-checked entry refuses the move and changes nothing;
    // any other entry never blocks it.
    fs.rmSync(site.devflow, { recursive: true, force: true });
    fs.rmSync(site.machineDir, { recursive: true, force: true });
    const target = outsideFile(`behind-${cls}.txt`);
    seedLinked(name, target);
    const before = snapshotTree(site.root);
    const result = move();
    if (checked) {
      expect(result.ok).toBe(false);
      expect(!result.ok && result.error.kind).toBe('refused');
      expect(snapshotTree(site.root)).toEqual(before);
    } else {
      expect(result.ok).toBe(true);
    }
    expect(read(target)).toBe('{"secret":true}\n');
  });
});

// ---------------------------------------------------------------------------
// The json-helper case (TP-36, argument half)
// ---------------------------------------------------------------------------

/** Run `json-helper move-ledger` as a hook would: from `cwd`, with HOME set to the site's home. */
function runMoveLedger(args: readonly string[], cwd: string = site.tmp): { code: number; stdout: string; stderr: string } {
  const run = spawnSync(process.execPath, [JSON_HELPER, 'move-ledger', ...args], {
    cwd,
    env: { ...GIT_ENV, HOME: site.home },
    encoding: 'utf8',
    timeout: 60_000,
  });
  if (run.error) throw run.error;
  return { code: run.status ?? 1, stdout: run.stdout ?? '', stderr: run.stderr ?? '' };
}

describe('json-helper move-ledger (TP-36, argument half)', () => {
  it('moves the root\'s old folder and prints the state', () => {
    seedOld(ledgerSet('one'));
    const run = runMoveLedger([site.root]);
    expect(run).toEqual({ code: 0, stdout: 'moved whole-folder\nnote moved learning to curation\n', stderr: '' });
    expect(exists(site.oldDir)).toBe(false);
    expect(names(site.newDir)).toEqual([...Object.keys(ledgerSet('one')), 'decisions.md', 'index.md', 'pitfalls.md'].sort());
  });

  it('prints none when there is no old folder, and creates nothing', () => {
    fs.mkdirSync(site.devflow);
    expect(runMoveLedger([site.root])).toEqual({ code: 0, stdout: 'none\n', stderr: '' });
    expect(exists(site.machineDir)).toBe(false);
  });

  it('prints busy, exit 0, while the move lock is held', () => {
    seedOld(ledgerSet('one'));
    fs.mkdirSync(site.machineDir);
    holdLock(moveLockDir());
    expect(runMoveLedger([site.root])).toEqual({ code: 0, stdout: 'busy\n', stderr: '' });
    expect(exists(site.oldDir)).toBe(true);
  });

  it.each([
    ['the old folder', () => seedOld({ ...ledgerSet('one'), [CLAIM]: turns(1, 2), [OWNER]: 'aaaaaaaaaaaaaaaa\n' })],
    ['the new folder', () => { seedOld(ledgerSet('one')); seedNew({ [CLAIM]: turns(1, 2), [OWNER]: 'bbbbbbbbbbbbbbbb\n' }); }],
  ])('prints busy claim, exit 0, while a fresh claim is held in %s', (_label, arrange) => {
    arrange();
    expect(runMoveLedger([site.root])).toEqual({ code: 0, stdout: 'busy claim\n', stderr: '' });
    expect(exists(site.oldDir)).toBe(true);
    expect(names(site.machineDir).filter(entry => entry.endsWith('.lock'))).toEqual([]);
  });

  it('prints the backup name and a note for each note when a merge made a backup', () => {
    seedOld(ledgerSet('old'));
    seedNew(ledgerSet('new'));
    const run = runMoveLedger([site.root]);
    expect(run.code).toBe(0);
    expect(run.stderr).toBe('');
    const lines = run.stdout.split('\n').filter(Boolean);
    expect(lines[0]).toBe('moved kept-new');
    expect(lines[1]).toMatch(/^backup learning\.backup-\d{8}T\d{6}Z-[0-9a-f]{8}$/);
    expect(lines.slice(2).length).toBeGreaterThan(0);
    for (const line of lines.slice(2)) expect(line).toMatch(/^note \S/);
  });

  it('does not send the claim heartbeat: a stale claim in the working directory stays stale', () => {
    seedOld({ ...ledgerSet('one'), [CLAIM]: turns(1, 3), [OWNER]: 'owner' });
    age(path.join(site.oldDir, CLAIM), 20 * 60 * 1000);
    const run = runMoveLedger([site.root], site.root);
    expect(run.code).toBe(0);
    expect(run.stdout.split('\n')[0]).toBe('moved whole-folder');
  });

  it('runs nothing from a root with command-substitution characters and quotes, and moves normally', () => {
    const hostile = path.join(site.tmp, 'p $(touch injected-sub) `touch injected-tick` "q" \'s\' ; touch injected-semi');
    fs.mkdirSync(path.join(hostile, '.devflow', OLD), { recursive: true });
    fs.writeFileSync(path.join(hostile, '.devflow', OLD, LOG), toJsonl([makeV2LogRow()]));
    const run = runMoveLedger([hostile]);
    expect(run.code).toBe(0);
    expect(run.stdout.split('\n')[0]).toBe('moved whole-folder');
    expect(exists(path.join(hostile, '.devflow', OLD))).toBe(false);
    expect(exists(path.join(hostile, '.devflow', NEW, LOG))).toBe(true);
    for (const stray of ['injected-sub', 'injected-tick', 'injected-semi']) {
      expect(exists(path.join(site.tmp, stray))).toBe(false);
      expect(exists(path.join(hostile, stray))).toBe(false);
    }
  });

  it('refuses a wrong argument count, names included, with a usage line and changes nothing', () => {
    seedOld(ledgerSet('one'));
    const before = snapshotTree(site.root);
    for (const args of [[], [site.root, OLD, NEW], [site.root, 'other', 'names'], [site.root, '../learning', NEW], [site.root, 'extra']]) {
      const run = runMoveLedger(args);
      expect(run.code, args.join(' ')).toBe(1);
      expect(run.stdout).toBe('');
      expect(run.stderr).toMatch(/^move-ledger: usage: move-ledger <root> \(the root is an absolute path\)/);
    }
    expect(snapshotTree(site.root)).toEqual(before);
  });

  it('refuses a relative root, exit 1, changing nothing', () => {
    seedOld(ledgerSet('one'));
    const before = snapshotTree(site.root);
    const relative = runMoveLedger(['project']);
    expect(relative.code).toBe(1);
    expect(relative.stdout).toBe('');
    expect(relative.stderr).not.toBe('');
    expect(snapshotTree(site.root)).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// Names read from the repository reach no message raw
// ---------------------------------------------------------------------------

/**
 * A name a repository can hold: an escape sequence, a C1 control (U+009B is the
 * one-character CSI), a bell and a newline. The test file spells it with escapes.
 */
const HOSTILE = 'evil\u001b[31m\u009b2J\u0007\nname';

/** Any character a terminal acts on: C0 (the newline too), DEL and C1. */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f-\u009f]/;

/** Assert `text` is one line with no control character, and that the name's printable part survived. */
function expectOneCleanLine(text: string, label: string): void {
  expect(text, label).not.toMatch(CONTROL_CHARACTER);
  expect(text, label).toContain('evil');
}

describe('moveLedger — a name read from the repository is one clean line in every message', () => {
  it('a link named with control characters refuses with one clean line', () => {
    seedOld(ledgerSet('one'));
    fs.symlinkSync(outsideFile(), path.join(site.oldDir, `${HOSTILE}.txt`));
    const error = failure();
    expect(error.kind).toBe('refused');
    expectOneCleanLine(error.message, 'refusal');
  });

  it('the notes for an unknown entry and for a kept recovery file are clean lines', () => {
    seedOld(ledgerSet('old'));
    seedNew({ [LOG]: '' });
    fs.writeFileSync(path.join(site.oldDir, `${HOSTILE}.txt`), 'mine\n');
    fs.writeFileSync(path.join(site.oldDir, `${HOSTILE}.rejected.jsonl`), 'old\n');
    fs.writeFileSync(path.join(site.newDir, `${HOSTILE}.rejected.jsonl`), 'new\n');
    const value = movedValue();
    expect(value.notes.length).toBeGreaterThan(0);
    for (const note of value.notes) expect(note, note).not.toMatch(CONTROL_CHARACTER);
    expect(value.notes.some(note => /^left in the backup, not moved: .*evil/.test(note))).toBe(true);
    expect(value.notes.some(note => / already exists in curation; .*evil.* stays in the backup$/.test(note))).toBe(true);
  });

  it('a backup folder named with control characters is refused with one clean line by the sweep', () => {
    seedNew({ [LOG]: '' });
    const elsewhere = path.join(site.tmp, 'elsewhere');
    fs.mkdirSync(elsewhere);
    fs.symlinkSync(elsewhere, path.join(site.devflow, `learning.backup-${HOSTILE}`));
    const result = mover.sweepLedgerBackups(site.root, opts());
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.kind).toBe('refused');
    expectOneCleanLine(!result.ok ? result.error.message : '', 'sweep refusal');
  });

  it('the status count carries a backup folder name as one clean line', () => {
    seedNew({ [LOG]: '' });
    seed(path.join(site.devflow, `learning.backup-${HOSTILE}`), { [QUEUE]: turns(1, 3) });
    const result = mover.backupPendingRows(site.root);
    expect(result.ok).toBe(true);
    const backups = result.ok ? result.value.backups : [];
    expect(backups).toHaveLength(1);
    expectOneCleanLine(backups[0].name, 'backup name');
    expect(backups[0].pendingRows).toBe(2);
  });
});

describe('json-helper move-ledger — a name read from the repository is one clean line', () => {
  it('a refusal on stderr is one clean line', () => {
    seedOld(ledgerSet('one'));
    fs.symlinkSync(outsideFile(), path.join(site.oldDir, `${HOSTILE}.txt`));
    const run = runMoveLedger([site.root]);
    expect(run.code).toBe(1);
    expect(run.stdout).toBe('');
    expectOneCleanLine(run.stderr.replace(/\n$/, ''), 'stderr');
  });

  it('every line on stdout is a state, a backup or a note, and none holds a control character', () => {
    seedOld(ledgerSet('old'));
    seedNew({ [LOG]: '' });
    fs.writeFileSync(path.join(site.oldDir, `${HOSTILE}.txt`), 'mine\n');
    const run = runMoveLedger([site.root]);
    expect(run.code).toBe(0);
    const lines = run.stdout.replace(/\n$/, '').split('\n');
    for (const line of lines) {
      expect(line).toMatch(/^(moved |backup |note )/);
      expect(line).not.toMatch(CONTROL_CHARACTER);
    }
    expect(lines.some(line => /^note left in the backup, not moved: .*evil/.test(line))).toBe(true);
  });
});
