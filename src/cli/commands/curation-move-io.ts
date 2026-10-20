/**
 * @file curation-move-io.ts
 *
 * The real I/O behind the curation folder move: the seam init-curation-move.ts takes
 * as parameters, built from the file system, git and the package's own store. Init
 * wires it to the init step; the curation command wires it to the move that
 * configure and the toggles run for the current project.
 *
 * Every function answers a value and never throws. The module holds no policy: what
 * to move, in what order and what to print are decided in init-curation-move.ts.
 */

import { promises as fs } from 'fs';
import * as os from 'os';
import { getDevFlowDirectory } from '../../targets/claude-code/claude-paths.js';
import { LEDGER_ROOT_TIMEOUT_MS, lookupLedgerRoot } from '../../core/ledger-root.js';
import { CURATION_DIR_NAME, LEGACY_NAMES } from '../../core/project-paths.js';
import {
  formatCurationStoreUnavailable,
  loadCurationStore,
  type CurationStoreModule,
} from '../../core/curation-store.js';
import {
  describeFailure,
  moveLedgerRoot,
  type GlobalTuningMoveIO,
  type ProjectLedgerMoveIO,
  type ProjectMoveOutcome,
  type TuningPathKind,
} from './init-curation-move.js';

/** The store seam the move uses: the two operations, nothing else. */
export type MoveStore = Pick<CurationStoreModule, 'moveLedger' | 'sweepLedgerBackups'>;

/** The real I/O of the per-project move, over `store`. */
export function realProjectLedgerMoveIO(store: MoveStore): ProjectLedgerMoveIO {
  return {
    ledgerRootOf: (project) => lookupLedgerRoot(project, { timeoutMs: LEDGER_ROOT_TIMEOUT_MS }),
    realpath: (target) => fs.realpath(target).catch(() => null),
    readdir: (dir) => fs.readdir(dir).catch(() => null),
    store,
    now: () => Date.now(),
  };
}

/** What sits at `target`, without following a link. */
async function kindOf(target: string): Promise<TuningPathKind> {
  try {
    return (await fs.lstat(target)).isFile() ? 'file' : 'other';
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === 'ENOENT' || code === 'ENOTDIR' ? 'absent' : 'error';
  }
}

/**
 * The real I/O of the global tuning file's rename. The rename never replaces a file:
 * a hard link makes the new name only when it is absent (EEXIST otherwise), then the
 * old name is removed. A file system that cannot link falls back to a rename after an
 * absence check, as the claim code does.
 */
export function realGlobalTuningMoveIO(): GlobalTuningMoveIO {
  return {
    kindOf,
    renameIfAbsent: async (from, to) => {
      try {
        await fs.link(from, to);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'EEXIST') return { state: 'exists' };
        if (code !== 'EPERM' && code !== 'ENOTSUP' && code !== 'EXDEV') {
          return { state: 'failed', message: describeFailure(error) };
        }
        if ((await kindOf(to)) !== 'absent') return { state: 'exists' };
        try {
          await fs.rename(from, to);
          return { state: 'renamed' };
        } catch (renameError) {
          return { state: 'failed', message: describeFailure(renameError) };
        }
      }
      try {
        await fs.unlink(from);
        return { state: 'renamed' };
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        // The old name is already gone (another run finished the rename): the new name is in place.
        if (code === 'ENOENT') return { state: 'renamed' };
        return { state: 'failed', message: describeFailure(error) };
      }
    },
  };
}

/** What `runSharedMove` answers: the move's outcome, or why the store could not be used. */
export type SharedMoveResult =
  | ProjectMoveOutcome
  | { readonly kind: 'unavailable'; readonly root: string; readonly message: string };

/**
 * The one move that configure and the toggles run for a project: the package's own
 * store, the real machine and home directories, the current names, every lock taken
 * with no wait. Never throws.
 */
export async function runSharedMove(root: string): Promise<SharedMoveResult> {
  const loaded = loadCurationStore();
  if (!loaded.ok) {
    return { kind: 'unavailable', root, message: formatCurationStoreUnavailable(loaded.error) };
  }
  return moveLedgerRoot(
    root,
    { homeDir: os.homedir(), machineDir: getDevFlowDirectory(), oldName: LEGACY_NAMES.folder, newName: CURATION_DIR_NAME },
    realProjectLedgerMoveIO(loaded.value),
  );
}
