import { readFile, writeFile } from 'fs/promises';

/**
 * Strip the Devflow-written `devflow` entry from `extraKnownMarketplaces` in a
 * freshly parsed copy of the settings JSON. Returns the serialised JSON string
 * (with trailing newline).
 *
 * Pure string→string — matches the pipeline pattern used by
 * stripDevflowTeammateModeFromJson (teammate-mode-cleanup.ts) for testability.
 *
 * Rules:
 * - Remove the `devflow` key from `extraKnownMarketplaces` when present.
 * - If `extraKnownMarketplaces` becomes empty after removal, remove the entire
 *   `extraKnownMarketplaces` key (clean end-state per ADR-003).
 * - Other marketplace entries are preserved as-is.
 * - Malformed JSON, missing keys, and non-object roots are returned unchanged
 *   (avoids PF-004: a TypeError here would escape and cause the migration to
 *   record a failure, retrying on every devflow init).
 */
export function stripDevflowMarketplaceFromJson(settingsJson: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(settingsJson);
  } catch {
    return settingsJson; // Malformed JSON — leave untouched
  }

  // Tolerant: only object roots can carry the key; null/arrays/primitives are no-ops.
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return settingsJson;
  }

  const settings = parsed as Record<string, unknown>;
  const marketplaces = settings['extraKnownMarketplaces'];

  // Key absent or wrong type — no-op
  if (typeof marketplaces !== 'object' || marketplaces === null || Array.isArray(marketplaces)) {
    return settingsJson;
  }

  const mktMap = marketplaces as Record<string, unknown>;
  if (!Object.prototype.hasOwnProperty.call(mktMap, 'devflow')) {
    return settingsJson; // devflow key absent — no-op
  }

  delete mktMap['devflow'];

  // ADR-003: clean end-state — if no other entries remain, remove the parent key entirely
  if (Object.keys(mktMap).length === 0) {
    delete settings['extraKnownMarketplaces'];
  }

  return JSON.stringify(settings, null, 2) + '\n';
}

/**
 * Strip the Devflow-written `devflow` entry from `extraKnownMarketplaces` in a
 * settings JSON file.
 *
 * Delegates parse/strip logic to `stripDevflowMarketplaceFromJson` and only
 * writes back when the content changes, so no-ops (missing key, no devflow
 * entry, malformed JSON) never touch disk.
 *
 * Write errors propagate — callers (migrations) must not swallow them, so a
 * failed cleanup stays unapplied and the migration retries on next init
 * (avoids PF-004: swallowed failure makes a migration falsely "applied").
 * Read errors (ENOENT / unreadable) are silently ignored — no file means
 * nothing to clean up.
 */
export async function stripDevflowMarketplace(settingsPath: string): Promise<void> {
  let raw: string;
  try {
    raw = await readFile(settingsPath, 'utf-8');
  } catch {
    return; // ENOENT or unreadable — no-op
  }

  const stripped = stripDevflowMarketplaceFromJson(raw);
  if (stripped === raw) return; // malformed JSON, missing key, or no devflow entry — no change

  // Let write errors propagate so a failed cleanup stays unapplied and retries (avoids PF-004).
  await writeFile(settingsPath, stripped, 'utf-8');
}
