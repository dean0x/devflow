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
 * carry the key (avoids PF-004: a TypeError here would escape the function
 * and surface as an unhandled error during uninstall).
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

