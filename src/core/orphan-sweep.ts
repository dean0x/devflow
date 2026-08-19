import { promises as fs } from 'fs';
import * as path from 'path';

/**
 * @file orphan-sweep.ts
 *
 * Shared helper for registry-diff sweeps of installed asset directories.
 * Used by both the install pipeline (installer.ts) and the uninstall pipeline
 * (uninstall.ts) so the logic lives in exactly one place.
 *
 * Also exports the mdFileName / mdEntryName inverse pair for .md asset naming,
 * mirroring the prefixSkillName / unprefixSkillName pair in plugins.ts.
 */

// ---------------------------------------------------------------------------
// .md filename helpers — inverse pair
// ---------------------------------------------------------------------------

/**
 * Convert a registry name to its .md filename.
 * Inverse of {@link mdEntryName}.
 *
 * @example mdFileName('code') === 'code.md'
 */
export function mdFileName(name: string): string {
  return `${name}.md`;
}

/**
 * Extract the registry name from a .md directory entry.
 * Returns null for entries that are not .md files — suitable as a
 * pass-through predicate for {@link sweepOrphanedAssets}.
 * Inverse of {@link mdFileName}.
 *
 * @example mdEntryName('code.md') === 'code'
 * @example mdEntryName('SKILL.md') === 'SKILL'
 * @example mdEntryName('code.ts') === null
 */
export function mdEntryName(entry: string): string | null {
  return entry.endsWith('.md') ? entry.slice(0, -3) : null;
}

// ---------------------------------------------------------------------------
// SweepResult — return type for sweepOrphanedAssets
// ---------------------------------------------------------------------------

export interface SweepResult {
  /** Count of entries the predicate accepted (scanned), regardless of outcome. */
  scanned: number;
  /** Registry names of entries successfully removed during this sweep. */
  removed: string[];
  /**
   * Per-item removal failures recorded but not thrown (avoids PF-009).
   * An entry appears here only when fs.rm rejected; successful removals are in {@link removed}.
   */
  failed: ReadonlyArray<{ name: string; error: unknown }>;
}

// ---------------------------------------------------------------------------
// sweepOrphanedAssets
// ---------------------------------------------------------------------------

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
 *   For agents and commands: use {@link mdEntryName}.
 *   For skills: strip the devflow: prefix.
 *
 * @returns A {@link SweepResult} reporting how many entries were scanned, which
 *   registry names were removed, and which removals failed.
 *   `scanned` is the count matched by the predicate (not the removed count) —
 *   use for non-vacuousness assertions in tests: a value of 0 means no entry
 *   matched the predicate.
 *
 * Per-item failure isolation: both the outer readdir and the inner rm are
 * independently try/caught — a missing directory is a no-op and a failed
 * individual removal is recorded in `failed` without aborting the sweep (avoids PF-009).
 * Never writes, only removes (avoids PF-011).
 */
export async function sweepOrphanedAssets(
  dir: string,
  knownNames: ReadonlySet<string>,
  extractRegistryName: (entry: string) => string | null,
): Promise<SweepResult> {
  const removed: string[] = [];
  const failed: Array<{ name: string; error: unknown }> = [];
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
          removed.push(registryName);
        } catch (err) {
          failed.push({ name: registryName, error: err }); /* per-item isolation (avoids PF-009) */
        }
      }
    }
  } catch { /* directory absent or unreadable — not an error (avoids PF-009) */ }
  return { scanned, removed, failed };
}
