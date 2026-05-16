import { promises as fs } from 'fs';
import * as path from 'path';

/**
 * Manage a runtime-disable sentinel file.
 *
 * When `enabled` is true the sentinel is removed (no-op if absent).
 * When `enabled` is false the sentinel is created (parent directory created if needed).
 *
 * Removal is best-effort (swallows ENOENT). Creation propagates real I/O errors.
 *
 * @param sentinelPath  Absolute path to the sentinel file.
 * @param enabled   Whether the feature is being enabled (true) or disabled (false).
 */
export async function manageSentinel(
  sentinelPath: string,
  enabled: boolean,
): Promise<void> {
  if (enabled) {
    try { await fs.unlink(sentinelPath); } catch { /* sentinel didn't exist — that's fine */ }
  } else {
    await fs.mkdir(path.dirname(sentinelPath), { recursive: true });
    await fs.writeFile(sentinelPath, '', 'utf-8');
  }
}
