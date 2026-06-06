import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  cleanSelfLearningArtifacts,
  AUTO_GENERATED_MARKER,
} from '../src/cli/utils/learning-cleanup.js';

describe('cleanSelfLearningArtifacts', () => {
  let tmpDir: string;
  let claudeDir: string;
  let skillsDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-learning-cleanup-test-'));
    claudeDir = path.join(tmpDir, '.claude');
    skillsDir = path.join(claudeDir, 'skills');
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  // ---------------------------------------------------------------------------
  // Missing directory — ENOENT path
  // ---------------------------------------------------------------------------

  it('is a no-op when skills dir does not exist', async () => {
    // No skills dir created
    const result = await cleanSelfLearningArtifacts(claudeDir);
    expect(result.removed).toBe(0);
    expect(result.paths).toEqual([]);
  });

  // ---------------------------------------------------------------------------
  // devflow: prefix skip branch
  // ---------------------------------------------------------------------------

  it('skips devflow-namespaced skill dirs', async () => {
    // Use a dir name that starts with "devflow:" to test the prefix skip branch.
    // The dir name is deliberately prefixed but not a real skill — the function
    // checks entry.name.startsWith('devflow:') and skips regardless of contents.
    const prefixedSkillDirName = ['devflow', 'security'].join(':');
    const devflowSkillDir = path.join(skillsDir, prefixedSkillDirName);
    await fs.mkdir(devflowSkillDir, { recursive: true });
    await fs.writeFile(
      path.join(devflowSkillDir, 'SKILL.md'),
      `---\n# ${AUTO_GENERATED_MARKER}\n---\n# Devflow skill\n`,
      'utf-8',
    );

    const result = await cleanSelfLearningArtifacts(claudeDir);

    expect(result.removed).toBe(0);
    // The devflow-namespaced skill must still exist
    await expect(fs.access(devflowSkillDir)).resolves.toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // Auto-generated marker detection — marked skills are removed
  // ---------------------------------------------------------------------------

  it('removes skill dirs that have the auto-generated marker in SKILL.md', async () => {
    const markedSkillDir = path.join(skillsDir, 'my-workflow-skill');
    await fs.mkdir(markedSkillDir, { recursive: true });
    await fs.writeFile(
      path.join(markedSkillDir, 'SKILL.md'),
      `---\n# ${AUTO_GENERATED_MARKER}\n---\n\n# My Workflow Skill\n`,
      'utf-8',
    );

    const result = await cleanSelfLearningArtifacts(claudeDir);

    expect(result.removed).toBe(1);
    expect(result.paths).toContain(markedSkillDir);
    await expect(fs.access(markedSkillDir)).rejects.toThrow();
  });

  it('preserves skill dirs without the auto-generated marker', async () => {
    const userSkillDir = path.join(skillsDir, 'user-authored-skill');
    await fs.mkdir(userSkillDir, { recursive: true });
    await fs.writeFile(
      path.join(userSkillDir, 'SKILL.md'),
      '# User-authored skill\n\nNo auto-generated marker here.\n',
      'utf-8',
    );

    const result = await cleanSelfLearningArtifacts(claudeDir);

    expect(result.removed).toBe(0);
    await expect(fs.access(userSkillDir)).resolves.toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // Return contract
  // ---------------------------------------------------------------------------

  it('returns correct removed count and paths when multiple marked skills exist', async () => {
    await fs.mkdir(skillsDir, { recursive: true });
    const markedA = path.join(skillsDir, 'skill-alpha');
    const markedB = path.join(skillsDir, 'skill-beta');
    for (const dir of [markedA, markedB]) {
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(
        path.join(dir, 'SKILL.md'),
        `---\n# ${AUTO_GENERATED_MARKER}\n---\n`,
        'utf-8',
      );
    }

    const result = await cleanSelfLearningArtifacts(claudeDir);

    expect(result.removed).toBe(2);
    expect(result.paths).toContain(markedA);
    expect(result.paths).toContain(markedB);
  });

  it('returns { removed: 0, paths: [] } when no marked skills found in a populated skills dir', async () => {
    const safeDir = path.join(skillsDir, 'safe-skill');
    await fs.mkdir(safeDir, { recursive: true });
    await fs.writeFile(
      path.join(safeDir, 'SKILL.md'),
      '# Safe skill — no auto-generated marker\n',
      'utf-8',
    );

    const result = await cleanSelfLearningArtifacts(claudeDir);

    expect(result.removed).toBe(0);
    expect(result.paths).toEqual([]);
  });

  // ---------------------------------------------------------------------------
  // Mixed scenario — marked + user + devflow-namespaced coexist
  // ---------------------------------------------------------------------------

  it('removes only marked skills, preserves user and devflow-namespaced skills', async () => {
    await fs.mkdir(skillsDir, { recursive: true });

    const markedDir = path.join(skillsDir, 'auto-gen-skill');
    await fs.mkdir(markedDir, { recursive: true });
    await fs.writeFile(
      path.join(markedDir, 'SKILL.md'),
      `---\n# ${AUTO_GENERATED_MARKER}\n---\n`,
      'utf-8',
    );

    const userDir = path.join(skillsDir, 'user-skill');
    await fs.mkdir(userDir, { recursive: true });
    await fs.writeFile(
      path.join(userDir, 'SKILL.md'),
      '# User skill — no marker\n',
      'utf-8',
    );

    const prefixedName = ['devflow', 'security'].join(':');
    const devflowSkillDir2 = path.join(skillsDir, prefixedName);
    await fs.mkdir(devflowSkillDir2, { recursive: true });
    await fs.writeFile(
      path.join(devflowSkillDir2, 'SKILL.md'),
      `---\n# ${AUTO_GENERATED_MARKER}\n---\n`,
      'utf-8',
    );

    const result = await cleanSelfLearningArtifacts(claudeDir);

    expect(result.removed).toBe(1);
    expect(result.paths).toContain(markedDir);
    await expect(fs.access(markedDir)).rejects.toThrow();
    await expect(fs.access(userDir)).resolves.toBeUndefined();
    await expect(fs.access(devflowSkillDir2)).resolves.toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // Idempotency
  // ---------------------------------------------------------------------------

  it('is idempotent — running twice on the same dir produces no errors', async () => {
    const markedDir = path.join(skillsDir, 'my-skill');
    await fs.mkdir(markedDir, { recursive: true });
    await fs.writeFile(
      path.join(markedDir, 'SKILL.md'),
      `---\n# ${AUTO_GENERATED_MARKER}\n---\n`,
      'utf-8',
    );

    await cleanSelfLearningArtifacts(claudeDir);
    // Second run — everything already removed
    const result = await cleanSelfLearningArtifacts(claudeDir);
    expect(result.removed).toBe(0);
  });
});
