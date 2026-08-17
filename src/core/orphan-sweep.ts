import { promises as fs } from 'fs';
import * as path from 'path';

/**
 * @file orphan-sweep.ts
 *
 * Shared helper for registry-diff sweeps of installed asset directories.
 * Used by both the install pipeline (installer.ts) and the uninstall pipeline
 * (uninstall.ts) so the logic lives in exactly one place.
 */

/**
 * Remove entries from `dir` that are not present in the `knownNames` registry.
 *
 * Only removes entries that `extractRegistryName` accepts (returns non-null for);
 * entries the predicate skips (returns null) are left completely untouched.
 *
 * @param dir - The install directory to sweep.
 * @param knownNames - Full registry set spanning ALL plugins. Must cover the
 *   complete installed universe — NOT intersected with any selected-plugin subset.
 *   Assets from uninstalled plugins must survive a partial sweep.
 * @param extractRegistryName - Maps a directory entry name to a registry key
 *   (the name to look up in knownNames), or null to skip this entry entirely.
 *   For agents and commands: strip the .md extension.
 *   For skills: strip the devflow: prefix.
 *
 * @returns The count of entries matched by the predicate (not the removed count).
 *   Use for non-vacuousness assertions in tests: a return of 0 means no entry
 *   matched the predicate and the sweep was a no-op regardless of the registry.
 *
 * Per-item failure isolation: both the outer readdir and the inner rm are
 * independently try/caught — a missing directory is a no-op and a failed
 * individual removal does not abort the sweep (avoids PF-009).
 * Never writes, only removes (avoids PF-011).
 */
export async function sweepOrphanedAssets(
  dir: string,
  knownNames: ReadonlySet<string>,
  extractRegistryName: (entry: string) => string | null,
): Promise<number> {
  let scanned = 0;
  try {
    const entries = await fs.readdir(dir);
    for (const entry of entries) {
      const registryName = extractRegistryName(entry);
      if (registryName === null) continue;
      scanned++;
      if (!knownNames.has(registryName)) {
        try {
          await fs.rm(path.join(dir, entry), { recursive: true, force: true });
        } catch { /* ignore per-item removal errors (avoids PF-009) */ }
      }
    }
  } catch { /* directory absent or unreadable — not an error (avoids PF-009) */ }
  return scanned;
}
