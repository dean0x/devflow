/**
 * @file linked-path.ts
 *
 * `firstSymbolicLink`, the check the CLI makes before it writes or deletes under a
 * project's `.devflow/`, or under its `.claude/` when uninstall removes a legacy
 * local install (D-CLI-NO-SYMLINK).
 */

import { promises as fs } from 'fs';

/**
 * The first of `paths` that is itself a symbolic link, or null when none is.
 *
 * D-CLI-NO-SYMLINK: the CLI writes or deletes under a project's `.devflow/` only
 * where neither `.devflow` nor the entry it acts on through it is a symbolic link:
 * `devflow init` stamps its carve-out marker, removes the legacy markers and
 * writes `.devflow/config.json` only then, `devflow learning --configure` writes
 * the project's `learning.json` only then, and the queue drains (`devflow learning
 * --clear|--disable`, `devflow memory --disable|--clear` and `devflow init
 * --no-learning|--no-memory`) delete nothing when `.devflow` or the queue's folder
 * is one. `devflow uninstall`, removing a legacy local install, deletes or rewrites
 * nothing under the project's `.devflow` or `.claude` where either, or anything
 * below it on the way to what it removes, is one (legacyLocalChangeGuard in
 * uninstall.ts). Reason: a repository can commit `.devflow`, or a folder or file in
 * it, as a link to any place on the machine, and a write or delete through one lands
 * wherever it points. The hooks hold the same rule (D-HOOKS-NO-SYMLINK, git-marker)
 * and so do the learning ops (D-NO-LINKED-TREE). Only paths below the project root
 * are passed here: the root and the folders above it are the user's choice.
 *
 * Each path is checked with lstat, so a link is seen rather than followed. Nothing at
 * a path, or a file where a folder was expected on the way to it, is no link; any
 * other lstat failure is thrown, so a caller that cannot check acts on nothing.
 */
export async function firstSymbolicLink(paths: readonly string[]): Promise<string | null> {
  for (const candidate of paths) {
    try {
      if ((await fs.lstat(candidate)).isSymbolicLink()) return candidate;
    } catch (error: unknown) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT' && code !== 'ENOTDIR') throw error;
    }
  }
  return null;
}
