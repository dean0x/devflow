import { promises as fs } from 'fs';
import * as path from 'path';

export interface SidecarConfig {
  memory: boolean;
  learning: boolean;
  decisions: boolean;
  knowledge: boolean;
}

const DEFAULT_CONFIG: SidecarConfig = {
  memory: true,
  learning: true,
  decisions: true,
  knowledge: true,
};

export function getConfigPath(projectRoot: string): string {
  return path.join(projectRoot, '.memory', '.sidecar', 'config.json');
}

/**
 * Read the sidecar config for a project root.
 * Returns defaults when the file is missing or unreadable.
 */
export async function readConfig(projectRoot: string): Promise<SidecarConfig> {
  const configPath = getConfigPath(projectRoot);
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
    return { ...DEFAULT_CONFIG };
  }
}

/**
 * Write the sidecar config for a project root.
 * Creates the .memory/.sidecar/ directory if missing.
 */
export async function writeConfig(projectRoot: string, config: SidecarConfig): Promise<void> {
  const configPath = getConfigPath(projectRoot);
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, JSON.stringify(config, null, 2) + '\n', { encoding: 'utf-8', mode: 0o600 });
}

/**
 * Toggle a single feature in the sidecar config.
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
  feature: keyof SidecarConfig,
  enabled: boolean,
): Promise<void> {
  const config = await readConfig(projectRoot);
  await writeConfig(projectRoot, { ...config, [feature]: enabled });
}

/**
 * Check whether a specific sidecar feature is enabled for the given project root.
 */
export async function isFeatureEnabled(
  projectRoot: string,
  feature: keyof SidecarConfig,
): Promise<boolean> {
  const config = await readConfig(projectRoot);
  return config[feature];
}
