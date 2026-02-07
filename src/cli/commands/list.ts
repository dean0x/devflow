import { Command } from 'commander';
import * as p from '@clack/prompts';
import color from 'picocolors';
import { DEVFLOW_PLUGINS } from '../plugins.js';

export const listCommand = new Command('list')
  .description('List available DevFlow plugins')
  .action(() => {
    p.intro(color.bgCyan(color.black(' DevFlow Plugins ')));

    const maxNameLen = Math.max(...DEVFLOW_PLUGINS.map(p => p.name.length));
    const pluginList = DEVFLOW_PLUGINS
      .map(plugin => {
        const cmds = plugin.commands.length > 0 ? plugin.commands.join(', ') : '(skills only)';
        const optionalTag = plugin.optional ? color.dim(' (optional)') : '';
        return `${color.cyan(plugin.name.padEnd(maxNameLen + 2))}${color.dim(plugin.description)}${optionalTag}\n${' '.repeat(maxNameLen + 2)}${color.yellow(cmds)}`;
      })
      .join('\n\n');

    p.note(pluginList, 'Available plugins');
    p.outro(color.dim('Install with: npx devflow-kit init --plugin=<name>'));
  });
