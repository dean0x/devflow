import { Command } from 'commander';
import { promises as fs } from 'fs';
import { accessSync } from 'fs';
import * as path from 'path';
import * as p from '@clack/prompts';
import color from 'picocolors';
import { getClaudeDirectory, getDevFlowDirectory } from '../utils/paths.js';
import { DEVFLOW_PLUGINS, buildRulesMap, getAllRuleNames } from '../plugins.js';
import { readManifest, writeManifest } from '../utils/manifest.js';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface RulesOptions {
  enable?: boolean;
  disable?: boolean;
  status?: boolean;
  list?: boolean;
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
    const manifest = await readManifest(devflowDir);

    if (options.enable) {
      if (!manifest) {
        p.log.error('No manifest found. Run devflow init first.');
        process.exit(1);
      }
      const installedPlugins = DEVFLOW_PLUGINS.filter(pl => manifest.plugins.includes(pl.name));
      const rulesMap = buildRulesMap(installedPlugins);
      const rulesTarget = path.join(claudeDir, 'rules', 'devflow');
      await fs.mkdir(rulesTarget, { recursive: true });

      const rootDir = path.resolve(__dirname, '../..');
      const pluginsDir = path.join(rootDir, 'plugins');

      for (const [ruleName, ownerPlugin] of rulesMap) {
        const shadowFile = path.join(devflowDir, 'rules', `${ruleName}.md`);
        let isShadowed = false;
        try {
          await fs.access(shadowFile);
          isShadowed = true;
        } catch { /* no shadow */ }

        const targetFile = path.join(rulesTarget, `${ruleName}.md`);
        if (isShadowed) {
          await fs.copyFile(shadowFile, targetFile);
        } else {
          const ruleSource = path.join(pluginsDir, ownerPlugin, 'rules', `${ruleName}.md`);
          try {
            await fs.access(ruleSource);
            await fs.copyFile(ruleSource, targetFile);
          } catch { continue; }
        }
      }

      // Update manifest
      manifest.features.rules = true;
      manifest.updatedAt = new Date().toISOString();
      await writeManifest(devflowDir, manifest);
      p.log.success(`Installed ${rulesMap.size} rule(s) to ${color.dim(rulesTarget)}`);

    } else if (options.disable) {
      const rulesTarget = path.join(claudeDir, 'rules', 'devflow');
      try {
        await fs.rm(rulesTarget, { recursive: true, force: true });
      } catch { /* ignore */ }

      if (manifest) {
        manifest.features.rules = false;
        manifest.updatedAt = new Date().toISOString();
        await writeManifest(devflowDir, manifest);
      }
      p.log.success('Rules disabled — removed rules directory');

    } else if (options.status) {
      const rulesTarget = path.join(claudeDir, 'rules', 'devflow');
      let installedFiles: string[] = [];
      try {
        const entries = await fs.readdir(rulesTarget);
        installedFiles = entries.filter(f => f.endsWith('.md'));
      } catch { /* dir doesn't exist */ }

      if (installedFiles.length === 0) {
        p.log.info('No rules installed. Run devflow rules --enable to install.');
        return;
      }

      // Build a reverse map: rule → plugin for display (all plugins for attribution)
      const allRulesMap = buildRulesMap(DEVFLOW_PLUGINS);

      const lines = installedFiles.map(file => {
        const name = path.basename(file, '.md');
        const owner = allRulesMap.get(name) ?? 'unknown';
        const shortOwner = owner.replace('devflow-', '');
        const shadowFile = path.join(devflowDir, 'rules', `${name}.md`);
        let shadowed = false;
        try {
          accessSync(shadowFile);
          shadowed = true;
        } catch { /* not shadowed */ }
        const shadowTag = shadowed ? color.yellow(' [shadowed]') : '';
        return `  ${color.cyan(name.padEnd(16))} ${color.dim(shortOwner)}${shadowTag}`;
      });

      p.note(lines.join('\n'), `Installed rules (${installedFiles.length})`);

    } else if (options.list) {
      const allRules = getAllRuleNames();
      const rulesTarget = path.join(claudeDir, 'rules', 'devflow');
      let installedFiles: string[] = [];
      try {
        const entries = await fs.readdir(rulesTarget);
        installedFiles = entries.filter(f => f.endsWith('.md')).map(f => path.basename(f, '.md'));
      } catch { /* dir doesn't exist */ }
      const installedSet = new Set(installedFiles);

      // Build reverse map for plugin attribution
      const allRulesMap = buildRulesMap(DEVFLOW_PLUGINS);

      const lines = allRules.map(name => {
        const owner = allRulesMap.get(name) ?? 'unknown';
        const shortOwner = owner.replace('devflow-', '');
        const installed = installedSet.has(name);
        const tag = installed ? color.green(' ✓') : color.dim(' ✗');
        const shadowFile = path.join(devflowDir, 'rules', `${name}.md`);
        let shadowed = false;
        try {
          accessSync(shadowFile);
          shadowed = true;
        } catch { /* not shadowed */ }
        const shadowTag = shadowed ? color.yellow(' [shadowed]') : '';
        return `  ${color.cyan(name.padEnd(16))} ${color.dim(shortOwner)}${tag}${shadowTag}`;
      });

      p.note(lines.join('\n'), `Available rules (${allRules.length})`);

    } else {
      // No option — show help
      p.log.info('Usage: devflow rules --enable | --disable | --status | --list');
    }
  });
