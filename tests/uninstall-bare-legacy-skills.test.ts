/**
 * A full uninstall and the bare legacy skill folders in the shared skills folder.
 *
 * `~/.claude/skills` belongs to Claude Code and to other tools too. A folder there named `python`,
 * `plan` or `review` may be the skill of the user, so the name does not prove that devflow made it.
 * A full uninstall removes a bare legacy folder only when its `SKILL.md` is a copy that a release of
 * devflow installed (the check `devflow init` uses). Every other bare legacy folder stays in place
 * and the output names it. The dry run goes through the real dry-run phase and lists the same set.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { runDryRunPhase, runFullPhaseForScope } from '../src/cli/commands/uninstall.js';
import { assertTempHome, TEMP_HOME_PREFIX } from './setup/home-isolation.js';

/** The `SKILL.md` that devflow-kit 1.8.3 installed for the bare `python` skill, byte for byte. */
const RELEASED_PYTHON = fileURLToPath(new URL('./fixtures/released-legacy-skills/python.SKILL.md', import.meta.url));
const USER_SKILL_BYTES = '# my own skill, not made by devflow\n';
const NOT_MADE = 'devflow did not make this folder';
const UNDECIDED = 'devflow could not tell if it made this folder';

describe('uninstall and the bare legacy skill folders', () => {
  let home: string;
  let claudeDir: string;
  let devflowDir: string;
  let skillsDir: string;
  let linkTarget: string;

  const skill = (name: string): string => path.join(skillsDir, name);
  const exists = (file: string): Promise<boolean> => fs.lstat(file).then(() => true, () => false);

  beforeEach(async () => {
    home = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), TEMP_HOME_PREFIX)));
    assertTempHome(home);
    vi.stubEnv('HOME', home);
    claudeDir = path.join(home, '.claude');
    devflowDir = path.join(home, '.devflow');
    skillsDir = path.join(claudeDir, 'skills');
    linkTarget = path.join(home, 'elsewhere');

    // A folder devflow made: the released copy of python.
    await fs.mkdir(skill('python'), { recursive: true });
    await fs.copyFile(RELEASED_PYTHON, path.join(skill('python'), 'SKILL.md'));
    // A skill of the user under a legacy name: a SKILL.md that no release shipped.
    await fs.mkdir(skill('go'), { recursive: true });
    await fs.writeFile(path.join(skill('go'), 'SKILL.md'), USER_SKILL_BYTES, 'utf-8');
    // A legacy name with no SKILL.md: the check cannot decide.
    await fs.mkdir(skill('rust'), { recursive: true });
    await fs.writeFile(path.join(skill('rust'), 'notes.txt'), 'the user wrote this\n', 'utf-8');
    // A link under a legacy name, to a folder that holds the released bytes: the check does not follow it.
    await fs.mkdir(linkTarget, { recursive: true });
    await fs.copyFile(RELEASED_PYTHON, path.join(linkTarget, 'SKILL.md'));
    await fs.symlink(linkTarget, skill('java'));
    // A folder in the namespace of devflow keeps its current behaviour: it is removed.
    await fs.mkdir(skill('devflow:typescript'), { recursive: true });
    await fs.writeFile(path.join(skill('devflow:typescript'), 'SKILL.md'), '# devflow file\n', 'utf-8');
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    await fs.rm(home, { recursive: true, force: true });
  });

  /** Run `fn` with stdout captured; returns what was written. */
  async function captureStdout(fn: () => Promise<void>): Promise<string> {
    const written: string[] = [];
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      written.push(String(chunk));
      return true;
    });
    try {
      await fn();
    } finally {
      spy.mockRestore();
    }
    return written.join('');
  }

  const fullUninstall = (): Promise<string> => captureStdout(() => runFullPhaseForScope({
    scope: 'user',
    claudeDir,
    devflowDir,
    devflowScriptsDir: path.join(devflowDir, 'scripts'),
    verbose: false,
    keepDocs: false,
    isTTY: false,
  }));

  /** The dry run of the full uninstall through the real dry-run phase, with the project folder out of reach. */
  async function dryRun(): Promise<string[]> {
    vi.spyOn(process, 'cwd').mockReturnValue(home);
    const out = await captureStdout(() => runDryRunPhase({
      scopesToUninstall: ['user'],
      isSelectiveUninstall: false,
      selectedPlugins: [],
      installedPlugins: [],
    }));
    return out.split('\n').filter(line => line.includes(skillsDir + path.sep));
  }

  it('removes the folder devflow made and keeps every other bare legacy folder with its bytes', async () => {
    const out = await fullUninstall();

    expect(await exists(skill('python')), 'the released copy is removed').toBe(false);
    expect(await exists(skill('devflow:typescript')), 'a folder in the devflow namespace is removed').toBe(false);
    expect(await fs.readFile(path.join(skill('go'), 'SKILL.md'), 'utf-8')).toBe(USER_SKILL_BYTES);
    expect(await fs.readFile(path.join(skill('rust'), 'notes.txt'), 'utf-8')).toBe('the user wrote this\n');
    expect((await fs.lstat(skill('java'))).isSymbolicLink(), 'the link stays a link').toBe(true);
    expect(await fs.readFile(path.join(linkTarget, 'SKILL.md'), 'utf-8')).toBe(await fs.readFile(RELEASED_PYTHON, 'utf-8'));

    expect(out).toContain(`Kept ${skill('go')}: ${NOT_MADE}`);
    expect(out).toContain(`Kept ${skill('rust')}: ${UNDECIDED}`);
    expect(out).toContain(`Kept ${skill('java')}: ${UNDECIDED}`);
    expect(out, 'a removed folder is not reported as kept').not.toContain(`Kept ${skill('python')}`);
  });

  it('names no folder that is absent, and the user folders of a name outside the legacy list are not named', async () => {
    await fs.mkdir(skill('security'), { recursive: true });
    await fs.writeFile(path.join(skill('security'), 'SKILL.md'), USER_SKILL_BYTES, 'utf-8');

    const out = await fullUninstall();

    expect(await fs.readFile(path.join(skill('security'), 'SKILL.md'), 'utf-8')).toBe(USER_SKILL_BYTES);
    expect(out).not.toContain(skill('security'));
    expect(out).not.toContain(skill('plan'));
  });

  it('the dry run lists the same set that the removal acts on, and names the folders that stay', async () => {
    const preview = await dryRun();

    const previewKept = preview.filter(line => line.includes('(kept: '));
    const previewRemoved = preview
      .filter(line => !line.includes('(kept: '))
      .map(line => line.slice(line.indexOf(skillsDir)).trim());
    expect(previewKept.some(line => line.includes(`${skill('go')} (kept: ${NOT_MADE})`))).toBe(true);
    expect(previewKept.some(line => line.includes(`${skill('rust')} (kept: ${UNDECIDED})`))).toBe(true);
    expect(previewKept.some(line => line.includes(`${skill('java')} (kept: ${UNDECIDED})`))).toBe(true);
    expect(previewRemoved.sort()).toEqual([skill('devflow:typescript'), skill('python')].sort());

    await fullUninstall();
    const gone: string[] = [];
    for (const name of ['python', 'go', 'rust', 'java', 'devflow:typescript']) {
      if (!(await exists(skill(name)))) gone.push(skill(name));
    }
    expect(gone.sort(), 'the dry run and the removal act on the same folders').toEqual(previewRemoved.sort());
  });
});
