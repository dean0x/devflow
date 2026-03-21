import { Command } from 'commander';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as p from '@clack/prompts';
import color from 'picocolors';
import { getClaudeDirectory, getDevFlowDirectory } from '../utils/paths.js';
import {
  PRESETS,
  DEFAULT_PRESET,
  loadConfig,
  saveConfig,
  resolveComponents,
} from '../hud/config.js';
import type { HudConfig, PresetName } from '../hud/types.js';

/**
 * Marker to identify DevFlow HUD in settings.json statusLine.
 */
const HUD_MARKER = 'hud';

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

  // If there's a non-DevFlow statusLine, don't overwrite (caller should check first)
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
 * Idempotent — returns unchanged JSON if statusLine not present or not DevFlow.
 */
export function removeHudStatusLine(settingsJson: string): string {
  const settings: Settings = JSON.parse(settingsJson);

  if (!settings.statusLine) {
    return settingsJson;
  }

  // Only remove if it's a DevFlow HUD/statusline
  if (!isDevFlowStatusLine(settings.statusLine)) {
    return settingsJson;
  }

  delete settings.statusLine;

  return JSON.stringify(settings, null, 2) + '\n';
}

/**
 * Check if the statusLine in settings JSON points to the DevFlow HUD.
 */
export function hasHudStatusLine(settingsJson: string): boolean {
  const settings: Settings = JSON.parse(settingsJson);
  if (!settings.statusLine) return false;
  return isDevFlowStatusLine(settings.statusLine);
}

/**
 * Check if an existing statusLine belongs to DevFlow (HUD or legacy statusline).
 */
function isDevFlowStatusLine(statusLine: StatusLine): boolean {
  return (
    statusLine.command?.includes(HUD_MARKER) ||
    statusLine.command?.includes('statusline') ||
    statusLine.command?.includes('devflow')
  );
}

/**
 * Check if an existing statusLine belongs to a non-DevFlow tool.
 */
export function hasNonDevFlowStatusLine(settingsJson: string): boolean {
  const settings: Settings = JSON.parse(settingsJson);
  if (!settings.statusLine?.command) return false;
  return !isDevFlowStatusLine(settings.statusLine);
}

/**
 * Format a preset preview for interactive display.
 */
function formatPresetPreview(preset: PresetName): string {
  const components = PRESETS[preset];
  return components.join(', ');
}

export const hudCommand = new Command('hud')
  .description('Configure the HUD (status line)')
  .option('--configure', 'Interactive preset picker')
  .option(
    '--preset <name>',
    'Quick preset switch (minimal, classic, standard, full)',
  )
  .option('--status', 'Show current HUD config')
  .option('--enable', 'Enable HUD in settings')
  .option('--disable', 'Disable HUD (remove statusLine)')
  .action(async (options) => {
    const hasFlag =
      options.configure ||
      options.preset ||
      options.status ||
      options.enable ||
      options.disable;
    if (!hasFlag) {
      p.intro(color.bgCyan(color.white(' HUD ')));
      p.note(
        `${color.cyan('devflow hud --configure')}   Interactive preset picker\n` +
          `${color.cyan('devflow hud --preset=<n>')} Quick preset switch\n` +
          `${color.cyan('devflow hud --status')}      Show current config\n` +
          `${color.cyan('devflow hud --enable')}      Enable HUD in settings\n` +
          `${color.cyan('devflow hud --disable')}     Remove HUD from settings`,
        'Usage',
      );
      p.note(
        `${color.yellow('minimal')}   ${formatPresetPreview('minimal')}\n` +
          `${color.yellow('classic')}   ${formatPresetPreview('classic')}\n` +
          `${color.yellow('standard')}  ${formatPresetPreview('standard')}\n` +
          `${color.yellow('full')}      ${formatPresetPreview('full')}`,
        'Presets',
      );
      p.outro(color.dim('Default preset: standard'));
      return;
    }

    if (options.status) {
      const config = loadConfig();
      const components = resolveComponents(config);
      p.intro(color.bgCyan(color.white(' HUD Status ')));
      p.note(
        `${color.dim('Preset:')}     ${color.cyan(config.preset)}\n` +
          `${color.dim('Components:')} ${components.join(', ')}`,
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

    if (options.preset) {
      const preset = options.preset as string;
      if (!(preset in PRESETS)) {
        p.log.error(
          `Unknown preset: ${preset}. Valid: ${Object.keys(PRESETS).join(', ')}`,
        );
        process.exit(1);
      }
      const config: HudConfig = {
        preset: preset as PresetName,
        components: PRESETS[preset as PresetName],
      };
      saveConfig(config);
      p.log.success(`HUD preset set to ${color.cyan(preset)}`);
      p.log.info(
        color.dim(`Components: ${config.components.join(', ')}`),
      );
      return;
    }

    if (options.configure) {
      const currentConfig = loadConfig();
      const presetChoice = await p.select({
        message: 'Choose HUD preset',
        options: [
          {
            value: 'minimal',
            label: 'Minimal',
            hint: formatPresetPreview('minimal'),
          },
          {
            value: 'classic',
            label: 'Classic',
            hint: formatPresetPreview('classic'),
          },
          {
            value: 'standard',
            label: 'Standard (Recommended)',
            hint: formatPresetPreview('standard'),
          },
          {
            value: 'full',
            label: 'Full',
            hint: formatPresetPreview('full'),
          },
        ],
        initialValue: currentConfig.preset === 'custom' ? DEFAULT_PRESET : currentConfig.preset,
      });

      if (p.isCancel(presetChoice)) {
        p.cancel('Configuration cancelled.');
        process.exit(0);
      }

      const preset = presetChoice as PresetName;
      const config: HudConfig = {
        preset,
        components: PRESETS[preset],
      };
      saveConfig(config);
      p.log.success(`HUD preset set to ${color.cyan(preset)}`);
      p.log.info(
        color.dim(`Components: ${config.components.join(', ')}`),
      );
      return;
    }

    const claudeDir = getClaudeDirectory();
    const settingsPath = path.join(claudeDir, 'settings.json');

    let settingsContent: string;
    try {
      settingsContent = await fs.readFile(settingsPath, 'utf-8');
    } catch {
      if (options.status) {
        p.log.info('HUD: disabled (no settings.json found)');
        return;
      }
      settingsContent = '{}';
    }

    if (options.enable) {
      // Check for non-DevFlow statusLine
      if (hasNonDevFlowStatusLine(settingsContent)) {
        const settings = JSON.parse(settingsContent) as Settings;
        p.log.warn(
          `Existing statusLine found: ${color.dim(settings.statusLine?.command ?? 'unknown')}`,
        );
        if (process.stdin.isTTY) {
          const overwrite = await p.confirm({
            message:
              'Replace existing statusLine with DevFlow HUD?',
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
      if (updated === settingsContent) {
        p.log.info('HUD already enabled');
        return;
      }
      await fs.writeFile(settingsPath, updated, 'utf-8');
      p.log.success('HUD enabled — statusLine registered');
      p.log.info(color.dim('Restart Claude Code to see the HUD'));
    }

    if (options.disable) {
      const updated = removeHudStatusLine(settingsContent);
      if (updated === settingsContent) {
        p.log.info('HUD already disabled');
        return;
      }
      await fs.writeFile(settingsPath, updated, 'utf-8');
      p.log.success('HUD disabled — statusLine removed');
    }
  });
