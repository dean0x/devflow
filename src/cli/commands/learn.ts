import { Command } from 'commander';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as p from '@clack/prompts';
import color from 'picocolors';
import { getClaudeDirectory, getDevFlowDirectory } from '../utils/paths.js';
import type { HookMatcher, Settings } from '../utils/hooks.js';

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
  debug: boolean;
}

/**
 * Type guard for validating raw JSON as a LearningObservation.
 */
export function isLearningObservation(obj: unknown): obj is LearningObservation {
  if (typeof obj !== 'object' || obj === null) return false;
  const o = obj as Record<string, unknown>;
  return typeof o.id === 'string' && o.id.length > 0
    && (o.type === 'workflow' || o.type === 'procedural')
    && typeof o.pattern === 'string' && o.pattern.length > 0
    && typeof o.confidence === 'number'
    && typeof o.observations === 'number'
    && typeof o.first_seen === 'string'
    && typeof o.last_seen === 'string'
    && (o.status === 'observing' || o.status === 'ready' || o.status === 'created')
    && Array.isArray(o.evidence)
    && typeof o.details === 'string';
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
      const parsed: unknown = JSON.parse(trimmed);
      if (isLearningObservation(parsed)) {
        observations.push(parsed);
      }
    } catch {
      // Skip malformed lines
    }
  }

  return observations;
}

/**
 * Parse a JSONL log and return valid observations plus the count of invalid entries.
 * Centralises the raw-line-count + parse pattern used by --status, --list, and --purge.
 */
export function loadAndCountObservations(logContent: string): {
  observations: LearningObservation[];
  invalidCount: number;
} {
  const rawLines = logContent.split('\n').filter(l => l.trim()).length;
  const observations = parseLearningLog(logContent);
  return { observations, invalidCount: rawLines - observations.length };
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
 * Apply a single JSON config layer onto a LearningConfig, returning a new object.
 * Skips fields with wrong types; swallows parse errors.
 */
// SYNC: Config loading duplicated in scripts/hooks/background-learning load_config()
// Synced fields: max_daily_runs, throttle_minutes, model, debug
export function applyConfigLayer(config: LearningConfig, json: string): LearningConfig {
  try {
    const raw = JSON.parse(json) as Record<string, unknown>;
    return {
      max_daily_runs: typeof raw.max_daily_runs === 'number' ? raw.max_daily_runs : config.max_daily_runs,
      throttle_minutes: typeof raw.throttle_minutes === 'number' ? raw.throttle_minutes : config.throttle_minutes,
      model: typeof raw.model === 'string' ? raw.model : config.model,
      debug: typeof raw.debug === 'boolean' ? raw.debug : config.debug,
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
    max_daily_runs: 10,
    throttle_minutes: 5,
    model: 'sonnet',
    debug: false,
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
  purge?: boolean;
}

export const learnCommand = new Command('learn')
  .description('Enable or disable self-learning (workflow detection + auto-commands)')
  .option('--enable', 'Register Stop hook for self-learning')
  .option('--disable', 'Remove self-learning hook')
  .option('--status', 'Show learning status and observation counts')
  .option('--list', 'Show all observations sorted by confidence')
  .option('--configure', 'Interactive configuration wizard')
  .option('--clear', 'Reset learning log (removes all observations)')
  .option('--purge', 'Remove invalid/corrupted entries from learning log')
  .action(async (options: LearnOptions) => {
    const hasFlag = options.enable || options.disable || options.status || options.list || options.configure || options.clear || options.purge;
    if (!hasFlag) {
      p.intro(color.bgYellow(color.black(' Self-Learning ')));
      p.note(
        `${color.cyan('devflow learn --enable')}      Register learning hook\n` +
        `${color.cyan('devflow learn --disable')}     Remove learning hook\n` +
        `${color.cyan('devflow learn --status')}      Show learning status\n` +
        `${color.cyan('devflow learn --list')}        Show all observations\n` +
        `${color.cyan('devflow learn --configure')}   Configuration wizard\n` +
        `${color.cyan('devflow learn --clear')}       Reset learning log\n` +
        `${color.cyan('devflow learn --purge')}       Remove invalid entries`,
        'Usage',
      );
      p.outro(color.dim('Detects repeated workflows and creates slash commands automatically'));
      return;
    }

    const claudeDir = getClaudeDirectory();
    const settingsPath = path.join(claudeDir, 'settings.json');

    let settingsContent: string;
    try {
      settingsContent = await fs.readFile(settingsPath, 'utf-8');
    } catch {
      if (options.status) {
        p.log.info('Self-learning: disabled (no settings.json found)');
        return;
      }
      settingsContent = '{}';
    }

    // --- --status ---
    if (options.status) {
      const hookEnabled = hasLearningHook(settingsContent);
      const cwd = process.cwd();
      const logPath = path.join(cwd, '.memory', 'learning-log.jsonl');

      let observations: LearningObservation[] = [];
      let invalidCount = 0;
      try {
        const logContent = await fs.readFile(logPath, 'utf-8');
        ({ observations, invalidCount } = loadAndCountObservations(logContent));
      } catch {
        // No log file yet
      }

      const status = formatLearningStatus(observations, hookEnabled);
      p.log.info(status);
      if (invalidCount > 0) {
        p.log.warn(`Note: ${invalidCount} invalid entry(ies) found. Run 'devflow learn --purge' to clean.`);
      }
      return;
    }

    // --- --list ---
    if (options.list) {
      const cwd = process.cwd();
      const logPath = path.join(cwd, '.memory', 'learning-log.jsonl');

      let observations: LearningObservation[] = [];
      let invalidCount = 0;
      try {
        const logContent = await fs.readFile(logPath, 'utf-8');
        ({ observations, invalidCount } = loadAndCountObservations(logContent));
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
      if (invalidCount > 0) {
        p.log.warn(`Note: ${invalidCount} invalid entry(ies) found. Run 'devflow learn --purge' to clean.`);
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

      const debugMode = await p.confirm({
        message: 'Enable debug logging? (logs session content excerpts to ~/.devflow/logs/)',
        initialValue: false,
      });
      if (p.isCancel(debugMode)) {
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
        model: String(model),
        debug: !!debugMode,
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

    // --- --purge ---
    if (options.purge) {
      const cwd = process.cwd();
      const logPath = path.join(cwd, '.memory', 'learning-log.jsonl');

      let logContent: string;
      try {
        logContent = await fs.readFile(logPath, 'utf-8');
      } catch {
        p.log.info('No learning log to purge.');
        return;
      }

      const { observations, invalidCount } = loadAndCountObservations(logContent);

      if (invalidCount === 0) {
        p.log.info('No invalid entries found. Learning log is clean.');
        return;
      }

      const validLines = observations.map(o => JSON.stringify(o));
      await fs.writeFile(logPath, validLines.join('\n') + (validLines.length ? '\n' : ''), 'utf-8');
      p.log.success(`Purged ${invalidCount} invalid entry(ies). ${observations.length} valid observation(s) remain.`);
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
      const settings: Settings = JSON.parse(settingsContent);
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
