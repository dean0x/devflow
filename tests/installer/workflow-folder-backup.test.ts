/**
 * The workflow skill folder install under the backup session: a file in the installed folder that
 * devflow did not ship moves to the backup folder before the swap renames anything, a move that
 * fails keeps the folder as it is, and the displaced folder is scanned again before it goes. The
 * old command file of a workflow that now ships as a folder is removed, never moved.
 *
 * The REAL registry of folders may be empty, so every test installs the five-host FIXTURE folder
 * (tests/fixtures/workflow-folder.ts) from files built here. Every test works in a temp home, with
 * the clock and the random bytes injected through the backup session, and nothing here reads or
 * writes the real home.
 */
import { promises as fs } from 'fs';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { formatBackupSummary } from '../../src/cli/commands/install-report.js';
import { VARIANT_KEYS } from '../../src/core/curation-variants.js';
import {
  stampBuildId,
  workflowBuildId,
  workflowFolderFiles,
  workflowFolderKey,
  workflowFolderRelPath,
  type WorkflowFolder,
} from '../../src/core/mds-variants.js';
import type { PluginDefinition } from '../../src/core/plugins.js';
import { installViaFileCopy, type Spinner } from '../../src/targets/claude-code/installer.js';
import { installWorkflowFolder, type WorkflowFolderFile } from '../../src/targets/claude-code/workflow-folder-install.js';
import { testBackups } from '../helpers.js';
import { FIXTURE_FOLDER } from '../fixtures/workflow-folder.js';
import { assertTempHome } from '../setup/home-isolation.js';
import { at, backupRootOf, exists, makeHome, onlyRunFolder, put, removeHome, type TestHome } from './install-backup-harness.js';

const NAME = FIXTURE_FOLDER.name;
const KEY_ON = workflowFolderKey({ curation: true, compliance: true });
const KEY_OFF = workflowFolderKey({ curation: true, compliance: false });
const EVIDENCE = 'references/evidence-asks.md';

let home: TestHome;

beforeEach(async () => {
  home = await makeHome();
  assertTempHome(home.home);
  console.log(`workflow-folder-backup test home: ${await fs.realpath(home.home)}`);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await removeHome(home);
});

const folderDir = (): string => at(home, `skills/devflow:${NAME}`);
const noLinks = (): { refusedFolders: string[] } => ({ refusedFolders: [] });
const spinner: Spinner = { start() {}, stop() {}, message() {} };

/** A backup session over the temp home whose shipped set is built from the fixture registry. */
const openSession = (workflowFolders: readonly WorkflowFolder[] = [FIXTURE_FOLDER]) =>
  testBackups(home.home, { claudeDir: home.claudeDir, devflowDir: home.devflowDir, workflowFolders });

/** The files a folder of one key holds, each saying which key it was built for. */
function filesOf(key: (typeof VARIANT_KEYS)[number], folder: WorkflowFolder = FIXTURE_FOLDER): WorkflowFolderFile[] {
  return workflowFolderFiles(folder, key).map(file => ({ file, bytes: Buffer.from(`# ${file}\n\nbuilt for ${key}\n`) }));
}

/** Write the files of a folder into the installed place, with extra files beside them. */
async function seed(files: readonly WorkflowFolderFile[], extra: Readonly<Record<string, string>> = {}): Promise<void> {
  for (const { file, bytes } of files) await put(home, `skills/devflow:${NAME}/${file}`, bytes.toString('utf-8'));
  for (const [rel, text] of Object.entries(extra)) await put(home, `skills/devflow:${NAME}/${rel}`, text);
}

async function bytesBelow(dir: string, rel = ''): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const entry of await fs.readdir(path.join(dir, rel), { withFileTypes: true })) {
    const next = rel === '' ? entry.name : `${rel}/${entry.name}`;
    if (entry.isDirectory()) Object.assign(out, await bytesBelow(dir, next));
    else out[next] = await fs.readFile(path.join(dir, next), 'utf-8');
  }
  return out;
}

const bytesOf = (files: readonly WorkflowFolderFile[]): Record<string, string> =>
  Object.fromEntries(files.map(({ file, bytes }) => [file, bytes.toString('utf-8')]));

const leftovers = async (): Promise<string[]> =>
  (await fs.readdir(home.claudeDir)).filter(entry => entry.startsWith('.devflow-workflow-'));

type Rename = { readonly from: string; readonly to: string };

/** Record every rename in call order. `after` runs when a rename has succeeded. */
function watchRenames(after?: (rename: Rename) => Promise<void>): Rename[] {
  const seen: Rename[] = [];
  const realRename = fs.rename.bind(fs);
  vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
    const rename = { from: String(from), to: String(to) };
    seen.push(rename);
    await realRename(from, to);
    await after?.(rename);
  });
  return seen;
}

/** Make the rename of one file fail with an errno code. Other renames go through. */
function failRenameOf(fileName: string, code: string): void {
  const realRename = fs.rename.bind(fs);
  vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
    if (path.basename(String(from)) === fileName) throw Object.assign(new Error(`${code}: injected`), { code });
    return realRename(from, to);
  });
}

describe('a folder that holds a file devflow did not ship', () => {
  it('moves the file to the backup folder before the swap renames anything, and keeps its bytes', async () => {
    await seed(filesOf(KEY_ON), { 'mine-notes.md': 'my notes\n', 'references/mine-levels.md': 'my levels\n' });
    const backups = await openSession();
    const renames = watchRenames();

    const result = await installWorkflowFolder({ claudeDir: home.claudeDir, name: NAME, files: filesOf(KEY_OFF), links: noLinks(), backups });

    expect(result.outcome).toBe('installed');
    const run = await onlyRunFolder(home);
    const toBackup = renames.filter(rename => rename.to.startsWith(run));
    expect(toBackup.map(rename => path.basename(rename.from)).sort()).toEqual(['mine-levels.md', 'mine-notes.md']);
    const firstSwap = renames.findIndex(rename => rename.from === folderDir());
    expect(firstSwap, 'the swap renamed the folder').toBeGreaterThan(-1);
    for (const move of toBackup) {
      expect(renames.indexOf(move), `${path.basename(move.from)} moved before the swap`).toBeLessThan(firstSwap);
    }
    expect(await fs.readFile(path.join(run, 'skills', `devflow:${NAME}`, 'mine-notes.md'), 'utf-8')).toBe('my notes\n');
    expect(await fs.readFile(path.join(run, 'skills', `devflow:${NAME}`, 'references', 'mine-levels.md'), 'utf-8')).toBe('my levels\n');
    expect(await bytesBelow(folderDir())).toEqual(bytesOf(filesOf(KEY_OFF)));
    expect(await leftovers()).toEqual([]);
  });

  it('names the original and the backup path of the moved file', async () => {
    await seed(filesOf(KEY_ON), { 'mine-notes.md': 'my notes\n' });
    const backups = await openSession();

    await installWorkflowFolder({ claudeDir: home.claudeDir, name: NAME, files: filesOf(KEY_ON), links: noLinks(), backups });

    const run = await onlyRunFolder(home);
    const message = formatBackupSummary(backups.snapshot()).map(line => line.message).join('\n');
    expect(message).toContain(`${path.join(folderDir(), 'mine-notes.md')} -> ${path.join(run, 'skills', `devflow:${NAME}`, 'mine-notes.md')}`);
  });

  it('keeps the file when the rest of the folder is already current', async () => {
    await seed(filesOf(KEY_ON), { 'mine-notes.md': 'my notes\n' });
    const backups = await openSession();

    const result = await installWorkflowFolder({ claudeDir: home.claudeDir, name: NAME, files: filesOf(KEY_ON), links: noLinks(), backups });

    expect(result.outcome).toBe('unchanged');
    expect(await exists(path.join(folderDir(), 'mine-notes.md'))).toBe(false);
    const run = await onlyRunFolder(home);
    expect(await fs.readFile(path.join(run, 'skills', `devflow:${NAME}`, 'mine-notes.md'), 'utf-8')).toBe('my notes\n');
    expect(await bytesBelow(folderDir())).toEqual(bytesOf(filesOf(KEY_ON)));
  });

  it('removes a file that only another key ships, and moves nothing', async () => {
    await seed(filesOf(KEY_ON));
    expect(await exists(path.join(folderDir(), EVIDENCE)), 'precondition: the on key ships the evidence file').toBe(true);
    const backups = await openSession();

    const result = await installWorkflowFolder({ claudeDir: home.claudeDir, name: NAME, files: filesOf(KEY_OFF), links: noLinks(), backups });

    expect(result.outcome).toBe('installed');
    expect(await exists(path.join(folderDir(), EVIDENCE))).toBe(false);
    expect(backups.snapshot().moved).toEqual([]);
    expect(backupRootOf(home)).toBeNull();
  });

  it('makes no backup folder for a first install', async () => {
    const backups = await openSession();
    const renames = watchRenames();

    const result = await installWorkflowFolder({ claudeDir: home.claudeDir, name: NAME, files: filesOf(KEY_ON), links: noLinks(), backups });

    expect(result.outcome).toBe('installed');
    expect(backupRootOf(home)).toBeNull();
    expect(renames.every(rename => rename.from !== folderDir()), 'there was no folder to rename away').toBe(true);
  });
});

describe('a move that fails', () => {
  it('gives the outcome failed, keeps the folder as it is and swaps nothing', async () => {
    await seed(filesOf(KEY_ON), { 'mine-notes.md': 'my notes\n' });
    const before = await bytesBelow(folderDir());
    failRenameOf('mine-notes.md', 'EACCES');
    const backups = await openSession();

    const result = await installWorkflowFolder({ claudeDir: home.claudeDir, name: NAME, files: filesOf(KEY_OFF), links: noLinks(), backups });

    expect(result.outcome).toBe('failed');
    expect(result.reason).toContain(path.join(folderDir(), 'mine-notes.md'));
    expect(await bytesBelow(folderDir()), 'the folder, the file and the old key files are untouched').toEqual(before);
    expect(await leftovers(), 'no staging folder was made').toEqual([]);
    expect(backups.snapshot().failures).toEqual([
      { path: path.join(folderDir(), 'mine-notes.md'), action: 'move', reason: 'EACCES' },
    ]);
  });

  it('still moves the other files of the folder', async () => {
    await seed(filesOf(KEY_ON), { 'mine-notes.md': 'my notes\n', 'mine-other.md': 'my other notes\n' });
    failRenameOf('mine-notes.md', 'EACCES');
    const backups = await openSession();

    const result = await installWorkflowFolder({ claudeDir: home.claudeDir, name: NAME, files: filesOf(KEY_OFF), links: noLinks(), backups });

    expect(result.outcome).toBe('failed');
    expect(await exists(path.join(folderDir(), 'mine-notes.md'))).toBe(true);
    expect(await exists(path.join(folderDir(), 'mine-other.md'))).toBe(false);
    expect(backups.snapshot().moved.map(unit => path.basename(unit.original))).toEqual(['mine-other.md']);
  });
});

describe('the displaced folder', () => {
  const arrive = (): ((rename: Rename) => Promise<void>) => async rename => {
    if (rename.from === folderDir()) await fs.writeFile(path.join(rename.to, 'arrived.md'), 'came late\n');
  };

  it('is scanned again, so a file that arrived after the first scan is moved and named, and the folder goes', async () => {
    await seed(filesOf(KEY_ON));
    const backups = await openSession();
    const renames = watchRenames(arrive());

    const result = await installWorkflowFolder({ claudeDir: home.claudeDir, name: NAME, files: filesOf(KEY_OFF), links: noLinks(), backups });

    expect(result.outcome).toBe('installed');
    const aside = renames.find(rename => rename.from === folderDir())?.to;
    if (aside === undefined) throw new Error('the swap did not rename the folder');
    const run = await onlyRunFolder(home);
    expect(await fs.readFile(path.join(run, path.relative(home.claudeDir, aside), 'arrived.md'), 'utf-8')).toBe('came late\n');
    expect(await exists(aside), 'the displaced folder is gone').toBe(false);
    expect(backups.snapshot().moved.map(unit => unit.original)).toEqual([path.join(aside, 'arrived.md')]);
    expect(await bytesBelow(folderDir())).toEqual(bytesOf(filesOf(KEY_OFF)));
  });

  it('stays, with the late file in it, when that file cannot move, and the install still succeeds', async () => {
    await seed(filesOf(KEY_ON));
    const backups = await openSession();
    const realRename = fs.rename.bind(fs);
    const renames: Rename[] = [];
    vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      if (path.basename(String(from)) === 'arrived.md') throw Object.assign(new Error('EACCES: injected'), { code: 'EACCES' });
      renames.push({ from: String(from), to: String(to) });
      await realRename(from, to);
      await arrive()({ from: String(from), to: String(to) });
    });

    const result = await installWorkflowFolder({ claudeDir: home.claudeDir, name: NAME, files: filesOf(KEY_OFF), links: noLinks(), backups });

    expect(result.outcome).toBe('installed');
    const aside = renames.find(rename => rename.from === folderDir())?.to;
    if (aside === undefined) throw new Error('the swap did not rename the folder');
    expect(await fs.readFile(path.join(aside, 'arrived.md'), 'utf-8')).toBe('came late\n');
    expect(await bytesBelow(aside), 'only the late file is left in the displaced folder').toEqual({ 'arrived.md': 'came late\n' });
    const message = formatBackupSummary(backups.snapshot()).map(line => line.message).join('\n');
    expect(message).toContain(path.join(aside, 'arrived.md'));
    expect(message).toContain('EACCES');
  });

  it('is kept whole when the previous folder cannot be put back, and nothing is removed from it', async () => {
    await seed(filesOf(KEY_ON), { 'mine-notes.md': 'my notes\n' });
    const backups = await openSession();
    const realRename = fs.rename.bind(fs);
    vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      if (String(to) === folderDir()) throw Object.assign(new Error('EIO: injected'), { code: 'EIO' });
      return realRename(from, to);
    });
    // The user file moved out before the swap, so the previous folder holds the shipped files only.
    const before = bytesOf(filesOf(KEY_ON));

    const result = await installWorkflowFolder({ claudeDir: home.claudeDir, name: NAME, files: filesOf(KEY_OFF), links: noLinks(), backups });

    expect(result.outcome).toBe('failed');
    const recovery = result.recoveryPath;
    if (recovery === undefined) throw new Error(`the result names no way back: ${result.reason}`);
    expect(await bytesBelow(recovery), 'the previous folder is kept byte for byte').toEqual(before);
  });
});

describe('a workflow that now ships as a folder', () => {
  const PLAN_FOLDER: WorkflowFolder = { ...FIXTURE_FOLDER, name: 'plan' };
  const PLAN_OWNER: PluginDefinition = {
    name: 'devflow-plan-fixture',
    description: 'fixture owner of the plan folder workflow',
    commands: ['/plan'],
    agents: [],
    skills: [],
    requires: [],
    rules: [],
  };

  /** The build tree of every key for the plan folder, in a package root of its own. */
  async function writePackage(): Promise<string> {
    const pkg = path.join(home.home, 'pkg');
    for (const key of VARIANT_KEYS) {
      const bodies = workflowFolderFiles(PLAN_FOLDER, key).map(file => ({ file, body: `# ${file}\n\nbuilt for ${key}\n` }));
      const id = workflowBuildId(bodies);
      for (const { file, body } of bodies) {
        const stamped = file.startsWith('references/') ? { ok: true as const, value: body } : stampBuildId(body, id);
        if (!stamped.ok) throw new Error(`fixture file ${file} could not be stamped`);
        const target = path.join(pkg, ...workflowFolderRelPath(key, PLAN_FOLDER.name, file).split('/'));
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, stamped.value, 'utf-8');
      }
    }
    return pkg;
  }

  it.each([['full', false], ['partial', true]] as const)(
    'has its old command file removed and not moved on a %s install',
    async (_shape, isPartialInstall) => {
      const pkg = await writePackage();
      const oldCommand = await put(home, 'commands/devflow/plan.md', '# the plan command of an earlier release\n');
      const backups = await openSession([PLAN_FOLDER]);

      const report = await installViaFileCopy({
        curation: true,
        compliance: true,
        plugins: [PLAN_OWNER],
        effectivePlugins: [PLAN_OWNER],
        claudeDir: home.claudeDir,
        devflowDir: home.devflowDir,
        skillsMap: new Map(),
        agentsMap: new Map(),
        isPartialInstall,
        spinner,
        warn: () => undefined,
        workflowFolders: [PLAN_FOLDER],
        workflowFoldersRoot: pkg,
        backups,
      });

      expect(await exists(oldCommand), 'the old command file is gone').toBe(false);
      expect(report.backups.moved, 'and was not moved').toEqual([]);
      expect(backupRootOf(home), 'so no backup folder was made').toBeNull();
      expect(await exists(at(home, 'skills/devflow:plan/SKILL.md')), 'the workflow stands as a folder').toBe(true);
    },
  );
});
