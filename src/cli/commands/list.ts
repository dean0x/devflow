import { Command } from 'commander';
import * as p from '@clack/prompts';
import color from 'picocolors';
import { DEVFLOW_PLUGINS, type PluginDefinition } from '../plugins.js';
import { getDevFlowDirectory } from '../utils/paths.js';
import { getGitRoot } from '../utils/git.js';
import { readManifest, type ManifestData } from '../utils/manifest.js';
import * as path from 'path';

/**
 * Format manifest feature flags into a human-readable comma-separated string.
 * Returns 'none' when no features are enabled.
 */
export function formatFeatures(features: ManifestData['features']): string {
  return [
    features.teams ? 'teams' : null,
    features.ambient ? 'ambient' : null,
    features.memory ? 'memory' : null,
  ].filter(Boolean).join(', ') || 'none';
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
  .description('List available DevFlow plugins')
  .action(async () => {
    p.intro(color.bgCyan(color.black(' DevFlow Plugins ')));

    // Resolve user manifest and git root in parallel (independent I/O)
    const userDevflowDir = getDevFlowDirectory();
    const [gitRoot, userManifest] = await Promise.all([
      getGitRoot(),
      readManifest(userDevflowDir),
    ]);
    const localDevflowDir = gitRoot ? path.join(gitRoot, '.devflow') : null;
    const localManifest = localDevflowDir ? await readManifest(localDevflowDir) : null;
    const manifest = localManifest ?? userManifest;

    // Show install status if manifest exists
    if (manifest) {
      const installedAt = new Date(manifest.installedAt).toLocaleDateString();
      const updatedAt = new Date(manifest.updatedAt).toLocaleDateString();
      const scope = resolveScope(localManifest);
      const features = formatFeatures(manifest.features);

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
