import { readFileSync, writeFileSync } from 'fs';

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
 * Only removes the key when its value is exactly `"auto"` — values set by the
 * user (`"tmux"`, `"in-process"`, etc.) are preserved as-is.
 *
 * Tolerant: missing file, missing key, and malformed JSON are all silently
 * ignored (no-op). Non-ENOENT file read errors are also swallowed so this
 * helper is safe to call in non-fatal migration contexts.
 */
export function stripDevflowTeammateMode(settingsPath: string): void {
  let raw: string;
  try {
    raw = readFileSync(settingsPath, 'utf-8');
  } catch {
    return; // ENOENT or unreadable — no-op
  }

  let settings: Record<string, unknown>;
  try {
    settings = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return; // Malformed JSON — leave untouched
  }

  if (settings['teammateMode'] !== 'auto') {
    return; // Not Devflow-written value — preserve
  }

  delete settings['teammateMode'];

  try {
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
  } catch {
    // Write failed — swallow; non-fatal (migration will retry on next init)
  }
}
