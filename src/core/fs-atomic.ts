import { promises as fs } from 'fs';

/**
 * @file fs-atomic.ts
 *
 * D34: Canonical atomic-write helper for the TypeScript CLI surface.
 *
 * Call sites: used by the CLI's exclusive-write call sites (migrations, init, post-install,
 * uninstall, security, ambient, memory, HUD, observation I/O).
 * The CJS counterpart (`writeExclusive` in `src/assets/scripts/hooks/json-helper.cjs` and
 * `src/assets/scripts/hooks/decisions-usage-scan.cjs`) intentionally remains a separate
 * implementation — same semantics, different module system. Any change to the
 * retry logic here MUST be mirrored in both CJS files.
 */

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
 */
export async function writeFileAtomicExclusive(filePath: string, data: string): Promise<void> {
  // PID-scope the tmp name so concurrent writers from different processes
  // (e.g., two Claude Code sessions) never collide on the same .tmp path.
  // mirrors proxy-log.ts rotation at src/core/proxy-log.ts which PID-scopes
  // for the same reason.  avoids PF-011.
  const tmp = `${filePath}.tmp.${process.pid}`;
  try {
    await fs.writeFile(tmp, data, { encoding: 'utf-8', flag: 'wx' });
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    // Stale or adversarially-placed .tmp — unlink and retry once.
    // Race-tolerant: if a concurrent writer already removed the file,
    // the unlinkSync in the CJS counterpart silently ignores ENOENT here too.
    try { await fs.unlink(tmp); } catch { /* race — already removed */ }
    await fs.writeFile(tmp, data, { encoding: 'utf-8', flag: 'wx' });
  }

  // Preserve the target's permission mode across the atomic replace.
  // A user who hardened the target (e.g. settings.json → 0600 to protect
  // ANTHROPIC_API_KEY) must not have it silently widened to umask default
  // (~0644) on every proxy enable/disable or post-install rewrite.
  //
  // Non-fatal path: if stat fails (ENOENT → fresh file, or any other I/O
  // error), skip chmod and keep the umask default — the write must still
  // complete correctly (avoids PF-009 failure-isolation principle).
  try {
    const { mode } = await fs.stat(filePath);
    // mode includes file-type bits; mask to permission bits only for chmod.
    await fs.chmod(tmp, mode & 0o777);
  } catch {
    // Fresh write (ENOENT) or stat/chmod failure — use umask default.
    // Intentionally non-fatal: mode preservation is best-effort; the write
    // itself must never be corrupted by a chmod error.
  }

  await fs.rename(tmp, filePath);
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
