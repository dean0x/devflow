import { Command } from 'commander';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as p from '@clack/prompts';
import color from 'picocolors';
import { getClaudeDirectory, getDevFlowDirectory } from '../utils/paths.js';

/**
 * The hook entry structure used by Claude Code settings.json.
 */
interface HookEntry {
  type: string;
  command: string;
  timeout?: number;
}

interface HookMatcher {
  hooks: HookEntry[];
}

interface Settings {
  hooks?: Record<string, HookMatcher[]>;
  [key: string]: unknown;
}

/**
 * Map of hook event type → filename marker for the 3 memory hooks.
 */
const MEMORY_HOOK_CONFIG: Record<string, string> = {
  Stop: 'stop-update-memory.sh',
  SessionStart: 'session-start-memory.sh',
  PreCompact: 'pre-compact-memory.sh',
};

/**
 * Add all 3 memory hooks (Stop, SessionStart, PreCompact) to settings JSON.
 * Idempotent — skips hooks that already exist. Returns unchanged JSON if all 3 present.
 */
export function addMemoryHooks(settingsJson: string, devflowDir: string): string {
  const settings: Settings = JSON.parse(settingsJson);

  if (hasMemoryHooks(settingsJson)) {
    return settingsJson;
  }

  if (!settings.hooks) {
    settings.hooks = {};
  }

  let changed = false;

  for (const [hookType, marker] of Object.entries(MEMORY_HOOK_CONFIG)) {
    const existing = settings.hooks[hookType] ?? [];
    const alreadyPresent = existing.some((matcher) =>
      matcher.hooks.some((h) => h.command.includes(marker)),
    );

    if (!alreadyPresent) {
      const hookCommand = path.join(devflowDir, 'scripts', 'hooks', marker);
      const newEntry: HookMatcher = {
        hooks: [
          {
            type: 'command',
            command: hookCommand,
            timeout: 10,
          },
        ],
      };

      if (!settings.hooks[hookType]) {
        settings.hooks[hookType] = [];
      }

      settings.hooks[hookType].push(newEntry);
      changed = true;
    }
  }

  if (!changed) {
    return settingsJson;
  }

  return JSON.stringify(settings, null, 2) + '\n';
}

/**
 * Remove all memory hooks (Stop, SessionStart, PreCompact) from settings JSON.
 * Idempotent — returns unchanged JSON if no memory hooks present.
 * Preserves non-memory hooks. Cleans empty arrays/objects.
 */
export function removeMemoryHooks(settingsJson: string): string {
  const settings: Settings = JSON.parse(settingsJson);

  if (!settings.hooks) {
    return settingsJson;
  }

  let changed = false;

  for (const [hookType, marker] of Object.entries(MEMORY_HOOK_CONFIG)) {
    if (!settings.hooks[hookType]) {
      continue;
    }

    const before = settings.hooks[hookType].length;
    settings.hooks[hookType] = settings.hooks[hookType].filter(
      (matcher) => !matcher.hooks.some((h) => h.command.includes(marker)),
    );

    if (settings.hooks[hookType].length !== before) {
      changed = true;
    }

    if (settings.hooks[hookType].length === 0) {
      delete settings.hooks[hookType];
    }
  }

  if (settings.hooks && Object.keys(settings.hooks).length === 0) {
    delete settings.hooks;
  }

  if (!changed) {
    return settingsJson;
  }

  return JSON.stringify(settings, null, 2) + '\n';
}

/**
 * Check if ALL 3 memory hooks are registered in settings JSON.
 */
export function hasMemoryHooks(settingsJson: string): boolean {
  return countMemoryHooks(settingsJson) === 3;
}

/**
 * Count how many of the 3 memory hooks are present (0-3).
 */
export function countMemoryHooks(settingsJson: string): number {
  const settings: Settings = JSON.parse(settingsJson);

  if (!settings.hooks) {
    return 0;
  }

  let count = 0;

  for (const [hookType, marker] of Object.entries(MEMORY_HOOK_CONFIG)) {
    const matchers = settings.hooks[hookType] ?? [];
    if (matchers.some((matcher) => matcher.hooks.some((h) => h.command.includes(marker)))) {
      count++;
    }
  }

  return count;
}

export const memoryCommand = new Command('memory')
  .description('Enable or disable working memory (session context preservation)')
  .option('--enable', 'Add Stop/SessionStart/PreCompact hooks')
  .option('--disable', 'Remove memory hooks')
  .option('--status', 'Show current state')
  .action(async (options) => {
    const hasFlag = options.enable || options.disable || options.status;
    if (!hasFlag) {
      p.intro(color.bgCyan(color.white(' Working Memory ')));
      p.note(
        `${color.cyan('devflow memory --enable')}   Add memory hooks\n` +
        `${color.cyan('devflow memory --disable')}  Remove memory hooks\n` +
        `${color.cyan('devflow memory --status')}   Check current state`,
        'Usage',
      );
      p.outro(color.dim('Memory hooks provide automatic session context preservation'));
      return;
    }

    const claudeDir = getClaudeDirectory();
    const settingsPath = path.join(claudeDir, 'settings.json');

    let settingsContent: string;
    try {
      settingsContent = await fs.readFile(settingsPath, 'utf-8');
    } catch {
      if (options.status) {
        p.log.info('Working memory: disabled (no settings.json found)');
        return;
      }
      // Create minimal settings.json
      settingsContent = '{}';
    }

    if (options.status) {
      const count = countMemoryHooks(settingsContent);
      if (count === 3) {
        p.log.info(`Working memory: ${color.green('enabled')} (3/3 hooks)`);
      } else if (count === 0) {
        p.log.info(`Working memory: ${color.dim('disabled')}`);
      } else {
        p.log.info(`Working memory: ${color.yellow(`partial (${count}/3 hooks)`)} — run --enable to fix`);
      }
      return;
    }

    const devflowDir = getDevFlowDirectory();

    if (options.enable) {
      const updated = addMemoryHooks(settingsContent, devflowDir);
      if (updated === settingsContent) {
        p.log.info('Working memory already enabled');
        return;
      }
      await fs.writeFile(settingsPath, updated, 'utf-8');
      p.log.success('Working memory enabled — Stop/SessionStart/PreCompact hooks registered');
      p.log.info(color.dim('Session context will be automatically preserved across conversations'));
    }

    if (options.disable) {
      const updated = removeMemoryHooks(settingsContent);
      if (updated === settingsContent) {
        p.log.info('Working memory already disabled');
        return;
      }
      await fs.writeFile(settingsPath, updated, 'utf-8');
      p.log.success('Working memory disabled — hooks removed');
    }
  });
