import { Command } from 'commander';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as p from '@clack/prompts';
import color from 'picocolors';
import { getDevFlowDirectory, getClaudeDirectory } from '../utils/paths.js';
import {
  getMemoryDir,
  getSidecarDir,
  getLearningLogPath,
  getLearningConfigPath,
  getLearningManifestPath,
  getLearningNotifiedAtPath,
  getLearningNotificationsPath,
  getLearningRunsTodayPath,
  getLearningSessionCountPath,
  getLearningBatchIdsPath,
  getLearningDisabledSentinel,
  getLearningLockDir,
  getDecisionsUsagePath,
  getDecisionsUsageLockDir,
} from '../utils/project-paths.js';
import { getGitRoot } from '../utils/git.js';
import { cleanSelfLearningArtifacts, AUTO_GENERATED_MARKER } from '../utils/learning-cleanup.js';
import { updateFeature, isFeatureEnabled } from '../utils/sidecar-config.js';
import {
  type LearningObservation,
} from '../utils/observations.js';
import {
  readObservations,
  warnIfInvalid,
} from '../utils/observation-io.js';


// ---------------------------------------------------------------------------
// Learning configuration
// ---------------------------------------------------------------------------

/**
 * Merged learning configuration from global and project-level config files.
 */
export interface LearningConfig {
  max_daily_runs: number;
  throttle_minutes: number;
  model: string;
  debug: boolean;
  /** Number of observations processed per learning run. Default 3, adaptive 5 at 15+ observations. */
  batch_size: number;
}

/**
 * Format a human-readable status summary for learning state.
 * enabled: true when the sidecar config has learning: true (or no config).
 */
export function formatLearningStatus(observations: LearningObservation[], enabled: boolean): string {
  const lines: string[] = [];
  lines.push(`Self-learning: ${enabled ? 'enabled' : 'disabled'}`);

  if (observations.length === 0) {
    lines.push('Observations: none');
    return lines.join('\n');
  }

  const workflows = observations.filter((o) => o.type === 'workflow');
  const procedurals = observations.filter((o) => o.type === 'procedural');
  const decisions = observations.filter((o) => o.type === 'decision');
  const pitfalls = observations.filter((o) => o.type === 'pitfall');
  const created = observations.filter((o) => o.status === 'created');
  const ready = observations.filter((o) => o.status === 'ready');
  const observing = observations.filter((o) => o.status === 'observing');
  const deprecated = observations.filter((o) => o.status === 'deprecated');
  const needReview = observations.filter((o) => o.mayBeStale || o.needsReview || o.softCapExceeded);

  lines.push(`Observations: ${observations.length} total`);
  lines.push(`  Workflows: ${workflows.length}, Procedural: ${procedurals.length}, Decisions: ${decisions.length}, Pitfalls: ${pitfalls.length}`);
  lines.push(`  Status: ${observing.length} observing, ${ready.length} ready, ${created.length} promoted, ${deprecated.length} deprecated`);
  if (needReview.length > 0) {
    lines.push(`  ${color.yellow('⚠')} ${needReview.length} flagged (stale/missing/capacity)`);
  }

  return lines.join('\n');
}

/**
 * Apply a single JSON config layer onto a LearningConfig, returning a new object.
 * Skips fields with wrong types; swallows parse errors.
 */
export function applyConfigLayer(config: LearningConfig, json: string): LearningConfig {
  try {
    const raw = JSON.parse(json) as Record<string, unknown>;
    return {
      max_daily_runs: typeof raw.max_daily_runs === 'number' ? raw.max_daily_runs : config.max_daily_runs,
      throttle_minutes: typeof raw.throttle_minutes === 'number' ? raw.throttle_minutes : config.throttle_minutes,
      model: typeof raw.model === 'string' ? raw.model : config.model,
      debug: typeof raw.debug === 'boolean' ? raw.debug : config.debug,
      batch_size: typeof raw.batch_size === 'number' ? raw.batch_size : config.batch_size,
    };
  } catch {
    return { ...config };
  }
}

/**
 * Load and merge learning configuration from global and project config JSON strings.
 * Project config overrides global config; both override defaults.
 */
export function loadLearningConfig(globalJson: string | null, projectJson: string | null): LearningConfig {
  let config: LearningConfig = {
    max_daily_runs: 5,
    throttle_minutes: 5,
    model: 'sonnet',
    debug: false,
    batch_size: 3,
  };

  if (globalJson) config = applyConfigLayer(config, globalJson);
  if (projectJson) config = applyConfigLayer(config, projectJson);

  return config;
}

interface LearnOptions {
  enable?: boolean;
  disable?: boolean;
  status?: boolean;
  list?: boolean;
  configure?: boolean;
  clear?: boolean;
  reset?: boolean;
}

export const learnCommand = new Command('learn')
  .description('Enable or disable self-learning (workflow detection + auto-commands)')
  .option('--enable', 'Enable self-learning via sidecar config')
  .option('--disable', 'Disable self-learning via sidecar config')
  .option('--status', 'Show learning status and observation counts')
  .option('--list', 'Show all observations sorted by confidence')
  .option('--configure', 'Interactive configuration wizard')
  .option('--clear', 'Reset learning log (removes all observations)')
  .option('--reset', 'Remove all self-learning artifacts, log, and transient state')
  .action(async (options: LearnOptions) => {
    const knownFlags: (keyof LearnOptions)[] = [
      'enable', 'disable', 'status', 'list', 'configure',
      'clear', 'reset',
    ];
    const hasFlag = knownFlags.some((f) => options[f]);
    if (!hasFlag) {
      p.intro(color.bgYellow(color.black(' Self-Learning ')));
      p.note(
        `${color.cyan('devflow learn --enable')}      Enable self-learning\n` +
        `${color.cyan('devflow learn --disable')}     Disable self-learning\n` +
        `${color.cyan('devflow learn --status')}      Show learning status\n` +
        `${color.cyan('devflow learn --list')}        Show all observations\n` +
        `${color.cyan('devflow learn --configure')}   Configuration wizard\n` +
        `${color.cyan('devflow learn --clear')}       Reset learning log\n` +
        `${color.cyan('devflow learn --reset')}       Remove artifacts + log + state`,
        'Usage',
      );
      p.outro(color.dim('Detects repeated workflows and creates slash commands automatically'));
      return;
    }

    // Shared log path for --status, --list, --purge, --clear
    const logPath = getLearningLogPath(process.cwd());

    // --- --status ---
    if (options.status) {
      const gitRoot = await getGitRoot();
      if (!gitRoot) {
        p.log.info('Self-learning: disabled (not in a git project)');
        return;
      }
      const enabled = await isFeatureEnabled(gitRoot, 'learning');
      const { observations, invalidCount } = await readObservations(logPath);

      const status = formatLearningStatus(observations, enabled);
      p.log.info(status);
      warnIfInvalid(invalidCount);
      return;
    }

    // --- --list ---
    if (options.list) {
      let logExists = true;
      try {
        await fs.access(logPath);
      } catch {
        logExists = false;
      }

      if (!logExists) {
        p.log.info('No observations yet. Learning log not found.');
        return;
      }

      const { observations, invalidCount } = await readObservations(logPath);

      if (observations.length === 0) {
        p.log.info('No observations recorded yet.');
        return;
      }

      // Sort by confidence descending
      observations.sort((a, b) => b.confidence - a.confidence);

      p.intro(color.bgYellow(color.black(' Learning Observations ')));
      for (const obs of observations) {
        const typeIconMap = { workflow: 'W', procedural: 'P', decision: 'D', pitfall: 'F' } as const;
        const typeIcon = typeIconMap[obs.type] ?? 'F';
        const statusIcon = obs.status === 'created' ? color.green('created')
          : obs.status === 'ready' ? color.yellow('ready')
          : obs.status === 'deprecated' ? color.dim('deprecated')
          : color.dim('observing');
        const conf = (obs.confidence * 100).toFixed(0);
        p.log.info(
          `[${typeIcon}] ${color.cyan(obs.pattern)} (${conf}% | ${obs.observations}x | ${statusIcon})`,
        );
      }
      warnIfInvalid(invalidCount);
      p.outro(color.dim(`${observations.length} observation(s) total`));
      return;
    }

    // --- --configure ---
    if (options.configure) {
      p.intro(color.bgYellow(color.black(' Learning Configuration ')));

      const maxRuns = await p.text({
        message: 'Maximum background runs per day',
        placeholder: '5',
        defaultValue: '5',
        validate: (v) => {
          const n = Number(v);
          if (isNaN(n) || n < 1 || n > 50) return 'Enter a number between 1 and 50';
          return undefined;
        },
      });
      if (p.isCancel(maxRuns)) {
        p.cancel('Configuration cancelled.');
        return;
      }

      const throttle = await p.text({
        message: 'Throttle interval (minutes between runs)',
        placeholder: '5',
        defaultValue: '5',
        validate: (v) => {
          const n = Number(v);
          if (isNaN(n) || n < 1 || n > 60) return 'Enter a number between 1 and 60';
          return undefined;
        },
      });
      if (p.isCancel(throttle)) {
        p.cancel('Configuration cancelled.');
        return;
      }

      const model = await p.select({
        message: 'Model for pattern detection',
        options: [
          { value: 'sonnet', label: 'Sonnet', hint: 'Recommended — good balance of quality and speed' },
          { value: 'haiku', label: 'Haiku', hint: 'Fastest, lowest cost' },
          { value: 'opus', label: 'Opus', hint: 'Highest quality, highest cost' },
        ],
      });
      if (p.isCancel(model)) {
        p.cancel('Configuration cancelled.');
        return;
      }

      const debugMode = await p.confirm({
        message: 'Enable debug logging? (logs session content excerpts to ~/.devflow/logs/)',
        initialValue: false,
      });
      if (p.isCancel(debugMode)) {
        p.cancel('Configuration cancelled.');
        return;
      }

      const batchSize = await p.text({
        message: 'Observations per learning run (adaptive: 5 at 15+ observations)',
        placeholder: '3',
        defaultValue: '3',
        validate: (v) => {
          const n = Number(v);
          if (isNaN(n) || n < 1 || n > 20) return 'Enter a number between 1 and 20';
          return undefined;
        },
      });
      if (p.isCancel(batchSize)) {
        p.cancel('Configuration cancelled.');
        return;
      }

      const scope = await p.select({
        message: 'Configuration scope',
        options: [
          { value: 'project', label: 'Project', hint: 'This project only (.devflow/learning/learning.json)' },
          { value: 'global', label: 'Global', hint: 'All projects (~/.devflow/learning.json)' },
        ],
      });
      if (p.isCancel(scope)) {
        p.cancel('Configuration cancelled.');
        return;
      }

      const config: LearningConfig = {
        max_daily_runs: Number(maxRuns),
        throttle_minutes: Number(throttle),
        model: model as string,
        debug: debugMode,
        batch_size: Number(batchSize),
      };

      const configJson = JSON.stringify(config, null, 2) + '\n';

      if (scope === 'global') {
        const globalDir = path.join(process.env.HOME || '~', '.devflow');
        await fs.mkdir(globalDir, { recursive: true });
        await fs.writeFile(path.join(globalDir, 'learning.json'), configJson, 'utf-8');
        p.log.success(`Global config written to ${color.dim(path.join(globalDir, 'learning.json'))}`);
      } else {
        const cwd = process.cwd();
        const memDir = getMemoryDir(cwd);
        const projectLearningConfigPath = getLearningConfigPath(cwd);
        await fs.mkdir(memDir, { recursive: true });
        await fs.writeFile(projectLearningConfigPath, configJson, 'utf-8');
        p.log.success(`Project config written to ${color.dim(projectLearningConfigPath)}`);
      }

      p.outro(color.green('Configuration saved.'));
      return;
    }

    // --- --reset ---
    if (options.reset) {
      const lockDir = getLearningLockDir(process.cwd());

      // Acquire lock to prevent conflict with running background-learning
      try {
        await fs.mkdir(lockDir);
      } catch {
        p.log.error('Learning system is currently running. Try again in a moment.');
        return;
      }

      try {
        // Inventory what will be removed (dry-run) before asking for confirmation
        const { observations } = await readObservations(logPath);

        // Count artifacts without removing them
        const claudeDir = getClaudeDirectory();
        const skillsDir = path.join(claudeDir, 'skills');
        const commandsDir = path.join(claudeDir, 'commands', 'self-learning');
        let skillCount = 0;
        let cmdCount = 0;
        try {
          const skillEntries = await fs.readdir(skillsDir, { withFileTypes: true });
          for (const entry of skillEntries) {
            if (!entry.isDirectory() || entry.name.startsWith('devflow:')) continue;
            const skillFile = path.join(skillsDir, entry.name, 'SKILL.md');
            try {
              const content = await fs.readFile(skillFile, 'utf-8');
              if (content.split('\n').slice(0, 10).join('\n').includes(AUTO_GENERATED_MARKER)) {
                skillCount++;
              }
            } catch { /* file doesn't exist */ }
          }
        } catch { /* skills dir doesn't exist */ }
        try {
          const cmdEntries = await fs.readdir(commandsDir, { withFileTypes: true });
          for (const entry of cmdEntries) {
            if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
            try {
              const content = await fs.readFile(path.join(commandsDir, entry.name), 'utf-8');
              if (content.split('\n').slice(0, 10).join('\n').includes(AUTO_GENERATED_MARKER)) {
                cmdCount++;
              }
            } catch { /* file doesn't exist */ }
          }
        } catch { /* commands dir doesn't exist */ }

        const cwd = process.cwd();
        const transientFilePaths = [
          getLearningSessionCountPath(cwd),
          getLearningBatchIdsPath(cwd),
          getLearningRunsTodayPath(cwd),
          getLearningNotifiedAtPath(cwd),
          getLearningNotificationsPath(cwd),
          getDecisionsUsagePath(cwd),
          getLearningManifestPath(cwd),
        ];
        let transientCount = 0;
        for (const filePath of transientFilePaths) {
          try {
            await fs.access(filePath);
            transientCount++;
          } catch { /* doesn't exist */ }
        }

        if (skillCount === 0 && cmdCount === 0 && observations.length === 0 && transientCount === 0) {
          p.log.info('Nothing to clean — no self-learning artifacts or state found.');
          return;
        }

        // Build and show confirmation prompt
        const lines: string[] = ['This will remove:'];
        if (skillCount > 0) lines.push(`  - ${skillCount} self-learning skill(s)`);
        if (cmdCount > 0) lines.push(`  - ${cmdCount} self-learning command(s)`);
        if (observations.length > 0) lines.push(`  - Learning log (${observations.length} observations)`);
        if (transientCount > 0) lines.push(`  - ${transientCount} transient state file(s)`);

        if (process.stdin.isTTY) {
          p.log.info(lines.join('\n'));
          const confirm = await p.confirm({
            message: 'Continue? This cannot be undone.',
            initialValue: false,
          });
          if (p.isCancel(confirm) || !confirm) {
            p.log.info('Reset cancelled.');
            return;
          }
        }

        // User confirmed — now actually remove everything
        const artifactResult = await cleanSelfLearningArtifacts(claudeDir);

        // Truncate learning log
        try {
          await fs.writeFile(logPath, '', 'utf-8');
        } catch { /* file may not exist */ }

        // Remove transient state files
        for (const filePath of transientFilePaths) {
          try {
            await fs.unlink(filePath);
          } catch { /* file may not exist */ }
        }

        // Clean up decisions-usage lock directory if stale
        try {
          await fs.rmdir(getDecisionsUsageLockDir(cwd));
        } catch { /* doesn't exist or already cleaned */ }

        // Clean sidecar state files
        const sidecarDir = getSidecarDir(cwd);
        for (const f of ['.learning-runs-today', '.learning-sessions']) {
          try { await fs.unlink(path.join(sidecarDir, f)); } catch { /* may not exist */ }
        }
        // Clean sidecar learning markers and locks
        try {
          const sidecarFiles = await fs.readdir(sidecarDir);
          for (const f of sidecarFiles) {
            if (f.startsWith('learning.') && f.endsWith('.json')) {
              try { await fs.unlink(path.join(sidecarDir, f)); } catch { /* ignore */ }
            }
          }
        } catch { /* sidecar dir may not exist */ }
        // Clean lock directories
        for (const lockName of ['.reinforce.lock', '.learning-batch.lock']) {
          try { await fs.rmdir(path.join(sidecarDir, lockName)); } catch { /* ignore */ }
        }

        // Remove stale `enabled` field from learning.json (migration)
        const learningConfigPath = getLearningConfigPath(cwd);
        try {
          const configContent = await fs.readFile(learningConfigPath, 'utf-8');
          const config = JSON.parse(configContent) as Record<string, unknown>;
          if ('enabled' in config) {
            delete config.enabled;
            if (Object.keys(config).length === 0) {
              await fs.unlink(learningConfigPath);
            } else {
              await fs.writeFile(learningConfigPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
            }
          }
        } catch { /* config may not exist */ }

        const parts: string[] = [];
        if (artifactResult.removed > 0) parts.push(`${artifactResult.removed} artifact(s)`);
        if (observations.length > 0) parts.push('learning log');
        if (transientCount > 0) parts.push('transient state');

        p.log.success(`Reset complete — removed ${parts.join(', ')}.`);
      } finally {
        // Release lock
        try { await fs.rmdir(lockDir); } catch { /* already cleaned */ }
      }
      return;
    }

    // --- --clear ---
    if (options.clear) {
      try {
        await fs.access(logPath);
      } catch {
        p.log.info('No learning log to clear.');
        return;
      }

      if (process.stdin.isTTY) {
        const confirm = await p.confirm({
          message: 'Clear all learning observations? This cannot be undone.',
          initialValue: false,
        });
        if (p.isCancel(confirm) || !confirm) {
          p.log.info('Clear cancelled.');
          return;
        }
      }

      await fs.writeFile(logPath, '', 'utf-8');
      p.log.success('Learning log cleared.');
      return;
    }

    // --- --enable / --disable ---
    if (options.enable) {
      const gitRoot = await getGitRoot();
      if (gitRoot) {
        await updateFeature(gitRoot, 'learning', true);
        // Remove .learning-disabled sentinel (defense-in-depth with sidecar config)
        try {
          await fs.unlink(getLearningDisabledSentinel(gitRoot));
        } catch { /* may not exist */ }
        p.log.success('Self-learning enabled — sidecar config updated');
        p.log.info(color.dim('Repeated workflows will be detected and turned into slash commands'));
      } else {
        p.log.warn('Could not resolve git root — sidecar config not updated');
      }
      return;
    }

    if (options.disable) {
      const gitRoot = await getGitRoot();
      if (gitRoot) {
        await updateFeature(gitRoot, 'learning', false);
        // Create .learning-disabled sentinel (gates session-start-context)
        const memDir = getMemoryDir(gitRoot);
        await fs.mkdir(memDir, { recursive: true });
        await fs.writeFile(getLearningDisabledSentinel(gitRoot), '', 'utf-8');
        p.log.success('Self-learning disabled — sidecar config updated');
      } else {
        p.log.warn('Could not resolve git root — sidecar config not updated');
      }
      return;
    }
  });
