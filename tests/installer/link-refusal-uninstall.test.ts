/**
 * `uninstall --plugin` never reads, writes or removes through a link at or below the Devflow
 * folders: `commands/devflow`, `agents/devflow`, `rules/devflow`, the `skills/devflow:*` folders
 * and everything below them.
 *
 * Every row plants a link where the uninstall acts, points it at a scratch place outside the
 * Claude directory that holds the files the plugin owns, a stray file and a 0600 file the user
 * keeps, runs the uninstall at function level, and proves that the place outside keeps every
 * byte, file, folder and mode. A linked folder stays a link and is listed in `refusedFolders`.
 * A link to a file is removed as a link. Nothing reads or writes the real HOME.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as p from '@clack/prompts';

import {
  formatUninstallRefusedSummary,
  refreshRetainedCommandsAndAgents,
  removeSelectedPlugins,
  runFullPhaseForScope,
  runSelectivePhaseForScope,
  sweepDevflowNamespaces,
} from '../../src/cli/commands/uninstall.js';
import { restampInstalledCommands } from '../../src/targets/claude-code/language-stamp.js';
import { DEVFLOW_PLUGINS, type PluginDefinition } from '../../src/core/plugins.js';
import { assertTempHome } from '../setup/home-isolation.js';

const USER_BYTES = 'a file only the user keeps\n';
const OWNED_BYTES = '# a file the plugin owns\n';
const STRAY_BYTES = '# a file the registry does not know\n';

let tmp: string;
let claudeDir: string;
let devflowDir: string;
let outside: string;
let warned: string[];
let spies: Array<{ mockRestore: () => void }>;

function pluginNamed(name: string): PluginDefinition {
  const found = DEVFLOW_PLUGINS.filter(plugin => plugin.name === name);
  expect(found, `the registry holds ${name} once`).toHaveLength(1);
  return found[0];
}

const BUG_ANALYSIS = (): PluginDefinition => pluginNamed('devflow-bug-analysis');
const TYPESCRIPT = (): PluginDefinition => pluginNamed('devflow-typescript');

/** Every entry at or below `full` as relative path -> kind, mode and bytes (a link: its target). */
async function snapshot(full: string, rel = '.'): Promise<Record<string, string>> {
  const stat = await fs.lstat(full);
  const mode = (stat.mode & 0o777).toString(8);
  if (stat.isSymbolicLink()) return { [rel]: `link:${await fs.readlink(full)}` };
  if (!stat.isDirectory()) return { [rel]: `file:${mode}:${(await fs.readFile(full)).toString('base64')}` };
  const out: Record<string, string> = { [`${rel}/`]: `dir:${mode}` };
  for (const name of (await fs.readdir(full)).sort()) Object.assign(out, await snapshot(path.join(full, name), `${rel}/${name}`));
  return out;
}

const exists = (file: string): Promise<boolean> => fs.lstat(file).then(() => true, () => false);
const isLink = (file: string): Promise<boolean> => fs.lstat(file).then(stat => stat.isSymbolicLink(), () => false);

beforeEach(async () => {
  tmp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-link-uninstall-')));
  expect(() => assertTempHome(tmp)).not.toThrow();
  claudeDir = path.join(tmp, 'claude');
  devflowDir = path.join(tmp, 'devflow');
  outside = path.join(tmp, 'outside');
  warned = [];
  await fs.mkdir(claudeDir, { recursive: true });
  await fs.mkdir(devflowDir, { recursive: true });
  spies = [
    vi.spyOn(p.log, 'warn').mockImplementation((msg: string) => { warned.push(String(msg)); }),
    vi.spyOn(p.log, 'info').mockImplementation(() => undefined),
    vi.spyOn(p.log, 'success').mockImplementation(() => undefined),
    vi.spyOn(p.log, 'step').mockImplementation(() => undefined),
  ];
});

afterEach(async () => {
  for (const spy of spies) spy.mockRestore();
  await fs.rm(tmp, { recursive: true, force: true });
});

/** A Devflow folder that an uninstall of one plugin acts in, and the file names the plugin owns there. */
interface FolderRow {
  readonly name: string;
  readonly plugin: () => PluginDefinition;
  readonly segments: readonly string[];
  /** The files the uninstall removes by name. */
  readonly owned: readonly string[];
}

const FOLDER_ROWS: readonly FolderRow[] = [
  { name: 'commands/devflow', plugin: BUG_ANALYSIS, segments: ['commands', 'devflow'], owned: ['bug-analysis.md'] },
  { name: 'agents/devflow', plugin: BUG_ANALYSIS, segments: ['agents', 'devflow'], owned: ['debug.md'] },
  { name: 'rules/devflow', plugin: TYPESCRIPT, segments: ['rules', 'devflow'], owned: ['typescript.md'] },
  { name: 'a skills/devflow:* folder', plugin: TYPESCRIPT, segments: ['skills', 'devflow:typescript'], owned: ['SKILL.md'] },
];

const folderPath = (row: FolderRow): string => path.join(claudeDir, ...row.segments);

/** A scratch folder outside the Claude directory holding what the plugin owns, a stray file and a 0600 file. */
async function plantOutsideFolder(row: FolderRow): Promise<Record<string, string>> {
  await fs.mkdir(outside, { recursive: true });
  for (const name of row.owned) await fs.writeFile(path.join(outside, name), OWNED_BYTES, 'utf-8');
  await fs.writeFile(path.join(outside, 'stray.md'), STRAY_BYTES, 'utf-8');
  await fs.writeFile(path.join(outside, 'private.md'), USER_BYTES, 'utf-8');
  await fs.chmod(path.join(outside, 'private.md'), 0o600);
  return snapshot(outside);
}

/** Link the Devflow folder of `row` to the scratch folder. */
async function linkFolder(row: FolderRow): Promise<Record<string, string>> {
  const before = await plantOutsideFolder(row);
  await fs.mkdir(path.dirname(folderPath(row)), { recursive: true });
  await fs.symlink(outside, folderPath(row), 'dir');
  return before;
}

function selective(plugin: PluginDefinition): ReturnType<typeof runSelectivePhaseForScope> {
  return runSelectivePhaseForScope({ claudeDir, devflowDir, selectedPlugins: [plugin], verbose: false, scope: 'user' });
}

describe('uninstall --plugin refuses a linked Devflow folder and removes nothing through it', () => {
  it.each(FOLDER_ROWS)('a linked $name: the target keeps every byte, file and mode, the link stays, and the refusal is reported', async (row) => {
    const before = await linkFolder(row);

    const report = await selective(row.plugin());

    expect(await snapshot(outside), 'no byte, mode, file or folder at the target changed').toEqual(before);
    expect(await isLink(folderPath(row)), 'the link is left in place').toBe(true);
    expect(await fs.readlink(folderPath(row))).toBe(outside);
    expect(report.refusedFolders, 'the refusal is reported once').toEqual([folderPath(row)]);
    expect(report.replacedLinks).toEqual([]);
    const printed = warned.filter(line => line.includes(folderPath(row)));
    expect(printed, 'the printed summary names the link once').toHaveLength(1);
    expect(printed[0]).toContain('Devflow removed and changed nothing there');
  });

  it.each(FOLDER_ROWS)('a linked $name reached by removeSelectedPlugins with no guard given: the target keeps every byte and mode', async (row) => {
    const before = await linkFolder(row);

    await removeSelectedPlugins(claudeDir, [row.plugin()], false);

    expect(await snapshot(outside)).toEqual(before);
    expect(await isLink(folderPath(row))).toBe(true);
  });

  it.each(FOLDER_ROWS.filter(row => row.segments[0] !== 'rules' && row.segments[0] !== 'skills'))(
    'a linked $name reached by sweepDevflowNamespaces with no guard given: the stray file stays',
    async (row) => {
      const before = await linkFolder(row);

      await sweepDevflowNamespaces(claudeDir, false);

      expect(await snapshot(outside)).toEqual(before);
      expect(await isLink(folderPath(row))).toBe(true);
    },
  );

  it.each(FOLDER_ROWS.filter(row => row.segments[0] === 'commands' || row.segments[0] === 'agents'))(
    'a linked $name reached by sweepDevflowNamespaces with a guard that passes everything: the stray file stays, and the refusal is reported',
    async (row) => {
      const before = await linkFolder(row);
      const links = { replacedLinks: [] as string[], refusedFolders: [] as string[] };

      await sweepDevflowNamespaces(claudeDir, false, async () => true, links);

      expect(await snapshot(outside)).toEqual(before);
      expect(await isLink(folderPath(row))).toBe(true);
      expect(links.refusedFolders).toEqual([folderPath(row)]);
    },
  );

  it('a linked orphan skill folder is left in place, reported, and its target keeps every byte and mode', async () => {
    const orphan = path.join(claudeDir, 'skills', 'devflow:retired-skill');
    await fs.mkdir(outside, { recursive: true });
    await fs.writeFile(path.join(outside, 'SKILL.md'), OWNED_BYTES, 'utf-8');
    await fs.writeFile(path.join(outside, 'private.md'), USER_BYTES, 'utf-8');
    await fs.chmod(path.join(outside, 'private.md'), 0o600);
    const before = await snapshot(outside);
    await fs.mkdir(path.dirname(orphan), { recursive: true });
    await fs.symlink(outside, orphan, 'dir');

    const report = await selective(BUG_ANALYSIS());

    expect(await snapshot(outside)).toEqual(before);
    expect(await isLink(orphan), 'the link is left in place').toBe(true);
    expect(report.refusedFolders).toEqual([orphan]);
  });

  it('a not-a-folder entry where a Devflow folder belongs is refused and reported, and its bytes stay', async () => {
    await fs.mkdir(path.join(claudeDir, 'commands'), { recursive: true });
    const entry = path.join(claudeDir, 'commands', 'devflow');
    await fs.writeFile(entry, USER_BYTES, 'utf-8');
    await fs.chmod(entry, 0o600);
    const before = await snapshot(entry);

    const report = await selective(BUG_ANALYSIS());

    expect(await snapshot(entry)).toEqual(before);
    expect(report.refusedFolders).toEqual([entry]);
  });

  it('a link in agents/devflow does not stop the other folders: a real commands/devflow is still cleaned', async () => {
    const agents = FOLDER_ROWS[1];
    const before = await linkFolder(agents);
    const commands = path.join(claudeDir, 'commands', 'devflow');
    await fs.mkdir(commands, { recursive: true });
    await fs.writeFile(path.join(commands, 'bug-analysis.md'), OWNED_BYTES, 'utf-8');

    const report = await selective(BUG_ANALYSIS());

    expect(await snapshot(outside)).toEqual(before);
    expect(await exists(path.join(commands, 'bug-analysis.md')), 'non-vacuity: the real folder was cleaned').toBe(false);
    expect(report.refusedFolders).toEqual([folderPath(agents)]);
  });
});

describe('uninstall --plugin removes a link to a file as a link and leaves its target whole', () => {
  const FILE_ROWS = [
    { name: 'a command file in commands/devflow', plugin: BUG_ANALYSIS, segments: ['commands', 'devflow', 'bug-analysis.md'] },
    { name: 'an agent file in agents/devflow', plugin: BUG_ANALYSIS, segments: ['agents', 'devflow', 'debug.md'] },
    { name: 'a rule file in rules/devflow', plugin: TYPESCRIPT, segments: ['rules', 'devflow', 'typescript.md'] },
  ] as const;

  it.each(FILE_ROWS)('$name that is a link: the link is gone, the target keeps its bytes and mode, and nothing is refused', async (row) => {
    const target = path.join(tmp, 'outside-file');
    await fs.writeFile(target, USER_BYTES, 'utf-8');
    await fs.chmod(target, 0o600);
    const before = await snapshot(target);
    const entry = path.join(claudeDir, ...row.segments);
    await fs.mkdir(path.dirname(entry), { recursive: true });
    await fs.symlink(target, entry, 'file');

    const report = await selective(row.plugin());

    expect(await snapshot(target), 'the file the link led to').toEqual(before);
    expect(await exists(entry), 'the link was removed').toBe(false);
    expect(report.refusedFolders).toEqual([]);
    expect(warned).toEqual([]);
  });
});

describe('uninstall --plugin over real folders', () => {
  it('removes the files the plugin owns and the stray command, and reports no link', async () => {
    const rows = [FOLDER_ROWS[0], FOLDER_ROWS[1]];
    for (const row of rows) {
      await fs.mkdir(folderPath(row), { recursive: true });
      for (const name of row.owned) await fs.writeFile(path.join(folderPath(row), name), OWNED_BYTES, 'utf-8');
    }
    // A stray agent file would start the rewrite for a retired agent, which has its own tests.
    const stray = path.join(folderPath(rows[0]), 'stray.md');
    await fs.writeFile(stray, STRAY_BYTES, 'utf-8');
    const kept = path.join(claudeDir, 'commands', 'devflow', 'implement.md');
    await fs.writeFile(kept, OWNED_BYTES, 'utf-8');

    const report = await selective(BUG_ANALYSIS());

    for (const row of rows) {
      for (const name of row.owned) expect(await exists(path.join(folderPath(row), name)), `${name} of the plugin`).toBe(false);
    }
    expect(await exists(stray), 'the stray command left the registry').toBe(false);
    expect(await fs.readFile(kept, 'utf-8'), 'a command of a plugin that stays').toBe(OWNED_BYTES);
    expect(report).toEqual({ replacedLinks: [], refusedFolders: [] });
    expect(warned).toEqual([]);
  });

  it('removes the rule file and the skill folder of the plugin', async () => {
    const rule = path.join(claudeDir, 'rules', 'devflow', 'typescript.md');
    const skill = path.join(claudeDir, 'skills', 'devflow:typescript');
    await fs.mkdir(path.dirname(rule), { recursive: true });
    await fs.writeFile(rule, OWNED_BYTES, 'utf-8');
    await fs.mkdir(skill, { recursive: true });
    await fs.writeFile(path.join(skill, 'SKILL.md'), OWNED_BYTES, 'utf-8');

    const report = await selective(TYPESCRIPT());

    expect(await exists(rule)).toBe(false);
    expect(await exists(skill)).toBe(false);
    expect(report).toEqual({ replacedLinks: [], refusedFolders: [] });
  });
});

describe('the language stamp is rewritten in no linked folder', () => {
  const STAMPED = 'Installed language focuses: typescript\n';

  it('a linked commands/devflow with no guard given: the stamped file the link leads to keeps its bytes and mode', async () => {
    await fs.mkdir(outside, { recursive: true });
    await fs.writeFile(path.join(outside, 'code-review.md'), STAMPED, 'utf-8');
    await fs.chmod(path.join(outside, 'code-review.md'), 0o600);
    const before = await snapshot(outside);
    await fs.mkdir(path.join(claudeDir, 'commands'), { recursive: true });
    await fs.symlink(outside, path.join(claudeDir, 'commands', 'devflow'), 'dir');

    const result = await restampInstalledCommands({ claudeDir, effectivePlugins: [], warn: msg => warned.push(msg) });

    expect(await snapshot(outside)).toEqual(before);
    expect(result.rewritten).toEqual([]);
    expect(result.failed).toEqual(['code-review']);
  });

  it('over a real commands/devflow the same stamp is rewritten', async () => {
    const commands = path.join(claudeDir, 'commands', 'devflow');
    await fs.mkdir(commands, { recursive: true });
    await fs.writeFile(path.join(commands, 'code-review.md'), STAMPED, 'utf-8');

    const result = await restampInstalledCommands({ claudeDir, effectivePlugins: [], warn: msg => warned.push(msg) });

    expect(result.rewritten).toEqual(['code-review']);
    expect(await fs.readFile(path.join(commands, 'code-review.md'), 'utf-8')).toBe('Installed language focuses: (none)\n');
  });
});

describe('the rewrite after a retired agent was removed writes nothing through a link', () => {
  const RETIRED = 'code-fix';
  const OLD_TEXT = '# command text from the older release\n';

  async function writeManifest(): Promise<void> {
    await fs.writeFile(path.join(devflowDir, 'manifest.json'), JSON.stringify({
      version: '3.5.0',
      plugins: ['devflow-implement'],
      scope: 'user',
      features: { ambient: false, memory: false },
      installedAt: 'x',
      updatedAt: 'x',
    }), 'utf-8');
  }

  const refresh = (links: { replacedLinks: string[]; refusedFolders: string[] }): Promise<void> =>
    refreshRetainedCommandsAndAgents({
      claudeDir,
      devflowDir,
      retained: [pluginNamed('devflow-implement')],
      retiredAgents: [RETIRED],
      links,
    });

  it.each([
    { name: 'commands/devflow', segments: ['commands', 'devflow'], owned: ['implement.md'] },
    { name: 'agents/devflow', segments: ['agents', 'devflow'], owned: ['fix.md'] },
  ])('a linked $name with no guard given: the target keeps every byte and mode, nothing is written in the other folder, and the refusal is reported', async ({ segments, owned }) => {
    await writeManifest();
    const row: FolderRow = { name: segments.join('/'), plugin: BUG_ANALYSIS, segments, owned };
    const before = await linkFolder(row);
    const links = { replacedLinks: [] as string[], refusedFolders: [] as string[] };

    await refresh(links);

    expect(await snapshot(outside)).toEqual(before);
    expect(await isLink(folderPath(row))).toBe(true);
    expect(links.refusedFolders).toEqual([folderPath(row)]);
    const other = segments[0] === 'commands' ? 'agents' : 'commands';
    expect(await exists(path.join(claudeDir, other, 'devflow')), 'nothing was written in the other folder').toBe(false);
    expect(warned.filter(line => line.includes(RETIRED))).toHaveLength(1);
  });

  it('a command file that is a link is replaced by a real file, reported, and its target keeps its bytes and mode', async () => {
    await writeManifest();
    const commands = path.join(claudeDir, 'commands', 'devflow');
    await fs.mkdir(commands, { recursive: true });
    const target = path.join(tmp, 'outside-file');
    await fs.writeFile(target, OLD_TEXT, 'utf-8');
    await fs.chmod(target, 0o600);
    const before = await snapshot(target);
    await fs.symlink(target, path.join(commands, 'implement.md'), 'file');
    const links = { replacedLinks: [] as string[], refusedFolders: [] as string[] };

    await refresh(links);

    expect(await snapshot(target)).toEqual(before);
    const stat = await fs.lstat(path.join(commands, 'implement.md'));
    expect(stat.isSymbolicLink(), 'the link is gone').toBe(false);
    expect(stat.isFile(), 'a real file stands in its place').toBe(true);
    expect(links.replacedLinks).toEqual([path.join(commands, 'implement.md')]);
  });
});

describe('a full uninstall removes a linked Devflow folder as a link and leaves its target whole', () => {
  it.each(FOLDER_ROWS.filter(row => row.segments[0] === 'commands' || row.segments[0] === 'rules'))(
    'a linked $name: the link is removed and the target keeps every byte and mode',
    async (row) => {
      const before = await linkFolder(row);

      await runFullPhaseForScope({
        scope: 'user',
        claudeDir,
        devflowDir,
        devflowScriptsDir: path.join(devflowDir, 'scripts'),
        verbose: false,
        keepDocs: true,
        isTTY: false,
      });

      expect(await snapshot(outside)).toEqual(before);
      expect(await exists(folderPath(row)), 'the link was removed').toBe(false);
    },
  );

  it('a linked agents/devflow: no agent file the link leads to is rewritten, and the link is removed', async () => {
    const row = FOLDER_ROWS[1];
    await fs.mkdir(outside, { recursive: true });
    const agent = path.join(outside, 'code.md');
    await fs.writeFile(agent, '---\nname: Code\nmodel: gpt-5.2\n---\n# code\n', 'utf-8');
    await fs.chmod(agent, 0o600);
    const before = await snapshot(outside);
    await fs.mkdir(path.dirname(folderPath(row)), { recursive: true });
    await fs.symlink(outside, folderPath(row), 'dir');

    await runFullPhaseForScope({
      scope: 'user',
      claudeDir,
      devflowDir,
      devflowScriptsDir: path.join(devflowDir, 'scripts'),
      verbose: false,
      keepDocs: true,
      isTTY: false,
    });

    expect(await snapshot(outside), 'the agent file keeps its model line').toEqual(before);
    expect(await exists(folderPath(row)), 'the link was removed').toBe(false);
  });
});

describe('the uninstall report for a refused folder', () => {
  it('names each folder in short sentences and says what to do', () => {
    const lines = formatUninstallRefusedSummary({ refusedFolders: ['/a/commands/devflow', '/a/rules/devflow'] });

    expect(lines.map(line => line.level)).toEqual(['warn', 'warn']);
    expect(lines[0].message).toContain('/a/commands/devflow');
    expect(lines[1].message).toContain('/a/rules/devflow');
    expect(lines[0].message).toContain('Devflow removed and changed nothing there');
    expect(lines[0].message).toContain('run the uninstall again');
  });

  it('prints nothing when no folder was refused', () => {
    expect(formatUninstallRefusedSummary({ refusedFolders: [] })).toEqual([]);
  });
});
