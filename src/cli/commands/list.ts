import { Command } from 'commander';
import * as p from '@clack/prompts';
import color from 'picocolors';
import { DEVFLOW_PLUGINS, type PluginDefinition } from '../plugins.js';
import { getDevFlowDirectory, getManagedSettingsPath } from '../utils/paths.js';
import { getGitRoot } from '../utils/git.js';
import { readManifest, type ManifestData } from '../utils/manifest.js';
import { getSafeDeleteStatus } from './safe-delete.js';
import * as path from 'path';
import { promises as fs } from 'fs';

/**
 * Tri-state status for features that have live detection beyond the manifest boolean.
 */
export type TriState = 'on' | 'off' | 'unknown';

/**
 * Resolve security tri-state from the manifest security field.
 * 'user' or 'managed' → 'on'; 'none' → 'off'; absent/undefined → 'unknown'.
 */
export function resolveSecurityTriState(security: ManifestData['features']['security']): TriState {
  if (security === 'user' || security === 'managed') return 'on';
  if (security === 'none') return 'off';
  return 'unknown';
}

/**
 * Format manifest feature flags into a human-readable comma-separated string.
 * Returns 'none' when no features are enabled.
 *
 * @param extra - Optional tri-state values for security and safe-delete.
 *   Tri-state entries are only appended when provided (not undefined).
 */
export function formatFeatures(
  features: ManifestData['features'],
  extra?: { security?: TriState; safeDelete?: TriState },
): string {
  const triLabel = (label: string, state: TriState): string => {
    switch (state) {
      case 'on': return label;
      case 'off': return `${label}: off`;
      case 'unknown': return `${label}: unknown`;
      default: {
        const _exhaustive: never = state;
        return `${label}: ${_exhaustive}`;
      }
    }
  };

  const parts = [
    features.ambient ? 'ambient' : null,
    features.memory ? 'memory' : null,
    features.knowledge ? 'knowledge' : null,
    features.decisions ? 'decisions' : null,
    features.hud ? 'hud' : null,
    features.rules ? 'rules' : null,
    features.flags?.length ? `flags: ${features.flags.length}` : null,
    extra?.security !== undefined ? triLabel('security', extra.security) : null,
    extra?.safeDelete !== undefined ? triLabel('safe-delete', extra.safeDelete) : null,
  ].filter(Boolean);
  return parts.join(', ') || 'none';
}

/**
 * Determine effective installation scope based on which manifest was found.
 * Local scope takes precedence when a local manifest exists.
 */
export function resolveScope(localManifest: ManifestData | null): 'user' | 'local' {
  return localManifest ? 'local' : 'user';
}

/**
 * Compute the install status indicator for a plugin.
 * Returns 'installed', 'not_installed', or 'unknown' (when no manifest exists).
 */
export function getPluginInstallStatus(
  pluginName: string,
  installedPlugins: ReadonlySet<string>,
  hasManifest: boolean,
): 'installed' | 'not_installed' | 'unknown' {
  if (!hasManifest) return 'unknown';
  return installedPlugins.has(pluginName) ? 'installed' : 'not_installed';
}

/**
 * Format the commands portion of a plugin entry.
 * Returns the comma-separated command list or '(skills only)' for skill-only plugins.
 */
export function formatPluginCommands(commands: string[]): string {
  return commands.length > 0 ? commands.join(', ') : '(skills only)';
}

export const listCommand = new Command('list')
  .description('List available Devflow plugins')
  .action(async () => {
    p.intro(color.bgCyan(color.black(' Devflow Plugins ')));

    // Resolve user manifest, git root, and tri-state status in parallel (independent I/O)
    const userDevflowDir = getDevFlowDirectory();
    const [gitRoot, userManifest, safeDeleteResult] = await Promise.all([
      getGitRoot(),
      readManifest(userDevflowDir),
      // getSafeDeleteStatus reads only profile file — no subprocess
      getSafeDeleteStatus().catch(() => ({ status: 'unknown' as const, profilePath: null })),
    ]);
    const localDevflowDir = gitRoot ? path.join(gitRoot, '.devflow') : null;
    const localManifest = localDevflowDir ? await readManifest(localDevflowDir) : null;
    const manifest = localManifest ?? userManifest;

    // Resolve security tri-state — wrap fs.access in try/catch (throws on unsupported platforms)
    let securityTriState: TriState = 'unknown';
    if (manifest) {
      securityTriState = resolveSecurityTriState(manifest.features.security);
      // If manifest says unknown, probe managed settings path as live fallback
      if (securityTriState === 'unknown') {
        try {
          await fs.access(getManagedSettingsPath());
          securityTriState = 'on';
        } catch {
          // managed settings absent or platform threw — leave as 'unknown'
        }
      }
    }

    // safe-delete tri-state from profile detection (no subprocess)
    const safeDeleteTriState: TriState = safeDeleteResult.status === 'installed'
      ? 'on'
      : safeDeleteResult.status === 'absent' || safeDeleteResult.status === 'outdated'
        ? 'off'
        : 'unknown';

    // Show install status if manifest exists
    if (manifest) {
      const installedAt = new Date(manifest.installedAt).toLocaleDateString();
      const updatedAt = new Date(manifest.updatedAt).toLocaleDateString();
      const scope = resolveScope(localManifest);
      const features = formatFeatures(manifest.features, {
        security: securityTriState,
        safeDelete: safeDeleteTriState,
      });

      p.note(
        `${color.dim('Version:')}  ${color.cyan(`v${manifest.version}`)}\n` +
        `${color.dim('Scope:')}    ${scope}\n` +
        `${color.dim('Features:')} ${features}\n` +
        `${color.dim('Installed:')} ${installedAt}` +
        (installedAt !== updatedAt ? `  ${color.dim('Updated:')} ${updatedAt}` : ''),
        'Installation',
      );
    }

    const installedPlugins = new Set(manifest?.plugins ?? []);
    const hasManifest = manifest !== null;
    const maxNameLen = Math.max(...DEVFLOW_PLUGINS.map(p => p.name.length));
    const pluginList = DEVFLOW_PLUGINS
      .map(plugin => {
        const cmds = formatPluginCommands(plugin.commands);
        const optionalTag = plugin.optional ? color.dim(' (optional)') : '';
        const status = getPluginInstallStatus(plugin.name, installedPlugins, hasManifest);
        const installedTag = status === 'installed' ? color.green(' ✓')
          : status === 'not_installed' ? color.dim(' ✗')
          : '';
        return `${color.cyan(plugin.name.padEnd(maxNameLen + 2))}${color.dim(plugin.description)}${optionalTag}${installedTag}\n${' '.repeat(maxNameLen + 2)}${color.yellow(cmds)}`;
      })
      .join('\n\n');

    p.note(pluginList, 'Available plugins');

    if (!manifest) {
      p.log.info(color.dim('Run `devflow init` for install tracking'));
    }

    p.outro(color.dim('Install with: npx devflow-kit init --plugin=<name>'));
  });
