/**
 * tests/helpers/managed-settings.ts
 *
 * D-TESTS-NO-SYSTEM-MANAGED: a test never lets a CLI spawn modify the real
 * platform managed-settings file. `getManagedSettingsPath()` is an absolute
 * system path (`/Library/Application Support/ClaudeCode/managed-settings.json`,
 * `/etc/claude-code/managed-settings.json`) with no seam a sandboxed HOME can
 * redirect, and `init --security none` / `security --disable` rewrite or unlink
 * that file directly, before any TTY or sudo step. A spawn that reaches that
 * removal runs only under `it.skipIf(systemManagedSettingsAtRisk())`, where the
 * direct attempt can only fail EACCES; every other test installs with
 * `--security user`, which writes the sandboxed user settings alone.
 * `tests/guards/no-system-managed-spawn.test.ts` holds every test file to it.
 */

import { accessSync, constants as fsConstants } from 'fs';
import * as path from 'path';
import { getManagedSettingsPath } from '../../src/targets/claude-code/claude-paths.js';

/**
 * True when this process could modify the managed-settings file: the file or
 * its directory is writable (the directory covers the unlink and a file
 * appearing later). A missing path is not writable, and an unsupported platform
 * — where `resolvePath` throws — has no managed file for the CLI to touch.
 */
export function managedSettingsWritable(resolvePath: () => string = getManagedSettingsPath): boolean {
  let managedPath: string;
  try {
    managedPath = resolvePath();
  } catch {
    return false;
  }
  return [managedPath, path.dirname(managedPath)].some((target) => {
    try {
      accessSync(target, fsConstants.W_OK);
      return true;
    } catch {
      return false;
    }
  });
}

/**
 * True when a spawn reaching the managed-settings removal could change the real
 * file: the process runs as root, or the file or its directory is writable.
 */
export function systemManagedSettingsAtRisk(
  uid: number | undefined = process.getuid?.(),
  writable: () => boolean = managedSettingsWritable,
): boolean {
  return uid === 0 || writable();
}
