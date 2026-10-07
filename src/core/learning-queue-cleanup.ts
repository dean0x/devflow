/**
 * @file learning-queue-cleanup.ts
 *
 * `drainLearningQueue`, the learning queue drain shared by `devflow learning
 * --clear` and `--disable` (src/cli/commands/learning.ts) and by the drain
 * `devflow init` runs when learning is switched off (src/cli/commands/init.ts).
 */

import * as path from 'path';
import {
  getLearningClaimOwnerPath,
  getLearningDir,
  getLearningPendingTurnsPath,
  getLearningPendingTurnsProcessingPath,
} from './project-paths.js';
import { drainQueueFiles, type QueueDrain } from './queue-drain.js';

/**
 * Drain the learning (decisions-detection) pending-turns queue, its claimed
 * batch and the claim's owner file so stale turns don't process later — used by
 * both `--clear` and `--disable`. A mid-run Learning agent whose claimed batch
 * vanishes aborts without changes, which is the desired outcome in both cases.
 * Refused, deleting nothing, when `.devflow` or `.devflow/learning` under `gitRoot`
 * is a symbolic link (D-CLI-NO-SYMLINK). ENOENT-tolerant; other errors propagate.
 */
export async function drainLearningQueue(gitRoot: string): Promise<QueueDrain> {
  const learningDir = getLearningDir(gitRoot);
  return drainQueueFiles([path.dirname(learningDir), learningDir], [
    getLearningPendingTurnsPath(gitRoot),
    getLearningPendingTurnsProcessingPath(gitRoot),
    getLearningClaimOwnerPath(gitRoot),
  ]);
}
