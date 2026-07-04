import { Command } from 'commander';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as p from '@clack/prompts';
import color from 'picocolors';
import { getClaudeDirectory, getDevFlowDirectory } from '../utils/paths.js';
import { syncManifestFeature } from '../utils/manifest.js';
import { writeFileAtomicExclusive } from '../utils/fs-atomic.js';
import type { HookMatcher, Settings } from '../utils/hooks.js';

const PREAMBLE_HOOK_MARKER = 'preamble';
const LEGACY_HOOK_MARKER = 'ambient-prompt';
/** Stale marker from previous installs — cleaned on disable/re-enable */
const CLASSIFICATION_HOOK_MARKER = 'session-start-classification';
/** SessionStart orchestrator charter hook — presence-gated by ambient toggle */
const ORCHESTRATOR_HOOK_MARKER = 'session-start-orchestrator';

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

const isOrchestrator = (matcher: HookMatcher) =>
  matcher.hooks.some((h) => h.command.includes(ORCHESTRATOR_HOOK_MARKER));

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
 * Add the ambient hooks (preamble UserPromptSubmit + session-start-orchestrator SessionStart)
 * and remove any legacy commands rule. Removes any legacy `ambient-prompt` hook first.
 * Idempotent — each hook is checked before adding so enable repairs partial states.
 * Legacy rule purge runs unconditionally to ensure stale files are always cleaned up.
 */
export async function addAmbientHook(settingsJson: string, devflowDir: string): Promise<string> {
  const settings: Settings = JSON.parse(settingsJson);
  let changed = filterHookEntries(settings, 'UserPromptSubmit', isLegacy);

  // --- UserPromptSubmit: preamble hook (git-gated reminder + plan-handoff fast-path) ---
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

  // --- SessionStart: orchestrator charter hook (git-gated charter injection) ---
  const hasOrchestratorHook = settings.hooks?.SessionStart?.some((m) =>
    m.hooks.some((h) => h.command.includes(ORCHESTRATOR_HOOK_MARKER)),
  );

  if (!hasOrchestratorHook) {
    settings.hooks ??= {};
    settings.hooks.SessionStart ??= [];
    settings.hooks.SessionStart.push({
      hooks: [
        {
          type: 'command',
          command: path.join(devflowDir, 'scripts', 'hooks', 'run-hook') + ' session-start-orchestrator',
          timeout: 10,
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
 * Removes session-start-orchestrator from SessionStart.
 * Also removes stale SessionStart classification hook from previous installs.
 * Purges legacy COMMANDS_RULE_PATH if present (runs before early-return).
 * Idempotent — returns unchanged JSON if no ambient hooks were present.
 * Preserves other hooks. Cleans empty arrays/objects.
 */
export async function removeAmbientHook(settingsJson: string): Promise<string> {
  const settings: Settings = JSON.parse(settingsJson);
  const removedPrompt = filterHookEntries(settings, 'UserPromptSubmit', isAmbient);
  const removedOrchestrator = filterHookEntries(settings, 'SessionStart', isOrchestrator);
  // Clean up stale classification hooks from previous installs (no longer registered)
  const removedClassification = filterHookEntries(settings, 'SessionStart', isClassification);

  // Purge legacy commands rule (runs before early-return so stale files are always removed)
  await removeLegacyCommandsRule();

  if (!removedPrompt && !removedOrchestrator && !removedClassification) return settingsJson;
  return JSON.stringify(settings, null, 2) + '\n';
}

/**
 * Check if the ambient hook (legacy or current) is registered in settings JSON or parsed Settings object.
 * Preamble-authoritative: returns true iff the UserPromptSubmit preamble hook is present.
 * Orchestrator-only (without preamble) is broken partial state → treated as disabled.
 */
export function hasAmbientHook(input: string | Settings): boolean {
  const settings: Settings = typeof input === 'string' ? JSON.parse(input) : input;
  return settings.hooks?.UserPromptSubmit?.some((matcher) =>
    matcher.hooks.some((h) =>
      h.command.includes(PREAMBLE_HOOK_MARKER) || h.command.includes(LEGACY_HOOK_MARKER),
    ),
  ) ?? false;
}

/**
 * Check if the orchestrator SessionStart hook is present in settings JSON or parsed Settings object.
 */
function hasOrchestratorHook(input: string | Settings): boolean {
  const settings: Settings = typeof input === 'string' ? JSON.parse(input) : input;
  return settings.hooks?.SessionStart?.some((matcher) =>
    matcher.hooks.some((h) => h.command.includes(ORCHESTRATOR_HOOK_MARKER)),
  ) ?? false;
}

interface AmbientOptions {
  enable?: boolean;
  disable?: boolean;
  status?: boolean;
}

export const ambientCommand = new Command('ambient')
  .description('Enable or disable ambient mode (orchestrator charter + plan handoff)')
  .option('--enable', 'Register ambient mode hooks')
  .option('--disable', 'Remove ambient mode hooks')
  .option('--status', 'Check if ambient mode is enabled')
  .action(async (options: AmbientOptions) => {
    const hasFlag = options.enable || options.disable || options.status;
    if (!hasFlag) {
      p.intro(color.bgMagenta(color.white(' Ambient Mode ')));
      p.note(
        `${color.cyan('devflow ambient --enable')}   Register orchestrator hooks\n` +
        `${color.cyan('devflow ambient --disable')}  Remove orchestrator hooks\n` +
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
      if (enabled) {
        const hasOrchestrator = hasOrchestratorHook(settingsContent);
        if (!hasOrchestrator) {
          p.log.info(`Ambient mode: ${color.green('enabled')} ${color.dim('(partial — run devflow ambient --enable to repair)')}`);
        } else {
          p.log.info(`Ambient mode: ${color.green('enabled')}`);
        }
      } else {
        p.log.info(`Ambient mode: ${color.dim('disabled')}`);
      }
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
        // Both hooks already present — addAmbientHook purges any legacy rule anyway
        p.log.info('Ambient mode already enabled');
        return;
      }
      await writeFileAtomicExclusive(settingsPath, updated);
      await syncManifestFeature(getDevFlowDirectory(), 'ambient', true);
      p.log.success('Ambient mode enabled — orchestrator hooks registered');
      p.log.info(color.dim('Charter at session start, reminder per prompt, plan handoffs auto-run devflow:implement (git repos only)'));
    }

    if (options.disable) {
      const updated = await removeAmbientHook(settingsContent);
      if (updated === settingsContent) {
        p.log.info('Ambient mode already disabled');
        return;
      }
      await writeFileAtomicExclusive(settingsPath, updated);
      await syncManifestFeature(getDevFlowDirectory(), 'ambient', false);
      p.log.success('Ambient mode disabled — hooks removed');
    }
  });
