/**
 * The CLI's view of the curation move — a typed seam onto the package's own
 * `hooks/lib/curation-move.cjs`, never a second implementation of it.
 *
 * The one-time move of the old ledger folder to its new name lives in its own module,
 * beside the store it builds on. `devflow init` and `devflow curation` reach it only
 * through this seam: the module is loaded with the evidence-policy seam's `loadScript`
 * from the package's own scripts directory and shape-checked against
 * CURATION_MOVE_SURFACE; the interfaces below are TRANSCRIBED from the module's JSDoc
 * and are this side's only shape authority (as for the store, see curation-store.ts).
 */

import { join } from 'path';
import { scriptsDir } from './assets.js';
import { loadScript, type EvidencePolicyLoadError, type Result, type SurfaceKind } from './evidence-policy.js';
import type { CurationStoreResult } from './curation-store.js';

/** The move module, relative to src/assets/scripts/ (and ~/.devflow/scripts/). */
export const CURATION_MOVE_SCRIPT_NAME = join('hooks', 'lib', 'curation-move.cjs');

/**
 * The directories and the clock a ledger move takes; each defaults to the machine's own.
 * No folder names: the old and the new folder are the two names the path helpers hold.
 */
export interface LedgerMoveOptions {
  /** The machine directory that holds the move lock; default `$HOME/.devflow`. */
  readonly machineDir?: string;
  /** The home directory the root may not be; default `$HOME`. */
  readonly homeDir?: string;
  /** Epoch milliseconds; default `Date.now()`. */
  readonly now?: number;
}

/**
 * `moveLedger`'s answer. `none`: no old folder, nothing was locked or created.
 * `busy`: a lock or a fresh claim is held, try again at the next event; `reason` is
 * `claim` when a fresh queue claim held it, which can last 15 minutes, and is absent
 * when a lock or a folder that changed held it. `moved`: the
 * folder was renamed whole (`whole-folder`), the new folder won and the old one is
 * the backup (`kept-new`), or the old ledger set moved into the new folder and the
 * old one is the backup (`moved-in`); `backup` names the backup folder under
 * `.devflow`, null for a whole-folder rename.
 */
export type LedgerMoveOutcome =
  | { readonly state: 'none'; readonly notes: readonly string[] }
  | { readonly state: 'busy'; readonly reason?: 'claim'; readonly notes: readonly string[] }
  | {
    readonly state: 'moved';
    readonly mode: 'whole-folder' | 'kept-new' | 'moved-in';
    readonly backup: string | null;
    readonly rendered: boolean;
    readonly notes: readonly string[];
  };

/** `sweepLedgerBackups`'s answer: the queue files merged out of the backups a move left. */
export interface LedgerSweepOutcome {
  readonly state: 'none' | 'busy' | 'swept';
  readonly files: number;
  readonly merged: number;
  readonly overflowed: number;
  readonly notes: readonly string[];
}

/** One backup folder a move left under `.devflow`, with the rows its unswept queue files still hold. */
export interface LedgerBackupRows {
  readonly name: string;
  readonly pendingRows: number;
}

/**
 * The backup folders past the listing limit, counted in one total: how many there are,
 * and the rows the first 500 backups hold in all, so that no backup is left out of the account.
 */
export interface LedgerBackupsBeyondLimit {
  readonly backups: number;
  readonly pendingRows: number;
}

/**
 * The part of the move module's `module.exports` the CLI calls. Each function answers
 * a Result and never throws on an expected outcome.
 */
export interface CurationMoveModule {
  /**
   * Move the old ledger folder to the new name, once, or merge it into a new folder
   * that already exists. Never waits on a lock. Error kinds: `refused` (the root or a
   * link among the set is unsafe; nothing was changed), `io-error`.
   */
  moveLedger(root: string, opts?: LedgerMoveOptions): CurationStoreResult<LedgerMoveOutcome>;
  /** Merge what the backups a move left hold into the new folder's pending queue; same error kinds as `moveLedger`. */
  sweepLedgerBackups(root: string, opts?: LedgerMoveOptions): CurationStoreResult<LedgerSweepOutcome>;
  /**
   * The first 50 backup folders under `.devflow`, in name order, each with the count of rows its pending,
   * processing, private and overflow files still hold (swept files count for nothing), and the others in
   * `beyondLimit`. Read-only: takes no lock, writes nothing, follows no link. Error kinds: `refused` (the
   * root is not an absolute path), `io-error`.
   */
  backupPendingRows(root: string): CurationStoreResult<{
    readonly backups: readonly LedgerBackupRows[];
    readonly beyondLimit: LedgerBackupsBeyondLimit;
  }>;
}

/**
 * Every key of CurationMoveModule and the runtime kind the loader requires of it.
 * `satisfies` makes the compiler reject an interface key missing here.
 */
export const CURATION_MOVE_SURFACE = Object.freeze({
  moveLedger: 'function',
  sweepLedgerBackups: 'function',
  backupPendingRows: 'function',
} as const satisfies Record<keyof CurationMoveModule, SurfaceKind>);

export type CurationMoveLoad = Result<CurationMoveModule, EvidencePolicyLoadError>;

/**
 * Load the curation move module from `dir` (default: the package's own scripts
 * directory) and shape-check its surface. Never throws: a missing file is
 * `not-found`; a module that throws on load or lacks a surface key is `unusable`.
 */
export function loadCurationMove(dir: string = scriptsDir()): CurationMoveLoad {
  return loadScript<CurationMoveModule>(join(dir, CURATION_MOVE_SCRIPT_NAME), CURATION_MOVE_SURFACE);
}
