/**
 * @file learning-queue-cleanup.ts
 *
 * `drainLearningQueue`, the learning queue drain shared by `devflow learning
 * --clear` and `--disable` (src/cli/commands/learning.ts) and by the drain
 * `devflow init` runs when learning is switched off (src/cli/commands/init.ts).
 */

import { promises as fs } from 'fs';
import {
  getLearningClaimOwnerPath,
  getLearningPendingTurnsPath,
  getLearningPendingTurnsProcessingPath,
} from './project-paths.js';

/**
 * Drain the learning (decisions-detection) pending-turns queue, its claimed
 * batch and the claim's owner file so stale turns don't process later — used by
 * both `--clear` and `--disable`. A mid-run Learning agent whose claimed batch
 * vanishes aborts without changes, which is the desired outcome in both cases.
 * ENOENT-tolerant; other errors propagate.
 */
export async function drainLearningQueue(gitRoot: string): Promise<void> {
  const unlinkIfPresent = (file: string): Promise<void> =>
    fs.unlink(file).catch((e: NodeJS.ErrnoException) => {
      if (e.code !== 'ENOENT') throw e;
    });
  await Promise.all([
    unlinkIfPresent(getLearningPendingTurnsPath(gitRoot)),
    unlinkIfPresent(getLearningPendingTurnsProcessingPath(gitRoot)),
    unlinkIfPresent(getLearningClaimOwnerPath(gitRoot)),
  ]);
}
