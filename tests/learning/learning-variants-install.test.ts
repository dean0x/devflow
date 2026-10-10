/**
 * The learning-variant converge (D-LEARNING-VARIANT-INSTALL), against temp trees.
 *
 * Covers convergeLearningVariants, applyLearningToggle and the install-side source
 * order and skill condition in isolation: what the converge reads, what it writes,
 * what it refuses to touch and how it fails. tests/learning/
 * learning-variants-install-e2e.test.ts drives the same behaviour through the real
 * CLI under a temp HOME.
 *
 * Every converge here runs against a temp CLAUDE dir and a temp package root, and
 * the skill steps read the temp root's own src/assets/skills/apply-decisions
 * through the installer's own resolver, so the shadow rule is the production one
 * and an injected root governs the skill source as it governs the variants.
 * Nothing touches the real HOME.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';

import { installViaFileCopy, type Spinner } from '../../src/targets/claude-code/installer.js';
import {
  applyLearningToggle,
  convergeLearningVariants,
  describeLearningConverge,
  learningToggleSkew,
  MAX_LEARNING_ROSTER,
  readRunningVersion,
  type ConvergeLearningVariantsResult,
} from '../../src/targets/claude-code/learning-install.js';
import { saveAgentMapping } from '../../src/core/agent-models.js';
import {
  agentSourceDirs,
  commandSourceDirs,
  learningOffDir,
  skillsDir,
} from '../../src/core/assets.js';
import {
  DEVFLOW_PLUGINS,
  buildAssetMaps,
  buildScopedSkillsMap,
  LEARNING_GATED_SKILLS,
  omitLearningGatedSkills,
  skillsOf,
  type PluginDefinition,
} from '../../src/core/plugins.js';
import { assertTempHome } from '../setup/home-isolation.js';

const ROOT = path.resolve(import.meta.dirname, '../..');
const SKILL = 'apply-decisions';
const SKILL_DIR = 'devflow:apply-decisions';
/** The temp package's own apply-decisions text: not the real skill's, so a read of the wrong root shows. */
const PKG_SKILL = 'apply-decisions of the injected package root\n';

let tmp: string;
let claudeDir: string;
let devflowDir: string;
let pkg: string;
let warnings: string[];

const warn = (msg: string): void => { warnings.push(msg); };

/** Every plugin: the selection a default full install carries, apply-decisions included. */
const FULL_SELECTION: readonly PluginDefinition[] = DEVFLOW_PLUGINS;
/** A real plugin whose closure does not hold the skill (a language plugin). */
const WITHOUT_SKILL: PluginDefinition = (() => {
  const found = DEVFLOW_PLUGINS.find(plugin => !skillsOf([plugin]).has(SKILL));
  if (found === undefined) throw new Error('the registry has no plugin without apply-decisions');
  return found;
})();

async function write(file: string, text: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, text, 'utf-8');
}

async function read(file: string): Promise<string> {
  return fs.readFile(file, 'utf-8');
}

async function exists(file: string): Promise<boolean> {
  try { await fs.access(file); return true; } catch { return false; }
}

const installedCommand = (name: string): string => path.join(claudeDir, 'commands', 'devflow', `${name}.md`);
const installedAgent = (name: string): string => path.join(claudeDir, 'agents', 'devflow', `${name}.md`);
const installedSkill = (): string => path.join(claudeDir, 'skills', SKILL_DIR);

/**
 * A package root with two hosts that have an arm (one command, one agent) and one
 * command with no arm, so the "no variant, no touch" rule has a subject.
 * Learning-on text is the normal path, learning-off text the dist/learning-off path.
 */
async function seedPackage(): Promise<void> {
  await write(path.join(pkg, 'dist', 'commands', 'implement.md'), 'implement ON\n');
  await write(path.join(learningOffDir('commands', pkg), 'implement.md'), 'implement OFF\n');
  await write(path.join(pkg, 'dist', 'commands', 'no-arm.md'), 'no-arm\n');
  await write(path.join(pkg, 'dist', 'agents', 'code.md'), 'code ON\n');
  await write(path.join(learningOffDir('agents', pkg), 'code.md'), 'code OFF\n');
  await write(path.join(skillsDir(pkg), SKILL, 'SKILL.md'), PKG_SKILL);
}

async function installOn(): Promise<void> {
  await write(installedCommand('implement'), 'implement ON\n');
  await write(installedCommand('no-arm'), 'no-arm\n');
  await write(installedAgent('code'), 'code ON\n');
}

function converge(learning: boolean, plugins: readonly PluginDefinition[] = FULL_SELECTION) {
  return convergeLearningVariants({ claudeDir, devflowDir, learning, plugins, warn, packageRoot: pkg });
}

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-learning-install-'));
  expect(() => assertTempHome(tmp)).not.toThrow();
  claudeDir = path.join(tmp, 'claude');
  devflowDir = path.join(tmp, 'devflow');
  pkg = path.join(tmp, 'pkg');
  warnings = [];
  await fs.mkdir(claudeDir, { recursive: true });
  await fs.mkdir(devflowDir, { recursive: true });
  await seedPackage();
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// The install-side pieces: source order and the skill condition
// ---------------------------------------------------------------------------

describe('source order (assets.ts)', () => {
  it('learning off puts the learning-off directory first for commands and for agents', () => {
    expect(commandSourceDirs(false, pkg)).toEqual([learningOffDir('commands', pkg), path.join(pkg, 'dist', 'commands')]);
    expect(agentSourceDirs(pkg, false)).toEqual([
      learningOffDir('agents', pkg),
      path.join(pkg, 'dist', 'agents'),
      path.join(pkg, 'src', 'assets', 'agents'),
    ]);
  });

  it('learning on keeps today\'s order exactly, and the default is learning on', () => {
    expect(commandSourceDirs(true, pkg)).toEqual([path.join(pkg, 'dist', 'commands')]);
    expect(agentSourceDirs(pkg, true)).toEqual([path.join(pkg, 'dist', 'agents'), path.join(pkg, 'src', 'assets', 'agents')]);
    expect(agentSourceDirs(pkg)).toEqual(agentSourceDirs(pkg, true));
  });

  it('known-bad probe: the learning-off directory is never consulted when learning is on', () => {
    expect(commandSourceDirs(true, pkg).some(dir => dir.includes('learning-off'))).toBe(false);
    expect(agentSourceDirs(pkg, true).some(dir => dir.includes('learning-off'))).toBe(false);
  });
});

describe('the skill condition (plugins.ts)', () => {
  it('the gated set is exactly apply-decisions, pinned as an independent literal', () => {
    expect([...LEARNING_GATED_SKILLS]).toEqual(['apply-decisions']);
  });

  it('omitLearningGatedSkills drops the skill with learning off and returns the map itself with learning on', () => {
    const map = new Map([['apply-decisions', 'devflow-core-skills'], ['git', 'devflow-core-skills']]);
    expect([...omitLearningGatedSkills(map, false).keys()]).toEqual(['git']);
    expect(omitLearningGatedSkills(map, true)).toBe(map);
    expect([...map.keys()], 'the input is never mutated').toEqual(['apply-decisions', 'git']);
  });
});

// ---------------------------------------------------------------------------
// installViaFileCopy honours the switch (AC-139, AC-148)
// ---------------------------------------------------------------------------

describe('installViaFileCopy honours the learning switch', () => {
  const noopSpinner: Spinner = { start() {}, stop() {}, message() {} };
  const plugin = (name: string): PluginDefinition => {
    const found = DEVFLOW_PLUGINS.find(p => p.name === name);
    if (found === undefined) throw new Error(`no such plugin: ${name}`);
    return found;
  };
  const selection = (): PluginDefinition[] => [plugin('devflow-core-skills'), plugin('devflow-implement')];

  async function install(learning: boolean, isPartialInstall = false) {
    const plugins = selection();
    return installViaFileCopy({
      learning,
      plugins,
      effectivePlugins: plugins,
      claudeDir,
      devflowDir,
      skillsMap: buildScopedSkillsMap(plugins),
      agentsMap: buildAssetMaps(plugins).agentsMap,
      isPartialInstall,
      spinner: noopSpinner,
      warn,
    });
  }

  const real = (...segments: string[]): Promise<string> => read(path.join(ROOT, ...segments));

  it('learning off installs the learning-off variant of a command and an agent that have one, and no apply-decisions skill', async () => {
    const report = await install(false);

    expect(await read(installedCommand('implement'))).toBe(await real('dist', 'learning-off', 'commands', 'implement.md'));
    expect(await read(installedAgent('code'))).toBe(await real('dist', 'learning-off', 'agents', 'code.md'));
    expect(await exists(installedSkill()), 'the skill has no reader with learning off').toBe(false);
    expect(await exists(path.join(claudeDir, 'skills', 'devflow:git')), 'every other skill still installs').toBe(true);
    expect(report.removedSkills, 'a machine condition is not reported as a deselection').toEqual([]);
    expect(report.dormantShadows).toEqual([]);
  });

  it('learning on installs the learning-on variant and the skill', async () => {
    await install(true);

    expect(await read(installedCommand('implement'))).toBe(await real('dist', 'commands', 'implement.md'));
    expect(await read(installedAgent('code'))).toBe(await real('dist', 'agents', 'code.md'));
    expect(await exists(installedSkill())).toBe(true);
  });

  it('an agent with no learning-off file falls through to the one compiled file', async () => {
    await install(false);

    expect(await exists(path.join(learningOffDir('agents', ROOT), 'evaluate.md'))).toBe(false);
    expect(await read(installedAgent('evaluate'))).toBe(await real('src', 'assets', 'agents', 'evaluate.md'));
  });

  it('a full install with learning off removes a skill copy a learning-on install left behind', async () => {
    await install(true);
    expect(await exists(installedSkill())).toBe(true);

    await install(false);

    expect(await exists(installedSkill())).toBe(false);
    expect(await read(installedCommand('implement'))).toBe(await real('dist', 'learning-off', 'commands', 'implement.md'));
  });

  it('a partial install with learning off skips the skill but never removes it: that is the converge\'s job', async () => {
    await install(true);

    await install(false, true);

    expect(await exists(installedSkill()), 'removal on a partial install belongs to convergeLearningVariants').toBe(true);
    const converged = await convergeLearningVariants({
      claudeDir, devflowDir, learning: false, plugins: selection(), warn,
    });
    expect(converged.skill).toBe('removed');
    expect(await exists(installedSkill())).toBe(false);
  });

  it('known-bad probe: a learning-on install is not the learning-off bytes (the comparison is not vacuous)', async () => {
    await install(true);
    expect(await read(installedCommand('implement'))).not.toBe(await real('dist', 'learning-off', 'commands', 'implement.md'));
  });
});

// ---------------------------------------------------------------------------
// convergeLearningVariants: the files
// ---------------------------------------------------------------------------

describe('convergeLearningVariants: installed prompts', () => {
  it('learning off rewrites the installed commands and agents that have a variant (AC-139)', async () => {
    await installOn();

    const result = await converge(false);

    expect(result.converged).toBe(true);
    expect(await read(installedCommand('implement'))).toBe('implement OFF\n');
    expect(await read(installedAgent('code'))).toBe('code OFF\n');
    expect(result.commandsRewritten).toEqual(['implement.md']);
    expect(result.agentsRewritten).toEqual(['code.md']);
    expect(warnings).toEqual([]);
  });

  it('learning on restores them from the normal source order (AC-140)', async () => {
    await write(installedCommand('implement'), 'implement OFF\n');
    await write(installedAgent('code'), 'code OFF\n');

    const result = await converge(true);

    expect(result.converged).toBe(true);
    expect(await read(installedCommand('implement'))).toBe('implement ON\n');
    expect(await read(installedAgent('code'))).toBe('code ON\n');
  });

  it('learning on prefers dist/agents over the src fallback for the restored agent', async () => {
    await write(path.join(pkg, 'src', 'assets', 'agents', 'code.md'), 'code SRC\n');
    await write(installedAgent('code'), 'code OFF\n');

    await converge(true);

    expect(await read(installedAgent('code'))).toBe('code ON\n');
  });

  it('rewrites only files that are already installed: a roster entry with no installed copy stays absent (AC-143, AC-147)', async () => {
    await write(installedCommand('implement'), 'implement ON\n');
    // The agent is in the roster and was never installed (another plugin's).
    expect(await exists(installedAgent('code'))).toBe(false);

    const result = await converge(false);

    expect(result.notInstalled).toBe(1);
    expect(result.agentsRewritten).toEqual([]);
    expect(await exists(installedAgent('code'))).toBe(false);
    expect(await exists(path.join(claudeDir, 'agents', 'devflow'))).toBe(false);
  });

  it('leaves a host with no variant alone: it is not in the roster, so it is never read or written', async () => {
    await installOn();
    const before = await fs.stat(installedCommand('no-arm'));

    await converge(false);

    expect(await read(installedCommand('no-arm'))).toBe('no-arm\n');
    expect((await fs.stat(installedCommand('no-arm'))).mtimeMs).toBe(before.mtimeMs);
  });

  it('skips a byte-identical file: a second run rewrites nothing and says so (AC-147)', async () => {
    await installOn();
    await converge(false);
    const settled = await fs.stat(installedCommand('implement'));

    const second = await converge(false);

    expect(second.commandsRewritten).toEqual([]);
    expect(second.agentsRewritten).toEqual([]);
    expect(second.unchanged).toBe(2);
    expect((await fs.stat(installedCommand('implement'))).mtimeMs).toBe(settled.mtimeMs);
  });

  it('known-bad probe: a hand-edited installed file is NOT mistaken for the variant and is healed', async () => {
    await write(installedCommand('implement'), 'implement OFF\n// edited by hand\n');

    const result = await converge(false);

    expect(result.commandsRewritten).toEqual(['implement.md']);
    expect(await read(installedCommand('implement'))).toBe('implement OFF\n');
  });

  it('writes atomically: no temporary file survives and the installed permission mode is kept', async () => {
    await installOn();
    await fs.chmod(installedAgent('code'), 0o640);

    await converge(false);

    expect((await fs.stat(installedAgent('code'))).mode & 0o777).toBe(0o640);
    for (const dir of [path.join(claudeDir, 'commands', 'devflow'), path.join(claudeDir, 'agents', 'devflow')]) {
      expect((await fs.readdir(dir)).filter(name => name.includes('.tmp')), `temp files in ${dir}`).toEqual([]);
    }
  });

  it('converges the roster of a kind in sorted order and ignores names that are not flat lowercase markdown', async () => {
    for (const bad of ['UPPER.md', 'notes.txt', '.hidden.md', 'two words.md']) {
      await write(path.join(learningOffDir('commands', pkg), bad), 'junk OFF\n');
      await write(installedCommand(bad.replace(/\.md$/, '')), 'junk ON\n');
    }
    await installOn();

    const result = await converge(false);

    expect(result.commandsRewritten).toEqual(['implement.md']);
    expect(await read(path.join(claudeDir, 'commands', 'devflow', 'UPPER.md'))).toBe('junk ON\n');
  });

  it('bounds the roster: more entries than the cap are not all converged', async () => {
    for (let i = 0; i < MAX_LEARNING_ROSTER + 3; i++) {
      const name = `cmd-${String(i).padStart(4, '0')}`;
      await write(path.join(learningOffDir('commands', pkg), `${name}.md`), 'OFF\n');
      await write(installedCommand(name), 'ON\n');
    }

    const result = await converge(false);

    expect(result.commandsRewritten.length).toBeLessThanOrEqual(MAX_LEARNING_ROSTER);
    expect(warnings.some(w => w.includes('exceed the bound'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// convergeLearningVariants: agent overrides (D-AGENT-OVERRIDE-CARRY)
// ---------------------------------------------------------------------------

describe('convergeLearningVariants: agent model and effort overrides', () => {
  /** An agent file: frontmatter with the given model and effort (null: no effort line), then the variant body. */
  const agentText = (variant: 'ON' | 'OFF', model = 'sonnet', effort: string | null = 'high'): string =>
    `---\nname: Code\nmodel: ${model}\n${effort === null ? '' : `effort: ${effort}\n`}---\n\nbody ${variant}\n`;

  beforeEach(async () => {
    await write(path.join(pkg, 'dist', 'agents', 'code.md'), agentText('ON'));
    await write(path.join(learningOffDir('agents', pkg), 'code.md'), agentText('OFF'));
  });

  it.each([true, false])('a no-op converge (learning %s) with an override installed writes no agent file and reports none rewritten', async (learning) => {
    const variant = learning ? 'ON' : 'OFF';
    await write(installedAgent('code'), agentText(variant, 'opus', 'low'));
    await converge(learning); // settles the skill, the one other thing a converge installs or removes
    const before = await fs.stat(installedAgent('code'));

    const result = await converge(learning);

    expect(result.converged).toBe(true);
    expect(result.agentsRewritten).toEqual([]);
    expect(result.unchanged).toBe(1);
    expect(await read(installedAgent('code'))).toBe(agentText(variant, 'opus', 'low'));
    expect((await fs.stat(installedAgent('code'))).ino, 'an atomic rewrite would have replaced the inode').toBe(before.ino);
    expect(describeLearningConverge(result, learning), 'a no-op prints nothing').toBeNull();
    expect(warnings).toEqual([]);
  });

  it('a real switch writes the other variant with the override already on it: no intermediate default is ever on disk', async () => {
    await write(installedAgent('code'), agentText('ON', 'opus', 'low'));

    const off = await converge(false);

    // Read straight after the converge, before any reapplyAgentMapping: the shipped sonnet/high never lands.
    expect(off.agentsRewritten).toEqual(['code.md']);
    expect(await read(installedAgent('code'))).toBe(agentText('OFF', 'opus', 'low'));

    const back = await converge(true);

    expect(back.agentsRewritten).toEqual(['code.md']);
    expect(await read(installedAgent('code'))).toBe(agentText('ON', 'opus', 'low'));
  });

  it('an override that removes the effort ("inherit") survives a real switch and a following no-op', async () => {
    await write(installedAgent('code'), agentText('ON', 'opus', null));

    await converge(false);
    expect(await read(installedAgent('code'))).toBe(agentText('OFF', 'opus', null));

    const again = await converge(false);
    expect(again.agentsRewritten).toEqual([]);
  });

  it('with no override the behaviour is unchanged: the variant\'s own bytes are installed, then left alone', async () => {
    await write(installedAgent('code'), agentText('ON'));

    const off = await converge(false);

    expect(off.agentsRewritten).toEqual(['code.md']);
    expect(await read(installedAgent('code'))).toBe(agentText('OFF'));
    const again = await converge(false);
    expect(again.agentsRewritten).toEqual([]);
    expect(again.unchanged).toBe(1);
  });

  it('known-bad probe: an installed effort that is not an effort level is not carried, so the variant\'s own effort installs', async () => {
    await write(installedAgent('code'), agentText('ON', 'opus', 'turbo'));

    await converge(false);

    expect(await read(installedAgent('code'))).toBe(agentText('OFF'));
  });

  it('commands are never given an agent\'s frontmatter carry', async () => {
    await write(path.join(pkg, 'dist', 'commands', 'implement.md'), '---\nmodel: sonnet\n---\n\nimplement ON\n');
    await write(path.join(learningOffDir('commands', pkg), 'implement.md'), '---\nmodel: sonnet\n---\n\nimplement OFF\n');
    await write(installedCommand('implement'), '---\nmodel: opus\n---\n\nimplement ON\n');

    await converge(false);

    expect(await read(installedCommand('implement'))).toBe('---\nmodel: sonnet\n---\n\nimplement OFF\n');
  });
});

// ---------------------------------------------------------------------------
// convergeLearningVariants: failure handling (AC-146)
// ---------------------------------------------------------------------------

describe('convergeLearningVariants: failures only warn (AC-146)', () => {
  it('one unreadable installed file warns and fails the result, while every other file and the skill still converge', async () => {
    await installOn();
    // A directory where the installed command should be: readFile fails with EISDIR.
    await fs.rm(installedCommand('implement'));
    await fs.mkdir(installedCommand('implement'));
    await write(path.join(installedSkill(), 'SKILL.md'), 'stale skill\n');

    const result = await converge(false);

    expect(result.converged).toBe(false);
    expect(warnings.some(w => w.includes('commands/implement.md'))).toBe(true);
    expect(await read(installedAgent('code')), 'the next file is still converged').toBe('code OFF\n');
    expect(result.skill, 'the skill step still runs after a failed prompt').toBe('removed');
    expect(await exists(installedSkill())).toBe(false);
  });

  it('a roster file with no readable source warns and is left as it is', async () => {
    await write(installedAgent('code'), 'code OFF\n');
    await fs.rm(path.join(pkg, 'dist', 'agents', 'code.md'));

    const result = await converge(true);

    expect(result.converged).toBe(false);
    expect(await read(installedAgent('code'))).toBe('code OFF\n');
    expect(warnings.some(w => w.includes('no source for agents/code.md'))).toBe(true);
  });

  it('a relative claudeDir is refused with a warning and nothing is written', async () => {
    await installOn();

    const result = await convergeLearningVariants({
      claudeDir: 'relative/claude', devflowDir, learning: false, plugins: FULL_SELECTION, warn, packageRoot: pkg,
    });

    expect(result.converged).toBe(false);
    expect(warnings[0]).toContain('not an absolute path');
    expect(await read(installedCommand('implement'))).toBe('implement ON\n');
  });

  it('an absent learning-off tree warns for both kinds and touches nothing', async () => {
    await installOn();
    await fs.rm(path.join(pkg, 'dist', 'learning-off'), { recursive: true });

    const result = await converge(false);

    expect(result.converged).toBe(false);
    expect(warnings.filter(w => w.includes('no commands variants') || w.includes('no agents variants'))).toHaveLength(2);
    expect(await read(installedCommand('implement'))).toBe('implement ON\n');
    expect(await read(installedAgent('code'))).toBe('code ON\n');
  });
});

// ---------------------------------------------------------------------------
// convergeLearningVariants: the apply-decisions skill (AC-148)
// ---------------------------------------------------------------------------

describe('convergeLearningVariants: the apply-decisions skill', () => {
  const sourceSkill = (): Promise<string> => read(path.join(skillsDir(pkg), SKILL, 'SKILL.md'));

  it('learning on installs the skill when the selection requires it (AC-140)', async () => {
    const result = await converge(true);

    expect(result.skill).toBe('installed');
    expect(await read(path.join(installedSkill(), 'SKILL.md'))).toBe(await sourceSkill());
  });

  it('learning off removes the installed skill, and does it again as a no-op (AC-141)', async () => {
    await converge(true);

    const off = await converge(false);
    expect(off.skill).toBe('removed');
    expect(await exists(installedSkill())).toBe(false);

    expect((await converge(false)).skill).toBe('unchanged');
  });

  it('known-bad probe: learning on does NOT add the skill to a selection that never carried it (AC-143)', async () => {
    expect(skillsOf([WITHOUT_SKILL]).has(SKILL)).toBe(false);

    const result = await converge(true, [WITHOUT_SKILL]);

    expect(result.skill).toBe('not-selected');
    expect(await exists(installedSkill())).toBe(false);
    expect(await exists(path.join(claudeDir, 'skills'))).toBe(false);
  });

  it('an identical installed skill is reported unchanged and its files are not touched', async () => {
    await converge(true);
    const before = await fs.stat(path.join(installedSkill(), 'SKILL.md'));

    const again = await converge(true);

    expect(again.skill).toBe('unchanged');
    expect((await fs.stat(path.join(installedSkill(), 'SKILL.md'))).mtimeMs).toBe(before.mtimeMs);
  });

  it('a drifted installed skill is replaced whole and leaves no staging directory behind', async () => {
    await write(path.join(installedSkill(), 'SKILL.md'), 'drifted\n');
    await write(path.join(installedSkill(), 'EXTRA.md'), 'a stray file\n');

    const result = await converge(true);

    expect(result.skill).toBe('installed');
    expect(await read(path.join(installedSkill(), 'SKILL.md'))).toBe(await sourceSkill());
    expect(await exists(path.join(installedSkill(), 'EXTRA.md'))).toBe(false);
    expect((await fs.readdir(claudeDir)).filter(name => name.startsWith('.devflow-learning-'))).toEqual([]);
  });

  it('the skill source is the injected package root\'s, never the running package\'s', async () => {
    const result = await converge(true);

    expect(result.skill).toBe('installed');
    const text = await read(path.join(installedSkill(), 'SKILL.md'));
    expect(text).toBe(PKG_SKILL);
    expect(
      text,
      'non-vacuity: the running package ships a different apply-decisions',
    ).not.toBe(await read(path.join(skillsDir(ROOT), SKILL, 'SKILL.md')));
  });

  it('an injected root with no skill source fails the skill step naming that root, and never falls back to the running package', async () => {
    await fs.rm(path.join(skillsDir(pkg), SKILL), { recursive: true });

    const result = await converge(true);

    expect(result.skill).toBe('failed');
    expect(result.converged).toBe(false);
    expect(warnings.some(w => w.includes(skillsDir(pkg)))).toBe(true);
    expect(await exists(installedSkill())).toBe(false);
  });

  it('a valid shadow is what the toggle installs, exactly as the install installs it', async () => {
    await write(path.join(devflowDir, 'skills', SKILL, 'SKILL.md'), 'my own apply-decisions\n');

    const result = await converge(true);

    expect(result.skill).toBe('installed');
    expect(await read(path.join(installedSkill(), 'SKILL.md'))).toBe('my own apply-decisions\n');
  });

  it('an invalid shadow (no SKILL.md) installs the shipped source instead', async () => {
    await write(path.join(devflowDir, 'skills', SKILL, 'notes.md'), 'not a skill\n');

    await converge(true);

    expect(await read(path.join(installedSkill(), 'SKILL.md'))).toBe(await sourceSkill());
  });

  it('under learning off a shadow is dormant: the installed skill goes, the shadow stays, and enabling brings it back', async () => {
    const shadow = path.join(devflowDir, 'skills', SKILL, 'SKILL.md');
    await write(shadow, 'my own apply-decisions\n');
    await converge(true);

    await converge(false);
    expect(await exists(installedSkill())).toBe(false);
    expect(await read(shadow), 'a shadow is user content and is never deleted').toBe('my own apply-decisions\n');

    await converge(true);
    expect(await read(path.join(installedSkill(), 'SKILL.md'))).toBe('my own apply-decisions\n');
  });
});

// ---------------------------------------------------------------------------
// The toggle: version skew and the manifest (AC-145)
// ---------------------------------------------------------------------------

describe('learningToggleSkew (AC-145)', () => {
  it('names nothing when the installed and running versions agree', () => {
    expect(learningToggleSkew('3.3.0', '3.3.0', false)).toBeNull();
  });

  it('names both versions, the variant and the remedy when they differ', () => {
    const message = learningToggleSkew('3.2.0', '3.3.0', true);
    expect(message).toContain('3.2.0');
    expect(message).toContain('3.3.0');
    expect(message).toContain('learning-on');
    expect(message).toContain('devflow init');
    expect(learningToggleSkew('3.2.0', '3.3.0', false)).toContain('learning-off');
  });

  it('known-bad probe: an unreadable running version is skew, never a match', () => {
    expect(learningToggleSkew('3.3.0', null, false)).toContain('devflow init');
  });
});

describe('applyLearningToggle', () => {
  async function writeManifest(version: string, plugins: readonly string[]): Promise<void> {
    await write(path.join(devflowDir, 'manifest.json'), JSON.stringify({
      version,
      plugins,
      scope: 'user',
      features: { ambient: false, memory: false, hud: false, knowledge: true, learning: true, rules: false },
      installedAt: '2026-10-10T00:00:00.000Z',
      updatedAt: '2026-10-10T00:00:00.000Z',
    }));
  }

  const toggle = (learning: boolean, runningVersion: string | null) =>
    applyLearningToggle({ claudeDir, devflowDir, learning, runningVersion, warn, packageRoot: pkg });

  it('without a readable manifest it skips and says to run init', async () => {
    await installOn();

    const outcome = await toggle(false, '3.3.0');

    expect(outcome.kind).toBe('skipped');
    if (outcome.kind !== 'skipped') return;
    expect(outcome.reason).toBe('no-manifest');
    expect(outcome.message).toContain('devflow init');
    expect(await read(installedCommand('implement'))).toBe('implement ON\n');
  });

  it('a manifest from another version skips the converge and leaves every installed file as it was (AC-145)', async () => {
    await writeManifest('3.2.0', ['devflow-core-skills']);
    await installOn();

    const outcome = await toggle(false, '3.3.0');

    expect(outcome.kind).toBe('skipped');
    if (outcome.kind !== 'skipped') return;
    expect(outcome.reason).toBe('version-skew');
    expect(outcome.message).toContain('Run `devflow init`');
    expect(await read(installedCommand('implement'))).toBe('implement ON\n');
    expect(await read(installedAgent('code'))).toBe('code ON\n');
  });

  it('a matching version converges, using the manifest\'s plugin selection for the skill', async () => {
    const withSkill = DEVFLOW_PLUGINS.filter(plugin => skillsOf([plugin]).has(SKILL)).map(plugin => plugin.name);
    await writeManifest('3.3.0', withSkill);
    await installOn();
    await converge(true);
    expect(await exists(installedSkill())).toBe(true);

    const outcome = await toggle(false, '3.3.0');

    expect(outcome.kind).toBe('converged');
    if (outcome.kind !== 'converged') return;
    expect(outcome.result.commandsRewritten).toEqual(['implement.md']);
    expect(outcome.result.skill).toBe('removed');
    expect(await read(installedCommand('implement'))).toBe('implement OFF\n');
  });

  it('a manifest whose plugins do not require the skill never gets it on enable (AC-143)', async () => {
    await writeManifest('3.3.0', [WITHOUT_SKILL.name]);
    await write(installedCommand('implement'), 'implement OFF\n');

    const outcome = await toggle(true, '3.3.0');

    expect(outcome.kind).toBe('converged');
    expect(await exists(installedSkill())).toBe(false);
    expect(await read(installedCommand('implement'))).toBe('implement ON\n');
  });
});

describe('applyLearningToggle with a saved agent override (D-AGENT-OVERRIDE-CARRY)', () => {
  const agent = (variant: 'ON' | 'OFF', model: string, effort: string): string =>
    `---\nname: Code\nmodel: ${model}\neffort: ${effort}\n---\n\nbody ${variant}\n`;

  beforeEach(async () => {
    await write(path.join(pkg, 'dist', 'agents', 'code.md'), agent('ON', 'sonnet', 'high'));
    await write(path.join(learningOffDir('agents', pkg), 'code.md'), agent('OFF', 'sonnet', 'high'));
    await write(path.join(devflowDir, 'manifest.json'), JSON.stringify({
      version: '3.3.0',
      plugins: ['devflow-core-skills'],
      scope: 'user',
      features: { ambient: false, memory: false, hud: false, knowledge: true, learning: true, rules: false },
      installedAt: '2026-10-10T00:00:00.000Z',
      updatedAt: '2026-10-10T00:00:00.000Z',
    }));
    await saveAgentMapping(devflowDir, { version: 1, agents: { code: { model: 'opus', effort: 'low' } } });
  });

  const toggle = (learning: boolean) =>
    applyLearningToggle({ claudeDir, devflowDir, learning, runningVersion: '3.3.0', warn, packageRoot: pkg });

  it('a no-op toggle writes no agent file, reports none rewritten and does not reach for the reapply', async () => {
    await write(installedAgent('code'), agent('OFF', 'opus', 'low'));
    const before = await fs.stat(installedAgent('code'));

    const outcome = await toggle(false);

    expect(outcome.kind).toBe('converged');
    if (outcome.kind !== 'converged') return;
    expect(outcome.result.agentsRewritten).toEqual([]);
    expect(outcome.agentMappingReapplied).toBe(false);
    expect(describeLearningConverge(outcome.result, false)).toBeNull();
    expect((await fs.stat(installedAgent('code'))).ino).toBe(before.ino);
    expect(warnings).toEqual([]);
  });

  it('a real toggle leaves the saved override on the file, and the reapply that follows finds nothing to change', async () => {
    await write(installedAgent('code'), agent('ON', 'opus', 'low'));

    const outcome = await toggle(false);

    expect(outcome.kind).toBe('converged');
    if (outcome.kind !== 'converged') return;
    expect(outcome.result.agentsRewritten).toEqual(['code.md']);
    expect(outcome.agentMappingReapplied).toBe(true);
    expect(await read(installedAgent('code'))).toBe(agent('OFF', 'opus', 'low'));
    expect(warnings).toEqual([]);
  });
});

describe('describeLearningConverge and readRunningVersion', () => {
  const base: ConvergeLearningVariantsResult = {
    converged: true, commandsRewritten: [], agentsRewritten: [], unchanged: 0, notInstalled: 0, skill: 'unchanged',
  };

  it('says nothing when nothing changed, so a no-op toggle prints nothing', () => {
    expect(describeLearningConverge(base, false)).toBeNull();
    expect(describeLearningConverge({ ...base, skill: 'not-selected' }, true)).toBeNull();
  });

  it('counts the rewritten prompts and names the skill change', () => {
    const line = describeLearningConverge(
      { ...base, commandsRewritten: ['a.md', 'b.md'], agentsRewritten: ['c.md'], skill: 'removed' }, false);
    expect(line).toBe('2 command(s) and 1 agent(s) rewritten for the learning-off variant; the apply-decisions skill removed');
    expect(describeLearningConverge({ ...base, skill: 'installed' }, true)).toBe('the apply-decisions skill installed');
  });

  it('reads the package version, and null when package.json is missing or holds none', async () => {
    expect(await readRunningVersion(ROOT)).toMatch(/^\d+\.\d+\.\d+/);
    expect(await readRunningVersion(path.join(tmp, 'nowhere'))).toBeNull();
    await write(path.join(tmp, 'novers', 'package.json'), '{"name":"x"}');
    expect(await readRunningVersion(path.join(tmp, 'novers'))).toBeNull();
  });
});
