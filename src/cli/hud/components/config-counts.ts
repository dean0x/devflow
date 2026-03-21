import * as fs from 'node:fs';
import * as path from 'node:path';
import { homedir } from 'node:os';
import type { ComponentResult, GatherContext, ConfigCountsData } from '../types.js';
import { dim } from '../colors.js';

function countClaudeMdFiles(cwd: string): number {
  let count = 0;
  // Check project CLAUDE.md
  if (fs.existsSync(path.join(cwd, 'CLAUDE.md'))) count++;
  // Check user CLAUDE.md
  const claudeDir =
    process.env.CLAUDE_CONFIG_DIR ||
    path.join(process.env.HOME || homedir(), '.claude');
  if (fs.existsSync(path.join(claudeDir, 'CLAUDE.md'))) count++;
  return count;
}

function countFromSettings(settingsPath: string): {
  mcpServers: number;
  hooks: number;
} {
  try {
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as Record<string, unknown>;
    const mcpServers = settings.mcpServers
      ? Object.keys(settings.mcpServers as Record<string, unknown>).length
      : 0;
    let hooks = 0;
    if (settings.hooks) {
      const hooksObj = settings.hooks as Record<string, unknown>;
      for (const event of Object.values(hooksObj)) {
        if (Array.isArray(event)) hooks += event.length;
      }
    }
    return { mcpServers, hooks };
  } catch {
    return { mcpServers: 0, hooks: 0 };
  }
}

/**
 * Gather configuration counts for the configCounts component.
 * Exported for use by the main HUD entry point.
 */
export function gatherConfigCounts(cwd: string): ConfigCountsData {
  const claudeDir =
    process.env.CLAUDE_CONFIG_DIR ||
    path.join(process.env.HOME || homedir(), '.claude');
  const claudeMdFiles = countClaudeMdFiles(cwd);

  // Count rules (.md/.mdc files in .claude/rules)
  let rules = 0;
  for (const rulesDir of [
    path.join(cwd, '.claude', 'rules'),
    path.join(claudeDir, 'rules'),
  ]) {
    try {
      const files = fs.readdirSync(rulesDir);
      rules += files.filter(
        (f) => f.endsWith('.md') || f.endsWith('.mdc'),
      ).length;
    } catch {
      /* ignore */
    }
  }

  // Aggregate settings from user and project
  const userSettings = countFromSettings(
    path.join(claudeDir, 'settings.json'),
  );
  const projectSettings = countFromSettings(
    path.join(cwd, '.claude', 'settings.json'),
  );

  return {
    claudeMdFiles,
    rules,
    mcpServers: userSettings.mcpServers + projectSettings.mcpServers,
    hooks: userSettings.hooks + projectSettings.hooks,
  };
}

export default async function configCounts(
  ctx: GatherContext,
): Promise<ComponentResult | null> {
  if (!ctx.configCounts) return null;
  const { claudeMdFiles, rules: ruleCount, mcpServers, hooks: hookCount } =
    ctx.configCounts;
  const parts: string[] = [];
  if (claudeMdFiles > 0) parts.push(`${claudeMdFiles} CLAUDE.md`);
  if (ruleCount > 0) parts.push(`${ruleCount} rules`);
  if (mcpServers > 0) parts.push(`${mcpServers} MCPs`);
  if (hookCount > 0) parts.push(`${hookCount} hooks`);
  if (parts.length === 0) return null;
  const label = parts.join(', ');
  return { text: dim(label), raw: label };
}
