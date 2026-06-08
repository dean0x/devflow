import { promises as fs, readFileSync, writeFileSync } from 'fs';

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

/**
 * Async variant of stripDevflowTeammateMode — same semantics, used in async
 * contexts (uninstall command).
 */
export async function stripDevflowTeammateModeAsync(settingsPath: string): Promise<void> {
  let raw: string;
  try {
    raw = await fs.readFile(settingsPath, 'utf-8');
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
    await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
  } catch {
    // Write failed — swallow; non-fatal
  }
}
