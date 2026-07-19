import * as fs from 'fs';
import * as path from 'path';
import { getDevFlowDirectory } from '../targets/claude-code/claude-paths.js';
import { getLearningTuningConfigPath } from './project-paths.js';

/**
 * Closed set of valid model aliases for the Learning agent.
 * Any on-disk value outside this set is silently ignored — parse-don't-validate.
 */
export type LearningModelAlias = 'opus' | 'sonnet' | 'haiku';

const VALID_MODELS = new Set<string>(['opus', 'sonnet', 'haiku']);

function isValidModel(value: unknown): value is LearningModelAlias {
  return typeof value === 'string' && VALID_MODELS.has(value);
}

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
  /** Model alias for the Learning agent. Closed domain: 'opus' | 'sonnet' | 'haiku'. Default: 'opus' */
  model: LearningModelAlias;
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
    const parsed: unknown = JSON.parse(json);
    // Object-shape guard mirrors coerceConfig in feature-config.ts: a JSON
    // array, null, or primitive can't be treated as a config record.
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { ...config };
    }
    const raw = parsed as Record<string, unknown>;
    return {
      // Only accept a model value that belongs to the closed LearningModelAlias domain.
      model: isValidModel(raw.model) ? raw.model : config.model,
      debug: typeof raw.debug === 'boolean' ? raw.debug : config.debug,
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
