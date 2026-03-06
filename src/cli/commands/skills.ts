import { Command } from 'commander';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as p from '@clack/prompts';
import color from 'picocolors';
import { getClaudeDirectory, getDevFlowDirectory } from '../utils/paths.js';
import { getAllSkillNames } from '../plugins.js';
import { copyDirectory } from '../utils/installer.js';

/**
 * Check if a directory exists.
 */
async function dirExists(dirPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(dirPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Get the shadow directory for a skill.
 */
function getShadowDir(devflowDir: string, skillName: string): string {
  return path.join(devflowDir, 'skills', skillName);
}

/**
 * Check if a skill has a shadow (personal override).
 */
export async function hasShadow(skillName: string, devflowDir?: string): Promise<boolean> {
  const dir = devflowDir ?? getDevFlowDirectory();
  return dirExists(getShadowDir(dir, skillName));
}

/**
 * List all shadowed skill names.
 */
export async function listShadowed(devflowDir?: string): Promise<string[]> {
  const dir = devflowDir ?? getDevFlowDirectory();
  const shadowsRoot = path.join(dir, 'skills');

  try {
    const entries = await fs.readdir(shadowsRoot, { withFileTypes: true });
    return entries.filter(e => e.isDirectory()).map(e => e.name);
  } catch {
    return [];
  }
}

export const skillsCommand = new Command('skills')
  .description('Manage skill overrides (shadow/unshadow/list)')
  .argument('<action>', 'Action: shadow, unshadow, or list-shadowed')
  .argument('[name]', 'Skill name (required for shadow/unshadow)')
  .action(async (action: string, name: string | undefined) => {
    const devflowDir = getDevFlowDirectory();
    const claudeDir = getClaudeDirectory();
    const allSkills = getAllSkillNames();

    if (action === 'shadow') {
      if (!name) {
        p.log.error('Skill name required. Usage: devflow skills shadow <name>');
        p.log.info(`Available skills: ${allSkills.join(', ')}`);
        process.exit(1);
      }

      if (!allSkills.includes(name)) {
        p.log.error(`Unknown skill: ${name}`);
        p.log.info(`Available skills: ${allSkills.join(', ')}`);
        process.exit(1);
      }

      const installedSkillDir = path.join(claudeDir, 'skills', name);
      if (!await dirExists(installedSkillDir)) {
        p.log.error(`Skill not installed: ${name}. Run devflow init first.`);
        process.exit(1);
      }

      const shadowDir = getShadowDir(devflowDir, name);
      if (await dirExists(shadowDir)) {
        p.log.info(`${name} is already shadowed`);
        return;
      }

      // Create shadow directory and copy original as reference backup
      await fs.mkdir(path.join(devflowDir, 'skills'), { recursive: true });
      await copyDirectory(installedSkillDir, shadowDir);

      p.log.success(`Shadowed ${color.cyan(name)}`);
      p.log.info(`Edit ${color.dim(path.join(claudeDir, 'skills', name, 'SKILL.md'))} — it won't be overwritten on next init.`);
    } else if (action === 'unshadow') {
      if (!name) {
        p.log.error('Skill name required. Usage: devflow skills unshadow <name>');
        process.exit(1);
      }

      const shadowDir = getShadowDir(devflowDir, name);
      if (!await dirExists(shadowDir)) {
        p.log.info(`${name} is not shadowed`);
        return;
      }

      await fs.rm(shadowDir, { recursive: true, force: true });

      p.log.success(`Unshadowed ${color.cyan(name)}`);
      p.log.info('Run devflow init to restore DevFlow\'s version.');
    } else if (action === 'list-shadowed') {
      const shadowed = await listShadowed(devflowDir);

      if (shadowed.length === 0) {
        p.log.info('No shadowed skills');
        return;
      }

      p.log.info(`Shadowed skills (${shadowed.length}):`);
      for (const skill of shadowed) {
        const isKnown = allSkills.includes(skill);
        const status = isKnown ? color.green('active') : color.yellow('unknown skill');
        p.log.info(`  ${color.cyan(skill)} — ${status}`);
      }
    } else {
      p.log.error(`Unknown action: ${action}`);
      p.log.info('Usage: devflow skills <shadow|unshadow|list-shadowed> [name]');
      process.exit(1);
    }
  });
