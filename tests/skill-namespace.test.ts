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
import { installViaFileCopy, type Spinner } from '../src/cli/utils/installer.js';
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

  it('handles empty string', () => {
    expect(unprefixSkillName('')).toBe('');
  });

  it('handles bare prefix string', () => {
    expect(unprefixSkillName('devflow:')).toBe('');
  });

  it('roundtrips with prefixSkillName', () => {
    const names = ['software-design', 'security', 'go', 'react'];
    for (const name of names) {
      expect(unprefixSkillName(prefixSkillName(name))).toBe(name);
    }
  });
});

describe('LEGACY_SKILL_NAMES includes all current bare names for migration', () => {
  it('every current skill name has a legacy entry for cleanup', () => {
    const currentSkills = getAllSkillNames();
    for (const skill of currentSkills) {
      expect(LEGACY_SKILL_NAMES, `LEGACY_SKILL_NAMES should include '${skill}' for migration cleanup`).toContain(skill);
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
  async function runInstall(opts?: { isPartialInstall?: boolean }): Promise<void> {
    const pluginDef = {
      name: 'devflow-test-plugin',
      description: 'test',
      commands: [],
      agents: [],
      skills: [testSkillName],
    };
    await installViaFileCopy({
      plugins: [pluginDef],
      claudeDir,
      pluginsDir,
      rootDir,
      devflowDir,
      skillsMap: new Map([[testSkillName, 'devflow-test-plugin']]),
      agentsMap: new Map(),
      isPartialInstall: opts?.isPartialInstall ?? false,
      teamsEnabled: false,
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

    await runInstall();

    const installed = path.join(claudeDir, 'skills', `devflow:${testSkillName}`, 'SKILL.md');
    const content = await fs.readFile(installed, 'utf-8');
    expect(content).toBe('source content');
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
