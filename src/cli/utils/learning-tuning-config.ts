import * as fs from 'fs';
import * as path from 'path';
import { getDevFlowDirectory } from './paths.js';
import { getLearningTuningConfigPath } from './project-paths.js';

/**
 * Merged learning agent tuning configuration from global and project-level config files.
 *
 * The Learning agent has no daily-run cap or throttle: session-start-context emits
 * its spawn directive only when the learning queue is non-empty (or a stale
 * .processing batch exists), so queue emptiness is the natural gate.
 * session-start-context reads these config files directly (same project →
 * global → default precedence) when resolving the model for the directive.
 */
export interface LearningTuningConfig {
  /** Model alias for the Learning agent. Default: 'opus' */
  model: string;
  /** Emit verbose logs when true. Default: false */
  debug: boolean;
}

const DEFAULTS: LearningTuningConfig = {
  model: 'opus',
  debug: false,
};

/**
 * Apply a single JSON config layer onto a LearningTuningConfig, returning a new object.
 * Skips fields with wrong types. Swallows parse errors — callers see defaults.
 * Unknown fields (e.g. an old config still on disk with extra knobs) are
 * silently ignored, not an error.
 */
export function applyLearningTuningConfigLayer(
  config: LearningTuningConfig,
  json: string,
): LearningTuningConfig {
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
        `[learning-tuning-config] warning: could not read ${filePath}: ${(err as Error).message}`,
      );
    }
    return null;
  }
}

/**
 * Load and merge learning agent tuning configuration.
 *
 * Priority (highest wins): project config → global config → defaults.
 *
 * - Global:  `~/.devflow/learning.json`
 * - Project: `<cwd>/.devflow/learning/learning.json`
 *
 * Invalid JSON in either file is silently ignored and treated as absent.
 */
export function loadLearningTuningConfig(cwd: string): LearningTuningConfig {
  const globalConfigPath = path.join(getDevFlowDirectory(), 'learning.json');
  const projectConfigPath = getLearningTuningConfigPath(cwd);

  let config: LearningTuningConfig = { ...DEFAULTS };

  const globalJson = readConfigFile(globalConfigPath);
  if (globalJson !== null) {
    config = applyLearningTuningConfigLayer(config, globalJson);
  }

  const projectJson = readConfigFile(projectConfigPath);
  if (projectJson !== null) {
    config = applyLearningTuningConfigLayer(config, projectJson);
  }

  return config;
}
