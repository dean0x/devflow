import { Command } from 'commander';
import * as p from '@clack/prompts';
import color from 'picocolors';
import {
  detectPlatform,
  detectShell,
  getProfilePath,
  getSafeDeleteInfo,
  hasSafeDelete,
} from '../utils/safe-delete.js';
import {
  generateSafeDeleteBlock,
  installToProfile,
  removeFromProfile,
  getInstalledVersion,
  SAFE_DELETE_BLOCK_VERSION,
} from '../utils/safe-delete-install.js';

/**
 * Tri-state status for the safe-delete block in the user's shell profile.
 *
 * - 'installed' — block present at the current SAFE_DELETE_BLOCK_VERSION
 * - 'outdated'  — block present but at an older version (upgrade available)
 * - 'absent'    — block not installed
 * - 'unknown'   — could not determine (unsupported platform or $SHELL unset)
 */
export type SafeDeleteStatus = 'installed' | 'outdated' | 'absent' | 'unknown';

/**
 * Determine the current safe-delete install status and resolved profile path.
 * Returns { status, profilePath } — profilePath may be null on unsupported platforms.
 *
 * Wrapped in try/catch so callers never crash regardless of environment.
 */
export async function getSafeDeleteStatus(): Promise<{ status: SafeDeleteStatus; profilePath: string | null }> {
  try {
    const shell = detectShell();
    const profilePath = getProfilePath(shell);

    if (shell === 'unknown' || profilePath === null) {
      return { status: 'unknown', profilePath: null };
    }

    const version = await getInstalledVersion(profilePath);
    if (version === 0) {
      return { status: 'absent', profilePath };
    }
    if (version < SAFE_DELETE_BLOCK_VERSION) {
      return { status: 'outdated', profilePath };
    }
    return { status: 'installed', profilePath };
  } catch {
    return { status: 'unknown', profilePath: null };
  }
}

interface SafeDeleteOptions {
  enable?: boolean;
  disable?: boolean;
  status?: boolean;
}

export const safeDeleteCommand = new Command('safe-delete')
  .description('Enable or disable the safe-delete shell function (routes rm → trash)')
  .option('--enable', 'Install safe-delete shell function')
  .option('--disable', 'Remove safe-delete shell function')
  .option('--status', 'Show current safe-delete state')
  .action(async (options: SafeDeleteOptions) => {
    const hasFlag = options.enable || options.disable || options.status;
    if (!hasFlag || options.status) {
      // --status (or no flag) → tri-state report
      const { status, profilePath } = await getSafeDeleteStatus();

      const statusLabel = status === 'installed'
        ? color.green('installed')
        : status === 'outdated'
          ? color.yellow('outdated (upgrade available)')
          : status === 'absent'
            ? color.dim('absent')
            : color.dim('unknown');

      p.log.info(`Safe-delete: ${statusLabel}`);
      if (profilePath) {
        p.log.info(`Profile: ${color.dim(profilePath)}`);
      } else {
        p.log.info(`Profile: ${color.dim('unknown (unsupported platform or $SHELL not set)')}`);
      }

      if (status === 'outdated') {
        p.log.info(color.dim('Run devflow safe-delete --enable to upgrade to the current version'));
      }

      if (!hasFlag) {
        // Default (no flag) — show usage hint
        p.log.info(color.dim('Usage: devflow safe-delete --enable | --disable | --status'));
      }
      return;
    }

    if (options.enable) {
      const platform = detectPlatform();
      const shell = detectShell();
      const profilePath = getProfilePath(shell);

      if (shell === 'unknown' || profilePath === null) {
        p.log.warn('Cannot determine shell profile path — $SHELL not set or platform not supported');
        p.log.info(color.dim('Set $SHELL and retry, or add the safe-delete function manually'));
        return;
      }

      // Check trash CLI availability (Windows always has Recycle Bin)
      if (platform !== 'windows' && !hasSafeDelete(platform)) {
        const info = getSafeDeleteInfo(platform);
        p.log.warn(`safe-delete requires a trash CLI — not found`);
        p.log.info(color.dim(`Install with: ${info.installHint ?? 'see your package manager'}`));
        p.log.info(color.dim('Then retry: devflow safe-delete --enable'));
        return;
      }

      const info = getSafeDeleteInfo(platform);
      const block = generateSafeDeleteBlock(shell, process.platform, info.command);
      if (!block) {
        p.log.warn(`Shell '${shell}' is not supported for safe-delete`);
        return;
      }

      // Upgrade-in-place if an outdated block exists; idempotent if already current
      const installedVersion = await getInstalledVersion(profilePath);
      if (installedVersion === SAFE_DELETE_BLOCK_VERSION) {
        p.log.info('Safe-delete already installed at the current version — no change');
        return;
      }

      if (installedVersion > 0) {
        // Outdated block — remove then reinstall (upgrade in place, no duplicate)
        await removeFromProfile(profilePath);
        await installToProfile(profilePath, block);
        p.log.success(`Safe-delete upgraded to v${SAFE_DELETE_BLOCK_VERSION} in ${color.dim(profilePath)}`);
      } else {
        // Not installed — append
        await installToProfile(profilePath, block);
        p.log.success(`Safe-delete installed in ${color.dim(profilePath)}`);
      }

      p.log.info(color.dim('Restart your shell or run: source ' + profilePath));
      return;
    }

    if (options.disable) {
      const shell = detectShell();
      const profilePath = getProfilePath(shell);

      if (shell === 'unknown' || profilePath === null) {
        p.log.warn('Cannot determine shell profile path — $SHELL not set or platform not supported');
        return;
      }

      const removed = await removeFromProfile(profilePath);
      if (removed) {
        p.log.success(`Safe-delete removed from ${color.dim(profilePath)}`);
      } else {
        p.log.info('Safe-delete is not installed — nothing to remove');
      }
      return;
    }
  });
