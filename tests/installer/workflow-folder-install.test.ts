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
import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { computeAssetsToRemove, enumerateDryRunExtras, formatDryRunPlan, removeAllDevFlow, removeSelectedPlugins, sweepDevflowNamespaces } from '../../src/cli/commands/uninstall.js';
import { workflowFolderShadowRefusal } from '../../src/cli/commands/skills.js';
import { VARIANT_KEYS } from '../../src/core/curation-variants.js';
import { stampBuildId, workflowFolderFiles, workflowFolderKey, workflowFolderRelPath, workflowFoldersRootRelPath } from '../../src/core/mds-variants.js';
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

let tmp: string;
let claudeDir: string;
let devflowDir: string;
let pkg: string;
let warnings: string[];
let messages: string[];

const spinner: Spinner = { start() {}, stop() {}, message(message) { messages.push(message ?? ''); } };
const warn = (msg: string): void => { warnings.push(msg); };
const folderDir = (dir: string = claudeDir): string => path.join(dir, 'skills', `devflow:${NAME}`);
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

/** The build tree of one key, as the build would have written it for the fixture folder. */
async function writeBuiltTrees(root: string): Promise<void> {
  for (const key of VARIANT_KEYS) {
    const id = createHash('sha256').update(key).digest('hex').slice(0, 12);
    for (const file of workflowFolderFiles(FIXTURE_FOLDER, key)) {
      const body = `# ${file}\n\nbuilt for ${key}\n`;
      const stamped = file.startsWith('references/') ? { ok: true as const, value: body } : stampBuildId(body, id);
      if (!stamped.ok) throw new Error(`fixture file ${file} could not be stamped`);
      const target = path.join(root, ...workflowFolderRelPath(key, NAME, file).split('/'));
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
  opts: { plugins?: PluginDefinition[]; effectivePlugins?: PluginDefinition[]; isPartialInstall?: boolean; claude?: string; home?: string } = {},
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
    workflowFolders: [FIXTURE_FOLDER],
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
    await install(ON);
    const stale = path.join(claudeDir, 'commands', 'devflow', 'flow.md');
    await fs.mkdir(path.dirname(stale), { recursive: true });
    await fs.writeFile(stale, 'the old command\n', 'utf-8');

    const report = await install(ON, { isPartialInstall: true });
    expect(await exists(stale)).toBe(false);
    expect(report.sweptOrphans).toContainEqual({ kind: 'command', name: NAME });
    expect(await exists(folderDir())).toBe(true);
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
  it('a full uninstall removes the folder and sweeps a stale command file of a folder workflow', async () => {
    await install(ON);
    const stale = path.join(claudeDir, 'commands', 'devflow', 'flow.md');
    await fs.mkdir(path.dirname(stale), { recursive: true });
    await fs.writeFile(stale, 'the old command\n', 'utf-8');

    await removeAllDevFlow(claudeDir, path.join(devflowDir, 'scripts'), false, undefined, FOLDER_SET);
    expect(await exists(folderDir())).toBe(false);
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
