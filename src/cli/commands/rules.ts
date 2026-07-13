import { Command } from 'commander';
import { promises as fs } from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import * as p from '@clack/prompts';
import color from 'picocolors';
import { getClaudeDirectory, getDevFlowDirectory } from '../utils/paths.js';
import { DEVFLOW_PLUGINS, buildRulesMap, getAllRuleNames } from '../plugins.js';
import { readManifest, writeManifest } from '../utils/manifest.js';
import { installAllRules, validateRuleShadow } from '../utils/installer.js';

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
export async function hasRuleShadow(ruleName: string, devflowDir?: string): Promise<boolean> {
  const dir = devflowDir ?? getDevFlowDirectory();
  try {
    await fs.access(path.join(dir, 'rules', `${ruleName}.md`));
    return true;
  } catch {
    return false;
  }
}

/**
 * List all rule shadow names (bare basenames without .md) from ~/.devflow/rules/.
 * Returns [] when the directory does not exist.
 */
export async function listShadowedRules(devflowDir?: string): Promise<string[]> {
  const dir = devflowDir ?? getDevFlowDirectory();
  const shadowsRoot = path.join(dir, 'rules');
  try {
    const entries = await fs.readdir(shadowsRoot);
    return entries
      .filter(e => e.endsWith('.md'))
      .map(e => path.basename(e, '.md'));
  } catch {
    return [];
  }
}

async function formatRuleRow(
  name: string,
  devflowDir: string,
  ownerMap: Map<string, string>,
): Promise<string> {
  const owner = ownerMap.get(name) ?? 'unknown';
  const shortOwner = owner.replace('devflow-', '');
  const shadowTag = await hasRuleShadow(name, devflowDir) ? color.yellow(' [shadowed]') : '';
  return `  ${color.cyan(name.padEnd(16))} ${color.dim(shortOwner)}${shadowTag}`;
}

/**
 * Build and print the enriched rules list (used by both `rules list` and `rules --list`).
 */
async function printRulesList(claudeDir: string, devflowDir: string): Promise<void> {
  const rulesTarget = path.join(claudeDir, 'rules', 'devflow');
  const allRules = getAllRuleNames();
  let installedNames: string[] = [];
  try {
    const entries = await fs.readdir(rulesTarget);
    installedNames = entries.filter(f => f.endsWith('.md')).map(f => path.basename(f, '.md'));
  } catch { /* dir doesn't exist */ }
  const installedSet = new Set(installedNames);

  const ownerMap = buildRulesMap(DEVFLOW_PLUGINS);
  const lines = await Promise.all(
    allRules.map(async (name) => {
      const installedTag = installedSet.has(name) ? color.green(' ✓') : color.dim(' ✗');

      // Shadow state annotation
      const shadowFile = path.join(devflowDir, 'rules', `${name}.md`);
      const shadowState = await validateRuleShadow(shadowFile);
      let shadowTag = '';
      if (shadowState === 'valid') {
        shadowTag = color.yellow(' [shadowed]');
      } else if (shadowState === 'empty-shadow-file') {
        shadowTag = color.yellow(' [shadowed — invalid: empty file]');
      } else if (shadowState === 'not-a-file') {
        shadowTag = color.yellow(' [shadowed — invalid: not a file]');
      }

      const owner = ownerMap.get(name) ?? 'unknown';
      const shortOwner = owner.replace('devflow-', '');
      return `  ${color.cyan(name.padEnd(16))} ${color.dim(shortOwner)}${installedTag}${shadowTag}`;
    }),
  );
  p.note(lines.join('\n'), `Available rules (${allRules.length})`);
}

export const rulesCommand = new Command('rules')
  .description('Manage Devflow rules')
  .argument('[action]', 'Action: shadow, unshadow, or list')
  .argument('[name]', 'Rule name (required for shadow/unshadow)')
  .option('--enable', 'Enable rules (install from manifest plugins)')
  .option('--disable', 'Disable rules (remove rules directory)')
  .option('--status', 'Show installed rules with source and shadow status')
  .option('--list', 'List all available rules with install status and shadow state')
  .action(async (action: string | undefined, name: string | undefined, options: RulesOptions) => {
    const claudeDir = getClaudeDirectory();
    const devflowDir = getDevFlowDirectory();
    const rulesTarget = path.join(claudeDir, 'rules', 'devflow');

    // Positional actions dispatch first — flags are not checked when action is given
    if (action) {
      const allRules = getAllRuleNames();

      if (action === 'shadow') {
        if (!name) {
          p.log.error('Rule name required. Usage: devflow rules shadow <name>');
          p.log.info(`Available rules: ${allRules.join(', ')}`);
          process.exit(1);
        }

        if (!allRules.includes(name)) {
          p.log.error(`Unknown rule: ${name}`);
          p.log.info(`Available rules: ${allRules.join(', ')}`);
          process.exit(1);
        }

        const shadowFile = path.join(devflowDir, 'rules', `${name}.md`);
        if (await hasRuleShadow(name, devflowDir)) {
          p.log.info(`${name} is already shadowed at ${color.dim(shadowFile)}`);
          return;
        }

        // Seed shadow from installed rule, or from built plugin source if rules are disabled
        await fs.mkdir(path.join(devflowDir, 'rules'), { recursive: true });

        const installedRule = path.join(rulesTarget, `${name}.md`);
        let seeded = false;
        try {
          await fs.copyFile(installedRule, shadowFile);
          seeded = true;
        } catch { /* installed rule not present — try plugin source */ }

        if (!seeded) {
          const pluginsDir = path.join(path.resolve(__dirname, '../..'), 'plugins');
          const ownerMap = buildRulesMap(DEVFLOW_PLUGINS);
          const ownerPlugin = ownerMap.get(name);
          if (ownerPlugin) {
            const sourceFile = path.join(pluginsDir, ownerPlugin, 'rules', `${name}.md`);
            try {
              await fs.copyFile(sourceFile, shadowFile);
              seeded = true;
            } catch { /* source not found */ }
          }
        }

        if (seeded) {
          p.log.success(`Shadowed ${color.cyan(name)}`);
          p.log.info(`Edit ${color.dim(shadowFile)} then run devflow rules --enable or devflow init to apply.`);
        } else {
          p.log.warn(`Could not seed shadow for ${name} (no installed or source file found)`);
          p.log.info(`Create ${color.dim(shadowFile)} manually then run devflow rules --enable to apply.`);
        }

      } else if (action === 'unshadow') {
        if (!name) {
          p.log.error('Rule name required. Usage: devflow rules unshadow <name>');
          process.exit(1);
        }

        const shadowFile = path.join(devflowDir, 'rules', `${name}.md`);
        if (!await hasRuleShadow(name, devflowDir)) {
          p.log.info(`${name} is not shadowed`);
          return;
        }

        await fs.rm(shadowFile, { force: true });
        p.log.success(`Unshadowed ${color.cyan(name)}`);
        p.log.info('Run devflow rules --enable or devflow init to restore Devflow\'s version.');

      } else if (action === 'list') {
        await printRulesList(claudeDir, devflowDir);

      } else {
        p.log.error(`Unknown action: ${action}`);
        p.log.info('Usage: devflow rules <shadow|unshadow|list> [name]');
        process.exit(1);
      }

      return;
    }

    // No positional action — fall through to flag-based handling

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

      const outcomes = await installAllRules(rulesMap, pluginsDir, devflowDir, rulesTarget);

      const shadowedCount = outcomes.filter(o => o.outcome === 'shadow').length;
      const shadowSuffix = shadowedCount > 0 ? ` (${shadowedCount} shadowed)` : '';

      for (const { ruleName, outcome } of outcomes) {
        if (
          outcome === 'source-invalid-shadow:empty-shadow-file' ||
          outcome === 'source-invalid-shadow:not-a-file'
        ) {
          p.log.warn(`Shadow for rule:${ruleName} is invalid — Devflow's version was installed`);
        }
      }

      manifest.features.rules = true;
      manifest.updatedAt = new Date().toISOString();
      await writeManifest(devflowDir, manifest);
      p.log.success(`Installed ${rulesMap.size} rule(s) to ${color.dim(rulesTarget)}${shadowSuffix}`);

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
        installedFiles.map(file => formatRuleRow(path.basename(file, '.md'), devflowDir, ownerMap)),
      );
      p.note(lines.join('\n'), `Installed rules (${installedFiles.length})`);

    } else if (options.list) {
      await printRulesList(claudeDir, devflowDir);

    } else {
      p.log.info('Usage: devflow rules <shadow|unshadow|list> | --enable | --disable | --status | --list');
    }
  });
