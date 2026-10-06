/**
 * @file observations.ts
 *
 * The ledger entry statuses on the TypeScript side. Pure data: no I/O and no
 * imports, so the HUD can load it without growing its import closure.
 */

/**
 * D201: a ledger entry's `decisions_status` takes one of DECISIONS_ENTRY_STATUSES.
 * `Accepted` (decisions) and `Active` (pitfalls) are active and render; the
 * INACTIVE_DECISIONS_STATUSES stay in the ledger and leave the rendered files and
 * the HUD counts; an absent or unknown status counts as active. These lists
 * mirror ACTIVE_STATUSES / INACTIVE_STATUSES in
 * src/assets/scripts/hooks/lib/learning-store.cjs, which the hooks and the
 * renderer use, and the parity test in tests/decisions/learning-store.test.ts
 * pins the two equal. Reason: the renderer, the HUD and this module each kept a
 * list of their own, so a status added to one counted as active in the others.
 */
export const INACTIVE_DECISIONS_STATUSES = ['Encoded', 'Superseded', 'Retired', 'Deprecated'] as const;

export const DECISIONS_ENTRY_STATUSES = ['Accepted', 'Active', ...INACTIVE_DECISIONS_STATUSES] as const;

const INACTIVE_DECISIONS_STATUS_SET: ReadonlySet<string> = new Set(INACTIVE_DECISIONS_STATUSES);

/** True unless `status` is one of INACTIVE_DECISIONS_STATUSES (D201). */
export function isActiveDecisionsStatus(status?: string): boolean {
  return !status || !INACTIVE_DECISIONS_STATUS_SET.has(status);
}
