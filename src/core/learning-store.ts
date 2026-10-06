/**
 * The CLI's view of the learning store — a typed seam onto the package's own
 * `hooks/lib/learning-store.cjs`, never a second implementation of it.
 *
 * D-LEARNING-STORE-SEAM: `devflow learning` reads and writes the learning tree only
 * through the store module json-helper's ops and the hooks run, loaded with the
 * evidence-policy seam's `loadScript` from the package's own scripts directory and
 * shape-checked against LEARNING_STORE_SURFACE; the interfaces below are
 * TRANSCRIBED from the store's JSDoc and are this side's only shape authority.
 * Reason: the CLI's own TypeScript reader judged every row by the v1 shape, so it
 * counted v2 observations as invalid, and its `--clear` truncated the log without
 * the lock every learning writer takes.
 *
 * As with the evidence resolver (D-POLICY-CJS-SEAM), the CLI loads the package
 * copy, which `npm` installs with this CLI, not `~/.devflow/scripts`, which
 * `devflow init` refreshes: the two can differ until the next init.
 */

import { join } from 'path';
import { scriptsDir } from './assets.js';
import { loadScript, type EvidencePolicyLoadError, type Result, type SurfaceKind } from './evidence-policy.js';

/** The store, relative to src/assets/scripts/ (and ~/.devflow/scripts/). */
export const LEARNING_STORE_SCRIPT_NAME = join('hooks', 'lib', 'learning-store.cjs');

// ── Transcribed shapes (learning-store.cjs JSDoc) ──────────────────────────────

/** A ledger or log row as the store read it: one JSON object, any keys. */
export type LearningRow = Readonly<Record<string, unknown>>;

/** A line the store read and skipped because it is not one JSON object. */
export interface RejectedLine {
  readonly line: number;
  readonly text: string;
}

/** `readLearningState`'s answer: both files' rows, and their malformed lines. */
export interface LearningState {
  readonly ledgerRows: readonly LearningRow[];
  readonly logRows: readonly LearningRow[];
  readonly rejected: { readonly ledger: readonly RejectedLine[]; readonly log: readonly RejectedLine[] };
}

/**
 * An entry in a listing; `note` is set on inactive entries only. `observations`
 * and `last_seen` are those of the log row carrying the entry's id, null without
 * one; `scope` is the ledger row's, null when it has none (a v1 row).
 */
export interface ListingEntry {
  readonly anchor_id: string;
  readonly id: unknown;
  readonly type: unknown;
  readonly status: string | null;
  readonly title: string;
  readonly schema: 1 | 2;
  readonly last_verified?: string;
  readonly observations: number | null;
  readonly last_seen: string | null;
  readonly scope: readonly unknown[] | null;
  readonly note?: string;
}

/** An observation no ledger row carries, in a listing. */
export interface ListingObservation {
  readonly id: string;
  readonly type: unknown;
  readonly title: string;
  readonly schema: 1 | 2;
  readonly observations: number | null;
  readonly last_seen: string | null;
}

/** An active entry's integrity flags. */
export interface IntegrityEntry {
  readonly anchor_id: string;
  readonly id: unknown;
  readonly flags: readonly string[];
}

/** `buildListing`'s answer. */
export interface LearningListing {
  readonly active: readonly ListingEntry[];
  readonly inactive: readonly ListingEntry[];
  readonly observations: readonly ListingObservation[];
  readonly integrity: readonly IntegrityEntry[];
  readonly malformed: { readonly ledger: number; readonly log: number };
}

/** `showByKey`'s answer: `malformed` is present only when lines were skipped. */
export interface ShownEntry {
  readonly key: string;
  readonly ledger: readonly LearningRow[];
  readonly log: LearningRow | null;
  readonly history_versions: readonly LearningRow[];
  readonly flags: ReadonlyArray<{ readonly anchor_id: string; readonly flag: string; readonly fields: readonly string[] }>;
  readonly malformed?: { readonly ledger: number; readonly log: number };
}

/** Why a store function refused. `kind` names the case; `message` names the op and says what was written. */
export interface LearningStoreError {
  readonly kind: string;
  readonly message: string;
}

export type LearningStoreResult<T> = Result<T, LearningStoreError>;

/**
 * The part of the store's `module.exports` the CLI calls. Each function refuses
 * without `.devflow/learning/` (error kind `no-learning-dir`); the writers wait at
 * most `timeoutMs` for the learning lock (error kind `busy`).
 */
export interface LearningStoreModule {
  /** The inactive entry statuses, in the store's order. */
  readonly INACTIVE_STATUSES: readonly string[];
  /** An entry id: ADR-NNN or PF-NNN. */
  readonly ANCHOR_ID_RE: RegExp;
  /** Both files' rows, read-only; an absent file reads as empty. */
  readLearningState(root: string): LearningState;
  /** The listing of rows already read; without `scopeMatches` no scope is checked. */
  buildListing(
    ledger: readonly LearningRow[],
    log: readonly LearningRow[],
    opts?: {
      readonly scopeMatches?: (glob: string) => boolean;
      readonly rejected?: { readonly ledger?: readonly unknown[]; readonly log?: readonly unknown[] };
    },
  ): LearningListing;
  /** The listing behind `list`, read-only, every glob scope checked against the tracked files. */
  readListing(root: string, opts?: { readonly scopeMatches?: (glob: string) => boolean }): LearningStoreResult<LearningListing>;
  /** The text `list` prints, with no final newline. */
  formatListing(listing: LearningListing): string;
  /** The entry behind `show <anchor|obs_id>`, read-only. */
  showByKey(root: string, key: string): LearningStoreResult<ShownEntry>;
  /** Make an inactive entry active again and re-render; throws TypeError for a malformed anchor id. */
  restoreAnchor(
    root: string,
    anchorId: string,
    opts?: { readonly now?: number; readonly timeoutMs?: number },
  ): LearningStoreResult<{ readonly anchor_id: string; readonly status: string }>;
  /** Drop the log rows no ledger row carries (D-CLEAR-UNREFERENCED). */
  clearUnreferenced(
    root: string,
    opts?: { readonly now?: number; readonly timeoutMs?: number },
  ): LearningStoreResult<{ readonly cleared: number; readonly kept: number }>;
  /** Remove every learning file, then the emptied learning directory (D-RESET-UNDER-LOCK). */
  resetLearning(
    root: string,
    opts?: { readonly timeoutMs?: number },
  ): LearningStoreResult<{ readonly removed: number }>;
}

/**
 * Every key of LearningStoreModule and the runtime kind the loader requires of
 * it. `satisfies` makes the compiler reject an interface key missing here.
 */
export const LEARNING_STORE_SURFACE = Object.freeze({
  INACTIVE_STATUSES: 'string-array',
  ANCHOR_ID_RE: 'regexp',
  readLearningState: 'function',
  buildListing: 'function',
  readListing: 'function',
  formatListing: 'function',
  showByKey: 'function',
  restoreAnchor: 'function',
  clearUnreferenced: 'function',
  resetLearning: 'function',
} as const satisfies Record<keyof LearningStoreModule, SurfaceKind>);

export type LearningStoreLoad = Result<LearningStoreModule, EvidencePolicyLoadError>;

/**
 * Load the learning store from `dir` (default: the package's own scripts
 * directory) and shape-check its surface. Never throws: a missing file is
 * `not-found`; a module that throws on load or lacks a surface key is `unusable`.
 */
export function loadLearningStore(dir: string = scriptsDir()): LearningStoreLoad {
  return loadScript<LearningStoreModule>(join(dir, LEARNING_STORE_SCRIPT_NAME), LEARNING_STORE_SURFACE);
}

/**
 * Why the store cannot be used, and the remedy: a package reinstall, since the
 * CLI loads the package's own copy, which `devflow init` does not restore.
 */
export function formatLearningStoreUnavailable(error: EvidencePolicyLoadError): string {
  switch (error.kind) {
    case 'not-found': return 'learning store not found — reinstall devflow-kit';
    case 'unusable': return 'learning store failed to load — reinstall devflow-kit';
    default: {
      const exhaustive: never = error;
      return exhaustive;
    }
  }
}
