/**
 * @file curation-move-notice.ts
 *
 * The notice for a project whose ledger still sits in the old folder: which line to
 * show, the words of each, the fixed notice of a skipped move, and where the shell
 * shim's markers for the project stand. The statusline (src/hud/components/curation-counts.ts)
 * and `devflow curation` (src/cli/commands/curation.ts) both import it from here, so they
 * say the same words and read the same markers, and neither imports the other.
 *
 * Reads the disk with one lstat per path, never follows a link and never opens the old
 * ledger. The HUD runs it on every prompt, so it forks nothing and holds no state.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { CURATION_DIR_NAME, LEGACY_NAMES, curationMoveMarkerKey } from './project-paths.js';
import { MOVE_SKIP_NOTICE, type MoveSkipReason } from './curation-move-skip.js';

/**
 * What a project whose ledger is still in the old folder is told: `pointer` (nothing
 * moved it yet: open Claude Code in the project once, or run init), `refused` (the
 * shim tried and left its refusal marker), or a skip reason (the shim tried and left
 * that reason's marker).
 */
export type CurationMoveNotice = 'pointer' | 'refused' | MoveSkipReason;

/**
 * The marker suffixes the `curation-move` shim writes: `skip` for a refusal or a failure,
 * and one for each {@link MoveSkipReason}.
 */
export type MoveMarkerKind = 'skip' | MoveSkipReason;

/**
 * The marker the `curation-move` shim writes for the ledger root `root`:
 * `<home>/.devflow/logs/curation-move.<key>.<kind>`, the key being the root's
 * {@link curationMoveMarkerKey}. Without `kind` it is the refusal marker (`skip`). The
 * shim builds the same paths in `_df_cm_markers` (src/assets/scripts/hooks/curation-move);
 * tests/shell-hooks.test.ts runs that function and requires the two to agree for short,
 * long and non-ASCII roots. Every marker stands outside the project, so a skipped move
 * writes nothing into it.
 */
export function getCurationMoveMarkerPath(home: string, root: string, kind: MoveMarkerKind = 'skip'): string {
  return path.join(home, '.devflow', 'logs', `curation-move.${curationMoveMarkerKey(root)}.${kind}`);
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

/** The markers {@link gatherMoveNotice} looks for, in the order it prefers them, and the notice each one means. */
const MARKER_NOTICES: ReadonlyArray<readonly [MoveMarkerKind, CurationMoveNotice]> = [
  ['tracked', 'tracked'],
  ['unknown', 'unknown'],
  ['skip', 'refused'],
];

/**
 * The one extra question of a project with no counts to show: does it still have the old
 * ledger folder? One existence test. If it does, one more for each of the shim's markers
 * under the key of this same root ({@link getCurationMoveMarkerPath}) says which notice
 * applies. Null when the old folder is gone. The old ledger itself is never opened or counted.
 */
export function gatherMoveNotice(ledgerRoot: string, home: string): CurationMoveNotice | null {
  if (!exists(path.join(ledgerRoot, '.devflow', LEGACY_NAMES.folder))) return null;
  const found = MARKER_NOTICES.find(([kind]) => exists(getCurationMoveMarkerPath(home, ledgerRoot, kind)));
  return found === undefined ? 'pointer' : found[1];
}

const MOVE_NOTICE_TEXT: Readonly<Record<CurationMoveNotice, string>> = {
  pointer: 'run devflow init, or open Claude Code in this project after it',
  refused: 'move refused, see the hook log',
  tracked: `move skipped, git tracks files in .devflow/${LEGACY_NAMES.folder}/ or .devflow/${CURATION_DIR_NAME}/`,
  unknown: 'move skipped, git did not answer',
};

/** The one line the HUD prints for a notice. */
export function formatMoveNotice(notice: CurationMoveNotice): string {
  return `Curation: ${MOVE_NOTICE_TEXT[notice]}`;
}

/**
 * The text `devflow curation --status`, `--list` and `--show` print for a notice: the HUD's
 * line, except that a skipped move gets its whole fixed notice (MOVE_SKIP_NOTICE),
 * because these commands have room to say what to do.
 */
export function describeMoveNotice(notice: CurationMoveNotice): string {
  return notice === 'tracked' || notice === 'unknown' ? `Curation: ${MOVE_SKIP_NOTICE[notice]}` : formatMoveNotice(notice);
}
