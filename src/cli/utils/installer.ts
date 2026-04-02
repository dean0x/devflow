import { promises as fs } from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import type { PluginDefinition } from '../plugins.js';
import { DEVFLOW_PLUGINS, LEGACY_AGENT_NAMES, prefixSkillName } from '../plugins.js';

/**
 * Minimal spinner interface matching @clack/prompts spinner().
 */
export interface Spinner {
  start(msg?: string): void;
  stop(msg?: string, code?: number): void;
  message(msg?: string): void;
}

/**
 * Recursively copy a directory tree.
 */
export async function copyDirectory(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      await copyDirectory(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

/**
 * Recursively chmod all files in a directory tree.
 */
export async function chmodRecursive(dir: string, mode: number): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await chmodRecursive(fullPath, mode);
    } else if (entry.isFile()) {
      await fs.chmod(fullPath, mode);
    }
  }
}

/**
 * Add DevFlow marketplace to Claude CLI.
 * Idempotent — safe to call multiple times.
 */
function addMarketplaceViaCli(): boolean {
  try {
    execSync('claude plugin marketplace add dean0x/devflow', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Install a single plugin via Claude CLI.
 */
function installPluginViaCli(pluginName: string, scope: 'user' | 'local'): boolean {
  try {
    const cliScope = scope === 'local' ? 'project' : 'user';
    execSync(`claude plugin install ${pluginName}@dean0x-devflow --scope ${cliScope}`, {
      stdio: 'pipe',
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Install plugins via Claude CLI native plugin system.
 * Returns true if all plugins installed successfully.
 */
export function installViaCli(
  plugins: PluginDefinition[],
  scope: 'user' | 'local',
  spinner: Spinner,
): boolean {
  spinner.message('Adding DevFlow marketplace...');
  const marketplaceAdded = addMarketplaceViaCli();

  if (!marketplaceAdded) return false;

  spinner.message('Installing plugins via Claude CLI...');
  for (const plugin of plugins) {
    if (!installPluginViaCli(plugin.name, scope)) return false;
  }

  spinner.stop('Plugins installed via Claude CLI');
  return true;
}

export interface FileCopyOptions {
  plugins: PluginDefinition[];
  claudeDir: string;
  pluginsDir: string;
  rootDir: string;
  devflowDir: string;
  skillsMap: Map<string, string>;
  agentsMap: Map<string, string>;
  isPartialInstall: boolean;
  teamsEnabled: boolean;
  spinner: Spinner;
}

/**
 * Install plugins via manual file copy.
 * Handles cleanup of old monolithic structure, deduplication of shared assets,
 * and script installation with executable permissions.
 */
export async function installViaFileCopy(options: FileCopyOptions): Promise<void> {
  const {
    plugins,
    claudeDir,
    pluginsDir,
    rootDir,
    devflowDir,
    skillsMap,
    agentsMap,
    isPartialInstall,
    teamsEnabled,
    spinner,
  } = options;

  // Clean old DevFlow files before installing
  spinner.message('Cleaning old files...');
  if (!isPartialInstall) {
    // Commands and agents are plugin-scoped — only wipe on full install
    const oldDirs = [
      path.join(claudeDir, 'commands', 'devflow'),
      path.join(claudeDir, 'agents', 'devflow'),
    ];
    for (const dir of oldDirs) {
      try {
        await fs.rm(dir, { recursive: true, force: true });
      } catch { /* ignore */ }
    }
  }

  // Skills are universally installed — always clean both naming variants
  // to prevent duplicates (bare + prefixed) on upgrade or partial install
  const allSkills = new Set<string>();
  for (const plugin of DEVFLOW_PLUGINS) {
    for (const skill of plugin.skills) {
      allSkills.add(skill);
    }
  }
  for (const skill of allSkills) {
    // Remove legacy unprefixed directory
    try {
      await fs.rm(path.join(claudeDir, 'skills', skill), { recursive: true, force: true });
    } catch { /* ignore */ }
    // Remove prefixed directory (will be re-created during install phase)
    try {
      await fs.rm(path.join(claudeDir, 'skills', prefixSkillName(skill)), { recursive: true, force: true });
    } catch { /* ignore */ }
  }

  // Install commands and agents from selected plugins (with deduplication)
  spinner.message('Installing commands and agents...');
  for (const plugin of plugins) {
    const pluginSourceDir = path.join(pluginsDir, plugin.name);

    // Install commands (variant-aware: pick -teams.md or base .md)
    const commandsSource = path.join(pluginSourceDir, 'commands');
    const commandsTarget = path.join(claudeDir, 'commands', 'devflow');
    try {
      const allFiles = await fs.readdir(commandsSource);
      const mdFiles = allFiles.filter(f => f.endsWith('.md'));
      const teamsVariants = new Set(mdFiles.filter(f => f.endsWith('-teams.md')));
      const baseCommands = mdFiles.filter(f => !teamsVariants.has(f));

      if (baseCommands.length > 0 || teamsVariants.size > 0) {
        await fs.mkdir(commandsTarget, { recursive: true });
        for (const file of baseCommands) {
          const teamsFile = file.replace('.md', '-teams.md');
          const sourceFile = (teamsEnabled && teamsVariants.has(teamsFile)) ? teamsFile : file;
          await fs.copyFile(
            path.join(commandsSource, sourceFile),
            path.join(commandsTarget, file), // always install as base name
          );
        }
      }
    } catch { /* no commands directory */ }

    // Install agents (deduplicated)
    const agentsSource = path.join(pluginSourceDir, 'agents');
    const agentsTarget = path.join(claudeDir, 'agents', 'devflow');
    try {
      const files = await fs.readdir(agentsSource);
      if (files.length > 0) {
        await fs.mkdir(agentsTarget, { recursive: true });
        for (const file of files) {
          const agentName = path.basename(file, '.md');
          if (agentsMap.get(agentName) === plugin.name) {
            await fs.copyFile(
              path.join(agentsSource, file),
              path.join(agentsTarget, file),
            );
          }
        }
      }
    } catch { /* no agents directory */ }
  }

  // Clean up legacy agent files (renamed or removed agents from prior versions)
  const agentsTarget = path.join(claudeDir, 'agents', 'devflow');
  for (const legacyAgent of LEGACY_AGENT_NAMES) {
    try {
      await fs.rm(path.join(agentsTarget, `${legacyAgent}.md`), { force: true });
    } catch { /* ignore */ }
  }

  // Install skills from ALL plugins (skillsMap covers all plugins, not just selected).
  // Skills are tiny markdown files — universal install ensures orchestration skills
  // can spawn agents that depend on skills from other plugins.
  spinner.message('Installing skills...');
  for (const [skillName, ownerPlugin] of skillsMap) {
    const skillSource = path.join(pluginsDir, ownerPlugin, 'skills', skillName);
    try {
      const stat = await fs.stat(skillSource);
      if (!stat.isDirectory()) continue;
    } catch { continue; /* skill dir doesn't exist in built plugin */ }

    // Shadow check: ~/.devflow/skills/{unprefixed-name}/
    // If shadowed with actual content, copy user's version instead of DevFlow source
    const shadowDir = path.join(devflowDir, 'skills', skillName);
    const prefixedName = prefixSkillName(skillName);
    const skillTarget = path.join(claudeDir, 'skills', prefixedName);

    let isShadowed = false;
    try {
      const stat = await fs.stat(shadowDir);
      if (stat.isDirectory()) {
        const entries = await fs.readdir(shadowDir);
        isShadowed = entries.length > 0;
      }
    } catch { /* no shadow */ }

    if (isShadowed) {
      await copyDirectory(shadowDir, skillTarget);
    } else {
      await copyDirectory(skillSource, skillTarget);
    }
  }

  // Install scripts (always from root scripts/ directory)
  spinner.message('Installing scripts...');
  const scriptsSource = path.join(rootDir, 'scripts');
  const scriptsTarget = path.join(devflowDir, 'scripts');
  try {
    await fs.mkdir(scriptsTarget, { recursive: true });
    await copyDirectory(scriptsSource, scriptsTarget);
    if (process.platform !== 'win32') {
      await chmodRecursive(scriptsTarget, 0o755);
    }
  } catch { /* scripts may not exist */ }

  spinner.stop('Components installed via file copy');
}
