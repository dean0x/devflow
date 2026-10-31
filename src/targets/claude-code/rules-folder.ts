import type { BackupSession } from './install-backup.js';
import { directoryState, refusedFolderStatement, unlinkLinkAt } from './linked-folder.js';

/**
 * What {@link removeRulesFolder} left at the rules folder.
 *
 * - `absent`: nothing stood there.
 * - `removed`: the folder is gone; the files devflow does not ship moved to the backup folder first.
 * - `unlinked`: a link stood there and is gone; what it pointed to was not touched.
 * - `kept`: the folder stays because a file in it could not move. The session records each one.
 * - `refused`: a link that could not be removed, or something that is not a folder, stands there.
 *   It was not touched.
 */
export type RulesFolderRemoval = 'absent' | 'removed' | 'unlinked' | 'kept' | 'refused';

/**
 * Remove the rules folder devflow installs into, without deleting a file of the user's: the files
 * devflow did not ship move to the backup folder, the files it shipped are removed by the list the
 * session made, and a plain `rmdir` removes the folder only when nothing is left in it.
 *
 * A link is unlinked and never followed, and a path that is not a folder is left as it is. Never
 * throws.
 */
export async function removeRulesFolder(rulesFolder: string, backups: BackupSession): Promise<RulesFolderRemoval> {
  const state = await directoryState(rulesFolder);
  switch (state) {
    case 'absent':
      return 'absent';
    case 'link':
      return (await unlinkLinkAt(rulesFolder)) === 'unlinked' ? 'unlinked' : 'refused';
    case 'unusable':
      return 'refused';
    case 'real': {
      await backups.prepass([rulesFolder]);
      const removal = await backups.removeListed(rulesFolder);
      return removal.folderRemoved ? 'removed' : 'kept';
    }
    default: {
      const unreachable: never = state;
      return unreachable;
    }
  }
}

/** The line for a rules folder that {@link removeRulesFolder} refused to touch. */
export function rulesFolderRefusedMessage(rulesFolder: string): string {
  return `${refusedFolderStatement(rulesFolder)} It was left as it is.`;
}
