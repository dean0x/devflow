/**
 * The pure half of the unit suite's HOME isolation (D-TEST-HOME-ISOLATION).
 *
 * `tests/setup/isolate-env.ts` is the imperative shell that applies these to the
 * worker's `process.env`; `tests/helpers.ts` `sandboxEnv` reuses the same guard for
 * child-process envs. This module imports nothing from `src/` and nothing from
 * `tests/helpers.ts` on purpose: a setup file shares the test file's module graph,
 * so any `src/` module it pulled in would be evaluated BEFORE HOME is redirected
 * and could freeze a real-home path into a module-level constant.
 */

import { existsSync, realpathSync } from 'fs';
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
function canonical(p: string): string {
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
    throw new Error(`refusing to use the real home ${home} as a test HOME (PF-060)`);
  }
  const tmpRoot = canonical(os.tmpdir());
  if (!target.startsWith(tmpRoot + path.sep)) {
    throw new Error(`refusing to use ${home} as a test HOME — it is not under ${tmpRoot} (PF-060)`);
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
