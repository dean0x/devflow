import { Command } from 'commander';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as p from '@clack/prompts';
import color from 'picocolors';
import { getClaudeDirectory, getDevFlowDirectory } from '../../targets/claude-code/claude-paths.js';
import { getAllSkillNames, prefixSkillName, unprefixSkillName, skillOwners, FEATURE_OWNED_SKILLS } from '../../core/plugins.js';
import { skillsDir } from '../../core/assets.js';
import { copyDirectory, validateSkillShadow, type SkillShadowState } from '../../targets/claude-code/installer.js';

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
  return path.join(devflowDir, 'skills', unprefixSkillName(skillName));
}

/**
 * Check if a skill has a shadow (personal override).
 */
export async function hasShadow(skillName: string, devflowDir?: string): Promise<boolean> {
  const dir = devflowDir ?? getDevFlowDirectory();
  return dirExists(getShadowDir(dir, skillName));
}

/**
 * Which plugin(s) a user must select to get a skill — rendered for a message.
 *
 * Every declarer, never the first: once install is scoped, the question this
 * answers is "which plugin do I select to keep this?", and a first-wins answer
 * names one plugin out of several that would each do (D-ALL-OWNERS).
 * FEATURE_OWNED skills have no plugin owner at all and say so, because telling
 * a user to select a plugin for `compliance` would send them looking for one
 * that does not exist.
 */
function describeOwners(bareName: string, owners?: readonly string[]): string {
  const declarers = owners ?? skillOwners(bareName);
  if (declarers.length === 0) {
    return (FEATURE_OWNED_SKILLS as readonly string[]).includes(bareName)
      ? 'its feature (devflow compliance --enable)'
      : 'no plugin';
  }
  return declarers.join(' or ');
}

/** Render the shadow-state display tag for a skill. Exhaustive switch catches new states at compile time. */
function buildSkillShadowTag(shadowState: SkillShadowState): string {
  switch (shadowState) {
    case 'valid':
      return color.green('shadowed');
    case 'missing-skill-md':
      return color.yellow('shadowed — invalid: no SKILL.md');
    case 'none':
      return color.dim('—');
    default: {
      const _exhaustive: never = shadowState;
      void _exhaustive;
      return color.dim('—');
    }
  }
}

export const skillsCommand = new Command('skills')
  .description('Manage skill overrides (shadow/unshadow/list)')
  .argument('<action>', 'Action: shadow, unshadow, or list')
  .argument('[name]', 'Skill name (required for shadow/unshadow)')
  .action(async (action: string, name: string | undefined) => {
    const devflowDir = getDevFlowDirectory();
    const claudeDir = getClaudeDirectory();
    // Union FEATURE_OWNED_SKILLS (compliance) so shadow/unshadow/list cover feature-managed
    // skills that left the plugin registry but still live in src/assets/skills/ (step 1.5).
    const allSkills = [...getAllSkillNames(), ...FEATURE_OWNED_SKILLS];

    if (action === 'shadow') {
      if (!name) {
        p.log.error('Skill name required. Usage: devflow skills shadow <name>');
        p.log.info(`Available skills: ${allSkills.join(', ')}`);
        process.exit(1);
      }

      // Accept both bare and prefixed input
      const bareName = unprefixSkillName(name);

      if (!allSkills.includes(bareName)) {
        p.log.error(`Unknown skill: ${bareName}`);
        p.log.info(`Available skills: ${allSkills.join(', ')}`);
        process.exit(1);
      }

      const prefixedName = prefixSkillName(bareName);
      const installedSkillDir = path.join(claudeDir, 'skills', prefixedName);
      const installed = await dirExists(installedSkillDir);

      // A skill outside the current selection is not installed, and that is no
      // longer a reason to refuse: skills are plugin-scoped now, so "not
      // installed" is an ordinary state for a registry skill nobody selected.
      // The shadow is seeded from the shipped source instead and reported as
      // DORMANT — it exists, it is preserved by every future install, and it
      // applies to nothing until the plugin that uses it is selected.
      const seedDir = installed ? installedSkillDir : path.join(skillsDir(), bareName);
      if (!await dirExists(seedDir)) {
        p.log.error(`No source for ${bareName} — reinstall devflow, then try again.`);
        process.exit(1);
      }

      const shadowDir = getShadowDir(devflowDir, bareName);
      if (await dirExists(shadowDir)) {
        p.log.info(`${bareName} is already shadowed`);
        return;
      }

      // Create shadow directory (unprefixed) and copy original as reference backup
      await fs.mkdir(path.join(devflowDir, 'skills'), { recursive: true });
      await copyDirectory(seedDir, shadowDir);

      p.log.success(`Shadowed ${color.cyan(bareName)}`);
      if (!installed) {
        p.log.warn(
          `Shadow for ${bareName} is inactive — the plugin that uses it is not selected. ` +
          `Run devflow init and select ${describeOwners(bareName)} to apply it.`,
        );
      }
      p.log.info(`Edit ${color.dim(path.join(shadowDir, 'SKILL.md'))} then run devflow init to apply.`);
    } else if (action === 'unshadow') {
      if (!name) {
        p.log.error('Skill name required. Usage: devflow skills unshadow <name>');
        process.exit(1);
      }

      // Accept both bare and prefixed input
      const bareName = unprefixSkillName(name);
      const shadowDir = getShadowDir(devflowDir, bareName);
      if (!await dirExists(shadowDir)) {
        p.log.info(`${bareName} is not shadowed`);
        return;
      }

      await fs.rm(shadowDir, { recursive: true, force: true });

      p.log.success(`Unshadowed ${color.cyan(bareName)}`);
      p.log.info('Run devflow init to restore Devflow\'s version.');
    } else if (action === 'list') {
      const shadowsRoot = path.join(devflowDir, 'skills');

      // Collect shadow dirs that exist
      let shadowDirNames: string[] = [];
      try {
        const entries = await fs.readdir(shadowsRoot, { withFileTypes: true });
        shadowDirNames = entries.filter(e => e.isDirectory()).map(e => e.name);
      } catch { /* skills dir absent — no shadows */ }
      const shadowDirSet = new Set(shadowDirNames);
      const knownSkillSet = new Set(allSkills);

      // L3: every skill's declarers, resolved ONCE into a map before any row is
      // rendered. Calling skillOwners() inside the row loop would walk the whole
      // registry per skill for an answer that does not change between rows.
      const ownersBySkill = new Map(allSkills.map(skill => [skill, skillOwners(skill)]));

      // Build rows in parallel; short-circuit validateSkillShadow for skills with no shadow dir
      const knownResults = await Promise.all(
        allSkills.map(async (skill) => {
          const shadowState: SkillShadowState = shadowDirSet.has(skill)
            ? await validateSkillShadow(path.join(shadowsRoot, skill))
            : 'none';
          const installed = await dirExists(path.join(claudeDir, 'skills', prefixSkillName(skill)));
          return { skill, shadowState, installed };
        }),
      );

      const rows: string[] = knownResults.map(({ skill, shadowState, installed }) => {
        // Skills are plugin-scoped, so "which plugin do I select to keep this?"
        // is the question the list has to answer — and for a skill that is not
        // installed it is the only useful thing the row can say.
        const provenance = installed
          ? color.dim(`installed because: ${describeOwners(skill, ownersBySkill.get(skill))}`)
          : color.dim(`not installed — provided by: ${describeOwners(skill, ownersBySkill.get(skill))}`);
        return `  ${color.cyan(skill.padEnd(28))} ${buildSkillShadowTag(shadowState).padEnd(20)} ${provenance}`;
      });

      // Orphan shadows: in ~/.devflow/skills/ but not a known skill
      for (const dirName of shadowDirNames) {
        if (!knownSkillSet.has(dirName)) {
          rows.push(`  ${color.yellow(dirName.padEnd(28))} ${color.yellow('unknown skill')}`);
        }
      }

      const shadowedCount = knownResults.filter(r => r.shadowState !== 'none').length;
      const installedCount = knownResults.filter(r => r.installed).length;
      p.note(
        rows.join('\n'),
        `Skills (${allSkills.length} known, ${installedCount} installed, ${shadowedCount} shadowed)`,
      );
    } else {
      p.log.error(`Unknown action: ${action}`);
      p.log.info('Usage: devflow skills <shadow|unshadow|list> [name]');
      process.exit(1);
    }
  });
