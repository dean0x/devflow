/**
 * @file tracked-areas.ts
 *
 * The CLI's view of the tracked-areas check — a typed seam onto the package's own
 * `hooks/lib/tracked-areas.cjs`, never a second implementation of it.
 *
 * The check answers whether git tracks any entry under devflow's data folders at a
 * root. The one-time ledger move and the backup sweep ask it before they change
 * anything, and so does the drain of a switched-off curation
 * (src/core/curation-queue-cleanup.ts). The module is loaded with the evidence-policy
 * seam's `loadScript` from the package's own scripts directory and shape-checked against
 * TRACKED_AREAS_SURFACE; the interface below is TRANSCRIBED from the module's JSDoc and
 * is this side's only shape authority (as for the move, see curation-move.ts).
 */

import { join } from 'path';
import { scriptsDir } from './assets.js';
import { loadScript, type EvidencePolicyLoadError, type Result, type SurfaceKind } from './evidence-policy.js';

/** The check module, relative to src/assets/scripts/ (and ~/.devflow/scripts/). */
export const TRACKED_AREAS_SCRIPT_NAME = join('hooks', 'lib', 'tracked-areas.cjs');

/**
 * The check's answer. `untracked`: no `.git` entry at the root (no git call was made),
 * or git listed nothing. `tracked`: git lists an entry under a data folder, a backup
 * folder or the `.devflow` entry itself. `unknown`: a `.git` entry stands and git did
 * not answer, or the root is not an absolute path.
 */
export type TrackedAreasAnswer = 'tracked' | 'untracked' | 'unknown';

/** The part of the check module's `module.exports` the CLI calls. It never throws. */
export interface TrackedAreasModule {
  /** Whether git tracks any entry under the data folders at `root` (an absolute path). */
  checkTrackedAreas(root: unknown): TrackedAreasAnswer;
}

/**
 * Every key of TrackedAreasModule and the runtime kind the loader requires of it.
 * `satisfies` makes the compiler reject an interface key missing here.
 */
export const TRACKED_AREAS_SURFACE = Object.freeze({
  checkTrackedAreas: 'function',
} as const satisfies Record<keyof TrackedAreasModule, SurfaceKind>);

export type TrackedAreasLoad = Result<TrackedAreasModule, EvidencePolicyLoadError>;

/**
 * Load the tracked-areas module from `dir` (default: the package's own scripts
 * directory) and shape-check its surface. Never throws: a missing file is
 * `not-found`; a module that throws on load or lacks a surface key is `unusable`.
 */
export function loadTrackedAreas(dir: string = scriptsDir()): TrackedAreasLoad {
  return loadScript<TrackedAreasModule>(join(dir, TRACKED_AREAS_SCRIPT_NAME), TRACKED_AREAS_SURFACE);
}
