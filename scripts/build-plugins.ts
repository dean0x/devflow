#!/usr/bin/env npx tsx
/**
 * Build-time asset distribution script
 *
 * Copies skills from shared/skills/ and agents from shared/agents/ to each
 * plugin's respective directories based on the "skills" and "agents" arrays
 * in each plugin's plugin.json manifest.
 *
 * This eliminates duplication in git while maintaining self-contained
 * plugins for distribution.
 *
 * Usage: npm run build:plugins
 */

import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(import.meta.dirname, "..");
const SHARED_SKILLS = path.join(ROOT, "shared", "skills");
const SHARED_AGENTS = path.join(ROOT, "shared", "agents");
const PLUGINS_DIR = path.join(ROOT, "plugins");

interface PluginManifest {
  name: string;
  skills?: string[];
  agents?: string[];
}

interface BuildResult {
  plugin: string;
  skillsCopied: string[];
  agentsCopied: string[];
  errors: string[];
}

function copyDirRecursive(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });

  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function getAvailableSkills(): Set<string> {
  if (!fs.existsSync(SHARED_SKILLS)) {
    return new Set();
  }
  return new Set(
    fs
      .readdirSync(SHARED_SKILLS, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
  );
}

function getAvailableAgents(): Set<string> {
  if (!fs.existsSync(SHARED_AGENTS)) {
    return new Set();
  }
  return new Set(
    fs
      .readdirSync(SHARED_AGENTS, { withFileTypes: true })
      .filter((d) => d.isFile() && d.name.endsWith(".md"))
      .map((d) => d.name.replace(".md", ""))
  );
}

function buildPlugin(
  pluginDir: string,
  availableSkills: Set<string>,
  availableAgents: Set<string>
): BuildResult {
  const pluginName = path.basename(pluginDir);
  const result: BuildResult = {
    plugin: pluginName,
    skillsCopied: [],
    agentsCopied: [],
    errors: [],
  };

  // Read plugin manifest
  const manifestPath = path.join(pluginDir, ".claude-plugin", "plugin.json");
  if (!fs.existsSync(manifestPath)) {
    result.errors.push(`No plugin.json found at ${manifestPath}`);
    return result;
  }

  let manifest: PluginManifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  } catch (e) {
    result.errors.push(`Failed to parse plugin.json: ${e}`);
    return result;
  }

  // Handle skills
  const requiredSkills = manifest.skills ?? [];
  if (requiredSkills.length > 0) {
    // Clean existing skills directory
    const skillsDir = path.join(pluginDir, "skills");
    if (fs.existsSync(skillsDir)) {
      fs.rmSync(skillsDir, { recursive: true });
    }
    fs.mkdirSync(skillsDir, { recursive: true });

    // Copy each required skill
    for (const skill of requiredSkills) {
      if (!availableSkills.has(skill)) {
        result.errors.push(`Skill "${skill}" not found in shared/skills/`);
        continue;
      }

      const src = path.join(SHARED_SKILLS, skill);
      const dest = path.join(skillsDir, skill);

      try {
        copyDirRecursive(src, dest);
        result.skillsCopied.push(skill);
      } catch (e) {
        result.errors.push(`Failed to copy skill "${skill}": ${e}`);
      }
    }
  }

  // Handle agents
  const requiredAgents = manifest.agents ?? [];
  if (requiredAgents.length > 0) {
    // Ensure agents directory exists (don't clean - plugin-specific agents are committed)
    const agentsDir = path.join(pluginDir, "agents");
    fs.mkdirSync(agentsDir, { recursive: true });

    // Copy each required agent from shared/agents/
    for (const agent of requiredAgents) {
      if (!availableAgents.has(agent)) {
        result.errors.push(`Agent "${agent}" not found in shared/agents/`);
        continue;
      }

      const src = path.join(SHARED_AGENTS, `${agent}.md`);
      const dest = path.join(agentsDir, `${agent}.md`);

      try {
        fs.copyFileSync(src, dest);
        result.agentsCopied.push(agent);
      } catch (e) {
        result.errors.push(`Failed to copy agent "${agent}": ${e}`);
      }
    }
  }

  return result;
}

function main(): void {
  console.log("Building plugins...\n");

  // Validate shared directories exist
  if (!fs.existsSync(SHARED_SKILLS)) {
    console.error(`ERROR: shared/skills/ directory not found at ${SHARED_SKILLS}`);
    process.exit(1);
  }
  if (!fs.existsSync(SHARED_AGENTS)) {
    console.error(`ERROR: shared/agents/ directory not found at ${SHARED_AGENTS}`);
    process.exit(1);
  }

  const availableSkills = getAvailableSkills();
  const availableAgents = getAvailableAgents();
  console.log(`Found ${availableSkills.size} skills in shared/skills/`);
  console.log(`Found ${availableAgents.size} agents in shared/agents/\n`);

  // Find all plugin directories
  const pluginDirs = fs
    .readdirSync(PLUGINS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.startsWith("devflow-"))
    .map((d) => path.join(PLUGINS_DIR, d.name));

  let totalSkillsCopied = 0;
  let totalAgentsCopied = 0;
  let totalErrors = 0;
  const results: BuildResult[] = [];

  for (const pluginDir of pluginDirs) {
    const result = buildPlugin(pluginDir, availableSkills, availableAgents);
    results.push(result);
    totalSkillsCopied += result.skillsCopied.length;
    totalAgentsCopied += result.agentsCopied.length;
    totalErrors += result.errors.length;
  }

  // Print results
  for (const result of results) {
    const hasContent = result.skillsCopied.length > 0 || result.agentsCopied.length > 0;
    const hasErrors = result.errors.length > 0;

    if (!hasContent && !hasErrors) {
      console.log(`  ${result.plugin}: (no shared assets)`);
    } else if (!hasErrors) {
      const parts = [];
      if (result.skillsCopied.length > 0) parts.push(`${result.skillsCopied.length} skills`);
      if (result.agentsCopied.length > 0) parts.push(`${result.agentsCopied.length} agents`);
      console.log(`  ${result.plugin}: ${parts.join(", ")} copied`);
    } else {
      const parts = [];
      if (result.skillsCopied.length > 0) parts.push(`${result.skillsCopied.length} skills`);
      if (result.agentsCopied.length > 0) parts.push(`${result.agentsCopied.length} agents`);
      console.log(`  ${result.plugin}: ${parts.join(", ")} copied, ${result.errors.length} errors`);
      for (const error of result.errors) {
        console.log(`    ERROR: ${error}`);
      }
    }
  }

  console.log(`\nTotal: ${totalSkillsCopied} skill copies + ${totalAgentsCopied} agent copies across ${pluginDirs.length} plugins`);

  if (totalErrors > 0) {
    console.error(`\n${totalErrors} error(s) occurred during build`);
    process.exit(1);
  }

  console.log("\nBuild complete!");
}

main();
