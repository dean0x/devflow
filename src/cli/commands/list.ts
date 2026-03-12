import { Command } from 'commander';
import * as p from '@clack/prompts';
import color from 'picocolors';
import { DEVFLOW_PLUGINS } from '../plugins.js';
import { getDevFlowDirectory } from '../utils/paths.js';
import { getGitRoot } from '../utils/git.js';
import { readManifest } from '../utils/manifest.js';
import * as path from 'path';

export const listCommand = new Command('list')
  .description('List available DevFlow plugins')
  .action(async () => {
    p.intro(color.bgCyan(color.black(' DevFlow Plugins ')));

    // Try to read manifest from user scope and local scope
    const userDevflowDir = getDevFlowDirectory();
    const gitRoot = await getGitRoot();
    const localDevflowDir = gitRoot ? path.join(gitRoot, '.devflow') : null;

    const userManifest = await readManifest(userDevflowDir);
    const localManifest = localDevflowDir ? await readManifest(localDevflowDir) : null;
    const manifest = localManifest ?? userManifest;

    // Show install status if manifest exists
    if (manifest) {
      const installedAt = new Date(manifest.installedAt).toLocaleDateString();
      const updatedAt = new Date(manifest.updatedAt).toLocaleDateString();
      const scope = localManifest ? 'local' : 'user';
      const features = [
        manifest.features.teams ? 'teams' : null,
        manifest.features.ambient ? 'ambient' : null,
        manifest.features.memory ? 'memory' : null,
      ].filter(Boolean).join(', ') || 'none';

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
    const maxNameLen = Math.max(...DEVFLOW_PLUGINS.map(p => p.name.length));
    const pluginList = DEVFLOW_PLUGINS
      .map(plugin => {
        const cmds = plugin.commands.length > 0 ? plugin.commands.join(', ') : '(skills only)';
        const optionalTag = plugin.optional ? color.dim(' (optional)') : '';
        const installedTag = manifest
          ? (installedPlugins.has(plugin.name) ? color.green(' ✓') : color.dim(' ✗'))
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
