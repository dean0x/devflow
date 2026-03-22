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
 * Learning observation stored in learning-log.jsonl (one JSON object per line).
 */
export interface LearningObservation {
  id: string;
  type: 'workflow' | 'procedural';
  pattern: string;
  confidence: number;
  observations: number;
  first_seen: string;
  last_seen: string;
  status: 'observing' | 'ready' | 'created';
  evidence: string[];
  details: string;
  artifact_path?: string;
}

/**
 * Merged learning configuration from global and project-level config files.
 */
export interface LearningConfig {
  max_daily_runs: number;
  throttle_minutes: number;
  model: string;
}

const LEARNING_HOOK_MARKER = 'stop-update-learning';

/**
 * Add the learning Stop hook to settings JSON.
 * Idempotent — returns unchanged JSON if hook already exists.
 */
export function addLearningHook(settingsJson: string, devflowDir: string): string {
  const settings: Settings = JSON.parse(settingsJson);

  if (hasLearningHook(settingsJson)) {
    return settingsJson;
  }

  if (!settings.hooks) {
    settings.hooks = {};
  }

  const hookCommand = path.join(devflowDir, 'scripts', 'hooks', 'run-hook') + ' stop-update-learning';

  const newEntry: HookMatcher = {
    hooks: [
      {
        type: 'command',
        command: hookCommand,
        timeout: 10,
      },
    ],
  };

  if (!settings.hooks.Stop) {
    settings.hooks.Stop = [];
  }

  settings.hooks.Stop.push(newEntry);

  return JSON.stringify(settings, null, 2) + '\n';
}

/**
 * Remove the learning Stop hook from settings JSON.
 * Idempotent — returns unchanged JSON if hook not present.
 * Preserves other Stop hooks. Cleans empty arrays/objects.
 */
export function removeLearningHook(settingsJson: string): string {
  const settings: Settings = JSON.parse(settingsJson);

  if (!settings.hooks?.Stop) {
    return settingsJson;
  }

  const before = settings.hooks.Stop.length;
  settings.hooks.Stop = settings.hooks.Stop.filter(
    (matcher) => !matcher.hooks.some((h) => h.command.includes(LEARNING_HOOK_MARKER)),
  );

  if (settings.hooks.Stop.length === before) {
    return settingsJson;
  }

  if (settings.hooks.Stop.length === 0) {
    delete settings.hooks.Stop;
  }

  if (settings.hooks && Object.keys(settings.hooks).length === 0) {
    delete settings.hooks;
  }

  return JSON.stringify(settings, null, 2) + '\n';
}

/**
 * Check if the learning hook is registered in settings JSON.
 */
export function hasLearningHook(settingsJson: string): boolean {
  const settings: Settings = JSON.parse(settingsJson);

  if (!settings.hooks?.Stop) {
    return false;
  }

  return settings.hooks.Stop.some((matcher) =>
    matcher.hooks.some((h) => h.command.includes(LEARNING_HOOK_MARKER)),
  );
}

/**
 * Parse a JSONL learning log into typed observations.
 * Skips empty and malformed lines.
 */
export function parseLearningLog(logContent: string): LearningObservation[] {
  if (!logContent.trim()) {
    return [];
  }

  const observations: LearningObservation[] = [];

  for (const line of logContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    try {
      const parsed = JSON.parse(trimmed) as LearningObservation;
      if (parsed.id && parsed.type && parsed.pattern) {
        observations.push(parsed);
      }
    } catch {
      // Skip malformed lines
    }
  }

  return observations;
}

/**
 * Format a human-readable status summary for learning state.
 */
export function formatLearningStatus(observations: LearningObservation[], hookEnabled: boolean): string {
  const lines: string[] = [];

  lines.push(`Self-learning: ${hookEnabled ? 'enabled' : 'disabled'}`);

  if (observations.length === 0) {
    lines.push('Observations: none');
    return lines.join('\n');
  }

  const workflows = observations.filter((o) => o.type === 'workflow');
  const procedurals = observations.filter((o) => o.type === 'procedural');
  const created = observations.filter((o) => o.status === 'created');
  const ready = observations.filter((o) => o.status === 'ready');
  const observing = observations.filter((o) => o.status === 'observing');

  lines.push(`Observations: ${observations.length} total`);
  lines.push(`  Workflows: ${workflows.length}, Procedural: ${procedurals.length}`);
  lines.push(`  Status: ${observing.length} observing, ${ready.length} ready, ${created.length} promoted`);

  return lines.join('\n');
}

/**
 * Load and merge learning configuration from global and project config files.
 * Project config overrides global config; both override defaults.
 */
export function loadLearningConfig(globalPath: string | null, projectPath: string | null): LearningConfig {
  const defaults: LearningConfig = {
    max_daily_runs: 10,
    throttle_minutes: 5,
    model: 'sonnet',
  };

  const config = { ...defaults };

  if (globalPath) {
    try {
      const raw = JSON.parse(globalPath) as Record<string, unknown>;
      if (typeof raw.max_daily_runs === 'number') config.max_daily_runs = raw.max_daily_runs;
      if (typeof raw.throttle_minutes === 'number') config.throttle_minutes = raw.throttle_minutes;
      if (typeof raw.model === 'string') config.model = raw.model;
    } catch {
      // Invalid config — keep defaults
    }
  }

  if (projectPath) {
    try {
      const raw = JSON.parse(projectPath) as Record<string, unknown>;
      if (typeof raw.max_daily_runs === 'number') config.max_daily_runs = raw.max_daily_runs;
      if (typeof raw.throttle_minutes === 'number') config.throttle_minutes = raw.throttle_minutes;
      if (typeof raw.model === 'string') config.model = raw.model;
    } catch {
      // Invalid config — keep defaults
    }
  }

  return config;
}

export const learnCommand = new Command('learn')
  .description('Enable or disable self-learning (workflow detection + auto-commands)')
  .option('--enable', 'Register Stop hook for self-learning')
  .option('--disable', 'Remove self-learning hook')
  .option('--status', 'Show learning status and observation counts')
  .option('--list', 'Show all observations sorted by confidence')
  .option('--configure', 'Interactive configuration wizard')
  .option('--clear', 'Reset learning log (removes all observations)')
  .action(async (options) => {
    const hasFlag = options.enable || options.disable || options.status || options.list || options.configure || options.clear;
    if (!hasFlag) {
      p.intro(color.bgYellow(color.black(' Self-Learning ')));
      p.note(
        `${color.cyan('devflow learn --enable')}      Register learning hook\n` +
        `${color.cyan('devflow learn --disable')}     Remove learning hook\n` +
        `${color.cyan('devflow learn --status')}      Show learning status\n` +
        `${color.cyan('devflow learn --list')}        Show all observations\n` +
        `${color.cyan('devflow learn --configure')}   Configuration wizard\n` +
        `${color.cyan('devflow learn --clear')}       Reset learning log`,
        'Usage',
      );
      p.outro(color.dim('Detects repeated workflows and creates slash commands automatically'));
      return;
    }

    const claudeDir = getClaudeDirectory();
    const settingsPath = path.join(claudeDir, 'settings.json');

    // Read settings
    let settingsContent: string;
    try {
      settingsContent = await fs.readFile(settingsPath, 'utf-8');
    } catch {
      if (options.status || options.list) {
        settingsContent = '{}';
      } else if (options.clear) {
        settingsContent = '{}';
      } else {
        settingsContent = '{}';
      }
    }

    // --- --status ---
    if (options.status) {
      const hookEnabled = hasLearningHook(settingsContent);
      const cwd = process.cwd();
      const logPath = path.join(cwd, '.memory', 'learning-log.jsonl');

      let observations: LearningObservation[] = [];
      try {
        const logContent = await fs.readFile(logPath, 'utf-8');
        observations = parseLearningLog(logContent);
      } catch {
        // No log file yet
      }

      const status = formatLearningStatus(observations, hookEnabled);
      p.log.info(status);
      return;
    }

    // --- --list ---
    if (options.list) {
      const cwd = process.cwd();
      const logPath = path.join(cwd, '.memory', 'learning-log.jsonl');

      let observations: LearningObservation[] = [];
      try {
        const logContent = await fs.readFile(logPath, 'utf-8');
        observations = parseLearningLog(logContent);
      } catch {
        p.log.info('No observations yet. Learning log not found.');
        return;
      }

      if (observations.length === 0) {
        p.log.info('No observations recorded yet.');
        return;
      }

      // Sort by confidence descending
      observations.sort((a, b) => b.confidence - a.confidence);

      p.intro(color.bgYellow(color.black(' Learning Observations ')));
      for (const obs of observations) {
        const typeIcon = obs.type === 'workflow' ? 'W' : 'P';
        const statusIcon = obs.status === 'created' ? color.green('created')
          : obs.status === 'ready' ? color.yellow('ready')
          : color.dim('observing');
        const conf = (obs.confidence * 100).toFixed(0);
        p.log.info(
          `[${typeIcon}] ${color.cyan(obs.pattern)} (${conf}% | ${obs.observations}x | ${statusIcon})`,
        );
      }
      p.outro(color.dim(`${observations.length} observation(s) total`));
      return;
    }

    // --- --configure ---
    if (options.configure) {
      p.intro(color.bgYellow(color.black(' Learning Configuration ')));

      const maxRuns = await p.text({
        message: 'Maximum background runs per day',
        placeholder: '10',
        defaultValue: '10',
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

      const scope = await p.select({
        message: 'Configuration scope',
        options: [
          { value: 'project', label: 'Project', hint: 'This project only (.memory/learning.json)' },
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
      };

      const configJson = JSON.stringify(config, null, 2) + '\n';

      if (scope === 'global') {
        const globalDir = path.join(process.env.HOME || '~', '.devflow');
        await fs.mkdir(globalDir, { recursive: true });
        await fs.writeFile(path.join(globalDir, 'learning.json'), configJson, 'utf-8');
        p.log.success(`Global config written to ${color.dim(path.join(globalDir, 'learning.json'))}`);
      } else {
        const cwd = process.cwd();
        const memoryDir = path.join(cwd, '.memory');
        await fs.mkdir(memoryDir, { recursive: true });
        await fs.writeFile(path.join(memoryDir, 'learning.json'), configJson, 'utf-8');
        p.log.success(`Project config written to ${color.dim(path.join(memoryDir, 'learning.json'))}`);
      }

      p.outro(color.green('Configuration saved.'));
      return;
    }

    // --- --clear ---
    if (options.clear) {
      const cwd = process.cwd();
      const logPath = path.join(cwd, '.memory', 'learning-log.jsonl');

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
    // Resolve devflow scripts directory from settings.json hooks or default
    let devflowDir: string;
    try {
      const settings = JSON.parse(settingsContent) as Settings;
      // Try to extract devflowDir from existing hooks (e.g., Stop hook path)
      const stopHook = settings.hooks?.Stop?.[0]?.hooks?.[0]?.command;
      if (stopHook) {
        const hookBinary = stopHook.split(' ')[0];
        devflowDir = path.resolve(hookBinary, '..', '..', '..');
      } else {
        devflowDir = getDevFlowDirectory();
      }
    } catch {
      devflowDir = getDevFlowDirectory();
    }

    if (options.enable) {
      const updated = addLearningHook(settingsContent, devflowDir);
      if (updated === settingsContent) {
        p.log.info('Self-learning already enabled');
        return;
      }
      await fs.writeFile(settingsPath, updated, 'utf-8');
      p.log.success('Self-learning enabled — Stop hook registered');
      p.log.info(color.dim('Repeated workflows will be detected and turned into slash commands'));
    }

    if (options.disable) {
      const updated = removeLearningHook(settingsContent);
      if (updated === settingsContent) {
        p.log.info('Self-learning already disabled');
        return;
      }
      await fs.writeFile(settingsPath, updated, 'utf-8');
      p.log.success('Self-learning disabled — hook removed');
    }
  });
