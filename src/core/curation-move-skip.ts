/**
 * @file curation-move-skip.ts
 *
 * The fixed notice of a skipped move. The move leaves a project alone, and changes
 * nothing, when git tracks files in one of the two data folders (`tracked`) or when a
 * `.git` entry stands and git did not answer (`unknown`). Pure: no fs, no os, no
 * process state, so the init step (src/cli/commands/curation-move-step.ts) and the
 * notice module (src/core/curation-move-notice.ts) can both import it.
 *
 * The words hold nothing from the repository. The session start hook
 * (src/assets/scripts/hooks/session-start-context) holds the same words;
 * tests/shell-hooks.test.ts requires the two to agree.
 */

import { CURATION_DIR_NAME, LEGACY_NAMES } from './project-paths.js';

/** Why the move left a project alone: git tracks files in a data folder, or git did not answer. */
export type MoveSkipReason = 'tracked' | 'unknown';

const MOVE_DESCRIPTION =
  `devflow did not move the curation data of this project from .devflow/${LEGACY_NAMES.folder}/ to .devflow/${CURATION_DIR_NAME}/, `;

/** The notice of each skip reason, as one paragraph of short sentences. */
export const MOVE_SKIP_NOTICE: Readonly<Record<MoveSkipReason, string>> = {
  tracked:
    `${MOVE_DESCRIPTION}because git tracks files in one of these folders. `
    + 'To find them, run `git ls-files .devflow`. '
    + 'Untrack them with `git rm --cached`, and delete them if you did not make them. '
    + 'Run these commands in the main checkout.',
  unknown:
    `${MOVE_DESCRIPTION}because git did not answer. `
    + 'The move runs again at the next session start.',
};
