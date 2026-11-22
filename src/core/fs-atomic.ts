import { promises as fs } from 'fs';

/**
 * @file fs-atomic.ts
 *
 * D34: Canonical atomic-write helper for the TypeScript CLI surface.
 *
 * Call sites: used by the CLI's exclusive-write call sites (migrations, init, post-install,
 * uninstall, security, ambient, memory, HUD).
 * The CJS counterpart (`writeExclusive` in `src/assets/scripts/hooks/lib/curation-store.cjs`)
 * intentionally remains a separate implementation — same semantics, different module
 * system. Any change to the retry logic here MUST be mirrored there.
 */

/** The sibling `filePath` is written to before the rename: `<file>.tmp.<pid>`. */
export function atomicTempPath(filePath: string): string {
  return `${filePath}.tmp.${process.pid}`;
}

/**
 * Atomically write `filePath` by writing to a sibling `.tmp` then renaming.
 *
 * Uses `{ flag: 'wx' }` (O_EXCL | O_WRONLY) so the kernel rejects the open if
 * a file — or a symlink an attacker placed there between our decision to write
 * and the actual open() call (TOCTOU) — already exists at the `.tmp` path.
 *
 * On EEXIST (stale `.tmp` from a prior crash, or adversarially-placed file) we
 * unlink and retry once. The unlink is wrapped in its own try/catch so that a
 * concurrent writer that already removed the stale file between our EEXIST
 * check and our unlink does not cause an unexpected throw — this matches the
 * race-tolerant pattern in the CJS `writeExclusive` implementations.
 *
 * The final `fs.rename` is a single POSIX atomic operation — readers either see
 * the old content or the new content, never a partial write.
 *
 * @param filePath - Absolute path to the target file.
 * @param data - UTF-8 encoded content to write.
 * @param mode - A number sets the temp file's initial mode, subject to umask.
 *   An existing target's mode wins unless `{ exactMode }` sets the mode before rename.
 */
export async function writeFileAtomicExclusive(
  filePath: string,
  data: string,
  mode?: number | { readonly exactMode: number },
): Promise<void> {
  const createMode = typeof mode === 'object' ? mode.exactMode : mode;
  // PID-scope the tmp name so concurrent writers from different processes
  // (e.g., two Claude Code sessions) never collide on the same .tmp path.
  // mirrors proxy-log.ts rotation at src/core/proxy-log.ts which PID-scopes
  // for the same reason.
  const tmp = atomicTempPath(filePath);
  const options = { encoding: 'utf-8', flag: 'wx', ...(createMode === undefined ? {} : { mode: createMode }) } as const;
  try {
    await fs.writeFile(tmp, data, options);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    // Stale or adversarially-placed .tmp — unlink and retry once.
    // Race-tolerant: if a concurrent writer already removed the file,
    // the unlinkSync in the CJS counterpart silently ignores ENOENT here too.
    try { await fs.unlink(tmp); } catch { /* race — already removed */ }
    await fs.writeFile(tmp, data, options);
  }

  try {
    if (typeof mode === 'object') {
      // Set the required mode before the new file becomes visible at filePath.
      await fs.chmod(tmp, mode.exactMode);
    } else {
      // Preserve any restrictions the user put on the target file.
      try {
        const prior = await fs.stat(filePath);
        await fs.chmod(tmp, prior.mode & 0o777);
      } catch {
        // Keep the temp file's initial mode if mode preservation fails.
      }
    }
    await fs.rename(tmp, filePath);
  } catch (err) {
    try { await fs.unlink(tmp); } catch { /* Preserve the original error. */ }
    throw err;
  }
}

/**
 * Write a Claude Code settings file (`settings.json`) atomically.
 *
 * D-SETTINGS-ATOMIC: every write of a Claude settings file goes through this one
 * helper, so no command can leave a half-written file for Claude Code — or a
 * concurrent devflow command — to read: the bytes land in a sibling temp file
 * and one rename swaps them in ({@link writeFileAtomicExclusive}).
 *
 * A settings file that is a symbolic link (a dotfiles-managed `settings.json`)
 * stays one: the temp file and the rename target the link's resolved file, so
 * the link keeps pointing where the user pointed it. A dangling link has no file
 * to resolve and is replaced like a missing file.
 */
export async function writeSettingsFileAtomic(filePath: string, data: string): Promise<void> {
  await writeFileAtomicExclusive(await resolveLinkedFile(filePath), data);
}

/** `filePath`, or the file it resolves to when it is a symbolic link that resolves. */
async function resolveLinkedFile(filePath: string): Promise<string> {
  try {
    if (!(await fs.lstat(filePath)).isSymbolicLink()) return filePath;
    return await fs.realpath(filePath);
  } catch {
    return filePath;
  }
}
