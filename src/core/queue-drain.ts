/**
 * @file queue-drain.ts
 *
 * `drainQueueFiles`, the delete the queue drains share — `drainLearningQueue`
 * (learning-queue-cleanup.ts) and `drainMemoryQueue` (cli/commands/memory.ts) —
 * and `formatRefusedDrain`, the line the CLI prints for a drain it refused.
 */

import { promises as fs } from 'fs';
import { firstSymbolicLink } from './linked-path.js';

/**
 * What a queue drain did: drained the queue, every file of which is gone whether or
 * not it was there; or refused, naming the folder on the way to the queue that is a
 * symbolic link, and deleted nothing (D-CLI-NO-SYMLINK).
 */
export type QueueDrain =
  | { readonly drained: true }
  | { readonly drained: false; readonly linkedFolder: string };

/**
 * Delete each of `files` unless one of `folders` — `.devflow` and the folder that
 * holds the files, outermost first — is a symbolic link (D-CLI-NO-SYMLINK): through a
 * linked folder, each delete would remove a same-named file wherever the link points.
 * A file that is already gone is not an error; any other failure propagates, as the
 * check's own does, so the command reports it.
 */
export async function drainQueueFiles(folders: readonly string[], files: readonly string[]): Promise<QueueDrain> {
  const linkedFolder = await firstSymbolicLink(folders);
  if (linkedFolder !== null) return { drained: false, linkedFolder };
  await Promise.all(files.map(file => fs.unlink(file).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;
  })));
  return { drained: true };
}

/** The warning for a drain refused at `linkedFolder`: which queue kept its files, and why. */
export function formatRefusedDrain(queue: 'learning' | 'memory', linkedFolder: string): string {
  return `The ${queue} queue was not drained: ${linkedFolder} is a symbolic link, and devflow deletes nothing through one`;
}
