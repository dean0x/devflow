/**
 * @file curation-move-skip.ts
 *
 * The fixed notice of a skipped move. The move leaves a project alone, and changes
 * nothing, when git tracks files in a curation data folder (`tracked`) or when a
 * `.git` entry stands and git did not answer (`unknown`). Pure: no fs, no os, no
 * process state, so the init step (src/cli/commands/curation-move-step.ts) and the
 * notice module (src/core/curation-move-notice.ts) can both import it.
 *
 * The words hold nothing from the repository. The two commands the notice tells the
 * user to run are listed in NOTICE_COMMAND_PHRASES in
 * tests/guards/no-fsmonitor-index-read.test.ts, which holds this file to them. The
 * notice of a paused area is in src/core/area-pause-notice.ts.
 */

import { CURATION_DIR_NAME, LEGACY_NAMES } from './project-paths.js';
import type { MoveSkipReason } from './curation-move.js';

const MOVE_DESCRIPTION =
  `devflow did not move the curation data of this project from .devflow/${LEGACY_NAMES.folder}/ to .devflow/${CURATION_DIR_NAME}/, `;

/** The notice of each skip reason, as one paragraph of short sentences. */
export const MOVE_SKIP_NOTICE: Readonly<Record<MoveSkipReason, string>> = {
  tracked:
    `${MOVE_DESCRIPTION}because git tracks files in a curation data folder. `
    + 'To find them, run `git ls-files .devflow`. '
    + 'Untrack them with `git rm --cached <file>`, and delete them if you did not make them. '
    + 'Run these commands in the checkout that holds these folders.',
  unknown:
    `${MOVE_DESCRIPTION}because git did not answer. `
    + 'The move runs again at the next session start or the next init. '
    + 'If this notice stays, check that git runs in this project.',
};

/**
 * Whether `value` is a {@link MoveSkipReason}: a reason that has a notice. The members
 * come from the keys of {@link MOVE_SKIP_NOTICE}, which the compiler requires to list
 * every reason, so this module needs no runtime import of the move seam.
 */
export function isMoveSkipReason(value: unknown): value is MoveSkipReason {
  return typeof value === 'string' && Object.hasOwn(MOVE_SKIP_NOTICE, value);
}
