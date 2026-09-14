import { promises as fs } from 'fs';
import * as path from 'path';

import type { SweepResult } from './orphan-sweep.js';

/**
 * @file reference-sweep.ts
 *
 * Path-keyed registry-diff sweep for the generated `devflow:git` reference tree.
 *
 * Sibling of {@link sweepOrphanedAssets} in orphan-sweep.ts and deliberately the same
 * {@link SweepResult} shape — `scanned` is the non-vacuity counter, removals and
 * per-item failures are reported rather than thrown (avoids PF-009).
 *
 * What is genuinely new is the KEY. `sweepOrphanedAssets` keys a flat directory by
 * registry name through `mdEntryName`, which cannot express `tracker/{provider}/{op}.md`:
 * two providers may legitimately both carry a `comment.md`, so the registry name has to
 * be the relative PATH, and the walk has to descend.
 *
 * Never writes, only removes (avoids PF-011).
 */

/**
 * Descent bound for the recursive walk.
 *
 * The installed reference tree is two levels deep (`tracker/{provider}/{op}.md`), so 8
 * is generous. It exists because an unbounded recursion over a directory this function
 * does not own would spin on a symlink loop rather than fail — every loop has an
 * explicit upper bound.
 */
export const MAX_REFERENCE_SWEEP_DEPTH = 8;

interface SweepAccumulator {
  scanned: number;
  removed: string[];
  failed: Array<{ name: string; error: unknown }>;
}

/**
 * Remove everything under `root` that the manifest does not name.
 *
 * @param root - Directory to converge (the installed `references/tracker/` tree).
 * @param knownRelPaths - POSIX paths relative to `root` that must survive. Derived from
 *   the build's own module registries by the caller — never hand-listed.
 *
 * @returns A {@link SweepResult} whose `removed` entries are POSIX relative paths. A
 *   directory into which no manifest path descends is removed WHOLE and reported by its
 *   own relative path — leaving it empty would be a convergence that stops one step
 *   short, and an empty provider directory is indistinguishable from a provider whose
 *   references failed to install.
 *
 * A missing or unreadable `root` is a no-op, not an error: the overlay creates the tree
 * it converges, so an absent one simply means there is nothing to prune yet.
 */
export async function sweepOrphanedReferences(
  root: string,
  knownRelPaths: ReadonlySet<string>,
): Promise<SweepResult> {
  const acc: SweepAccumulator = { scanned: 0, removed: [], failed: [] };
  await sweepDirectory(root, '', 0, knownRelPaths, acc);
  return { scanned: acc.scanned, removed: acc.removed, failed: acc.failed };
}

async function sweepDirectory(
  dir: string,
  prefix: string,
  depth: number,
  known: ReadonlySet<string>,
  acc: SweepAccumulator,
): Promise<void> {
  if (depth >= MAX_REFERENCE_SWEEP_DEPTH) return;

  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return; /* absent or unreadable — not an error (avoids PF-009) */
  }

  for (const entry of entries) {
    const relPath = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    const fullPath = path.join(dir, entry.name);

    // A real subdirectory is either an ancestor of something the manifest names — in
    // which case descend — or dead weight, in which case take the whole subtree.
    // isDirectory() is false for a symlink-to-dir, so a planted link is treated as a
    // leaf and removed rather than followed.
    if (entry.isDirectory()) {
      const descendant = `${relPath}/`;
      if (hasPathUnder(known, descendant)) {
        await sweepDirectory(fullPath, relPath, depth + 1, known, acc);
        continue;
      }
      acc.scanned++;
      try {
        await fs.rm(fullPath, { recursive: true, force: true });
        acc.removed.push(relPath);
      } catch (err) {
        acc.failed.push({ name: relPath, error: err }); /* per-item isolation (avoids PF-009) */
      }
      continue;
    }

    acc.scanned++;
    if (known.has(relPath)) continue;
    try {
      await fs.rm(fullPath, { force: true });
      acc.removed.push(relPath);
    } catch (err) {
      acc.failed.push({ name: relPath, error: err }); /* per-item isolation (avoids PF-009) */
    }
  }
}

/** True if some path in `known` sits under the `descendant` prefix (a directory's trailing-slash relPath). */
function hasPathUnder(known: ReadonlySet<string>, descendant: string): boolean {
  for (const p of known) {
    if (p.startsWith(descendant)) return true;
  }
  return false;
}
