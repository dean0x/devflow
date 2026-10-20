/**
 * @file curation-queue-cleanup.ts
 *
 * The curation queue drains: `drainCurationQueue`, which `devflow curation --clear`
 * runs (src/cli/commands/curation.ts), and `drainDisabledCurationQueue`, which `devflow
 * curation --disable` and the drain `devflow init` runs when curation is switched off
 * (src/cli/commands/init.ts) run: the same drain, and the pending rows of the backups
 * a move left as well.
 */

import * as path from 'path';
import {
  LEGACY_NAMES,
  getCurationClaimOwnerPath,
  getCurationDir,
  getCurationPendingTurnsPath,
  getCurationPendingTurnsProcessingPath,
} from './project-paths.js';
import { loadCurationMove } from './curation-move.js';
import { formatCurationStoreUnavailable } from './curation-store.js';
import { drainQueueFiles, type QueueDrain } from './queue-drain.js';

/** The same queue file under the old ledger folder name: the new path with its folder swapped. */
function underOldFolder(gitRoot: string, newPath: string): string {
  return path.join(path.dirname(getCurationDir(gitRoot)), LEGACY_NAMES.folder, path.basename(newPath));
}

/** The folders to check for links, and the queue files to delete, in the live and the old ledger folder of `gitRoot`. */
function liveQueueTargets(gitRoot: string): { readonly folders: readonly string[]; readonly files: readonly string[] } {
  const curationDir = getCurationDir(gitRoot);
  const queueFiles = [
    getCurationPendingTurnsPath(gitRoot),
    getCurationPendingTurnsProcessingPath(gitRoot),
    getCurationClaimOwnerPath(gitRoot),
  ];
  return {
    folders: [path.dirname(curationDir), curationDir, path.join(path.dirname(curationDir), LEGACY_NAMES.folder)],
    files: [...queueFiles, ...queueFiles.map(file => underOldFolder(gitRoot, file))],
  };
}

/**
 * Drain the curation (decisions-detection) pending-turns queue, its claimed
 * batch and the claim's owner file so stale turns don't process later — used by
 * `--clear`. A mid-run Curate agent whose claimed batch vanishes aborts without
 * changes, which is the desired outcome.
 *
 * Drains each ledger folder that exists, the new name and the old one: a move that
 * was busy or refused leaves the old folder in place, and its queue must not process
 * on a later re-enable. A folder or file that is absent is skipped. Only the three
 * queue files go; the ledger, the log and the tuning file stay, and so does every
 * backup folder a move left (see {@link drainDisabledCurationQueue}).
 *
 * Refused, deleting nothing in either folder, when `.devflow` or either ledger
 * folder under `gitRoot` is a symbolic link (D-CLI-NO-SYMLINK). ENOENT-tolerant;
 * other errors propagate.
 */
export async function drainCurationQueue(gitRoot: string): Promise<QueueDrain> {
  const { folders, files } = liveQueueTargets(gitRoot);
  return drainQueueFiles(folders, files);
}

/**
 * The drain of a switched-off curation: {@link drainCurationQueue}, and the pending
 * rows of the backup folders a move left as well. A backup's queue, claim, private and
 * overflow files go (the files `devflow curation --status` counts as pending rows);
 * its ledger files, its swept files and the claim's owner file stay. Without this, a
 * later re-enable and init would merge the backup's rows into the live queue, which is
 * the turns the drain exists to discard. The backups are read within the sweep's
 * bounds: 500 backup folders, and 200 files in each.
 *
 * Refused, deleting nothing anywhere, when a link is in the way: `.devflow`, either
 * ledger folder, a backup folder that may hold rows, or one of a backup's queue files.
 * The answer names the link. ENOENT-tolerant. A backup list that cannot be made throws,
 * as any other failure does, so the command reports it.
 */
export async function drainDisabledCurationQueue(gitRoot: string): Promise<QueueDrain> {
  const { folders, files } = liveQueueTargets(gitRoot);
  const loaded = loadCurationMove();
  if (!loaded.ok) throw new Error(`The backup folders could not be checked for queue files: ${formatCurationStoreUnavailable(loaded.error)}`);
  const listed = loaded.value.backupQueueFiles(gitRoot);
  if (!listed.ok) {
    if (listed.error.kind === 'refused' && listed.error.path !== undefined) {
      return { drained: false, linkedFolder: listed.error.path };
    }
    throw new Error(listed.error.message);
  }
  return drainQueueFiles(folders, [...files, ...listed.value.files]);
}
