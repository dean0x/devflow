import { Command } from 'commander';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as p from '@clack/prompts';
import color from 'picocolors';
import { getClaudeDirectory, getDevFlowDirectory } from '../utils/paths.js';
import type { HookMatcher, Settings } from '../utils/hooks.js';

const PREAMBLE_HOOK_MARKER = 'preamble';
const LEGACY_HOOK_MARKER = 'ambient-prompt';
/** Stale marker from previous installs — cleaned on disable/re-enable */
const CLASSIFICATION_HOOK_MARKER = 'session-start-classification';

/**
 * Path where the legacy commands rule was installed.
 * The commands rule was removed — this path now exists only to purge the
 * legacy file from prior installs. Managed by ambient.ts directly (not the
 * plugin rules system), so only ambient enable/disable/init paths clean it up.
 */
export const COMMANDS_RULE_PATH = path.join(os.homedir(), '.claude', 'rules', 'devflow', 'commands.md');

/** Filter hook entries from a parsed Settings object for a given event. Returns true if any were removed. */
function filterHookEntries(
  settings: Settings,
  eventName: string,
  shouldRemove: (matcher: HookMatcher) => boolean,
): boolean {
  if (!settings.hooks?.[eventName]) return false;

  const before = settings.hooks[eventName].length;
  settings.hooks[eventName] = settings.hooks[eventName].filter(
    (matcher) => !shouldRemove(matcher),
  );

  if (settings.hooks[eventName].length === before) return false;

  if (settings.hooks[eventName].length === 0) {
    delete settings.hooks[eventName];
  }
  if (Object.keys(settings.hooks).length === 0) {
    delete settings.hooks;
  }
  return true;
}

const isLegacy = (matcher: HookMatcher) =>
  matcher.hooks.some((h) => h.command.includes(LEGACY_HOOK_MARKER));

const isAmbient = (matcher: HookMatcher) =>
  matcher.hooks.some((h) =>
    h.command.includes(PREAMBLE_HOOK_MARKER) || h.command.includes(LEGACY_HOOK_MARKER),
  );

const isClassification = (matcher: HookMatcher) =>
  matcher.hooks.some((h) => h.command.includes(CLASSIFICATION_HOOK_MARKER));

/**
 * Remove the legacy commands awareness rule file left by prior installs.
 * Idempotent — no-op if the file does not exist.
 * Fail-safe: swallows ALL errors (ENOENT, EACCES, EPERM, EROFS, etc.).
 * This is best-effort cleanup of a deprecated file; it must never abort
 * the primary operation (hook write or settings.json update) that calls it.
 */
export async function removeLegacyCommandsRule(): Promise<void> {
  try {
    await fs.unlink(COMMANDS_RULE_PATH);
  } catch {
    // Intentionally swallow all errors — cleanup is best-effort.
    // ENOENT = already gone (idempotent); EACCES/EPERM/EROFS = unwritable
    // filesystem. Neither should abort the caller's primary operation.
  }
}

/**
 * Add the ambient UserPromptSubmit hook and remove any legacy commands rule.
 * Removes any legacy `ambient-prompt` hook first, then adds the new `preamble` hook.
 * Removes any legacy commands rule left by prior installs.
 * Idempotent — hook checked before adding; legacy rule purge runs unconditionally
 * (before the early-return) to ensure stale files are always cleaned up.
 */
export async function addAmbientHook(settingsJson: string, devflowDir: string): Promise<string> {
  const settings: Settings = JSON.parse(settingsJson);
  let changed = filterHookEntries(settings, 'UserPromptSubmit', isLegacy);

  // --- UserPromptSubmit: preamble hook (keyword + plan detection) ---
  const hasPreamble = settings.hooks?.UserPromptSubmit?.some((m) =>
    m.hooks.some((h) => h.command.includes(PREAMBLE_HOOK_MARKER)),
  );

  if (!hasPreamble) {
    settings.hooks ??= {};
    settings.hooks.UserPromptSubmit ??= [];
    settings.hooks.UserPromptSubmit.push({
      hooks: [
        {
          type: 'command',
          command: path.join(devflowDir, 'scripts', 'hooks', 'run-hook') + ' preamble',
          timeout: 5,
        },
      ],
    });
    changed = true;
  }

  // --- Purge legacy commands rule (runs before early-return so stale files are always removed) ---
  await removeLegacyCommandsRule();

  if (!changed) return settingsJson;
  return JSON.stringify(settings, null, 2) + '\n';
}

/**
 * Remove the ambient hooks from settings JSON and purge any legacy commands rule.
 * Removes preamble + legacy from UserPromptSubmit.
 * Also removes stale SessionStart classification hook from previous installs.
 * Purges legacy COMMANDS_RULE_PATH if present (runs before early-return).
 * Idempotent — returns unchanged JSON if neither prompt hook nor stale classification was present.
 * Preserves other hooks. Cleans empty arrays/objects.
 */
export async function removeAmbientHook(settingsJson: string): Promise<string> {
  const settings: Settings = JSON.parse(settingsJson);
  const removedPrompt = filterHookEntries(settings, 'UserPromptSubmit', isAmbient);
  // Clean up stale classification hooks from previous installs (no longer registered)
  const removedClassification = filterHookEntries(settings, 'SessionStart', isClassification);

  // Purge legacy commands rule (runs before early-return so stale files are always removed)
  await removeLegacyCommandsRule();

  if (!removedPrompt && !removedClassification) return settingsJson;
  return JSON.stringify(settings, null, 2) + '\n';
}

/**
 * Check if the ambient hook (legacy or current) is registered in settings JSON or parsed Settings object.
 */
export function hasAmbientHook(input: string | Settings): boolean {
  const settings: Settings = typeof input === 'string' ? JSON.parse(input) : input;
  return settings.hooks?.UserPromptSubmit?.some((matcher) =>
    matcher.hooks.some((h) =>
      h.command.includes(PREAMBLE_HOOK_MARKER) || h.command.includes(LEGACY_HOOK_MARKER),
    ),
  ) ?? false;
}

interface AmbientOptions {
  enable?: boolean;
  disable?: boolean;
  status?: boolean;
}

export const ambientCommand = new Command('ambient')
  .description('Enable or disable ambient mode (keyword + plan auto-detection)')
  .option('--enable', 'Register ambient mode hook')
  .option('--disable', 'Remove ambient mode hook')
  .option('--status', 'Check if ambient mode is enabled')
  .action(async (options: AmbientOptions) => {
    const hasFlag = options.enable || options.disable || options.status;
    if (!hasFlag) {
      p.intro(color.bgMagenta(color.white(' Ambient Mode ')));
      p.note(
        `${color.cyan('devflow ambient --enable')}   Register detection hook\n` +
        `${color.cyan('devflow ambient --disable')}  Remove detection hook\n` +
        `${color.cyan('devflow ambient --status')}   Check current state`,
        'Usage',
      );
      return;
    }

    const claudeDir = getClaudeDirectory();
    const settingsPath = path.join(claudeDir, 'settings.json');

    let settingsContent: string;
    try {
      settingsContent = await fs.readFile(settingsPath, 'utf-8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      if (options.status) {
        p.log.info('Ambient mode: disabled (no settings.json found)');
        return;
      }
      // Create minimal settings.json
      settingsContent = '{}';
    }

    if (options.status) {
      const enabled = hasAmbientHook(settingsContent);
      p.log.info(`Ambient mode: ${enabled ? color.green('enabled') : color.dim('disabled')}`);
      return;
    }

    // Resolve devflow scripts directory.
    // Primary: getDevFlowDirectory() — purpose-built, not coupled to hook path layout.
    // Fallback: infer from Stop hook command path (legacy installs where getDevFlowDirectory
    //   may not yet reflect the correct location).
    let devflowDir: string = getDevFlowDirectory();
    try {
      const settings: Settings = JSON.parse(settingsContent);
      const stopHook = settings.hooks?.Stop?.[0]?.hooks?.[0]?.command;
      if (stopHook) {
        const hookBinary = stopHook.split(' ')[0];
        const inferred = path.resolve(hookBinary, '..', '..', '..');
        // Only use inferred path when it differs from the canonical default —
        // this handles legacy installs where the hook was installed to a non-standard location.
        if (inferred !== devflowDir) {
          devflowDir = inferred;
        }
      }
    } catch (err) {
      // JSON.parse can fail on a corrupt settings file; log and keep canonical default.
      p.log.warn(`Could not parse settings.json for devflow directory resolution: ${(err as Error).message}`);
    }

    if (options.enable) {
      const updated = await addAmbientHook(settingsContent, devflowDir);
      if (updated === settingsContent) {
        // Hook already exists — addAmbientHook purges any legacy rule anyway
        p.log.info('Ambient mode already enabled');
        return;
      }
      await fs.writeFile(settingsPath, updated, 'utf-8');
      p.log.success('Ambient mode enabled — detection hook registered');
      p.log.info(color.dim('Keyword prompts and structured plans auto-run their workflow'));
    }

    if (options.disable) {
      const updated = await removeAmbientHook(settingsContent);
      if (updated === settingsContent) {
        p.log.info('Ambient mode already disabled');
        return;
      }
      await fs.writeFile(settingsPath, updated, 'utf-8');
      p.log.success('Ambient mode disabled — hook removed');
    }
  });
