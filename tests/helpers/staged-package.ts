/**
 * tests/helpers/staged-package.ts
 *
 * A copy of the shipped package under a temp directory, for a test that needs a package
 * root other than the repository: the directories `package.json` `files[]` ships (dist/,
 * src/assets/, the Claude Code templates, the lint-pack template), the manifest, and a
 * link to the repository's node_modules. With `withVariantManifest: false` the copy
 * carries no dist/variant-axes.json, which is what a package built by `build:cli` alone
 * looks like.
 *
 * The copy is made of real files. Node resolves a module's location by its real path, so
 * a linked dist/ would report the repository as its package root and the test would read
 * the real build. Nothing here writes into the repository.
 */

import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ROOT } from '../helpers.js';

/** The directories of the package that an installed copy carries, relative to the package root. */
const SHIPPED_DIRS: readonly string[] = [
  'dist',
  'src/assets',
  'src/targets/claude-code/templates',
  'templates/lint-pack',
];

const VARIANT_MANIFEST_FILE = path.join(ROOT, 'dist', 'variant-axes.json');

export interface StagedPackage {
  /** The temp package root: package.json, the shipped directories and node_modules. */
  readonly root: string;
  remove(): Promise<void>;
}

export async function stagePackage(opts: { withVariantManifest: boolean }): Promise<StagedPackage> {
  // The copy is only a fair stand-in when the repository build it copies is whole.
  const built = await fs.stat(VARIANT_MANIFEST_FILE).then(stat => stat.isFile(), () => false);
  if (!built) {
    throw new Error(`${VARIANT_MANIFEST_FILE} is absent — run \`npm run build\` first, so the staged package has a complete build to copy`);
  }

  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-staged-pkg-')));
  const remove = (): Promise<void> => fs.rm(root, { recursive: true, force: true });
  try {
    await fs.copyFile(path.join(ROOT, 'package.json'), path.join(root, 'package.json'));
    for (const rel of SHIPPED_DIRS) {
      await fs.cp(path.join(ROOT, rel), path.join(root, rel), {
        recursive: true,
        filter: source => opts.withVariantManifest || path.resolve(source) !== VARIANT_MANIFEST_FILE,
      });
    }
    await fs.symlink(path.join(ROOT, 'node_modules'), path.join(root, 'node_modules'), 'dir');

    const copied = await fs.stat(path.join(root, 'dist', 'variant-axes.json')).then(() => true, () => false);
    if (copied !== opts.withVariantManifest) {
      throw new Error(`the staged package ${copied ? 'carries' : 'lacks'} dist/variant-axes.json, against the request`);
    }
  } catch (err) {
    await remove();
    throw err;
  }
  return { root, remove };
}
