/**
 * @file curation-queue-cleanup.ts
 *
 * `drainCurationQueue`, the curation queue drain shared by `devflow curation
 * --clear` and `--disable` (src/cli/commands/curation.ts) and by the drain
 * `devflow init` runs when curation is switched off (src/cli/commands/init.ts).
 */

import * as path from 'path';
import {
  LEGACY_NAMES,
  getCurationClaimOwnerPath,
  getCurationDir,
  getCurationPendingTurnsPath,
  getCurationPendingTurnsProcessingPath,
} from './project-paths.js';
import { drainQueueFiles, type QueueDrain } from './queue-drain.js';

/** The same queue file under the old ledger folder name: the new path with its folder swapped. */
function underOldFolder(gitRoot: string, newPath: string): string {
  return path.join(path.dirname(getCurationDir(gitRoot)), LEGACY_NAMES.folder, path.basename(newPath));
}

/**
 * Drain the curation (decisions-detection) pending-turns queue, its claimed
 * batch and the claim's owner file so stale turns don't process later — used by
 * both `--clear` and `--disable`. A mid-run Curate agent whose claimed batch
 * vanishes aborts without changes, which is the desired outcome in both cases.
 *
 * Drains each ledger folder that exists, the new name and the old one: a move that
 * was busy or refused leaves the old folder in place, and its queue must not process
 * on a later re-enable. A folder or file that is absent is skipped. Only the three
 * queue files go; the ledger, the log and the tuning file stay.
 *
 * Refused, deleting nothing in either folder, when `.devflow` or either ledger
 * folder under `gitRoot` is a symbolic link (D-CLI-NO-SYMLINK). ENOENT-tolerant;
 * other errors propagate.
 */
export async function drainCurationQueue(gitRoot: string): Promise<QueueDrain> {
  const curationDir = getCurationDir(gitRoot);
  const queueFiles = [
    getCurationPendingTurnsPath(gitRoot),
    getCurationPendingTurnsProcessingPath(gitRoot),
    getCurationClaimOwnerPath(gitRoot),
  ];
  return drainQueueFiles(
    [path.dirname(curationDir), curationDir, path.join(path.dirname(curationDir), LEGACY_NAMES.folder)],
    [...queueFiles, ...queueFiles.map(file => underOldFolder(gitRoot, file))],
  );
}
