import { promises as fs } from 'fs';

/**
 * @file fs-atomic.ts
 *
 * D34: Canonical atomic-write helper for the TypeScript CLI surface.
 *
 * All three TS call sites (learn.ts, legacy-knowledge-purge.ts, migrations.ts)
 * previously inlined their own copies of this logic. This module is the single
 * source of truth for the TS side; the CJS counterpart (`writeExclusive` in
 * `scripts/hooks/json-helper.cjs` and `scripts/hooks/decisions-usage-scan.cjs`)
 * intentionally remains a separate implementation — same semantics, different
 * module system. Any change to the retry logic here MUST be mirrored in both
 * CJS files.
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
  const tmp = `${filePath}.tmp`;
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
  await fs.rename(tmp, filePath);
}
