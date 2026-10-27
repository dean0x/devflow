/**
 * The install record of the prompt variants (#648, AC-29 and AC-31).
 *
 * After a converge that finished clean, the manifest records which variant of each axis the
 * installed prompts hold: `installedVariants: { curation, compliance }`. The record is the only
 * way to tell what is installed without reading every prompt, and it answers one question the
 * switches alone cannot: does this machine still carry posting steps from before the switch moved?
 *
 * The manifest reader carries the field raw, so a hand-edited or newer-version value reaches this
 * module unchecked. {@link readInstalledVariants} is the one parse: anything but two booleans is
 * unknown, and an absent field is unknown. Nothing heals an unknown record. Pure, with no I/O.
 */

import type { VariantAxis } from './curation-variants.js';

/** The variant of each axis the installed prompts hold: true is the on variant. */
export type InstalledVariants = Readonly<Record<VariantAxis, boolean>>;

/** The record as the manifest carries it, or null when it is absent or is not two booleans (unknown). */
export function readInstalledVariants(raw: unknown): InstalledVariants | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const { curation, compliance } = raw as Record<string, unknown>;
  if (typeof curation !== 'boolean' || typeof compliance !== 'boolean') return null;
  return { curation, compliance };
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
  if (installed === null) return 'unknown (run devflow init)';
  if (installed.compliance !== complianceEnabled) return 'mismatch (run devflow init)';
  return complianceEnabled ? 'installed' : 'not installed';
}

/** What `devflow init` prints, once, when the installed prompts move from posting steps to none. */
export const POSTING_OFF_NOTICE =
  'Compliance is off on this machine, so devflow installed no step that posts test-plan evidence, ' +
  'review or resolution summaries, backlog entries, review-thread replies, wave reports, plan artifacts ' +
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
