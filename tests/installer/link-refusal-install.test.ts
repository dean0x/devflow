/**
 * An install never writes through a link at or below its own folders: `commands/devflow`,
 * `agents/devflow`, `rules/devflow`, the `skills/devflow:*` folders and everything below them.
 *
 * Every row plants a link where the install writes a file or a folder, points it at a scratch
 * place outside the Claude directory that holds a 0600 file the user keeps, runs the install, and
 * proves that the place outside keeps every byte, file, folder and mode. The link is then either
 * replaced by a real file or folder and listed in `replacedLinks`, or - when it cannot be removed -
 * left in place and listed in `refusedFolders`. Nothing reads or writes the real HOME.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';

import { formatRefusedFoldersSummary, formatReplacedLinksSummary } from '../../src/cli/commands/install-report.js';
import { sweepLegacyDevflowFiles } from '../../src/cli/commands/legacy-sweep.js';
import { installViaFileCopy, type InstallReport, type Spinner } from '../../src/targets/claude-code/installer.js';
import { clearLinkedEntry, mergeLinkReports } from '../../src/targets/claude-code/linked-folder.js';
import { convergeTrackerArtifacts } from '../../src/targets/claude-code/tracker-install.js';
import { compiledSkillRefsDir } from '../../src/core/assets.js';
import { generatedReferenceManifest } from '../../src/core/mds-variants.js';
import { buildAssetMaps, DEVFLOW_PLUGINS } from '../../src/core/plugins.js';
import { assertTempHome } from '../setup/home-isolation.js';
import { testBackups } from '../helpers.js';

const noopSpinner: Spinner = { start() {}, stop() {}, message() {} };

const CORE = DEVFLOW_PLUGINS.filter(p => p.name === 'devflow-core-skills');
const CODE_REVIEW = DEVFLOW_PLUGINS.filter(p => p.name === 'devflow-code-review');
const SKILLS = new Map([['git', 'devflow-core-skills'], ['agent-references', 'devflow-core-skills']]);
const USER_BYTES = 'a file only the user keeps\n';

let tmp: string;
let claudeDir: string;
let devflowDir: string;
let warnings: string[];

const warn = (msg: string): void => { warnings.push(msg); };
const skillsRoot = (): string => path.join(claudeDir, 'skills');
const installedRefs = (): string => path.join(skillsRoot(), 'devflow:git', 'references');
const exists = (file: string): Promise<boolean> => fs.lstat(file).then(() => true, () => false);

/** Install code-review's command and agents, a core rule and two skills, as a full or a partial install. */
async function install(isPartialInstall: boolean): Promise<InstallReport> {
  return installViaFileCopy({
    backups: await testBackups(tmp, { claudeDir, devflowDir }),
    curation: true,
    compliance: true,
    plugins: CODE_REVIEW,
    effectivePlugins: [...CORE, ...CODE_REVIEW],
    claudeDir,
    devflowDir,
    skillsMap: SKILLS,
    agentsMap: buildAssetMaps(CODE_REVIEW).agentsMap,
    rulesMap: new Map([['security', 'devflow-core-skills']]),
    isPartialInstall,
    spinner: noopSpinner,
    warn,
  });
}

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

/** Make an unlink of `entry` fail, as a link that is not the user's to remove would. */
async function withStuckLink<T>(entry: string, run: () => Promise<T>): Promise<T> {
  const realUnlink = fs.unlink.bind(fs);
  const unlink = vi.spyOn(fs, 'unlink').mockImplementation(async (target) => {
    if (target === entry) throw Object.assign(new Error('operation not permitted'), { code: 'EPERM' });
    return realUnlink(target);
  });
  try {
    return await run();
  } finally {
    unlink.mockRestore();
  }
}

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-link-refusal-'));
  expect(() => assertTempHome(tmp)).not.toThrow();
  claudeDir = path.join(tmp, 'claude');
  devflowDir = path.join(tmp, 'devflow');
  warnings = [];
  await fs.mkdir(claudeDir, { recursive: true });
  await fs.mkdir(devflowDir, { recursive: true });
  for (const rel of generatedReferenceManifest()) {
    await fs.access(path.join(compiledSkillRefsDir(), ...rel.split('/'))).catch(() => {
      throw new Error(`dist/skills/git/references/${rel} is absent — run \`npm run build\` before this suite.`);
    });
  }
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

/** A link planted where the install writes: what it points to, and what must be true once the install replaced it. */
interface PlantedLink {
  readonly outside: string;
  readonly before: Record<string, string>;
  /** The entry is now a real file or folder holding what a fresh install writes there. */
  readonly expectReal: () => Promise<void>;
}

interface LinkRow {
  readonly name: string;
  readonly entry: () => string;
  readonly kind: 'file' | 'folder';
}

const LINK_ROWS: readonly LinkRow[] = [
  { name: 'a command file in commands/devflow', kind: 'file', entry: () => path.join(claudeDir, 'commands', 'devflow', 'code-review.md') },
  { name: 'an agent file in agents/devflow', kind: 'file', entry: () => path.join(claudeDir, 'agents', 'devflow', 'review.md') },
  { name: 'a rule file in rules/devflow', kind: 'file', entry: () => path.join(claudeDir, 'rules', 'devflow', 'security.md') },
  { name: 'SKILL.md of a skill', kind: 'file', entry: () => path.join(skillsRoot(), 'devflow:agent-references', 'SKILL.md') },
  { name: 'a file in the references root of devflow:git', kind: 'file', entry: () => path.join(installedRefs(), 'detection.md') },
  { name: 'a folder inside a skill', kind: 'folder', entry: () => path.join(skillsRoot(), 'devflow:agent-references', 'references', 'commands') },
];

/** Move what a first install wrote at `row.entry()` aside, and link its place to a scratch place holding files only the user keeps. */
async function plantLink(row: LinkRow): Promise<PlantedLink> {
  const entry = row.entry();
  const outside = path.join(tmp, 'outside');
  if (row.kind === 'file') {
    const installed = await fs.readFile(entry);
    await fs.writeFile(outside, USER_BYTES, 'utf-8');
    await fs.chmod(outside, 0o600);
    await fs.rm(entry);
    await fs.symlink(outside, entry, 'file');
    return {
      outside,
      before: await snapshot(outside),
      expectReal: async () => {
        const stat = await fs.lstat(entry);
        expect(stat.isSymbolicLink(), 'the link is gone').toBe(false);
        expect(stat.isFile(), 'a real file stands in its place').toBe(true);
        expect(await fs.readFile(entry), 'the file holds what the install writes').toEqual(installed);
      },
    };
  }

  const installed = await snapshot(entry);
  await fs.rename(entry, outside);
  await fs.symlink(outside, entry, 'dir');
  const files = (await fs.readdir(outside)).sort();
  await fs.writeFile(path.join(outside, files[0]), USER_BYTES, 'utf-8');
  await fs.chmod(path.join(outside, files[0]), 0o600);
  await fs.writeFile(path.join(outside, 'stray.md'), USER_BYTES, 'utf-8');
  await fs.chmod(path.join(outside, 'stray.md'), 0o600);
  return {
    outside,
    before: await snapshot(outside),
    expectReal: async () => {
      const stat = await fs.lstat(entry);
      expect(stat.isSymbolicLink(), 'the link is gone').toBe(false);
      expect(stat.isDirectory(), 'a real folder stands in its place').toBe(true);
      expect(await snapshot(entry), 'the folder holds what the install writes').toEqual(installed);
    },
  };
}

describe('a partial install replaces a link at a file or folder it writes, and writes nothing through it', () => {
  it.each(LINK_ROWS)('$name that is a link: it is replaced by a real entry, reported, and its target keeps every byte and mode', async (row) => {
    await install(false);
    const planted = await plantLink(row);

    const report = await install(true);

    expect(await snapshot(planted.outside), 'no byte, mode, file or folder at the target changed').toEqual(planted.before);
    await planted.expectReal();
    expect(report.replacedLinks, 'the replaced link is reported').toEqual([row.entry()]);
    expect(report.refusedFolders).toEqual([]);
    const lines = formatReplacedLinksSummary(report);
    expect(lines).toHaveLength(1);
    expect(lines[0].message).toContain(row.entry());
    expect(lines[0].message).toContain('left as it was');
  });

  it.each(LINK_ROWS)('$name that is a link and cannot be removed: nothing is written through it, and the refusal is reported', async (row) => {
    await install(false);
    const planted = await plantLink(row);

    const report = await withStuckLink(row.entry(), () => install(true));

    expect(await snapshot(planted.outside), 'no byte, mode, file or folder at the target changed').toEqual(planted.before);
    expect((await fs.lstat(row.entry())).isSymbolicLink(), 'the link is left in place').toBe(true);
    expect(await fs.readlink(row.entry())).toBe(planted.outside);
    expect(report.refusedFolders, 'the refusal is reported').toEqual([row.entry()]);
    expect(report.replacedLinks).toEqual([]);
    const lines = formatRefusedFoldersSummary(report);
    expect(lines).toHaveLength(1);
    expect(lines[0].message).toContain(row.entry());
    expect(lines[0].message).toContain('Nothing was written there');
  });

  it('over real files and folders it writes everything and reports no link', async () => {
    await install(false);

    const report = await install(true);

    expect(report.replacedLinks).toEqual([]);
    expect(report.refusedFolders).toEqual([]);
    expect(warnings).toEqual([]);
    for (const row of LINK_ROWS) expect(await exists(row.entry()), row.name).toBe(true);
  });
});

describe('a link nested under the kept references/tracker and references/pr subtrees', () => {
  const SHADOW_FILE = path.join('references', 'tracker', 'github', 'extra.md');
  const providerDir = (): string => path.join(installedRefs(), 'tracker', 'github');

  /** A shadow devflow:git skill that supplies a file below the provider folder, as a user override may. */
  async function writeShadowSkill(): Promise<void> {
    const shadow = path.join(devflowDir, 'skills', 'git');
    await fs.mkdir(path.dirname(path.join(shadow, SHADOW_FILE)), { recursive: true });
    await fs.writeFile(path.join(shadow, 'SKILL.md'), 'a shadow of the git skill\n', 'utf-8');
    await fs.writeFile(path.join(shadow, SHADOW_FILE), 'a file the shadow supplies\n', 'utf-8');
  }

  it('a provider folder that is a link, with a shadow that writes below it: the shadow file lands in a real folder and the linked folder keeps every byte', async () => {
    await install(false);
    const outside = path.join(tmp, 'outside-provider');
    await fs.rename(providerDir(), outside);
    await fs.symlink(outside, providerDir(), 'dir');
    await fs.writeFile(path.join(outside, 'setup-task.md'), USER_BYTES, 'utf-8');
    await fs.chmod(path.join(outside, 'setup-task.md'), 0o600);
    const before = await snapshot(outside);
    await writeShadowSkill();

    const report = await install(false);

    expect(report.shadowedSkills, 'precondition: the shadow is the skill that was copied').toContain('git');
    expect(await snapshot(outside), 'no byte, mode, file or folder below the link changed').toEqual(before);
    const stat = await fs.lstat(providerDir());
    expect(stat.isSymbolicLink(), 'the link is gone').toBe(false);
    expect(stat.isDirectory(), 'a real folder stands in its place').toBe(true);
    expect(await exists(path.join(providerDir(), 'extra.md')), 'the shadow file was converged away with the rest of the subtree').toBe(false);
    expect(report.replacedLinks).toEqual([providerDir()]);
    expect(report.overlayFailures).toEqual([]);
  });

  const OVERLAY_ROWS = [
    { name: 'a provider folder', kind: 'dir', rel: path.join('tracker', 'github') },
    { name: 'a file of a provider', kind: 'file', rel: path.join('tracker', 'github', 'setup-task.md') },
    { name: 'the tool-call contract of tracker/', kind: 'file', rel: path.join('tracker', '_contract.md') },
    { name: 'a file of pr/', kind: 'file', rel: path.join('pr', 'validate-branch.md') },
  ] as const;

  // The overlay stages beside the subtree and swaps with rename, which replaces the link entry and never
  // follows it; its sweeps and the mode pass look at the entry with lstat. Nothing is written through.
  it.each(OVERLAY_ROWS)('without a shadow, $name that is a link: the overlay writes nothing through it', async (row) => {
    await install(false);
    const entry = path.join(installedRefs(), row.rel);
    const outside = path.join(tmp, 'outside-overlay');
    if (row.kind === 'dir') {
      await fs.rename(entry, outside);
      await fs.symlink(outside, entry, 'dir');
      await fs.writeFile(path.join(outside, 'setup-task.md'), USER_BYTES, 'utf-8');
      await fs.chmod(path.join(outside, 'setup-task.md'), 0o600);
    } else {
      await fs.writeFile(outside, USER_BYTES, 'utf-8');
      await fs.chmod(outside, 0o600);
      await fs.rm(entry);
      await fs.symlink(outside, entry, 'file');
    }
    const before = await snapshot(outside);

    const report = await install(false);

    expect(await snapshot(outside), 'no byte, mode, file or folder at the target changed').toEqual(before);
    expect(report.overlayFailures).toEqual([]);
    expect((await fs.lstat(entry)).isSymbolicLink(), 'a real entry stands in the place of the link').toBe(false);
  });
});

// The full install's pre-clean removes a link at a path that a later step writes: the overlay writes
// `references/pr`, and the tracker converge that init runs after the install writes the tracker agent.
// The summary says a real file or folder stands where the link stood, so a link is reported only once
// that later write has put one there.
describe('a link at a path that a later step writes is reported only once a real entry stands there', () => {
  const trackerAgent = (): string => path.join(claudeDir, 'agents', 'devflow', 'tracker.md');
  const prDir = (): string => path.join(installedRefs(), 'pr');

  /** Replace what a first install wrote at `entry` by a link to a place that holds a 0600 file of the user's. */
  async function linkToUserPlace(entry: string, kind: 'file' | 'dir'): Promise<string> {
    const outside = path.join(tmp, 'outside-later');
    if (kind === 'file') {
      await fs.writeFile(outside, USER_BYTES, 'utf-8');
      await fs.chmod(outside, 0o600);
      await fs.rm(entry, { force: true });
    } else {
      await fs.rename(entry, outside);
      await fs.writeFile(path.join(outside, 'mine.md'), USER_BYTES, 'utf-8');
      await fs.chmod(path.join(outside, 'mine.md'), 0o600);
    }
    await fs.symlink(outside, entry, kind);
    return outside;
  }

  /** Refuse every rename onto `entry`, as a write that fails after the install would. */
  async function withRefusedRename<T>(entry: string, run: () => Promise<T>): Promise<T> {
    const realRename = fs.rename.bind(fs);
    const rename = vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      if (String(to) === entry) throw Object.assign(new Error('operation not permitted'), { code: 'EPERM' });
      return realRename(from, to);
    });
    try {
      return await run();
    } finally {
      rename.mockRestore();
    }
  }

  it('the tracker agent link: the install leaves it for the converge, which replaces it and reports it', async () => {
    await install(false);
    const outside = await linkToUserPlace(trackerAgent(), 'file');
    const before = await snapshot(outside);

    const installed = await install(false);

    expect(installed.replacedLinks, 'the install wrote no real file there, so it reports no replacement').toEqual([]);
    expect(await snapshot(outside)).toEqual(before);

    const converged = await convergeTrackerArtifacts({ claudeDir, warn });

    expect(converged.converged, warnings.join('\n')).toBe(true);
    expect(await snapshot(outside), 'no byte or mode at the target changed').toEqual(before);
    const stat = await fs.lstat(trackerAgent());
    expect(stat.isSymbolicLink(), 'the link is gone').toBe(false);
    expect(stat.isFile(), 'a real file stands in its place').toBe(true);
    const lines = formatReplacedLinksSummary(mergeLinkReports(installed, converged));
    expect(lines).toHaveLength(1);
    expect(lines[0].message).toContain(trackerAgent());
  });

  it('the tracker agent link, with a converge that cannot write: nothing is reported as replaced, and the link is as it was', async () => {
    await install(false);
    const outside = await linkToUserPlace(trackerAgent(), 'file');
    const before = await snapshot(outside);

    const installed = await install(false);
    const converged = await withRefusedRename(trackerAgent(), () => convergeTrackerArtifacts({ claudeDir, warn }));

    expect(converged.converged, 'precondition: the converge could not write').toBe(false);
    expect(await snapshot(outside)).toEqual(before);
    expect((await fs.lstat(trackerAgent())).isSymbolicLink(), 'no real file stands there').toBe(true);
    expect(formatReplacedLinksSummary(mergeLinkReports(installed, converged)), 'no line says a real file stands there').toEqual([]);
  });

  it('the pr folder link: the overlay writes a real folder, and the install reports the replacement', async () => {
    await install(false);
    const outside = await linkToUserPlace(prDir(), 'dir');
    const before = await snapshot(outside);

    const report = await install(false);

    expect(await snapshot(outside), 'no byte, mode, file or folder at the target changed').toEqual(before);
    const stat = await fs.lstat(prDir());
    expect(stat.isSymbolicLink(), 'the link is gone').toBe(false);
    expect(stat.isDirectory(), 'a real folder stands in its place').toBe(true);
    expect(report.overlayFailures).toEqual([]);
    expect(report.replacedLinks).toEqual([prDir()]);
  });

  it('the pr folder link, with an overlay that cannot write it: nothing is reported as replaced, and the failure is', async () => {
    await install(false);
    const outside = await linkToUserPlace(prDir(), 'dir');
    const before = await snapshot(outside);

    const report = await withRefusedRename(prDir(), () => install(false));

    expect(report.overlayFailures.map(failure => failure.unit.kind), 'the failed unit is reported').toContain('pr-host');
    expect(await snapshot(outside)).toEqual(before);
    expect(await exists(prDir()), 'no real folder stands there').toBe(false);
    expect(report.replacedLinks, 'no replacement is claimed for a path with nothing written').toEqual([]);
    expect(formatReplacedLinksSummary(report)).toEqual([]);
  });
});

describe('the legacy sweep that follows an install skips a devflow folder that is a link', () => {
  const SWEEP_ROWS = [
    { name: 'a legacy command', folder: ['commands', 'devflow'], file: 'review.md' },
    { name: 'an orphaned *-teams.md command', folder: ['commands', 'devflow'], file: 'specify-teams.md' },
    { name: 'a legacy rule', folder: ['rules', 'devflow'], file: 'old-rule.md' },
  ] as const;
  const LEGACY_RULES = ['old-rule'];
  const CASES = SWEEP_ROWS.flatMap(row => [
    { ...row, listed: true, label: `${row.name}, the install listed the folder as refused` },
    { ...row, listed: false, label: `${row.name}, the install did not list the folder` },
  ]);

  async function linkFolderWithLegacyFile(folder: string, file: string): Promise<string> {
    const outside = path.join(tmp, 'outside-folder');
    await fs.rename(folder, outside);
    await fs.symlink(outside, folder, 'dir');
    await fs.writeFile(path.join(outside, file), USER_BYTES, 'utf-8');
    await fs.chmod(path.join(outside, file), 0o600);
    return outside;
  }

  it.each(CASES)('$label: the file below the link is not removed', async (row) => {
    await install(false);
    const folder = path.join(claudeDir, ...row.folder);
    const outside = await linkFolderWithLegacyFile(folder, row.file);
    const before = await snapshot(outside);
    const installReport = await install(true);
    expect(installReport.refusedFolders, 'precondition: the partial install refused the linked folder').toEqual([folder]);
    const report = { refusedFolders: row.listed ? installReport.refusedFolders : [] };

    const swept = await sweepLegacyDevflowFiles({ claudeDir, report, legacyRules: LEGACY_RULES });

    expect(await snapshot(outside), 'no file, folder or mode below the link changed').toEqual(before);
    expect(swept).toEqual({ staleCommandsRemoved: 0, staleRulesRemoved: 0 });
    expect((await fs.lstat(folder)).isSymbolicLink(), 'the link is left in place').toBe(true);
  });

  it('over real folders the sweep removes the legacy files and counts them', async () => {
    await install(false);
    for (const row of SWEEP_ROWS) await fs.writeFile(path.join(claudeDir, ...row.folder, row.file), 'stale\n', 'utf-8');

    const swept = await sweepLegacyDevflowFiles({ claudeDir, report: { refusedFolders: [] }, legacyRules: LEGACY_RULES });

    expect(swept).toEqual({ staleCommandsRemoved: 2, staleRulesRemoved: 1 });
    for (const row of SWEEP_ROWS) expect(await exists(path.join(claudeDir, ...row.folder, row.file)), row.name).toBe(false);
  });
});

describe('clearLinkedEntry answers for the entry itself, with lstat', () => {
  it.each([
    ['nothing', async (entry: string) => { void entry; }, 'clear'],
    ['a file', async (entry: string) => { await fs.writeFile(entry, 'x', 'utf-8'); }, 'clear'],
    ['a folder', async (entry: string) => { await fs.mkdir(entry); }, 'clear'],
    ['a link to a file', async (entry: string) => { await fs.writeFile(`${entry}.target`, 'x', 'utf-8'); await fs.symlink(`${entry}.target`, entry, 'file'); }, 'replaced'],
    ['a link to a folder', async (entry: string) => { await fs.mkdir(`${entry}.target`); await fs.symlink(`${entry}.target`, entry, 'dir'); }, 'replaced'],
    ['a link to nothing', async (entry: string) => { await fs.symlink(`${entry}.missing`, entry, 'file'); }, 'replaced'],
  ] as const)('%s', async (_name, plant, expected) => {
    const entry = path.join(tmp, 'entry');
    await plant(entry);
    const hadTarget = await exists(`${entry}.target`);

    expect(await clearLinkedEntry(entry)).toBe(expected);

    expect((await fs.lstat(entry).catch(() => null))?.isSymbolicLink() ?? false, 'no link stands there after').toBe(false);
    if (hadTarget) expect(await exists(`${entry}.target`), 'what the link pointed to is left').toBe(true);
  });

  it('a link that cannot be removed is refused and left in place', async () => {
    const entry = path.join(tmp, 'entry');
    await fs.writeFile(`${entry}.target`, 'x', 'utf-8');
    await fs.symlink(`${entry}.target`, entry, 'file');

    expect(await withStuckLink(entry, () => clearLinkedEntry(entry))).toBe('refused');

    expect((await fs.lstat(entry)).isSymbolicLink()).toBe(true);
  });

  it('an entry below a file cannot be inspected, so it is refused', async () => {
    await fs.writeFile(path.join(tmp, 'a-file'), 'x', 'utf-8');

    expect(await clearLinkedEntry(path.join(tmp, 'a-file', 'below'))).toBe('refused');
  });
});
