import { promises as fs } from 'fs';
import * as path from 'path';

/**
 * @file proxy-log.ts
 *
 * SEC-2: Proxy log hardening and child-env scoping helpers.
 *
 * Exports:
 *   - scrubChildEnv     — literal allowlist env for relay/doctor children (SEC-2)
 *   - openProxyLog      — 0700-parent + 0600-file open with best-effort chmod (SEC-2)
 *   - rotateProxyLogIfLarge — pre-spawn-only 2MB→1MB rotation that preserves 0600 mode
 *
 * avoids PF-009: every failure path is non-fatal (wrapped in try/catch); one bad
 *   chmod or rotation error must never abort the enable flow.
 */

/** 2 MB max log size before rotation (mirrors ensure-proxy _LOG_MAX_BYTES). */
export const PROXY_LOG_MAX_BYTES = 2_097_152;

/** 1 MB tail to retain after rotation (mirrors ensure-proxy _LOG_TAIL_BYTES). */
export const PROXY_LOG_TAIL_BYTES = 1_048_576;

/**
 * Build a scrubbed child process environment for relay/doctor subprocesses.
 *
 * Returns a literal allowlist copied from process.env:
 *   posix: PATH, HOME, TMPDIR, LANG, LC_ALL
 *   win32: additionally SystemRoot, APPDATA, USERPROFILE, ComSpec
 *
 * Variables absent from process.env are omitted rather than set to undefined.
 * Call sites compose on top of this result to add process-specific vars
 * (e.g. SUBSWITCH_CONFIG for the relay spawn and doctor spawn).
 *
 * applies ADR-003: the prior denylist rationale is gone — the routing runtime
 * reads exactly three env vars (ANTHROPIC_API_KEY, FORCE_COLOR, SUBSWITCH_CONFIG).
 * Verified by whole-dist grep of the 0.2.0 package. An allowlist is the correct
 * shape: 61 inherited vars → 5.
 *
 * HOME is retained: the runtime's loadConfig resolves ~ paths via homedir().
 */
export function scrubChildEnv(): NodeJS.ProcessEnv {
  const POSIX_ALLOWLIST = ['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL'] as const;
  const WIN32_ALLOWLIST = ['SystemRoot', 'APPDATA', 'USERPROFILE', 'ComSpec'] as const;

  const keys: string[] =
    process.platform === 'win32'
      ? [...POSIX_ALLOWLIST, ...WIN32_ALLOWLIST]
      : [...POSIX_ALLOWLIST];

  const env: NodeJS.ProcessEnv = {};
  for (const key of keys) {
    const val = process.env[key];
    if (val !== undefined) {
      env[key] = val;
    }
  }
  return env;
}

/**
 * Open proxy.log for appending, ensuring the parent directory and the file
 * itself are created with restricted permissions:
 *
 *   1. mkdir parent with { recursive: true, mode: 0o700 } — new directories
 *      land at 0700; already-existing directories are unaffected by mkdir.
 *   2. fs.open(logPath, 'a', 0o600) — mode 0600 applies on creation only;
 *      a pre-existing file retains its current mode at this step.
 *   3. best-effort fs.chmod(logPath, 0o600) — widens a pre-existing file
 *      that was created before this guard existed (e.g. mode 0644 on disk).
 *      Non-fatal: a chmod failure (EPERM, ENOENT race) must never prevent the
 *      handle from being returned — avoids PF-009 failure-isolation principle.
 *      Follows the SEC-1 precedent in src/core/fs-atomic.ts (commit 5755d56):
 *      chmod in try/catch, never fatal, with a comment citing the rationale.
 *
 * @param logPath - Absolute path to proxy.log.
 * @returns A FileHandle open in append mode (0600 or best-effort).
 */
export async function openProxyLog(
  logPath: string,
): Promise<Awaited<ReturnType<typeof fs.open>>> {
  // Step 1: ensure parent directory exists at 0700.
  // mode: 0o700 applies to newly created directories only; pre-existing
  // directories at 0755 are not narrowed — chmod the dir if needed separately.
  await fs.mkdir(path.dirname(logPath), { recursive: true, mode: 0o700 });

  // Step 2: open (or create) file for appending.
  // 0o600 mode applies on creation only — does not change a pre-existing mode.
  const handle = await fs.open(logPath, 'a', 0o600);

  // Step 3: best-effort chmod for a pre-existing file that has a wider mode.
  // Non-fatal: chmod failure must not prevent the handle from being returned.
  // avoids PF-009: failure-isolation — one bad chmod must never abort the enable flow.
  try {
    await fs.chmod(logPath, 0o600);
  } catch {
    // EPERM, ENOENT race, or unsupported platform — use the mode already on disk.
    // The open() in step 2 already succeeded; the file is usable regardless.
  }

  return handle;
}

/**
 * Rotate proxy.log in-place when it exceeds PROXY_LOG_MAX_BYTES.
 *
 * Writes the last PROXY_LOG_TAIL_BYTES to a sibling .tmp.$PID file under
 * mode 0o600 (written directly, not via chmod-after-rename), then atomically
 * replaces the original with a rename. The rename replaces the inode, so the
 * replacement carries the tmp file's 0o600 mode — this is the stronger
 * guarantee (no race window between rename and chmod).
 *
 * This mirrors the ensure-proxy shell hook which creates the rotation tmp
 * under `umask 077` for the same reason.
 *
 * SAFETY INVARIANT — MUST BE CALLED PRE-SPAWN ONLY:
 *   rename() replaces the inode at the log path. If the detached relay process
 *   already holds an append fd on the old inode, all subsequent relay output
 *   goes to an unlinked inode (orphaned fd). This function is therefore called
 *   ONLY from the runEnable path BEFORE spawnRelayAndWaitForPort — at that
 *   point no relay process exists and no fd is open on proxy.log.
 *   Never call this function from realSpawnDoctor or any post-spawn context.
 *
 * Non-fatal: rotation failure (disk full, EPERM, read error) leaves the
 * original log untouched and the enable proceeds with an oversized log.
 * avoids PF-009: one rotation error must never abort the enable flow.
 *
 * @param logPath - Absolute path to proxy.log.
 */
export async function rotateProxyLogIfLarge(logPath: string): Promise<void> {
  let stat: Awaited<ReturnType<typeof fs.stat>>;
  try {
    stat = await fs.stat(logPath);
  } catch {
    // File does not exist yet — nothing to rotate.
    return;
  }

  if (stat.size <= PROXY_LOG_MAX_BYTES) return;

  const tmpPath = `${logPath}.tmp.${process.pid}`;
  try {
    // Read the tail portion (last PROXY_LOG_TAIL_BYTES).
    const srcHandle = await fs.open(logPath, 'r');
    let tail: Buffer;
    try {
      const offset = Math.max(0, stat.size - PROXY_LOG_TAIL_BYTES);
      const readLen = stat.size - offset;
      const buf = Buffer.allocUnsafe(readLen);
      const { bytesRead } = await srcHandle.read(buf, 0, readLen, offset);
      tail = buf.subarray(0, bytesRead);
    } finally {
      await srcHandle.close();
    }

    // Write tail to tmp with mode 0o600 at open time — the post-rename inode
    // carries this mode without needing a subsequent chmod (no race window).
    await fs.writeFile(tmpPath, tail, { mode: 0o600 });

    // Atomic replace — readers and writers see old-or-new, never absent.
    await fs.rename(tmpPath, logPath);
  } catch {
    // Rotation failed (ENOSPC, EPERM, read error, etc.) — clean up tmp and
    // continue. The original log is untouched; an oversized log is preferable
    // to a broken enable.
    try { await fs.unlink(tmpPath); } catch { /* already gone or never written */ }
  }
}
