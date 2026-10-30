/**
 * TP-1 (AC-1): under an exported CLAUDE_CONFIG_DIR or DEVFLOW_DIR, the unit suite
 * never writes outside its temp HOME (D-TEST-HOME-ISOLATION).
 *
 * The proof is in four parts, each covering what the others cannot:
 *  1. this very worker runs under the setup file's temp HOME with every redirect
 *     variable unset (the setup file ran, and ran first);
 *  2. the unit config wires the setup file in, and the integration config does not;
 *  3. the pure pieces (`isolatedEnv`, `assertTempHome`) behave, with red probes
 *     for the guard so a no-op assertion cannot pass;
 *  4. end to end: a canary dir is exported as CLAUDE_CONFIG_DIR, CLAUDE_CODE_DIR and
 *     DEVFLOW_DIR in a parent env, a worker-style `node dist/cli.js init` is
 *     spawned from that env after the setup file's isolation, and the canary stays
 *     empty while the temp HOME receives the install. The RED PROBE runs the same
 *     spawn with the redirects left in place and shows the canary filling through
 *     CLAUDE_CONFIG_DIR — so the green arm is empty because of the isolation, not
 *     because init wrote nothing or ignores the variable. (DEVFLOW_DIR is ignored by
 *     devflow itself since #389, D-ONE-HOME; the probe pins that too.)
 *
 * Every spawn uses a fresh temp HOME and `--security user`, which never touches
 * the absolute managed-settings path a HOME sandbox cannot redirect.
 */

import { describe, it, expect, beforeAll, afterAll, inject } from 'vitest';
import { spawnSync } from 'child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import * as os from 'os';
import * as path from 'path';
import unitConfig from '../../vitest.config.js';
import integrationConfig from '../../vitest.integration.config.js';
import { requireBuiltCli, sandboxEnv, walkFiles } from '../helpers.js';
import { chmodOwnDirs, gitSpawnEnv } from './global-setup.js';
import {
  GIT_BIN_KEY,
  GIT_BIN_PREFIX,
  ORIGINAL_HOME_VAR,
  REDIRECT_ENV_VARS,
  RUN_TMP_KEY,
  SAFE_PATH,
  TEMP_HOME_PREFIX,
  assertTempHome,
  canonical,
  checkGitBinDir,
  gitIsolatedEnv,
  isUnder,
  isolatedEnv,
  pathWithGitBin,
  realHomes,
} from './home-isolation.js';

const CLI = requireBuiltCli();

/** One CLI spawn under load runs well past vitest's 5 s default. */
const SUBPROCESS_TIMEOUT_MS = 60_000;

const INIT_ARGS = ['init', '--recommended', '--security', 'user'] as const;

/**
 * The arms that build a git folder in a fixture run root need a temp root that the git folder
 * check accepts. That check's first rule is an absolute path of SAFE_PATH characters; it has no
 * rule about real homes, so a temp root inside a home skips nothing. A worker `os.tmpdir()` that
 * breaks the first rule is refused by the check, so those arms skip with the one reason below.
 * The arms whose refusal comes before any run root test run on every temp root.
 */
const FIXTURE_TMP = os.tmpdir();
function gitBinFixtureRefusal(tmpRoot: string): string | undefined {
  if (!path.isAbsolute(tmpRoot)) return 'is not an absolute path';
  if (!SAFE_PATH.test(tmpRoot)) return 'holds characters outside the safe set';
  return undefined;
}
const FIXTURE_TMP_REFUSAL = gitBinFixtureRefusal(FIXTURE_TMP);
const itAcceptedTmp: typeof it = FIXTURE_TMP_REFUSAL === undefined ? it : it.skip;
if (FIXTURE_TMP_REFUSAL !== undefined) {
  it.skip(`skips the git folder arms that need a temp root the check accepts: os.tmpdir() ${FIXTURE_TMP_REFUSAL}`, () => {});
}

const created: string[] = [];
function tempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  created.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of created) {
    // A git folder fixture is read-only; give its owner write rights back before the removal.
    chmodOwnDirs(dir, process.getuid?.());
    rmSync(dir, { recursive: true, force: true });
  }
});

/** A temp dir laid out the way init expects Claude Code to exist: an empty `.claude`-style dir. */
function seededDir(prefix: string, claudeName: string): string {
  const dir = tempDir(prefix);
  mkdirSync(path.join(dir, claudeName));
  return dir;
}

/** Every file written under `dir`, relative to it. */
function filesUnder(dir: string): string[] {
  return walkFiles(dir, () => true).map(f => path.relative(dir, f)).sort();
}

describe('D-TEST-HOME-ISOLATION: this worker', () => {
  it('runs under a temp HOME that is not a real home', () => {
    const home = process.env.HOME ?? '';
    expect(path.basename(home).startsWith(TEMP_HOME_PREFIX), `HOME=${home}`).toBe(true);
    expect(os.homedir()).toBe(home);
    expect(process.env.USERPROFILE).toBe(home);
    expect(() => assertTempHome(home)).not.toThrow();
  });

  it('has every write-redirecting variable unset', () => {
    for (const key of REDIRECT_ENV_VARS) {
      expect(process.env[key], `${key} leaked into the worker`).toBeUndefined();
    }
  });

  it('recorded the HOME it replaced, so the real-home check still has it', () => {
    expect(process.env[ORIGINAL_HOME_VAR]).toBeTruthy();
    expect(realHomes().length).toBeGreaterThan(0);
  });
});

describe('D-TEST-HOME-ISOLATION: wiring', () => {
  it('the unit config runs the setup file', () => {
    expect(unitConfig.test?.setupFiles).toContain('tests/setup/isolate-env.ts');
  });

  it('the integration config does not — its files sandbox their own spawns at the call site', () => {
    const setupFiles = [integrationConfig.test?.setupFiles ?? []].flat();
    expect(setupFiles).not.toContain('tests/setup/isolate-env.ts');
  });
});

describe('D-TEST-HOME-ISOLATION: isolatedEnv', () => {
  it('drops every redirect variable, pins HOME and USERPROFILE, and keeps the rest', () => {
    const parent: NodeJS.ProcessEnv = {
      PATH: '/usr/bin',
      HOME: '/home/someone',
      DEVFLOW_DIR: '/canary/devflow',
      CLAUDE_CODE_DIR: '/canary/claude',
      CLAUDE_CONFIG_DIR: '/canary/claude',
    };
    const env = isolatedEnv(parent, '/tmp/x');
    expect(env).toEqual({ PATH: '/usr/bin', HOME: '/tmp/x', USERPROFILE: '/tmp/x' });
  });

  it('leaves its input untouched', () => {
    const parent: NodeJS.ProcessEnv = { HOME: '/home/someone', DEVFLOW_DIR: '/canary' };
    isolatedEnv(parent, '/tmp/x');
    expect(parent).toEqual({ HOME: '/home/someone', DEVFLOW_DIR: '/canary' });
  });
});

describe('D-TEST-HOME-ISOLATION: assertTempHome red probes', () => {
  it('refuses every real home', () => {
    for (const home of realHomes()) {
      expect(() => assertTempHome(home), home).toThrow(/real home/);
    }
  });

  it('refuses a directory outside the temp root', () => {
    expect(() => assertTempHome('/')).toThrow(/not under/);
    expect(() => assertTempHome(path.join(path.sep, 'var', 'lib', 'devflow-home'))).toThrow(/not under/);
  });

  it('accepts a fresh temp dir', () => {
    expect(() => assertTempHome(tempDir('df-iso-accept-'))).not.toThrow();
  });

  it('sandboxEnv refuses a real home too, and never inherits a redirect variable', () => {
    for (const home of realHomes()) {
      expect(() => sandboxEnv(home)).toThrow(/real home/);
    }
    const env = sandboxEnv(tempDir('df-iso-sandbox-'));
    for (const key of REDIRECT_ENV_VARS) expect(env[key]).toBeUndefined();
  });
});

describe('AC-1: an exported CLAUDE_CONFIG_DIR / DEVFLOW_DIR canary stays empty', () => {
  /** What a developer shell exporting the redirects at `canary` hands the vitest workers. */
  function exportedEnv(canary: string): NodeJS.ProcessEnv {
    return {
      ...process.env,
      DEVFLOW_DIR: path.join(canary, 'devflow'),
      CLAUDE_CODE_DIR: path.join(canary, 'claude'),
      CLAUDE_CONFIG_DIR: path.join(canary, 'claude'),
      FORCE_COLOR: '0',
      NO_COLOR: '1',
      CI: '1',
    };
  }

  // Both arms seed the canary identically — an existing, empty Claude Code dir —
  // so the only difference between them is whether the isolation ran.
  let canary: string;
  beforeAll(() => {
    canary = seededDir('df-iso-canary-', 'claude');
  });

  function spawnInit(env: NodeJS.ProcessEnv, home: string): string {
    assertTempHome(home);
    const result = spawnSync(process.execPath, [CLI, ...INIT_ARGS], {
      cwd: home,
      encoding: 'utf-8',
      timeout: SUBPROCESS_TIMEOUT_MS,
      env,
    });
    if (result.error) throw result.error;
    const out = `${result.stdout ?? ''}${result.stderr ?? ''}`;
    expect(result.status, `init failed:\n${out}`).toBe(0);
    return out;
  }

  it('a worker-isolated init writes only under its temp HOME', () => {
    const home = seededDir('df-iso-home-', '.claude');
    spawnInit(isolatedEnv(exportedEnv(canary), home), home);

    expect(filesUnder(canary), 'init wrote into the exported redirect target').toEqual([]);
    expect(existsSync(path.join(canary, 'devflow'))).toBe(false);
    // Non-vacuity: the install really happened, under the temp HOME.
    expect(existsSync(path.join(home, '.devflow', 'manifest.json'))).toBe(true);
    expect(existsSync(path.join(home, '.claude', 'settings.json'))).toBe(true);
  }, SUBPROCESS_TIMEOUT_MS);

  it('RED PROBE: with the redirects left in place, the same init fills the canary', () => {
    const probeCanary = seededDir('df-iso-probe-', 'claude');
    const home = seededDir('df-iso-probe-home-', '.claude');
    spawnInit({ ...exportedEnv(probeCanary), HOME: home }, home);

    const written = filesUnder(probeCanary);
    // CLAUDE_CONFIG_DIR is honoured (D-CLAUDE-CONFIG-DIR), so the Claude half of an
    // un-isolated init lands in the canary...
    expect(written).toContain(path.join('claude', 'settings.json'));
    expect(existsSync(path.join(home, '.claude', 'settings.json'))).toBe(false);
    // ...while DEVFLOW_DIR is ignored (D-ONE-HOME): the machine root stays $HOME/.devflow.
    expect(written.filter(f => f.startsWith(`devflow${path.sep}`))).toEqual([]);
    expect(existsSync(path.join(home, '.devflow', 'manifest.json'))).toBe(true);
  }, SUBPROCESS_TIMEOUT_MS);
});

describe('TP-30: the global setup wiring', () => {
  it('the unit config names the one global setup file', () => {
    expect([unitConfig.test?.globalSetup ?? []].flat()).toEqual(['tests/setup/global-setup.ts']);
  });

  it('the integration config names none', () => {
    expect([integrationConfig.test?.globalSetup ?? []].flat()).toEqual([]);
  });
});

const OWN_UID = process.getuid?.() ?? -1;

interface GitBinShape {
  /** The folder name inside the run root. Default: made by `mkdtemp` from the git folder prefix. */
  name?: string;
  /** The folder this one is made in. Default: the run root. */
  parent?: string;
  /** What `git` links to. `null` leaves the folder without it. Default: this node binary. */
  target?: string | null;
  /** A second entry beside `git`. */
  extra?: string;
  mode?: number;
}

/** A git folder the way the global setup makes it: a read-only folder with one link named `git`. */
function makeGitBin(runRoot: string, shape: GitBinShape = {}): string {
  const parent = shape.parent ?? runRoot;
  const bin = shape.name === undefined ? mkdtempSync(path.join(parent, GIT_BIN_PREFIX)) : path.join(parent, shape.name);
  if (shape.name !== undefined) mkdirSync(bin);
  if (shape.target !== null) symlinkSync(shape.target ?? process.execPath, path.join(bin, 'git'));
  if (shape.extra !== undefined) writeFileSync(path.join(bin, shape.extra), '');
  chmodSync(bin, shape.mode ?? 0o555);
  return bin;
}

interface GitBinProbe {
  name: string;
  /** What the refusal says; every arm names its own check, so a broken fixture cannot pass for it. */
  message: RegExp;
  /** True when the refusal comes from the value alone, so the arm needs no accepted temp root. */
  refusedBeforeRunRoot?: true;
  build(runRoot: string): { value: unknown; runRoot: string | undefined; uid: number | undefined };
}

/** Each probe differs from the accepted folder in one thing. */
const GIT_BIN_PROBES: GitBinProbe[] = [
  {
    name: 'an empty text',
    message: /not a non-empty string/,
    refusedBeforeRunRoot: true,
    build: r => ({ value: '', runRoot: r, uid: OWN_UID }),
  },
  {
    name: 'a number',
    message: /not a non-empty string/,
    refusedBeforeRunRoot: true,
    build: r => ({ value: 5, runRoot: r, uid: OWN_UID }),
  },
  {
    name: 'a relative path',
    refusedBeforeRunRoot: true,
    message: /git folder git-bin-x — it is not an absolute path of safe characters/,
    build: r => ({ value: 'git-bin-x', runRoot: r, uid: OWN_UID }),
  },
  {
    name: 'a path with a space',
    refusedBeforeRunRoot: true,
    message: /it is not an absolute path of safe characters/,
    build: r => ({ value: makeGitBin(r, { name: 'git-bin-a b' }), runRoot: r, uid: OWN_UID }),
  },
  {
    name: 'a path with a semicolon',
    refusedBeforeRunRoot: true,
    message: /it is not an absolute path of safe characters/,
    build: r => ({ value: makeGitBin(r, { name: 'git-bin-a;b' }), runRoot: r, uid: OWN_UID }),
  },
  {
    name: 'a path that is not normalised',
    message: /not a normalised path/,
    build: r => ({ value: `${makeGitBin(r)}/`, runRoot: r, uid: OWN_UID }),
  },
  {
    name: 'a run root that is missing',
    message: /no run root to hold it/,
    build: r => ({ value: makeGitBin(r), runRoot: undefined, uid: OWN_UID }),
  },
  {
    name: 'a folder outside the run root',
    message: /not a direct child of the run root/,
    build: r => ({ value: makeGitBin(r, { parent: tempDir('df-gitbin-other-') }), runRoot: r, uid: OWN_UID }),
  },
  {
    name: 'a folder below another folder of the run root',
    message: /not a direct child of the run root/,
    build: r => {
      const below = path.join(r, 'below');
      mkdirSync(below);
      return { value: makeGitBin(r, { parent: below }), runRoot: r, uid: OWN_UID };
    },
  },
  {
    name: 'a folder with another name',
    message: /does not start with git-bin-/,
    build: r => ({ value: makeGitBin(r, { name: 'tool-x' }), runRoot: r, uid: OWN_UID }),
  },
  {
    name: 'a folder named only by the prefix',
    message: /does not start with git-bin-/,
    build: r => ({ value: makeGitBin(r, { name: GIT_BIN_PREFIX }), runRoot: r, uid: OWN_UID }),
  },
  {
    name: 'a link to a good git folder',
    message: /not a real directory/,
    build: r => {
      const link = path.join(r, `${GIT_BIN_PREFIX}link`);
      symlinkSync(makeGitBin(r), link);
      return { value: link, runRoot: r, uid: OWN_UID };
    },
  },
  {
    name: 'a file in place of the folder',
    message: /not a real directory/,
    build: r => {
      const file = path.join(r, `${GIT_BIN_PREFIX}file`);
      writeFileSync(file, '');
      return { value: file, runRoot: r, uid: OWN_UID };
    },
  },
  {
    name: 'a folder that does not exist',
    message: /cannot be inspected/,
    build: r => ({ value: path.join(r, `${GIT_BIN_PREFIX}missing`), runRoot: r, uid: OWN_UID }),
  },
  {
    name: 'a folder of another owner',
    message: /not owned by the current user/,
    build: r => ({ value: makeGitBin(r), runRoot: r, uid: OWN_UID + 1 }),
  },
  {
    name: 'a folder when the user id is unknown',
    message: /not owned by the current user/,
    build: r => ({ value: makeGitBin(r), runRoot: r, uid: undefined }),
  },
  {
    name: 'a folder the owner can write',
    message: /write bits set/,
    build: r => ({ value: makeGitBin(r, { mode: 0o755 }), runRoot: r, uid: OWN_UID }),
  },
  {
    name: 'a folder the group can write',
    message: /write bits set/,
    build: r => ({ value: makeGitBin(r, { mode: 0o575 }), runRoot: r, uid: OWN_UID }),
  },
  {
    name: 'a folder anyone can write',
    message: /write bits set/,
    build: r => ({ value: makeGitBin(r, { mode: 0o557 }), runRoot: r, uid: OWN_UID }),
  },
  {
    name: 'a second tool beside git',
    message: /exactly one entry named git/,
    build: r => ({ value: makeGitBin(r, { extra: 'tool' }), runRoot: r, uid: OWN_UID }),
  },
  {
    name: 'a folder with no entry',
    message: /exactly one entry named git/,
    build: r => ({ value: makeGitBin(r, { target: null }), runRoot: r, uid: OWN_UID }),
  },
  {
    name: 'one entry that is not named git',
    message: /exactly one entry named git/,
    build: r => ({ value: makeGitBin(r, { target: null, extra: 'tool' }), runRoot: r, uid: OWN_UID }),
  },
  {
    name: 'a git entry that is a file',
    message: /git entry is not a link/,
    build: r => ({ value: makeGitBin(r, { target: null, extra: 'git' }), runRoot: r, uid: OWN_UID }),
  },
  {
    name: 'a link with a relative target',
    message: /link target is not an absolute path of safe characters/,
    build: r => ({ value: makeGitBin(r, { target: 'node' }), runRoot: r, uid: OWN_UID }),
  },
  {
    name: 'a link target with unsafe characters',
    message: /link target is not an absolute path of safe characters/,
    build: r => ({ value: makeGitBin(r, { target: '/opt/a b/git' }), runRoot: r, uid: OWN_UID }),
  },
  {
    name: 'a link target inside the run root',
    message: /link target is inside the run root/,
    build: r => ({ value: makeGitBin(r, { target: path.join(r, 'tool') }), runRoot: r, uid: OWN_UID }),
  },
  {
    name: 'a link target that reaches the run root through another link',
    message: /link target is inside the run root/,
    build: r => {
      const alias = path.join(tempDir('df-gitbin-alias-'), 'alias');
      symlinkSync(r, alias);
      writeFileSync(path.join(r, 'tool'), '');
      return { value: makeGitBin(r, { target: path.join(alias, 'tool') }), runRoot: r, uid: OWN_UID };
    },
  },
];

describe('TP-23: the git folder check', () => {
  itAcceptedTmp('accepts a read-only folder in the run root that holds one link to an absolute path', () => {
    const runRoot = tempDir('df-gitbin-root-');
    const bin = makeGitBin(runRoot);
    expect(checkGitBinDir(bin, runRoot, { uid: OWN_UID })).toBe(bin);
  });

  function expectRefusal(probe: GitBinProbe): void {
    const runRoot = tempDir('df-gitbin-root-');
    const { value, runRoot: holder, uid } = probe.build(runRoot);
    expect(() => checkGitBinDir(value, holder, { uid })).toThrow(probe.message);
  }

  it.each(GIT_BIN_PROBES.filter(probe => probe.refusedBeforeRunRoot === true))('refuses $name', expectRefusal);

  itAcceptedTmp.each(GIT_BIN_PROBES.filter(probe => probe.refusedBeforeRunRoot !== true))('refuses $name', expectRefusal);

  it('runs a refusal arm for each of its probes, each under its own name', () => {
    expect(GIT_BIN_PROBES.length).toBeGreaterThan(0);
    expect(new Set(GIT_BIN_PROBES.map(p => p.name)).size).toBe(GIT_BIN_PROBES.length);
  });
});

describe('TP-21: PATH and the git folder', () => {
  const bin = '/run/root/git-bin-abc';

  it('leaves PATH to the caller when no git folder is given', () => {
    const runRoot = tempDir('df-gitbin-root-');
    expect(checkGitBinDir(undefined, runRoot)).toBeUndefined();
    expect(checkGitBinDir(undefined, undefined)).toBeUndefined();
  });

  it('puts the git folder first and keeps the rest of PATH as it was', () => {
    const rest = ['/usr/bin', '/bin'].join(path.delimiter);
    expect(pathWithGitBin(rest, bin)).toBe(`${bin}${path.delimiter}${rest}`);
  });

  it('gives the folder alone for an unset or empty PATH, never an empty entry', () => {
    expect(pathWithGitBin(undefined, bin)).toBe(bin);
    expect(pathWithGitBin('', bin)).toBe(bin);
    expect(pathWithGitBin(undefined, bin).split(path.delimiter)).not.toContain('');
  });

  it('gives the same PATH when the folder is already first', () => {
    const once = pathWithGitBin('/usr/bin', bin);
    expect(pathWithGitBin(once, bin)).toBe(once);
    expect(pathWithGitBin(bin, bin)).toBe(bin);
  });

  it('does not take another folder with the same start for the git folder', () => {
    const lookalike = [`${bin}x`, '/usr/bin'].join(path.delimiter);
    expect(pathWithGitBin(lookalike, bin)).toBe(`${bin}${path.delimiter}${lookalike}`);
  });
});

/** The PATH entries whose folder name starts with the git folder prefix. */
function gitBinEntries(pathVar: string | undefined): string[] {
  return (pathVar ?? '')
    .split(path.delimiter)
    .filter(entry => path.basename(entry).startsWith(GIT_BIN_PREFIX));
}

describe('TP-22: what the global setup provided, as this worker applied it', () => {
  const runTmp = inject(RUN_TMP_KEY);
  const gitBin = inject(GIT_BIN_KEY);

  it.skipIf(runTmp === undefined)('uses the run root as its temp folder, with its HOME inside', () => {
    expect(process.env.TMPDIR).toBe(runTmp);
    expect(os.tmpdir()).toBe(runTmp);
    expect(process.env.HOME?.startsWith(`${runTmp}${path.sep}`)).toBe(true);
  });

  it.skipIf(gitBin === undefined)('has the git folder first on PATH, and only once', () => {
    expect(process.env.PATH?.split(path.delimiter)[0]).toBe(gitBin);
    expect(gitBinEntries(process.env.PATH)).toEqual([gitBin]);
  });

  it.skipIf(gitBin !== undefined)('has no git folder on PATH when none was provided', () => {
    expect((process.env.PATH ?? '').split(path.delimiter).filter(entry => entry !== '').length).toBeGreaterThan(0);
    expect(gitBinEntries(process.env.PATH)).toEqual([]);
  });

  it('finds a git folder on a PATH that holds one, and none on a PATH that does not', () => {
    const bin = '/run/root/git-bin-abc';
    expect(gitBinEntries(pathWithGitBin('/usr/bin', bin))).toEqual([bin]);
    expect(gitBinEntries(['/usr/bin', '/bin'].join(path.delimiter))).toEqual([]);
    expect(gitBinEntries(undefined)).toEqual([]);
  });
});

/**
 * A git call in a unit test reads only the settings the test sets up and acts only on the
 * repositories the test makes. The worker env is the channel: a developer shell can export
 * GIT_DIR, GIT_CONFIG_COUNT and the like, and every test git call inherits the worker env.
 *
 * Two parts, each covering what the other cannot:
 *  1. the pure step (`gitIsolatedEnv`) drops every git variable and XDG_CONFIG_HOME and sets
 *     GIT_CONFIG_NOSYSTEM=1; a known-bad probe shows the collector sees the leaks that
 *     `isolatedEnv` alone lets through;
 *  2. live: real git calls in this worker, in a repository the test makes, report no setting from
 *     outside the temp HOME and that repository, and a git folder inside that repository. The
 *     same collectors run on an env that leaks each way, and report it.
 */

/** What a developer shell can export that points git at another repository or adds settings. */
const GIT_LEAK_KEYS = [
  'GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_COMMON_DIR', 'GIT_NAMESPACE', 'GIT_CEILING_DIRECTORIES',
  'GIT_DISCOVERY_ACROSS_FILESYSTEM', 'GIT_CONFIG', 'GIT_CONFIG_COUNT', 'GIT_CONFIG_KEY_0',
  'GIT_CONFIG_VALUE_0', 'GIT_CONFIG_PARAMETERS', 'GIT_CONFIG_SYSTEM', 'GIT_CONFIG_GLOBAL',
  'GIT_LITERAL_PATHSPECS', 'GIT_GLOB_PATHSPECS', 'GIT_NOGLOB_PATHSPECS', 'GIT_ICASE_PATHSPECS',
  'GIT_TEMPLATE_DIR', 'GIT_EXEC_PATH', 'GIT_AUTHOR_NAME', 'GIT_TRACE',
  'XDG_CONFIG_HOME',
] as const;

const LEAKY_ENV: NodeJS.ProcessEnv = {
  PATH: '/usr/bin',
  LANG: 'C',
  HOME: '/home/someone',
  ...Object.fromEntries(GIT_LEAK_KEYS.map(key => [key, `/canary/${key}`])),
  GIT_CONFIG_NOSYSTEM: '0',
};

/** The keys of `env` that can move git's settings or repository. GIT_CONFIG_NOSYSTEM is the one key the worker sets. */
function leakedGitKeys(env: NodeJS.ProcessEnv): string[] {
  return Object.keys(env)
    .filter(key => key === 'XDG_CONFIG_HOME' || (key.toUpperCase().startsWith('GIT_') && key !== 'GIT_CONFIG_NOSYSTEM'))
    .sort();
}

describe('git settings isolation: gitIsolatedEnv', () => {
  it('has a corpus the collector reads in full: every leak key is found', () => {
    expect(leakedGitKeys(LEAKY_ENV)).toEqual([...GIT_LEAK_KEYS].sort());
  });

  it('drops every git variable and XDG_CONFIG_HOME, sets GIT_CONFIG_NOSYSTEM=1, and keeps the rest', () => {
    const env = gitIsolatedEnv(LEAKY_ENV);
    expect(leakedGitKeys(env)).toEqual([]);
    expect(env).toEqual({ PATH: '/usr/bin', LANG: 'C', HOME: '/home/someone', GIT_CONFIG_NOSYSTEM: '1' });
  });

  it('drops a git variable it has no name for, in any letter case', () => {
    const env = gitIsolatedEnv({ PATH: '/usr/bin', GIT_SOMETHING_NEW: '1', git_dir: '/canary' });
    expect(env).toEqual({ PATH: '/usr/bin', GIT_CONFIG_NOSYSTEM: '1' });
  });

  it('leaves its input untouched', () => {
    const parent: NodeJS.ProcessEnv = { ...LEAKY_ENV };
    gitIsolatedEnv(parent);
    expect(parent).toEqual(LEAKY_ENV);
  });

  it('RED PROBE: isolatedEnv alone keeps every leak key, so the collector would flag a worker built from it', () => {
    expect(leakedGitKeys(isolatedEnv(LEAKY_ENV, '/tmp/x'))).toEqual([...GIT_LEAK_KEYS].sort());
  });
});

/** Run git in `cwd` under `env` and return its output. A failed call throws. */
function gitOut(cwd: string, args: readonly string[], env: NodeJS.ProcessEnv): string {
  const result = spawnSync('git', [...args], { cwd, encoding: 'utf-8', env });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout;
}

/** A fresh repository, made under an env that is not the worker's, so a leaked variable cannot move the init. */
function freshRepo(): string {
  const repo = tempDir('df-git-iso-repo-');
  gitOut(repo, ['init', '-q'], gitSpawnEnv(process.env, tempDir('df-git-iso-home-')));
  return repo;
}

/** The origin of every setting git reads in `cwd` under `env`: `file:<path>`, `command line:` and the like. */
function settingOrigins(cwd: string, env: NodeJS.ProcessEnv): string[] {
  const lines = gitOut(cwd, ['config', '--list', '--show-origin'], env).split('\n').filter(line => line.includes('\t'));
  return [...new Set(lines.map(line => line.slice(0, line.indexOf('\t'))))];
}

/** The absolute path of a `file:` origin, which git prints relative to `cwd` for the repository's own config. Else undefined. */
function originFile(origin: string, cwd: string): string | undefined {
  return origin.startsWith('file:') ? canonical(path.resolve(cwd, origin.slice('file:'.length))) : undefined;
}

/** The origins that are not a file under the repository or the temp HOME, the only places a unit test git call may read settings from. */
function foreignOrigins(origins: readonly string[], repo: string): string[] {
  const roots = [canonical(repo), canonical(process.env.HOME ?? '')];
  return origins.filter(origin => {
    const file = originFile(origin, repo);
    return file === undefined || !roots.some(root => isUnder(file, root));
  });
}

/** The git folder git resolves in `cwd` under `env`, as an absolute path. */
function gitFolderOf(cwd: string, env: NodeJS.ProcessEnv): string {
  return canonical(gitOut(cwd, ['rev-parse', '--absolute-git-dir'], env).trim());
}

describe('git settings isolation: this worker', () => {
  it('holds no variable that moves the settings or the repository of git, and skips the system config', () => {
    expect(leakedGitKeys(process.env)).toEqual([]);
    expect(process.env.GIT_CONFIG_NOSYSTEM).toBe('1');
  });

  it('reads settings only from the temp HOME and the repository the test made', () => {
    const repo = freshRepo();
    const origins = settingOrigins(repo, process.env);
    // Non-vacuity: git read the repository's own config, so the check ran over real entries.
    expect(origins.some(origin => isUnder(originFile(origin, repo) ?? '', canonical(repo)))).toBe(true);
    expect(foreignOrigins(origins, repo)).toEqual([]);
  });

  it('resolves the git folder inside the repository the test made', () => {
    const repo = freshRepo();
    expect(isUnder(gitFolderOf(repo, process.env), canonical(repo))).toBe(true);
  });
});

/**
 * The env of a probe: PATH and the worker HOME, the system config off, and one leak on top.
 * It does not start from the worker env, so a probe reports its own leak and nothing else.
 */
function probeEnv(leak: Readonly<Record<string, string>>): NodeJS.ProcessEnv {
  return { PATH: process.env.PATH, HOME: process.env.HOME, GIT_CONFIG_NOSYSTEM: '1', ...leak };
}

describe('git settings isolation: RED PROBES, the collectors report a leak', () => {
  it('a setting added through GIT_CONFIG_COUNT is reported', () => {
    const repo = freshRepo();
    const env = probeEnv({ GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'devflow.canary', GIT_CONFIG_VALUE_0: '1' });
    expect(foreignOrigins(settingOrigins(repo, env), repo)).toEqual(['command line:']);
  });

  it('a global config file outside the temp HOME, named through GIT_CONFIG_GLOBAL, is reported', () => {
    const repo = freshRepo();
    const file = path.join(tempDir('df-git-iso-outside-'), 'gitconfig');
    writeFileSync(file, '[devflow]\n\tcanary = 1\n');
    const foreign = foreignOrigins(settingOrigins(repo, probeEnv({ GIT_CONFIG_GLOBAL: file })), repo);
    expect(foreign.map(origin => originFile(origin, repo))).toEqual([canonical(file)]);
  });

  it('a global config file under XDG_CONFIG_HOME outside the temp HOME is reported', () => {
    const repo = freshRepo();
    const xdg = tempDir('df-git-iso-xdg-');
    mkdirSync(path.join(xdg, 'git'));
    writeFileSync(path.join(xdg, 'git', 'config'), '[devflow]\n\tcanary = 1\n');
    const foreign = foreignOrigins(settingOrigins(repo, probeEnv({ XDG_CONFIG_HOME: xdg })), repo);
    expect(foreign.map(origin => originFile(origin, repo))).toEqual([canonical(path.join(xdg, 'git', 'config'))]);
  });

  it('a git folder named through GIT_DIR is reported as outside the repository', () => {
    const repo = freshRepo();
    const other = freshRepo();
    const folder = gitFolderOf(repo, probeEnv({ GIT_DIR: path.join(other, '.git') }));
    expect(isUnder(folder, canonical(repo))).toBe(false);
    expect(folder).toBe(canonical(path.join(other, '.git')));
  });
});
