import * as fs from 'node:fs';
import * as path from 'node:path';
import type { HudConfig, PresetName, ComponentId } from './types.js';

/**
 * Preset definitions mapping preset names to their component lists.
 */
export const PRESETS: Record<PresetName, ComponentId[]> = {
  minimal: ['directory', 'gitBranch', 'model', 'contextUsage'],
  classic: [
    'directory',
    'gitBranch',
    'gitAheadBehind',
    'diffStats',
    'model',
    'contextUsage',
    'versionBadge',
  ],
  standard: [
    'directory',
    'gitBranch',
    'gitAheadBehind',
    'diffStats',
    'model',
    'contextUsage',
    'versionBadge',
    'sessionDuration',
    'usageQuota',
  ],
  full: [
    'directory',
    'gitBranch',
    'gitAheadBehind',
    'diffStats',
    'model',
    'contextUsage',
    'versionBadge',
    'sessionDuration',
    'usageQuota',
    'toolActivity',
    'agentActivity',
    'todoProgress',
    'speed',
    'configCounts',
  ],
};

export const DEFAULT_PRESET: PresetName = 'standard';

/**
 * All valid component IDs for validation.
 */
export const ALL_COMPONENT_IDS: ReadonlySet<string> = new Set<string>(PRESETS.full);

export function getConfigPath(): string {
  const devflowDir =
    process.env.DEVFLOW_DIR || path.join(process.env.HOME || '~', '.devflow');
  return path.join(devflowDir, 'hud.json');
}

export function loadConfig(): HudConfig {
  const configPath = getConfigPath();
  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<HudConfig>;
    const preset =
      parsed.preset && (parsed.preset in PRESETS || parsed.preset === 'custom')
        ? parsed.preset
        : DEFAULT_PRESET;
    const components =
      preset === 'custom' && Array.isArray(parsed.components)
        ? parsed.components.filter((c): c is ComponentId => ALL_COMPONENT_IDS.has(c))
        : PRESETS[preset as PresetName] ?? PRESETS[DEFAULT_PRESET];
    return { preset, components };
  } catch {
    return { preset: DEFAULT_PRESET, components: PRESETS[DEFAULT_PRESET] };
  }
}

export function saveConfig(config: HudConfig): void {
  const configPath = getConfigPath();
  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
}

export function resolveComponents(config: HudConfig): ComponentId[] {
  if (config.preset === 'custom') {
    return config.components;
  }
  return PRESETS[config.preset as PresetName] ?? PRESETS[DEFAULT_PRESET];
}
