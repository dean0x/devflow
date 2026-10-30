/**
 * Vitest global setup for the unit config: one run temp folder, and on macOS one folder
 * with the real git, for the whole run.
 *
 * Every worker and every child process it starts pays for its temp folders and its git
 * calls. On macOS `/usr/bin/git` is a shim that first runs `xcrun` to find the real git.
 * This file finds the real git once, links it from a read-only folder, and hands that
 * folder and the run temp root to the workers through `project.provide`. The main
 * process env is never changed. `tests/setup/isolate-env.ts` checks what it receives with
 * the pure checks in `./home-isolation.js` and applies it to the worker's env.
 *
 * Everything fails closed. With no usable TMPDIR in the main process, nothing is provided
 * and the workers run as before. On a platform other than macOS, or on any failed git
 * check, only the run temp root is provided and PATH stays as before. A new run root that
 * fails its own check is removed and stops the run. No process started here has a
 * timeout: a lookup that hangs shows as a hung run, never as a silently different PATH.
 *
 * The run temp root holds `owner.pid`. A later start deletes a run root only when it is
 * an own run root whose recorded owner pid is dead. Nothing else in the temp folder is
 * read for age or name, and nothing else is deleted.
 *
 * Imports are limited to node built-ins, `./home-isolation.js` and a type-only
 * `vitest/node`: the main process has no vitest worker state, so a runtime `vitest`
 * import would throw here.
 */

import { spawnSync } from 'child_process';
import {
  accessSync,
  chmodSync,
  constants,
  lstatSync,
  mkdtempSync,
  opendirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  rmdirSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { TestProject } from 'vitest/node';
import {
  GIT_BIN_KEY,
  GIT_BIN_PREFIX,
  ORIGINAL_HOME_VAR,
  RUN_OWNER_FILE,
  RUN_ROOT_PREFIX,
  RUN_TMP_KEY,
  SAFE_PATH,
  assertRunRoot,
  assertTempHome,
  canonical,
  checkGitBinDir,
  contextRefusesTmp,
  isUnder,
  tmpContext,
  type TmpContext,
} from './home-isolation.js';

const SHIM_GIT = '/usr/bin/git';
const XCRUN = '/usr/bin/xcrun';
const XCRUN_HOME_PREFIX = 'xcrun-home-';
/** At most this many entries of the temp folder are read per sweep. */
const SCAN_LIMIT = 10_000;
/** At most this many run roots are removed per sweep. */
const REMOVE_LIMIT = 64;
/** At most this many entries of one run root are visited before a removal. */
const WALK_LIMIT = 50_000;
const MARKER_MAX_BYTES = 32;
const MARKER_PATTERN = /^[1-9][0-9]{0,9}\n?$/;

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** One line on stderr, however many lines the message holds. */
function warn(message: string): void {
  console.warn(`global-setup: ${message.replace(/\s+/g, ' ').trim()}`);
}

function removeTreeDefault(target: string): void {
  rmSync(target, { recursive: true, force: true });
}

/**
 * The first `git` that PATH resolves to. The walk ends with `undefined` at the first empty
 * or relative entry before a hit: such an entry means the current directory, which no
 * lookup here may trust.
 */
export function firstGitOnPath(
  pathVar: string | undefined,
  isExecutableFile: (p: string) => boolean,
): string | undefined {
  if (pathVar === undefined || pathVar === '') return undefined;
  for (const entry of pathVar.split(path.delimiter)) {
    if (entry === '' || !path.isAbsolute(entry)) return undefined;
    const candidate = path.join(entry, 'git');
    if (isExecutableFile(candidate)) return candidate;
  }
  return undefined;
}

export interface RunResult {
  status: number | null;
  stdout: string;
}

export interface GitRouteDeps {
  platform: string;
  pathVar: string | undefined;
  checkoutRoot: string;
  tmpRoot: string;
  isExecutableFile(p: string): boolean;
  realpath(p: string): string | undefined;
  /** Starts one process; `undefined` when it cannot start. */
  run(file: string, args: readonly string[]): RunResult | undefined;
}

/**
 * The real git behind the macOS shim, or `undefined` when any check fails. The checks run
 * in order and the first failure ends the lookup:
 *  1. the platform is darwin (no process is started otherwise);
 *  2. the first `git` on PATH is exactly `/usr/bin/git` (no process is started otherwise);
 *  3. `xcrun --find git` starts and exits 0;
 *  4. its output is one absolute path of safe characters;
 *  5. the path resolves to a real file of safe characters;
 *  6. that file is an executable regular file named `git`, and is not the shim;
 *  7. it is outside the checkout and the temp root;
 *  8. `git --version` exits 0 and starts with `git version `. This also warms the binary.
 */
export function resolveRealGit(d: GitRouteDeps): string | undefined {
  if (d.platform !== 'darwin') return undefined;
  if (firstGitOnPath(d.pathVar, d.isExecutableFile) !== SHIM_GIT) return undefined;

  const found = d.run(XCRUN, ['--find', 'git']);
  if (found === undefined || found.status !== 0) return undefined;
  const output = found.stdout.trim();
  if (output === '' || output.includes('\n') || !path.isAbsolute(output) || !SAFE_PATH.test(output)) {
    return undefined;
  }

  const real = d.realpath(output);
  if (real === undefined || !path.isAbsolute(real) || !SAFE_PATH.test(real)) return undefined;
  if (!d.isExecutableFile(real) || path.basename(real) !== 'git' || real === SHIM_GIT) return undefined;
  if (isUnder(real, canonical(d.checkoutRoot)) || isUnder(real, canonical(d.tmpRoot))) return undefined;

  const version = d.run(real, ['--version']);
  if (version === undefined || version.status !== 0 || !version.stdout.startsWith('git version ')) {
    return undefined;
  }
  return real;
}

/**
 * The env of the lookup processes: PATH, TMPDIR and DEVELOPER_DIR from the parent when it
 * sets them, a throwaway HOME, and no git config. Nothing else of the parent reaches them.
 */
export function gitSpawnEnv(parent: NodeJS.ProcessEnv, home: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  if (parent.PATH !== undefined) env.PATH = parent.PATH;
  if (parent.TMPDIR !== undefined) env.TMPDIR = parent.TMPDIR;
  if (parent.DEVELOPER_DIR !== undefined) env.DEVELOPER_DIR = parent.DEVELOPER_DIR;
  env.HOME = home;
  env.GIT_CONFIG_NOSYSTEM = '1';
  env.GIT_CONFIG_GLOBAL = '/dev/null';
  return env;
}

/** Signal 0 sends nothing: ESRCH is the only answer that means the process is gone. */
export function isOwnerAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

/**
 * Give every directory of our own tree owner read, write and search rights, so a folder a
 * stopped worker left without them cannot block the removal. The walk uses `lstat` and
 * follows no link; it visits at most `limit` entries. After the change it looks at the entry
 * once more: an entry that is no longer the same directory (device and inode) is not listed
 * and not entered. Returns one line per entry it could not fix.
 */
export function chmodOwnDirs(root: string, uid: number | undefined, limit: number = WALK_LIMIT): string[] {
  const failures: string[] = [];
  if (uid === undefined) return failures;
  const pending = [root];
  for (let visited = 0; visited < limit; visited += 1) {
    const current = pending.pop();
    if (current === undefined) return failures;
    let st;
    try {
      st = lstatSync(current);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') failures.push(`cannot inspect ${current}: ${describeError(err)}`);
      continue;
    }
    if (!st.isDirectory() || st.uid !== uid) continue;
    try {
      chmodSync(current, 0o700);
    } catch (err) {
      failures.push(`cannot make ${current} writable: ${describeError(err)}`);
    }
    let after;
    try {
      after = lstatSync(current);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') failures.push(`cannot inspect ${current}: ${describeError(err)}`);
      continue;
    }
    if (!after.isDirectory() || after.dev !== st.dev || after.ino !== st.ino) {
      failures.push(`${current} changed while it was made writable, so it is not listed`);
      continue;
    }
    try {
      for (const name of readdirSync(current)) pending.push(path.join(current, name));
    } catch (err) {
      failures.push(`cannot list ${current}: ${describeError(err)}`);
    }
  }
  if (pending.length > 0) failures.push(`stopped walking ${root} after ${limit} entries`);
  return failures;
}

/**
 * Remove `root` and everything in it. Own folders get their permissions back before each of
 * two attempts. When both fail, one line per entry that could not be fixed and one line for
 * the failed removal go to stderr. Never throws.
 */
function removeTree(root: string, uid: number | undefined, rm: (target: string) => void): boolean {
  let failures: string[] = [];
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    failures = chmodOwnDirs(root, uid);
    try {
      rm(root);
      return true;
    } catch (err) {
      lastError = err;
    }
  }
  for (const line of failures) warn(line);
  warn(`cannot remove ${root}: ${describeError(lastError)}`);
  return false;
}

export interface RemoveOptions {
  uid: number | undefined;
  env: NodeJS.ProcessEnv;
  /** The recursive removal; a test replaces it to make the removal fail. */
  rm?: (target: string) => void;
}

/**
 * Remove a run root. `assertRunRoot` runs first and throws for a path that is not a run root
 * of `tmpRoot`; nothing is deleted then. A failed removal is reported and not thrown.
 */
export function removeRunRoot(root: string, tmpRoot: string, opts: RemoveOptions): boolean {
  assertRunRoot(root, tmpRoot, { uid: opts.uid, env: opts.env });
  return removeTree(root, opts.uid, opts.rm ?? removeTreeDefault);
}

export interface SweepOptions {
  tmpRoot: string;
  uid: number | undefined;
  env: NodeJS.ProcessEnv;
  isAlive(pid: number): boolean;
  scanLimit?: number;
  removeLimit?: number;
  rm?: (target: string) => void;
}

function runRootNames(folder: string, scanLimit: number): string[] {
  const found: string[] = [];
  const dir = opendirSync(folder);
  try {
    for (let scanned = 0; scanned < scanLimit; scanned += 1) {
      const entry = dir.readSync();
      if (entry === null) break;
      if (entry.name.startsWith(RUN_ROOT_PREFIX)) found.push(entry.name);
    }
  } finally {
    dir.closeSync();
  }
  return found;
}

/** The pid a run root records, or `undefined` when the root or its marker fails any check. */
function recordedOwner(root: string, opts: SweepOptions, ctx: TmpContext): number | undefined {
  try {
    assertRunRoot(root, opts.tmpRoot, { uid: opts.uid, context: ctx });
    const marker = path.join(root, RUN_OWNER_FILE);
    const st = lstatSync(marker);
    if (!st.isFile() || st.size > MARKER_MAX_BYTES) return undefined;
    const text = readFileSync(marker, 'utf8');
    return MARKER_PATTERN.test(text) ? Number(text) : undefined;
  } catch {
    // A root or marker that cannot be checked is kept.
    return undefined;
  }
}

/**
 * Remove the own run roots whose recorded owner is dead. Anything else stays: a live
 * owner, a missing, linked or malformed marker, a link, a file, a foreign owner, a folder
 * without the prefix. Reads at most `scanLimit` entries and starts at most `removeLimit`
 * removals. Returns the removed paths.
 */
export function sweepDeadRuns(opts: SweepOptions): string[] {
  const ctx = tmpContext(opts.tmpRoot, opts.env);
  if (contextRefusesTmp(ctx)) return [];
  const removed: string[] = [];
  let candidates: string[];
  try {
    candidates = runRootNames(ctx.tmp, opts.scanLimit ?? SCAN_LIMIT);
  } catch (err) {
    warn(`cannot list ${ctx.tmp}: ${describeError(err)}`);
    return removed;
  }
  const removeLimit = opts.removeLimit ?? REMOVE_LIMIT;
  let started = 0;
  for (const name of candidates) {
    if (started >= removeLimit) break;
    const root = path.join(ctx.tmp, name);
    try {
      const owner = recordedOwner(root, opts, ctx);
      if (owner === undefined || opts.isAlive(owner)) continue;
      started += 1;
      if (removeTree(root, opts.uid, opts.rm ?? removeTreeDefault)) removed.push(root);
    } catch (err) {
      warn(`cannot sweep ${root}: ${describeError(err)}`);
    }
  }
  return removed;
}

export interface RunOptions extends Omit<GitRouteDeps, 'run'> {
  uid: number | undefined;
  env: NodeJS.ProcessEnv;
  isAlive(pid: number): boolean;
  /** Starts one process with the given env; `undefined` when it cannot start. */
  run(file: string, args: readonly string[], env: NodeJS.ProcessEnv): RunResult | undefined;
  rm?: (target: string) => void;
}

type Provider = Pick<TestProject, 'provide'>;

/**
 * Why the setup refuses `tmpRoot` as the base of a run root, or `undefined` when it accepts
 * it. The reason reads after "the temp root". The checks run in order: an absolute path, only
 * `SAFE_PATH` characters, and neither the filesystem root nor a place inside a real home of
 * `env`. `startRunRoot` and the skip conditions of the setup tests both ask this function.
 */
export function tmpRootRefusal(tmpRoot: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (!path.isAbsolute(tmpRoot)) return 'is not an absolute path';
  if (!SAFE_PATH.test(tmpRoot)) return 'holds characters outside the safe set';
  if (contextRefusesTmp(tmpContext(tmpRoot, env))) return 'is the filesystem root or inside a real home';
  return undefined;
}

/**
 * The run root: swept of dead runs, made, marked with the owner pid and provided as the
 * workers' TMPDIR. Only made when the main process has a TMPDIR to replace, so the setup
 * changes a value and never adds a variable. Returns the root, or `undefined` when nothing
 * is made. A new root that fails `assertRunRoot`, or whose marker cannot be written, is
 * removed and the error is thrown.
 */
function startRunRoot(project: Provider, opts: RunOptions): string | undefined {
  if (opts.env.TMPDIR === undefined || opts.env.TMPDIR === '') return undefined;
  if (opts.uid === undefined) return undefined;
  if (tmpRootRefusal(opts.tmpRoot, opts.env) !== undefined) return undefined;
  const ctx = tmpContext(opts.tmpRoot, opts.env);

  sweepDeadRuns({
    tmpRoot: opts.tmpRoot,
    uid: opts.uid,
    env: opts.env,
    isAlive: opts.isAlive,
    rm: opts.rm,
  });

  const root = mkdtempSync(path.join(opts.tmpRoot, RUN_ROOT_PREFIX));
  try {
    assertRunRoot(root, opts.tmpRoot, { uid: opts.uid, context: ctx });
    writeFileSync(path.join(root, RUN_OWNER_FILE), `${process.pid}\n`, { flag: 'wx', mode: 0o600 });
  } catch (err) {
    try {
      rmSync(path.join(root, RUN_OWNER_FILE), { force: true });
      rmdirSync(root);
    } catch {
      // Best effort: the folder is empty or holds only our marker, and a later start sweeps it.
    }
    throw err;
  }
  project.provide(RUN_TMP_KEY, root);
  return root;
}

function removeGitBin(bin: string, root: string): void {
  if (path.dirname(bin) !== root || !path.basename(bin).startsWith(GIT_BIN_PREFIX)) return;
  try {
    chmodSync(bin, 0o700);
    rmSync(bin, { recursive: true, force: true });
  } catch (err) {
    warn(`cannot remove ${bin}: ${describeError(err)}`);
  }
}

/**
 * The git folder: the real git linked from a read-only folder in the run root, checked
 * with the worker's own check, then provided. One catch-all: on any failure the folder is
 * removed, no git folder is provided, and the run root stays. A lookup that finds no real
 * git is the normal outcome on Linux and not a failure.
 */
function routeGit(project: Provider, root: string, opts: RunOptions): void {
  let bin: string | undefined;
  try {
    let xcrunHome: string | undefined;
    const run = (file: string, args: readonly string[]): RunResult | undefined => {
      if (xcrunHome === undefined) {
        xcrunHome = mkdtempSync(path.join(root, XCRUN_HOME_PREFIX));
        assertTempHome(xcrunHome, opts.env);
      }
      return opts.run(file, args, gitSpawnEnv(opts.env, xcrunHome));
    };
    const real = resolveRealGit({ ...opts, run });
    if (real === undefined) return;

    bin = mkdtempSync(path.join(root, GIT_BIN_PREFIX));
    symlinkSync(real, path.join(bin, 'git'));
    chmodSync(bin, 0o555);
    checkGitBinDir(bin, root, { uid: opts.uid });
    project.provide(GIT_BIN_KEY, bin);
  } catch (err) {
    if (bin !== undefined) removeGitBin(bin, root);
    warn(`git routing is off: ${describeError(err)}`);
  }
}

/**
 * The env the run checks read. The main process records no original HOME, so its own HOME
 * is added the way `tests/setup/isolate-env.ts` records it in each worker: a temp root
 * that a worker would refuse as inside a real home is refused here first. The input is not
 * changed, and no process started here sees the added key (`gitSpawnEnv` copies only its
 * own keys).
 */
export function withRecordedHome(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  if (env[ORIGINAL_HOME_VAR] !== undefined || !env.HOME) return env;
  return { ...env, [ORIGINAL_HOME_VAR]: env.HOME };
}

/**
 * Start one run. Returns the teardown, which never throws: a failed removal is reported on
 * one line and the next start's sweep takes the root.
 */
export function startRun(project: Provider, options: RunOptions): () => void {
  const opts: RunOptions = { ...options, env: withRecordedHome(options.env) };
  const root = startRunRoot(project, opts);
  if (root === undefined) return () => undefined;
  routeGit(project, root, opts);
  return () => {
    try {
      removeRunRoot(root, opts.tmpRoot, { uid: opts.uid, env: opts.env, rm: opts.rm });
    } catch (err) {
      warn(`cannot remove ${root}: ${describeError(err)}`);
    }
  };
}

function liveIsExecutableFile(p: string): boolean {
  try {
    if (!statSync(p).isFile()) return false;
    accessSync(p, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function liveRealpath(p: string): string | undefined {
  try {
    return realpathSync(p);
  } catch {
    return undefined;
  }
}

function liveRun(file: string, args: readonly string[], env: NodeJS.ProcessEnv): RunResult | undefined {
  const result = spawnSync(file, [...args], { env, encoding: 'utf8' });
  if (result.error !== undefined || result.status === null) return undefined;
  return { status: result.status, stdout: result.stdout };
}

export function liveRunOptions(): RunOptions {
  return {
    tmpRoot: os.tmpdir(),
    uid: process.getuid?.(),
    env: process.env,
    isAlive: isOwnerAlive,
    platform: process.platform,
    pathVar: process.env.PATH,
    checkoutRoot: path.resolve(import.meta.dirname, '../..'),
    isExecutableFile: liveIsExecutableFile,
    realpath: liveRealpath,
    run: liveRun,
  };
}

export default function setup(project: TestProject): () => void {
  return startRun(project, liveRunOptions());
}
