/**
 * The install record of the prompt variants (#648, AC-29 and AC-31).
 *
 * After a converge that finished clean, the manifest records which variant of each axis the
 * installed prompts hold: `installedVariants`, one boolean per axis. The record is the only
 * way to tell what is installed without reading every prompt, and it answers one question the
 * switches alone cannot: does this machine still carry posting steps from before the switch moved?
 *
 * The manifest reader carries the field raw, so a hand-edited or newer-version value reaches this
 * module unchecked. {@link readInstalledVariants} is the one parse: a value that is not a boolean
 * on an axis is unknown, and an absent field is unknown. A record written before the tdd axis
 * existed has no `tdd`; it reads as on, because the installed prompts of that time carried the
 * tdd text. Nothing heals an unknown record. Pure, with no I/O.
 */

import { ORIGINAL_AXES, VARIANT_AXES, perAxis, type VariantAxis } from './curation-variants.js';

/** The variant of each axis the installed prompts hold: true is the on variant. */
export type InstalledVariants = Readonly<Record<VariantAxis, boolean>>;

/**
 * The record as the manifest carries it, or null when it is absent or an axis is not a boolean (unknown).
 * An axis added after the first record (not in ORIGINAL_AXES) may be absent, and then it is on.
 */
export function readInstalledVariants(raw: unknown): InstalledVariants | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const read: Partial<Record<VariantAxis, boolean>> = {};
  for (const axis of VARIANT_AXES) {
    const value = record[axis];
    if (typeof value === 'boolean') read[axis] = value;
    else if (value === undefined && !ORIGINAL_AXES.includes(axis)) read[axis] = true;
    else return null;
  }
  return perAxis(axis => read[axis] === true);
}

/**
 * The record to write for a converge, or null when none is owed (AC-29). Only a converge that
 * finished clean records the switches the prompts were converged onto. Any other converge writes
 * nothing, so the field is left out and reads as unknown: it names `devflow init`, and the posting
 * notice stays due. Pure; the result is a fresh object.
 */
export function installRecordFor(converged: boolean, switches: InstalledVariants): InstalledVariants | null {
  return converged ? perAxis(axis => switches[axis]) : null;
}

/**
 * What the record says about one axis, read against the machine's switch for it: `on` and `off`
 * are the two settled states (the record agrees with the switch), `mismatch` is a record that
 * disagrees, and `unknown` is a record that is absent or unreadable.
 */
export type VariantRecordStatus = 'on' | 'off' | 'mismatch' | 'unknown';

export function variantRecordStatus(
  installed: InstalledVariants | null,
  axis: VariantAxis,
  enabled: boolean,
): VariantRecordStatus {
  if (installed === null) return 'unknown';
  if (installed[axis] !== enabled) return 'mismatch';
  return enabled ? 'on' : 'off';
}

/** What `devflow compliance --status` prints after `Posting:`. */
export type PostingStatus =
  | 'installed'
  | 'not installed'
  | 'mismatch (run devflow init)'
  | 'unknown (run devflow init)';

/**
 * Whether the posting steps are installed, from the record and the machine's compliance switch.
 *
 * `installed` and `not installed` are the two settled states: the record agrees with the switch, and
 * the on variant carries the posting steps while the off variant carries none. A record that
 * disagrees with the switch is `mismatch`, and a record that is absent or unreadable is `unknown`;
 * both name the remedy.
 */
export function postingStatus(installed: InstalledVariants | null, complianceEnabled: boolean): PostingStatus {
  const status = variantRecordStatus(installed, 'compliance', complianceEnabled);
  switch (status) {
    case 'on':
      return 'installed';
    case 'off':
      return 'not installed';
    case 'mismatch':
      return 'mismatch (run devflow init)';
    case 'unknown':
      return 'unknown (run devflow init)';
    default: {
      const unhandled: never = status;
      return unhandled;
    }
  }
}

/** What `devflow init` prints, once, when the installed prompts move from posting steps to none. */
export const POSTING_OFF_NOTICE =
  'Compliance is off on this machine, so devflow installed no step that posts test-plan evidence, ' +
  'review or resolution summaries, backlog entries, review-thread replies, plan artifacts ' +
  'or release back-links to GitHub or a tracker. Results stay in local files under .devflow/docs/. ' +
  'To install these steps, run `devflow compliance --enable`.';

/**
 * Whether init owes the posting notice: compliance is off and the record does not already say the
 * installed prompts carry no posting step. A record that is absent or unreadable is unknown, and
 * unknown counts as posting, so a machine from before the record existed hears the notice once.
 * The caller also requires a clean converge and a written record, so the notice and the record
 * move together and the next init finds the record and stays quiet.
 */
export function postingNoticeDue(installed: InstalledVariants | null, complianceEnabled: boolean): boolean {
  if (complianceEnabled) return false;
  return installed === null || installed.compliance;
}
