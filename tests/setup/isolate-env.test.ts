/**
 * TP-1 (AC-1): under an exported CLAUDE_CONFIG_DIR or DEVFLOW_DIR, the unit suite
 * never writes outside its temp HOME (D-TEST-HOME-ISOLATION, PF-060).
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
 *     spawn with the redirects left in place and shows the canary filling — so the
 *     green arm is empty because of the isolation, not because init wrote nothing
 *     or ignores the variables.
 *
 * Every spawn uses a fresh temp HOME and `--security user`, which never touches
 * the absolute managed-settings path a HOME sandbox cannot redirect (PF-060).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'fs';
import * as os from 'os';
import * as path from 'path';
import unitConfig from '../../vitest.config.js';
import integrationConfig from '../../vitest.integration.config.js';
import { requireBuiltCli, sandboxEnv, walkFiles } from '../helpers.js';
import {
  ORIGINAL_HOME_VAR,
  REDIRECT_ENV_VARS,
  TEMP_HOME_PREFIX,
  assertTempHome,
  isolatedEnv,
  realHomes,
} from './home-isolation.js';

const CLI = requireBuiltCli();

/** One CLI spawn under load runs well past vitest's 5 s default. */
const SUBPROCESS_TIMEOUT_MS = 60_000;

const INIT_ARGS = ['init', '--recommended', '--security', 'user'] as const;

const created: string[] = [];
function tempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  created.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of created) rmSync(dir, { recursive: true, force: true });
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

  it('the integration config does not — its live claude test needs the real ~/.claude', () => {
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
    expect(written).toContain(path.join('devflow', 'manifest.json'));
    expect(written).toContain(path.join('claude', 'settings.json'));
    expect(existsSync(path.join(home, '.devflow', 'manifest.json'))).toBe(false);
  }, SUBPROCESS_TIMEOUT_MS);
});
