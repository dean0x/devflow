import { Command } from 'commander';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as p from '@clack/prompts';
import color from 'picocolors';
import { getClaudeDirectory, getDevFlowDirectory } from '../utils/paths.js';
import { discoverProjectGitRoots } from '../utils/post-install.js';
import { getGitRoot } from '../utils/git.js';
import {
  getMemoryDir,
  getPendingTurnsPath,
  getPendingTurnsProcessingPath,
} from '../utils/project-paths.js';
import type { HookMatcher, Settings } from '../utils/hooks.js';
import { updateFeature, isFeatureEnabled } from '../utils/dream-config.js';

/**
 * Map of hook event type → filename marker for the dream hooks.
 * Five hooks total: UserPromptSubmit, Stop, SessionEnd, SessionStart, PreCompact.
 */
const MEMORY_HOOK_CONFIG: Record<string, string> = {
  UserPromptSubmit: 'dream-dispatch',
  Stop: 'dream-capture',
  SessionEnd: 'dream-evaluate',
  SessionStart: 'session-start-memory',
  PreCompact: 'pre-compact-memory',
};

/**
 * Legacy hook filename markers from the pre-sidecar 8-hook system and the v3 sidecar→dream rename.
 * Used by removeMemoryHooks to clean up hooks from upgrading users.
 */
const LEGACY_HOOK_MARKERS: Record<string, string[]> = {
  UserPromptSubmit: ['prompt-capture-memory', 'sidecar-dispatch'],
  Stop: ['stop-update-memory', 'stop-update-learning', 'sidecar-capture'],
  SessionEnd: ['session-end-learning', 'session-end-decisions', 'session-end-knowledge-refresh', 'sidecar-evaluate'],
};

/**
 * Add all 5 memory hooks (UserPromptSubmit, Stop, SessionEnd, SessionStart, PreCompact) to settings JSON.
 * Idempotent — skips hooks that already exist. Returns unchanged JSON if all 5 present.
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
 * Remove all memory hooks (UserPromptSubmit, Stop, SessionEnd, SessionStart, PreCompact) from settings JSON.
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

  // Remove legacy pre-dream hooks from upgrading users
  for (const [hookType, markers] of Object.entries(LEGACY_HOOK_MARKERS)) {
    if (!settings.hooks[hookType]) continue;
    const before = settings.hooks[hookType].length;
    settings.hooks[hookType] = settings.hooks[hookType].filter(
      (matcher) => !matcher.hooks.some((h) => markers.some((m) => h.command.includes(m))),
    );
    if (settings.hooks[hookType].length !== before) changed = true;
    if (settings.hooks[hookType].length === 0) delete settings.hooks[hookType];
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
 * Check if ALL 5 memory hooks are registered in settings JSON or parsed Settings object.
 */
export function hasMemoryHooks(input: string | Settings): boolean {
  return countMemoryHooks(input) === Object.keys(MEMORY_HOOK_CONFIG).length;
}

/**
 * Count how many of the 5 memory hooks are present (0-5).
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
 * Returns true if the given project root contains a `.devflow/memory/` directory.
 * Treats unexpected errors (e.g. EACCES) as absent to avoid false positives.
 */
export async function hasMemoryDir(root: string): Promise<boolean> {
  try {
    await fs.access(getMemoryDir(root));
    return true;
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      return false;
    }
    // Unexpected error (e.g. EACCES) — log and treat as absent to avoid false positives
    console.warn(`[memory] Unexpected error checking .devflow/memory/ in ${root}: ${(err as Error).message}`);
    return false;
  }
}

/**
 * Filters the provided git root paths to those that contain a `.devflow/memory/` directory.
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
      const memDir = getMemoryDir(project);
      const lockDir = path.join(memDir, '.working-memory.lock');
      try {
        await fs.access(lockDir);
        // Lock directory exists — background updater is active; skip to avoid data loss
        return null;
      } catch {
        // No lock — safe to proceed
      }
      const [q, pr] = await Promise.all([
        fs.unlink(getPendingTurnsPath(project)).then(() => true).catch(() => false),
        fs.unlink(getPendingTurnsProcessingPath(project)).then(() => true).catch(() => false),
      ]);
      return (q || pr) ? project : null;
    }),
  );
  const cleanedProjects = results.filter((p): p is string => p !== null);
  return { cleaned: cleanedProjects.length, projects: cleanedProjects };
}

export const memoryCommand = new Command('memory')
  .description('Enable, disable, or clean up working memory (session context preservation)')
  .option('--enable', 'Enable working memory')
  .option('--disable', 'Disable working memory')
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
        p.log.info('No projects with .devflow/memory/ found');
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

    // Resolve current project root for dream config
    const gitRoot = await getGitRoot();

    if (options.status) {
      if (!gitRoot) {
        p.log.info(`Working memory: ${color.dim('disabled')} (not in a git project)`);
        return;
      }
      const count = countMemoryHooks(settingsContent);
      const total = Object.keys(MEMORY_HOOK_CONFIG).length;
      // Also check dream config: hooks may be registered but feature toggled off
      const featureEnabled = await isFeatureEnabled(gitRoot, 'memory');
      if (count === total && featureEnabled) {
        p.log.info(`Working memory: ${color.green('enabled')} (${total}/${total} hooks)`);
      } else if (count === 0 || !featureEnabled) {
        p.log.info(`Working memory: ${color.dim('disabled')}`);
      } else {
        p.log.info(`Working memory: ${color.yellow(`partial (${count}/${total} hooks)`)} — run --enable to fix`);
      }
      return;
    }

    const devflowDir = getDevFlowDirectory();

    if (options.enable) {
      // D: --enable both installs hooks AND writes dream config, while --disable only
      // writes dream config. This asymmetry is intentional: dream hooks are shared
      // across features (memory, learning, decisions) and must never be removed by a
      // single-feature disable. --enable must still install them on first use.
      const alreadyHasHooks = hasMemoryHooks(settingsContent);
      const alreadyEnabled = alreadyHasHooks && (gitRoot ? await isFeatureEnabled(gitRoot, 'memory') : false);
      if (alreadyEnabled) {
        p.log.info('Working memory already enabled');
      } else if (alreadyHasHooks) {
        // Hooks are registered but config has memory:false — re-enable via config
        p.log.success('Working memory enabled — configuration updated');
        p.log.info(color.dim('Session context will be automatically preserved across conversations'));
      } else {
        const updated = addMemoryHooks(settingsContent, devflowDir);
        await fs.writeFile(settingsPath, updated, 'utf-8');
        p.log.success('Working memory enabled — hooks registered');
        p.log.info(color.dim('Session context will be automatically preserved across conversations'));
      }
      // Update config to enable memory feature
      if (gitRoot) {
        await updateFeature(gitRoot, 'memory', true);
      }
      return;
    }

    if (options.disable) {
      // Hooks remain registered (shared with other features).
      // Disable by writing memory: false to config only — hooks are not removed.
      if (gitRoot) {
        await updateFeature(gitRoot, 'memory', false);
        // Drain orphaned queue files so stale turns don't process on re-enable
        await Promise.all([
          fs.unlink(getPendingTurnsPath(gitRoot)).catch((e: NodeJS.ErrnoException) => { if (e.code !== 'ENOENT') throw e; }),
          fs.unlink(getPendingTurnsProcessingPath(gitRoot)).catch((e: NodeJS.ErrnoException) => { if (e.code !== 'ENOENT') throw e; }),
        ]);
        p.log.success('Working memory disabled — configuration updated');
      } else {
        p.log.warn('Could not resolve git root — configuration not updated');
      }
      return;
    }
  });
