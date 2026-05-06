import * as fs from 'fs';
import * as path from 'path';
import { getDevFlowDirectory } from './paths.js';

/**
 * Merged decisions agent configuration from global and project-level config files.
 *
 * Mirrors the shape of LearningConfig in learn.ts — decisions agent is a sibling
 * pipeline with the same runtime knobs (model, throttle, daily cap, debug, batch).
 */
export interface DecisionsConfig {
  /** Maximum number of background runs per day. Default: 3 */
  max_daily_runs: number;
  /** Minimum minutes between consecutive runs. Default: 5 */
  throttle_minutes: number;
  /** Model alias passed to claude -p. Default: 'sonnet' */
  model: string;
  /** Emit verbose logs when true. Default: false */
  debug: boolean;
  /** Observations processed per run. Default: 1 */
  batch_size: number;
}

/**
 * Default decisions agent config values.
 *
 * batch_size defaults to 1 (decisions/pitfalls are high-signal, low-volume).
 */
const DEFAULTS: DecisionsConfig = {
  max_daily_runs: 3,
  throttle_minutes: 5,
  model: 'sonnet',
  debug: false,
  batch_size: 1,
};

/**
 * Apply a single JSON config layer onto a DecisionsConfig, returning a new object.
 * Skips fields with wrong types. Swallows parse errors — callers see defaults.
 */
export function applyDecisionsConfigLayer(
  config: DecisionsConfig,
  json: string,
): DecisionsConfig {
  try {
    const raw = JSON.parse(json) as Record<string, unknown>;
    return {
      max_daily_runs:
        typeof raw.max_daily_runs === 'number'
          ? raw.max_daily_runs
          : config.max_daily_runs,
      throttle_minutes:
        typeof raw.throttle_minutes === 'number'
          ? raw.throttle_minutes
          : config.throttle_minutes,
      model:
        typeof raw.model === 'string' ? raw.model : config.model,
      debug:
        typeof raw.debug === 'boolean' ? raw.debug : config.debug,
      batch_size:
        typeof raw.batch_size === 'number'
          ? raw.batch_size
          : config.batch_size,
    };
  } catch {
    return { ...config };
  }
}

/**
 * Read a JSON config file and return its contents as a string, or null if absent.
 * Returns null (not throws) on ENOENT or any other read error.
 */
function readConfigFile(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      // Warn but don't crash — callers fall back to defaults.
      console.warn(
        `[decisions-config] warning: could not read ${filePath}: ${(err as Error).message}`,
      );
    }
    return null;
  }
}

/**
 * Load and merge decisions agent configuration.
 *
 * Priority (highest wins): project config → global config → defaults.
 *
 * - Global:  `~/.devflow/decisions.json`
 * - Project: `<cwd>/.memory/decisions.json`
 *
 * Invalid JSON in either file is silently ignored and treated as absent.
 */
export function loadDecisionsConfig(cwd: string): DecisionsConfig {
  const globalConfigPath = path.join(getDevFlowDirectory(), 'decisions.json');
  const projectConfigPath = path.join(cwd, '.memory', 'decisions.json');

  let config: DecisionsConfig = { ...DEFAULTS };

  const globalJson = readConfigFile(globalConfigPath);
  if (globalJson !== null) {
    config = applyDecisionsConfigLayer(config, globalJson);
  }

  const projectJson = readConfigFile(projectConfigPath);
  if (projectJson !== null) {
    config = applyDecisionsConfigLayer(config, projectJson);
  }

  return config;
}
