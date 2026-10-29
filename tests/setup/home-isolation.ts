/**
 * The pure half of the unit suite's HOME isolation (D-TEST-HOME-ISOLATION).
 *
 * `tests/setup/isolate-env.ts` is the imperative shell that applies these to the
 * worker's `process.env`; `tests/helpers.ts` `sandboxEnv` reuses the same guard for
 * child-process envs. This module imports nothing from `src/` and nothing from
 * `tests/helpers.ts` on purpose: a setup file shares the test file's module graph,
 * so any `src/` module it pulled in would be evaluated BEFORE HOME is redirected
 * and could freeze a real-home path into a module-level constant.
 *
 * The checks for the run temp root and git folder that `tests/setup/global-setup.ts` hands
 * to the workers live here for the same reason: a bad value must stop the run, not redirect it.
 */

import { existsSync, lstatSync, readdirSync, readlinkSync, realpathSync } from 'fs';
import type { Stats } from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * The variables that move a devflow or Claude Code write away from `$HOME`.
 * `CLAUDE_CONFIG_DIR` is read by Claude Code itself, the HUD and — since #389 —
 * `getClaudeDirectory()` in `src/targets/claude-code/claude-paths.ts`. `DEVFLOW_DIR`
 * and `CLAUDE_CODE_DIR` are retired (devflow ignores both, D-ONE-HOME) but are still
 * stripped: an older installed devflow a test might reach still honours them. A temp
 * HOME is no sandbox while any of them is inherited from the developer's shell.
 */
export const REDIRECT_ENV_VARS = ['DEVFLOW_DIR', 'CLAUDE_CODE_DIR', 'CLAUDE_CONFIG_DIR'] as const;

/** Every per-file temp HOME is created with this prefix under `os.tmpdir()`. */
export const TEMP_HOME_PREFIX = 'devflow-test-home-';

/**
 * Where the setup file records the HOME it found before redirecting it, so a
 * later check can still recognise the developer's home when the passwd lookup
 * is unavailable. Set once and never overwritten by a later redirect.
 */
export const ORIGINAL_HOME_VAR = 'DEVFLOW_TEST_ORIGINAL_HOME';

/** Resolve symlinks where the path exists (macOS `/var` → `/private/var`), else normalise. */
export function canonical(p: string): string {
  const resolved = path.resolve(p);
  return existsSync(resolved) ? realpathSync(resolved) : resolved;
}

/**
 * The account's real home directories: the passwd entry (independent of `$HOME`,
 * which the setup file overrides) and the HOME recorded before the redirect.
 * `os.homedir()` is useless here — on POSIX it just echoes `$HOME`.
 */
export function realHomes(env: NodeJS.ProcessEnv = process.env): string[] {
  const candidates: string[] = [];
  try {
    candidates.push(os.userInfo().homedir);
  } catch {
    // No passwd entry for this uid (some containers); the recorded HOME still stands.
  }
  const recorded = env[ORIGINAL_HOME_VAR];
  if (recorded) candidates.push(recorded);
  return [...new Set(candidates.filter(c => c !== '').map(canonical))];
}

/**
 * Throw unless `home` is a directory under `os.tmpdir()` and none of the account's
 * real homes. Asserted at the call site, never trusted from a brief.
 */
export function assertTempHome(home: string, env: NodeJS.ProcessEnv = process.env): void {
  const target = canonical(home);
  const real = realHomes(env);
  if (real.includes(target)) {
    throw new Error(`refusing to use the real home ${home} as a test HOME`);
  }
  const tmpRoot = canonical(os.tmpdir());
  if (!target.startsWith(tmpRoot + path.sep)) {
    throw new Error(`refusing to use ${home} as a test HOME — it is not under ${tmpRoot}`);
  }
}

/**
 * A copy of `env` with every redirect variable removed and HOME (plus USERPROFILE,
 * for parity with Windows-style lookups) pinned to `home`. The input is not touched.
 */
export function isolatedEnv(env: NodeJS.ProcessEnv, home: string): NodeJS.ProcessEnv {
  const redirects = new Set<string>(REDIRECT_ENV_VARS);
  const kept = Object.fromEntries(Object.entries(env).filter(([key]) => !redirects.has(key)));
  return { ...kept, HOME: home, USERPROFILE: home };
}

/** Every per-run temp root is created with this prefix, directly under the real temp root. */
export const RUN_ROOT_PREFIX = 'devflow-test-run-';
/** The run root's git folder: a read-only directory holding one link named `git`. */
export const GIT_BIN_PREFIX = 'git-bin-';
/** The file in a run root that records the pid of the process that owns it. */
export const RUN_OWNER_FILE = 'owner.pid';
/** The provided-context keys; both stay unset in the integration config and on a failed check. */
export const RUN_TMP_KEY = 'devflowRunTmp';
export const GIT_BIN_KEY = 'devflowGitBin';
/** The only characters a run root, git folder or link target may hold. */
export const SAFE_PATH = /^[A-Za-z0-9/._-]+$/;

declare module 'vitest' {
  interface ProvidedContext {
    devflowRunTmp?: string;
    devflowGitBin?: string;
  }
}

/** The canonical temp root and the real homes, computed once for many root checks. */
export interface TmpContext {
  readonly tmp: string;
  readonly homes: readonly string[];
}

export function tmpContext(tmpRoot: string, env: NodeJS.ProcessEnv = process.env): TmpContext {
  return { tmp: canonical(tmpRoot), homes: realHomes(env) };
}

/** True when the temp root is the filesystem root, a real home, or inside one. */
export function contextRefusesTmp(ctx: TmpContext): boolean {
  return (
    ctx.tmp === path.parse(ctx.tmp).root ||
    ctx.homes.some(home => ctx.tmp === home || ctx.tmp.startsWith(home + path.sep))
  );
}

export function refusesTmpRoot(tmpRoot: string, env: NodeJS.ProcessEnv = process.env): boolean {
  return contextRefusesTmp(tmpContext(tmpRoot, env));
}

export interface RunRootOptions {
  /** The uid that must own the folder. Undefined (no uid on this platform) refuses. */
  uid: number | undefined;
  env?: NodeJS.ProcessEnv;
  /** Built from the same `tmpRoot`, when the caller checks many roots against one temp root. */
  context?: TmpContext;
}

function defaultRunRootOptions(): RunRootOptions {
  return { uid: process.getuid?.(), env: process.env };
}

/** `lstat` that names the folder in its error and never follows a link. */
function lstatOf(target: string, what: string): Stats {
  try {
    return lstatSync(target);
  } catch (err) {
    throw new Error(`refusing ${what} ${target} — it cannot be inspected: ${(err as Error).message}`);
  }
}

/**
 * Throw unless `root` is a run root: a safe, normalised, absolute path whose name starts
 * with `RUN_ROOT_PREFIX`, a direct child of `tmpRoot`, a real directory (not a link)
 * owned by `opts.uid`, not a real home, under a temp root that is itself acceptable.
 * `root` is inspected with `lstat` and never resolved with `realpath`.
 */
export function assertRunRoot(
  root: string,
  tmpRoot: string = os.tmpdir(),
  opts: RunRootOptions = defaultRunRootOptions(),
): void {
  if (!path.isAbsolute(root) || !SAFE_PATH.test(root)) {
    throw new Error(`refusing run root ${root} — it is not an absolute path of safe characters`);
  }
  if (path.resolve(root) !== root) {
    throw new Error(`refusing run root ${root} — it is not a normalised path`);
  }
  const name = path.basename(root);
  if (!name.startsWith(RUN_ROOT_PREFIX) || name === RUN_ROOT_PREFIX) {
    throw new Error(`refusing run root ${root} — its name does not start with ${RUN_ROOT_PREFIX}`);
  }
  const ctx = opts.context ?? tmpContext(tmpRoot, opts.env);
  if (contextRefusesTmp(ctx)) {
    throw new Error(`refusing run root ${root} — ${ctx.tmp} is the filesystem root or inside a real home`);
  }
  const parent = path.dirname(root);
  if (parent !== ctx.tmp && canonical(parent) !== ctx.tmp) {
    throw new Error(`refusing run root ${root} — it is not a direct child of ${ctx.tmp}`);
  }
  const st = lstatOf(root, 'run root');
  if (st.isSymbolicLink() || !st.isDirectory()) {
    throw new Error(`refusing run root ${root} — it is not a real directory`);
  }
  if (opts.uid === undefined || st.uid !== opts.uid) {
    throw new Error(`refusing run root ${root} — it is not owned by the current user`);
  }
  if (ctx.homes.includes(path.join(ctx.tmp, name))) {
    throw new Error(`refusing to use the real home ${root} as a run root`);
  }
}

/**
 * The worker's check of the provided run root. `undefined` stays `undefined`. A value
 * that is already this process's temp root (applied by an earlier call) is returned as
 * it is; any other value must pass `assertRunRoot` against the inherited temp root.
 */
export function checkRunTmp(
  value: unknown,
  tmpRoot: string = os.tmpdir(),
  opts: RunRootOptions = defaultRunRootOptions(),
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value === '') {
    throw new Error(`refusing a run temp root of ${typeof value === 'string' ? 'empty text' : typeof value}`);
  }
  if (canonical(value) === canonical(tmpRoot)) return value;
  assertRunRoot(value, tmpRoot, opts);
  return value;
}

/**
 * The worker's check of the provided git folder. `undefined` stays `undefined`. Each
 * check throws on its own, with its own message: a non-empty safe absolute path that is a
 * direct child of the run root, named with `GIT_BIN_PREFIX`; a real directory owned by
 * `opts.uid` with no write bits; holding exactly one entry, `git`, a link whose target is
 * an absolute safe path.
 */
export function checkGitBinDir(
  value: unknown,
  runRoot: string | undefined,
  opts: { uid: number | undefined } = { uid: process.getuid?.() },
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value === '') {
    throw new Error('refusing a git folder that is not a non-empty string');
  }
  if (!path.isAbsolute(value) || !SAFE_PATH.test(value)) {
    throw new Error(`refusing git folder ${value} — it is not an absolute path of safe characters`);
  }
  if (path.resolve(value) !== value) {
    throw new Error(`refusing git folder ${value} — it is not a normalised path`);
  }
  if (runRoot === undefined) {
    throw new Error(`refusing git folder ${value} — there is no run root to hold it`);
  }
  if (path.dirname(value) !== runRoot) {
    throw new Error(`refusing git folder ${value} — it is not a direct child of the run root ${runRoot}`);
  }
  const name = path.basename(value);
  if (!name.startsWith(GIT_BIN_PREFIX) || name === GIT_BIN_PREFIX) {
    throw new Error(`refusing git folder ${value} — its name does not start with ${GIT_BIN_PREFIX}`);
  }
  const st = lstatOf(value, 'git folder');
  if (st.isSymbolicLink() || !st.isDirectory()) {
    throw new Error(`refusing git folder ${value} — it is not a real directory`);
  }
  if (opts.uid === undefined || st.uid !== opts.uid) {
    throw new Error(`refusing git folder ${value} — it is not owned by the current user`);
  }
  if ((st.mode & 0o222) !== 0) {
    throw new Error(`refusing git folder ${value} — it has write bits set`);
  }
  const entries = readdirSync(value);
  if (entries.length !== 1 || entries[0] !== 'git') {
    throw new Error(`refusing git folder ${value} — it must hold exactly one entry named git`);
  }
  const link = path.join(value, 'git');
  if (!lstatOf(link, 'git link').isSymbolicLink()) {
    throw new Error(`refusing git folder ${value} — its git entry is not a link`);
  }
  const target = readlinkSync(link);
  if (!path.isAbsolute(target) || !SAFE_PATH.test(target)) {
    throw new Error(`refusing git folder ${value} — its link target is not an absolute path of safe characters`);
  }
  return value;
}

/**
 * PATH with the git folder first. An unset or empty PATH gives the folder alone (never
 * `bin:`, which would add the current directory); a PATH that already starts with the
 * folder is returned as it is.
 */
export function pathWithGitBin(pathVar: string | undefined, bin: string): string {
  if (pathVar === undefined || pathVar === '') return bin;
  if (pathVar === bin || pathVar.startsWith(bin + path.delimiter)) return pathVar;
  return `${bin}${path.delimiter}${pathVar}`;
}
