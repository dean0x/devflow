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
 * Path where the commands rule is installed.
 * Managed by ambient.ts directly — NOT by the rules plugin system.
 */
export const COMMANDS_RULE_PATH = path.join(os.homedir(), '.claude', 'rules', 'devflow', 'commands.md');

/**
 * D1: Content of the commands awareness rule.
 * Installed to COMMANDS_RULE_PATH when ambient mode is enabled.
 * The `paths: []` frontmatter signals Claude Code to apply this rule globally.
 */
export const COMMANDS_RULE_CONTENT = `---
name: commands
description: Available devflow workflow commands and plan auto-execution
paths: []
---

# Devflow Workflow Commands

Use \`/devflow:<name>\` to trigger a workflow:

- \`plan\` — Design implementation plans with gap analysis and design review
- \`implement\` — Execute tasks through implementation, quality gates, and PR creation
- \`code-review\` — Branch review with specialized parallel reviewers
- \`resolve\` — Process review/analysis issues — validate, fix, or defer
- \`debug\` — Competing hypothesis investigation with parallel agents
- \`explore\` — Codebase exploration with structured analysis
- \`research\` — Multi-type research with trust-aware synthesis
- \`release\` — Adaptive release with learned configuration
- \`self-review\` — Simplifier (code clarity) then Scrutinizer (9-pillar quality)
- \`bug-analysis\` — Proactive bug finding in changed code

## Plan Auto-Execution

When a prompt is a structured implementation plan (contains \`## Goal\`, \`## Steps\`,
and \`## Files\` sections), this is a plan handoff from a prior planning session.
Invoke \`devflow:implement\` via the Skill tool to execute it.
`;

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
 * Install the commands awareness rule file.
 * Idempotent — always overwrites with current content.
 */
export async function installCommandsRule(): Promise<void> {
  await fs.mkdir(path.dirname(COMMANDS_RULE_PATH), { recursive: true });
  await fs.writeFile(COMMANDS_RULE_PATH, COMMANDS_RULE_CONTENT, 'utf-8');
}

/**
 * Remove the commands awareness rule file.
 * Idempotent — no-op if the file does not exist.
 * Only swallows ENOENT; other errors (e.g. EACCES) propagate.
 */
export async function removeCommandsRule(): Promise<void> {
  try {
    await fs.unlink(COMMANDS_RULE_PATH);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
}

/**
 * Add the ambient UserPromptSubmit hook and write the commands awareness rule.
 * Removes any legacy `ambient-prompt` hook first, then adds the new `preamble` hook.
 * Writes COMMANDS_RULE_CONTENT to COMMANDS_RULE_PATH for passive command awareness.
 * Idempotent — hook checked before adding, rule always overwritten.
 */
export async function addAmbientHook(settingsJson: string, devflowDir: string): Promise<string> {
  const settings: Settings = JSON.parse(settingsJson);
  let changed = filterHookEntries(settings, 'UserPromptSubmit', isLegacy);

  if (!settings.hooks) {
    settings.hooks = {};
  }

  // --- UserPromptSubmit: preamble hook (plan detection) ---
  const hasPreamble = settings.hooks.UserPromptSubmit?.some((m) =>
    m.hooks.some((h) => h.command.includes(PREAMBLE_HOOK_MARKER)),
  );

  if (!hasPreamble) {
    if (!settings.hooks.UserPromptSubmit) {
      settings.hooks.UserPromptSubmit = [];
    }

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

  // --- Write commands awareness rule ---
  await installCommandsRule();

  if (!changed) return settingsJson;
  return JSON.stringify(settings, null, 2) + '\n';
}

/**
 * Remove the ambient hooks from settings JSON and delete the commands rule.
 * Removes preamble + legacy from UserPromptSubmit.
 * Also removes stale SessionStart classification hook from previous installs.
 * Deletes COMMANDS_RULE_PATH if present.
 * Idempotent — returns unchanged JSON if neither prompt hook nor stale classification was present.
 * Preserves other hooks. Cleans empty arrays/objects.
 */
export async function removeAmbientHook(settingsJson: string): Promise<string> {
  const settings: Settings = JSON.parse(settingsJson);
  const removedPrompt = filterHookEntries(settings, 'UserPromptSubmit', isAmbient);
  // Clean up stale classification hooks from previous installs (no longer registered)
  const removedClassification = filterHookEntries(settings, 'SessionStart', isClassification);

  // Delete commands rule if it exists
  await removeCommandsRule();

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
  .description('Enable or disable ambient mode (plan auto-detection and command awareness)')
  .option('--enable', 'Register ambient mode hooks and install commands rule')
  .option('--disable', 'Remove ambient mode hooks and uninstall commands rule')
  .option('--status', 'Check if ambient mode is enabled')
  .action(async (options: AmbientOptions) => {
    const hasFlag = options.enable || options.disable || options.status;
    if (!hasFlag) {
      p.intro(color.bgMagenta(color.white(' Ambient Mode ')));
      p.note(
        `${color.cyan('devflow ambient --enable')}   Register plan detection hook\n` +
        `${color.cyan('devflow ambient --disable')}  Remove plan detection hook\n` +
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
        // Hook already exists but rule may still need writing — addAmbientHook writes it anyway
        p.log.info('Ambient mode already enabled');
        return;
      }
      await fs.writeFile(settingsPath, updated, 'utf-8');
      p.log.success('Ambient mode enabled — plan detection hook registered');
      p.log.info(color.dim('Structured plans auto-execute; command listing available as a rule'));
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
