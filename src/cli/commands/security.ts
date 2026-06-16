import { Command } from 'commander';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as p from '@clack/prompts';
import color from 'picocolors';
import { getClaudeDirectory, getDevFlowDirectory, getManagedSettingsPath } from '../utils/paths.js';
import { readManifest, syncManifestFeature } from '../utils/manifest.js';
import {
  mergeDenyList,
  stripUserDenyList,
  detectDenyState,
  DEVFLOW_HISTORICAL_DENY,
  removeManagedSettings,
  installManagedSettings,
} from '../utils/post-install.js';
import { writeFileAtomicExclusive } from '../utils/fs-atomic.js';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface SecurityOptions {
  status?: boolean;
  enable?: boolean;
  managed?: boolean;
  user?: boolean;
  disable?: boolean;
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/**
 * Load current template deny entries from the bundled managed-settings.json.
 * Returns empty array on error (caller reports).
 */
export async function loadTemplateDenyEntries(rootDir: string): Promise<string[]> {
  try {
    const tmpl = JSON.parse(
      await fs.readFile(path.join(rootDir, 'src', 'templates', 'managed-settings.json'), 'utf-8'),
    ) as Record<string, unknown>;
    const rawDeny = (tmpl.permissions as Record<string, unknown> | undefined)?.deny;
    return Array.isArray(rawDeny) ? rawDeny as string[] : [];
  } catch {
    return [];
  }
}

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
    const rootDir = path.resolve(__dirname, '../..');

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

    // Default (no flag) → show status
    if (!options.enable && !options.disable && !options.status) {
      options.status = true;
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
        process.exit(1);
      }

      if (targetMode === 'managed') {
        // Add to managed first, verify, then strip from user
        const managed = await installManagedSettings(rootDir, true);
        if (!managed) {
          p.log.error('Managed settings write failed — re-run without --managed to use user settings');
          process.exit(1);
        }
        p.log.success('Security deny list written to managed settings');

        // Strip from user settings (self-heal)
        try {
          const existing = await fs.readFile(userSettingsPath, 'utf-8');
          const { json: stripped, removed } = stripUserDenyList(existing, DEVFLOW_HISTORICAL_DENY);
          if (stripped !== existing) {
            await writeFileAtomicExclusive(userSettingsPath, stripped);
            p.log.info(`Removed ${removed.length} entries from user settings (now in managed)`);
          }
        } catch { /* user settings may not exist */ }

      } else {
        // User mode: merge into ~/.claude/settings.json
        let existing: string;
        try {
          existing = await fs.readFile(userSettingsPath, 'utf-8');
        } catch {
          existing = '{}';
        }
        const merged = mergeDenyList(existing, templateDeny);
        await writeFileAtomicExclusive(userSettingsPath, merged);
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

      // Managed settings: remove if present (ENOENT-tolerant)
      if (managedExists) {
        await removeManagedSettings(rootDir, true);
      } else {
        p.log.info('No managed settings to remove');
      }

      await syncManifestFeature(devflowDir, 'security', 'none');

      return;
    }
  });
