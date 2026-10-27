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
