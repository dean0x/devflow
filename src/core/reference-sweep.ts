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
 * Descent bound for every walk over the generated reference tree — this sweep and the
 * build's own prune, which imports it (`pruneOrphans` in scripts/build-mds.ts). One
 * tree, one bound: two walkers each carrying their own literal is how the two came to
 * disagree on both the number of levels and what happens at the last one.
 *
 * `depth` counts the walked root as 0 and the bound is the deepest directory a walk may
 * descend INTO, so `depth > MAX_REFERENCE_SWEEP_DEPTH` is the breach — the comparison
 * the build's walks already use. The installed tree is two levels deep
 * (`tracker/{provider}/{op}.md`), so 8 is generous. The bound exists because an
 * unbounded recursion over a directory neither walker owns would spin on a symlink loop
 * rather than fail — every loop has an explicit upper bound.
 *
 * The two walkers answer a breach differently by design, and both answer out loud: the
 * build throws (a generated tree that deep is a build bug, and dist/ is still the
 * build's own to fail), while this sweep records the unvisited subtree in `failed`
 * (avoids PF-009 — an install is not abandoned over one subtree). Neither returns
 * quietly: a subtree the walk never entered must not be summarised as converged.
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
 *   references failed to install. A subtree left unswept because it breached
 *   {@link MAX_REFERENCE_SWEEP_DEPTH} is reported in `failed` under its own relative
 *   path, for the same reason: everything this sweep did not converge is named.
 *
 * A missing or unreadable `root` is a no-op, not an error: the overlay creates the tree
 * it converges, so an absent one simply means there is nothing to prune yet.
 */
export async function sweepOrphanedReferences(
  root: string,
  knownRelPaths: ReadonlySet<string>,
): Promise<SweepResult> {
  const acc: SweepAccumulator = { scanned: 0, removed: [], failed: [] };
  await sweepDirectory(root, '', 0, knownRelPaths, directoryPrefixes(knownRelPaths), acc);
  return { scanned: acc.scanned, removed: acc.removed, failed: acc.failed };
}

async function sweepDirectory(
  dir: string,
  prefix: string,
  depth: number,
  known: ReadonlySet<string>,
  knownDirPrefixes: ReadonlySet<string>,
  acc: SweepAccumulator,
): Promise<void> {
  if (depth > MAX_REFERENCE_SWEEP_DEPTH) {
    // A breached bound means this subtree is never visited, so any orphan inside it
    // survives. Report it through the same channel as a failed removal: a silent return
    // would let the install summary claim convergence over ground never covered.
    acc.failed.push({
      name: prefix || dir,
      error: new Error(
        `${prefix || dir}: sweep descent exceeds the bound of ${MAX_REFERENCE_SWEEP_DEPTH} ` +
        `levels — this subtree was not swept and any orphans under it survive.`,
      ),
    });
    return;
  }

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
      if (knownDirPrefixes.has(`${relPath}/`)) {
        await sweepDirectory(fullPath, relPath, depth + 1, known, knownDirPrefixes, acc);
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

/**
 * Every directory prefix some manifest path sits under, trailing slash included:
 * `tracker/github/comment.md` contributes `tracker/` and `tracker/github/`.
 *
 * Built once per sweep so "does anything the manifest names live under this directory?"
 * costs one `has` per entry instead of a scan of the whole manifest per entry. The
 * answer is identical to that scan: `dir/` is a member exactly when some manifest path
 * starts with `dir/`.
 *
 * Both loops are bounded by their own input — the inner one walks separators from a
 * strictly increasing offset, so it terminates at the last one in the path.
 */
function directoryPrefixes(known: ReadonlySet<string>): ReadonlySet<string> {
  const prefixes = new Set<string>();
  for (const p of known) {
    for (let cut = p.indexOf('/'); cut !== -1; cut = p.indexOf('/', cut + 1)) {
      prefixes.add(p.slice(0, cut + 1));
    }
  }
  return prefixes;
}
