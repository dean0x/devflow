/**
 * `devflow skills shadow` and `devflow skills list` against a workflow that ships as a
 * skill folder (D-WORKFLOW-SHADOW-REFUSAL).
 *
 * The real folder set is empty until a workflow is registered, so no run against the real
 * set reaches either call to `workflowFolderShadowRefusal`. These tests inject a fixture
 * set into `runSkillsAction` instead. Each assertion names the call site it guards: remove
 * the call and the test goes red.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as p from '@clack/prompts';
import { runSkillsAction } from '../../src/cli/commands/skills.js';

vi.mock('@clack/prompts', () => ({
  log: { error: vi.fn(), info: vi.fn(), success: vi.fn(), warn: vi.fn() },
  note: vi.fn(),
}));

/** Thrown in place of `process.exit` so a refusal stops the action the way the real exit does. */
class ExitSignal extends Error {
  constructor(readonly code: number | undefined) {
    super(`process.exit(${String(code)})`);
  }
}

const FOLDER = 'fixture-flow';
const BARE_FOLDER = 'fixture-bare';
const FOLDER_SET: ReadonlySet<string> = new Set([FOLDER, BARE_FOLDER]);

const stripAnsi = (text: string): string => text.replace(/\u001b\[[0-9;]*m/g, '');

async function exists(target: string): Promise<boolean> {
  try {
    await fs.stat(target);
    return true;
  } catch {
    return false;
  }
}

describe('skills command: a workflow that ships as a skill folder', () => {
  let tmpHome: string;

  const shadowDir = (name: string): string => path.join(tmpHome, '.devflow', 'skills', name);
  const errorMessages = (): string[] => vi.mocked(p.log.error).mock.calls.map(call => stripAnsi(String(call[0])));

  async function seedShadow(name: string): Promise<void> {
    await fs.mkdir(shadowDir(name), { recursive: true });
    await fs.writeFile(path.join(shadowDir(name), 'SKILL.md'), '# shadow\n');
  }

  /** The rows `skills list` passed to the note, ANSI stripped. */
  function listRows(): string[] {
    const calls = vi.mocked(p.note).mock.calls;
    expect(calls, 'skills list must render one note').toHaveLength(1);
    return stripAnsi(String(calls[0]?.[0])).split('\n');
  }

  beforeEach(async () => {
    tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-skills-folder-'));
    vi.stubEnv('HOME', tmpHome);
    vi.stubEnv('CLAUDE_CONFIG_DIR', '');
    vi.mocked(p.log.error).mockClear();
    vi.mocked(p.log.success).mockClear();
    vi.mocked(p.note).mockClear();
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new ExitSignal(code);
    }) as never);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await fs.rm(tmpHome, { recursive: true, force: true });
  });

  describe('shadow', () => {
    it('refuses with exit 1 and names the reason, before it looks up a source', async () => {
      await expect(runSkillsAction('shadow', FOLDER, FOLDER_SET)).rejects.toMatchObject({ code: 1 });

      expect(errorMessages()).toEqual([
        `${FOLDER} ships as a skill folder built for the machine's variant, so a shadow cannot replace it. Nothing was shadowed.`,
      ]);
      expect(await exists(shadowDir(FOLDER)), 'a refused shadow must leave nothing behind').toBe(false);
    });

    it('refuses the prefixed spelling the same way', async () => {
      await expect(runSkillsAction('shadow', `devflow:${FOLDER}`, FOLDER_SET)).rejects.toMatchObject({ code: 1 });

      expect(errorMessages()).toHaveLength(1);
      expect(errorMessages()[0]).toContain(`${FOLDER} ships as a skill folder`);
    });

    it('still shadows a skill that is not in the folder set', async () => {
      await runSkillsAction('shadow', 'rust', FOLDER_SET);

      expect(errorMessages()).toEqual([]);
      expect(await exists(path.join(shadowDir('rust'), 'SKILL.md'))).toBe(true);
    });
  });

  describe('list', () => {
    it('tags the shadow of a skill folder as ignored', async () => {
      await seedShadow(FOLDER);

      await runSkillsAction('list', undefined, FOLDER_SET);

      const row = listRows().find(line => line.includes(FOLDER));
      expect(row, `${FOLDER} must have a row`).toBeDefined();
      expect(row).toContain('shadow ignored — skill folder');
    });

    it('tags a folder with no shadow with nothing, and an ordinary shadow as shadowed', async () => {
      await seedShadow('rust');

      await runSkillsAction('list', undefined, FOLDER_SET);

      const bareRow = listRows().find(line => line.includes(BARE_FOLDER));
      expect(bareRow, `${BARE_FOLDER} must have a row`).toBeDefined();
      expect(bareRow).not.toContain('shadow ignored');

      const rustRow = listRows().find(line => line.trimStart().startsWith('rust '));
      expect(rustRow, 'rust must have a row').toBeDefined();
      expect(rustRow).toContain('shadowed');
      expect(rustRow).not.toContain('shadow ignored');
    });
  });
});
