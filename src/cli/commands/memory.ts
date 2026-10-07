import { Command } from 'commander';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as p from '@clack/prompts';
import color from 'picocolors';
import { getClaudeDirectory, getDevFlowDirectory } from '../../targets/claude-code/claude-paths.js';
import { writeSettingsFileAtomic } from '../../core/fs-atomic.js';
import { discoverProjectGitRoots } from '../../targets/claude-code/post-install.js';
import { getGitRoot } from '../../core/git.js';
import { firstSymbolicLink } from '../../core/linked-path.js';
import {
  getMemoryDir,
  getPendingTurnsPath,
  getPendingTurnsProcessingPath,
} from '../../core/project-paths.js';
import { drainQueueFiles, formatRefusedDrain, type QueueDrain } from '../../core/queue-drain.js';
import {
  HOOKS_DIR_SUFFIX,
  devflowHookOwner,
  endsWithAny,
  ensureHook,
  hasHook,
  removeHooks,
  runHookCommand,
  runHookSuffix,
  type HookPredicate,
  type Settings,
} from '../../targets/claude-code/hooks.js';
import { readMachineFeature, writeMachineFeature } from '../../core/feature-switch.js';
import { loadSettingsModule, narrowedSwitchLabel, personalConfigTrackedWarning } from '../../core/evidence-policy.js';

/**
 * Map of hook event type → filename marker for the memory hooks.
 * Three hooks total: Stop, SessionStart, PreCompact.
 *
 * UserPromptSubmit and SessionEnd are not memory.ts's concern: prompt/turn capture
 * lives in capture.ts (capture-prompt, capture-turn — always-on, not feature-gated
 * at the hook-registration level), and decisions detection is a SessionStart-spawned
 * detached worker rather than a SessionEnd hook (see legacy-hooks.ts).
 *
 * Stop-event concurrency: Claude Code runs one event's hooks in parallel, so
 * memory-worker can spawn background-memory-update before capture-turn has
 * appended this turn's assistant row. The worker tolerates that — a queue that
 * holds only user rows is left in place and the LLM run skipped
 * (D-QUEUE-NO-ORPHAN-DELETE) — so nothing here depends on hook order.
 */
const MEMORY_HOOK_CONFIG: Record<string, string> = {
  Stop: 'memory-worker',
  SessionStart: 'session-start-memory',
  PreCompact: 'pre-compact-memory',
};

/**
 * The command endings of the memory-era hooks earlier releases registered, per
 * event. Removed by removeMemoryHooks so an upgrade leaves no hook pointing at a
 * script that no longer exists; never counted as a current memory hook.
 *
 * D-EXACT-HOOK-OWNER (hooks.ts): matched as command ENDINGS under any directory —
 * the v1 (≤ v1.2) direct `.sh` scripts, then the retired `run-hook` markers of the
 * prompt-capture, learning, decisions, knowledge-refresh, sidecar and dream
 * pipelines — never as substrings, so a user's hook that mentions one is theirs.
 */
const LEGACY_HOOK_SUFFIXES: Record<string, readonly string[]> = {
  UserPromptSubmit: ['prompt-capture-memory', 'sidecar-dispatch', 'dream-dispatch'].map(runHookSuffix),
  Stop: [
    `${HOOKS_DIR_SUFFIX}stop-update-memory.sh`,
    ...['stop-update-memory', 'stop-update-learning', 'sidecar-capture', 'dream-capture'].map(runHookSuffix),
  ],
  SessionStart: [`${HOOKS_DIR_SUFFIX}session-start-memory.sh`],
  PreCompact: [`${HOOKS_DIR_SUFFIX}pre-compact-memory.sh`],
  SessionEnd: [
    'session-end-learning', 'session-end-decisions', 'session-end-knowledge-refresh',
    'sidecar-evaluate', 'dream-evaluate',
  ].map(runHookSuffix),
};

/** D-EXACT-HOOK-OWNER: the current memory hook for `marker` (hooks.ts). */
function isMemoryHook(marker: string): HookPredicate {
  return devflowHookOwner([marker]);
}

/**
 * Add all 3 memory hooks (Stop, SessionStart, PreCompact) to settings JSON.
 * Idempotent — skips hooks that already exist. Returns unchanged JSON if all 3 present.
 */
export function addMemoryHooks(settingsJson: string, devflowDir: string): string {
  const settings: Settings = JSON.parse(settingsJson);

  if (hasMemoryHooks(settings)) {
    return settingsJson;
  }

  for (const [hookType, marker] of Object.entries(MEMORY_HOOK_CONFIG)) {
    ensureHook(settings, hookType, isMemoryHook(marker), {
      hooks: [{ type: 'command', command: runHookCommand(devflowDir, marker), timeout: 10 }],
    });
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

  // Evaluate every removal into a local — never short-circuit.
  let changed = false;
  for (const [hookType, marker] of Object.entries(MEMORY_HOOK_CONFIG)) {
    const removed = removeHooks(settings, hookType, isMemoryHook(marker));
    changed = changed || removed;
  }
  // Remove the memory-era hooks of earlier releases from upgrading users
  for (const [hookType, suffixes] of Object.entries(LEGACY_HOOK_SUFFIXES)) {
    const removed = removeHooks(settings, hookType, endsWithAny(suffixes));
    changed = changed || removed;
  }

  if (!changed) {
    return settingsJson;
  }

  return JSON.stringify(settings, null, 2) + '\n';
}

/**
 * Check if ALL 3 memory hooks are registered in settings JSON or parsed Settings object.
 */
export function hasMemoryHooks(input: string | Settings): boolean {
  return countMemoryHooks(input) === Object.keys(MEMORY_HOOK_CONFIG).length;
}

/**
 * Count how many of the 3 memory hooks are present (0-3).
 * Accepts either a JSON string or a parsed Settings object.
 */
export function countMemoryHooks(input: string | Settings): number {
  const settings: Settings = typeof input === 'string' ? JSON.parse(input) : input;

  let count = 0;
  for (const [hookType, marker] of Object.entries(MEMORY_HOOK_CONFIG)) {
    if (hasHook(settings, hookType, isMemoryHook(marker))) count++;
  }

  return count;
}

/**
 * Converge the memory hooks in a settings JSON string to `enabled`. Pure.
 *
 * D-FEATURES-NARROW-ONLY: the ONE settings transform for the memory feature,
 * shared by `devflow init` (inside its single settings read-modify-write pass)
 * and `devflow memory --enable/--disable`, so the two controls of the same
 * machine-wide switch leave settings.json byte-for-byte alike. Always
 * remove-then-add, which also upgrades an older hook format (e.g. `.sh` →
 * `run-hook`) in place.
 *
 * Stop-array position (AC-C2): memory-worker is appended after whatever the
 * Stop array already holds, so it lands after capture-turn — init registers the
 * capture hooks earlier in the same pass, and on a standalone toggle they are
 * already present. The position keeps settings.json identical across init and
 * the toggle; it sequences nothing at run time, where the Stop hooks run in
 * parallel.
 */
export function convergeMemoryHooks(settingsJson: string, enabled: boolean, devflowDir: string): string {
  const cleaned = removeMemoryHooks(settingsJson);
  return enabled ? addMemoryHooks(cleaned, devflowDir) : cleaned;
}

/**
 * Drain a project's pending memory queue (and a claimed batch) so stale turns
 * are not processed when memory is next switched on. Shared by `devflow init
 * --no-memory` and `devflow memory --disable`. Refused, deleting nothing, when
 * `.devflow` or `.devflow/memory` under `projectRoot` is a symbolic link
 * (D-CLI-NO-SYMLINK). ENOENT-tolerant; any other error propagates to the command
 * boundary, like drainLearningQueue.
 */
export async function drainMemoryQueue(projectRoot: string): Promise<QueueDrain> {
  const memoryDir = getMemoryDir(projectRoot);
  return drainQueueFiles([path.dirname(memoryDir), memoryDir], [
    getPendingTurnsPath(projectRoot),
    getPendingTurnsProcessingPath(projectRoot),
  ]);
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
 * Skips projects where the background updater lock is held to avoid data loss,
 * and refuses, deleting nothing there, a project whose `.devflow` or
 * `.devflow/memory` is a symbolic link (D-CLI-NO-SYMLINK); `refused` names each
 * such link. Returns the count of projects from which at least one file was removed.
 */
export async function cleanQueueFiles(
  projectPaths: string[],
): Promise<{ cleaned: number; projects: string[]; refused: string[] }> {
  const results = await Promise.all(
    projectPaths.map(async (project): Promise<{ cleaned: string } | { refused: string } | null> => {
      const memDir = getMemoryDir(project);
      let linkedFolder: string | null;
      try {
        linkedFolder = await firstSymbolicLink([path.dirname(memDir), memDir]);
      } catch {
        // The folders cannot be checked: delete nothing there, and go on to the others.
        return null;
      }
      if (linkedFolder !== null) return { refused: linkedFolder };
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
      return (q || pr) ? { cleaned: project } : null;
    }),
  );
  const cleanedProjects = results.flatMap((r) => (r !== null && 'cleaned' in r ? [r.cleaned] : []));
  const refused = results.flatMap((r) => (r !== null && 'refused' in r ? [r.refused] : []));
  return { cleaned: cleanedProjects.length, projects: cleanedProjects, refused };
}

export const memoryCommand = new Command('memory')
  .description('Enable, disable, or clean up working memory (session context preservation)')
  .option('--enable', 'Enable working memory in every project (a repository can opt out)')
  .option('--disable', 'Disable working memory in every project')
  .option('--status', 'Show current state')
  .option('--clear', 'Clean up queue files from projects')
  .action(async (options: MemoryOptions) => {
    const hasFlag = options.enable || options.disable || options.status || options.clear;
    if (!hasFlag) {
      p.intro(color.bgCyan(color.white(' Working Memory ')));
      p.note(
        `${color.cyan('devflow memory --enable')}   Enable working memory (every project; a repository can opt out)\n` +
        `${color.cyan('devflow memory --disable')}  Disable working memory (every project)\n` +
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
      const [gitRoots, gitRoot] = await Promise.all([discoverProjectGitRoots(getClaudeDirectory()), getGitRoot()]);
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

      const { cleaned, projects: cleanedProjects, refused } = await cleanQueueFiles(targets);
      for (const project of cleanedProjects) {
        p.log.info(color.dim(`Cleaned: ${project}`));
      }
      for (const linkedFolder of refused) {
        p.log.warn(formatRefusedDrain('memory', linkedFolder));
      }
      p.log.success(cleaned > 0
        ? `Cleaned queue files from ${cleaned} project${cleaned > 1 ? 's' : ''}`
        : 'No queue files found to clean');
      return;
    }

    const settingsPath = path.join(getClaudeDirectory(), 'settings.json');
    const devflowDir = getDevFlowDirectory();

    let settingsContent: string;
    try {
      settingsContent = await fs.readFile(settingsPath, 'utf-8');
    } catch {
      settingsContent = '{}';
    }

    if (options.status) {
      // D-FEATURES-NARROW-ONLY: the machine switch, the manifest's, is reported
      // first. The hook count is reported beside it because the hooks are how that
      // switch takes effect. A repository layer can only narrow it, and says so on
      // a line of its own — only when it does, so the output is otherwise unchanged.
      const enabled = await readMachineFeature(devflowDir, 'memory');
      const count = countMemoryHooks(settingsContent);
      const total = Object.keys(MEMORY_HOOK_CONFIG).length;
      if (enabled && count === total) {
        p.log.info(`Working memory: ${color.green('enabled')} (${total}/${total} hooks)`);
      } else if (!enabled) {
        p.log.info(`Working memory: ${color.dim('disabled')}`);
      } else {
        p.log.info(
          `Working memory: ${color.yellow(`enabled, but ${count}/${total} hooks registered`)} — ` +
          `run ${color.cyan('devflow memory --enable')} to fix`,
        );
      }
      const settingsModule = loadSettingsModule();
      const narrowed = enabled ? narrowedSwitchLabel(settingsModule, { dir: process.cwd() }, 'memory') : null;
      if (narrowed !== null) p.log.info(`Effective here: ${color.yellow(narrowed)}`);
      const trackedWarning = personalConfigTrackedWarning(settingsModule, { dir: process.cwd() });
      if (trackedWarning !== null) p.log.warn(trackedWarning);
      return;
    }

    // --enable / --disable: the machine-wide switch, converged exactly as
    // `devflow init --memory / --no-memory` converges it (D-FEATURES-NARROW-ONLY).
    // The settings transform runs FIRST: it is the step that can reject its
    // input (malformed JSON), and the switch must not be recorded unless the
    // hooks that enact it can follow.
    const enabled = options.enable === true;
    let converged: string;
    try {
      converged = convergeMemoryHooks(settingsContent, enabled, devflowDir);
    } catch (err) {
      p.log.error(`Could not update ${settingsPath}: ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
      return;
    }

    const recorded = await writeMachineFeature(devflowDir, 'memory', enabled);
    if (!recorded.ok) {
      p.log.error(`Devflow is not installed on this machine — run ${color.cyan('devflow init')} first`);
      process.exitCode = 1;
      return;
    }

    if (converged !== settingsContent) {
      await writeSettingsFileAtomic(settingsPath, converged);
    }

    if (enabled) {
      p.log.success('Working memory enabled in every project (a repository can opt out)');
      p.log.info(color.dim('Session context will be automatically preserved across conversations'));
      return;
    }

    // Drain the current project's queue, as init does. Outside a git project
    // there is no project queue to drain, and the switch itself still applies.
    const gitRoot = await getGitRoot();
    if (gitRoot) {
      const drain = await drainMemoryQueue(gitRoot);
      if (!drain.drained) p.log.warn(formatRefusedDrain('memory', drain.linkedFolder));
    }
    p.log.success('Working memory disabled in every project');
  });
