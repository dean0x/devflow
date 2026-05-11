import { Command } from 'commander';
import { promises as fs } from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import * as p from '@clack/prompts';
import color from 'picocolors';
import { getClaudeDirectory, getDevFlowDirectory } from '../utils/paths.js';
import { DEVFLOW_PLUGINS, buildRulesMap, getAllRuleNames } from '../plugins.js';
import { readManifest, writeManifest } from '../utils/manifest.js';
import { installRuleFile } from '../utils/installer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface RulesOptions {
  enable?: boolean;
  disable?: boolean;
  status?: boolean;
  list?: boolean;
}

/**
 * Check whether a rule has a user shadow file at ~/.devflow/rules/{name}.md.
 */
async function isShadowed(devflowDir: string, ruleName: string): Promise<boolean> {
  try {
    await fs.access(path.join(devflowDir, 'rules', `${ruleName}.md`));
    return true;
  } catch {
    return false;
  }
}

async function formatRuleRow(
  name: string,
  devflowDir: string,
  ownerMap: Map<string, string>,
  suffix: string,
): Promise<string> {
  const owner = ownerMap.get(name) ?? 'unknown';
  const shortOwner = owner.replace('devflow-', '');
  const shadowTag = await isShadowed(devflowDir, name) ? color.yellow(' [shadowed]') : '';
  return `  ${color.cyan(name.padEnd(16))} ${color.dim(shortOwner)}${suffix}${shadowTag}`;
}

export const rulesCommand = new Command('rules')
  .description('Manage Devflow rules')
  .option('--enable', 'Enable rules (install from manifest plugins)')
  .option('--disable', 'Disable rules (remove rules directory)')
  .option('--status', 'Show installed rules with source and shadow status')
  .option('--list', 'List all available rules across all plugins')
  .action(async (options: RulesOptions) => {
    const claudeDir = getClaudeDirectory();
    const devflowDir = getDevFlowDirectory();
    const rulesTarget = path.join(claudeDir, 'rules', 'devflow');

    if (options.enable) {
      const manifest = await readManifest(devflowDir);
      if (!manifest) {
        p.log.error('No manifest found. Run devflow init first.');
        process.exit(1);
      }

      const installedPlugins = DEVFLOW_PLUGINS.filter(pl => manifest.plugins.includes(pl.name));
      const rulesMap = buildRulesMap(installedPlugins);
      const pluginsDir = path.join(path.resolve(__dirname, '../..'), 'plugins');

      // Wipe stale rules from previously uninstalled plugins before re-installing.
      // Mirrors the init flow which always starts from a clean rules directory.
      await fs.rm(rulesTarget, { recursive: true, force: true });
      await fs.mkdir(rulesTarget, { recursive: true });

      await Promise.all(
        [...rulesMap.entries()].map(([ruleName, ownerPlugin]) =>
          installRuleFile(ruleName, ownerPlugin, pluginsDir, devflowDir, rulesTarget),
        ),
      );

      manifest.features.rules = true;
      manifest.updatedAt = new Date().toISOString();
      await writeManifest(devflowDir, manifest);
      p.log.success(`Installed ${rulesMap.size} rule(s) to ${color.dim(rulesTarget)}`);

    } else if (options.disable) {
      await fs.rm(rulesTarget, { recursive: true, force: true });

      const manifest = await readManifest(devflowDir);
      if (manifest) {
        manifest.features.rules = false;
        manifest.updatedAt = new Date().toISOString();
        await writeManifest(devflowDir, manifest);
      }
      p.log.success('Rules disabled — removed rules directory');

    } else if (options.status) {
      let installedFiles: string[] = [];
      try {
        const entries = await fs.readdir(rulesTarget);
        installedFiles = entries.filter(f => f.endsWith('.md'));
      } catch { /* dir doesn't exist */ }

      if (installedFiles.length === 0) {
        p.log.info('No rules installed. Run devflow rules --enable to install.');
        return;
      }

      const ownerMap = buildRulesMap(DEVFLOW_PLUGINS);
      const lines = await Promise.all(
        installedFiles.map(file => formatRuleRow(path.basename(file, '.md'), devflowDir, ownerMap, '')),
      );
      p.note(lines.join('\n'), `Installed rules (${installedFiles.length})`);

    } else if (options.list) {
      const allRules = getAllRuleNames();
      let installedNames: string[] = [];
      try {
        const entries = await fs.readdir(rulesTarget);
        installedNames = entries.filter(f => f.endsWith('.md')).map(f => path.basename(f, '.md'));
      } catch { /* dir doesn't exist */ }
      const installedSet = new Set(installedNames);

      const ownerMap = buildRulesMap(DEVFLOW_PLUGINS);
      const lines = await Promise.all(
        allRules.map(name => {
          const tag = installedSet.has(name) ? color.green(' ✓') : color.dim(' ✗');
          return formatRuleRow(name, devflowDir, ownerMap, tag);
        }),
      );
      p.note(lines.join('\n'), `Available rules (${allRules.length})`);

    } else {
      p.log.info('Usage: devflow rules --enable | --disable | --status | --list');
    }
  });
