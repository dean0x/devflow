import { Command } from 'commander';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as p from '@clack/prompts';
import color from 'picocolors';
import { getClaudeDirectory, getDevFlowDirectory } from '../../targets/claude-code/claude-paths.js';
import { syncManifestFeature } from '../../core/manifest.js';
import { writeSettingsFileAtomic } from '../../core/fs-atomic.js';
import {
  HUD_COMPONENTS,
  loadConfig,
  saveConfig,
} from '../../hud/config.js';

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
 * Upgrades devflow's legacy statusline.sh to hud.sh automatically; a statusLine
 * that is not devflow's is returned unchanged (D-HUD-EXACT-OWNER).
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
 * The statusLine command endings devflow has ever written: the HUD, and the
 * pre-HUD `statusline.sh` it replaced.
 */
const DEVFLOW_STATUSLINE_SUFFIXES = [
  '/.devflow/scripts/hud.sh',
  '/.devflow/scripts/statusline.sh',
] as const;

/**
 * Check if an existing statusLine belongs to Devflow (HUD or legacy statusline).
 *
 * D-HUD-EXACT-OWNER: a statusLine is devflow's only when its command ends in
 * `/.devflow/scripts/hud.sh` or the legacy `/.devflow/scripts/statusline.sh`, under
 * any parent directory — so installs from the custom-directory and local-scope era
 * are still recognised. A bare `statusline.sh` (the Claude Code docs' own example,
 * `~/.claude/statusline.sh`) or a path that merely contains a `devflow` segment is
 * the user's (applies ADR-024: remove or replace only what devflow provably wrote).
 * Backslashes are read as slashes so a Windows install is matched the same way. A
 * hand-edited command that is not a string is the user's, as in `endsWithAny`.
 *
 * Every caller converges through this one predicate: `addHudStatusLine` (init's
 * settings pass with the HUD on, `init --hud-only`, `hud --enable`),
 * `removeHudStatusLine` (init's settings pass with `--no-hud`, `hud --disable`,
 * uninstall's `runCleanupPhase`), and `hasHudStatusLine` / `hasNonDevFlowStatusLine`
 * (`hud --enable`, `hud --status`).
 */
function isDevFlowStatusLine(statusLine: StatusLine): boolean {
  // Parsed from a hand-editable settings.json, so the declared type is not a guarantee.
  const raw: unknown = statusLine.command;
  if (typeof raw !== 'string') return false;
  const cmd = raw.trim().replace(/\\/g, '/');
  return DEVFLOW_STATUSLINE_SUFFIXES.some((suffix) => cmd.endsWith(suffix));
}

/**
 * Check if an existing statusLine belongs to a non-Devflow tool.
 */
export function hasNonDevFlowStatusLine(settingsJson: string): boolean {
  const settings: Settings = JSON.parse(settingsJson);
  if (!settings.statusLine?.command) return false;
  return !isDevFlowStatusLine(settings.statusLine);
}

/**
 * Build a fresh Commander Command for the `hud` subcommand.
 * Exported for tests that need per-test isolation without resorting to
 * Commander's private `_optionValues` field.
 */
export function createHudCommand(): Command {
  return new Command('hud')
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
      const devflowDir = getDevFlowDirectory();
      const settingsPath = path.join(claudeDir, 'settings.json');
      let settingsContent: string;
      try {
        settingsContent = await fs.readFile(settingsPath, 'utf-8');
      } catch {
        settingsContent = '{}';
      }

      // Ensure statusLine is registered (idempotent — adds only if missing).
      // This runs unconditionally so a missing statusLine is repaired even when
      // config already says enabled (@D2 symmetric self-heal with --disable).
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
            // User confirmed: clear the non-Devflow statusLine so
            // addHudStatusLine can write the Devflow HUD. The guard inside
            // addHudStatusLine protects callers that haven't confirmed yet;
            // this call site has confirmed, so clear the field first.
            const confirmed = JSON.parse(settingsContent) as Settings;
            delete confirmed.statusLine;
            settingsContent = JSON.stringify(confirmed, null, 2) + '\n';
          } else {
            p.log.info(
              'Non-interactive mode — skipping (existing statusLine would be overwritten)',
            );
            return;
          }
        }

        const updated = addHudStatusLine(settingsContent, devflowDir);
        await writeSettingsFileAtomic(settingsPath, updated);
      }

      // Always update config and sync manifest — removing the already-enabled
      // early-return makes --enable self-healing symmetric with --disable.
      // @D2 a drifted manifest (hud=false when config says enabled) is repaired
      // on --enable without requiring a disable/re-enable cycle.
      const config = loadConfig();
      const wasEnabled = config.enabled;
      if (!wasEnabled) {
        saveConfig({ ...config, enabled: true });
      }

      await syncManifestFeature(devflowDir, 'hud', true);

      if (wasEnabled) {
        p.log.info('HUD already enabled');
      } else {
        p.log.success('HUD enabled');
        p.log.info(color.dim('Restart Claude Code to see the HUD'));
      }
    }

    if (options.disable) {
      const config = loadConfig();
      const wasEnabled = config.enabled;

      // Always update config to disabled (idempotent).
      if (wasEnabled) {
        saveConfig({ ...config, enabled: false });
      }

      // @D1 Always attempt to hard-remove the statusLine from settings.json,
      // regardless of config.enabled. This self-heals drift where hud.json says
      // disabled but a Devflow statusLine still lingers in settings.json from a
      // partial prior state (e.g. crash between config-write and settings-write).
      const claudeDir = getClaudeDirectory();
      const settingsPath = path.join(claudeDir, 'settings.json');
      let statusLineRemoved = false;
      try {
        const settingsContent = await fs.readFile(settingsPath, 'utf-8');
        const updated = removeHudStatusLine(settingsContent);
        if (updated !== settingsContent) {
          await writeSettingsFileAtomic(settingsPath, updated);
          statusLineRemoved = true;
        }
      } catch {
        // settings.json may not exist — non-fatal
      }

      if (!wasEnabled && !statusLineRemoved) {
        p.log.info('HUD already disabled');
        return;
      }

      await syncManifestFeature(getDevFlowDirectory(), 'hud', false);
      p.log.success('HUD disabled');
    }
  });
}

export const hudCommand = createHudCommand();
