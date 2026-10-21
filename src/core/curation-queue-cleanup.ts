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
import { loadCurationMove, type CurationMoveLoad, type MoveSkipReason } from './curation-move.js';
import { MOVE_SKIP_NOTICE } from './curation-move-skip.js';
import { formatCurationStoreUnavailable } from './curation-store.js';
import { drainQueueFiles, formatRefusedDrain, type QueueDrain } from './queue-drain.js';
import { loadTrackedAreas, type TrackedAreasAnswer, type TrackedAreasLoad } from './tracked-areas.js';

/**
 * What {@link drainCurationQueue} and {@link drainDisabledCurationQueue} did: a
 * {@link QueueDrain}, or `skipped`, which deleted nothing because git tracks files in a
 * curation data folder (`tracked`) or did not answer (`unknown`).
 */
export type CurationQueueDrain =
  | QueueDrain
  | { readonly drained: false; readonly skipped: MoveSkipReason };

/** The folders to check for links, and the queue files to delete, in the live and the old ledger folder of `gitRoot`. */
function liveQueueTargets(gitRoot: string): { readonly folders: readonly string[]; readonly files: readonly string[] } {
  const curationDir = getCurationDir(gitRoot);
  const devflowDir = path.dirname(curationDir);
  const oldDir = path.join(devflowDir, LEGACY_NAMES.folder);
  const queueFiles = [
    getCurationPendingTurnsPath(gitRoot),
    getCurationPendingTurnsProcessingPath(gitRoot),
    getCurationClaimOwnerPath(gitRoot),
  ];
  return {
    folders: [devflowDir, curationDir, oldDir],
    files: [...queueFiles, ...queueFiles.map(file => path.join(oldDir, path.basename(file)))],
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
 * Asks first the question the disable drain asks (see {@link drainDisabledCurationQueue}):
 * when git tracks any entry under the data folders or a backup folder of `gitRoot`, or
 * does not answer, nothing is deleted and the answer is `skipped`.
 *
 * Refused, deleting nothing in either folder, when `.devflow` or either ledger
 * folder under `gitRoot` is a symbolic link (D-CLI-NO-SYMLINK). ENOENT-tolerant;
 * other errors propagate.
 *
 * `loadTracking` is the check's loader; its default is the package's own copy.
 */
export async function drainCurationQueue(
  gitRoot: string,
  loadTracking: () => TrackedAreasLoad = loadTrackedAreas,
): Promise<CurationQueueDrain> {
  const skipped = trackedSkip(gitRoot, loadTracking);
  if (skipped !== null) return skipped;
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
 * Asks first whether git tracks any entry under the data folders or a backup folder of
 * `gitRoot`, the question the move asks (the tracked-areas check). A folder that git
 * tracks is the repository's content, so the drain leaves the project alone: it deletes
 * nothing in the live folder, the old folder or any backup, and answers `skipped` with
 * the reason `tracked`, or `unknown` when a `.git` entry stands and git did not answer
 * (a check that cannot be loaded, or a root that is not absolute, answers `unknown`
 * too). A root with no `.git` entry makes no git call and drains as usual.
 *
 * Refused, deleting nothing anywhere, when a link is in the way: `.devflow`, either
 * ledger folder, a backup folder that may hold rows, or one of a backup's queue files.
 * The answer names the link. ENOENT-tolerant. Any other failure of the backup list, a
 * move module that does not load or a folder that cannot be read, never stops the
 * drain of the live and the old folder: those drain as usual, and the answer carries
 * a `warning` that the backups were not drained, which the caller prints.
 *
 * `load` is the move module's loader and `loadTracking` the check's; each default is
 * the package's own copy.
 */
export async function drainDisabledCurationQueue(
  gitRoot: string,
  load: () => CurationMoveLoad = loadCurationMove,
  loadTracking: () => TrackedAreasLoad = loadTrackedAreas,
): Promise<CurationQueueDrain> {
  const skipped = trackedSkip(gitRoot, loadTracking);
  if (skipped !== null) return skipped;
  const { folders, files } = liveQueueTargets(gitRoot);
  const loaded = load();
  const listed = loaded.ok ? loaded.value.backupQueueFiles(gitRoot) : null;
  if (listed !== null && !listed.ok && listed.error.kind === 'refused' && listed.error.path !== undefined) {
    return { drained: false, linkedFolder: listed.error.path };
  }
  const drain = await drainQueueFiles(folders, [...files, ...(listed !== null && listed.ok ? listed.value.files : [])]);
  if (!drain.drained) return drain;
  const failure = !loaded.ok ? formatCurationStoreUnavailable(loaded.error) : listed !== null && !listed.ok ? listed.error.message : null;
  return failure === null ? drain : { drained: true, warning: formatBackupsNotDrained(failure) };
}

/**
 * The skipped answer for `root`, or null when the drain may go on. The tracked-areas
 * check decides; a check that cannot be loaded cannot answer, so it is `unknown`.
 */
function trackedSkip(root: string, load: () => TrackedAreasLoad): { readonly drained: false; readonly skipped: MoveSkipReason } | null {
  const loaded = load();
  const answer: TrackedAreasAnswer = loaded.ok ? loaded.value.checkTrackedAreas(root) : 'unknown';
  return answer === 'untracked' ? null : { drained: false, skipped: answer };
}

/**
 * The line a caller prints for a drain that deleted nothing: the fixed notice of a
 * skipped project (no repository content in it), or the refusal at a link. When the
 * caller has just printed that notice (`shown`, the reason it showed), the line does
 * not repeat it.
 */
export function formatCurationNotDrained(
  drain: Exclude<CurationQueueDrain, { readonly drained: true }>,
  shown: MoveSkipReason | null = null,
): string {
  if (!('skipped' in drain)) return formatRefusedDrain('curation', drain.linkedFolder);
  const line = 'The curation queue was not drained.';
  return shown === drain.skipped ? line : `${line} ${MOVE_SKIP_NOTICE[drain.skipped]}`;
}

/** The warning for a disable drain that could not list the backups: the live queue is drained, the backups are not. */
function formatBackupsNotDrained(reason: string): string {
  return `The queue files of the backup folders were not drained: ${reason}. The live curation queue was drained.`;
}
