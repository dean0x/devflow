import { Command } from 'commander';
import * as path from 'path';
import * as p from '@clack/prompts';
import color from 'picocolors';
import { getClaudeDirectory, getDevFlowDirectory, getManagedSettingsPath } from '../../targets/claude-code/claude-paths.js';
import { readManifest, syncManifestFeature } from '../../core/manifest.js';
import {
  applyUserSecurityDenyList,
  stripUserDenyList,
  detectDenyState,
  DEVFLOW_HISTORICAL_DENY,
  removeManagedSettings,
  installManagedSettings,
  loadTemplateDenyEntries,
  stripUserSecurityDenyList,
} from '../../targets/claude-code/post-install.js';
import { writeFileAtomicExclusive } from '../../core/fs-atomic.js';
import { promises as fs } from 'fs';
import { getPackageRoot } from '../../core/paths.js';

interface SecurityOptions {
  status?: boolean;
  enable?: boolean;
  managed?: boolean;
  user?: boolean;
  disable?: boolean;
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/**
 * Count deny entries in a parsed settings JSON string.
 * Returns 0 on parse error or when no deny array is present.
 */
export function countDenyEntries(settingsJson: string): number {
  try {
    const obj = JSON.parse(settingsJson) as Record<string, unknown>;
    const rawDeny = (obj.permissions as Record<string, unknown> | undefined)?.deny;
    return Array.isArray(rawDeny) ? rawDeny.length : 0;
  } catch {
    return 0;
  }
}

// ─── Command ──────────────────────────────────────────────────────────────────

/**
 * What removing the Devflow deny list from managed settings did. Carries the
 * path it acted on so every caller can name the file in its message.
 */
export type ManagedDenyRemoval =
  | { kind: 'removed'; path: string }
  /** No managed file, or a platform with no managed settings location. */
  | { kind: 'absent' }
  /** The file exists but is unparseable or holds no Devflow entry — left alone. */
  | { kind: 'no-devflow-entries'; path: string }
  /** The file holds Devflow entries and the write/delete was refused (e.g. EACCES
   *  outside a TTY, or the user declined sudo). Never thrown. */
  | { kind: 'failed'; path: string };

/**
 * Remove the Devflow deny list from the managed settings file — the ONE
 * implementation `devflow security --disable` and `devflow init --security none`
 * share, so "none" means none in every location (#378).
 *
 * Gated on detectDenyState's parse-safe signal rather than on the file merely
 * existing: removeManagedSettings parses the file without a guard, so a corrupt
 * managed file must be classified here and never reach it (SF5). Never throws —
 * a permission failure is the `failed` outcome, reported by the caller.
 *
 * `managedPath` is the injectable seam for tests (see removeManagedSettings);
 * production callers omit it and get the platform path.
 */
export async function removeManagedDenyList(
  rootDir: string,
  verbose: boolean,
  managedPath?: string,
): Promise<ManagedDenyRemoval> {
  let target: string;
  if (managedPath !== undefined) {
    target = managedPath;
  } else {
    try {
      target = getManagedSettingsPath();
    } catch {
      return { kind: 'absent' };
    }
  }

  let content: string;
  try {
    content = await fs.readFile(target, 'utf-8');
  } catch {
    return { kind: 'absent' };
  }

  if (!detectDenyState(null, true, content).managed) {
    return { kind: 'no-devflow-entries', path: target };
  }
  const removed = await removeManagedSettings(rootDir, verbose, target);
  return removed ? { kind: 'removed', path: target } : { kind: 'failed', path: target };
}

/**
 * The user-facing line for a ManagedDenyRemoval. Pure.
 *
 * D-MANAGED-REMOVAL-REMEDY: both `devflow security --disable` and
 * `devflow init --security none` print this line, so the `failed` remedy names
 * no command — pointing at `devflow security --disable` sent a user of that very
 * command back to it. A `failed` removal means the write needed admin rights and
 * the sudo fallback could not run (no interactive terminal) or was declined, so
 * the remedy is exactly that: re-run interactively and accept the prompt, or
 * edit the named file as an administrator.
 */
export function describeManagedDenyRemoval(
  outcome: ManagedDenyRemoval,
): { level: 'info' | 'warn'; text: string } {
  switch (outcome.kind) {
    case 'removed':
      return { level: 'info', text: `Security deny list removed from managed settings (${outcome.path})` };
    case 'absent':
      return { level: 'info', text: 'No managed settings to remove' };
    case 'no-devflow-entries':
      return { level: 'warn', text: 'Managed settings file exists but contains no Devflow deny entries — skipping' };
    case 'failed':
      return {
        level: 'warn',
        text:
          `Could not remove the Devflow deny list from managed settings (${outcome.path}) — ` +
          'it needs admin rights, and sudo was declined or unavailable. Re-run this command in an ' +
          'interactive terminal and accept the sudo prompt, or, as an administrator, remove the Devflow ' +
          `entries from permissions.deny in ${outcome.path}.`,
      };
  }
}

export const securityCommand = new Command('security')
  .description('Manage the security deny list (permissions.deny in Claude Code settings)')
  .option('--status', 'Show current deny list state and entry counts')
  .option('--enable', 'Install the deny list (use --managed or --user to select location)')
  .option('--managed', 'Target system-level managed settings (requires sudo on some platforms)')
  .option('--user', 'Target ~/.claude/settings.json (default)')
  .option('--disable', 'Remove the deny list from all locations')
  .addHelpText('after', '\nExamples:\n  $ devflow security --status\n  $ devflow security --enable\n  $ devflow security --enable --managed\n  $ devflow security --disable')
  .action(async (options: SecurityOptions) => {
    const claudeDir = getClaudeDirectory();
    const devflowDir = getDevFlowDirectory();
    const userSettingsPath = path.join(claudeDir, 'settings.json');
    const rootDir = getPackageRoot();

    // ── Load current state ──────────────────────────────────────────────────
    let userSettingsJson: string | null = null;
    try { userSettingsJson = await fs.readFile(userSettingsPath, 'utf-8'); } catch { /* absent */ }

    let managedPath: string | null = null;
    let managedExists = false;
    let managedContentJson: string | null = null;
    try {
      managedPath = getManagedSettingsPath();
      managedContentJson = await fs.readFile(managedPath, 'utf-8');
      managedExists = true;
    } catch { /* absent or unsupported platform */ }

    const detected = detectDenyState(userSettingsJson, managedExists, managedContentJson);

    // Default (no flag) → show Usage note (mirrors memory.ts:242-253 incumbent pattern)
    if (!options.enable && !options.disable && !options.status) {
      p.note(
        `${color.cyan('devflow security --status')}           Show current deny list state\n` +
        `${color.cyan('devflow security --enable')}           Install deny list (user settings)\n` +
        `${color.cyan('devflow security --enable --managed')} Install deny list (managed settings)\n` +
        `${color.cyan('devflow security --disable')}          Remove the deny list from all locations`,
        'Usage',
      );
      return;
    }

    // ── --status ────────────────────────────────────────────────────────────
    if (options.status) {
      const both = detected.user && detected.managed;

      if (!detected.user && !detected.managed) {
        p.log.info('Security deny list: ' + color.dim('none (not installed)'));
      } else {
        if (detected.user) {
          const count = userSettingsJson ? countDenyEntries(userSettingsJson) : 0;
          p.log.info(`Security deny list: ${color.green('installed')} in user settings (${count} entries)`);
          p.log.info(`  Location: ${color.dim(userSettingsPath)}`);
        }
        if (detected.managed && managedPath) {
          const count = managedContentJson ? countDenyEntries(managedContentJson) : 0;
          p.log.info(`Security deny list: ${color.green('installed')} in managed settings (${count} entries)`);
          p.log.info(`  Location: ${color.dim(managedPath)}`);
        }
        if (both) {
          p.log.warn('Deny list found in BOTH locations. Run --disable and --enable to consolidate.');
        }
      }

      if (detected.unknown) {
        p.log.warn('User settings.json is present but unparseable — cannot determine entry count');
      }

      // Show manifest mode if available
      const manifest = await readManifest(devflowDir);
      if (manifest?.features.security) {
        p.log.info(`Manifest mode: ${color.dim(manifest.features.security)}`);
      }

      return;
    }

    // ── --enable ────────────────────────────────────────────────────────────
    if (options.enable) {
      const useManaged = options.managed === true;
      const targetMode = useManaged ? 'managed' : 'user';

      const templateDeny = await loadTemplateDenyEntries(rootDir);
      if (templateDeny.length === 0) {
        p.log.error('Could not load deny list template — no entries to install');
        return;
      }

      if (targetMode === 'managed') {
        // Add to managed first, verify, then strip from user
        const managed = await installManagedSettings(rootDir, true);
        if (!managed) {
          p.log.error('Managed settings write failed — re-run without --managed to use user settings');
          return;
        }
        p.log.success('Security deny list written to managed settings');

        // Strip from user settings (self-heal) — adopts canonical stripUserSecurityDenyList (SF9)
        const stripResult = await stripUserSecurityDenyList(userSettingsPath);
        if (stripResult && stripResult.removed.length > 0) {
          p.log.info(`Removed ${stripResult.removed.length} entries from user settings (now in managed)`);
        }

      } else {
        // User mode: merge into ~/.claude/settings.json, converging retired entries
        const merged = await applyUserSecurityDenyList(userSettingsPath, templateDeny);
        const count = countDenyEntries(merged);
        p.log.success(`Security deny list applied to user settings (${count} entries)`);
        p.log.info(`  Location: ${color.dim(userSettingsPath)}`);
      }

      await syncManifestFeature(devflowDir, 'security', targetMode);

      return;
    }

    // ── --disable ───────────────────────────────────────────────────────────
    if (options.disable) {
      // User settings: must be parseable to strip — hard fail if not
      if (userSettingsJson !== null) {
        try {
          JSON.parse(userSettingsJson);
        } catch {
          p.log.error(
            'settings.json is unparseable — cannot safely remove the deny list. ' +
            'Fix the JSON syntax manually and re-run.',
          );
          process.exit(1);
        }

        const { json: stripped, removed } = stripUserDenyList(userSettingsJson, DEVFLOW_HISTORICAL_DENY);
        if (removed.length > 0) {
          await writeFileAtomicExclusive(userSettingsPath, stripped);
          p.log.success(`Removed ${removed.length} entries from user settings:`);
          for (const entry of removed) {
            p.log.info(`  ${color.dim(entry)}`);
          }
        } else {
          p.log.info('No Devflow deny entries found in user settings');
        }
      }

      // Managed settings: the shared removal (parse-safe gate, never throws — SF5;
      // a throw here would skip the manifest sync below after user settings were
      // already stripped).
      const managedMsg = describeManagedDenyRemoval(await removeManagedDenyList(rootDir, false));
      if (managedMsg.level === 'warn') p.log.warn(managedMsg.text);
      else p.log.info(managedMsg.text);

      await syncManifestFeature(devflowDir, 'security', 'none');

      return;
    }
  });
