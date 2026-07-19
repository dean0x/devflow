import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  SKILL_NAMESPACE,
  prefixSkillName,
  unprefixSkillName,
  getAllSkillNames,
  LEGACY_SKILL_NAMES,
} from '../src/cli/plugins.js';
import { installViaFileCopy, type InstallReport, type Spinner } from '../src/cli/utils/installer.js';
import { hasShadow } from '../src/cli/commands/skills.js';

/** No-op spinner for tests */
const noopSpinner: Spinner = {
  start() {},
  stop() {},
  message() {},
};

describe('SKILL_NAMESPACE', () => {
  it('is devflow:', () => {
    expect(SKILL_NAMESPACE).toBe('devflow:');
  });
});

describe('prefixSkillName', () => {
  it('adds devflow: prefix to bare name', () => {
    expect(prefixSkillName('software-design')).toBe('devflow:software-design');
    expect(prefixSkillName('typescript')).toBe('devflow:typescript');
    expect(prefixSkillName('go')).toBe('devflow:go');
  });

  it('is a no-op for already-prefixed names', () => {
    expect(prefixSkillName('devflow:software-design')).toBe('devflow:software-design');
    expect(prefixSkillName('devflow:go')).toBe('devflow:go');
  });

  it('handles colon-containing skill names', () => {
    expect(prefixSkillName('feature-knowledge')).toBe('devflow:feature-knowledge');
    expect(prefixSkillName('apply-feature-knowledge')).toBe('devflow:apply-feature-knowledge');
  });

  it('handles empty string', () => {
    expect(prefixSkillName('')).toBe('devflow:');
  });
});

describe('unprefixSkillName', () => {
  it('strips devflow: prefix', () => {
    expect(unprefixSkillName('devflow:software-design')).toBe('software-design');
    expect(unprefixSkillName('devflow:typescript')).toBe('typescript');
  });

  it('is a no-op for bare names', () => {
    expect(unprefixSkillName('software-design')).toBe('software-design');
    expect(unprefixSkillName('go')).toBe('go');
  });

  it('handles colon-containing skill names', () => {
    expect(unprefixSkillName('devflow:feature-knowledge')).toBe('feature-knowledge');
    expect(unprefixSkillName('devflow:apply-feature-knowledge')).toBe('apply-feature-knowledge');
  });

  it('handles empty string', () => {
    expect(unprefixSkillName('')).toBe('');
  });

  it('handles bare prefix string', () => {
    expect(unprefixSkillName('devflow:')).toBe('');
  });

  it('roundtrips with prefixSkillName', () => {
    const names = ['software-design', 'security', 'go', 'react', 'feature-knowledge', 'apply-feature-knowledge'];
    for (const name of names) {
      expect(unprefixSkillName(prefixSkillName(name))).toBe(name);
    }
  });
});

/**
 * Frozen historical skill set derived from: git ls-tree --name-only dcecda3^ -- shared/skills/
 *
 * dcecda3 (2026-03-30) is the commit that introduced the devflow: namespace prefix.
 * These are the bare directory names that existed immediately BEFORE namespacing, so they
 * are the only skills that could ever have had a bare ~/.claude/skills/<name> install.
 *
 * THIS SET MUST NEVER GROW. Adding a new entry here would assert that a skill born after
 * namespacing had a pre-namespace install, which is impossible — and would allow a bare
 * legacy entry to delete a same-named foreign skill directory at init time.
 */
const PRE_NAMESPACE_SKILLS: ReadonlySet<string> = new Set([
  'accessibility',
  'agent-teams',
  'ambient-router',
  'architecture-patterns',
  'complexity-patterns',
  'consistency-patterns',
  'core-patterns',
  'database-patterns',
  'debug-orchestration',
  'dependencies-patterns',
  'docs-framework',
  'documentation-patterns',
  'frontend-design',
  'git-safety',
  'git-workflow',
  'github-patterns',
  'go',
  'implementation-orchestration',
  'implementation-patterns',
  'input-validation',
  'java',
  'knowledge-persistence',
  'performance-patterns',
  'pipeline-orchestration',
  'plan-orchestration',
  'python',
  'react',
  'regression-patterns',
  'resolve-orchestration',
  'review-methodology',
  'review-orchestration',
  'rust',
  'search-first',
  'security-patterns',
  'self-review',
  'test-driven-development',
  'test-patterns',
  'typescript',
  'worktree-support',
]);

describe('LEGACY_SKILL_NAMES invariant: frozen pre-namespace bare-skill coverage', () => {
  it('every current skill that existed pre-namespace has a bare legacy entry for cleanup', () => {
    // Assertion A: pre-namespace current skills need a bare entry so init cleans up old installs.
    const currentSkills = getAllSkillNames();
    for (const skill of currentSkills) {
      if (!PRE_NAMESPACE_SKILLS.has(skill)) continue;
      expect(
        LEGACY_SKILL_NAMES,
        `LEGACY_SKILL_NAMES should include '${skill}' — it existed before the devflow: namespace was introduced and may have bare pre-namespace installs to clean up`,
      ).toContain(skill);
    }
  });

  it('no post-namespace skill appears bare in LEGACY_SKILL_NAMES (foreign-dir deletion risk)', () => {
    // Assertion B (inverse guard): skills born after namespacing never had bare pre-namespace
    // installs, so a bare entry has no migration value and only adds risk: init's unguarded
    // fs.rm will delete ~/.claude/skills/<entry>, which could be a foreign plugin's skill dir.
    const currentSkills = getAllSkillNames();
    for (const skill of currentSkills) {
      if (PRE_NAMESPACE_SKILLS.has(skill)) continue;
      expect(
        LEGACY_SKILL_NAMES,
        `LEGACY_SKILL_NAMES must not include '${skill}' as a bare entry — this skill was born after the devflow: namespace was introduced (dcecda3, 2026-03-30) and never had a bare pre-namespace install. A bare entry only adds risk of deleting a foreign skill dir at ~/.claude/skills/${skill}.`,
      ).not.toContain(skill);
    }
  });
});

describe('hasShadow normalizes prefixed names', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-shadow-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('detects shadow with bare name', async () => {
    await fs.mkdir(path.join(tmpDir, 'skills', 'software-design'), { recursive: true });
    expect(await hasShadow('software-design', tmpDir)).toBe(true);
  });

  it('detects shadow with prefixed name', async () => {
    await fs.mkdir(path.join(tmpDir, 'skills', 'software-design'), { recursive: true });
    expect(await hasShadow('devflow:software-design', tmpDir)).toBe(true);
  });

  it('returns false when no shadow exists', async () => {
    await fs.mkdir(path.join(tmpDir, 'skills'), { recursive: true });
    expect(await hasShadow('nonexistent', tmpDir)).toBe(false);
  });
});

describe('installViaFileCopy skill lifecycle', () => {
  let claudeDir: string;
  let devflowDir: string;
  let pluginsDir: string;
  let rootDir: string;
  const testSkillName = 'test-skill';

  /** Seed a minimal plugin with one skill in the build output directory */
  async function seedPlugin(skillName: string, content: string): Promise<void> {
    const pluginName = 'devflow-test-plugin';
    const skillDir = path.join(pluginsDir, pluginName, 'skills', skillName);
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(path.join(skillDir, 'SKILL.md'), content);
  }

  /** Run installViaFileCopy with a single test skill */
  async function runInstall(opts?: { isPartialInstall?: boolean }): Promise<InstallReport> {
    const pluginDef = {
      name: 'devflow-test-plugin',
      description: 'test',
      commands: [],
      agents: [],
      skills: [testSkillName],
    };
    return installViaFileCopy({
      plugins: [pluginDef],
      claudeDir,
      pluginsDir,
      rootDir,
      devflowDir,
      skillsMap: new Map([[testSkillName, 'devflow-test-plugin']]),
      agentsMap: new Map(),
      isPartialInstall: opts?.isPartialInstall ?? false,
      spinner: noopSpinner,
    });
  }

  beforeEach(async () => {
    claudeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-claude-'));
    devflowDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-home-'));
    pluginsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-plugins-'));
    rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-root-'));
  });

  afterEach(async () => {
    await fs.rm(claudeDir, { recursive: true, force: true });
    await fs.rm(devflowDir, { recursive: true, force: true });
    await fs.rm(pluginsDir, { recursive: true, force: true });
    await fs.rm(rootDir, { recursive: true, force: true });
  });

  it('installs skill to prefixed path', async () => {
    await seedPlugin(testSkillName, 'source content');
    await runInstall();

    const installed = path.join(claudeDir, 'skills', `devflow:${testSkillName}`, 'SKILL.md');
    const content = await fs.readFile(installed, 'utf-8');
    expect(content).toBe('source content');
  });

  it('removes legacy unprefixed dir during cleanup', async () => {
    // Use a real skill name from DEVFLOW_PLUGINS so cleanup loop finds it
    const realSkill = 'software-design';
    const legacyDir = path.join(claudeDir, 'skills', realSkill);
    await fs.mkdir(legacyDir, { recursive: true });
    await fs.writeFile(path.join(legacyDir, 'SKILL.md'), 'legacy');

    await seedPlugin(testSkillName, 'new content');
    await runInstall();

    // Legacy dir for real skill should be gone (cleaned by DEVFLOW_PLUGINS loop)
    await expect(fs.stat(legacyDir)).rejects.toThrow();
  });

  it('cleanup removes stale prefixed dir and reinstalls fresh', async () => {
    // Use a real skill name so the cleanup loop processes it
    const realSkill = 'software-design';
    const oldPrefixed = path.join(claudeDir, 'skills', `devflow:${realSkill}`);
    await fs.mkdir(oldPrefixed, { recursive: true });
    await fs.writeFile(path.join(oldPrefixed, 'SKILL.md'), 'old');
    await fs.writeFile(path.join(oldPrefixed, 'stale-file.md'), 'should be removed');

    await seedPlugin(testSkillName, 'test content');
    await runInstall();

    // Cleanup should have wiped the old prefixed dir for real skill
    // (it gets reinstalled by the real plugin if available, but in our temp pluginsDir
    // the real plugin doesn't exist, so no reinstall — dir should be gone)
    await expect(fs.stat(path.join(oldPrefixed, 'stale-file.md'))).rejects.toThrow();
  });

  it('shadowed skill installs shadow content to prefixed path', async () => {
    await seedPlugin(testSkillName, 'source content');

    // Create shadow override at ~/.devflow/skills/{bare-name}/
    const shadowDir = path.join(devflowDir, 'skills', testSkillName);
    await fs.mkdir(shadowDir, { recursive: true });
    await fs.writeFile(path.join(shadowDir, 'SKILL.md'), 'shadow override');

    await runInstall();

    const installed = path.join(claudeDir, 'skills', `devflow:${testSkillName}`, 'SKILL.md');
    const content = await fs.readFile(installed, 'utf-8');
    expect(content).toBe('shadow override');
  });

  it('empty shadow dir falls back to source', async () => {
    await seedPlugin(testSkillName, 'source content');

    // Create empty shadow directory
    const shadowDir = path.join(devflowDir, 'skills', testSkillName);
    await fs.mkdir(shadowDir, { recursive: true });

    const report = await runInstall();

    const installed = path.join(claudeDir, 'skills', `devflow:${testSkillName}`, 'SKILL.md');
    const content = await fs.readFile(installed, 'utf-8');
    expect(content).toBe('source content');
    // empty shadow dir → missing-skill-md skip reported
    expect(report.shadowedSkills).not.toContain(testSkillName);
    expect(report.skippedShadows).toHaveLength(1);
    expect(report.skippedShadows[0]).toMatchObject({ kind: 'skill', name: testSkillName, reason: 'missing-skill-md' });
  });

  it('shadow dir with only notes.md (no SKILL.md) → source installed + skip reported', async () => {
    await seedPlugin(testSkillName, 'source content');

    const shadowDir = path.join(devflowDir, 'skills', testSkillName);
    await fs.mkdir(shadowDir, { recursive: true });
    await fs.writeFile(path.join(shadowDir, 'notes.md'), 'my notes');

    const report = await runInstall();

    const installed = path.join(claudeDir, 'skills', `devflow:${testSkillName}`, 'SKILL.md');
    const content = await fs.readFile(installed, 'utf-8');
    expect(content).toBe('source content');
    expect(report.skippedShadows).toHaveLength(1);
    expect(report.skippedShadows[0]).toMatchObject({ kind: 'skill', name: testSkillName, reason: 'missing-skill-md' });
  });

  it('shadow dir with subdirectory: shadow content copied fully to prefixed path', async () => {
    await seedPlugin(testSkillName, 'source content');

    const shadowDir = path.join(devflowDir, 'skills', testSkillName);
    await fs.mkdir(path.join(shadowDir, 'references'), { recursive: true });
    await fs.writeFile(path.join(shadowDir, 'SKILL.md'), 'shadow override');
    await fs.writeFile(path.join(shadowDir, 'references', 'extra.md'), 'extra');

    const report = await runInstall();

    const skillTarget = path.join(claudeDir, 'skills', `devflow:${testSkillName}`);
    expect(await fs.readFile(path.join(skillTarget, 'SKILL.md'), 'utf-8')).toBe('shadow override');
    expect(await fs.readFile(path.join(skillTarget, 'references', 'extra.md'), 'utf-8')).toBe('extra');
    expect(report.shadowedSkills).toContain(testSkillName);
    expect(report.skippedShadows).toHaveLength(0);
  });

  it('valid shadow → name reported in shadowedSkills', async () => {
    await seedPlugin(testSkillName, 'source content');

    const shadowDir = path.join(devflowDir, 'skills', testSkillName);
    await fs.mkdir(shadowDir, { recursive: true });
    await fs.writeFile(path.join(shadowDir, 'SKILL.md'), 'shadow content');

    const report = await runInstall();

    expect(report.shadowedSkills).toContain(testSkillName);
    expect(report.skippedShadows).toHaveLength(0);
  });

  it('no shadow → empty report fields', async () => {
    await seedPlugin(testSkillName, 'source content');

    const report = await runInstall();

    expect(report.shadowedSkills).toHaveLength(0);
    expect(report.shadowedRules).toHaveLength(0);
    expect(report.skippedShadows).toHaveLength(0);
  });

  it('partial install still cleans skill dirs (skills are universal)', async () => {
    // Use a real skill name so cleanup loop finds it
    const realSkill = 'software-design';
    const legacyDir = path.join(claudeDir, 'skills', realSkill);
    await fs.mkdir(legacyDir, { recursive: true });
    await fs.writeFile(path.join(legacyDir, 'SKILL.md'), 'legacy');

    await seedPlugin(testSkillName, 'new content');
    await runInstall({ isPartialInstall: true });

    // Legacy bare-named dir should be gone (skill cleanup always runs)
    await expect(fs.stat(legacyDir)).rejects.toThrow();
    // Prefixed dir for test skill should be installed
    const installed = path.join(claudeDir, 'skills', `devflow:${testSkillName}`, 'SKILL.md');
    expect(await fs.readFile(installed, 'utf-8')).toBe('new content');
  });

  it('partial install preserves commands and agents dirs', async () => {
    // Seed existing command dir
    const commandsDir = path.join(claudeDir, 'commands', 'devflow');
    await fs.mkdir(commandsDir, { recursive: true });
    await fs.writeFile(path.join(commandsDir, 'existing.md'), 'keep me');

    await seedPlugin(testSkillName, 'content');
    await runInstall({ isPartialInstall: true });

    // Commands dir should still exist (only wiped on full install)
    const content = await fs.readFile(path.join(commandsDir, 'existing.md'), 'utf-8');
    expect(content).toBe('keep me');
  });

  it('full shadow cycle: install → shadow → reinstall uses shadow', async () => {
    await seedPlugin(testSkillName, 'v1 source');

    // First install: source content
    await runInstall();
    const installed = path.join(claudeDir, 'skills', `devflow:${testSkillName}`, 'SKILL.md');
    expect(await fs.readFile(installed, 'utf-8')).toBe('v1 source');

    // User creates shadow override
    const shadowDir = path.join(devflowDir, 'skills', testSkillName);
    await fs.mkdir(shadowDir, { recursive: true });
    await fs.writeFile(path.join(shadowDir, 'SKILL.md'), 'user customization');

    // Source gets updated
    await seedPlugin(testSkillName, 'v2 source');

    // Second install: shadow wins over updated source
    await runInstall();
    expect(await fs.readFile(installed, 'utf-8')).toBe('user customization');

    // User removes shadow
    await fs.rm(shadowDir, { recursive: true, force: true });

    // Third install: falls back to latest source
    await runInstall();
    expect(await fs.readFile(installed, 'utf-8')).toBe('v2 source');
  });
});
