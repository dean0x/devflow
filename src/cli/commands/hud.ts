import { Command } from 'commander';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as p from '@clack/prompts';
import color from 'picocolors';
import { getClaudeDirectory, getDevFlowDirectory } from '../utils/paths.js';
import {
  HUD_COMPONENTS,
  loadConfig,
  saveConfig,
} from '../hud/config.js';

interface StatusLine {
  type: string;
  command: string;
}

interface Settings {
  statusLine?: StatusLine;
  [key: string]: unknown;
}

/**
 * Add the HUD statusLine to settings JSON.
 * Idempotent — returns unchanged JSON if HUD already set.
 * Upgrades legacy statusline.sh to hud.sh automatically.
 */
export function addHudStatusLine(
  settingsJson: string,
  devflowDir: string,
): string {
  const settings: Settings = JSON.parse(settingsJson);
  const hudCommand = path.join(devflowDir, 'scripts', 'hud.sh');

  // Already pointing to this exact HUD — nothing to do
  if (settings.statusLine?.command === hudCommand) {
    return settingsJson;
  }

  // If there's a non-Devflow statusLine, don't overwrite (caller should check first)
  if (settings.statusLine && !isDevFlowStatusLine(settings.statusLine)) {
    return settingsJson;
  }

  settings.statusLine = {
    type: 'command',
    command: hudCommand,
  };

  return JSON.stringify(settings, null, 2) + '\n';
}

/**
 * Remove the HUD statusLine from settings JSON.
 * Idempotent — returns unchanged JSON if statusLine not present or not Devflow.
 */
export function removeHudStatusLine(settingsJson: string): string {
  const settings: Settings = JSON.parse(settingsJson);

  if (!settings.statusLine) {
    return settingsJson;
  }

  // Only remove if it's a Devflow HUD/statusline
  if (!isDevFlowStatusLine(settings.statusLine)) {
    return settingsJson;
  }

  delete settings.statusLine;

  return JSON.stringify(settings, null, 2) + '\n';
}

/**
 * Check if the statusLine in settings JSON points to the Devflow HUD.
 */
export function hasHudStatusLine(settingsJson: string): boolean {
  const settings: Settings = JSON.parse(settingsJson);
  if (!settings.statusLine) return false;
  return isDevFlowStatusLine(settings.statusLine);
}

/**
 * Check if an existing statusLine belongs to Devflow (HUD or legacy statusline).
 * Matches paths containing 'hud.sh', 'statusline.sh', or a '/devflow/' directory segment.
 */
function isDevFlowStatusLine(statusLine: StatusLine): boolean {
  const cmd = statusLine.command ?? '';
  return (
    cmd.includes('hud.sh') ||
    cmd.includes('statusline.sh') ||
    cmd.includes('/devflow/') ||
    cmd.includes('\\devflow\\')
  );
}

/**
 * Check if an existing statusLine belongs to a non-Devflow tool.
 */
export function hasNonDevFlowStatusLine(settingsJson: string): boolean {
  const settings: Settings = JSON.parse(settingsJson);
  if (!settings.statusLine?.command) return false;
  return !isDevFlowStatusLine(settings.statusLine);
}

export const hudCommand = new Command('hud')
  .description('Configure the HUD (status line)')
  .option('--status', 'Show current HUD config')
  .option('--detail', 'Show tool/agent descriptions in HUD')
  .option('--no-detail', 'Hide tool/agent descriptions')
  .option('--enable', 'Enable HUD in settings')
  .option('--disable', 'Disable HUD (remove statusLine)')
  .action(async (options) => {
    const hasFlag =
      options.status ||
      options.enable ||
      options.disable ||
      options.detail !== undefined;
    if (!hasFlag) {
      p.intro(color.bgCyan(color.white(' HUD ')));
      p.note(
        `${color.cyan('devflow hud --detail')}      Show tool/agent descriptions\n` +
          `${color.cyan('devflow hud --no-detail')}   Hide tool/agent descriptions\n` +
          `${color.cyan('devflow hud --status')}      Show current config\n` +
          `${color.cyan('devflow hud --enable')}      Enable HUD in settings\n` +
          `${color.cyan('devflow hud --disable')}     Remove HUD from settings`,
        'Usage',
      );
      p.note(
        `${HUD_COMPONENTS.length} components: ${HUD_COMPONENTS.join(', ')}`,
        'Components',
      );
      p.outro(color.dim('Toggle with --enable / --disable'));
      return;
    }

    if (options.status) {
      const config = loadConfig();
      p.intro(color.bgCyan(color.white(' HUD Status ')));
      p.note(
        `${color.dim('Enabled:')}    ${config.enabled ? color.green('yes') : color.dim('no')}\n` +
          `${color.dim('Detail:')}     ${config.detail ? color.green('on') : color.dim('off')}\n` +
          `${color.dim('Components:')} ${HUD_COMPONENTS.length}`,
        'Current config',
      );

      // Check settings.json
      const claudeDir = getClaudeDirectory();
      const settingsPath = path.join(claudeDir, 'settings.json');
      try {
        const content = await fs.readFile(settingsPath, 'utf-8');
        const enabled = hasHudStatusLine(content);
        p.log.info(
          `Status line: ${enabled ? color.green('enabled') : color.dim('disabled')}`,
        );
      } catch {
        p.log.info(`Status line: ${color.dim('no settings.json found')}`);
      }
      return;
    }

    if (options.detail !== undefined) {
      const config = loadConfig();
      config.detail = options.detail;
      saveConfig(config);
      p.log.success(`HUD detail ${config.detail ? 'enabled' : 'disabled'}`);
      return;
    }

    if (options.enable) {
      const claudeDir = getClaudeDirectory();
      const settingsPath = path.join(claudeDir, 'settings.json');
      let settingsContent: string;
      try {
        settingsContent = await fs.readFile(settingsPath, 'utf-8');
      } catch {
        settingsContent = '{}';
      }

      // Ensure statusLine is registered
      if (!hasHudStatusLine(settingsContent)) {
        // Check for non-Devflow statusLine
        if (hasNonDevFlowStatusLine(settingsContent)) {
          const settings = JSON.parse(settingsContent) as Settings;
          p.log.warn(
            `Existing statusLine found: ${color.dim(settings.statusLine?.command ?? 'unknown')}`,
          );
          if (process.stdin.isTTY) {
            const overwrite = await p.confirm({
              message:
                'Replace existing statusLine with Devflow HUD?',
              initialValue: false,
            });
            if (p.isCancel(overwrite) || !overwrite) {
              p.log.info('HUD not enabled — existing statusLine preserved');
              return;
            }
          } else {
            p.log.info(
              'Non-interactive mode — skipping (existing statusLine would be overwritten)',
            );
            return;
          }
        }

        const devflowDir = getDevFlowDirectory();
        const updated = addHudStatusLine(settingsContent, devflowDir);
        await fs.writeFile(settingsPath, updated, 'utf-8');
      }

      // Update config
      const config = loadConfig();
      if (config.enabled) {
        p.log.info('HUD already enabled');
        return;
      }
      saveConfig({ ...config, enabled: true });

      p.log.success('HUD enabled');
      p.log.info(color.dim('Restart Claude Code to see the HUD'));
    }

    if (options.disable) {
      const config = loadConfig();
      if (!config.enabled) {
        p.log.info('HUD already disabled');
        return;
      }
      saveConfig({ ...config, enabled: false });
      p.log.success('HUD disabled');
      p.log.info(color.dim('Version upgrade notifications will still appear'));
    }
  });
