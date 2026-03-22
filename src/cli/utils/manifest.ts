import { promises as fs } from 'fs';
import * as path from 'path';

/**
 * Manifest data tracked for each DevFlow installation.
 */
export interface ManifestData {
  version: string;
  plugins: string[];
  scope: 'user' | 'local';
  features: {
    teams: boolean;
    ambient: boolean;
    memory: boolean;
    learn?: boolean;
    hud?: boolean;
  };
  installedAt: string;
  updatedAt: string;
}

/**
 * Read and parse the manifest file. Returns null if missing or corrupt.
 */
export async function readManifest(devflowDir: string): Promise<ManifestData | null> {
  const manifestPath = path.join(devflowDir, 'manifest.json');
  try {
    const content = await fs.readFile(manifestPath, 'utf-8');
    const data = JSON.parse(content) as ManifestData;
    if (
      !data.version ||
      !Array.isArray(data.plugins) ||
      !data.scope ||
      typeof data.features !== 'object' ||
      data.features === null ||
      typeof data.features.teams !== 'boolean' ||
      typeof data.features.ambient !== 'boolean' ||
      typeof data.features.memory !== 'boolean' ||
      typeof data.installedAt !== 'string' ||
      typeof data.updatedAt !== 'string'
    ) {
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

/**
 * Write manifest to disk. Creates parent directory if needed.
 */
export async function writeManifest(devflowDir: string, data: ManifestData): Promise<void> {
  await fs.mkdir(devflowDir, { recursive: true });
  const manifestPath = path.join(devflowDir, 'manifest.json');
  await fs.writeFile(manifestPath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

/**
 * Merge new plugins into existing plugin list (union, no duplicates).
 * Preserves order: existing plugins first, then new ones appended.
 */
export function mergeManifestPlugins(existing: string[], newPlugins: string[]): string[] {
  const merged = [...existing];
  for (const plugin of newPlugins) {
    if (!merged.includes(plugin)) {
      merged.push(plugin);
    }
  }
  return merged;
}

/**
 * Compare two semver strings. Returns -1, 0, or 1.
 * Handles simple x.y.z versions; returns null for unparseable input.
 *
 * Note: Pre-release suffixes (e.g., `-beta.1`, `-rc.2`) are silently ignored.
 * `1.0.0-beta.1` and `1.0.0` compare as equal. Build metadata is also ignored.
 */
function compareSemver(a: string, b: string): number | null {
  const parse = (v: string): number[] => {
    const match = v.match(/^v?(\d+)\.(\d+)\.(\d+)/);
    return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : [];
  };

  const pa = parse(a);
  const pb = parse(b);

  if (pa.length === 0 || pb.length === 0) return null;

  for (let i = 0; i < 3; i++) {
    if (pa[i] > pb[i]) return 1;
    if (pa[i] < pb[i]) return -1;
  }
  return 0;
}

/**
 * Detect upgrade/downgrade/same version status.
 */
export interface UpgradeInfo {
  isUpgrade: boolean;
  isDowngrade: boolean;
  isSameVersion: boolean;
  previousVersion: string | null;
}

/**
 * Resolve the final plugin list for a manifest write.
 * On partial installs (--plugin flag), merge newly installed plugins into
 * the existing manifest's plugin list. On full installs, replace entirely.
 */
export function resolvePluginList(
  installedPluginNames: string[],
  existingManifest: ManifestData | null,
  isPartialInstall: boolean,
): string[] {
  if (existingManifest && isPartialInstall) {
    return mergeManifestPlugins(existingManifest.plugins, installedPluginNames);
  }
  return installedPluginNames;
}

export function detectUpgrade(currentVersion: string, installedVersion: string | null): UpgradeInfo {
  if (!installedVersion) {
    return { isUpgrade: false, isDowngrade: false, isSameVersion: false, previousVersion: null };
  }

  const cmp = compareSemver(currentVersion, installedVersion);
  if (cmp === null) {
    return { isUpgrade: false, isDowngrade: false, isSameVersion: false, previousVersion: installedVersion };
  }
  return {
    isUpgrade: cmp > 0,
    isDowngrade: cmp < 0,
    isSameVersion: cmp === 0,
    previousVersion: installedVersion,
  };
}
