import { promises as fs } from 'fs';
import * as path from 'path';
import { LEGACY_PLUGIN_NAMES } from '../plugins.js';
import { VIEW_MODES, ViewMode } from './flags.js';

/**
 * Manifest data tracked for each Devflow installation.
 */
export interface ManifestData {
  version: string;
  plugins: string[];
  scope: 'user' | 'local';
  features: {
    ambient: boolean;
    memory: boolean;
    hud: boolean;
    knowledge: boolean;
    decisions: boolean;
    rules: boolean;
    flags: string[];
    viewMode?: ViewMode;
    /**
     * Security deny list location. 'user' = ~/.claude/settings.json,
     * 'managed' = system-level managed settings, 'none' = not installed.
     * Absent in pre-Phase-F manifests — readManifest defaults to undefined (unknown).
     */
    security?: 'none' | 'user' | 'managed';
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
    const data = JSON.parse(content) as Record<string, unknown>;
    const features = data.features as Record<string, unknown> | undefined;
    if (
      !data.version ||
      !Array.isArray(data.plugins) ||
      !data.scope ||
      typeof features !== 'object' ||
      features === null ||
      typeof features.ambient !== 'boolean' ||
      typeof features.memory !== 'boolean' ||
      typeof data.installedAt !== 'string' ||
      typeof data.updatedAt !== 'string'
    ) {
      return null;
    }
    // Self-heal: rename features.kb → features.knowledge on disk
    const knowledge = typeof features.knowledge === 'boolean' ? features.knowledge
      : typeof features.kb === 'boolean' ? features.kb as boolean
      : false;
    const needsHeal = features.kb !== undefined;

    const SECURITY_MODES = ['none', 'user', 'managed'] as const;
    type SecurityMode = 'none' | 'user' | 'managed';

    const manifest: ManifestData = {
      version: data.version as string,
      plugins: data.plugins as string[],
      scope: data.scope as 'user' | 'local',
      features: {
        ambient: features.ambient as boolean,
        memory: features.memory as boolean,
        hud: typeof features.hud === 'boolean' ? features.hud : false,
        knowledge,
        decisions: typeof features.decisions === 'boolean' ? features.decisions : false,
        rules: typeof features.rules === 'boolean' ? features.rules : true,
        flags: Array.isArray(features.flags) ? features.flags as string[] : [],
        viewMode: typeof features.viewMode === 'string' && (VIEW_MODES as readonly string[]).includes(features.viewMode)
          ? features.viewMode as ViewMode
          : undefined,
        security: typeof features.security === 'string' && (SECURITY_MODES as readonly string[]).includes(features.security)
          ? features.security as SecurityMode
          : undefined,
      },
      installedAt: data.installedAt as string,
      updatedAt: data.updatedAt as string,
    };

    if (needsHeal) {
      await writeManifest(devflowDir, manifest);
    }

    return manifest;
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
 * Update a single feature field in the manifest. No-op when no manifest exists.
 * Reads, mutates, and writes atomically. The `updatedAt` timestamp is always refreshed.
 *
 * Use this in toggle commands (ambient, hud, memory, decisions, security) instead of
 * the repeated read → if-exists → mutate → write pattern.
 */
export async function syncManifestFeature<K extends keyof ManifestData['features']>(
  devflowDir: string,
  key: K,
  value: ManifestData['features'][K],
): Promise<void> {
  const manifest = await readManifest(devflowDir);
  if (!manifest) return;
  manifest.features[key] = value;
  manifest.updatedAt = new Date().toISOString();
  await writeManifest(devflowDir, manifest);
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
    const cleaned = existingManifest.plugins.map(p => LEGACY_PLUGIN_NAMES[p] ?? p);
    return mergeManifestPlugins(cleaned, installedPluginNames);
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
