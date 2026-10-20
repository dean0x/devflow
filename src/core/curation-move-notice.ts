/**
 * @file curation-move-notice.ts
 *
 * The notice for a project whose ledger still sits in the old folder: which of the two
 * lines to show, the words of each, and where the shell shim's refusal marker for the
 * project stands. The statusline (src/hud/components/curation-counts.ts) and `devflow
 * curation --status` (src/cli/commands/curation.ts) both import it from here, so they
 * say the same words and read the same marker, and neither imports the other.
 *
 * Reads the disk with one lstat per path, never follows a link and never opens the old
 * ledger. The HUD runs it on every prompt, so it forks nothing and holds no state.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { LEGACY_NAMES, curationMoveMarkerKey } from './project-paths.js';

/**
 * What a project whose ledger is still in the old folder is told: `pointer` (nothing
 * moved it yet: open Claude Code in the project once, or run init) or `refused` (the
 * shim tried and left its refusal marker).
 */
export type CurationMoveNotice = 'pointer' | 'refused';

/**
 * The refusal marker the `curation-move` shim writes for the ledger root `root`:
 * `<home>/.devflow/logs/curation-move.<key>.skip`, the key being the root's
 * {@link curationMoveMarkerKey}. The shim builds the same path in `_df_cm_markers`
 * (src/assets/scripts/hooks/curation-move); tests/shell-hooks.test.ts runs that function
 * and requires the two to agree for short, long and non-ASCII roots.
 */
export function getCurationMoveMarkerPath(home: string, root: string): string {
  return path.join(home, '.devflow', 'logs', `curation-move.${curationMoveMarkerKey(root)}.skip`);
}

/** Whether anything, a link included, sits at `target`. One lstat, never followed. */
function exists(target: string): boolean {
  try {
    fs.lstatSync(target);
    return true;
  } catch {
    return false;
  }
}

/**
 * The one extra question of a project with no counts to show: does it still have the old
 * ledger folder? One existence test. If it does, a second one looks for the shim's
 * refusal marker under the key of this same root ({@link getCurationMoveMarkerPath}).
 * Null when the old folder is gone. The old ledger itself is never opened or counted.
 */
export function gatherMoveNotice(ledgerRoot: string, home: string): CurationMoveNotice | null {
  if (!exists(path.join(ledgerRoot, '.devflow', LEGACY_NAMES.folder))) return null;
  return exists(getCurationMoveMarkerPath(home, ledgerRoot)) ? 'refused' : 'pointer';
}

const MOVE_NOTICE_TEXT: Readonly<Record<CurationMoveNotice, string>> = {
  pointer: 'run devflow init, or open Claude Code in this project after it',
  refused: 'move refused, see the hook log',
};

/** The one line the HUD and `devflow curation` print for a notice. Both come through here. */
export function formatMoveNotice(notice: CurationMoveNotice): string {
  return `Curation: ${MOVE_NOTICE_TEXT[notice]}`;
}
