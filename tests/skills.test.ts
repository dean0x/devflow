import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawnSync } from 'child_process';
import { existsSync } from 'fs';
import { hasShadow } from '../src/cli/commands/skills.js';
import { skillOwners } from '../src/core/plugins.js';
import { requireBuiltCli } from './helpers.js';

describe('hasShadow', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('returns false when no shadow exists', async () => {
    const result = await hasShadow('software-design', tmpDir);
    expect(result).toBe(false);
  });

  it('returns true when shadow directory exists', async () => {
    await fs.mkdir(path.join(tmpDir, 'skills', 'software-design'), { recursive: true });
    const result = await hasShadow('software-design', tmpDir);
    expect(result).toBe(true);
  });

  it('returns false when shadow is a file not a directory', async () => {
    await fs.mkdir(path.join(tmpDir, 'skills'), { recursive: true });
    await fs.writeFile(path.join(tmpDir, 'skills', 'software-design'), 'not a dir');
    const result = await hasShadow('software-design', tmpDir);
    expect(result).toBe(false);
  });
});


// ---------------------------------------------------------------------------
// `devflow skills list` must answer "which plugin do I select to keep this?"
// ---------------------------------------------------------------------------

describe('devflow skills CLI, end to end under a scratch HOME', () => {
  let cli: string;
  let tmpHome: string;

  const runSkills = (...args: string[]) =>
    spawnSync('node', [cli, 'skills', ...args], {
      encoding: 'utf-8',
      timeout: 60000,
      // A seeded mkdtemp HOME bound INTO the command, never the real one.
      env: { ...process.env, HOME: tmpHome, FORCE_COLOR: '0', NO_COLOR: '1', CI: '1' },
    });

  beforeEach(async () => {
    cli = requireBuiltCli();
    tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-skills-cli-'));
  });

  afterEach(async () => {
    await fs.rm(tmpHome, { recursive: true, force: true });
  });

  it('list names every declaring plugin, never a single first-wins owner', () => {
    const { stdout, status } = runSkills('list');
    expect(status).toBe(0);

    // worktree-support is declared by several plugins; the row must name them
    // all, because any one of them would install it.
    const owners = skillOwners('worktree-support');
    expect(owners.length, 'the fixture must be a genuinely multi-owner skill').toBeGreaterThan(1);
    const row = stdout.split('\n').find(line => line.includes('worktree-support'));
    expect(row, 'worktree-support must appear in the list').toBeDefined();
    for (const owner of owners) {
      expect(row, `the row must name ${owner}`).toContain(owner);
    }
  });

  it('list distinguishes installed from merely available', () => {
    const { stdout } = runSkills('list');
    // Nothing is installed under a fresh HOME, so every row must say so rather
    // than implying the skill is present.
    expect(stdout).toContain('not installed — provided by:');
    expect(stdout).toContain('0 installed');
  });

  it('shadowing a skill outside the selection succeeds and warns it is dormant', () => {
    const { stdout, stderr, status } = runSkills('shadow', 'rust');
    const output = stdout + stderr;
    expect(status, `devflow skills shadow rust failed:\n${output}`).toBe(0);
    expect(output).toContain('Shadowed');
    expect(output).toContain('is inactive');
    expect(output, 'the warning must name the plugin that would activate it').toContain('devflow-rust');
    expect(existsSync(path.join(tmpHome, '.devflow', 'skills', 'rust', 'SKILL.md'))).toBe(true);
  });

  it('an unknown skill is still refused', () => {
    const { status, stdout, stderr } = runSkills('shadow', 'no-such-skill');
    expect(status).toBe(1);
    expect(stdout + stderr).toContain('Unknown skill');
  });
});

// ---------------------------------------------------------------------------
// TP-44 (AC-38): shadowing compliance, then `compliance --set`, stamps the
// installed SKILL.md with the new frameworks (D-COMPLIANCE-SHADOW-SOURCE).
// ---------------------------------------------------------------------------

describe('TP-44 (AC-38): a shadowed compliance skill follows a later compliance --set', () => {
  let cli: string;
  let tmpHome: string;

  const run = (...args: string[]) =>
    spawnSync('node', [cli, ...args], {
      encoding: 'utf-8',
      timeout: 60000,
      // A scratch HOME bound into the command, and a cwd outside any repository,
      // so `init` touches neither the developer's home nor a checkout.
      cwd: tmpHome,
      env: { ...process.env, HOME: tmpHome, FORCE_COLOR: '0', NO_COLOR: '1', CI: '1' },
    });

  const installedSkill = () =>
    fs.readFile(path.join(tmpHome, '.claude', 'skills', 'devflow:compliance', 'SKILL.md'), 'utf-8');

  beforeEach(async () => {
    cli = requireBuiltCli();
    tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-skills-tp44-'));
    await fs.mkdir(path.join(tmpHome, '.claude'), { recursive: true });
    expect(run('init', '--recommended').status).toBe(0);
    expect(run('compliance', '--set', 'gdpr').status).toBe(0);
  });

  afterEach(async () => {
    await fs.rm(tmpHome, { recursive: true, force: true });
  });

  it('the shadow is seeded unstamped, and --set hipaa re-stamps the installed skill', async () => {
    expect(await installedSkill()).toContain('**Machine frameworks: GDPR.**');

    const shadow = run('skills', 'shadow', 'compliance');
    expect(shadow.status, `skills shadow compliance failed:\n${shadow.stdout}${shadow.stderr}`).toBe(0);
    const seeded = await fs.readFile(path.join(tmpHome, '.devflow', 'skills', 'compliance', 'SKILL.md'), 'utf-8');
    expect(seeded, 'the shadow must keep the composition tokens').toContain('${DEVFLOW_COMPLIANCE_ACTIVE}');

    expect(run('compliance', '--set', 'hipaa').status).toBe(0);
    const skill = await installedSkill();
    expect(skill).toContain('**Machine frameworks: HIPAA.**');
    expect(skill).not.toContain('**Machine frameworks: GDPR.**');
  });
});
