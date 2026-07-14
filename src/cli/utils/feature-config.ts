import * as path from 'path';
import { promises as fs } from 'fs';
import { getFeatureConfigPath } from './project-paths.js';

export interface FeatureConfig {
  memory: boolean;
  learning: boolean;
  knowledge: boolean;
}

const DEFAULT_CONFIG: FeatureConfig = {
  memory: true,
  learning: true,
  knowledge: true,
};

export function getConfigPath(projectRoot: string): string {
  return getFeatureConfigPath(projectRoot);
}

/**
 * Parse and narrow an unknown JSON value into a FeatureConfig, merging onto
 * DEFAULT_CONFIG. Pure function — no I/O, no side effects.
 *
 * Coalesces legacy `decisions` key into `learning` when both are present:
 * `decisions` wins (mirrors the manifest kb→knowledge self-heal in manifest.ts).
 * Silently ignores `autoCommit` — old configs may still contain it.
 *
 * Returns null when `parsed` is not a plain object (caller falls through to
 * the next candidate path).
 */
function coerceConfig(parsed: unknown): FeatureConfig | null {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  const p = parsed as Record<string, unknown>;

  // Coalesce decisions (legacy key) → learning. decisions wins when both present.
  let learning: boolean = DEFAULT_CONFIG.learning;
  if (typeof p.learning === 'boolean') learning = p.learning;
  if (typeof p.decisions === 'boolean') learning = p.decisions; // decisions wins

  return {
    memory: typeof p.memory === 'boolean' ? p.memory : DEFAULT_CONFIG.memory,
    learning,
    knowledge: typeof p.knowledge === 'boolean' ? p.knowledge : DEFAULT_CONFIG.knowledge,
  };
}

/**
 * Read the feature config for a project root.
 * Returns defaults when the file is missing or unreadable.
 * Applies ADR-001 clean-break: .devflow/config.json is the sole source of truth;
 * the consolidate-dream-decisions-to-learning-v1 migration writes it at init time.
 *
 * D37 edge case: a project cloned AFTER the global migration marker is set will
 * have no .devflow/config.json (no migration has ever run for it). readConfig
 * falls through to DEFAULT_CONFIG (all features enabled). This is a bounded,
 * non-fatal silent reset: the user re-disables any features they want off on
 * their next `devflow init` run. The tradeoff is acceptable because:
 * (1) DEFAULT_CONFIG is the safe-to-enable state, (2) re-running `devflow init`
 * is the documented recovery path for fresh clones, and (3) re-adding a sidecar
 * fallback would reintroduce compat code that ADR-001 removed.
 * Recovery: `rm ~/.devflow/migrations.json` forces a re-sweep on next `devflow init`.
 */
export async function readConfig(projectRoot: string): Promise<FeatureConfig> {
  const configPath = getFeatureConfigPath(projectRoot);
  try {
    const config = coerceConfig(JSON.parse(await fs.readFile(configPath, 'utf-8')));
    if (config !== null) return config;
    return { ...DEFAULT_CONFIG };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

/**
 * Write the feature config for a project root.
 * Creates the .devflow/ directory if missing.
 * Uses an atomic temp+rename pattern to prevent partial reads under concurrent writes.
 */
export async function writeConfig(projectRoot: string, config: FeatureConfig): Promise<void> {
  const configPath = getFeatureConfigPath(projectRoot);
  await fs.mkdir(path.join(projectRoot, '.devflow'), { recursive: true });
  const tmpPath = configPath + '.tmp.' + process.pid;
  await fs.writeFile(tmpPath, JSON.stringify(config, null, 2) + '\n', { encoding: 'utf-8', mode: 0o600 });
  await fs.rename(tmpPath, configPath);
}

/**
 * Toggle a single feature in the feature config.
 * Reads current config, applies the change, and writes back.
 *
 * D1: Non-atomic read-modify-write. Concurrent invocations of `updateFeature`
 * could lose each other's writes. Acceptable here because: (a) devflow CLI
 * commands are single-threaded user-initiated actions, and (b) the window is
 * milliseconds on a local filesystem with no concurrent writers in normal use.
 * If concurrent safety is ever required, replace with an atomic file-swap or
 * a lock file.
 */
export async function updateFeature(
  projectRoot: string,
  feature: keyof FeatureConfig,
  enabled: boolean,
): Promise<void> {
  const config = await readConfig(projectRoot);
  await writeConfig(projectRoot, { ...config, [feature]: enabled });
}

/**
 * Check whether a specific feature is enabled for the given project root.
 */
export async function isFeatureEnabled(
  projectRoot: string,
  feature: keyof FeatureConfig,
): Promise<boolean> {
  const config = await readConfig(projectRoot);
  return config[feature];
}
