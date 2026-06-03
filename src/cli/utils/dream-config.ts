import { promises as fs } from 'fs';
import * as path from 'path';
import { getDreamConfigPath, getDreamDir } from './project-paths.js';

export interface DreamConfig {
  memory: boolean;
  learning: boolean;
  decisions: boolean;
  knowledge: boolean;
}

/**
 * @deprecated Use DreamConfig instead.
 */
export type SidecarConfig = DreamConfig;

const DEFAULT_CONFIG: DreamConfig = {
  memory: true,
  learning: true,
  decisions: true,
  knowledge: true,
};

export function getConfigPath(projectRoot: string): string {
  return getDreamConfigPath(projectRoot);
}

/**
 * Read the dream config for a project root.
 * Returns defaults when the file is missing or unreadable.
 *
 * TODO(dream-fallback): if dream/config.json is absent, fall back to legacy
 * sidecar/config.json before returning all-true defaults. Removable after one release.
 */
export async function readConfig(projectRoot: string): Promise<DreamConfig> {
  const configPath = getDreamConfigPath(projectRoot);
  try {
    const raw = await fs.readFile(configPath, 'utf-8');
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return { ...DEFAULT_CONFIG };
    const p = parsed as Record<string, unknown>;
    return {
      memory: typeof p.memory === 'boolean' ? p.memory : DEFAULT_CONFIG.memory,
      learning: typeof p.learning === 'boolean' ? p.learning : DEFAULT_CONFIG.learning,
      decisions: typeof p.decisions === 'boolean' ? p.decisions : DEFAULT_CONFIG.decisions,
      knowledge: typeof p.knowledge === 'boolean' ? p.knowledge : DEFAULT_CONFIG.knowledge,
    };
  } catch {
    // TODO(dream-fallback): fall back to legacy sidecar/config.json if dream/config.json absent
    const legacyPath = path.join(projectRoot, '.devflow', 'sidecar', 'config.json');
    try {
      const raw = await fs.readFile(legacyPath, 'utf-8');
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return { ...DEFAULT_CONFIG };
      const p = parsed as Record<string, unknown>;
      return {
        memory: typeof p.memory === 'boolean' ? p.memory : DEFAULT_CONFIG.memory,
        learning: typeof p.learning === 'boolean' ? p.learning : DEFAULT_CONFIG.learning,
        decisions: typeof p.decisions === 'boolean' ? p.decisions : DEFAULT_CONFIG.decisions,
        knowledge: typeof p.knowledge === 'boolean' ? p.knowledge : DEFAULT_CONFIG.knowledge,
      };
    } catch {
      return { ...DEFAULT_CONFIG };
    }
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
