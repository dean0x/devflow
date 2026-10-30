/**
 * The swap of a folder that devflow owns and that may hold files of the user's: a skill folder the
 * converge replaces. The new folder is built beside the old one and renamed in; the old folder waits
 * in an aside folder while that happens.
 *
 * Nothing here removes a folder with a recursive `rm`. Before the swap, the backup session moves
 * every file devflow did not ship out of the old folder. If any file could not move, the folder is
 * not swapped: the files devflow ships are written into it one by one, and it stays in place. The
 * write comes before any removal, so a copy that fails leaves the old shipped files in the folder;
 * then only the listed entries that the new folder lacks are removed. The same holds when the aside
 * name is taken by a folder that keeps a file. A file at the aside name
 * moves to the backup folder first; if it cannot move, a rename never replaces it, so a folder
 * stays in place and a link makes the swap throw. After
 * a swap, the aside folder is scanned again, because a file can arrive between the first scan and the
 * rename. What the session moves out of it is named, what devflow shipped is removed by the list the
 * scan made, and the folder goes with a plain `rmdir`; a folder that still holds a file stays.
 *
 * This module imports no installer module, so the install and the converge steps can all use it.
 * A swap that cannot finish throws, and the caller reports it.
 */
import { promises as fs } from 'fs';
import * as path from 'path';

import { DEFAULT_ENTRY_CAP, MAX_WALK_DEPTH, type BackupSession } from './install-backup.js';
import { directoryState, unlinkLinkAt, type LinkReport } from './linked-folder.js';

/** How a swap ended: the new folder replaced the old one, or its files were written into the old one. */
export type FolderSwapOutcome = 'swapped' | 'merged';

export interface FolderSwapOptions {
  /** The backup session of the run. */
  readonly backups: BackupSession;
  /** The folder devflow owns. A link or a file there is replaced. */
  readonly target: string;
  /** The finished new folder, on the same volume as `target`. */
  readonly staged: string;
  /** Where the old folder waits during the swap: a path under the Claude dir, on the same volume as `target`. */
  readonly aside: string;
  /** Receives `target` when a link stood there and a real folder stands there now. */
  readonly links: Pick<LinkReport, 'replacedLinks'>;
  /** Write the files of `staged` into `target`, which stays in place. Called only when the swap is skipped. */
  readonly mergeInto: () => Promise<void>;
}

const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/**
 * Remove a folder that was displaced from `stoodAt`: scan it as if it still stood there, move what
 * devflow did not ship, remove what it shipped by the session's list, then `rmdir`. A displaced link
 * is unlinked. A folder that still holds a file stays, and the session's record names the file.
 */
export async function discardDisplacedFolder(backups: BackupSession, aside: string, stoodAt: string): Promise<void> {
  const state = await directoryState(aside);
  if (state === 'link') {
    await unlinkLinkAt(aside);
    return;
  }
  if (state !== 'real') return;
  await backups.prepass([{ folder: aside, displacedFrom: stoodAt }]);
  await backups.removeListed(aside);
}

/**
 * The files and links below `staged` as paths relative to it, with `/` separators. Null when the
 * walk reached its depth or entry bound, because a list that stops early would name too few.
 */
async function stagedPaths(staged: string): Promise<ReadonlySet<string> | null> {
  const found = new Set<string>();
  async function walk(folder: string, rel: string, depth: number): Promise<boolean> {
    if (depth > MAX_WALK_DEPTH) return false;
    const entries = await fs.readdir(folder, { withFileTypes: true });
    for (const entry of entries) {
      const childRel = rel === '' ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!(await walk(path.join(folder, entry.name), childRel, depth + 1))) return false;
      } else {
        found.add(childRel);
        if (found.size > DEFAULT_ENTRY_CAP) return false;
      }
    }
    return true;
  }
  return (await walk(staged, '', 0)) ? found : null;
}

/**
 * Write the files of `staged` into `target`, then remove what the old folder held and the new one
 * lacks. The write comes first: if the copy fails, the files devflow shipped are still in the old
 * folder. The removal scans `target` again with a filter that leaves every staged path, every kept
 * file and everything below a kept folder alone, so `removeListed` takes only the listed leftovers
 * (retired and sidecar names, `.DS_Store`) and the shipped files that the new release dropped.
 * When the staged list is not complete, nothing is removed.
 */
async function mergeThenClear(
  backups: BackupSession,
  target: string,
  staged: string,
  mergeInto: () => Promise<void>,
): Promise<void> {
  const written = await stagedPaths(staged);
  await mergeInto();
  if (written === null) return;
  await backups.prepass([{
    folder: target,
    include: (relative, kind) =>
      !(kind !== 'directory' && written.has(relative)) && !backups.isKept(path.join(target, ...relative.split('/'))),
  }]);
  await backups.removeListed(target);
}

/**
 * Put `staged` at `target`. See the module comment for the order of the steps.
 *
 * If the rename of `staged` fails, the old folder is renamed back. If that fails too, the old folder
 * stays at `aside` and the error names the path. Throws on a failure that leaves the swap undone.
 */
export async function swapFolderIn(options: FolderSwapOptions): Promise<FolderSwapOutcome> {
  const { backups, target, staged, aside, links, mergeInto } = options;

  // What an earlier, interrupted swap left at the aside name is cleared first, so the rename below has a free name.
  // A file there is not a displaced folder: it moves to the backup folder, because a rename replaces it without a trace.
  await discardDisplacedFolder(backups, aside, target);
  if ((await directoryState(aside)) === 'unusable') await backups.moveWhole(aside);
  const asideTaken = (await directoryState(aside)) !== 'absent';

  let state = await directoryState(target);
  if (state === 'unusable') {
    const moved = await backups.moveWhole(target);
    if (moved.status === 'kept') {
      throw new Error(`${target} is not a folder and could not be moved aside (${moved.reason})`);
    }
    state = 'absent';
  }

  if (state === 'real') {
    await backups.prepass([target]);
    if (asideTaken || backups.keptUnder(target).length > 0) {
      await mergeThenClear(backups, target, staged, mergeInto);
      return 'merged';
    }
  }
  if (state === 'link' && asideTaken) {
    throw new Error(`${target} is a link and was not replaced: ${aside} is in the way and could not be moved`);
  }

  const displaced = state !== 'absent';
  if (displaced) await fs.rename(target, aside);
  try {
    await fs.rename(staged, target);
  } catch (err) {
    if (displaced) {
      try {
        await fs.rename(aside, target);
      } catch (restoreErr) {
        throw new Error(
          `${errorMessage(err)}; the previous folder could not be put back (${errorMessage(restoreErr)}) and is kept at ${aside}`,
        );
      }
    }
    throw err;
  }
  if (state === 'link') links.replacedLinks.push(target);
  if (displaced) await discardDisplacedFolder(backups, aside, target);
  return 'swapped';
}
