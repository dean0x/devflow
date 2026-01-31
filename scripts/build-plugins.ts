#!/usr/bin/env npx tsx
/**
 * Build-time skill distribution script
 *
 * Copies skills from shared/skills/ to each plugin's skills/ directory
 * based on the "skills" array in each plugin's plugin.json manifest.
 *
 * This eliminates skill duplication in git while maintaining self-contained
 * plugins for distribution.
 *
 * Usage: npm run build:plugins
 */

import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(import.meta.dirname, "..");
const SHARED_SKILLS = path.join(ROOT, "shared", "skills");
const PLUGINS_DIR = path.join(ROOT, "plugins");

interface PluginManifest {
  name: string;
  skills?: string[];
}

interface BuildResult {
  plugin: string;
  skillsCopied: string[];
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

function buildPlugin(pluginDir: string, availableSkills: Set<string>): BuildResult {
  const pluginName = path.basename(pluginDir);
  const result: BuildResult = {
    plugin: pluginName,
    skillsCopied: [],
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

  const requiredSkills = manifest.skills ?? [];
  if (requiredSkills.length === 0) {
    return result;
  }

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

  return result;
}

function main(): void {
  console.log("Building plugins...\n");

  // Validate shared skills directory exists
  if (!fs.existsSync(SHARED_SKILLS)) {
    console.error(`ERROR: shared/skills/ directory not found at ${SHARED_SKILLS}`);
    process.exit(1);
  }

  const availableSkills = getAvailableSkills();
  console.log(`Found ${availableSkills.size} skills in shared/skills/\n`);

  // Find all plugin directories
  const pluginDirs = fs
    .readdirSync(PLUGINS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.startsWith("devflow-"))
    .map((d) => path.join(PLUGINS_DIR, d.name));

  let totalSkillsCopied = 0;
  let totalErrors = 0;
  const results: BuildResult[] = [];

  for (const pluginDir of pluginDirs) {
    const result = buildPlugin(pluginDir, availableSkills);
    results.push(result);
    totalSkillsCopied += result.skillsCopied.length;
    totalErrors += result.errors.length;
  }

  // Print results
  for (const result of results) {
    if (result.skillsCopied.length === 0 && result.errors.length === 0) {
      console.log(`  ${result.plugin}: (no skills)`);
    } else if (result.errors.length === 0) {
      console.log(`  ${result.plugin}: ${result.skillsCopied.length} skills copied`);
    } else {
      console.log(`  ${result.plugin}: ${result.skillsCopied.length} skills copied, ${result.errors.length} errors`);
      for (const error of result.errors) {
        console.log(`    ERROR: ${error}`);
      }
    }
  }

  console.log(`\nTotal: ${totalSkillsCopied} skill copies across ${pluginDirs.length} plugins`);

  if (totalErrors > 0) {
    console.error(`\n${totalErrors} error(s) occurred during build`);
    process.exit(1);
  }

  console.log("\nBuild complete!");
}

main();
