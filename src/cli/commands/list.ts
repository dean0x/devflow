import { Command } from 'commander';
import * as p from '@clack/prompts';
import color from 'picocolors';

/**
 * Plugin definition with metadata
 */
interface PluginDefinition {
  name: string;
  description: string;
  commands: string[];
}

/**
 * Available DevFlow plugins
 */
const DEVFLOW_PLUGINS: PluginDefinition[] = [
  {
    name: 'devflow-specify',
    description: 'Interactive feature specification',
    commands: ['/specify'],
  },
  {
    name: 'devflow-implement',
    description: 'Complete task implementation workflow',
    commands: ['/implement'],
  },
  {
    name: 'devflow-review',
    description: 'Comprehensive code review',
    commands: ['/review'],
  },
  {
    name: 'devflow-resolve',
    description: 'Process and fix review issues',
    commands: ['/resolve'],
  },
  {
    name: 'devflow-debug',
    description: 'Competing hypothesis debugging',
    commands: ['/debug'],
  },
  {
    name: 'devflow-catch-up',
    description: 'Context restoration from status logs',
    commands: ['/catch-up'],
  },
  {
    name: 'devflow-devlog',
    description: 'Development session logging',
    commands: ['/devlog'],
  },
  {
    name: 'devflow-core-skills',
    description: 'Auto-activating quality enforcement',
    commands: [],
  },
];

export const listCommand = new Command('list')
  .description('List available DevFlow plugins')
  .action(() => {
    p.intro(color.bgCyan(color.black(' DevFlow Plugins ')));

    const maxNameLen = Math.max(...DEVFLOW_PLUGINS.map(p => p.name.length));
    const pluginList = DEVFLOW_PLUGINS
      .map(plugin => {
        const cmds = plugin.commands.length > 0 ? plugin.commands.join(', ') : '(skills only)';
        return `${color.cyan(plugin.name.padEnd(maxNameLen + 2))}${color.dim(plugin.description)}\n${' '.repeat(maxNameLen + 2)}${color.yellow(cmds)}`;
      })
      .join('\n\n');

    p.note(pluginList, 'Available plugins');
    p.outro(color.dim('Install with: npx devflow-kit init --plugin=<name>'));
  });
