/**
 * A converge never writes through a link at or below the Devflow folders: `commands/devflow`,
 * `agents/devflow`, `rules/devflow`, the `skills/devflow:*` folders and everything below them.
 *
 * Folder rows: the Devflow folder is a link to a scratch place outside the Claude directory. The
 * place holds a stray file, a 0600 file and the files the converge would act on. The converge must
 * leave the link in place, leave every byte, file and mode of the place as it was, and name the
 * folder in `refusedFolders` and in a warning with the wording of the install summary. A control
 * row runs the same converge on a real folder and proves it still does its work there.
 *
 * File rows: a file in a real Devflow folder is a link to a 0600 file outside. The converge must
 * replace the link with a real file (or remove it), leave the file outside as it was, and name the
 * link in `replacedLinks` and in a warning.
 *
 * Skill rows prove that the wholesale swap of a skill folder does not follow a link either.
 * Nothing reads or writes the real HOME.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as p from '@clack/prompts';

import { reapplyAgentMappingForInit } from '../../src/cli/commands/init.js';
import { formatLinksSummary, formatRefusedFoldersSummary, formatReplacedLinksSummary } from '../../src/cli/commands/install-report.js';
import { runRulesEnable } from '../../src/cli/commands/rules.js';
import { reapplyAgentMapping, saveAgentMapping } from '../../src/core/agent-models.js';
import { curationOffDir, skillsDir } from '../../src/core/assets.js';
import { writeManifest } from '../../src/core/manifest.js';
import { DEVFLOW_PLUGINS } from '../../src/core/plugins.js';
import { convergeBehaviorRule } from '../../src/targets/claude-code/behavior-install.js';
import { convergeComplianceArtifacts } from '../../src/targets/claude-code/compliance-install.js';
import { convergePromptVariants, convergeVariantAxes } from '../../src/targets/claude-code/curation-install.js';
import { mergeLinkReports } from '../../src/targets/claude-code/linked-folder.js';
import { convergeTrackerArtifacts } from '../../src/targets/claude-code/tracker-install.js';
import { restampTrackerAgents } from '../../src/targets/claude-code/tracker-servers.js';
import { assertTempHome } from '../setup/home-isolation.js';

const STRAY = 'a stray file the user keeps\n';
const PRIVATE_BYTES = 'a private file the user keeps\n';
const SKILL_DIR = 'devflow:apply-decisions';

let tmp: string;
let claudeDir: string;
let devflowDir: string;
let pkg: string;
let agentSrc: string;
let outside: string;
let warnings: string[];

const warn = (msg: string): void => { warnings.push(msg); };

/** What a converge reports about the links it met. */
interface Links {
  readonly refusedFolders: readonly string[];
  readonly replacedLinks: readonly string[];
}

async function write(file: string, text: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, text, 'utf-8');
}

const exists = (file: string): Promise<boolean> => fs.lstat(file).then(() => true, () => false);

/** Every entry at or below `full` as relative path -> kind, mode and bytes (a link: its target), so a changed byte, mode, file or folder shows. */
async function snapshot(full: string, rel = '.'): Promise<Record<string, string>> {
  const stat = await fs.lstat(full);
  const mode = (stat.mode & 0o777).toString(8);
  if (stat.isSymbolicLink()) return { [rel]: `link:${await fs.readlink(full)}` };
  if (!stat.isDirectory()) return { [rel]: `file:${mode}:${(await fs.readFile(full)).toString('base64')}` };
  const out: Record<string, string> = { [`${rel}/`]: `dir:${mode}` };
  for (const name of (await fs.readdir(full)).sort()) Object.assign(out, await snapshot(path.join(full, name), `${rel}/${name}`));
  return out;
}

/** A folder holding a stray file, a 0600 file and `files`. */
async function seedFolder(dir: string, files: Readonly<Record<string, string>>): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'stray.txt'), STRAY, 'utf-8');
  await fs.writeFile(path.join(dir, 'private.dat'), PRIVATE_BYTES, 'utf-8');
  await fs.chmod(path.join(dir, 'private.dat'), 0o600);
  for (const [name, text] of Object.entries(files)) await write(path.join(dir, name), text);
}

/** Replace the folder at `folder` with a link to the scratch place `outside`, which holds `files` and two files the user keeps. */
async function linkFolder(folder: string, files: Readonly<Record<string, string>>): Promise<void> {
  await seedFolder(outside, files);
  await fs.mkdir(path.dirname(folder), { recursive: true });
  await fs.symlink(outside, folder, 'dir');
}

/** Put a 0600 file holding `text` outside and link `entry` to it. The folder holding `entry` is a real one. */
async function linkFile(entry: string, text: string): Promise<void> {
  await fs.mkdir(path.dirname(entry), { recursive: true });
  await fs.writeFile(outside, text, 'utf-8');
  await fs.chmod(outside, 0o600);
  await fs.symlink(outside, entry, 'file');
}

/** A package root with one command and one agent that have a curation-off variant. */
async function seedPackage(): Promise<void> {
  await write(path.join(pkg, 'dist', 'commands', 'implement.md'), 'implement ON\n');
  await write(path.join(curationOffDir('commands', pkg), 'implement.md'), 'implement OFF\n');
  await write(path.join(pkg, 'dist', 'agents', 'code.md'), 'code ON\n');
  await write(path.join(curationOffDir('agents', pkg), 'code.md'), 'code OFF\n');
  await write(path.join(skillsDir(pkg), 'apply-decisions', 'SKILL.md'), 'apply-decisions of the package\n');
}

const AGENT_WITH_TOOLS = (name: string): string => `---\nname: ${name}\nmodel: sonnet\ntools: ["Bash", "Read"]\n---\n\nbody\n`;
const CODE_AGENT = '---\nname: Code\nmodel: sonnet\n---\n\nbody\n';

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-link-converge-'));
  expect(() => assertTempHome(tmp)).not.toThrow();
  claudeDir = path.join(tmp, 'claude');
  devflowDir = path.join(tmp, 'devflow');
  pkg = path.join(tmp, 'pkg');
  agentSrc = path.join(tmp, 'agent-src');
  outside = path.join(tmp, 'outside');
  warnings = [];
  await fs.mkdir(claudeDir, { recursive: true });
  await fs.mkdir(devflowDir, { recursive: true });
  await seedPackage();
  await write(path.join(agentSrc, 'tracker.md'), AGENT_WITH_TOOLS('Tracker'));
  await saveAgentMapping(devflowDir, { version: 1, agents: { code: { model: 'opus' } } });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(tmp, { recursive: true, force: true });
});

const installedCommands = (): string => path.join(claudeDir, 'commands', 'devflow');
const installedAgents = (): string => path.join(claudeDir, 'agents', 'devflow');
const installedRules = (): string => path.join(claudeDir, 'rules', 'devflow');

const plugins = DEVFLOW_PLUGINS;
/** The machine's switches for a prompt converge: curation off, compliance on, so the curation arm of each prompt flips. */
const promptConverge = (): Promise<Links> =>
  convergePromptVariants({ claudeDir, switches: { curation: false, compliance: true }, plugins, warn, packageRoot: pkg });
const reapply = (): Promise<Links> =>
  reapplyAgentMapping({ installDir: installedAgents(), devflowDir, proxyEnabled: false, onWarning: warn });
const restamp = (): Promise<Links> => restampTrackerAgents({ claudeDir, servers: ['linear'], warn });
const trackerConverge = (): Promise<Links> =>
  convergeTrackerArtifacts({ claudeDir, warn, agentSourceDirs: [agentSrc], servers: ['linear'] });
const complianceConverge = (enabled: boolean): Promise<Links> =>
  convergeComplianceArtifacts({ claudeDir, devflowDir, enabled, frameworks: [], rulesEnabled: enabled, warn });
const behaviorConverge = (enabled: boolean): Promise<Links> =>
  convergeBehaviorRule({ claudeDir, devflowDir, enabled, rulesEnabled: true, warn });

// ---------------------------------------------------------------------------
// A linked Devflow folder is refused
// ---------------------------------------------------------------------------

interface FolderRow {
  readonly name: string;
  readonly folder: () => string;
  /** What the folder holds before the run: the files the converge acts on. */
  readonly seed: Readonly<Record<string, string>>;
  readonly run: () => Promise<Links>;
  /** After a run on a real folder: the converge did its work there. */
  readonly worked: (folder: string) => Promise<void>;
}

const FOLDER_ROWS: readonly FolderRow[] = [
  {
    name: 'the prompt converge, commands/devflow',
    folder: installedCommands,
    seed: { 'implement.md': 'implement ON\n' },
    run: promptConverge,
    worked: async folder => expect(await fs.readFile(path.join(folder, 'implement.md'), 'utf-8')).toBe('implement OFF\n'),
  },
  {
    name: 'the prompt converge, agents/devflow',
    folder: installedAgents,
    seed: { 'code.md': 'code ON\n' },
    run: promptConverge,
    worked: async folder => expect(await fs.readFile(path.join(folder, 'code.md'), 'utf-8')).toBe('code OFF\n'),
  },
  {
    name: 'the agent model mapping, agents/devflow',
    folder: installedAgents,
    seed: { 'code.md': CODE_AGENT },
    run: reapply,
    worked: async folder => expect(await fs.readFile(path.join(folder, 'code.md'), 'utf-8')).toContain('model: opus'),
  },
  {
    name: 'the tracker server stamp, agents/devflow',
    folder: installedAgents,
    seed: { 'git.md': AGENT_WITH_TOOLS('Git'), 'tracker.md': AGENT_WITH_TOOLS('Tracker') },
    run: restamp,
    worked: async folder => expect(await fs.readFile(path.join(folder, 'git.md'), 'utf-8')).toContain('mcp__linear'),
  },
  {
    name: 'the tracker agent converge, agents/devflow',
    folder: installedAgents,
    seed: {},
    run: trackerConverge,
    worked: async folder => expect(await fs.readFile(path.join(folder, 'tracker.md'), 'utf-8')).toContain('mcp__linear'),
  },
  {
    name: 'the compliance rule install, rules/devflow',
    folder: installedRules,
    seed: {},
    run: () => complianceConverge(true),
    worked: async folder => expect((await fs.readFile(path.join(folder, 'compliance.md'), 'utf-8')).length).toBeGreaterThan(0),
  },
  {
    name: 'the compliance rule removal, rules/devflow',
    folder: installedRules,
    seed: { 'compliance.md': 'an old compliance rule\n' },
    run: () => complianceConverge(false),
    worked: async folder => expect(await exists(path.join(folder, 'compliance.md'))).toBe(false),
  },
  {
    name: 'the behavior rule install, rules/devflow',
    folder: installedRules,
    seed: {},
    run: () => behaviorConverge(true),
    worked: async folder => expect((await fs.readFile(path.join(folder, 'behavior.md'), 'utf-8')).length).toBeGreaterThan(0),
  },
  {
    name: 'the behavior rule removal, rules/devflow',
    folder: installedRules,
    seed: { 'behavior.md': 'an old behavior rule\n' },
    run: () => behaviorConverge(false),
    worked: async folder => expect(await exists(path.join(folder, 'behavior.md'))).toBe(false),
  },
];

describe('a converge refuses a Devflow folder that is a link', () => {
  it.each(FOLDER_ROWS)('$name: writes nothing through the link and says so', async row => {
    const folder = row.folder();
    await linkFolder(folder, row.seed);
    const before = await snapshot(outside);

    const report = await row.run();

    expect(await snapshot(outside), 'the place outside keeps every byte, file and mode').toEqual(before);
    expect((await fs.lstat(folder)).isSymbolicLink(), 'the link is still in place').toBe(true);
    expect(await fs.readlink(folder)).toBe(outside);
    expect(report.refusedFolders).toContain(folder);
    expect(report.replacedLinks).toEqual([]);
    const [line] = formatRefusedFoldersSummary({ refusedFolders: [folder] });
    expect(warnings, 'the converge names the folder').toContain(line.message);
  });

  it.each(FOLDER_ROWS)('$name: does its work in a real folder and reports no link', async row => {
    const folder = row.folder();
    await seedFolder(folder, row.seed);

    const report = await row.run();

    await row.worked(folder);
    expect(report.refusedFolders).toEqual([]);
    expect(report.replacedLinks).toEqual([]);
    expect(await fs.readFile(path.join(folder, 'stray.txt'), 'utf-8')).toBe(STRAY);
  });
});

// ---------------------------------------------------------------------------
// A linked file in a Devflow folder is replaced, never written through
// ---------------------------------------------------------------------------

interface FileRow {
  readonly name: string;
  readonly entry: () => string;
  /** What the link points to: the copy the converge compares with and acts on. */
  readonly pointsTo: string;
  readonly run: () => Promise<Links>;
  /** What stands at the entry afterwards. */
  readonly after: 'real file' | 'nothing';
  readonly check?: (text: string) => void;
}

const FILE_ROWS: readonly FileRow[] = [
  {
    name: 'a command file, prompt converge',
    entry: () => path.join(installedCommands(), 'implement.md'),
    pointsTo: 'implement ON\n',
    run: promptConverge,
    after: 'real file',
    check: text => expect(text).toBe('implement OFF\n'),
  },
  {
    name: 'an agent file, prompt converge',
    entry: () => path.join(installedAgents(), 'code.md'),
    pointsTo: 'code ON\n',
    run: promptConverge,
    after: 'real file',
    check: text => expect(text).toBe('code OFF\n'),
  },
  {
    name: 'an agent file, model mapping',
    entry: () => path.join(installedAgents(), 'code.md'),
    pointsTo: CODE_AGENT,
    run: reapply,
    after: 'real file',
    check: text => expect(text).toContain('model: opus'),
  },
  {
    name: 'the git agent, tracker server stamp',
    entry: () => path.join(installedAgents(), 'git.md'),
    pointsTo: AGENT_WITH_TOOLS('Git'),
    run: restamp,
    after: 'real file',
    check: text => expect(text).toContain('mcp__linear'),
  },
  {
    name: 'the tracker agent, tracker agent converge',
    entry: () => path.join(installedAgents(), 'tracker.md'),
    pointsTo: 'a stale tracker agent\n',
    run: trackerConverge,
    after: 'real file',
    check: text => expect(text).toContain('mcp__linear'),
  },
  {
    name: 'the compliance rule, install',
    entry: () => path.join(installedRules(), 'compliance.md'),
    pointsTo: 'an old compliance rule\n',
    run: () => complianceConverge(true),
    after: 'real file',
    check: text => expect(text).not.toBe('an old compliance rule\n'),
  },
  {
    name: 'the behavior rule, install',
    entry: () => path.join(installedRules(), 'behavior.md'),
    pointsTo: 'an old behavior rule\n',
    run: () => behaviorConverge(true),
    after: 'real file',
    check: text => expect(text).not.toBe('an old behavior rule\n'),
  },
  {
    name: 'the compliance rule, removal',
    entry: () => path.join(installedRules(), 'compliance.md'),
    pointsTo: 'an old compliance rule\n',
    run: () => complianceConverge(false),
    after: 'nothing',
  },
  {
    name: 'the behavior rule, removal',
    entry: () => path.join(installedRules(), 'behavior.md'),
    pointsTo: 'an old behavior rule\n',
    run: () => behaviorConverge(false),
    after: 'nothing',
  },
];

describe('a converge replaces a linked file in a Devflow folder and never writes through it', () => {
  it.each(FILE_ROWS)('$name', async row => {
    const entry = row.entry();
    await linkFile(entry, row.pointsTo);
    const before = await snapshot(outside);

    const report = await row.run();

    expect(await snapshot(outside), 'the file outside keeps its bytes and its mode').toEqual(before);
    if (row.after === 'nothing') {
      expect(await exists(entry), 'the link is gone and nothing stands in its place').toBe(false);
      return;
    }
    const stat = await fs.lstat(entry);
    expect(stat.isSymbolicLink(), 'the link is gone').toBe(false);
    expect(stat.isFile(), 'a real file stands in its place').toBe(true);
    row.check?.(await fs.readFile(entry, 'utf-8'));
    expect(report.replacedLinks).toContain(entry);
    expect(report.refusedFolders).toEqual([]);
    const [line] = formatReplacedLinksSummary({ replacedLinks: [entry] });
    expect(warnings, 'the converge names the link').toContain(line.message);
  });
});

// ---------------------------------------------------------------------------
// The skill folders are swapped whole, so a link there is never followed
// ---------------------------------------------------------------------------

describe('a skill folder that is a link is swapped whole and what it points to is left as it was', () => {
  const skillFolder = (name: string): string => path.join(claudeDir, 'skills', name);

  const axes = (curation: boolean) => convergeVariantAxes({
    claudeDir,
    devflowDir,
    manifest: { features: { curation, compliance: { enabled: true, frameworks: [] }, rules: false } },
    plugins,
    warn,
    packageRoot: pkg,
  });

  interface SkillRow {
    readonly name: string;
    readonly folder: () => string;
    readonly run: () => Promise<Links>;
    readonly after: 'real folder' | 'nothing';
  }

  const SKILL_ROWS: readonly SkillRow[] = [
    { name: 'the compliance skill, converge', folder: () => skillFolder('devflow:compliance'), run: () => complianceConverge(true), after: 'real folder' },
    { name: 'the apply-decisions skill, curation on', folder: () => skillFolder(SKILL_DIR), run: () => axes(true), after: 'real folder' },
    { name: 'the apply-decisions skill, curation off', folder: () => skillFolder(SKILL_DIR), run: () => axes(false), after: 'nothing' },
  ];

  const SWAP_ROWS = SKILL_ROWS.filter(row => row.after === 'real folder');

  it.each(SKILL_ROWS)('$name', async row => {
    const folder = row.folder();
    await linkFolder(folder, { 'SKILL.md': 'a skill the user keeps\n' });
    const before = await snapshot(outside);

    await row.run();

    expect(await snapshot(outside), 'the place outside keeps every byte, file and mode').toEqual(before);
    if (row.after === 'nothing') {
      expect(await exists(folder)).toBe(false);
      return;
    }
    const stat = await fs.lstat(folder);
    expect(stat.isSymbolicLink()).toBe(false);
    expect(stat.isDirectory()).toBe(true);
  });

  it.each(SWAP_ROWS)('$name: the replaced link is named in the report and in a warning', async row => {
    const folder = row.folder();
    await linkFolder(folder, { 'SKILL.md': 'a skill the user keeps\n' });

    const report = await row.run();

    expect(report.replacedLinks).toEqual([folder]);
    expect(report.refusedFolders).toEqual([]);
    const [line] = formatReplacedLinksSummary({ replacedLinks: [folder] });
    expect(warnings.filter(message => message === line.message), 'the converge names the link once').toHaveLength(1);
  });

  it.each(SWAP_ROWS)('$name: a real skill folder is swapped and reports no link', async row => {
    const folder = row.folder();
    await seedFolder(folder, { 'SKILL.md': 'an older skill\n' });

    const report = await row.run();

    expect((await fs.lstat(folder)).isDirectory()).toBe(true);
    expect(report.replacedLinks).toEqual([]);
    expect(warnings.filter(message => message.includes('was a link'))).toEqual([]);
  });

  it('the apply-decisions skill as a link to nothing is replaced by a real folder and named in the report', async () => {
    const folder = skillFolder(SKILL_DIR);
    await fs.mkdir(path.dirname(folder), { recursive: true });
    await fs.symlink(path.join(tmp, 'gone'), folder, 'dir');

    const report = await axes(true);

    const stat = await fs.lstat(folder);
    expect(stat.isSymbolicLink(), 'the dangling link is gone').toBe(false);
    expect(stat.isDirectory(), 'a real folder stands in its place').toBe(true);
    expect(report.replacedLinks).toEqual([folder]);
    expect(await exists(path.join(tmp, 'gone')), 'what the link named was not created').toBe(false);
  });
});

// ---------------------------------------------------------------------------
// `devflow init` prints the links of its agent model reapply through the install summary
// ---------------------------------------------------------------------------

describe('init reapplies the agent model mapping and reports its links without --verbose', () => {
  let printed: string[];

  beforeEach(() => {
    printed = [];
    vi.spyOn(p.log, 'warn').mockImplementation(message => { printed.push(String(message)); });
    vi.spyOn(p.log, 'info').mockImplementation(message => { printed.push(String(message)); });
  });

  const reapplyForInit = (verbose: boolean): Promise<Links> =>
    reapplyAgentMappingForInit({ proxyEnabled: false, claudeDir, devflowDir, verbose });

  it.each([false, true])('a linked agents/devflow, verbose %s: the folder is returned for the summary and printed by no one else', async verbose => {
    await linkFolder(installedAgents(), { 'code.md': CODE_AGENT });
    const before = await snapshot(outside);

    const links = await reapplyForInit(verbose);

    expect(await snapshot(outside), 'the place outside keeps every byte, file and mode').toEqual(before);
    expect(links.refusedFolders).toEqual([installedAgents()]);
    expect(links.replacedLinks).toEqual([]);
    expect(printed.filter(line => line.includes(installedAgents())), 'the summary prints the folder, so the reapply does not').toEqual([]);
  });

  it('a linked agent file: the replaced link is returned for the summary and printed by no one else', async () => {
    await seedFolder(installedAgents(), {});
    await linkFile(path.join(installedAgents(), 'code.md'), CODE_AGENT);

    const links = await reapplyForInit(true);

    expect(links.replacedLinks).toEqual([path.join(installedAgents(), 'code.md')]);
    expect(links.refusedFolders).toEqual([]);
    expect(printed.filter(line => line.includes('was a link'))).toEqual([]);
  });

  it('a real agents/devflow: the mapping is applied and no link is returned', async () => {
    await seedFolder(installedAgents(), { 'code.md': CODE_AGENT });

    const links = await reapplyForInit(false);

    expect(await fs.readFile(path.join(installedAgents(), 'code.md'), 'utf-8')).toContain('model: opus');
    expect(links).toEqual({ replacedLinks: [], refusedFolders: [] });
  });

  it('an empty mapping with the proxy off skips the reapply and returns no link', async () => {
    await saveAgentMapping(devflowDir, { version: 1, agents: {} });
    await linkFolder(installedAgents(), { 'code.md': CODE_AGENT });

    const links = await reapplyForInit(false);

    expect(links).toEqual({ replacedLinks: [], refusedFolders: [] });
  });

  it('the install summary and the reapply name a folder once, and name each different folder', () => {
    const shared = installedAgents();
    const other = installedCommands();
    const install = { replacedLinks: [path.join(shared, 'a.md')], refusedFolders: [shared] };
    const reapplied = { replacedLinks: [path.join(shared, 'a.md'), path.join(shared, 'b.md')], refusedFolders: [shared, other] };

    const merged = mergeLinkReports(install, reapplied);

    expect(merged.refusedFolders).toEqual([shared, other]);
    expect(merged.replacedLinks).toEqual([path.join(shared, 'a.md'), path.join(shared, 'b.md')]);
    expect(formatLinksSummary(merged).map(line => line.message)).toHaveLength(4);
    expect(install.refusedFolders, 'the inputs are not changed').toEqual([shared]);
  });

  it('the init summary is built from the install report merged with the reapply links', async () => {
    const source = await fs.readFile(new URL('../../src/cli/commands/init.ts', import.meta.url), 'utf-8');

    expect(
      source.includes('logSummaryLines(formatLinksSummary(mergeLinkReports(installReport, agentMappingLinks)));'),
      'init prints the install links and the reapply links through one summary',
    ).toBe(true);
    expect(
      source.includes('agentMappingLinks = await reapplyAgentMappingForInit('),
      'init takes the reapply links from the reapply step',
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// `devflow rules --enable` wipes and reinstalls the rules folder
// ---------------------------------------------------------------------------

describe('rules --enable', () => {
  async function seedManifest(): Promise<void> {
    await writeManifest(devflowDir, {
      version: '2.0.0',
      plugins: ['devflow-core-skills'],
      scope: 'user',
      features: {
        ambient: false, memory: false, hud: false, knowledge: false, learning: false, rules: true, proxy: false,
        flags: [], compliance: { enabled: false, frameworks: [] },
      },
      installedAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
  }

  it('replaces a rules folder that is a link with a real one, leaves what it points to as it was and says so', async () => {
    await seedManifest();
    const logged: string[] = [];
    vi.spyOn(p.log, 'warn').mockImplementation(message => { logged.push(String(message)); });
    await linkFolder(installedRules(), { 'old-rule.md': 'an old rule\n' });
    const before = await snapshot(outside);

    await runRulesEnable(claudeDir, devflowDir);

    expect(await snapshot(outside), 'the place outside keeps every byte, file and mode').toEqual(before);
    const stat = await fs.lstat(installedRules());
    expect(stat.isSymbolicLink(), 'the link is gone').toBe(false);
    expect(stat.isDirectory(), 'a real folder stands in its place').toBe(true);
    expect((await fs.readdir(installedRules())).length, 'the rules were installed there').toBeGreaterThan(0);
    const [line] = formatReplacedLinksSummary({ replacedLinks: [installedRules()] });
    expect(logged).toContain(line.message);
  });

  it('reports no link for a real rules folder', async () => {
    await seedManifest();
    const logged: string[] = [];
    vi.spyOn(p.log, 'warn').mockImplementation(message => { logged.push(String(message)); });
    await fs.mkdir(installedRules(), { recursive: true });

    await runRulesEnable(claudeDir, devflowDir);

    expect(logged.filter(line => line.includes('was a link'))).toEqual([]);
    expect((await fs.readdir(installedRules())).length).toBeGreaterThan(0);
  });
});
