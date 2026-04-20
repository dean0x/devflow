import * as fs from 'node:fs';
import * as path from 'node:path';
import { homedir } from 'node:os';
import type { HudConfig, ComponentId } from './types.js';

/**
 * Default HUD components in display order.
 * sessionDuration is intentionally omitted — the component is retained
 * in the type system and render map but excluded from display by default.
 */
export const HUD_COMPONENTS: readonly ComponentId[] = [
  'directory',
  'gitBranch',
  'gitAheadBehind',
  'diffStats',
  'releaseInfo',
  'worktreeCount',
  'model',
  'contextUsage',
  'versionBadge',
  'sessionCost',
  'usageQuota',
  'todoProgress',
  'configCounts',
  'learningCounts',
  'notifications',
];

export function getConfigPath(): string {
  const devflowDir =
    process.env.DEVFLOW_DIR || path.join(process.env.HOME || homedir(), '.devflow');
  return path.join(devflowDir, 'hud.json');
}

export function loadConfig(): HudConfig {
  const configPath = getConfigPath();
  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<HudConfig>;
    return {
      enabled: parsed.enabled !== false,
      detail: parsed.detail === true,
    };
  } catch {
    return { enabled: true, detail: false };
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
  if (config.enabled) return [...HUD_COMPONENTS];
  // Version badge always renders so users see upgrade notifications
  return ['versionBadge'];
}
