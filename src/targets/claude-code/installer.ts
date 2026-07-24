import { promises as fs } from 'fs';
import { existsSync } from 'fs';
import * as path from 'path';
import type { PluginDefinition } from '../../core/plugins.js';
import { DEVFLOW_PLUGINS, SKILL_NAMESPACE, prefixSkillName, unprefixSkillName, getAllSkillNames } from '../../core/plugins.js';
import { LEGACY_AGENT_NAMES } from './legacy.js';
import { skillsDir, agentsDir, rulesDir, commandsDir, scriptsDir } from '../../core/assets.js';
import { getPackageRoot } from '../../core/paths.js';

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

/** Discriminated outcome for a single rule installation. */
export type RuleInstallOutcome =
  | 'shadow'
  | 'source'
  | 'source-invalid-shadow:empty-shadow-file'
  | 'source-invalid-shadow:not-a-file'
  | 'skipped';

// ---------------------------------------------------------------------------
// Shadow state named types (Issue 4)
// ---------------------------------------------------------------------------

/** Return states for validateSkillShadow. */
export type SkillShadowState = 'valid' | 'missing-skill-md' | 'none';

/** Return states for validateRuleShadow. */
export type RuleShadowState = 'valid' | 'empty-shadow-file' | 'not-a-file' | 'none';

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
export async function validateSkillShadow(shadowDir: string): Promise<SkillShadowState> {
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
export async function validateRuleShadow(shadowFile: string): Promise<RuleShadowState> {
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
 *
 * D: Missing declared source is a build/packaging failure — throws rather than
 * silently returning 'skipped' (mirrors command hard-error pattern). Per-item
 * copy failures (EACCES, ENOSPC, etc.) are still isolated (avoids PF-009
 * blast-radius: one bad copy does not abort the whole batch).
 * Invalid shadows still warn-and-install-source (applies ADR-010).
 */
export async function installRuleFile(
  ruleName: string,
  devflowDir: string,
  rulesTarget: string,
): Promise<RuleInstallOutcome> {
  const shadowFile = path.join(devflowDir, 'rules', `${ruleName}.md`);
  const targetFile = path.join(rulesTarget, `${ruleName}.md`);
  const ruleSource = path.join(rulesDir(), `${ruleName}.md`);

  const shadowState = await validateRuleShadow(shadowFile);

  if (shadowState === 'valid') {
    try {
      await fs.copyFile(shadowFile, targetFile);
      return 'shadow';
    } catch {
      // Shadow is valid but the copy failed (e.g. EACCES, EISDIR on target).
      // Fall through to install the Devflow source so init never hard-fails.
    }
  }

  // Shadow is invalid (empty or not-a-file), or valid-shadow copy failed.
  // Install the Devflow source and report the specific invalid-shadow reason.
  let invalidShadowOutcome: RuleInstallOutcome | null = null;
  if (shadowState === 'not-a-file') {
    invalidShadowOutcome = 'source-invalid-shadow:not-a-file';
  } else if (shadowState === 'empty-shadow-file') {
    invalidShadowOutcome = 'source-invalid-shadow:empty-shadow-file';
  }

  // Hard-error on missing declared source: a build/packaging failure, not a
  // per-item degradation. Matches command install behavior.
  try {
    await fs.access(ruleSource);
  } catch {
    throw new Error(
      `Rule source not found for declared rule "${ruleName}": ${ruleSource}. ` +
      `Ensure the rule file exists in src/assets/rules/.`,
    );
  }

  // Copy is isolated per PF-009: a copy failure degrades to 'skipped' so one
  // bad rule does not abort the entire installAllRules Promise.all batch.
  try {
    await fs.copyFile(ruleSource, targetFile);
    return invalidShadowOutcome ?? 'source';
  } catch {
    return 'skipped'; /* copy failed (EACCES, ENOSPC, etc.) — degrade gracefully */
  }
}

// ---------------------------------------------------------------------------
// Shared rule-install loop (Issue 3)
// ---------------------------------------------------------------------------

/**
 * Install all rules in rulesMap, returning one outcome per rule.
 * Called by installViaFileCopy (rolls up into InstallReport) and
 * `rules --enable` (renders per-rule log lines). One place computes;
 * callers present.
 */
export async function installAllRules(
  rulesMap: Map<string, string>,
  devflowDir: string,
  rulesTarget: string,
): Promise<{ ruleName: string; outcome: RuleInstallOutcome }[]> {
  return Promise.all(
    [...rulesMap.keys()].map(async (ruleName) => {
      const outcome = await installRuleFile(ruleName, devflowDir, rulesTarget);
      return { ruleName, outcome };
    }),
  );
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
// Script composer
// ---------------------------------------------------------------------------

/** Matches relative ES import/export specifiers and dynamic import() calls. */
const IMPORT_RE = /(?:import|export)[\s\S]*?from\s*['"](\.[^'"]+)['"]|import\(\s*['"](\.[^'"]+)['"]\s*\)/g;

/** Extract all relative module specifiers from compiled JS source. */
function collectRelativeImports(source: string): string[] {
  const specs: string[] = [];
  for (const match of source.matchAll(IMPORT_RE)) {
    const spec = match[1] ?? match[2];
    if (spec) specs.push(spec);
  }
  return specs;
}

/**
 * Compose the ~/.devflow/scripts/ directory from:
 *   (a) src/assets/scripts/ verbatim (hooks/ + hud.sh) with executable bits preserved
 *   (b) Transitive closure of dist/hud/index.js compiled imports, mirrored
 *       under ~/.devflow/scripts/ at the same relative-to-dist/ paths
 *   (c) ~/.devflow/scripts/package.json → {"type":"module"}
 *
 * Frozen externally-referenced paths:
 *   ~/.devflow/scripts/hooks/run-hook   (hook bootstrap entry)
 *   ~/.devflow/scripts/hud.sh           (HUD entry script)
 */
export async function composeScripts(scriptsTarget: string): Promise<void> {
  await fs.mkdir(scriptsTarget, { recursive: true });

  // (a) src/assets/scripts/ verbatim
  const srcScripts = scriptsDir();
  try {
    await copyDirectory(srcScripts, scriptsTarget);
    if (process.platform !== 'win32') {
      await chmodRecursive(scriptsTarget, 0o755);
    }
  } catch { /* scripts dir may not exist yet during development */ }

  // (b) Walk dist/hud/ import graph and copy transitive deps
  const distRoot = path.join(getPackageRoot(), 'dist');
  const hudEntry = path.join(distRoot, 'hud', 'index.js');

  if (existsSync(hudEntry)) {
    const visited = new Set<string>();
    const queue: string[] = [hudEntry];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);

      // Copy file to target, preserving relative path from distRoot
      const rel = path.relative(distRoot, current);
      const destPath = path.join(scriptsTarget, rel);
      await fs.mkdir(path.dirname(destPath), { recursive: true });
      try {
        await fs.copyFile(current, destPath);
      } catch { /* file inaccessible — skip */ }

      // Collect imports for further walking
      let source: string;
      try {
        source = await fs.readFile(current, 'utf-8');
      } catch { continue; }

      const currentDir = path.dirname(current);
      for (const spec of collectRelativeImports(source)) {
        const resolved = path.resolve(currentDir, spec);
        if (!resolved.startsWith(distRoot + path.sep)) continue;
        if (!resolved.endsWith('.js')) continue;
        if (visited.has(resolved)) continue;
        const exists = await fs.access(resolved).then(() => true).catch(() => false);
        if (!exists) continue;
        queue.push(resolved);
      }
    }
  }

  // (c) package.json for ESM resolution
  const pkgJsonPath = path.join(scriptsTarget, 'package.json');
  try {
    await fs.writeFile(pkgJsonPath, '{"type":"module"}\n', { encoding: 'utf-8', flag: 'wx' });
  } catch { /* already exists from prior install — leave as-is */ }
}

// ---------------------------------------------------------------------------
// File copy installer
// ---------------------------------------------------------------------------

export interface FileCopyOptions {
  plugins: PluginDefinition[];
  claudeDir: string;
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

    // Sweep stale devflow:* skill dirs — remove any dir under ~/.claude/skills/
    // whose bare name is no longer present in the registry. The devflow: namespace
    // is exclusively Devflow's so removals are safe. Bare (pre-namespace) dirs are
    // intentionally untouched — they are handled by the frozen LEGACY_SKILLS_* lists
    // in legacy.ts (avoids PF-012: those lists are deletion manifests for pre-namespace
    // paths and must not be modified). Shadow dirs (~/.devflow/skills/) are keyed by
    // bare registry name and are unaffected by this sweep.
    const skillsInstallDir = path.join(claudeDir, 'skills');
    try {
      const installedDirs = await fs.readdir(skillsInstallDir);
      const knownSkillNames = new Set(getAllSkillNames());
      for (const dir of installedDirs) {
        if (!dir.startsWith(SKILL_NAMESPACE)) continue; // only our devflow: namespace
        const bareName = unprefixSkillName(dir);
        if (!knownSkillNames.has(bareName)) {
          try {
            await fs.rm(path.join(skillsInstallDir, dir), { recursive: true, force: true });
          } catch { /* ignore individual removal errors */ }
        }
      }
    } catch { /* skills dir absent or unreadable — not an error */ }
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

  // Install commands from selected plugins using registry-driven lookup.
  // Source: dist/commands/{name}.md (single lookup directory for all commands).
  // A declared command with no compiled source file is a hard error, not a skip.
  spinner.message('Installing commands and agents...');
  const commandsTarget = path.join(claudeDir, 'commands', 'devflow');
  const cDir = commandsDir();
  const commandsSourceNames = new Set<string>();
  for (const plugin of plugins) {
    for (const cmd of plugin.commands) {
      const name = cmd.startsWith('/') ? cmd.slice(1) : cmd;
      commandsSourceNames.add(name);
    }
  }
  if (commandsSourceNames.size > 0) {
    await fs.mkdir(commandsTarget, { recursive: true });
    for (const name of commandsSourceNames) {
      const srcFile = path.join(cDir, `${name}.md`);
      try {
        await fs.access(srcFile);
      } catch {
        throw new Error(
          `Command source not found for declared command "${name}": ${srcFile}. ` +
          `Ensure build:mds ran successfully before install.`,
        );
      }
      await fs.copyFile(srcFile, path.join(commandsTarget, `${name}.md`));
    }
  }

  // Install agents (deduplicated) from flat src/assets/agents/{name}.md.
  // A declared agent whose source file is absent is a build/packaging failure
  // and throws rather than silently skipping (matches command pattern).
  const agentsTarget = path.join(claudeDir, 'agents', 'devflow');
  const aDir = agentsDir();
  const allAgentNames = new Set<string>();
  for (const plugin of plugins) {
    for (const agent of plugin.agents) {
      if (!allAgentNames.has(agent) && agentsMap.get(agent) === plugin.name) {
        allAgentNames.add(agent);
      }
    }
  }
  if (allAgentNames.size > 0) {
    await fs.mkdir(agentsTarget, { recursive: true });
    for (const agentName of allAgentNames) {
      const srcFile = path.join(aDir, `${agentName}.md`);
      try {
        await fs.access(srcFile);
      } catch {
        throw new Error(
          `Agent source not found for declared agent "${agentName}": ${srcFile}. ` +
          `Ensure the agent file exists in src/assets/agents/.`,
        );
      }
      await fs.copyFile(srcFile, path.join(agentsTarget, `${agentName}.md`));
    }
  }

  // Clean up legacy agent files (renamed or removed agents from prior versions)
  for (const legacyAgent of LEGACY_AGENT_NAMES) {
    try {
      await fs.rm(path.join(agentsTarget, `${legacyAgent}.md`), { force: true });
    } catch { /* ignore */ }
  }

  // Install skills from ALL plugins (skillsMap covers all plugins, not just selected).
  // Resolved from flat src/assets/skills/{name}/ (no per-plugin subdirectory).
  // A declared skill whose source directory is absent is a build/packaging failure
  // and throws rather than silently skipping (matches command pattern).
  spinner.message('Installing skills...');
  for (const [skillName] of skillsMap) {
    const skillSource = path.join(skillsDir(), skillName);
    let isDir = false;
    try {
      const stat = await fs.stat(skillSource);
      isDir = stat.isDirectory();
    } catch { /* stat failed — source absent */ }
    if (!isDir) {
      throw new Error(
        `Skill source not found for declared skill "${skillName}": ${skillSource}. ` +
        `Ensure the skill directory exists in src/assets/skills/.`,
      );
    }

    const shadowDir = path.join(devflowDir, 'skills', skillName);
    const prefixedName = prefixSkillName(skillName);
    const skillTarget = path.join(claudeDir, 'skills', prefixedName);

    const shadowState = await validateSkillShadow(shadowDir);

    if (shadowState === 'valid') {
      await copyDirectory(shadowDir, skillTarget);
      report.shadowedSkills.push(skillName);
    } else if (shadowState === 'missing-skill-md') {
      report.skippedShadows.push({ kind: 'skill', name: skillName, reason: 'missing-skill-md' });
      await copyDirectory(skillSource, skillTarget);
    } else {
      await copyDirectory(skillSource, skillTarget);
    }
  }

  // Install rules from selected plugins (rulesMap covers selected plugins only).
  // Rules are flat .md files resolved from src/assets/rules/{name}.md (no per-plugin subdir).
  spinner.message('Installing rules...');
  const rulesTarget = path.join(claudeDir, 'rules', 'devflow');
  if (rulesMap.size > 0) {
    await fs.mkdir(rulesTarget, { recursive: true });
    const outcomes = await installAllRules(rulesMap, devflowDir, rulesTarget);
    for (const { ruleName, outcome } of outcomes) {
      if (outcome === 'shadow') {
        report.shadowedRules.push(ruleName);
      } else if (outcome === 'source-invalid-shadow:empty-shadow-file') {
        report.skippedShadows.push({ kind: 'rule', name: ruleName, reason: 'empty-shadow-file' });
      } else if (outcome === 'source-invalid-shadow:not-a-file') {
        report.skippedShadows.push({ kind: 'rule', name: ruleName, reason: 'not-a-file' });
      }
    }
  }

  // Install scripts via composer — keeps only what is needed at runtime
  // (no dev tooling, no raw TypeScript).
  spinner.message('Installing scripts...');
  const scriptsTarget = path.join(devflowDir, 'scripts');
  await composeScripts(scriptsTarget);

  spinner.stop('Components installed via file copy');
  return report;
}
