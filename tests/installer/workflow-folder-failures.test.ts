/**
 * The late folder step of the install: a partial install that retires an agent file widens to the
 * commands of every installed plugin, and with them to the workflow skill folders of those plugins.
 * The pre-clean has run by then, so a folder that cannot be read is a warning and never a stop, and
 * each folder is read, installed and reported on its own: one broken folder never hides a healthy one.
 *
 * The REAL registry of folders is empty, so every test installs copies of the five-host FIXTURE folder
 * (tests/fixtures/workflow-folder.ts) under other names. Their compiled trees are written here into a
 * throwaway package root that only the folder arm reads. Every test installs into temp Claude and
 * devflow directories, and nothing reads or writes the real HOME.
 */
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { VARIANT_KEYS } from '../../src/core/curation-variants.js';
import {
  stampBuildId,
  workflowBuildId,
  workflowFolderFiles,
  workflowFolderKey,
  workflowFolderRelPath,
  workflowFoldersRootRelPath,
  type WorkflowFolder,
} from '../../src/core/mds-variants.js';
import type { PluginDefinition } from '../../src/core/plugins.js';
import { workflowFoldersPosting, type ConvergeWorkflowFoldersResult } from '../../src/targets/claude-code/curation-install.js';
import { installViaFileCopy, type InstallReport, type Spinner } from '../../src/targets/claude-code/installer.js';
import { assertTempHome } from '../setup/home-isolation.js';
import { FIXTURE_FOLDER } from '../fixtures/workflow-folder.js';

const SWITCHES = { curation: true, compliance: true } as const;
const KEY = workflowFolderKey(SWITCHES);

/** Copies of the fixture folder under other names, in registry order. */
const ALPHA: WorkflowFolder = { ...FIXTURE_FOLDER, name: 'alpha' };
const BETA: WorkflowFolder = { ...FIXTURE_FOLDER, name: 'beta' };
const GAMMA: WorkflowFolder = { ...FIXTURE_FOLDER, name: 'gamma' };

const ownerOf = (folder: WorkflowFolder): PluginDefinition => ({
  name: `devflow-${folder.name}`,
  description: `fixture owner of the ${folder.name} folder workflow`,
  commands: [`/${folder.name}`],
  agents: [],
  skills: [],
  requires: [],
  rules: [],
});

/** The plugin this run names. It owns no folder, so the early read before the pre-clean reads nothing. */
const NAMED: PluginDefinition = {
  name: 'devflow-named',
  description: 'fixture plugin that owns no folder',
  commands: [],
  agents: [],
  skills: [],
  requires: [],
  rules: [],
};

let tmp: string;
let claudeDir: string;
let devflowDir: string;
let pkg: string;
let warnings: string[];

const spinner: Spinner = { start() {}, stop() {}, message() {} };
const warn = (msg: string): void => { warnings.push(msg); };
const folderDir = (folder: WorkflowFolder): string => path.join(claudeDir, 'skills', `devflow:${folder.name}`);
const builtDir = (folder: WorkflowFolder): string =>
  path.join(pkg, ...workflowFoldersRootRelPath(KEY).split('/'), folder.name);
const exists = (file: string): Promise<boolean> => fs.lstat(file).then(() => true, () => false);

/** The build tree of every key for one fixture folder, as the build would have written it. */
async function writeBuiltTree(folder: WorkflowFolder): Promise<void> {
  for (const key of VARIANT_KEYS) {
    const bodies = workflowFolderFiles(folder, key).map(file => ({ file, body: `# ${file}\n\nbuilt for ${key}\n` }));
    const id = workflowBuildId(bodies);
    for (const { file, body } of bodies) {
      const stamped = file.startsWith('references/') ? { ok: true as const, value: body } : stampBuildId(body, id);
      if (!stamped.ok) throw new Error(`fixture file ${file} could not be stamped`);
      const target = path.join(pkg, ...workflowFolderRelPath(key, folder.name, file).split('/'));
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, stamped.value, 'utf-8');
    }
  }
}

/**
 * A partial install that names `NAMED` only and finds a retired agent file, so it widens to the
 * commands, and with them the folders, of every plugin the install record lists.
 */
async function widenedInstall(registry: readonly WorkflowFolder[]): Promise<InstallReport> {
  const agents = path.join(claudeDir, 'agents', 'devflow');
  await fs.mkdir(agents, { recursive: true });
  await fs.writeFile(path.join(agents, 'retired-agent.md'), '# an agent no plugin ships any more\n', 'utf-8');
  const report = await installViaFileCopy({
    ...SWITCHES,
    plugins: [NAMED],
    effectivePlugins: [NAMED, ...registry.map(ownerOf)],
    claudeDir,
    devflowDir,
    skillsMap: new Map(),
    agentsMap: new Map(),
    isPartialInstall: true,
    spinner,
    warn,
    workflowFolders: registry,
    workflowFoldersRoot: pkg,
  });
  expect(report.sweptOrphans, 'precondition: the retired agent was swept, so the run widened').toContainEqual({
    kind: 'agent',
    name: 'retired-agent',
  });
  return report;
}

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-workflow-folder-failures-'));
  expect(() => assertTempHome(tmp)).not.toThrow();
  claudeDir = path.join(tmp, 'claude');
  devflowDir = path.join(tmp, 'devflow');
  pkg = path.join(tmp, 'pkg');
  warnings = [];
  await fs.mkdir(claudeDir, { recursive: true });
  await fs.mkdir(devflowDir, { recursive: true });
  for (const folder of [ALPHA, BETA, GAMMA]) await writeBuiltTree(folder);
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('the late folder step isolates each folder', () => {
  it('a widened folder that cannot be read warns, and the healthy folder after it still installs', async () => {
    await fs.rm(builtDir(ALPHA), { recursive: true });
    expect(await exists(builtDir(BETA)), 'precondition: the second folder is built').toBe(true);

    await widenedInstall([ALPHA, BETA]);

    expect(await exists(folderDir(BETA)), 'the healthy folder is installed').toBe(true);
    expect(await fs.readFile(path.join(folderDir(BETA), 'SKILL.md'), 'utf-8')).toContain(`built for ${KEY}`);
    expect(await exists(folderDir(ALPHA)), 'the broken folder is not installed').toBe(false);
    expect(warnings.filter(w => w.includes("workflow folder 'alpha'"))).toHaveLength(1);
    expect(warnings.filter(w => w.includes("workflow folder 'beta'"))).toEqual([]);
  });

  it('each widened folder that cannot be read has its own warning, and the healthy folder between them installs', async () => {
    await fs.rm(builtDir(ALPHA), { recursive: true });
    await fs.writeFile(path.join(builtDir(GAMMA), 'SKILL.md'), '# SKILL.md [build 000000000000]\n\nbuilt for on\n', 'utf-8');

    await widenedInstall([ALPHA, BETA, GAMMA]);

    expect(await exists(folderDir(BETA)), 'the healthy folder is installed').toBe(true);
    expect(await exists(folderDir(ALPHA))).toBe(false);
    expect(await exists(folderDir(GAMMA))).toBe(false);
    expect(warnings.filter(w => w.includes("workflow folder 'alpha'"))).toHaveLength(1);
    expect(warnings.filter(w => w.includes("workflow folder 'gamma'"))).toHaveLength(1);
    expect(warnings.filter(w => w.includes("workflow folder 'beta'"))).toEqual([]);
  });

  it('a widened run whose folders are all healthy installs every one and warns about none', async () => {
    await widenedInstall([ALPHA, BETA]);

    expect(await exists(folderDir(ALPHA))).toBe(true);
    expect(await exists(folderDir(BETA))).toBe(true);
    expect(warnings.filter(w => w.startsWith('workflow skill folder'))).toEqual([]);
  });
});

describe('the posting answer of the workflow-folder converge', () => {
  /** What the converge falls back to when it throws: not converged, and it names nothing. */
  const THROW_FALLBACK: ConvergeWorkflowFoldersResult = {
    converged: false,
    installed: [],
    unchanged: [],
    failures: ['the workflow folder converge failed'],
    stalled: [],
  };
  const FINISHED: ConvergeWorkflowFoldersResult = { ...THROW_FALLBACK, converged: true, failures: [] };
  const STALLED_DIR = `/claude/skills/devflow:${ALPHA.name}`;
  const STALLED: ConvergeWorkflowFoldersResult = {
    ...THROW_FALLBACK,
    failures: ['could not swap the folder'],
    stalled: [STALLED_DIR],
  };

  it('a converge that threw is unknown with compliance off, and the reason carries the failure', () => {
    const posting = workflowFoldersPosting(THROW_FALLBACK, false);
    expect(posting.kind).toBe('unknown');
    if (posting.kind === 'unknown') expect(posting.reason).toContain('the workflow folder converge failed');
  });

  it('a converge that threw is clear with compliance on', () => {
    expect(workflowFoldersPosting(THROW_FALLBACK, true)).toEqual({ kind: 'clear' });
  });

  it('with compliance off, stalled folders are named as left', () => {
    expect(workflowFoldersPosting(STALLED, false)).toEqual({ kind: 'left', files: [STALLED_DIR] });
  });

  it('a converge that finished is clear with compliance off, and with it on', () => {
    expect(workflowFoldersPosting(FINISHED, false)).toEqual({ kind: 'clear' });
    expect(workflowFoldersPosting(FINISHED, true)).toEqual({ kind: 'clear' });
  });
});
