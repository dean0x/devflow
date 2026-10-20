/**
 * @file ledger-root.ts
 *
 * Where the curation ledger lives for a working directory — the TypeScript twin of
 * `df_resolve_roots`' DF_LEDGER_ROOT in src/assets/scripts/hooks/resolve-project-root.
 *
 * D-LEDGER-MAIN-WORKTREE: the ledger is one per REPOSITORY, not per checkout. In a
 * linked worktree the hooks queue and render into the main worktree's
 * `.devflow/curation/`, so `devflow curation` and the HUD must read and clear that
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
 *   - git failed (not a work tree) → null: the caller keeps its non-git fallback; git
 *     that did not answer within the caller's time budget → null too (`lookupLedgerRoot`
 *     tells the two apart);
 *   - any other output → `git rev-parse --show-toplevel` alone, the hooks' df_resolve_root
 *     fallback, with the same time budget as the first call.
 *
 * Memory is NOT resolved here: working memory stays per checkout (getGitRoot).
 * Parity with the shell helper is pinned by tests/core/ledger-root.test.ts, which
 * runs df_resolve_roots on the same fixtures.
 */

import { execFile } from 'child_process';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parseGitToplevel } from './git.js';

/**
 * The budget of one ledger-root lookup, in ms: the HUD's per-git-command budget
 * (src/hud/git.ts GIT_TIMEOUT). The HUD and the init move pass it as `timeoutMs`, so a
 * project on a hung mount costs a bounded wait (one budget for each of the lookup's two
 * git calls at most) and never stalls the rest.
 */
export const LEDGER_ROOT_TIMEOUT_MS = 1000;

/**
 * How long past its timeout a git call may stay unanswered before the lookup stops
 * waiting for it: the timeout's own kill needs the process to die, and a process stuck
 * in I/O on a hung mount may not.
 */
const KILL_GRACE_MS = 500;

/** The one git call, as argv (no shell). */
const LEDGER_ROOT_GIT_ARGS = ['rev-parse', '--path-format=absolute', '--show-toplevel', '--git-common-dir'];

/** The fallback git call, as argv (no shell): the toplevel alone, as the hooks' df_resolve_root asks. */
const TOPLEVEL_GIT_ARGS = ['rev-parse', '--show-toplevel'];

/** What git before 2.31 prints first: the flag it does not know, echoed back. */
const PATH_FORMAT_ECHO = '--path-format=absolute';

export type LedgerRootOutput =
  | { kind: 'roots'; toplevel: string; commonDir: string }
  | { kind: 'toplevel'; toplevel: string }
  | { kind: 'unrecognised' };

export interface LedgerRootOptions {
  /** The home directory a main worktree must not be. Defaults to os.homedir(). */
  home?: string;
  /** Stop each git call after this many ms (LEDGER_ROOT_TIMEOUT_MS is the shared budget). 0 = none. */
  timeoutMs?: number;
}

/**
 * What a lookup found. `no-root`: git answered that this is no work tree (or could not
 * run). `timed-out`: git did not answer within the budget, so nothing is known.
 */
export type LedgerRootLookup =
  | { readonly kind: 'root'; readonly root: string }
  | { readonly kind: 'no-root' }
  | { readonly kind: 'timed-out' };

/** How one git call ended. */
type GitRun =
  | { readonly kind: 'ok'; readonly stdout: string }
  | { readonly kind: 'failed' }
  | { readonly kind: 'timed-out' };

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

/**
 * Run `git <args>` from `cwd`. With a timeout the call is bounded twice: Node kills git
 * at `timeoutMs`, and the lookup stops waiting KILL_GRACE_MS later even if git is still
 * alive (and kills it then), so a process stuck on a hung mount cannot hold the caller.
 * Never rejects.
 */
function runGit(args: readonly string[], cwd: string, timeoutMs: number): Promise<GitRun> {
  return new Promise((resolve) => {
    let settled = false;
    let backstop: NodeJS.Timeout | undefined;
    const settle = (run: GitRun): void => {
      if (settled) return;
      settled = true;
      if (backstop !== undefined) clearTimeout(backstop);
      resolve(run);
    };
    const child = execFile('git', [...args], { cwd, timeout: timeoutMs, encoding: 'utf-8' }, (err, stdout) => {
      if (!err) settle({ kind: 'ok', stdout });
      else settle(timeoutMs > 0 && err.killed === true ? { kind: 'timed-out' } : { kind: 'failed' });
    });
    if (timeoutMs > 0) {
      backstop = setTimeout(() => {
        child.kill('SIGKILL');
        settle({ kind: 'timed-out' });
      }, timeoutMs + KILL_GRACE_MS);
      backstop.unref();
    }
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
 * The curation ledger root for `cwd`, saying why when there is none: git named no work
 * tree (`no-root`), or did not answer in time (`timed-out`). Each of the two git calls
 * (the main one and the fallback) gets `options.timeoutMs`; 0 or none waits for ever.
 */
export async function lookupLedgerRoot(
  cwd: string = process.cwd(),
  options: LedgerRootOptions = {},
): Promise<LedgerRootLookup> {
  const timeoutMs = options.timeoutMs ?? 0;
  const run = await runGit(LEDGER_ROOT_GIT_ARGS, cwd, timeoutMs);
  if (run.kind === 'timed-out') return { kind: 'timed-out' };
  if (run.kind === 'failed') return { kind: 'no-root' };
  const parsed = parseLedgerRootOutput(run.stdout);
  switch (parsed.kind) {
    case 'toplevel':
      return { kind: 'root', root: parsed.toplevel };
    case 'unrecognised': {
      const fallback = await runGit(TOPLEVEL_GIT_ARGS, cwd, timeoutMs);
      if (fallback.kind === 'timed-out') return { kind: 'timed-out' };
      const toplevel = fallback.kind === 'ok' ? parseGitToplevel(fallback.stdout) : null;
      return toplevel === null ? { kind: 'no-root' } : { kind: 'root', root: toplevel };
    }
    case 'roots': {
      if (!parsed.commonDir.endsWith('/.git')) return { kind: 'root', root: parsed.toplevel };
      const main = parsed.commonDir.slice(0, -'/.git'.length);
      if (main && await mainHoldsLedger(main, options.home ?? os.homedir())) return { kind: 'root', root: main };
      return { kind: 'root', root: parsed.toplevel };
    }
  }
}

/**
 * The curation ledger root for `cwd` — the main worktree or this checkout's
 * toplevel — or null outside a git work tree (or when git did not answer in time).
 */
export async function getLedgerRoot(
  cwd: string = process.cwd(),
  options: LedgerRootOptions = {},
): Promise<string | null> {
  const lookup = await lookupLedgerRoot(cwd, options);
  return lookup.kind === 'root' ? lookup.root : null;
}

/**
 * The ledger folder a creator may create or write into under `ledgerRoot`: the old
 * folder while the old name is present (a folder, a file or a link, dangling or not),
 * else the new one. `newName` defaults to `oldName`, so a caller that names only the
 * old folder gets the old folder's path in every state.
 *
 * The creator rule: a new folder made beside a present old one would hide the old
 * ledger from every reader, so each creator (the configure writer here, and the three
 * shell creators through `df_ledger_folder`) makes the new folder only when the old
 * name is absent. Only ENOENT and ENOTDIR show the old name absent; any other probe
 * failure leaves the old path, so an unreadable `.devflow` never starts a second
 * folder. Answers a path and creates nothing.
 */
export async function ledgerFolderToCreate(
  ledgerRoot: string,
  oldName: string,
  newName: string = oldName,
): Promise<string> {
  const devflowDir = path.join(ledgerRoot, '.devflow');
  const oldFolder = path.join(devflowDir, oldName);
  try {
    await fs.lstat(oldFolder);
    return oldFolder;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === 'ENOENT' || code === 'ENOTDIR' ? path.join(devflowDir, newName) : oldFolder;
  }
}
