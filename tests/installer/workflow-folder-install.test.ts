/**
 * The install layer of a workflow skill folder (#675 PR A, PA2): the folder arm of the install,
 * the converge on both switches, the shadow refusal, the sweeps and the uninstall.
 *
 * The REAL registry of folders is empty in PR A, so every test installs the five-host FIXTURE
 * folder (tests/fixtures/workflow-folder.ts, name `flow`). Its compiled trees are written here, one
 * per variant key, into a throwaway package root that only the folder arm reads; everything else
 * the install reads is the real built package. Each file of a key's tree says which key it came
 * from, so a folder installed from the wrong key shows in the bytes.
 *
 * Every test installs into temp Claude and devflow directories, and nothing reads or writes the
 * real HOME. The converge tests compare the converged folder with a FRESH install of the same
 * state: a converge is right only when it ends where an install would have started.
 *
 * TP-20, TP-21 (install and uninstall halves), TP-22, TP-23, TP-25.
 */
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { computeAssetsToRemove, enumerateDryRunExtras, formatDryRunPlan, removeAllDevFlow, removeSelectedPlugins, sweepDevflowNamespaces } from '../../src/cli/commands/uninstall.js';
import { workflowFolderShadowRefusal } from '../../src/cli/commands/skills.js';
import { VARIANT_KEYS } from '../../src/core/curation-variants.js';
import { stampBuildId, workflowBuildId, workflowFolderFiles, workflowFolderKey, workflowFolderRelPath, workflowFoldersRootRelPath, type WorkflowFolder } from '../../src/core/mds-variants.js';
import { workflowFolderNames, type PluginDefinition } from '../../src/core/plugins.js';
import { installViaFileCopy, type InstallReport, type Spinner } from '../../src/targets/claude-code/installer.js';
import { convergeVariantAxes, type VariantMachineState } from '../../src/targets/claude-code/curation-install.js';
import { installWorkflowFolder, readWorkflowFolder } from '../../src/targets/claude-code/workflow-folder-install.js';
import { assertTempHome } from '../setup/home-isolation.js';
import { FIXTURE_FOLDER } from '../fixtures/workflow-folder.js';

const NAME = FIXTURE_FOLDER.name;
const FOLDER_SET = workflowFolderNames([FIXTURE_FOLDER]);
const EVIDENCE = 'references/evidence-asks.md';

/** A plugin that owns the fixture workflow as a command, and one that owns nothing of it. */
const OWNER: PluginDefinition = {
  name: 'devflow-flow',
  description: 'fixture owner of the folder workflow',
  commands: ['/flow'],
  agents: [],
  skills: [],
  requires: [],
  rules: [],
};
const OTHER: PluginDefinition = { ...OWNER, name: 'devflow-other', commands: [] };

/**
 * A folder workflow whose name is ALSO a registered command (`plan`). A stale `commands/devflow/plan.md`
 * is then an orphan only when the sweep knows `plan` as a folder workflow: the fixture name `flow` is no
 * registered command, so a file of that name is an orphan with or without the set.
 */
const PLAN_FOLDER: WorkflowFolder = { ...FIXTURE_FOLDER, name: 'plan' };
const PLAN_SET = workflowFolderNames([PLAN_FOLDER]);
const PLAN_OWNER: PluginDefinition = { ...OWNER, name: 'devflow-plan-fixture', commands: ['/plan'] };

let tmp: string;
let claudeDir: string;
let devflowDir: string;
let pkg: string;
let warnings: string[];
let messages: string[];

const spinner: Spinner = { start() {}, stop() {}, message(message) { messages.push(message ?? ''); } };
const warn = (msg: string): void => { warnings.push(msg); };
const folderDir = (dir: string = claudeDir, name: string = NAME): string => path.join(dir, 'skills', `devflow:${name}`);
const exists = (file: string): Promise<boolean> => fs.lstat(file).then(() => true, () => false);

type Switches = { curation: boolean; compliance: boolean };
const ON: Switches = { curation: true, compliance: true };
const COMPLIANCE_OFF: Switches = { curation: true, compliance: false };
const CURATION_OFF: Switches = { curation: false, compliance: true };
const BOTH_OFF: Switches = { curation: false, compliance: false };

async function walk(dir: string, prefix = ''): Promise<string[]> {
  const out: string[] = [];
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) out.push(`${rel}/`, ...(await walk(path.join(dir, entry.name), rel)));
    else out.push(rel);
  }
  return out.sort();
}

/** Every file below `dir` as relative path -> text. */
async function fileMap(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const rel of await walk(dir)) {
    if (!rel.endsWith('/')) out[rel] = await fs.readFile(path.join(dir, rel), 'utf-8');
  }
  return out;
}

/** The build tree of one key, as the build would have written it for a folder (the fixture by default): the id is the real one. */
async function writeBuiltTrees(root: string, folder: WorkflowFolder = FIXTURE_FOLDER): Promise<void> {
  for (const key of VARIANT_KEYS) {
    const bodies = workflowFolderFiles(folder, key).map(file => ({ file, body: `# ${file}\n\nbuilt for ${key}\n` }));
    const id = workflowBuildId(bodies);
    for (const { file, body } of bodies) {
      const stamped = file.startsWith('references/') ? { ok: true as const, value: body } : stampBuildId(body, id);
      if (!stamped.ok) throw new Error(`fixture file ${file} could not be stamped`);
      const target = path.join(root, ...workflowFolderRelPath(key, folder.name, file).split('/'));
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, stamped.value, 'utf-8');
    }
  }
}

/** The files the build wrote for one pair of switches. */
function builtFolder(switches: Switches): Promise<Record<string, string>> {
  const key = workflowFolderKey(switches);
  return fileMap(path.join(pkg, ...workflowFoldersRootRelPath(key).split('/'), NAME));
}

function install(
  switches: Switches,
  opts: {
    plugins?: PluginDefinition[];
    effectivePlugins?: PluginDefinition[];
    isPartialInstall?: boolean;
    claude?: string;
    home?: string;
    workflowFolders?: readonly WorkflowFolder[];
  } = {},
): Promise<InstallReport> {
  const plugins = opts.plugins ?? [OWNER];
  return installViaFileCopy({
    ...switches,
    plugins,
    effectivePlugins: opts.effectivePlugins ?? plugins,
    claudeDir: opts.claude ?? claudeDir,
    devflowDir: opts.home ?? devflowDir,
    skillsMap: new Map(),
    agentsMap: new Map(),
    isPartialInstall: opts.isPartialInstall ?? false,
    spinner,
    warn,
    workflowFolders: opts.workflowFolders ?? [FIXTURE_FOLDER],
    workflowFoldersRoot: pkg,
  });
}

function machine(switches: Switches): VariantMachineState {
  return { features: { curation: switches.curation, compliance: { enabled: switches.compliance, frameworks: [] }, rules: false } };
}

function converge(switches: Switches, plugins: PluginDefinition[] = [OWNER]) {
  return convergeVariantAxes({
    claudeDir,
    devflowDir,
    manifest: machine(switches),
    plugins,
    warn,
    workflowFolders: [FIXTURE_FOLDER],
    workflowFoldersRoot: pkg,
  });
}

/** A fresh install of one state into its own directories: what a converge must end at. */
async function freshFolder(switches: Switches): Promise<Record<string, string>> {
  const dir = path.join(tmp, `fresh-${switches.curation}-${switches.compliance}`);
  await fs.mkdir(path.join(dir, 'home'), { recursive: true });
  await install(switches, { claude: path.join(dir, 'claude'), home: path.join(dir, 'home') });
  return fileMap(folderDir(path.join(dir, 'claude')));
}

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-workflow-folder-'));
  expect(() => assertTempHome(tmp)).not.toThrow();
  claudeDir = path.join(tmp, 'claude');
  devflowDir = path.join(tmp, 'devflow');
  pkg = path.join(tmp, 'pkg');
  warnings = [];
  messages = [];
  await fs.mkdir(claudeDir, { recursive: true });
  await fs.mkdir(devflowDir, { recursive: true });
  await writeBuiltTrees(pkg);
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('the install takes the folder of the exact key (TP-20)', () => {
  it.each([
    ['on', ON],
    ['curation off', CURATION_OFF],
    ['compliance off', COMPLIANCE_OFF],
    ['both off', BOTH_OFF],
  ] as const)('%s: the installed folder is the files of that key and no others', async (_label, switches) => {
    await install(switches);
    const built = await builtFolder(switches);
    expect(Object.keys(built).length, 'precondition: the key tree holds files').toBeGreaterThan(0);
    expect(await fileMap(folderDir())).toEqual(built);
    for (const text of Object.values(await fileMap(folderDir()))) {
      expect(text).toContain(`built for ${workflowFolderKey(switches)}`);
    }
  });

  it('a compliance-off folder leaves out the file its file list omits; a compliance-on folder holds it', async () => {
    await install(COMPLIANCE_OFF);
    expect(await exists(path.join(folderDir(), EVIDENCE))).toBe(false);
    await install(ON);
    expect(await exists(path.join(folderDir(), EVIDENCE))).toBe(true);
  });

  it('a key whose tree lacks the folder refuses the install before the pre-clean and never falls through to another key', async () => {
    const commands = path.join(claudeDir, 'commands', 'devflow');
    await fs.mkdir(commands, { recursive: true });
    await fs.writeFile(path.join(commands, 'canary.md'), 'installed command\n', 'utf-8');
    const key = workflowFolderKey(BOTH_OFF);
    await fs.rm(path.join(pkg, ...workflowFoldersRootRelPath(key).split('/'), NAME), { recursive: true });
    expect(await exists(path.join(pkg, ...workflowFoldersRootRelPath('on').split('/'), NAME)), 'precondition: the on tree is there to fall through to').toBe(true);

    await expect(install(BOTH_OFF)).rejects.toThrow(new RegExp(`variant key '${key}'`));
    expect(await exists(folderDir())).toBe(false);
    expect(await fs.readFile(path.join(commands, 'canary.md'), 'utf-8'), 'the installed tree was left as it was').toBe('installed command\n');
  });

  it('a folder whose files carry two build ids refuses the read', async () => {
    const key = workflowFolderKey(ON);
    const core = path.join(pkg, ...workflowFoldersRootRelPath(key).split('/'), NAME, 'SKILL.md');
    await fs.writeFile(core, '# SKILL.md [build 000000000000]\n\nbuilt for on\n', 'utf-8');
    const read = await readWorkflowFolder(FIXTURE_FOLDER, ON, pkg);
    expect(read.ok).toBe(false);
    await expect(install(ON)).rejects.toThrow(/build id/i);
  });

  it('a second install of the same state writes nothing and leaves no staging folder', async () => {
    await install(ON);
    const before = await fs.stat(folderDir());
    const bytes = await fileMap(folderDir());

    await install(ON);
    await install(ON, { isPartialInstall: true });

    const after = await fs.stat(folderDir());
    expect(after.ino, 'the folder was not swapped').toBe(before.ino);
    expect(after.mtimeMs).toBe(before.mtimeMs);
    expect(await fileMap(folderDir())).toEqual(bytes);
    expect((await fs.readdir(claudeDir)).filter(entry => entry.startsWith('.devflow-workflow-'))).toEqual([]);
  });

  it('nested orphan files and folders inside the installed folder are pruned', async () => {
    await install(ON);
    const wanted = await fileMap(folderDir());
    await fs.writeFile(path.join(folderDir(), 'stale.md'), 'stale\n', 'utf-8');
    await fs.writeFile(path.join(folderDir(), 'references', 'stale.md'), 'stale\n', 'utf-8');
    await fs.mkdir(path.join(folderDir(), 'old', 'deeper'), { recursive: true });
    await fs.writeFile(path.join(folderDir(), 'old', 'deeper', 'stale.md'), 'stale\n', 'utf-8');

    await install(ON, { isPartialInstall: true });
    expect(await fileMap(folderDir())).toEqual(wanted);
    expect(await exists(path.join(folderDir(), 'old'))).toBe(false);

    await fs.mkdir(path.join(folderDir(), 'empty-orphan'));
    await install(ON);
    expect(await exists(path.join(folderDir(), 'empty-orphan'))).toBe(false);
  });

  it('a drifted file is restored from the build', async () => {
    await install(ON);
    const wanted = await fileMap(folderDir());
    await fs.writeFile(path.join(folderDir(), 'SKILL.md'), 'edited by hand\n', 'utf-8');
    await install(ON, { isPartialInstall: true });
    expect(await fileMap(folderDir())).toEqual(wanted);
  });

  it('the command copy skips the folder workflow, and the folder is installed before the scripts step', async () => {
    await install(ON);
    expect(await exists(path.join(claudeDir, 'commands', 'devflow', 'flow.md'))).toBe(false);
    const folderStep = messages.indexOf('Installing workflow skills...');
    const scriptsStep = messages.indexOf('Installing scripts...');
    expect(folderStep, 'the folder step ran').toBeGreaterThanOrEqual(0);
    expect(scriptsStep, 'the scripts step ran').toBeGreaterThanOrEqual(0);
    expect(folderStep).toBeLessThan(scriptsStep);
  });

  it('with no folder in the registry the workflow is an ordinary command and the install has no folder step', async () => {
    const base = {
      ...ON,
      claudeDir,
      devflowDir,
      skillsMap: new Map<string, string>(),
      agentsMap: new Map<string, string>(),
      isPartialInstall: false,
      spinner,
      warn,
      workflowFolders: [],
    };
    // `/flow` has no command source, which only an install that still counts it as a command asks for.
    await expect(installViaFileCopy({ ...base, plugins: [OWNER] })).rejects.toThrow(/Command source not found for declared command "flow"/);

    await installViaFileCopy({ ...base, plugins: [OTHER] });
    expect(messages).not.toContain('Installing workflow skills...');
    expect(await exists(folderDir())).toBe(false);
  });
});

describe('the sweeps know the folder (TP-21 install half, TP-25)', () => {
  it('a stale command file of a folder workflow is swept, and the folder is kept', async () => {
    await writeBuiltTrees(pkg, PLAN_FOLDER);
    const stale = path.join(claudeDir, 'commands', 'devflow', 'plan.md');
    await fs.mkdir(path.dirname(stale), { recursive: true });
    await fs.writeFile(stale, 'the old command\n', 'utf-8');

    const report = await install(ON, { plugins: [PLAN_OWNER], workflowFolders: [PLAN_FOLDER], isPartialInstall: true });
    expect(await exists(stale)).toBe(false);
    expect(report.sweptOrphans).toContainEqual({ kind: 'command', name: 'plan' });
    expect(await exists(folderDir(claudeDir, 'plan'))).toBe(true);
  });

  it('the same stale file is kept when the registry holds no folder, so the sweep above depends on the folder set', async () => {
    const stale = path.join(claudeDir, 'commands', 'devflow', 'plan.md');
    await fs.mkdir(path.dirname(stale), { recursive: true });
    await fs.writeFile(stale, 'the old command\n', 'utf-8');

    const report = await install(ON, { plugins: [OTHER], workflowFolders: [], isPartialInstall: true });
    expect(await fs.readFile(stale, 'utf-8')).toBe('the old command\n');
    expect(report.sweptOrphans).not.toContainEqual({ kind: 'command', name: 'plan' });
  });

  it('a partial install with the owning plugin installs the folder', async () => {
    const report = await install(ON, { plugins: [OWNER], effectivePlugins: [OWNER, OTHER], isPartialInstall: true });
    expect(await fileMap(folderDir())).toEqual(await builtFolder(ON));
    expect(report.sweptOrphans.filter(orphan => orphan.kind === 'skill')).toEqual([]);
  });

  it('a partial install without the owning plugin keeps the installed folder and does not sweep it', async () => {
    await install(ON);
    const before = await fileMap(folderDir());
    const stat = await fs.stat(folderDir());

    const report = await install(ON, { plugins: [OTHER], effectivePlugins: [OWNER, OTHER], isPartialInstall: true });
    expect(await fileMap(folderDir())).toEqual(before);
    expect((await fs.stat(folderDir())).ino).toBe(stat.ino);
    expect(report.sweptOrphans.filter(orphan => orphan.name === NAME && orphan.kind === 'skill')).toEqual([]);
    expect(report.removedSkills).not.toContain(NAME);
  });

  it('a full install without the owning plugin removes the folder, and one with it keeps the folder', async () => {
    await install(ON);
    const withOwner = await install(ON);
    expect(withOwner.removedSkills).not.toContain(NAME);
    expect(await exists(folderDir())).toBe(true);

    const without = await install(ON, { plugins: [OTHER] });
    expect(without.removedSkills).toContain(NAME);
    expect(await exists(folderDir())).toBe(false);
  });
});

describe('a shadow of a folder workflow (TP-22)', () => {
  it('the shadow command refuses a folder workflow with a named reason, and no other name', () => {
    const reason = workflowFolderShadowRefusal(NAME, FOLDER_SET);
    expect(reason).toContain(NAME);
    expect(reason).toMatch(/skill folder/);
    expect(reason).toMatch(/Nothing was shadowed/);
    expect(workflowFolderShadowRefusal('git', FOLDER_SET)).toBeNull();
    expect(workflowFolderShadowRefusal(NAME), 'the real set is empty').toBeNull();
  });

  it('an existing shadow is ignored at install with a warning, kept on disk, and not reported dormant', async () => {
    const shadow = path.join(devflowDir, 'skills', NAME);
    await fs.mkdir(shadow, { recursive: true });
    await fs.writeFile(path.join(shadow, 'SKILL.md'), '# my own flow\n', 'utf-8');

    const report = await install(ON);
    expect(await fileMap(folderDir())).toEqual(await builtFolder(ON));
    expect(await fs.readFile(path.join(shadow, 'SKILL.md'), 'utf-8')).toBe('# my own flow\n');
    expect(warnings.some(line => line.includes(`"${NAME}"`) && /ignored/.test(line))).toBe(true);
    expect(report.dormantShadows).not.toContain(NAME);
    expect(report.shadowedSkills).not.toContain(NAME);
  });
});

describe('the converge moves the folder with both switches (TP-23)', () => {
  it('a compliance toggle ends where a fresh install of that state starts, and a repeat moves nothing', async () => {
    const freshOn = await freshFolder(ON);
    const freshOff = await freshFolder(COMPLIANCE_OFF);
    expect(Object.keys(freshOn).length, 'precondition: the two states differ').toBeGreaterThan(Object.keys(freshOff).length);

    await install(ON);
    expect(await fileMap(folderDir())).toEqual(freshOn);

    const disabled = await converge(COMPLIANCE_OFF);
    expect(disabled.workflowFolders.installed).toEqual([NAME]);
    expect(disabled.workflowFolders.converged, warnings.join('\n')).toBe(true);
    expect(disabled.posting).toEqual({ kind: 'clear' });
    expect(await fileMap(folderDir())).toEqual(freshOff);
    expect(await exists(path.join(folderDir(), EVIDENCE)), 'no file the compliance-off list omits is left').toBe(false);

    const again = await converge(COMPLIANCE_OFF);
    expect(again.workflowFolders.installed).toEqual([]);
    expect(again.workflowFolders.unchanged).toEqual([NAME]);

    const enabled = await converge(ON);
    expect(enabled.workflowFolders.installed).toEqual([NAME]);
    expect(await fileMap(folderDir())).toEqual(freshOn);
  });

  it('a curation toggle on a compliance-off machine converges the folder of the both-off key, and back', async () => {
    const freshBothOff = await freshFolder(BOTH_OFF);
    const freshComplianceOff = await freshFolder(COMPLIANCE_OFF);
    expect(freshBothOff, 'precondition: the keys differ').not.toEqual(freshComplianceOff);

    await install(COMPLIANCE_OFF);
    const off = await converge(BOTH_OFF);
    expect(off.workflowFolders.installed).toEqual([NAME]);
    expect(await fileMap(folderDir())).toEqual(freshBothOff);

    const on = await converge(COMPLIANCE_OFF);
    expect(on.workflowFolders.installed).toEqual([NAME]);
    expect(await fileMap(folderDir())).toEqual(freshComplianceOff);
  });

  it('a converge installs a missing folder, and ignores a workflow whose plugin is not selected', async () => {
    const owned = await converge(ON);
    expect(owned.workflowFolders.installed).toEqual([NAME]);
    expect(await fileMap(folderDir())).toEqual(await builtFolder(ON));

    await fs.rm(folderDir(), { recursive: true });
    const notSelected = await converge(ON, [OTHER]);
    expect(notSelected.workflowFolders).toEqual({ converged: true, installed: [], unchanged: [], failures: [], stalled: [] });
    expect(await exists(folderDir())).toBe(false);
  });

  it('a switch to compliance off fails closed when the key tree is missing: the folder is named and nothing falls through', async () => {
    await install(ON);
    const before = await fileMap(folderDir());
    await fs.rm(path.join(pkg, ...workflowFoldersRootRelPath(workflowFolderKey(COMPLIANCE_OFF)).split('/'), NAME), { recursive: true });

    const result = await converge(COMPLIANCE_OFF);
    expect(result.converged).toBe(false);
    expect(result.workflowFolders.stalled).toEqual([folderDir()]);
    expect(result.posting).toEqual({ kind: 'left', files: [folderDir()] });
    expect(await fileMap(folderDir()), 'the previous folder is as it was, not the on tree written again').toEqual(before);
    expect(warnings.some(line => line.includes(`variant key '${workflowFolderKey(COMPLIANCE_OFF)}'`))).toBe(true);
  });
});

describe('a link at the folder is never followed', () => {
  async function linkFolderTo(target: string): Promise<void> {
    await fs.mkdir(target, { recursive: true });
    await fs.writeFile(path.join(target, 'canary.md'), 'not devflow\n', 'utf-8');
    await fs.mkdir(path.dirname(folderDir()), { recursive: true });
    await fs.symlink(target, folderDir());
  }

  it('a partial install and a converge refuse a link, and what it points to is untouched', async () => {
    const elsewhere = path.join(tmp, 'elsewhere');
    await linkFolderTo(elsewhere);

    const report = await install(ON, { isPartialInstall: true });
    expect(report.refusedFolders).toContain(folderDir());
    expect((await fs.lstat(folderDir())).isSymbolicLink()).toBe(true);
    expect(await walk(elsewhere)).toEqual(['canary.md']);

    const result = await converge(ON);
    expect(result.workflowFolders.stalled).toEqual([folderDir()]);
    expect(result.converged).toBe(false);
    expect(await walk(elsewhere)).toEqual(['canary.md']);
  });

  it('a full install unlinks the link, reports it, and writes a real folder', async () => {
    const elsewhere = path.join(tmp, 'elsewhere');
    await linkFolderTo(elsewhere);

    const report = await install(ON);
    expect(report.replacedLinks).toContain(folderDir());
    expect((await fs.lstat(folderDir())).isDirectory()).toBe(true);
    expect(await fileMap(folderDir())).toEqual(await builtFolder(ON));
    expect(await walk(elsewhere)).toEqual(['canary.md']);
  });

  it('installWorkflowFolder refuses a skills folder that is a link', async () => {
    const elsewhere = path.join(tmp, 'elsewhere-skills');
    await fs.mkdir(elsewhere, { recursive: true });
    await fs.symlink(elsewhere, path.join(claudeDir, 'skills'));
    const read = await readWorkflowFolder(FIXTURE_FOLDER, ON, pkg);
    if (!read.ok) throw new Error(read.reason);
    const links = { refusedFolders: [] as string[] };

    const result = await installWorkflowFolder({ claudeDir, name: NAME, files: read.files, links });
    expect(result.outcome).toBe('refused');
    expect(links.refusedFolders).toEqual([path.join(claudeDir, 'skills')]);
    expect(await walk(elsewhere)).toEqual([]);
  });
});

describe('the uninstall knows the folder (TP-21 uninstall half)', () => {
  it('a full uninstall removes the folder', async () => {
    await install(ON);

    await removeAllDevFlow(claudeDir, path.join(devflowDir, 'scripts'), false, undefined, FOLDER_SET);
    expect(await exists(folderDir())).toBe(false);
  });

  it('the namespace sweep removes a stale command file of a folder workflow only when it knows the folder', async () => {
    // `plan` is a registered command: the file is an orphan only through the folder set.
    const stale = path.join(claudeDir, 'commands', 'devflow', 'plan.md');
    await fs.mkdir(path.dirname(stale), { recursive: true });
    await fs.writeFile(stale, 'the old command\n', 'utf-8');

    const without = await sweepDevflowNamespaces(claudeDir, false, undefined, undefined, new Set());
    expect(without.commands.removed, 'an empty set leaves the registered command alone').not.toContain('plan');
    expect(await exists(stale)).toBe(true);

    const withFolder = await sweepDevflowNamespaces(claudeDir, false, undefined, undefined, PLAN_SET);
    expect(withFolder.commands.removed).toContain('plan');
    expect(await exists(stale)).toBe(false);
  });

  it('the dry run lists the folder', async () => {
    await install(ON);
    const extras = await enumerateDryRunExtras(claudeDir, devflowDir, FOLDER_SET);
    expect(extras).toContain(folderDir());
    expect(await enumerateDryRunExtras(claudeDir, devflowDir, new Set()), 'without the set the folder is not known').not.toContain(folderDir());
  });

  it('a selective uninstall of the owning plugin removes the folder as a skill, never as a command, and plans it', async () => {
    const assets = computeAssetsToRemove([OWNER], [OWNER, OTHER], FOLDER_SET);
    expect(assets.skills).toContain(NAME);
    expect(assets.commands).not.toContain('/flow');
    expect(formatDryRunPlan(assets)).toContain(NAME);

    await install(ON);
    await removeSelectedPlugins(claudeDir, [OWNER], false, [OWNER, OTHER], undefined, undefined, FOLDER_SET);
    expect(await exists(folderDir())).toBe(false);
  });

  it('a selective uninstall of another plugin keeps the folder, and a retained owner keeps it too', async () => {
    await install(ON);
    expect(computeAssetsToRemove([OTHER], [OWNER, OTHER], FOLDER_SET).skills).not.toContain(NAME);
    expect(computeAssetsToRemove([OWNER], [OWNER, { ...OTHER, commands: ['/flow'] }], FOLDER_SET).skills).not.toContain(NAME);

    await removeSelectedPlugins(claudeDir, [OTHER], false, [OWNER, OTHER], undefined, undefined, FOLDER_SET);
    expect(await exists(folderDir())).toBe(true);

    const sweeps = await sweepDevflowNamespaces(claudeDir, false, undefined, undefined, FOLDER_SET);
    expect(sweeps.skills.removed).not.toContain(NAME);
    expect(await exists(folderDir())).toBe(true);
  });
});

describe('the folder install under a failed swap, a hostile name and a stale tree', () => {
  const realRename = fs.rename.bind(fs);

  async function builtFiles(switches: Switches, folder: WorkflowFolder = FIXTURE_FOLDER) {
    const read = await readWorkflowFolder(folder, switches, pkg);
    if (!read.ok) throw new Error(read.reason);
    return read.files;
  }

  /** The staging and backup entries that stand in the Claude directory. */
  async function leftovers(): Promise<string[]> {
    return (await fs.readdir(claudeDir)).filter(entry => entry.startsWith('.devflow-workflow-'));
  }

  /** Make every move onto the installed folder fail, or only the one that comes from the staging folder. */
  function failMovesOntoTheFolder(opts: { includingTheRestore: boolean }): void {
    vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      if (String(to) === folderDir()) {
        if (String(from).endsWith('.old')) {
          if (opts.includingTheRestore) throw new Error('EIO: injected restore failure');
        } else {
          throw new Error('EXDEV: injected move failure');
        }
      }
      return realRename(from, to);
    });
  }

  describe('a swap that fails (S3, T3)', () => {
    it('puts the previous folder back byte for byte, leaves no staging folder, and says nothing is left to recover', async () => {
      await install(ON);
      const before = await fileMap(folderDir());
      const files = await builtFiles(COMPLIANCE_OFF);
      expect(Object.keys(before).length, 'precondition: a previous folder stands').toBeGreaterThan(0);
      failMovesOntoTheFolder({ includingTheRestore: false });

      const result = await installWorkflowFolder({ claudeDir, name: NAME, files, links: { refusedFolders: [] } });

      expect(result.outcome).toBe('failed');
      expect(result.reason).toContain('injected move failure');
      expect(result.recoveryPath).toBeUndefined();
      expect(await fileMap(folderDir())).toEqual(before);
      expect(await leftovers()).toEqual([]);
    });

    it('leaves nothing behind when a first install fails', async () => {
      const files = await builtFiles(ON);
      failMovesOntoTheFolder({ includingTheRestore: false });

      const result = await installWorkflowFolder({ claudeDir, name: NAME, files, links: { refusedFolders: [] } });

      expect(result.outcome).toBe('failed');
      expect(result.recoveryPath).toBeUndefined();
      expect(await exists(folderDir())).toBe(false);
      expect(await leftovers()).toEqual([]);
    });

    it('keeps the previous folder when the restore fails too, and names it with both errors', async () => {
      await install(ON);
      const before = await fileMap(folderDir());
      const files = await builtFiles(COMPLIANCE_OFF);
      failMovesOntoTheFolder({ includingTheRestore: true });

      const result = await installWorkflowFolder({ claudeDir, name: NAME, files, links: { refusedFolders: [] } });

      expect(result.outcome).toBe('failed');
      const recovery = result.recoveryPath;
      if (recovery === undefined) throw new Error(`the result names no way back: ${result.reason}`);
      expect(path.dirname(recovery)).toBe(claudeDir);
      expect(path.basename(recovery)).toMatch(/^\.devflow-workflow-flow-\d+-[A-Za-z0-9]{6}\.old$/);
      expect(await fileMap(recovery), 'the backup is the previous folder, byte for byte').toEqual(before);
      expect(result.reason).toMatch(/^EXDEV: injected move failure/);
      expect(result.reason).toContain('injected restore failure');
      expect(result.reason).toContain(recovery);
      expect(await exists(folderDir()), 'nothing stands at the installed path').toBe(false);
      expect(await leftovers(), 'the staging folder is gone and only the backup is kept').toEqual([path.basename(recovery)]);
    });
  });

  describe('the name of a folder, at both sinks (S2)', () => {
    const BAD_NAMES = ['x/../escape', '..', 'a\\b', 'Bad Name', ''];

    it('readWorkflowFolder reads the folder under its own name, and refuses a name that only resolves to it', async () => {
      expect((await readWorkflowFolder(FIXTURE_FOLDER, ON, pkg)).ok, 'precondition: the folder reads under its name').toBe(true);

      const read = await readWorkflowFolder({ ...FIXTURE_FOLDER, name: `x/../${NAME}` }, ON, pkg);

      expect(read.ok).toBe(false);
      if (!read.ok) expect(read.reason).toContain(`x/../${NAME}`);
    });

    it.each(BAD_NAMES)('readWorkflowFolder refuses the name %j with a reason and does not throw', async name => {
      const read = await readWorkflowFolder({ ...FIXTURE_FOLDER, name }, ON, pkg);
      expect(read.ok).toBe(false);
    });

    it('installWorkflowFolder refuses a name that climbs out of the skills folder, and writes nothing', async () => {
      const files = await builtFiles(ON);
      const links = { refusedFolders: [] as string[] };

      const result = await installWorkflowFolder({ claudeDir, name: 'x/../escape', files, links });

      expect(result.outcome).toBe('failed');
      expect(result.reason).toContain('x/../escape');
      expect(await exists(path.join(claudeDir, 'skills', 'escape'))).toBe(false);
      expect(await fs.readdir(claudeDir), 'nothing was staged or created').toEqual([]);
      expect(links.refusedFolders).toEqual([]);
    });

    it.each(BAD_NAMES)('installWorkflowFolder refuses the name %j with a reason and does not throw', async name => {
      const files = await builtFiles(ON);
      const result = await installWorkflowFolder({ claudeDir, name, files, links: { refusedFolders: [] } });
      expect(result.outcome).toBe('failed');
      expect(result.reason).toBeTruthy();
      expect(await fs.readdir(claudeDir)).toEqual([]);
    });
  });

  describe('the staging folder (S1)', () => {
    it('is not written through a link planted at the name an earlier install used', async () => {
      const elsewhere = path.join(tmp, 'elsewhere-staging');
      await fs.mkdir(elsewhere, { recursive: true });
      const now = 1_800_000_000_000;
      await fs.symlink(elsewhere, path.join(claudeDir, `.devflow-workflow-${NAME}-${process.pid}-${now.toString(36)}.tmp`));
      const files = await builtFiles(ON);

      const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
      const result = await installWorkflowFolder({ claudeDir, name: NAME, files, links: { refusedFolders: [] } })
        .finally(() => clock.mockRestore());

      expect(result.outcome).toBe('installed');
      expect(await walk(elsewhere), 'what the link points to is untouched').toEqual([]);
      expect((await fs.lstat(folderDir())).isDirectory()).toBe(true);
      expect(await fileMap(folderDir())).toEqual(await builtFolder(ON));
    });

    it('is made by an exclusive create in the Claude directory, named for the folder and the process', async () => {
      const files = await builtFiles(ON);
      const made = vi.spyOn(fs, 'mkdtemp');

      const result = await installWorkflowFolder({ claudeDir, name: NAME, files, links: { refusedFolders: [] } });

      expect(result.outcome).toBe('installed');
      expect(made).toHaveBeenCalledTimes(1);
      expect(made.mock.calls[0][0]).toBe(path.join(claudeDir, `.devflow-workflow-${NAME}-${process.pid}-`));
      expect(await leftovers()).toEqual([]);
    });

    it('lets the installed folder take the default mode of a folder this process makes', async () => {
      const files = await builtFiles(ON);
      await installWorkflowFolder({ claudeDir, name: NAME, files, links: { refusedFolders: [] } });
      const probe = path.join(tmp, 'mode-probe');
      await fs.mkdir(probe);
      expect((await fs.stat(folderDir())).mode & 0o777).toBe((await fs.stat(probe)).mode & 0o777);
    });
  });

  describe('the build id is recomputed on the read (R2)', () => {
    const treeFile = (folder: string, file: string, switches: Switches = ON): string =>
      path.join(pkg, ...workflowFoldersRootRelPath(workflowFolderKey(switches)).split('/'), folder, ...file.split('/'));

    it('refuses a folder where a reference file is the text of another build', async () => {
      expect((await readWorkflowFolder(FIXTURE_FOLDER, ON, pkg)).ok, 'precondition: the built folder reads').toBe(true);
      await fs.writeFile(treeFile(NAME, EVIDENCE), `# ${EVIDENCE}\n\nbuilt for another build\n`, 'utf-8');

      const read = await readWorkflowFolder(FIXTURE_FOLDER, ON, pkg);

      expect(read.ok).toBe(false);
      if (!read.ok) expect(read.reason).toMatch(/build id/i);
      await expect(install(ON)).rejects.toThrow(/build id/i);
    });

    it('refuses a folder where a stamped file was edited and kept its stamp', async () => {
      const edited = treeFile(NAME, 'base-note.md');
      await fs.writeFile(edited, `${await fs.readFile(edited, 'utf-8')}Edited by hand.\n`, 'utf-8');
      expect((await readWorkflowFolder(FIXTURE_FOLDER, ON, pkg)).ok).toBe(false);
    });

    describe('a folder whose only stamped file is SKILL.md', () => {
      const SOLO: WorkflowFolder = {
        name: 'solo',
        core: 'src/solo/SKILL.mds',
        references: [{ source: 'src/solo/references/asks.mds', file: 'references/asks.md' }],
      };
      const CORE_BODY = '# Solo\n\nOne stamped file.\n';

      /** Write the folder with the id of the build that made `asksOfTheBuild`, and `asksOnDisk` as the reference file. */
      async function writeSolo(asksOfTheBuild: string, asksOnDisk: string): Promise<void> {
        const id = workflowBuildId([{ file: 'SKILL.md', body: CORE_BODY }, { file: 'references/asks.md', body: asksOfTheBuild }]);
        const stamped = stampBuildId(CORE_BODY, id);
        if (!stamped.ok) throw new Error('fixture core could not be stamped');
        for (const [file, text] of [['SKILL.md', stamped.value], ['references/asks.md', asksOnDisk]] as const) {
          await fs.mkdir(path.dirname(treeFile('solo', file)), { recursive: true });
          await fs.writeFile(treeFile('solo', file), text, 'utf-8');
        }
      }

      it('passes with the references of its own build', async () => {
        await writeSolo('# Asks\n\nOwn text.\n', '# Asks\n\nOwn text.\n');
        const read = await readWorkflowFolder(SOLO, ON, pkg);
        expect(read.ok).toBe(true);
        if (read.ok) expect(read.files.map(f => f.file)).toEqual(['SKILL.md', 'references/asks.md']);
      });

      it('is refused when the reference is the text of another build', async () => {
        await writeSolo('# Asks\n\nOwn text.\n', '# Asks\n\nText of another build.\n');
        const read = await readWorkflowFolder(SOLO, ON, pkg);
        expect(read.ok).toBe(false);
        if (!read.ok) expect(read.reason).toMatch(/build id/i);
      });
    });
  });
});
