import { readFile, writeFile } from 'fs/promises';

/**
 * Strip `teammateMode: "auto"` from a freshly parsed copy of the settings JSON.
 * Returns the serialised JSON string (with trailing newline).
 *
 * Pure string→string — matches the pipeline pattern used by stripFlags /
 * stripViewMode so uninstall.ts can chain it without a separate parse/stringify.
 * Only removes the key when the value is exactly `"auto"`; user-set values
 * (`"tmux"`, `"in-process"`, etc.) are preserved as-is.
 *
 * Tolerant: malformed JSON is returned unchanged (no-op). Non-object roots
 * (null, arrays, primitives) are treated as a no-op — only object roots can
 * carry the key (avoids PF-004: a TypeError here would escape both functions
 * and cause the migration to record a failure, retrying on every devflow init).
 */
export function stripDevflowTeammateModeFromJson(settingsJson: string): string {
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
