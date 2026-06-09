import { readFile, writeFile } from 'fs/promises';

/**
 * Strip `teammateMode: "auto"` from a parsed settings object in-place.
 * Returns the serialised JSON string (with trailing newline).
 *
 * Pure string→string — matches the pipeline pattern used by stripFlags /
 * stripViewMode so uninstall.ts can chain it without a separate parse/stringify.
 * Only removes the key when the value is exactly `"auto"`; user-set values
 * (`"tmux"`, `"in-process"`, etc.) are preserved as-is.
 *
 * Tolerant: malformed JSON is returned unchanged (no-op).
 */
export function stripDevflowTeammateModeFromJson(settingsJson: string): string {
  let settings: Record<string, unknown>;
  try {
    settings = JSON.parse(settingsJson) as Record<string, unknown>;
  } catch {
    return settingsJson; // Malformed JSON — leave untouched
  }
  if (settings['teammateMode'] !== 'auto') return settingsJson;
  delete settings['teammateMode'];
  return JSON.stringify(settings, null, 2) + '\n';
}

/**
 * Strip the Devflow-written `teammateMode: "auto"` from a settings JSON file.
 *
 * Delegates parse/strip logic to `stripDevflowTeammateModeFromJson` and only
 * writes back when the content changes, so no-ops (missing key, non-"auto"
 * value, malformed JSON) never touch disk.
 *
 * Write errors propagate — callers (migrations) must not swallow them, so a
 * failed cleanup stays unapplied and the migration retries on next init
 * (avoids PF-004: swallowed failure makes a migration falsely "applied").
 * Read errors (ENOENT / unreadable) are silently ignored — no file means
 * nothing to clean up.
 */
export async function stripDevflowTeammateMode(settingsPath: string): Promise<void> {
  let raw: string;
  try {
    raw = await readFile(settingsPath, 'utf-8');
  } catch {
    return; // ENOENT or unreadable — no-op
  }

  const stripped = stripDevflowTeammateModeFromJson(raw);
  if (stripped === raw) return; // malformed JSON, missing key, or non-"auto" — no change

  // Let write errors propagate so a failed cleanup stays unapplied and retries (avoids PF-004).
  await writeFile(settingsPath, stripped, 'utf-8');
}
