import { promises as fs } from 'fs';
import * as path from 'path';
import type { PluginDefinition } from '../plugins.js';
import { DEVFLOW_PLUGINS, LEGACY_AGENT_NAMES, prefixSkillName } from '../plugins.js';

// ---------------------------------------------------------------------------
// Shadow override reporting types
// ---------------------------------------------------------------------------

export type ShadowSkipReason = 'missing-skill-md' | 'empty-shadow-file' | 'not-a-file';

export interface ShadowSkip {
  kind: 'skill' | 'rule';
  name: string;
  reason: ShadowSkipReason;
}

export interface InstallReport {
  shadowedSkills: string[];
  shadowedRules: string[];
  skippedShadows: ShadowSkip[];
}

export type RuleInstallOutcome = 'shadow' | 'source' | 'source-invalid-shadow' | 'skipped';

// ---------------------------------------------------------------------------
// Shadow validation helpers (exported — reused by Step 4 list commands)
// ---------------------------------------------------------------------------

/**
 * Validate a skill shadow directory at `~/.devflow/skills/{name}/`.
 *
 * Returns:
 *   'none'            — shadow dir is absent (no override configured)
 *   'valid'           — dir exists and contains a non-empty SKILL.md file
 *   'missing-skill-md'— dir exists but SKILL.md is absent, empty, or not a file
 */
export async function validateSkillShadow(
  shadowDir: string,
): Promise<'valid' | 'missing-skill-md' | 'none'> {
  try {
    const dirStat = await fs.stat(shadowDir);
    if (!dirStat.isDirectory()) return 'missing-skill-md';
  } catch {
    return 'none';
  }

  try {
    const skillMd = path.join(shadowDir, 'SKILL.md');
    const stat = await fs.stat(skillMd);
    if (stat.isFile() && stat.size > 0) return 'valid';
    return 'missing-skill-md';
  } catch {
    return 'missing-skill-md';
  }
}

/**
 * Validate a rule shadow file at `~/.devflow/rules/{name}.md`.
 *
 * Returns:
 *   'none'               — shadow file is absent
 *   'valid'              — shadow file exists, is a regular file, and is non-empty
 *   'empty-shadow-file'  — shadow file exists and is a file but has size 0
 *   'not-a-file'         — path exists but is not a file (e.g. a directory)
 *
 * D: The isFile() guard is load-bearing. Without it, a directory at the shadow
 * path passes the size > 0 check but copyFile throws EISDIR inside the rules
 * Promise.all (installer.ts rules block — no per-call catch), aborting init.
 * fs.stat follows symlinks: symlink → regular file = valid; symlink → dir = not-a-file.
 */
export async function validateRuleShadow(
  shadowFile: string,
): Promise<'valid' | 'empty-shadow-file' | 'not-a-file' | 'none'> {
  try {
    const stat = await fs.stat(shadowFile);
    if (!stat.isFile()) return 'not-a-file';
    if (stat.size === 0) return 'empty-shadow-file';
    return 'valid';
  } catch {
    return 'none';
  }
}

// ---------------------------------------------------------------------------
// Rule installer
// ---------------------------------------------------------------------------

/**
 * Install a single rule file, respecting the shadow override at
 * ~/.devflow/rules/{name}.md over the built plugin source.
 *
 * Returns the installation outcome so callers can aggregate reporting.
 * Skips silently (returns 'skipped') if the source file does not exist.
 */
export async function installRuleFile(
  ruleName: string,
  ownerPlugin: string,
  pluginsDir: string,
  devflowDir: string,
  rulesTarget: string,
): Promise<RuleInstallOutcome> {
  const shadowFile = path.join(devflowDir, 'rules', `${ruleName}.md`);
  const targetFile = path.join(rulesTarget, `${ruleName}.md`);
  const ruleSource = path.join(pluginsDir, ownerPlugin, 'rules', `${ruleName}.md`);

  const shadowState = await validateRuleShadow(shadowFile);

  if (shadowState === 'valid') {
    await fs.copyFile(shadowFile, targetFile);
    return 'shadow';
  }

  // Shadow exists but is invalid — fall through to source, report the issue
  const isInvalidShadow = shadowState === 'empty-shadow-file' || shadowState === 'not-a-file';

  try {
    await fs.access(ruleSource);
    await fs.copyFile(ruleSource, targetFile);
    return isInvalidShadow ? 'source-invalid-shadow' : 'source';
  } catch {
    return 'skipped'; /* source missing — skip silently */
  }
}

// ---------------------------------------------------------------------------
// Spinner interface
// ---------------------------------------------------------------------------

/**
 * Minimal spinner interface matching @clack/prompts spinner().
 */
export interface Spinner {
  start(msg?: string): void;
  stop(msg?: string, code?: number): void;
  message(msg?: string): void;
}

// ---------------------------------------------------------------------------
// Directory utilities
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// File copy installer
// ---------------------------------------------------------------------------

export interface FileCopyOptions {
  plugins: PluginDefinition[];
  claudeDir: string;
  pluginsDir: string;
  rootDir: string;
  devflowDir: string;
  skillsMap: Map<string, string>;
  agentsMap: Map<string, string>;
  /** Rules to install from selected plugins. Defaults to empty map (no rules). */
  rulesMap?: Map<string, string>;
  isPartialInstall: boolean;
  spinner: Spinner;
}

/**
 * Install plugins via manual file copy.
 * Handles cleanup of old monolithic structure, deduplication of shared assets,
 * and script installation with executable permissions.
 *
 * Returns an InstallReport describing which shadows were applied and which were skipped.
 */
export async function installViaFileCopy(options: FileCopyOptions): Promise<InstallReport> {
  const {
    plugins,
    claudeDir,
    pluginsDir,
    rootDir,
    devflowDir,
    skillsMap,
    agentsMap,
    rulesMap = new Map<string, string>(),
    isPartialInstall,
    spinner,
  } = options;

  const report: InstallReport = {
    shadowedSkills: [],
    shadowedRules: [],
    skippedShadows: [],
  };

  // Clean old Devflow files before installing
  spinner.message('Cleaning old files...');
  if (!isPartialInstall) {
    // Commands and agents are plugin-scoped — only wipe on full install
    const oldDirs = [
      path.join(claudeDir, 'commands', 'devflow'),
      path.join(claudeDir, 'agents', 'devflow'),
      path.join(claudeDir, 'rules', 'devflow'),
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
  const agentsTarget = path.join(claudeDir, 'agents', 'devflow');
  for (const plugin of plugins) {
    const pluginSourceDir = path.join(pluginsDir, plugin.name);

    // Install commands (every .md file — one variant per command)
    const commandsSource = path.join(pluginSourceDir, 'commands');
    const commandsTarget = path.join(claudeDir, 'commands', 'devflow');
    try {
      const allFiles = await fs.readdir(commandsSource);
      const commandFiles = allFiles.filter(f => f.endsWith('.md'));

      if (commandFiles.length > 0) {
        await fs.mkdir(commandsTarget, { recursive: true });
        for (const file of commandFiles) {
          await fs.copyFile(
            path.join(commandsSource, file),
            path.join(commandsTarget, file),
          );
        }
      }
    } catch { /* no commands directory */ }

    // Install agents (deduplicated)
    const agentsSource = path.join(pluginSourceDir, 'agents');
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
  for (const legacyAgent of LEGACY_AGENT_NAMES) {
    try {
      await fs.rm(path.join(agentsTarget, `${legacyAgent}.md`), { force: true });
    } catch { /* ignore */ }
  }

  // Install skills from ALL plugins (skillsMap covers all plugins, not just selected).
  // Skills are tiny markdown files — universal install ensures commands
  // can spawn agents that depend on skills from other plugins.
  spinner.message('Installing skills...');
  for (const [skillName, ownerPlugin] of skillsMap) {
    const skillSource = path.join(pluginsDir, ownerPlugin, 'skills', skillName);
    try {
      const stat = await fs.stat(skillSource);
      if (!stat.isDirectory()) continue;
    } catch { continue; /* skill dir doesn't exist in built plugin */ }

    const shadowDir = path.join(devflowDir, 'skills', skillName);
    const prefixedName = prefixSkillName(skillName);
    const skillTarget = path.join(claudeDir, 'skills', prefixedName);

    const shadowState = await validateSkillShadow(shadowDir);

    if (shadowState === 'valid') {
      await copyDirectory(shadowDir, skillTarget);
      report.shadowedSkills.push(skillName);
    } else if (shadowState === 'missing-skill-md') {
      // Shadow dir exists but is invalid — warn + install Devflow source
      report.skippedShadows.push({ kind: 'skill', name: skillName, reason: 'missing-skill-md' });
      await copyDirectory(skillSource, skillTarget);
    } else {
      // 'none' — no shadow, install source silently
      await copyDirectory(skillSource, skillTarget);
    }
  }

  // Install rules from selected plugins (rulesMap covers selected plugins only).
  // Rules are flat .md files — no prefix, no directory nesting.
  // Shadow: ~/.devflow/rules/{name}.md overrides source.
  spinner.message('Installing rules...');
  const rulesTarget = path.join(claudeDir, 'rules', 'devflow');
  if (rulesMap.size > 0) {
    await fs.mkdir(rulesTarget, { recursive: true });
    const outcomes = await Promise.all(
      [...rulesMap.entries()].map(async ([ruleName, ownerPlugin]) => {
        const outcome = await installRuleFile(ruleName, ownerPlugin, pluginsDir, devflowDir, rulesTarget);
        return { ruleName, outcome };
      }),
    );
    for (const { ruleName, outcome } of outcomes) {
      if (outcome === 'shadow') {
        report.shadowedRules.push(ruleName);
      } else if (outcome === 'source-invalid-shadow') {
        // Carry the specific reason from validateRuleShadow for the skip entry
        const shadowFile = path.join(devflowDir, 'rules', `${ruleName}.md`);
        const shadowState = await validateRuleShadow(shadowFile);
        const reason = shadowState === 'not-a-file' ? 'not-a-file' : 'empty-shadow-file';
        report.skippedShadows.push({ kind: 'rule', name: ruleName, reason });
      }
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
  return report;
}
