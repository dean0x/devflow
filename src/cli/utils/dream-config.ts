import { promises as fs } from 'fs';
import { getDreamConfigPath, getDreamDir } from './project-paths.js';

export interface DreamConfig {
  memory: boolean;
  decisions: boolean;
  knowledge: boolean;
  /**
   * When true (default), Dream tasks auto-commit maintenance writes to .devflow/ using
   * the `dream-commit` helper. Greppable via `git log --grep 'chore(dream)'`.
   * Set to false to disable Dream auto-commits project-wide.
   * Single source of truth: .devflow/dream/config.json (key: autoCommit, default: true).
   */
  autoCommit: boolean;
}

const DEFAULT_CONFIG: DreamConfig = {
  memory: true,
  decisions: true,
  knowledge: true,
  autoCommit: true,
};

export function getConfigPath(projectRoot: string): string {
  return getDreamConfigPath(projectRoot);
}

/**
 * Parse and narrow an unknown JSON value into a DreamConfig, merging onto
 * DEFAULT_CONFIG. Pure function — no I/O, no side effects.
 *
 * Returns null when `parsed` is not a plain object (caller falls through to
 * the next candidate path).
 */
function coerceConfig(parsed: unknown): DreamConfig | null {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  const p = parsed as Record<string, unknown>;
  // Silently ignore legacy `learning` key — old configs may still contain it
  return {
    memory: typeof p.memory === 'boolean' ? p.memory : DEFAULT_CONFIG.memory,
    decisions: typeof p.decisions === 'boolean' ? p.decisions : DEFAULT_CONFIG.decisions,
    knowledge: typeof p.knowledge === 'boolean' ? p.knowledge : DEFAULT_CONFIG.knowledge,
    autoCommit: typeof p.autoCommit === 'boolean' ? p.autoCommit : DEFAULT_CONFIG.autoCommit,
  };
}

/**
 * Read the dream config for a project root.
 * Returns defaults when the file is missing or unreadable.
 * Applies ADR-001 clean-break: dream/config.json is the sole source of truth;
 * the rename-sidecar-to-dream-v1 migration moves sidecar/config.json at init time.
 *
 * D37 edge case: a project cloned AFTER the global migration marker is set will
 * have neither sidecar/config.json nor dream/config.json (no migration has ever
 * run for it). readConfig falls through to DEFAULT_CONFIG (all features enabled).
 * This is a bounded, non-fatal silent reset: the user re-disables any features
 * they want off on their next `devflow init` run. The tradeoff is acceptable
 * because: (1) DEFAULT_CONFIG is the safe-to-enable state, (2) re-running
 * `devflow init` is the documented recovery path for fresh clones, and (3)
 * re-adding a sidecar fallback would reintroduce compat code that ADR-001 removed.
 * Recovery: `rm ~/.devflow/migrations.json` forces a re-sweep on next `devflow init`.
 */
export async function readConfig(projectRoot: string): Promise<DreamConfig> {
  const configPath = getDreamConfigPath(projectRoot);
  try {
    const config = coerceConfig(JSON.parse(await fs.readFile(configPath, 'utf-8')));
    if (config !== null) return config;
    return { ...DEFAULT_CONFIG };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

/**
 * Write the dream config for a project root.
 * Creates the .devflow/dream/ directory if missing.
 * Uses an atomic temp+rename pattern to prevent partial reads under concurrent writes.
 */
export async function writeConfig(projectRoot: string, config: DreamConfig): Promise<void> {
  const configPath = getDreamConfigPath(projectRoot);
  await fs.mkdir(getDreamDir(projectRoot), { recursive: true });
  const tmpPath = configPath + '.tmp.' + process.pid;
  await fs.writeFile(tmpPath, JSON.stringify(config, null, 2) + '\n', { encoding: 'utf-8', mode: 0o600 });
  await fs.rename(tmpPath, configPath);
}

/**
 * Toggle a single feature in the dream config.
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
  feature: keyof DreamConfig,
  enabled: boolean,
): Promise<void> {
  const config = await readConfig(projectRoot);
  await writeConfig(projectRoot, { ...config, [feature]: enabled });
}

/**
 * Check whether a specific dream feature is enabled for the given project root.
 */
export async function isFeatureEnabled(
  projectRoot: string,
  feature: keyof DreamConfig,
): Promise<boolean> {
  const config = await readConfig(projectRoot);
  return config[feature];
}
