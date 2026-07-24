import { Command } from 'commander';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as p from '@clack/prompts';
import color from 'picocolors';
import { getClaudeDirectory, getDevFlowDirectory } from '../../targets/claude-code/claude-paths.js';
import { DEVFLOW_PLUGINS, buildRulesMap, getAllRuleNames } from '../../core/plugins.js';
import { readManifest, writeManifest } from '../../core/manifest.js';
import { rulesDir } from '../../core/assets.js';
import { installAllRules, validateRuleShadow, type RuleInstallOutcome, type RuleShadowState } from '../../targets/claude-code/installer.js';

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

/** Render the shadow-state tag for a rule — shared by formatRuleRow and printRulesList. Exhaustive switch catches new states at compile time. */
function buildRuleShadowTag(shadowState: RuleShadowState): string {
  switch (shadowState) {
    case 'valid':
      return ' ' + color.green('shadowed');
    case 'empty-shadow-file':
      return ' ' + color.yellow('shadowed — invalid: empty file');
    case 'not-a-file':
      return ' ' + color.yellow('shadowed — invalid: not a file');
    case 'none':
      return '';
    default: {
      const _exhaustive: never = shadowState;
      void _exhaustive;
      return '';
    }
  }
}

/**
 * Format a single rule row for display.
 * Shared by --status (no installed tag) and printRulesList (with installed tag).
 */
function formatRuleRow(
  name: string,
  shortOwner: string,
  shadowState: RuleShadowState,
  installedTag: string = '',
): string {
  return `  ${color.cyan(name.padEnd(16))} ${color.dim(shortOwner)}${installedTag}${buildRuleShadowTag(shadowState)}`;
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
  const knownRuleSet = new Set(allRules);

  const ownerMap = buildRulesMap(DEVFLOW_PLUGINS);

  // Known rules rows — collect shadow state for the header count
  const knownResults = await Promise.all(
    allRules.map(async (name) => {
      const installedTag = installedSet.has(name) ? color.green(' ✓') : color.dim(' ✗');
      const shadowFile = path.join(devflowDir, 'rules', `${name}.md`);
      const shadowState = await validateRuleShadow(shadowFile);
      const owner = ownerMap.get(name) ?? 'unknown';
      const shortOwner = owner.replace('devflow-', '');
      return { row: formatRuleRow(name, shortOwner, shadowState, installedTag), shadowState };
    }),
  );

  const rows = knownResults.map(r => r.row);
  const shadowedCount = knownResults.filter(r => r.shadowState !== 'none').length;

  // Orphan shadows: in ~/.devflow/rules/ but not a known rule — mirroring skills list behavior
  const allShadowedNames = await listShadowedRules(devflowDir);
  for (const name of allShadowedNames) {
    if (!knownRuleSet.has(name)) {
      rows.push(`  ${color.yellow(name.padEnd(16))} ${color.yellow('unknown rule')}`);
    }
  }

  p.note(rows.join('\n'), `Rules (${allRules.length} known, ${shadowedCount} shadowed)`);
}

/**
 * Seed a rule shadow file from the installed rule or the built plugin source.
 * Returns which tier seeded: 'installed' | 'source' | 'none'.
 * Creates the shadow directory before copying.
 *
 * D35 — seedRuleShadow tiers (applies ADR-010):
 *   Tier 1 — installed rule at rulesTarget/{name}.md (fastest path when rules are enabled)
 *   Tier 2 — flat source at src/assets/rules/{name}.md (fallback when rules are disabled)
 *   Tier 3 — 'none': caller emits a manual-create instruction
 */
export async function seedRuleShadow(
  name: string,
  shadowFile: string,
  rulesTarget: string,
  devflowDir: string,
): Promise<'installed' | 'source' | 'none'> {
  await fs.mkdir(path.join(devflowDir, 'rules'), { recursive: true });

  // Tier 1: seed from installed rule
  try {
    await fs.copyFile(path.join(rulesTarget, `${name}.md`), shadowFile);
    return 'installed';
  } catch { /* not present — try flat source */ }

  // Tier 2: seed from flat rules source
  try {
    await fs.copyFile(path.join(rulesDir(), `${name}.md`), shadowFile);
    return 'source';
  } catch { /* source not found */ }

  return 'none';
}

async function handleRuleShadow(
  name: string | undefined,
  allRules: string[],
  devflowDir: string,
  rulesTarget: string,
): Promise<void> {
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

  const tier = await seedRuleShadow(name, shadowFile, rulesTarget, devflowDir);

  if (tier !== 'none') {
    p.log.success(`Shadowed ${color.cyan(name)}`);
    p.log.info(`Edit ${color.dim(shadowFile)} then run devflow rules --enable or devflow init to apply.`);
  } else {
    p.log.warn(`Could not seed shadow for ${name} (no installed or source file found)`);
    p.log.info(`Create ${color.dim(shadowFile)} manually then run devflow rules --enable to apply.`);
  }
}

async function handleRuleUnshadow(
  name: string | undefined,
  allRules: string[],
  devflowDir: string,
): Promise<void> {
  if (!name) {
    p.log.error('Rule name required. Usage: devflow rules unshadow <name>');
    process.exit(1);
  }

  // Mirror the shadow guard: reject unknown names before building the shadow path
  if (!allRules.includes(name)) {
    p.log.error(`Unknown rule: ${name}`);
    p.log.info(`Available rules: ${allRules.join(', ')}`);
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
        await handleRuleShadow(name, allRules, devflowDir, rulesTarget);
      } else if (action === 'unshadow') {
        await handleRuleUnshadow(name, allRules, devflowDir);
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
      // Wipe stale rules from previously uninstalled plugins before re-installing.
      // Mirrors the init flow which always starts from a clean rules directory.
      await fs.rm(rulesTarget, { recursive: true, force: true });
      await fs.mkdir(rulesTarget, { recursive: true });

      // Guard against a hard-error throw (e.g. missing declared source — PF-009).
      // Without this, the rm above leaves rules removed and the error becomes an
      // unhandled rejection rather than a clean CLI failure.
      let outcomes: { ruleName: string; outcome: RuleInstallOutcome }[];
      try {
        outcomes = await installAllRules(rulesMap, devflowDir, rulesTarget);
      } catch (err) {
        p.log.error(
          `Rules installation failed — rules directory has been cleared: ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exit(1);
      }

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
        installedFiles.map(async file => {
          const n = path.basename(file, '.md');
          const shortOwner = (ownerMap.get(n) ?? 'unknown').replace('devflow-', '');
          const shadowFile = path.join(devflowDir, 'rules', `${n}.md`);
          const shadowState = await validateRuleShadow(shadowFile);
          return formatRuleRow(n, shortOwner, shadowState);
        }),
      );
      p.note(lines.join('\n'), `Installed rules (${installedFiles.length})`);

    } else if (options.list) {
      await printRulesList(claudeDir, devflowDir);

    } else {
      p.log.info('Usage: devflow rules <shadow|unshadow|list> | --enable | --disable | --status | --list');
    }
  });
