import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join, relative, isAbsolute, resolve } from 'path';

/**
 * Returns true when `candidate`, resolved relative to `parent`, is strictly
 * contained within `parent` — i.e., it is not the parent itself, does not
 * escape via `..` traversal, and is not an absolute path that lands outside.
 *
 * Pure function — no filesystem access.
 *
 * Used by reapplyAgentMapping to guard against path-traversal mapping keys.
 *
 * @example isContainedIn('/a', 'b')       === true
 * @example isContainedIn('/a', '../b')    === false
 * @example isContainedIn('/a', '/b')      === false
 * @example isContainedIn('/a', '')        === false
 * @example isContainedIn('/a', '.')       === false  (same as parent)
 */
export function isContainedIn(parent: string, candidate: string): boolean {
  if (candidate === '') return false;
  const resolvedParent = resolve(parent);
  const resolvedCandidate = resolve(resolvedParent, candidate);
  const rel = relative(resolvedParent, resolvedCandidate);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

/**
 * D-paths: single package-root resolver used by everything that previously did
 * scattered path.resolve(__dirname, '../..') lookups.
 *
 * From compiled dist/core/paths.js, root is 2 levels up from __dirname.
 * From source src/core/paths.ts under vitest/tsx, root is also 2 levels up.
 *
 * Throws loudly if package.json is not found at the resolved root — dist-depth
 * bugs become loud errors, never silent wrong-path lookups.
 */
export function getPackageRoot(): string {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const root = resolve(__dirname, '../..');
  if (!existsSync(join(root, 'package.json'))) {
    throw new Error(
      `getPackageRoot: package.json not found at resolved root "${root}". ` +
      `This indicates a depth mismatch in the compiled output ` +
      `(expected dist/core/paths.js to be 2 levels below repo root).`,
    );
  }
  return root;
}
