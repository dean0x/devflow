/**
 * The vitest global setup (`tests/setup/global-setup.ts`): one run temp folder and, on
 * macOS, one real-git folder per run.
 *
 * Every arm runs on every platform with fakes for the process starts and the file probes,
 * except the one live arm (TP-22). Every fixture lives under the worker's `os.tmpdir()`
 * and is removed in `afterAll`; no test hands the real temp root to the sweep.
 *
 * Each refusal arm is paired with an accept arm built from the same inputs, so a check
 * that refuses everything cannot pass.
 */

import { afterAll, describe, expect, inject, it, vi } from 'vitest';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'fs';
import { isBuiltin } from 'module';
import * as os from 'os';
import * as path from 'path';
import ts from 'typescript';
import {
  chmodOwnDirs,
  firstGitOnPath,
  gitSpawnEnv,
  isOwnerAlive,
  liveRunOptions,
  removeRunRoot,
  resolveRealGit,
  startRun,
  sweepDeadRuns,
  tmpRootRefusal,
  withRecordedHome,
  type GitRouteDeps,
  type RunOptions,
  type RunResult,
  type SweepOptions,
} from './global-setup.js';
import {
  GIT_BIN_KEY,
  GIT_BIN_PREFIX,
  ORIGINAL_HOME_VAR,
  RUN_OWNER_FILE,
  RUN_ROOT_PREFIX,
  RUN_TMP_KEY,
  assertRunRoot,
  canonical,
  checkGitBinDir,
  checkRunTmp,
  realHomes,
  refusesTmpRoot,
} from './home-isolation.js';

const OWN_UID = process.getuid?.() ?? -1;
/** Pids no live process holds: above every platform's pid limit, below the int32 range. */
const DEAD_PID = 2_147_483_000;
const LIVE_PID = 2_147_482_999;
const REAL_GIT = '/fake/xcode/usr/bin/git';

/**
 * The arms that run `startRun`, the sweep, the teardown or the run root check over a fixture
 * root need a temp root that the setup itself accepts. A worker `os.tmpdir()` that
 * `tmpRootRefusal` gives a reason for (not absolute, characters outside SAFE_PATH, or a
 * filesystem root or a place inside a real home) is refused by the setup, so those arms skip
 * with that one reason. Every other arm runs on any temp root.
 */
const FIXTURE_TMP = os.tmpdir();
const FIXTURE_TMP_REFUSAL = tmpRootRefusal(FIXTURE_TMP);
const itAcceptedTmp: typeof it = FIXTURE_TMP_REFUSAL === undefined ? it : it.skip;
if (FIXTURE_TMP_REFUSAL !== undefined) {
  it.skip(`skips the fixture arms that need a temp root the setup accepts: os.tmpdir() ${FIXTURE_TMP_REFUSAL}`, () => {});
}

type DirEntries = ReadonlyMap<string, number>;

/**
 * The collector of the working folder guard: the name and the inode of each entry of `dir`,
 * read with `lstat` so a link counts as itself. Times are not read, because `.git` and
 * `node_modules` change theirs while the suite runs. An entry that goes away between the
 * listing and the `lstat` is left out.
 */
function cwdEntries(dir: string): DirEntries {
  const entries = new Map<string, number>();
  for (const name of readdirSync(dir)) {
    try {
      entries.set(name, lstatSync(path.join(dir, name)).ino);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }
  return entries;
}

/** The names in `after` that are new, or that were removed and made again (a new inode), sorted. */
function cwdResidue(before: DirEntries, after: DirEntries): string[] {
  return [...after].filter(([name, ino]) => before.get(name) !== ino).map(([name]) => name).sort();
}

// The worker cwd (the repo root) before any arm runs; the last arm proves no arm added to it.
const CWD_ENTRIES_BEFORE = cwdEntries(process.cwd());

const created: string[] = [];
function fixtureDir(prefix = 'df-gs-'): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  created.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of created) {
    chmodOwnDirs(dir, OWN_UID);
    rmSync(dir, { recursive: true, force: true });
  }
});

/** True when something is at `p`, a dangling link included. */
function present(p: string): boolean {
  try {
    lstatSync(p);
    return true;
  } catch {
    return false;
  }
}

function canList(dir: string): boolean {
  try {
    readdirSync(dir);
    return true;
  } catch {
    return false;
  }
}

/** A run root under `tmp` whose marker records `owner` (no marker when `owner` is null). */
function makeRunRoot(tmp: string, owner: number | string | null = DEAD_PID): string {
  const root = mkdtempSync(path.join(tmp, RUN_ROOT_PREFIX));
  if (owner !== null) writeFileSync(path.join(root, RUN_OWNER_FILE), `${owner}\n`);
  return root;
}

/** A run root holding a read-only git folder with one link, the shape `startRun` makes. */
function makeRootWithBin(tmp: string, owner: number | string = DEAD_PID): { root: string; bin: string } {
  const root = makeRunRoot(tmp, owner);
  const bin = mkdtempSync(path.join(root, GIT_BIN_PREFIX));
  symlinkSync(REAL_GIT, path.join(bin, 'git'));
  chmodSync(bin, 0o555);
  return { root, bin };
}

/** Folders with no read or write bits, nested, the way a stopped worker can leave them. */
function addLockedTree(root: string): string[] {
  const sealed = path.join(root, 'sealed');
  mkdirSync(sealed);
  writeFileSync(path.join(sealed, 'inner.txt'), 'x');
  const readonly = path.join(root, 'readonly');
  mkdirSync(path.join(readonly, 'nested'), { recursive: true });
  writeFileSync(path.join(readonly, 'nested', 'deep.txt'), 'x');
  chmodSync(path.join(readonly, 'nested'), 0o000);
  chmodSync(readonly, 0o555);
  chmodSync(sealed, 0o000);
  return [sealed, readonly];
}

function sweepOptions(tmp: string, overrides: Partial<SweepOptions> = {}): SweepOptions {
  return { tmpRoot: tmp, uid: OWN_UID, env: {}, isAlive: pid => pid === LIVE_PID, ...overrides };
}

function names(paths: string[]): string[] {
  return paths.map(p => path.basename(p)).sort();
}

interface GitCall {
  file: string;
  args: string[];
  env?: NodeJS.ProcessEnv;
}

const OK_XCRUN: RunResult = { status: 0, stdout: `${REAL_GIT}\n` };
const OK_VERSION: RunResult = { status: 0, stdout: 'git version 2.50.1 (Apple Git-155)\n' };

interface FakeGit {
  isExecutableFile: (p: string) => boolean;
  realpath: (p: string) => string | undefined;
  run: (file: string, args: readonly string[], env: NodeJS.ProcessEnv) => RunResult | undefined;
  calls: GitCall[];
}

/** Fake probes for the git lookup: the shim at `/usr/bin/git`, the real binary at `REAL_GIT`. */
function fakeGit(
  script: { xcrun?: RunResult | undefined; version?: RunResult | undefined; throws?: boolean } = {},
  probes: Partial<Pick<FakeGit, 'isExecutableFile' | 'realpath'>> = {},
): FakeGit {
  const calls: GitCall[] = [];
  const xcrun = 'xcrun' in script ? script.xcrun : OK_XCRUN;
  const version = 'version' in script ? script.version : OK_VERSION;
  return {
    calls,
    isExecutableFile: probes.isExecutableFile ?? (p => p === '/usr/bin/git' || p === REAL_GIT),
    realpath: probes.realpath ?? (p => p),
    run: (file, args, env) => {
      calls.push({ file, args: [...args], env });
      if (script.throws) throw new Error('boom');
      return file === '/usr/bin/xcrun' ? xcrun : version;
    },
  };
}

/** One failed-lookup case: a name, the scripted process results, the probe overrides, the starts counted. */
type LookupCase = [string, Parameters<typeof fakeGit>[0], Parameters<typeof fakeGit>[1], number];

function routeDeps(fake: FakeGit, overrides: Partial<GitRouteDeps> = {}): GitRouteDeps {
  return {
    platform: 'darwin',
    pathVar: '/usr/bin:/bin',
    checkoutRoot: '/fake/checkout',
    tmpRoot: '/fake/tmp',
    isExecutableFile: fake.isExecutableFile,
    realpath: fake.realpath,
    run: (file, args) => fake.run(file, args, {}),
    ...overrides,
  };
}

function runOptions(tmp: string, fake: FakeGit, overrides: Partial<RunOptions> = {}): RunOptions {
  return {
    tmpRoot: tmp,
    uid: OWN_UID,
    env: { TMPDIR: tmp, PATH: '/usr/bin:/bin', CLAUDE_CONFIG_DIR: '/canary', GIT_DIR: '/canary' },
    isAlive: () => true,
    platform: 'darwin',
    pathVar: '/usr/bin:/bin',
    checkoutRoot: '/fake/checkout',
    isExecutableFile: fake.isExecutableFile,
    realpath: fake.realpath,
    run: fake.run,
    ...overrides,
  };
}

function recorder(failOn?: string) {
  const provided = new Map<string, unknown>();
  const project = {
    provide: (key: string, value: unknown) => {
      if (key === failOn) throw new Error(`provide ${key} failed`);
      provided.set(key, value);
    },
  };
  return { provided, project };
}

/**
 * A provided path. Throws unless it is an absolute path, so a run that provided nothing
 * fails here and no later step creates, links or removes a relative path in the cwd.
 */
function providedPath(provided: Map<string, unknown>, key: string): string {
  const value = provided.get(key);
  if (typeof value !== 'string' || !path.isAbsolute(value)) {
    throw new Error(`${key} was not provided as an absolute path: ${String(value)}`);
  }
  return value;
}

function warnSpy() {
  return vi.spyOn(console, 'warn').mockImplementation(() => undefined);
}

describe('TP-18: the git lookup starts nothing off macOS', () => {
  it('gives the real git on darwin after exactly two process starts', () => {
    const fake = fakeGit();
    expect(resolveRealGit(routeDeps(fake))).toBe(REAL_GIT);
    expect(fake.calls.map(c => [c.file, c.args])).toEqual([
      ['/usr/bin/xcrun', ['--find', 'git']],
      [REAL_GIT, ['--version']],
    ]);
  });

  it.each(['linux', 'win32', 'freebsd', ''])('gives nothing on %j and starts no process', platform => {
    const fake = fakeGit();
    expect(resolveRealGit(routeDeps(fake, { platform }))).toBeUndefined();
    expect(fake.calls).toEqual([]);
  });

  itAcceptedTmp('startRun on linux makes the run root only: no process, no xcrun home, no git folder', () => {
    const tmp = fixtureDir();
    const fake = fakeGit();
    const { project, provided } = recorder();
    const warn = warnSpy();
    const teardown = startRun(project, runOptions(tmp, fake, { platform: 'linux' }));

    expect([...provided.keys()]).toEqual([RUN_TMP_KEY]);
    expect(fake.calls).toEqual([]);
    const root = providedPath(provided, RUN_TMP_KEY);
    expect(readdirSync(root)).toEqual([RUN_OWNER_FILE]);
    expect(warn).not.toHaveBeenCalled();
    teardown();
  });
});

describe('TP-19: the git lookup needs /usr/bin/git first on PATH', () => {
  const GIT_ON_PATH = (p: string): boolean => p === '/usr/bin/git' || p === REAL_GIT || p === '/opt/brew/bin/git';

  it('another git first on PATH gives nothing and starts no process', () => {
    const fake = fakeGit({}, { isExecutableFile: GIT_ON_PATH });
    expect(resolveRealGit(routeDeps(fake, { pathVar: '/opt/brew/bin:/usr/bin' }))).toBeUndefined();
    expect(fake.calls).toEqual([]);
  });

  it.each([
    ['an empty entry', '/opt/other::/usr/bin'],
    ['a leading empty entry', ':/usr/bin'],
    ['a relative entry', 'bin:/usr/bin'],
    ['a dot entry', '.:/usr/bin'],
    ['an empty PATH', ''],
    ['no git on PATH', '/bin:/sbin'],
  ])('%s before the first git gives nothing and starts no process', (_name, pathVar) => {
    const fake = fakeGit();
    expect(resolveRealGit(routeDeps(fake, { pathVar }))).toBeUndefined();
    expect(fake.calls).toEqual([]);
  });

  it('an unset PATH gives nothing and starts no process', () => {
    const fake = fakeGit();
    expect(resolveRealGit(routeDeps(fake, { pathVar: undefined }))).toBeUndefined();
    expect(fake.calls).toEqual([]);
  });

  it('entries without a git are skipped, so the shim is still found behind them', () => {
    const fake = fakeGit();
    expect(resolveRealGit(routeDeps(fake, { pathVar: '/opt/none/bin:/usr/bin:/bin' }))).toBe(REAL_GIT);
    expect(fake.calls).toHaveLength(2);
  });

  it('firstGitOnPath walks PATH in order and ends the walk at an empty or relative entry', () => {
    const has = (p: string): boolean => p === '/a/git' || p === '/b/git';
    expect(firstGitOnPath('/x:/a:/b', has)).toBe('/a/git');
    expect(firstGitOnPath('/x:/b/:/a', has)).toBe('/b/git');
    expect(firstGitOnPath('/x::/a', has)).toBeUndefined();
    expect(firstGitOnPath('/x:rel:/a', has)).toBeUndefined();
    expect(firstGitOnPath('/x:/y', has)).toBeUndefined();
    expect(firstGitOnPath(undefined, has)).toBeUndefined();
    expect(firstGitOnPath('', has)).toBeUndefined();
  });
});

describe('TP-20: each failed lookup check gives nothing', () => {
  const anyFile = { isExecutableFile: () => true };

  const cases: LookupCase[] = [
    ['xcrun exits non-zero', { xcrun: { status: 1, stdout: '' } }, {}, 1],
    ['xcrun cannot start', { xcrun: undefined }, {}, 1],
    ['xcrun prints nothing', { xcrun: { status: 0, stdout: '\n' } }, {}, 1],
    ['xcrun prints a relative path', { xcrun: { status: 0, stdout: 'usr/bin/git\n' } }, {}, 1],
    ['xcrun prints two lines', { xcrun: { status: 0, stdout: `${REAL_GIT}\n/other/usr/bin/git\n` } }, {}, 1],
    ['xcrun prints unsafe characters', { xcrun: { status: 0, stdout: '/fake/my xcode/usr/bin/git\n' } }, anyFile, 1],
    ['the path cannot be resolved', {}, { realpath: () => undefined }, 1],
    ['the file is not an executable file', {}, { isExecutableFile: (p: string) => p === '/usr/bin/git' }, 1],
    ['the file is not named git', { xcrun: { status: 0, stdout: '/fake/xcode/usr/bin/gitx\n' } }, anyFile, 1],
    ['the file is the shim', { xcrun: { status: 0, stdout: '/usr/bin/git\n' } }, anyFile, 1],
    ['the file is under the checkout', { xcrun: { status: 0, stdout: '/fake/checkout/node_modules/.bin/git\n' } }, anyFile, 1],
    ['the file is under the temp root', { xcrun: { status: 0, stdout: '/fake/tmp/x/git\n' } }, anyFile, 1],
    ['a link resolves into the checkout', {}, { realpath: () => '/fake/checkout/git' }, 1],
    ['--version exits non-zero', { version: { status: 1, stdout: 'git version 2\n' } }, {}, 2],
    ['--version cannot start', { version: undefined }, {}, 2],
    ['--version prints something else', { version: { status: 0, stdout: 'not git\n' } }, {}, 2],
  ];

  it.each(cases)('%s', (_name, script, probes, expectedStarts) => {
    const fake = fakeGit(script, probes);
    expect(resolveRealGit(routeDeps(fake))).toBeUndefined();
    expect(fake.calls).toHaveLength(expectedStarts);
  });

  it('accepts the same inputs when nothing is wrong, and links to the resolved real path', () => {
    const fake = fakeGit(
      { xcrun: { status: 0, stdout: '/fake/xcode/link/git\n' } },
      { isExecutableFile: () => true, realpath: p => (p === '/fake/xcode/link/git' ? REAL_GIT : p) },
    );
    expect(resolveRealGit(routeDeps(fake))).toBe(REAL_GIT);
    expect(fake.calls).toHaveLength(2);
    expect(fake.calls[1]).toMatchObject({ file: REAL_GIT, args: ['--version'] });
  });
});

const IS_MAC_WITH_XCRUN = process.platform === 'darwin' && existsSync('/usr/bin/xcrun');

describe('TP-22: the live lookup on this Mac', () => {
  it.skipIf(!IS_MAC_WITH_XCRUN)('gives an absolute real git that is not the shim', () => {
    const live = liveRunOptions();
    const xcrunHome = fixtureDir('df-gs-xcrun-');
    const real = resolveRealGit({
      platform: live.platform,
      pathVar: '/usr/bin:/bin',
      checkoutRoot: live.checkoutRoot,
      tmpRoot: live.tmpRoot,
      isExecutableFile: live.isExecutableFile,
      realpath: live.realpath,
      run: (file, args) => live.run(file, args, gitSpawnEnv(process.env, xcrunHome)),
    });

    expect(real, 'xcrun found no real git').toBeDefined();
    expect(path.isAbsolute(real ?? '')).toBe(true);
    expect(real).not.toBe('/usr/bin/git');
    expect(path.basename(real ?? '')).toBe('git');
    expect(statSync(real ?? '').isFile()).toBe(true);
  });
});

/**
 * What the main process gave the global setup, as far as this worker can still see it: its
 * temp root is the parent of a provided run root, and its PATH is this PATH without a
 * provided git folder. Another git first on PATH (Homebrew, for example) or an unusable
 * TMPDIR is a normal setup that provides nothing, so the arms below skip only when these
 * inputs call for nothing and nothing was provided.
 */
const providedRunTmp = inject(RUN_TMP_KEY);
const providedGitBin = inject(GIT_BIN_KEY);
const MAIN_TMP = providedRunTmp === undefined ? os.tmpdir() : path.dirname(providedRunTmp);
const MAIN_PATH = (process.env.PATH ?? '')
  .split(path.delimiter)
  .filter(entry => entry !== providedGitBin)
  .join(path.delimiter);
/** The first checks of `startRunRoot`, over the main process's inputs. */
const SETUP_WANTS_RUN_ROOT =
  Boolean(process.env.TMPDIR) && process.getuid !== undefined && tmpRootRefusal(MAIN_TMP) === undefined;
/** The checks of `resolveRealGit` that start no process, over the main process's PATH. */
const SETUP_WANTS_GIT_BIN =
  SETUP_WANTS_RUN_ROOT &&
  IS_MAC_WITH_XCRUN &&
  firstGitOnPath(MAIN_PATH, liveRunOptions().isExecutableFile) === '/usr/bin/git';

describe('TP-22: what the live global setup provided to this worker', () => {
  it.skipIf(providedRunTmp === undefined && !SETUP_WANTS_RUN_ROOT)('provides a run root that passes the run root check', () => {
    const root = inject(RUN_TMP_KEY);
    expect(root, 'the global setup provided no run root').toBeDefined();
    expect(checkRunTmp(root)).toBe(root);
  });

  it.skipIf(providedGitBin === undefined && !SETUP_WANTS_GIT_BIN)('provides a git folder that passes the git folder check', () => {
    const bin = inject(GIT_BIN_KEY);
    expect(bin, 'the global setup provided no git folder').toBeDefined();
    expect(checkGitBinDir(bin, checkRunTmp(inject(RUN_TMP_KEY)))).toBe(bin);
    expect(readlinkSync(path.join(bin ?? '', 'git'))).not.toBe('/usr/bin/git');
  });
});

describe('TP-27: the lookup spawn env holds only the allowed keys', () => {
  const parent: NodeJS.ProcessEnv = {
    PATH: '/usr/bin:/bin',
    TMPDIR: '/var/folders/x/T',
    DEVELOPER_DIR: '/Applications/Xcode.app/Contents/Developer',
    HOME: '/Users/someone',
    CLAUDE_CONFIG_DIR: '/canary/claude',
    GIT_DIR: '/canary/git',
    DEVFLOW_DIR: '/canary/devflow',
    SSH_AUTH_SOCK: '/canary/agent',
  };

  it('keeps PATH, TMPDIR and DEVELOPER_DIR and pins the rest, whatever the parent holds', () => {
    expect(gitSpawnEnv(parent, '/tmp/xcrun-home')).toEqual({
      PATH: '/usr/bin:/bin',
      TMPDIR: '/var/folders/x/T',
      DEVELOPER_DIR: '/Applications/Xcode.app/Contents/Developer',
      HOME: '/tmp/xcrun-home',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null',
    });
  });

  it('adds no key for a variable the parent does not set, and leaves the parent untouched', () => {
    const bare: NodeJS.ProcessEnv = { PATH: '/usr/bin', GIT_DIR: '/canary/git' };
    const env = gitSpawnEnv(bare, '/tmp/xcrun-home');
    expect(Object.keys(env).sort()).toEqual(['GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM', 'HOME', 'PATH']);
    expect(bare).toEqual({ PATH: '/usr/bin', GIT_DIR: '/canary/git' });
  });
});

describe('TP-24: the run root and temp root checks', () => {
  const tmp = fixtureDir();
  const good = makeRunRoot(tmp);
  const own = { uid: OWN_UID, env: {} };
  const nested = path.join(tmp, 'sub');
  mkdirSync(nested);
  const deepRoot = path.join(nested, `${RUN_ROOT_PREFIX}deep`);
  mkdirSync(deepRoot);
  const link = path.join(tmp, `${RUN_ROOT_PREFIX}link`);
  symlinkSync(good, link);
  const plainFile = path.join(tmp, `${RUN_ROOT_PREFIX}file`);
  writeFileSync(plainFile, 'x');

  itAcceptedTmp('accepts a fresh own run root', () => {
    expect(() => assertRunRoot(good, tmp, own)).not.toThrow();
  });

  it.each([
    ['a relative path', `${RUN_ROOT_PREFIX}abc`, /absolute path of safe characters/],
    ['unsafe characters', path.join(tmp, `${RUN_ROOT_PREFIX}a b`), /safe characters/],
  ])('refuses %s', (_name, root, message) => {
    expect(() => assertRunRoot(root, tmp, own)).toThrow(message);
  });

  itAcceptedTmp.each([
    ['an unnormalised path', `${good}/`, /normalised/],
    ['a wrong prefix', path.join(tmp, 'other-abc'), /does not start with/],
    ['the bare prefix', path.join(tmp, RUN_ROOT_PREFIX), /does not start with/],
    ['a folder that is not a direct child of the temp root', deepRoot, /direct child/],
    ['a folder that does not exist', path.join(tmp, `${RUN_ROOT_PREFIX}missing`), /cannot be inspected/],
    ['a link', link, /not a real directory/],
    ['a plain file', plainFile, /not a real directory/],
  ])('refuses %s', (_name, root, message) => {
    expect(() => assertRunRoot(root, tmp, own)).toThrow(message);
  });

  itAcceptedTmp('refuses a foreign owner and a missing uid', () => {
    expect(() => assertRunRoot(good, tmp, { uid: OWN_UID + 1, env: {} })).toThrow(/not owned by the current user/);
    expect(() => assertRunRoot(good, tmp, { uid: undefined, env: {} })).toThrow(/not owned by the current user/);
  });

  itAcceptedTmp('refuses a run root that is a real home', () => {
    expect(() => assertRunRoot(good, tmp, { uid: OWN_UID, env: { [ORIGINAL_HOME_VAR]: good } })).toThrow(
      /real home/,
    );
  });

  itAcceptedTmp('refuses every root when the temp root is the filesystem root or inside a real home', () => {
    expect(() => assertRunRoot(path.join('/', `${RUN_ROOT_PREFIX}x`), '/', own)).toThrow(/filesystem root/);
    expect(() => assertRunRoot(good, tmp, { uid: OWN_UID, env: { [ORIGINAL_HOME_VAR]: tmp } })).toThrow(
      /inside a real home/,
    );
  });

  it('refusesTmpRoot: the filesystem root, a real home and a folder under one are refused', () => {
    expect(refusesTmpRoot('/', {})).toBe(true);
    expect(refusesTmpRoot(tmp, { [ORIGINAL_HOME_VAR]: tmp })).toBe(true);
    expect(refusesTmpRoot(nested, { [ORIGINAL_HOME_VAR]: tmp })).toBe(true);
    for (const home of realHomes()) {
      expect(refusesTmpRoot(home, {}), home).toBe(true);
      expect(refusesTmpRoot(path.join(home, 'tmp'), {}), home).toBe(true);
    }
  });

  itAcceptedTmp('refusesTmpRoot: an ordinary temp folder is accepted', () => {
    expect(refusesTmpRoot(tmp, {})).toBe(false);
    expect(refusesTmpRoot(tmp, { [ORIGINAL_HOME_VAR]: nested })).toBe(false);
  });
});

describe('the temp root refusal: one function for the setup and for the skip conditions', () => {
  const home = '/df-gs-home';
  const REFUSED_BY_HOME = 'is the filesystem root or inside a real home';
  /** A refused temp root, its reason, and the env that makes it refused. None of these folders exists. */
  const REFUSED: Array<[string, string, string, NodeJS.ProcessEnv]> = [
    ['a relative path', 'df-gs-no-such-folder/tmp', 'is not an absolute path', {}],
    ['characters outside the safe set', '/df-gs-no-such-folder/a b', 'holds characters outside the safe set', {}],
    ['the filesystem root', '/', REFUSED_BY_HOME, {}],
    ['a real home', home, REFUSED_BY_HOME, { [ORIGINAL_HOME_VAR]: home }],
    ['a folder inside a real home', `${home}/tmp`, REFUSED_BY_HOME, { [ORIGINAL_HOME_VAR]: home }],
  ];

  it.each(REFUSED)('known-bad probe: %s gets its reason, and startRun makes nothing in it', (_name, tmpRoot, reason, homeEnv) => {
    expect(tmpRootRefusal(tmpRoot, homeEnv)).toBe(reason);
    const fake = fakeGit();
    const { project, provided } = recorder();

    const teardown = startRun(project, runOptions(tmpRoot, fake, { env: { TMPDIR: tmpRoot, ...homeEnv } }));

    expect(provided.size).toBe(0);
    expect(fake.calls).toEqual([]);
    expect(() => teardown()).not.toThrow();
  });

  itAcceptedTmp('accept arm: an ordinary temp folder gets no reason, and startRun makes a run root in it', () => {
    const tmp = fixtureDir();
    expect(tmpRootRefusal(tmp, {})).toBeUndefined();
    const { project, provided } = recorder();

    const teardown = startRun(project, runOptions(tmp, fakeGit(), { platform: 'linux' }));

    expect(provided.has(RUN_TMP_KEY)).toBe(true);
    teardown();
  });
});

describe('TP-9:teardown removes the run root with its read-only git folder', () => {
  itAcceptedTmp('removes the root, and the git folder was read-only before', () => {
    const tmp = fixtureDir();
    const { root, bin } = makeRootWithBin(tmp);
    expect(lstatSync(bin).mode & 0o222, 'the fixture git folder must start read-only').toBe(0);
    const warn = warnSpy();

    expect(removeRunRoot(root, tmp, { uid: OWN_UID, env: {} })).toBe(true);

    expect(present(root)).toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('TP-26: teardown refuses a stored path that fails the run root rules', () => {
  const tmp = fixtureDir();
  const other = fixtureDir();
  const own = { uid: OWN_UID, env: {} };

  function folderWithFile(dir: string, name: string): { folder: string; file: string } {
    const folder = path.join(dir, name);
    mkdirSync(folder);
    const file = path.join(folder, 'keep.txt');
    writeFileSync(file, 'x');
    return { folder, file };
  }

  itAcceptedTmp('deletes a good root (accept arm for the refusals below)', () => {
    const root = makeRunRoot(tmp);
    expect(removeRunRoot(root, tmp, own)).toBe(true);
    expect(present(root)).toBe(false);
  });

  itAcceptedTmp('refuses a wrong name and deletes nothing', () => {
    const { folder, file } = folderWithFile(tmp, 'not-a-run-root');
    expect(() => removeRunRoot(folder, tmp, own)).toThrow(/does not start with/);
    expect(present(file)).toBe(true);
  });

  itAcceptedTmp('refuses a root of another temp folder and deletes nothing', () => {
    const { folder, file } = folderWithFile(other, `${RUN_ROOT_PREFIX}elsewhere`);
    expect(() => removeRunRoot(folder, tmp, own)).toThrow(/direct child/);
    expect(present(file)).toBe(true);
  });

  itAcceptedTmp('refuses a link and deletes neither the link nor its target', () => {
    const { folder, file } = folderWithFile(other, 'link-target');
    const link = path.join(tmp, `${RUN_ROOT_PREFIX}linked`);
    symlinkSync(folder, link);
    expect(() => removeRunRoot(link, tmp, own)).toThrow(/not a real directory/);
    expect(present(link)).toBe(true);
    expect(present(file)).toBe(true);
  });

  itAcceptedTmp('refuses a real home and deletes nothing', () => {
    const { folder, file } = folderWithFile(tmp, `${RUN_ROOT_PREFIX}home`);
    expect(() => removeRunRoot(folder, tmp, { uid: OWN_UID, env: { [ORIGINAL_HOME_VAR]: folder } })).toThrow(
      /real home/,
    );
    expect(present(file)).toBe(true);
  });

  it('refuses the filesystem root as the temp root', () => {
    expect(() => removeRunRoot(path.join('/', `${RUN_ROOT_PREFIX}x`), '/', own)).toThrow(/filesystem root/);
  });
});

describe('isOwnerAlive', () => {
  it('is true for this process and false for a pid no process holds', () => {
    expect(isOwnerAlive(process.pid)).toBe(true);
    expect(isOwnerAlive(DEAD_PID)).toBe(false);
  });

  it('is true for every answer that is not ESRCH: a process of another user, a pid out of range', () => {
    expect(isOwnerAlive(1)).toBe(true);
    expect(isOwnerAlive(9_999_999_999)).toBe(true);
  });
});

describe('TP-25: the sweep keeps everything that is not a dead own run root', () => {
  const tmp = fixtureDir();
  const outside = fixtureDir();
  const dead = makeRunRoot(tmp, DEAD_PID);
  const live = makeRunRoot(tmp, LIVE_PID);
  const noMarker = makeRunRoot(tmp, null);
  const badMarkers = ['abc', '0', '-5', '12 34', '', `${DEAD_PID}\nextra`, `${DEAD_PID}${DEAD_PID}`].map(text =>
    makeRunRoot(tmp, text),
  );
  const markerTarget = path.join(outside, 'pid');
  writeFileSync(markerTarget, `${DEAD_PID}\n`);
  const linkedMarker = makeRunRoot(tmp, null);
  symlinkSync(markerTarget, path.join(linkedMarker, RUN_OWNER_FILE));
  const prefixedLink = path.join(tmp, `${RUN_ROOT_PREFIX}link`);
  const linkTarget = path.join(outside, 'target');
  mkdirSync(linkTarget);
  writeFileSync(path.join(linkTarget, RUN_OWNER_FILE), `${DEAD_PID}\n`);
  symlinkSync(linkTarget, prefixedLink);
  const prefixedFile = path.join(tmp, `${RUN_ROOT_PREFIX}file`);
  writeFileSync(prefixedFile, `${DEAD_PID}\n`);
  const unprefixed = path.join(tmp, 'other-dir');
  mkdirSync(unprefixed);
  writeFileSync(path.join(unprefixed, RUN_OWNER_FILE), `${DEAD_PID}\n`);
  const removed = sweepDeadRuns(sweepOptions(tmp));

  itAcceptedTmp('removes the dead own root: the sweep is not a no-op', () => {
    expect(names(removed)).toEqual([path.basename(dead)]);
    expect(present(dead)).toBe(false);
  });

  it('keeps a root with a live owner, no marker, a linked marker or a malformed marker', () => {
    for (const kept of [live, noMarker, linkedMarker, ...badMarkers]) expect(present(kept), kept).toBe(true);
  });

  it('keeps prefixed links, prefixed files and unprefixed folders, and what they point at', () => {
    for (const kept of [prefixedLink, prefixedFile, unprefixed, linkTarget, markerTarget]) {
      expect(present(kept), kept).toBe(true);
    }
  });

  it('keeps a dead root that a foreign owner holds', () => {
    const foreignTmp = fixtureDir();
    const foreign = makeRunRoot(foreignTmp, DEAD_PID);
    expect(sweepDeadRuns(sweepOptions(foreignTmp, { uid: OWN_UID + 1 }))).toEqual([]);
    expect(present(foreign)).toBe(true);
  });

  it('does nothing when the temp root is inside a real home', () => {
    const homeTmp = fixtureDir();
    const root = makeRunRoot(homeTmp, DEAD_PID);
    expect(sweepDeadRuns(sweepOptions(homeTmp, { env: { [ORIGINAL_HOME_VAR]: homeTmp } }))).toEqual([]);
    expect(present(root)).toBe(true);
  });

  itAcceptedTmp('stops at the removal limit', () => {
    const limitTmp = fixtureDir();
    const roots = [makeRunRoot(limitTmp), makeRunRoot(limitTmp)];
    expect(sweepDeadRuns(sweepOptions(limitTmp, { removeLimit: 1 }))).toHaveLength(1);
    expect(roots.filter(present)).toHaveLength(1);
  });

  itAcceptedTmp('stops at the scan limit', () => {
    const scanTmp = fixtureDir();
    const roots = Array.from({ length: 5 }, () => makeRunRoot(scanTmp));
    expect(sweepDeadRuns(sweepOptions(scanTmp, { scanLimit: 2 }))).toHaveLength(2);
    expect(roots.filter(present)).toHaveLength(3);
  });
});

describe('TP-10: a later start removes a run root whose owner is dead', () => {
  itAcceptedTmp('removes the dead root, keeps the one this process owns, and makes its own', () => {
    const tmp = fixtureDir();
    const dead = makeRunRoot(tmp, DEAD_PID);
    const mine = makeRunRoot(tmp, process.pid);
    const { project, provided } = recorder();

    const teardown = startRun(project, runOptions(tmp, fakeGit(), { isAlive: isOwnerAlive }));

    expect(present(dead)).toBe(false);
    expect(present(mine)).toBe(true);
    expect(present(providedPath(provided, RUN_TMP_KEY))).toBe(true);
    teardown();
  });
});

describe('TP-34: a root holding folders with no read or write bits is removed', () => {
  itAcceptedTmp('teardown removes it', () => {
    const tmp = fixtureDir();
    const { project, provided } = recorder();
    const warn = warnSpy();
    const teardown = startRun(project, runOptions(tmp, fakeGit()));
    const root = providedPath(provided, RUN_TMP_KEY);
    const locked = addLockedTree(root);
    expect(OWN_UID === 0 || !canList(locked[0] ?? ''), 'the fixture must hide a folder').toBe(true);

    teardown();

    expect(present(root)).toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });

  itAcceptedTmp('the sweep removes it', () => {
    const tmp = fixtureDir();
    const { root } = makeRootWithBin(tmp, DEAD_PID);
    const locked = addLockedTree(root);
    expect(OWN_UID === 0 || !canList(locked[0] ?? ''), 'the fixture must hide a folder').toBe(true);

    expect(names(sweepDeadRuns(sweepOptions(tmp)))).toEqual([path.basename(root)]);

    expect(present(root)).toBe(false);
  });
});

describe('TP-34: the permission walk is bounded and fixes only own folders', () => {
  /** A root with one read-only folder below it; returns that folder. */
  function rootWithReadonlyChild(): { root: string; child: string } {
    const root = fixtureDir();
    const child = path.join(root, 'readonly');
    mkdirSync(child);
    chmodSync(child, 0o555);
    return { root, child };
  }

  const modeOf = (p: string): number => lstatSync(p).mode & 0o777;

  it('gives every own folder owner rights back when the limit leaves room (accept arm)', () => {
    const { root, child } = rootWithReadonlyChild();
    expect(chmodOwnDirs(root, OWN_UID)).toEqual([]);
    expect(modeOf(child)).toBe(0o700);
  });

  it('stops at the entry limit, says so, and leaves the rest as it was', () => {
    const { root, child } = rootWithReadonlyChild();
    expect(chmodOwnDirs(root, OWN_UID, 1)).toEqual([`stopped walking ${root} after 1 entries`]);
    expect(modeOf(child)).toBe(0o555);
  });

  it('changes nothing without a uid or for a folder of another owner', () => {
    const { root, child } = rootWithReadonlyChild();
    expect(chmodOwnDirs(root, undefined)).toEqual([]);
    expect(chmodOwnDirs(root, OWN_UID + 1)).toEqual([]);
    expect(modeOf(child)).toBe(0o555);
  });
});

describe('TP-33: the returned teardown never throws', () => {
  itAcceptedTmp('removes the root and prints nothing when all goes well', () => {
    const tmp = fixtureDir();
    const { project, provided } = recorder();
    const warn = warnSpy();
    const teardown = startRun(project, runOptions(tmp, fakeGit()));

    expect(() => teardown()).not.toThrow();

    expect(present(providedPath(provided, RUN_TMP_KEY))).toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });

  itAcceptedTmp('when the removal fails, it retries once, prints one line and does not throw', () => {
    const tmp = fixtureDir();
    const { project, provided } = recorder();
    const warn = warnSpy();
    const rm = vi.fn((_target: string) => {
      throw new Error('ENOTEMPTY: directory not empty');
    });
    const teardown = startRun(project, runOptions(tmp, fakeGit(), { rm }));

    expect(() => teardown()).not.toThrow();

    expect(rm).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('ENOTEMPTY');
    expect(present(providedPath(provided, RUN_TMP_KEY))).toBe(true);
  });

  itAcceptedTmp('when the stored root fails the run root rules, it prints one line and deletes nothing', () => {
    const tmp = fixtureDir();
    const target = fixtureDir();
    writeFileSync(path.join(target, 'keep.txt'), 'x');
    const { project, provided } = recorder();
    const warn = warnSpy();
    const teardown = startRun(project, runOptions(tmp, fakeGit()));
    const root = providedPath(provided, RUN_TMP_KEY);
    chmodOwnDirs(root, OWN_UID);
    rmSync(root, { recursive: true, force: true });
    symlinkSync(target, root);

    expect(() => teardown()).not.toThrow();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(present(path.join(target, 'keep.txt'))).toBe(true);
  });
});

describe('TP-29: a started run makes the root and the read-only git folder', () => {
  itAcceptedTmp('provides both keys, records the owner and links to the absolute real path', () => {
    const tmp = fixtureDir();
    const fake = fakeGit();
    const options = runOptions(tmp, fake);
    const envBefore = { ...options.env };
    const processEnvBefore = { ...process.env };
    const { project, provided } = recorder();

    const teardown = startRun(project, options);

    expect([...provided.keys()]).toEqual([RUN_TMP_KEY, GIT_BIN_KEY]);
    const root = providedPath(provided, RUN_TMP_KEY);
    const bin = providedPath(provided, GIT_BIN_KEY);
    expect(() => assertRunRoot(root, tmp, { uid: OWN_UID, env: {} })).not.toThrow();
    expect(readFileSync(path.join(root, RUN_OWNER_FILE), 'utf8')).toBe(`${process.pid}\n`);
    expect(lstatSync(path.join(root, RUN_OWNER_FILE)).mode & 0o777).toBe(0o600);

    expect(path.dirname(bin)).toBe(root);
    expect(path.basename(bin).startsWith(GIT_BIN_PREFIX)).toBe(true);
    expect(readdirSync(bin)).toEqual(['git']);
    expect(lstatSync(path.join(bin, 'git')).isSymbolicLink()).toBe(true);
    expect(readlinkSync(path.join(bin, 'git'))).toBe(REAL_GIT);
    expect(lstatSync(bin).mode & 0o222).toBe(0);
    expect(checkGitBinDir(bin, root, { uid: OWN_UID })).toBe(bin);

    expect(options.env).toEqual(envBefore);
    expect({ ...process.env }).toEqual(processEnvBefore);

    teardown();
    expect(readdirSync(tmp)).toEqual([]);
  });

  itAcceptedTmp('starts the lookups with a spawn env that holds only the allowed keys, HOME under the run root', () => {
    const tmp = fixtureDir();
    const fake = fakeGit();
    const { project, provided } = recorder();

    const teardown = startRun(project, runOptions(tmp, fake));

    expect(fake.calls.map(c => [c.file, c.args])).toEqual([
      ['/usr/bin/xcrun', ['--find', 'git']],
      [REAL_GIT, ['--version']],
    ]);
    const root = providedPath(provided, RUN_TMP_KEY);
    for (const call of fake.calls) {
      expect(Object.keys(call.env ?? {}).sort()).toEqual([
        'GIT_CONFIG_GLOBAL',
        'GIT_CONFIG_NOSYSTEM',
        'HOME',
        'PATH',
        'TMPDIR',
      ]);
      expect(path.dirname(call.env?.HOME ?? '')).toBe(root);
    }
    teardown();
  });
});

describe('TP-31: without a TMPDIR in the main process no run root is made', () => {
  it.each([
    ['no TMPDIR key', {}],
    ['an empty TMPDIR', { TMPDIR: '' }],
  ])('%s: nothing is made, provided or started, and the teardown does nothing', (_name, env) => {
    const tmp = fixtureDir();
    const fake = fakeGit();
    const options = runOptions(tmp, fake, { env: { ...env } });
    const { project, provided } = recorder();

    const teardown = startRun(project, options);

    expect(provided.size).toBe(0);
    expect(fake.calls).toEqual([]);
    expect(readdirSync(tmp)).toEqual([]);
    expect(options.env.TMPDIR === undefined || options.env.TMPDIR === '').toBe(true);
    expect('TMPDIR' in options.env).toBe('TMPDIR' in env);
    expect(() => teardown()).not.toThrow();
    expect(readdirSync(tmp)).toEqual([]);
  });

  it('a temp root inside a real home is refused the same way', () => {
    const tmp = fixtureDir();
    const fake = fakeGit();
    const { project, provided } = recorder();

    const teardown = startRun(
      project,
      runOptions(tmp, fake, { env: { TMPDIR: tmp, [ORIGINAL_HOME_VAR]: tmp } }),
    );

    expect(provided.size).toBe(0);
    expect(readdirSync(tmp)).toEqual([]);
    expect(() => teardown()).not.toThrow();
  });

  itAcceptedTmp('a temp root inside the main process HOME is refused, as the worker would refuse it', () => {
    const tmp = fixtureDir();
    const elsewhere = fixtureDir();
    const inside = recorder();
    const outside = recorder();

    const refused = startRun(inside.project, runOptions(tmp, fakeGit(), { env: { TMPDIR: tmp, HOME: tmp } }));
    const made = startRun(outside.project, runOptions(tmp, fakeGit(), { env: { TMPDIR: tmp, HOME: elsewhere } }));

    expect(inside.provided.size).toBe(0);
    expect(outside.provided.has(RUN_TMP_KEY)).toBe(true);
    expect(withRecordedHome({ HOME: tmp })).toEqual({ HOME: tmp, [ORIGINAL_HOME_VAR]: tmp });
    expect(withRecordedHome({ HOME: tmp, [ORIGINAL_HOME_VAR]: elsewhere })).toEqual({ HOME: tmp, [ORIGINAL_HOME_VAR]: elsewhere });
    refused();
    made();
  });

  itAcceptedTmp('with a TMPDIR the run root is made (accept arm)', () => {
    const tmp = fixtureDir();
    const { project, provided } = recorder();
    const teardown = startRun(project, runOptions(tmp, fakeGit(), { platform: 'linux' }));
    expect(provided.has(RUN_TMP_KEY)).toBe(true);
    teardown();
  });
});

describe('TP-32: a failed git routing step keeps the run root and provides no git folder', () => {
  itAcceptedTmp('a failed lookup keeps the root, makes no git folder and prints one line', () => {
    const tmp = fixtureDir();
    const warn = warnSpy();
    const { project, provided } = recorder();

    const teardown = startRun(project, runOptions(tmp, fakeGit({ throws: true })));

    expect([...provided.keys()]).toEqual([RUN_TMP_KEY]);
    const root = providedPath(provided, RUN_TMP_KEY);
    expect(present(root)).toBe(true);
    expect(readdirSync(root).filter(n => n.startsWith(GIT_BIN_PREFIX))).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('boom');
    teardown();
  });

  itAcceptedTmp('a failure after the git folder exists removes the folder and provides nothing for git', () => {
    const tmp = fixtureDir();
    const warn = warnSpy();
    let binExistedAtFailure = false;
    const { provided } = recorder();
    const project = {
      provide: (key: string, value: unknown) => {
        if (key === GIT_BIN_KEY) {
          binExistedAtFailure = existsSync(String(value));
          throw new Error('provide failed');
        }
        provided.set(key, value);
      },
    };

    const teardown = startRun(project, runOptions(tmp, fakeGit()));

    expect(binExistedAtFailure, 'the git folder must exist when the failure happens').toBe(true);
    expect([...provided.keys()]).toEqual([RUN_TMP_KEY]);
    const root = providedPath(provided, RUN_TMP_KEY);
    expect(present(root)).toBe(true);
    expect(readdirSync(root).filter(n => n.startsWith(GIT_BIN_PREFIX))).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    teardown();
    expect(present(root)).toBe(false);
  });
});

/**
 * TP-28: the setup files load nothing but what their allowlist names. A setup file shares
 * the test file's module graph, and globalSetup runs in the main process, which has no
 * vitest worker state: a runtime import of `vitest` there throws at start.
 */
interface ImportRef {
  specifier: string;
  typeOnly: boolean;
}

/** The collector both the guard and its probes call: every module a source names. */
function setupImportSpecifiers(source: string): ImportRef[] {
  const file = ts.createSourceFile('setup.ts', source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const refs: ImportRef[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      refs.push({ specifier: node.moduleSpecifier.text, typeOnly: node.importClause?.isTypeOnly === true });
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      refs.push({ specifier: node.moduleSpecifier.text, typeOnly: node.isTypeOnly });
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      ts.isStringLiteral(node.moduleReference.expression)
    ) {
      refs.push({ specifier: node.moduleReference.expression.text, typeOnly: node.isTypeOnly });
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
    ) {
      const arg = node.arguments[0];
      refs.push({ specifier: arg && ts.isStringLiteralLike(arg) ? arg.text : '<computed>', typeOnly: false });
    } else if (ts.isImportTypeNode(node)) {
      const literal = ts.isLiteralTypeNode(node.argument) ? node.argument.literal : undefined;
      refs.push({ specifier: literal && ts.isStringLiteral(literal) ? literal.text : '<computed>', typeOnly: true });
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return refs;
}

interface ImportAllowlist {
  runtime: (specifier: string) => boolean;
  /** Modules allowed in `import type` form only. */
  typeOnly: (specifier: string) => boolean;
}

function importViolations(source: string, allow: ImportAllowlist): string[] {
  return setupImportSpecifiers(source).flatMap(ref => {
    const ok = ref.typeOnly ? allow.runtime(ref.specifier) || allow.typeOnly(ref.specifier) : allow.runtime(ref.specifier);
    return ok ? [] : [`${ref.typeOnly ? 'type ' : ''}import of ${ref.specifier}`];
  });
}

const NONE = (): boolean => false;
const ALLOWLISTS: Record<string, ImportAllowlist> = {
  'global-setup.ts': {
    runtime: s => isBuiltin(s) || s === './home-isolation.js',
    typeOnly: s => s === 'vitest/node',
  },
  'isolate-env.ts': {
    runtime: s => isBuiltin(s) || s === 'vitest' || s === './home-isolation.js',
    typeOnly: NONE,
  },
  'home-isolation.ts': { runtime: s => ['fs', 'os', 'path'].includes(s), typeOnly: NONE },
};

function sourceOf(file: string): string {
  return readFileSync(path.join(import.meta.dirname, file), 'utf8');
}

describe('TP-28: the setup files import only what their allowlist names', () => {
  it.each(Object.keys(ALLOWLISTS))('%s imports nothing else', file => {
    const allow = ALLOWLISTS[file];
    expect(allow, `no allowlist for ${file}`).toBeDefined();
    const source = sourceOf(file);
    expect(setupImportSpecifiers(source).length, `${file} must name at least one import`).toBeGreaterThan(0);
    expect(importViolations(source, allow as ImportAllowlist)).toEqual([]);
  });

  it('the global setup names the home isolation module and a type-only vitest/node import', () => {
    const refs = setupImportSpecifiers(sourceOf('global-setup.ts'));
    expect(refs).toContainEqual({ specifier: './home-isolation.js', typeOnly: false });
    expect(refs).toContainEqual({ specifier: 'vitest/node', typeOnly: true });
  });

  const globalSetup = ALLOWLISTS['global-setup.ts'] as ImportAllowlist;

  it('accepts a source that stays inside the allowlist', () => {
    const source = [
      "import { mkdtempSync } from 'fs';",
      "import { spawnSync } from 'node:child_process';",
      "import type { TestProject } from 'vitest/node';",
      "import { RUN_ROOT_PREFIX } from './home-isolation.js';",
    ].join('\n');
    expect(importViolations(source, globalSetup)).toEqual([]);
  });

  it.each([
    ['a src import', "import { x } from '../../src/core/x.js';", '../../src/core/x.js'],
    ['a runtime vitest import', "import { inject } from 'vitest';", 'vitest'],
    ['a type import from vitest', "import type { TestProject } from 'vitest';", 'vitest'],
    ['a runtime vitest/node import', "import { TestProject } from 'vitest/node';", 'vitest/node'],
    ['a dynamic import', "const m = await import('../../src/x.js');", '../../src/x.js'],
    ['a computed dynamic import', 'const m = await import(name);', '<computed>'],
    ['a require', "const m = require('../../src/x.js');", '../../src/x.js'],
    ['a re-export', "export { y } from '../../src/y.js';", '../../src/y.js'],
    ['an import type expression', "let t: import('../../src/z.js').Z;", '../../src/z.js'],
  ])('known-bad probe: %s is refused', (_name, source, specifier) => {
    const violations = importViolations(source, globalSetup);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain(specifier);
  });

  it('known-bad probe: an unlisted module in the other two files is refused too', () => {
    const isolateEnv = ALLOWLISTS['isolate-env.ts'] as ImportAllowlist;
    const homeIsolation = ALLOWLISTS['home-isolation.ts'] as ImportAllowlist;
    expect(importViolations("import { x } from '../helpers.js';", isolateEnv)).toHaveLength(1);
    expect(importViolations("import { spawnSync } from 'child_process';", homeIsolation)).toHaveLength(1);
    expect(importViolations("import { afterAll } from 'vitest';", homeIsolation)).toHaveLength(1);
  });
});

describe('the working folder gets no entry from a path that was never provided', () => {
  it('a provided absolute path is returned as it is', () => {
    const { provided } = recorder();
    provided.set(RUN_TMP_KEY, '/abs/run');
    expect(providedPath(provided, RUN_TMP_KEY)).toBe('/abs/run');
  });

  it.each([
    ['nothing provided', undefined],
    ['the text of an unset value', 'undefined'],
    ['a relative path', 'run/root'],
  ])('known-bad probe: %s is refused before any arm can use it', (_name, value) => {
    const { provided } = recorder();
    if (value !== undefined) provided.set(RUN_TMP_KEY, value);
    expect(() => providedPath(provided, RUN_TMP_KEY)).toThrow('was not provided as an absolute path');
  });

  it('the snapshot of the repo root is not empty and holds an inode for each name', () => {
    expect(CWD_ENTRIES_BEFORE.size).toBeGreaterThan(0);
    expect([...CWD_ENTRIES_BEFORE.values()].every(ino => Number.isInteger(ino) && ino > 0)).toBe(true);
  });

  it('known-bad probe: cwdResidue reports a new name and a name made again under a new inode, not an unchanged or removed one', () => {
    const before: DirEntries = new Map([['kept', 1], ['again', 2], ['gone', 3]]);
    const after: DirEntries = new Map([['kept', 1], ['again', 9], ['fresh', 4]]);
    expect(cwdResidue(before, after)).toEqual(['again', 'fresh']);
    expect(cwdResidue(before, before)).toEqual([]);
  });

  it('known-bad probe: a link removed and made again under the same name shows in the residue of a real folder', () => {
    const dir = fixtureDir();
    writeFileSync(path.join(dir, 'kept'), 'x');
    symlinkSync(path.join(dir, 'kept'), path.join(dir, 'undefined'));
    const before = cwdEntries(dir);
    expect(cwdResidue(before, cwdEntries(dir))).toEqual([]);

    // The new link exists while the old one does, so the two inodes differ.
    symlinkSync(path.join(dir, 'kept'), path.join(dir, 'undefined.next'));
    renameSync(path.join(dir, 'undefined.next'), path.join(dir, 'undefined'));

    expect([...cwdEntries(dir).keys()].sort()).toEqual([...before.keys()].sort());
    expect(cwdResidue(before, cwdEntries(dir))).toEqual(['undefined']);
  });

  // Last arm of the file: it runs after every other arm.
  it('has no new entry in the repo root after every arm of this file ran', () => {
    expect(cwdResidue(CWD_ENTRIES_BEFORE, cwdEntries(process.cwd()))).toEqual([]);
  });
});
