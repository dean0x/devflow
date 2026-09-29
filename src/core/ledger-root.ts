/**
 * @file ledger-root.ts
 *
 * Where the learning ledger lives for a working directory — the TypeScript twin of
 * `df_resolve_roots`' DF_LEDGER_ROOT in src/assets/scripts/hooks/resolve-project-root.
 *
 * D-LEDGER-MAIN-WORKTREE: the ledger is one per REPOSITORY, not per checkout. In a
 * linked worktree the hooks queue and render into the main worktree's
 * `.devflow/learning/`, so `devflow learning` and the HUD must read and clear that
 * same directory — resolving the worktree's own toplevel (getGitRoot) would show an
 * empty ledger and drain a queue nothing writes to. The rule, from ONE git call:
 *
 *   git rev-parse --path-format=absolute --show-toplevel --git-common-dir
 *
 *   - exactly two absolute lines, the common dir ends in `/.git`, `<main>/.devflow`
 *     is a directory and `<main>` is not HOME (physical paths, like the hooks'
 *     df_is_project_root) → `<main>`;
 *   - two absolute lines otherwise → the toplevel;
 *   - git before 2.31 echoes `--path-format=absolute` back as its own line → the
 *     toplevel it printed after it (the hooks fall back to the toplevel too);
 *   - git failed (not a work tree) → null: the caller keeps its non-git fallback;
 *   - any other output → getGitRoot(), the hooks' df_resolve_root fallback.
 *
 * Memory is NOT resolved here: working memory stays per checkout (getGitRoot).
 * Parity with the shell helper is pinned by tests/core/ledger-root.test.ts, which
 * runs df_resolve_roots on the same fixtures.
 */

import { execFile } from 'child_process';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { getGitRoot } from './git.js';

/** The one git call, as argv (no shell). */
const LEDGER_ROOT_GIT_ARGS = ['rev-parse', '--path-format=absolute', '--show-toplevel', '--git-common-dir'];

/** What git before 2.31 prints first: the flag it does not know, echoed back. */
const PATH_FORMAT_ECHO = '--path-format=absolute';

export type LedgerRootOutput =
  | { kind: 'roots'; toplevel: string; commonDir: string }
  | { kind: 'toplevel'; toplevel: string }
  | { kind: 'unrecognised' };

export interface LedgerRootOptions {
  /** The home directory a main worktree must not be. Defaults to os.homedir(). */
  home?: string;
  /** Kill the git call after this many ms (the HUD's per-command budget). 0 = none. */
  timeoutMs?: number;
}

/** Classify the git call's stdout. Pure. */
export function parseLedgerRootOutput(stdout: string): LedgerRootOutput {
  const lines = stdout.replace(/\n$/, '').split('\n');
  if (lines.length === 2 && lines.every(l => path.isAbsolute(l))) {
    return { kind: 'roots', toplevel: lines[0], commonDir: lines[1] };
  }
  if (lines.length === 3 && lines[0] === PATH_FORMAT_ECHO && path.isAbsolute(lines[1])) {
    return { kind: 'toplevel', toplevel: lines[1] };
  }
  return { kind: 'unrecognised' };
}

/** stdout of the one git call from `cwd`, or null when git failed. */
function runRevParse(cwd: string, timeoutMs: number): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('git', LEDGER_ROOT_GIT_ARGS, { cwd, timeout: timeoutMs, encoding: 'utf-8' }, (err, stdout) => {
      resolve(err ? null : stdout);
    });
  });
}

/** A path's physical location, or null when it cannot be resolved. */
async function physical(target: string): Promise<string | null> {
  try {
    return await fs.realpath(target);
  } catch {
    return null;
  }
}

/**
 * Whether the main worktree `main` holds the ledger: it has a `.devflow/` directory
 * and is not HOME. An unresolvable `main` is refused (the ledger stays in this
 * checkout); an unresolvable HOME cannot equal it, so it refuses nothing — both as
 * df_is_project_root decides.
 */
async function mainHoldsLedger(main: string, home: string): Promise<boolean> {
  const stat = await fs.stat(path.join(main, '.devflow')).catch(() => null);
  if (!stat?.isDirectory()) return false;
  const [mainReal, homeReal] = await Promise.all([physical(main), physical(home)]);
  return mainReal !== null && mainReal !== homeReal;
}

/**
 * The learning ledger root for `cwd` — the main worktree or this checkout's
 * toplevel — or null outside a git work tree.
 */
export async function getLedgerRoot(
  cwd: string = process.cwd(),
  options: LedgerRootOptions = {},
): Promise<string | null> {
  const stdout = await runRevParse(cwd, options.timeoutMs ?? 0);
  if (stdout === null) return null;
  const parsed = parseLedgerRootOutput(stdout);
  switch (parsed.kind) {
    case 'toplevel':
      return parsed.toplevel;
    case 'unrecognised':
      return getGitRoot(cwd);
    case 'roots': {
      if (!parsed.commonDir.endsWith('/.git')) return parsed.toplevel;
      const main = parsed.commonDir.slice(0, -'/.git'.length);
      if (main && await mainHoldsLedger(main, options.home ?? os.homedir())) return main;
      return parsed.toplevel;
    }
  }
}
