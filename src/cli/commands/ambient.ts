import { Command } from 'commander';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as p from '@clack/prompts';
import color from 'picocolors';
import { getClaudeDirectory, getDevFlowDirectory } from '../../targets/claude-code/claude-paths.js';
import { syncManifestFeature } from '../../core/manifest.js';
import { writeFileAtomicExclusive } from '../../core/fs-atomic.js';
import type { HookEntry, HookMatcher, Settings } from '../../targets/claude-code/hooks.js';

const PREAMBLE_HOOK_MARKER = 'preamble';
/** SessionStart orchestrator charter hook — presence-gated by ambient toggle */
const ORCHESTRATOR_HOOK_MARKER = 'session-start-orchestrator';

/** The directory, relative to a devflow root, that holds every hook devflow registers. */
const HOOKS_DIR_SUFFIX = '/scripts/hooks/';

/** The command ending devflow writes for a `run-hook <marker>` hook. */
function runHookSuffix(marker: string): string {
  return `${HOOKS_DIR_SUFFIX}run-hook ${marker}`;
}

/**
 * The command endings of each ambient hook devflow has ever registered.
 *
 * D-AMBIENT-EXACT-HOOK: a hook is devflow's when its command ENDS in one of these,
 * under any directory — so installs made under a custom or repo-local devflow
 * directory are still recognised — and never because it merely contains a marker
 * word: a user's `~/bin/preamble-logger.sh` or `echo preamble` is theirs (applies
 * ADR-024). The legacy forms are the pre-preamble `ambient-prompt` hook (first a
 * bare `ambient-prompt.sh`, then through `run-hook`) and the retired
 * `session-start-classification` hook, both still swept on enable and disable.
 */
const AMBIENT_HOOK_SUFFIXES = {
  preamble: [runHookSuffix(PREAMBLE_HOOK_MARKER)],
  legacyPrompt: [runHookSuffix('ambient-prompt'), `${HOOKS_DIR_SUFFIX}ambient-prompt.sh`],
  classification: [runHookSuffix('session-start-classification')],
  orchestrator: [runHookSuffix(ORCHESTRATOR_HOOK_MARKER)],
} as const satisfies Record<string, readonly string[]>;

/** A predicate over one hook entry of a matcher group. */
type HookPredicate = (hook: HookEntry) => boolean;

/** A predicate matching a hook whose command ends in any of `suffixes` (backslashes read as slashes). */
function endsWithAny(suffixes: readonly string[]): HookPredicate {
  return (hook) => {
    const command = (hook.command ?? '').trim().replace(/\\/g, '/');
    return suffixes.some((suffix) => command.endsWith(suffix));
  };
}

const isPreamble = endsWithAny(AMBIENT_HOOK_SUFFIXES.preamble);
const isLegacy = endsWithAny(AMBIENT_HOOK_SUFFIXES.legacyPrompt);
const isAmbient = endsWithAny([...AMBIENT_HOOK_SUFFIXES.preamble, ...AMBIENT_HOOK_SUFFIXES.legacyPrompt]);
const isClassification = endsWithAny(AMBIENT_HOOK_SUFFIXES.classification);
const isOrchestrator = endsWithAny(AMBIENT_HOOK_SUFFIXES.orchestrator);

/**
 * Path where the legacy commands rule was installed.
 * The commands rule was removed — this path now exists only to purge the
 * legacy file from prior installs. Managed by ambient.ts directly (not the
 * plugin rules system), so only ambient enable/disable/init paths clean it up.
 * Resolved under the Claude Code directory (D-CLAUDE-CONFIG-DIR), where the
 * legacy install wrote it.
 */
export const COMMANDS_RULE_PATH = path.join(getClaudeDirectory(), 'rules', 'devflow', 'commands.md');

/**
 * Remove every hook matching `shouldRemove` from one event's matcher groups.
 * Returns true if any hook was removed.
 *
 * D-AMBIENT-EXACT-HOOK: removal is per HOOK, not per matcher group — a group
 * keeps the user's sibling hooks and is dropped only when nothing is left in it.
 * Empty event arrays and an empty `hooks` object are cleaned up.
 */
function filterHookEntries(
  settings: Settings,
  eventName: string,
  shouldRemove: HookPredicate,
): boolean {
  const matchers = settings.hooks?.[eventName];
  if (!settings.hooks || !matchers) return false;

  let removed = false;
  const kept: HookMatcher[] = [];
  for (const matcher of matchers) {
    const remaining = matcher.hooks.filter((hook) => !shouldRemove(hook));
    if (remaining.length === matcher.hooks.length) {
      kept.push(matcher);
      continue;
    }
    removed = true;
    if (remaining.length > 0) kept.push({ ...matcher, hooks: remaining });
  }
  if (!removed) return false;

  if (kept.length === 0) {
    delete settings.hooks[eventName];
  } else {
    settings.hooks[eventName] = kept;
  }
  if (Object.keys(settings.hooks).length === 0) {
    delete settings.hooks;
  }
  return true;
}

/** Whether any hook registered for `eventName` matches `isOurs`. */
function hasHook(settings: Settings, eventName: string, isOurs: HookPredicate): boolean {
  return settings.hooks?.[eventName]?.some((m) => m.hooks.some(isOurs)) ?? false;
}

/** Add a hook entry for an event unless a matching hook is already registered. Returns true when an entry was added. */
function ensureHook(settings: Settings, eventName: string, isOurs: HookPredicate, entry: HookMatcher): boolean {
  if (hasHook(settings, eventName, isOurs)) {
    return false;
  }
  settings.hooks ??= {};
  settings.hooks[eventName] ??= [];
  settings.hooks[eventName].push(entry);
  return true;
}

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

/** The command devflow registers for the `run-hook <marker>` hook under `devflowDir`. */
function runHookCommand(devflowDir: string, marker: string): string {
  return `${path.join(devflowDir, 'scripts', 'hooks', 'run-hook')} ${marker}`;
}

/**
 * A predicate matching devflow's own hook (`isOurs`) registered with any command
 * other than `canonical` — i.e. under a directory other than the one `canonical` names.
 */
function isMisdirected(isOurs: HookPredicate, canonical: string): HookPredicate {
  return (hook) => isOurs(hook) && (hook.command ?? '').trim() !== canonical;
}

/**
 * Add the ambient hooks (preamble UserPromptSubmit + session-start-orchestrator SessionStart)
 * and remove any legacy commands rule. Removes any legacy `ambient-prompt` hook first.
 * Idempotent — each hook is checked before adding so enable repairs partial states.
 * Legacy rule purge runs unconditionally to ensure stale files are always cleaned up.
 *
 * D-AMBIENT-CANONICAL-DIR: enable converges on `devflowDir`. A preamble or
 * orchestrator hook devflow registered under another directory (an earlier enable
 * that inferred its directory from a user's Stop hook, or a retired custom
 * directory) is removed and the hook re-registered at `devflowDir`. Only hooks
 * matched exactly (D-AMBIENT-EXACT-HOOK) are touched, one hook at a time, so the
 * user's hooks and their matcher-group siblings keep their places.
 */
export async function addAmbientHook(settingsJson: string, devflowDir: string): Promise<string> {
  const settings: Settings = JSON.parse(settingsJson);
  const preambleCommand = runHookCommand(devflowDir, PREAMBLE_HOOK_MARKER);
  const orchestratorCommand = runHookCommand(devflowDir, ORCHESTRATOR_HOOK_MARKER);

  const removedLegacy = filterHookEntries(settings, 'UserPromptSubmit', isLegacy);
  // Sweep stale classification hook from prior installs — symmetric with removeAmbientHook
  const removedClassification = filterHookEntries(settings, 'SessionStart', isClassification);
  const removedMisdirected = [
    filterHookEntries(settings, 'UserPromptSubmit', isMisdirected(isPreamble, preambleCommand)),
    filterHookEntries(settings, 'SessionStart', isMisdirected(isOrchestrator, orchestratorCommand)),
  ].some(Boolean);
  const addedPreamble = ensureHook(
    settings, 'UserPromptSubmit', isPreamble,
    { hooks: [{ type: 'command', command: preambleCommand, timeout: 5 }] },
  );
  const addedOrchestrator = ensureHook(
    settings, 'SessionStart', isOrchestrator,
    { hooks: [{ type: 'command', command: orchestratorCommand, timeout: 10 }] },
  );

  // Purge legacy commands rule (runs before early-return so stale files are always removed)
  await removeLegacyCommandsRule();

  if (!removedLegacy && !removedClassification && !removedMisdirected && !addedPreamble && !addedOrchestrator) {
    return settingsJson;
  }
  return JSON.stringify(settings, null, 2) + '\n';
}

/**
 * Remove the ambient hooks from settings JSON and purge any legacy commands rule.
 * Removes preamble + legacy from UserPromptSubmit.
 * Removes session-start-orchestrator from SessionStart.
 * Also removes stale SessionStart classification hook from previous installs.
 * Purges legacy COMMANDS_RULE_PATH if present (runs before early-return), unless
 * `options.purgeLegacyRule` is false — a legacy repo-local uninstall edits a repo's
 * settings and must not touch the user's Claude directory (D-LEGACY-LOCAL-CLEANUP).
 * Idempotent — returns unchanged JSON if no ambient hooks were present.
 * Preserves other hooks. Cleans empty arrays/objects.
 */
export async function removeAmbientHook(
  settingsJson: string,
  options: { purgeLegacyRule?: boolean } = {},
): Promise<string> {
  const settings: Settings = JSON.parse(settingsJson);
  const removedPrompt = filterHookEntries(settings, 'UserPromptSubmit', isAmbient);
  const removedOrchestrator = filterHookEntries(settings, 'SessionStart', isOrchestrator);
  // Clean up stale classification hooks from previous installs (no longer registered)
  const removedClassification = filterHookEntries(settings, 'SessionStart', isClassification);

  // Purge legacy commands rule (runs before early-return so stale files are always removed)
  if (options.purgeLegacyRule !== false) await removeLegacyCommandsRule();

  if (!removedPrompt && !removedOrchestrator && !removedClassification) return settingsJson;
  return JSON.stringify(settings, null, 2) + '\n';
}

/**
 * Converge the ambient hooks in a settings JSON string to `enabled`.
 *
 * The one ambient transform `devflow init` applies inside its single settings
 * read-modify-write pass: always remove-then-add, which upgrades a legacy
 * `ambient-prompt` hook and re-points devflow's hooks at `devflowDir`. Both halves
 * match hooks exactly (D-AMBIENT-EXACT-HOOK), so a user's own hooks — and their
 * siblings in a shared matcher group — come through byte-identical.
 */
export async function convergeAmbientHooks(settingsJson: string, enabled: boolean, devflowDir: string): Promise<string> {
  const cleaned = await removeAmbientHook(settingsJson);
  return enabled ? addAmbientHook(cleaned, devflowDir) : cleaned;
}

/**
 * Check if the ambient hook (legacy or current) is registered in settings JSON or parsed Settings object.
 * Preamble-authoritative: returns true iff the UserPromptSubmit preamble hook is present.
 * Orchestrator-only (without preamble) is broken partial state → treated as disabled.
 */
export function hasAmbientHook(input: string | Settings): boolean {
  const settings: Settings = typeof input === 'string' ? JSON.parse(input) : input;
  return hasHook(settings, 'UserPromptSubmit', isAmbient);
}

/**
 * Check if the orchestrator SessionStart hook is present in settings JSON or parsed Settings object.
 */
function hasOrchestratorHook(input: string | Settings): boolean {
  const settings: Settings = typeof input === 'string' ? JSON.parse(input) : input;
  return hasHook(settings, 'SessionStart', isOrchestrator);
}

interface AmbientOptions {
  enable?: boolean;
  disable?: boolean;
  status?: boolean;
}

/**
 * Build a fresh Commander Command for the `ambient` subcommand.
 * Exported for tests that need per-test isolation (Commander keeps parsed option
 * values on the instance, so a reused command leaks options between runs).
 */
export function createAmbientCommand(): Command {
  return new Command('ambient')
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

    // Parse settings once, guarded against corrupt files.
    // hasAmbientHook / hasOrchestratorHook accept Settings directly to avoid re-parsing.
    let parsedSettings: Settings;
    try {
      parsedSettings = JSON.parse(settingsContent) as Settings;
    } catch (err) {
      p.log.error(`Could not parse settings.json: ${(err as Error).message}`);
      return;
    }

    if (options.status) {
      const enabled = hasAmbientHook(parsedSettings);
      const hasOrchestrator = hasOrchestratorHook(parsedSettings);
      const repairHint = enabled !== hasOrchestrator
        ? ` ${color.dim('(partial — run devflow ambient --enable to repair)')}`
        : '';
      if (enabled) {
        p.log.info(`Ambient mode: ${color.green('enabled')}${repairHint}`);
      } else {
        p.log.info(`Ambient mode: ${color.dim('disabled')}${repairHint}`);
      }
      return;
    }

    // D-AMBIENT-CANONICAL-DIR: the hooks always point at the canonical devflow
    // directory, where init installs run-hook. Never infer it from settings.json:
    // the first Stop hook is whichever hook the user listed first (a notification
    // sound, say), and a path derived from it names a run-hook that does not
    // exist, so every prompt would fail.
    const devflowDir = getDevFlowDirectory();

    if (options.enable) {
      const updated = await addAmbientHook(settingsContent, devflowDir);
      if (updated === settingsContent) {
        // Both hooks already present — addAmbientHook purges any legacy rule anyway
        p.log.info('Ambient mode already enabled');
        return;
      }
      await writeFileAtomicExclusive(settingsPath, updated);
      await syncManifestFeature(devflowDir, 'ambient', true);
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
      await syncManifestFeature(devflowDir, 'ambient', false);
      p.log.success('Ambient mode disabled — hooks removed');
    }
  });
}

export const ambientCommand = createAmbientCommand();
