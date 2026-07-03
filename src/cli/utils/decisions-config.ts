import * as fs from 'fs';
import * as path from 'path';
import { getDevFlowDirectory } from './paths.js';
import { getDecisionsConfigPath } from './project-paths.js';

/**
 * Merged decisions agent configuration from global and project-level config files.
 *
 * The background dream worker (background-dream-update, spawned by spawn-dream-worker)
 * has no daily-run cap or throttle of its own — it is gated by queue non-emptiness
 * (spawn-dream-worker only spawns when the dream queue is non-empty or a leftover
 * .processing batch exists) rather than a fixed daily/minute budget, so those knobs
 * were dropped in the dream-system simplification.
 */
export interface DecisionsConfig {
  /** Model alias for the detached dream worker. Default: 'opus' */
  model: string;
  /** Emit verbose logs when true. Default: false */
  debug: boolean;
}

const DEFAULTS: DecisionsConfig = {
  model: 'opus',
  debug: false,
};

/**
 * Apply a single JSON config layer onto a DecisionsConfig, returning a new object.
 * Skips fields with wrong types. Swallows parse errors — callers see defaults.
 * Unknown/dropped fields (e.g. a pre-simplification config still on disk with
 * max_daily_runs/throttle_minutes) are silently ignored, not an error.
 */
export function applyDecisionsConfigLayer(
  config: DecisionsConfig,
  json: string,
): DecisionsConfig {
  try {
    const raw = JSON.parse(json) as Record<string, unknown>;
    return {
      model:
        typeof raw.model === 'string' ? raw.model : config.model,
      debug:
        typeof raw.debug === 'boolean' ? raw.debug : config.debug,
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
 * - Project: `<cwd>/.devflow/decisions/decisions.json`
 *
 * Invalid JSON in either file is silently ignored and treated as absent.
 */
export function loadDecisionsConfig(cwd: string): DecisionsConfig {
  const globalConfigPath = path.join(getDevFlowDirectory(), 'decisions.json');
  const projectConfigPath = getDecisionsConfigPath(cwd);

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
