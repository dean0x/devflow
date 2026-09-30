import { promises as fs } from 'fs';
import * as path from 'path';

/**
 * Whether two paths name one location — realpaths where they exist, so a symlinked
 * HOME, or macOS's /var → /private/var temp tree, still matches. The shell hooks make
 * the same physical comparison in git-marker's df_is_project_root (D-HOOKS-GIT-ONLY).
 */
export async function isSameLocation(a: string, b: string): Promise<boolean> {
  const canonical = (target: string): Promise<string> =>
    fs.realpath(target).catch(() => path.resolve(target));
  const [left, right] = await Promise.all([canonical(a), canonical(b)]);
  return left === right;
}

/**
 * D-INIT-NOT-HOME: the CLI half of D-HOOKS-GIT-ONLY. A git repository rooted at
 * HOME (a dotfiles repo) is not a project: its `<root>/.devflow` is the machine
 * root ~/.devflow, and its `.gitignore` and `.claudeignore` are the user's own
 * home-directory files. So no command writes per-repository files there — the
 * same rule the hooks' df_is_project_root applies — and `roots` is returned
 * without any entry that is HOME.
 */
export async function withoutHomeRoots(roots: readonly string[], homeDir: string): Promise<string[]> {
  const verdicts = await Promise.all(roots.map(root => isSameLocation(root, homeDir)));
  return roots.filter((_, i) => !verdicts[i]);
}
