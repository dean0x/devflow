/**
 * @file area-pause-notice.ts
 *
 * The fixed notice of a paused area. When git tracks files in the folders of an area, or
 * a `.git` entry stands and git did not answer, the area's feature reads and writes
 * nothing there, and says so once at session start. The curation area covers the curation
 * folder, the old ledger folder and the backup folders with one notice; the memory
 * area covers the memory folder. Pure: no fs, no os, no process state.
 *
 * The words hold nothing from the repository: the area is a fixed enum, and no path,
 * count or git output goes into them. The session start hook
 * (src/assets/scripts/hooks/session-start-context) holds the curation words, and the
 * memory session start hook (src/assets/scripts/hooks/session-start-memory) holds the
 * memory words; tests/shell-hooks.test.ts requires each copy to agree with this module.
 * The two commands a notice tells the user to run are listed in NOTICE_COMMAND_PHRASES in
 * tests/guards/no-fsmonitor-index-read.test.ts, which holds every copy to them.
 */

/** The areas that can pause: the two data areas of the tracked-areas check. */
export type PausedArea = 'curation' | 'memory';

/** Why an area is paused: git tracks files in its folders, or git did not answer. */
export type PauseReason = 'tracked' | 'unknown';

const UNTRACK_STEPS =
  'To find the files, run `git ls-files .devflow`. '
  + 'Untrack them with `git rm --cached <file>`, then delete them if you did not make them. ';

const RETRY_STEPS =
  'The check runs again at the next session start. ';

/** The notice of each paused area and reason, as one paragraph of short sentences. */
export const AREA_PAUSE_NOTICE: Readonly<Record<PausedArea, Readonly<Record<PauseReason, string>>>> = {
  curation: {
    tracked:
      'Devflow curation is paused for this project, because git tracks files in a curation data folder. '
      + 'Devflow reads and writes nothing in these folders while git tracks files there. '
      + UNTRACK_STEPS
      + 'Run these commands in the main checkout.',
    unknown:
      'Devflow curation is paused for this project, because git did not answer whether it tracks files in a curation data folder. '
      + 'Devflow reads and writes nothing in these folders until git answers. '
      + RETRY_STEPS
      + 'If this notice stays, check that git runs in this project.',
  },
  memory: {
    tracked:
      'Devflow memory is paused for this checkout, because git tracks files in the memory folder. '
      + 'Devflow reads and writes nothing there while git tracks files there. '
      + UNTRACK_STEPS
      + 'Run these commands in this checkout.',
    unknown:
      'Devflow memory is paused for this checkout, because git did not answer whether it tracks files in the memory folder. '
      + 'Devflow reads and writes nothing there until git answers. '
      + RETRY_STEPS
      + 'If this notice stays, check that git runs in this checkout.',
  },
};
