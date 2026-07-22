import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';

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
