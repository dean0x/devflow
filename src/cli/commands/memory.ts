import { Command } from 'commander';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as p from '@clack/prompts';
import color from 'picocolors';
import { getClaudeDirectory, getDevFlowDirectory } from '../utils/paths.js';
import { discoverProjectGitRoots } from '../utils/post-install.js';
import { getGitRoot } from '../utils/git.js';
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

  if (hasMemoryHooks(settings)) {
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
 * Accepts either a JSON string or a parsed Settings object (consistent with hasMemoryHooks/countMemoryHooks).
 * Idempotent — returns unchanged JSON if no memory hooks present.
 * Preserves non-memory hooks. Cleans empty arrays/objects.
 */
export function removeMemoryHooks(input: string | Settings): string {
  const settingsJson = typeof input === 'string' ? input : JSON.stringify(input);
  const settings: Settings = typeof input === 'string' ? JSON.parse(input) : structuredClone(input);

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
 * Check if ALL 4 memory hooks are registered in settings JSON or parsed Settings object.
 */
export function hasMemoryHooks(input: string | Settings): boolean {
  return countMemoryHooks(input) === Object.keys(MEMORY_HOOK_CONFIG).length;
}

/**
 * Count how many of the 4 memory hooks are present (0-4).
 * Accepts either a JSON string or a parsed Settings object.
 */
export function countMemoryHooks(input: string | Settings): number {
  const settings: Settings = typeof input === 'string' ? JSON.parse(input) : input;

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
  clear?: boolean;
}

/**
 * Returns true if the given project root contains a `.memory/` directory.
 * Treats unexpected errors (e.g. EACCES) as absent to avoid false positives.
 */
export async function hasMemoryDir(root: string): Promise<boolean> {
  try {
    await fs.access(path.join(root, '.memory'));
    return true;
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      return false;
    }
    // Unexpected error (e.g. EACCES) — log and treat as absent to avoid false positives
    console.warn(`[memory] Unexpected error checking .memory/ in ${root}: ${(err as Error).message}`);
    return false;
  }
}

/**
 * Filters the provided git root paths to those that contain a `.memory/` directory.
 */
export async function filterProjectsWithMemory(gitRoots: string[]): Promise<string[]> {
  const checks = await Promise.all(gitRoots.map(async (root) => ({ root, has: await hasMemoryDir(root) })));
  return checks.filter((c) => c.has).map((c) => c.root);
}

/**
 * Clean up memory queue files from the given project paths.
 * Skips projects where the background updater lock is held to avoid data loss.
 * Returns the count of projects from which at least one file was removed.
 */
export async function cleanQueueFiles(projectPaths: string[]): Promise<{ cleaned: number; projects: string[] }> {
  const results = await Promise.all(
    projectPaths.map(async (project) => {
      const memDir = path.join(project, '.memory');
      const lockDir = path.join(memDir, '.working-memory.lock');
      try {
        await fs.access(lockDir);
        // Lock directory exists — background updater is active; skip to avoid data loss
        return null;
      } catch {
        // No lock — safe to proceed
      }
      const [q, pr] = await Promise.all([
        fs.unlink(path.join(memDir, '.pending-turns.jsonl')).then(() => true).catch(() => false),
        fs.unlink(path.join(memDir, '.pending-turns.processing')).then(() => true).catch(() => false),
      ]);
      return (q || pr) ? project : null;
    }),
  );
  const cleanedProjects = results.filter((p): p is string => p !== null);
  return { cleaned: cleanedProjects.length, projects: cleanedProjects };
}

export const memoryCommand = new Command('memory')
  .description('Enable, disable, or clean up working memory (session context preservation)')
  .option('--enable', 'Add UserPromptSubmit/Stop/SessionStart/PreCompact hooks')
  .option('--disable', 'Remove memory hooks')
  .option('--status', 'Show current state')
  .option('--clear', 'Clean up queue files from projects')
  .action(async (options: MemoryOptions) => {
    const hasFlag = options.enable || options.disable || options.status || options.clear;
    if (!hasFlag) {
      p.intro(color.bgCyan(color.white(' Working Memory ')));
      p.note(
        `${color.cyan('devflow memory --enable')}   Add memory hooks\n` +
        `${color.cyan('devflow memory --disable')}  Remove memory hooks\n` +
        `${color.cyan('devflow memory --status')}   Check current state\n` +
        `${color.cyan('devflow memory --clear')}    Clean up queue files`,
        'Usage',
      );
      p.outro(color.dim('Memory hooks provide automatic session context preservation'));
      return;
    }

    if (options.clear) {
      p.intro(color.bgCyan(color.white(' Memory Cleanup ')));

      // Discover current project and all known projects in parallel
      const [gitRoots, gitRoot] = await Promise.all([discoverProjectGitRoots(), getGitRoot()]);
      const [projectsWithMemory, currentProjectHasMem] = await Promise.all([
        filterProjectsWithMemory(gitRoots),
        gitRoot ? hasMemoryDir(gitRoot) : Promise.resolve(false),
      ]);

      const currentProject = gitRoot && currentProjectHasMem ? gitRoot : null;

      // Add current project if not already in list
      const allProjects = currentProject && !projectsWithMemory.includes(currentProject)
        ? [currentProject, ...projectsWithMemory]
        : projectsWithMemory;

      if (allProjects.length === 0) {
        p.log.info('No projects with .memory/ found');
        return;
      }

      let targets: string[];
      if (!process.stdin.isTTY) {
        // Non-interactive: clean all projects without prompting
        p.log.info('Non-interactive mode detected, cleaning all projects');
        targets = allProjects;
      } else {
        const scope = await p.select({
          message: 'Clean up queue files from:',
          options: [
            ...(currentProject ? [{ value: 'local' as const, label: `Current project (${currentProject})` }] : []),
            {
              value: 'all' as const,
              label: `All projects (${allProjects.length} found)`,
              hint: allProjects.map(proj => path.basename(proj)).join(', '),
            },
          ],
        });

        if (p.isCancel(scope)) {
          p.cancel('Cancelled');
          return;
        }

        targets = scope === 'local' && currentProject ? [currentProject] : allProjects;
      }

      const { cleaned, projects: cleanedProjects } = await cleanQueueFiles(targets);
      for (const project of cleanedProjects) {
        p.log.info(color.dim(`Cleaned: ${project}`));
      }
      p.log.success(cleaned > 0
        ? `Cleaned queue files from ${cleaned} project${cleaned > 1 ? 's' : ''}`
        : 'No queue files found to clean');
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
      if (hasMemoryHooks(settingsContent)) {
        p.log.info('Working memory already enabled');
        return;
      }
      const updated = addMemoryHooks(settingsContent, devflowDir);
      await fs.writeFile(settingsPath, updated, 'utf-8');
      p.log.success('Working memory enabled — UserPromptSubmit/Stop/SessionStart/PreCompact hooks registered');
      p.log.info(color.dim('Session context will be automatically preserved across conversations'));
    }

    if (options.disable) {
      if (countMemoryHooks(settingsContent) === 0) {
        p.log.info('Working memory already disabled');
        return;
      }
      const updated = removeMemoryHooks(settingsContent);
      await fs.writeFile(settingsPath, updated, 'utf-8');
      p.log.success('Working memory disabled — hooks removed');
      p.log.info(color.dim('Run devflow memory --clear to clean up queue files'));
    }
  });
