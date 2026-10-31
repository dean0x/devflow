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
 * per-item failures are reported rather than thrown.
 *
 * What is genuinely new is the KEY. `sweepOrphanedAssets` keys a flat directory by
 * registry name through `mdEntryName`, which cannot express `tracker/{provider}/{op}.md`:
 * two providers may legitimately both carry a `comment.md`, so the registry name has to
 * be the relative PATH, and the walk has to descend.
 *
 * Never writes. The sweep names what stays and what goes; a {@link ReferenceSweepDelegate}
 * acts on every entry the manifest does not name, and the sweep itself never removes a
 * folder recursively. No delete-then-write window.
 */

/**
 * Descent bound for every walk over the generated reference tree — this sweep and the
 * build's own prune, which imports it (`pruneOrphans` in scripts/build-mds.ts). One
 * tree, one bound: two walkers each carrying their own literal is how they come to
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
 * (an install is not abandoned over one subtree). Neither returns
 * quietly: a subtree the walk never entered must not be summarised as converged.
 */
export const MAX_REFERENCE_SWEEP_DEPTH = 8;

/**
 * What became of one entry the manifest does not name.
 *
 *   - `removed`: the entry is gone and was devflow's own (a retired or superseded reference).
 *     The sweep reports it by its relative path.
 *   - `moved`: the entry was the user's and was moved aside. It is not a removal, so the sweep
 *     does not report it; the delegate's owner records the move.
 *   - `kept`: the entry stays, and the delegate's owner has recorded why.
 *   - `failed`: the delegate could not act and has nowhere else to record it. The sweep reports
 *     it in `failed`.
 */
export type ReferenceDisposition =
  | { readonly outcome: 'removed' }
  | { readonly outcome: 'moved' }
  | { readonly outcome: 'kept' }
  | { readonly outcome: 'failed'; readonly error: unknown };

/**
 * Who decides what happens to an entry the manifest does not name. The sweep calls it once per
 * such entry and removes none itself, so a file the user put in the tree is the delegate's to
 * keep, move or remove. `entry` is the absolute path; `isDirectory` is true only for a real
 * folder (a link is not one).
 */
export interface ReferenceSweepDelegate {
  dispose(entry: string, isDirectory: boolean): Promise<ReferenceDisposition>;
}

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
 * @param delegate - Acts on every entry the manifest does not name. Required: a sweep with
 *   no delegate would have to delete what it cannot name.
 *
 * @returns A {@link SweepResult} whose `removed` entries are POSIX relative paths. A
 *   directory into which no manifest path descends is handed to the delegate WHOLE and
 *   reported by its own relative path once the delegate removed it — leaving it empty
 *   would be a convergence that stops one step short, and an empty provider directory is
 *   indistinguishable from a provider whose references failed to install. A subtree left
 *   unswept because it breached
 *   {@link MAX_REFERENCE_SWEEP_DEPTH} is reported in `failed` under its own relative
 *   path, for the same reason: everything this sweep did not converge is named.
 *
 * A missing or unreadable `root` is a no-op, not an error: the overlay creates the tree
 * it converges, so an absent one simply means there is nothing to prune yet.
 */
export async function sweepOrphanedReferences(
  root: string,
  knownRelPaths: ReadonlySet<string>,
  delegate: ReferenceSweepDelegate,
): Promise<SweepResult> {
  const acc: SweepAccumulator = { scanned: 0, removed: [], failed: [] };
  await sweepDirectory(root, '', 0, knownRelPaths, directoryPrefixes(knownRelPaths), delegate, acc);
  return { scanned: acc.scanned, removed: acc.removed, failed: acc.failed };
}

async function sweepDirectory(
  dir: string,
  prefix: string,
  depth: number,
  known: ReadonlySet<string>,
  knownDirPrefixes: ReadonlySet<string>,
  delegate: ReferenceSweepDelegate,
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
    return; /* absent or unreadable — not an error */
  }

  for (const entry of entries) {
    const relPath = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    const fullPath = path.join(dir, entry.name);

    // A real subdirectory is either an ancestor of something the manifest names — in
    // which case descend — or dead weight, in which case the delegate takes the whole
    // subtree. isDirectory() is false for a symlink-to-dir, so a planted link is treated
    // as a leaf and handed over rather than followed.
    if (entry.isDirectory()) {
      if (knownDirPrefixes.has(`${relPath}/`)) {
        await sweepDirectory(fullPath, relPath, depth + 1, known, knownDirPrefixes, delegate, acc);
        continue;
      }
      acc.scanned++;
      await dispose(fullPath, relPath, true, delegate, acc);
      continue;
    }

    acc.scanned++;
    if (known.has(relPath)) continue;
    await dispose(fullPath, relPath, false, delegate, acc);
  }
}

/** Hand one entry to the delegate and record the outcome; a throw from the delegate is a per-item failure. */
async function dispose(
  fullPath: string,
  relPath: string,
  isDirectory: boolean,
  delegate: ReferenceSweepDelegate,
  acc: SweepAccumulator,
): Promise<void> {
  try {
    const disposition = await delegate.dispose(fullPath, isDirectory);
    switch (disposition.outcome) {
      case 'removed':
        acc.removed.push(relPath);
        break;
      case 'failed':
        acc.failed.push({ name: relPath, error: disposition.error });
        break;
      case 'moved':
      case 'kept':
        break;
      default: {
        const _exhaustive: never = disposition;
        void _exhaustive;
      }
    }
  } catch (err) {
    acc.failed.push({ name: relPath, error: err }); /* per-item isolation */
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
