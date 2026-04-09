import { Command } from 'commander';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as p from '@clack/prompts';
import color from 'picocolors';
import { getClaudeDirectory, getDevFlowDirectory } from '../utils/paths.js';
import { createMemoryDir, migrateMemoryFiles } from '../utils/post-install.js';
import type { HookMatcher, Settings } from '../utils/hooks.js';

/**
 * Map of hook event type → filename marker for the 4 memory hooks.
 */
const MEMORY_HOOK_CONFIG: Record<string, string> = {
  UserPromptSubmit: 'prompt-capture-memory',
  Stop: 'stop-update-memory',
  SessionStart: 'session-start-memory',
  PreCompact: 'pre-compact-memory',
};

/**
 * Add all 4 memory hooks (UserPromptSubmit, Stop, SessionStart, PreCompact) to settings JSON.
 * Idempotent — skips hooks that already exist. Returns unchanged JSON if all 4 present.
 */
export function addMemoryHooks(settingsJson: string, devflowDir: string): string {
  const settings: Settings = JSON.parse(settingsJson);

  if (hasMemoryHooks(settingsJson)) {
    return settingsJson;
  }

  if (!settings.hooks) {
    settings.hooks = {};
  }

  for (const [hookType, marker] of Object.entries(MEMORY_HOOK_CONFIG)) {
    const existing = settings.hooks[hookType] ?? [];
    const alreadyPresent = existing.some((matcher) =>
      matcher.hooks.some((h) => h.command.includes(marker)),
    );

    if (!alreadyPresent) {
      const hookCommand = path.join(devflowDir, 'scripts', 'hooks', 'run-hook') + ` ${marker}`;
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
    }
  }

  return JSON.stringify(settings, null, 2) + '\n';
}

/**
 * Remove all memory hooks (UserPromptSubmit, Stop, SessionStart, PreCompact) from settings JSON.
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
 * Check if ALL 4 memory hooks are registered in settings JSON.
 */
export function hasMemoryHooks(settingsJson: string): boolean {
  return countMemoryHooks(settingsJson) === Object.keys(MEMORY_HOOK_CONFIG).length;
}

/**
 * Count how many of the 4 memory hooks are present (0-4).
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

interface MemoryOptions {
  enable?: boolean;
  disable?: boolean;
  status?: boolean;
}

export const memoryCommand = new Command('memory')
  .description('Enable or disable working memory (session context preservation)')
  .option('--enable', 'Add UserPromptSubmit/Stop/SessionStart/PreCompact hooks')
  .option('--disable', 'Remove memory hooks')
  .option('--status', 'Show current state')
  .action(async (options: MemoryOptions) => {
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
      const total = Object.keys(MEMORY_HOOK_CONFIG).length;
      if (count === total) {
        p.log.info(`Working memory: ${color.green('enabled')} (${total}/${total} hooks)`);
      } else if (count === 0) {
        p.log.info(`Working memory: ${color.dim('disabled')}`);
      } else {
        p.log.info(`Working memory: ${color.yellow(`partial (${count}/${total} hooks)`)} — run --enable to fix`);
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
      await createMemoryDir(false);
      await migrateMemoryFiles(true);
      p.log.success('Working memory enabled — UserPromptSubmit/Stop/SessionStart/PreCompact hooks registered');
      p.log.info(color.dim('Session context will be automatically preserved across conversations'));
    }

    if (options.disable) {
      const updated = removeMemoryHooks(settingsContent);
      if (updated === settingsContent) {
        p.log.info('Working memory already disabled');
        return;
      }
      await fs.writeFile(settingsPath, updated, 'utf-8');
      // Clean up ephemeral queue files
      const memoryDir = path.join(process.cwd(), '.memory');
      const queueDeleted = await fs.unlink(path.join(memoryDir, '.pending-turns.jsonl')).then(() => true).catch(() => false);
      const procDeleted = await fs.unlink(path.join(memoryDir, '.pending-turns.processing')).then(() => true).catch(() => false);
      if (queueDeleted || procDeleted) {
        p.log.info(color.dim('Cleaned up pending queue files'));
      }
      p.log.success('Working memory disabled — hooks removed');
    }
  });
