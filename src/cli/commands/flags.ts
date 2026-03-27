import { Command } from 'commander';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as p from '@clack/prompts';
import color from 'picocolors';
import { getClaudeDirectory, getDevFlowDirectory } from '../utils/paths.js';
import { FLAG_REGISTRY, applyFlags, stripFlags, getDefaultFlags } from '../utils/flags.js';
import { readManifest, writeManifest } from '../utils/manifest.js';

/**
 * Resolve current enabled flags from manifest (falls back to defaults if no manifest).
 */
async function resolveEnabledFlags(devflowDir: string): Promise<string[]> {
  const manifest = await readManifest(devflowDir);
  if (manifest) {
    return manifest.features.flags;
  }
  return getDefaultFlags();
}

/**
 * Update settings.json with the given flag set.
 */
async function updateSettingsFlags(claudeDir: string, flagIds: string[]): Promise<void> {
  const settingsPath = path.join(claudeDir, 'settings.json');
  let content: string;
  try {
    content = await fs.readFile(settingsPath, 'utf-8');
    // Validate that content is parseable JSON before passing to stripFlags/applyFlags
    JSON.parse(content);
  } catch {
    content = '{}';
  }
  const stripped = stripFlags(content);
  const updated = applyFlags(stripped, flagIds);
  await fs.writeFile(settingsPath, updated, 'utf-8');
}

/**
 * Update manifest with the given flag set.
 */
async function updateManifestFlags(devflowDir: string, flagIds: string[]): Promise<void> {
  const manifest = await readManifest(devflowDir);
  if (!manifest) return;
  manifest.features.flags = flagIds;
  manifest.updatedAt = new Date().toISOString();
  await writeManifest(devflowDir, manifest);
}

/**
 * Parse and validate comma-separated flag IDs against the registry.
 * Exits with error if any IDs are unknown.
 */
function parseFlagIds(input: string): string[] {
  const ids = input.split(',').map((s: string) => s.trim()).filter(Boolean);
  const invalid = ids.filter(id => !FLAG_REGISTRY.some(f => f.id === id));

  if (invalid.length > 0) {
    p.log.error(`Unknown flag(s): ${invalid.join(', ')}`);
    p.log.info(`Available: ${FLAG_REGISTRY.map(f => f.id).join(', ')}`);
    process.exit(1);
  }

  return ids;
}

interface FlagsOptions {
  enable?: string;
  disable?: string;
  status?: boolean;
  list?: boolean;
}

export const flagsCommand = new Command('flags')
  .description('Manage Claude Code feature flags')
  .option('--enable <ids>', 'Enable flag(s), comma-separated')
  .option('--disable <ids>', 'Disable flag(s), comma-separated')
  .option('--status', 'Show current flag states')
  .option('--list', 'List all available flags')
  .action(async (options: FlagsOptions) => {
    const claudeDir = getClaudeDirectory();
    const devflowDir = getDevFlowDirectory();

    if (options.list) {
      p.intro(color.bgCyan(color.black(' Claude Code Flags ')));
      const defaults = new Set(getDefaultFlags());
      for (const flag of FLAG_REGISTRY) {
        const status = defaults.has(flag.id) ? color.green('default ON') : color.dim('default OFF');
        const targetInfo = flag.target.type === 'env'
          ? `env.${flag.target.key}`
          : `setting.${flag.target.key}`;
        p.log.info(`${color.bold(flag.id)} — ${flag.label} (${status})`);
        p.log.info(`  ${color.dim(flag.description)} → ${color.dim(targetInfo)}`);
      }
      return;
    }

    if (options.status) {
      p.intro(color.bgCyan(color.black(' Claude Code Flags ')));
      const enabled = new Set(await resolveEnabledFlags(devflowDir));
      for (const flag of FLAG_REGISTRY) {
        const state = enabled.has(flag.id) ? color.green('enabled') : color.dim('disabled');
        p.log.info(`${flag.id.padEnd(25)} ${state}`);
      }
      return;
    }

    if (options.enable) {
      const ids = parseFlagIds(options.enable);
      const current = await resolveEnabledFlags(devflowDir);
      const updated = [...new Set([...current, ...ids])];

      await updateSettingsFlags(claudeDir, updated);
      await updateManifestFlags(devflowDir, updated);

      for (const id of ids) {
        p.log.success(`${id} enabled`);
      }
      return;
    }

    if (options.disable) {
      const ids = parseFlagIds(options.disable);
      const current = await resolveEnabledFlags(devflowDir);
      const toDisable = new Set(ids);
      const updated = current.filter(id => !toDisable.has(id));

      await updateSettingsFlags(claudeDir, updated);
      await updateManifestFlags(devflowDir, updated);

      for (const id of ids) {
        p.log.success(`${id} disabled`);
      }
      return;
    }

    // No option — show help
    p.log.info('Usage: devflow flags --status | --list | --enable <ids> | --disable <ids>');
  });
