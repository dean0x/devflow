/**
 * What `installViaFileCopy` does with a file it did not ship, on a full install and on a partial
 * one: the file moves to the backup folder at the same relative path with the same bytes, the
 * report names both paths, and a file devflow shipped in an earlier release is removed and named
 * instead. Every test works in a temp home, with the clock and the random bytes injected through
 * the backup session, and nothing here reads or writes the real home.
 */
import { promises as fs } from 'fs';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { sweepLegacyDevflowFiles, sweepLegacySkillFolders } from '../../src/cli/commands/legacy-sweep.js';
import { formatBackupSummary } from '../../src/cli/commands/install-report.js';
import { RETIRED_SHIPPED } from '../../src/core/retired-shipped-names.js';
import { createBackupSession, createPathSet, type BackupSession } from '../../src/targets/claude-code/install-backup.js';
import { LEGACY_SKILL_NAMES } from '../../src/targets/claude-code/legacy.js';
import { FIXTURE_FOLDER } from '../fixtures/workflow-folder.js';
import { testBackups } from '../helpers.js';
import { assertTempHome } from '../setup/home-isolation.js';
import {
  DEFAULT_PLUGINS,
  at,
  backupRootOf,
  exists,
  filesBelow,
  firstPrefixedLegacyName,
  makeHome,
  onlyRunFolder,
  openSession,
  put,
  removeHome,
  runInstall,
  type TestHome,
  USER_SKILL_FOLDER,
} from './install-backup-harness.js';

let home: TestHome;

beforeEach(async () => {
  home = await makeHome();
  assertTempHome(home.home);
  console.log(`install-backup-install test home: ${await fs.realpath(home.home)}`);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await removeHome(home);
});

const inRun = (run: string, rel: string): string => path.join(run, ...rel.split('/'));
const movedOriginals = (report: { backups: { moved: readonly { original: string }[] } }): string[] =>
  report.backups.moved.map(unit => unit.original);

/** A command name another plugin than code-review ships, with the plugin that owns it. */
function otherPluginCommand(): string {
  for (const plugin of DEFAULT_PLUGINS) {
    if (plugin.name === 'devflow-code-review') continue;
    const [first] = plugin.commands;
    if (first !== undefined) return first.startsWith('/') ? first.slice(1) : first;
  }
  throw new Error('no other plugin ships a command');
}

describe('a full install moves what devflow did not ship', () => {
  const PLANTED: Readonly<Record<string, string>> = {
    'commands/devflow/mine-command.md': 'my command\n',
    'rules/devflow/mine-rule.md': 'my rule\n',
    'agents/devflow/mine-agent.md': 'my agent\n',
    'skills/devflow:agent-references/mine-notes.md': 'my notes in a shipped skill\n',
    'skills/devflow:git/references/mine-reference.md': 'my reference at the references root\n',
  };

  it('keeps a file from commands, rules, agents, a shipped skill and the references root, byte for byte', async () => {
    await runInstall(home, { shape: 'full' });
    expect(backupRootOf(home), 'a clean first install makes no backup folder').toBeNull();
    for (const [rel, text] of Object.entries(PLANTED)) await put(home, rel, text);

    const report = await runInstall(home, { shape: 'full' });

    const run = await onlyRunFolder(home);
    for (const [rel, text] of Object.entries(PLANTED)) {
      expect(await exists(at(home, rel)), `${rel} left its folder`).toBe(false);
      expect(await fs.readFile(inRun(run, rel), 'utf8'), `${rel} kept its bytes`).toBe(text);
    }
    expect(movedOriginals(report).sort()).toEqual(Object.keys(PLANTED).map(rel => at(home, rel)).sort());
    expect(report.backups.failures).toEqual([]);
    expect(report.backups.runFolder).toBe(run);
  });

  it('names the original and the backup path of every moved file in the summary', async () => {
    await runInstall(home, { shape: 'full' });
    await put(home, 'commands/devflow/mine-command.md');
    await put(home, 'agents/devflow/mine-agent.md');

    const report = await runInstall(home, { shape: 'full' });

    const run = await onlyRunFolder(home);
    const message = formatBackupSummary(report.backups).map(line => line.message).join('\n');
    expect(message).toContain(`${at(home, 'commands/devflow/mine-command.md')} -> ${inRun(run, 'commands/devflow/mine-command.md')}`);
    expect(message).toContain(`${at(home, 'agents/devflow/mine-agent.md')} -> ${inRun(run, 'agents/devflow/mine-agent.md')}`);
    expect(message).toContain(`Backup folder: ${run}`);
  });

  it('moves a user folder in a references subtree whole and keeps its files', async () => {
    await runInstall(home, { shape: 'full' });
    await put(home, 'skills/devflow:git/references/tracker/mine/notes.md', 'my tracker notes\n');
    await put(home, 'skills/devflow:git/references/pr/mine-pr.md', 'my pr note\n');

    const report = await runInstall(home, { shape: 'full' });

    const run = await onlyRunFolder(home);
    expect(await exists(at(home, 'skills/devflow:git/references/tracker/mine'))).toBe(false);
    expect(await exists(at(home, 'skills/devflow:git/references/pr/mine-pr.md'))).toBe(false);
    expect(await fs.readFile(inRun(run, 'skills/devflow:git/references/tracker/mine/notes.md'), 'utf8')).toBe('my tracker notes\n');
    expect(await fs.readFile(inRun(run, 'skills/devflow:git/references/pr/mine-pr.md'), 'utf8')).toBe('my pr note\n');
    expect(report.backups.moved.find(unit => unit.original === at(home, 'skills/devflow:git/references/tracker/mine'))?.kind).toBe('directory');
    expect(report.overlayFailures).toEqual([]);
    expect(report.sweptOrphans.filter(orphan => orphan.kind === 'reference')).toEqual([]);
  });

  it('moves a devflow:* folder outside the registry whole', async () => {
    await runInstall(home, { shape: 'full' });
    const foreign = `skills/devflow:${USER_SKILL_FOLDER}`;
    await put(home, `${foreign}/SKILL.md`, 'my skill\n');
    await put(home, `${foreign}/references/deep.md`, 'deep\n');

    const report = await runInstall(home, { shape: 'full' });

    const run = await onlyRunFolder(home);
    expect(await exists(at(home, foreign))).toBe(false);
    expect(await fs.readFile(inRun(run, `${foreign}/references/deep.md`), 'utf8')).toBe('deep\n');
    expect(movedOriginals(report)).toEqual([at(home, foreign)]);
    expect(report.sweptOrphans.map(orphan => orphan.name)).not.toContain(USER_SKILL_FOLDER);
  });
});

describe('a partial install moves only what its sweeps would remove', () => {
  it('moves an unknown .md from commands and agents, an unknown devflow:* folder and an unknown reference, and names the references/pr file', async () => {
    await runInstall(home, { shape: 'full' });
    const planted: Record<string, string> = {
      'commands/devflow/mine.md': 'my command\n',
      'agents/devflow/mine.md': 'my agent\n',
      [`skills/devflow:${USER_SKILL_FOLDER}/SKILL.md`]: 'my skill\n',
      'skills/devflow:git/references/pr/mine-pr.md': 'my pr note\n',
      'skills/devflow:git/references/tracker/mine/notes.md': 'my tracker notes\n',
    };
    for (const [rel, text] of Object.entries(planted)) await put(home, rel, text);

    const report = await runInstall(home, { shape: 'partial' });

    const run = await onlyRunFolder(home);
    expect(await exists(at(home, 'commands/devflow/mine.md'))).toBe(false);
    expect(await exists(at(home, 'agents/devflow/mine.md'))).toBe(false);
    expect(await exists(at(home, `skills/devflow:${USER_SKILL_FOLDER}`))).toBe(false);
    expect(await exists(at(home, 'skills/devflow:git/references/pr/mine-pr.md'))).toBe(false);
    expect(await exists(at(home, 'skills/devflow:git/references/tracker/mine'))).toBe(false);
    for (const rel of ['commands/devflow/mine.md', 'agents/devflow/mine.md', `skills/devflow:${USER_SKILL_FOLDER}/SKILL.md`, 'skills/devflow:git/references/pr/mine-pr.md', 'skills/devflow:git/references/tracker/mine/notes.md']) {
      expect(await fs.readFile(inRun(run, rel), 'utf8'), rel).toBe(planted[rel]);
    }
    const message = formatBackupSummary(report.backups).map(line => line.message).join('\n');
    expect(message).toContain(`${at(home, 'skills/devflow:git/references/pr/mine-pr.md')} -> ${inRun(run, 'skills/devflow:git/references/pr/mine-pr.md')}`);
  });

  it('leaves a file that is not .md, and a file in a shipped skill folder, where it is', async () => {
    await runInstall(home, { shape: 'full' });
    const note = await put(home, 'commands/devflow/notes.txt', 'a note\n');
    const data = await put(home, 'agents/devflow/data.json', '{}\n');
    const inSkill = await put(home, 'skills/devflow:agent-references/mine-notes.md', 'notes\n');

    const report = await runInstall(home, { shape: 'partial' });

    expect(await fs.readFile(note, 'utf8')).toBe('a note\n');
    expect(await fs.readFile(data, 'utf8')).toBe('{}\n');
    expect(await fs.readFile(inSkill, 'utf8')).toBe('notes\n');
    expect(report.backups.moved).toEqual([]);
    expect(backupRootOf(home)).toBeNull();
  });
});

describe('a partial install moves none of another plugin\'s files', () => {
  it('keeps every command and agent of the plugins that are not named, and makes no backup folder', async () => {
    await runInstall(home, { shape: 'full' });
    const commandsBefore = await filesBelow(at(home, 'commands/devflow'));
    const agentsBefore = await filesBelow(at(home, 'agents/devflow'));
    expect(commandsBefore.length).toBeGreaterThan(1);

    const report = await runInstall(home, { shape: 'partial' });

    expect(await filesBelow(at(home, 'commands/devflow'))).toEqual(commandsBefore);
    expect(await filesBelow(at(home, 'agents/devflow'))).toEqual(agentsBefore);
    expect(report.backups.moved).toEqual([]);
    expect(report.backups.retiredRemoved).toEqual([]);
    expect(backupRootOf(home)).toBeNull();
  });
});

describe('retired and unknown names', () => {
  const retiredCommand = RETIRED_SHIPPED.commands[0];
  const retiredAgent = RETIRED_SHIPPED.agents[0];
  const retiredSkillFile = 'skills/devflow:agent-references/references/learning/maintain.md';

  it('a full install removes and names a retired command, agent and skill file, and moves an unknown .md and an unknown teams-suffixed .md', async () => {
    await runInstall(home, { shape: 'full' });
    await put(home, `commands/devflow/${retiredCommand}.md`);
    await put(home, `agents/devflow/${retiredAgent}.md`);
    await put(home, retiredSkillFile);
    await put(home, 'commands/devflow/mine.md', 'mine\n');
    await put(home, 'commands/devflow/mine-teams.md', 'mine, for teams\n');

    const report = await runInstall(home, { shape: 'full' });

    const run = await onlyRunFolder(home);
    expect([...report.backups.retiredRemoved].sort()).toEqual([
      at(home, `agents/devflow/${retiredAgent}.md`),
      at(home, `commands/devflow/${retiredCommand}.md`),
      at(home, retiredSkillFile),
    ].sort());
    expect(await filesBelow(run)).toEqual(['commands/devflow/mine-teams.md', 'commands/devflow/mine.md']);
    expect(movedOriginals(report).sort()).toEqual([at(home, 'commands/devflow/mine-teams.md'), at(home, 'commands/devflow/mine.md')]);
    const message = formatBackupSummary(report.backups).map(line => line.message).join('\n');
    expect(message).toContain('Removed 3 retired devflow file(s)');
    expect(message).toContain(`${retiredCommand}.md`);
  });

  it('a partial install sweeps a retired command and agent by name, moves the unknown .md files, and names each removed name once', async () => {
    await runInstall(home, { shape: 'full' });
    await put(home, `commands/devflow/${retiredCommand}.md`);
    await put(home, `agents/devflow/${retiredAgent}.md`);
    await put(home, 'commands/devflow/mine.md', 'mine\n');
    await put(home, 'commands/devflow/mine-teams.md', 'mine, for teams\n');

    const report = await runInstall(home, { shape: 'partial' });

    const run = await onlyRunFolder(home);
    expect(await exists(at(home, `commands/devflow/${retiredCommand}.md`))).toBe(false);
    expect(await exists(at(home, `agents/devflow/${retiredAgent}.md`))).toBe(false);
    expect(report.sweptOrphans).toEqual(expect.arrayContaining([
      { kind: 'command', name: retiredCommand },
      { kind: 'agent', name: retiredAgent },
    ]));
    expect(report.backups.retiredRemoved, 'a name a sweep removed is not also named by the session').toEqual([]);
    expect(await filesBelow(run)).toEqual(['commands/devflow/mine-teams.md', 'commands/devflow/mine.md']);
  });
});

describe('the widen signal of a partial install', () => {
  /** Remove a command of a plugin that is not named, so a widened copy restores it and a plain add-one run does not. */
  async function installAndDropOtherCommand(): Promise<string> {
    await runInstall(home, { shape: 'full' });
    const dropped = at(home, `commands/devflow/${otherPluginCommand()}.md`);
    await fs.rm(dropped);
    return dropped;
  }

  it('widens when a retired agent is present, with the pre-pass run first', async () => {
    const dropped = await installAndDropOtherCommand();
    await put(home, `agents/devflow/${RETIRED_SHIPPED.agents[0]}.md`);
    await put(home, 'commands/devflow/mine.md', 'mine\n');

    const report = await runInstall(home, { shape: 'partial' });

    expect(report.sweptOrphans).toContainEqual({ kind: 'agent', name: RETIRED_SHIPPED.agents[0] });
    expect(report.backups.moved.map(unit => unit.original)).toEqual([at(home, 'commands/devflow/mine.md')]);
    expect(await exists(dropped), 'the copy was widened to the plugins that stay installed').toBe(true);
  });

  it('widens when the pre-pass moved an unknown agent out of the agents folder', async () => {
    const dropped = await installAndDropOtherCommand();
    await put(home, 'agents/devflow/mine-agent.md', 'mine\n');

    const report = await runInstall(home, { shape: 'partial' });

    expect(report.sweptOrphans).toEqual([]);
    expect(movedOriginals(report)).toEqual([at(home, 'agents/devflow/mine-agent.md')]);
    expect(await exists(dropped)).toBe(true);
  });

  it('does not widen an ordinary add-one run', async () => {
    const dropped = await installAndDropOtherCommand();
    await put(home, 'commands/devflow/mine.md', 'mine\n');

    await runInstall(home, { shape: 'partial' });

    expect(await exists(dropped), 'a plain add-one run rewrites only the named plugin').toBe(false);
  });
});

describe('junk and dot files', () => {
  it('removes .DS_Store without a word and moves any other dot file, named', async () => {
    await runInstall(home, { shape: 'full' });
    const junk = await put(home, 'commands/devflow/.DS_Store', 'junk');
    const hidden = await put(home, 'commands/devflow/.mine-hidden', 'hidden\n');
    const nested = await put(home, 'skills/devflow:agent-references/.DS_Store', 'junk');

    const report = await runInstall(home, { shape: 'full' });

    const run = await onlyRunFolder(home);
    expect(await exists(junk)).toBe(false);
    expect(await exists(nested)).toBe(false);
    expect(await exists(hidden)).toBe(false);
    expect(await fs.readFile(inRun(run, 'commands/devflow/.mine-hidden'), 'utf8')).toBe('hidden\n');
    expect(movedOriginals(report)).toEqual([hidden]);
    const message = formatBackupSummary(report.backups).map(line => line.message).join('\n');
    expect(message).not.toContain('.DS_Store');
    expect(message).toContain('.mine-hidden');
    expect(await filesBelow(run)).toEqual(['commands/devflow/.mine-hidden']);
  });
});

describe('a user file beside a listed retired file', () => {
  it('moves the user file and removes the retired file in a folder that holds no shipped file', async () => {
    await runInstall(home, { shape: 'full' });
    const folder = 'skills/devflow:agent-references/references/learning';
    expect(await exists(at(home, folder)), 'precondition: the build ships nothing in this folder').toBe(false);
    await put(home, `${folder}/maintain.md`);
    await put(home, `${folder}/mine.md`, 'my learning notes\n');

    const report = await runInstall(home, { shape: 'full' });

    const run = await onlyRunFolder(home);
    expect(await fs.readFile(inRun(run, `${folder}/mine.md`), 'utf8')).toBe('my learning notes\n');
    expect(movedOriginals(report)).toEqual([at(home, `${folder}/mine.md`)]);
    expect(report.backups.retiredRemoved).toEqual([at(home, `${folder}/maintain.md`)]);
    expect(await exists(at(home, folder)), 'the folder is empty and gone').toBe(false);
    const message = formatBackupSummary(report.backups).map(line => line.message).join('\n');
    expect(message).toContain('Removed 1 retired devflow file(s)');
    expect(message).toContain('Moved 1 item(s)');
  });
});

const summaryLines = (session: BackupSession): string[] => formatBackupSummary(session.snapshot()).map(line => line.message);

describe('a file named like a name that no release shipped', () => {
  const NEVER_RELEASED: Readonly<Record<string, string>> = {
    'commands/devflow/review.md': 'my review command\n',
    'commands/devflow/specify-teams.md': 'my teams command\n',
    'agents/devflow/bug-analyzer.md': 'my bug analyzer\n',
    'agents/devflow/designer.md': 'my designer\n',
    'agents/devflow/evaluator.md': 'my evaluator\n',
    'agents/devflow/researcher.md': 'my researcher\n',
    'agents/devflow/tester.md': 'my tester\n',
    'agents/devflow/triager.md': 'my triager\n',
  };

  it.each(['full', 'partial'] as const)(
    'moves each of the eight to the backup folder with its bytes and names it, and no later step removes it (%s install)',
    async shape => {
      await runInstall(home, { shape: 'full' });
      for (const [rel, text] of Object.entries(NEVER_RELEASED)) await put(home, rel, text);
      const session = await openSession(home);

      const report = await runInstall(home, { shape, backups: session });
      const swept = await sweepLegacyDevflowFiles({ claudeDir: home.claudeDir, report, backups: session });

      const run = await onlyRunFolder(home);
      for (const [rel, text] of Object.entries(NEVER_RELEASED)) {
        expect(await exists(at(home, rel)), `${rel} left its folder`).toBe(false);
        expect(await fs.readFile(inRun(run, rel), 'utf8'), `${rel} kept its bytes in the backup folder`).toBe(text);
      }
      expect(swept.removed).toEqual([]);
      expect(session.snapshot().retiredRemoved, 'nothing was called a retired devflow file').toEqual([]);
      expect(session.snapshot().moved.map(unit => unit.original).sort()).toEqual(
        Object.keys(NEVER_RELEASED).map(rel => at(home, rel)).sort(),
      );
      expect(summaryLines(session).join('\n')).not.toContain('retired devflow file');
    },
  );

  it.each(['full', 'partial'] as const)('names tester.md and review.md, each with its backup path (%s install)', async shape => {
    await runInstall(home, { shape: 'full' });
    const named = ['agents/devflow/tester.md', 'commands/devflow/review.md'];
    for (const rel of named) await put(home, rel, NEVER_RELEASED[rel]);
    const session = await openSession(home);

    const report = await runInstall(home, { shape, backups: session });
    await sweepLegacyDevflowFiles({ claudeDir: home.claudeDir, report, backups: session });

    const run = await onlyRunFolder(home);
    const message = summaryLines(session).join('\n');
    for (const rel of named) expect(message, `${rel} is named`).toContain(`${at(home, rel)} -> ${inRun(run, rel)}`);
    expect(message).toContain(`Backup folder: ${run}`);
  });
});

describe('the legacy sweep after an install', () => {
  const NO_REFUSED = { refusedFolders: [] as string[] };

  it('removes every retired command by its exact name, names it, and never moves it', async () => {
    await runInstall(home, { shape: 'full' });
    const planted: string[] = [];
    for (const name of RETIRED_SHIPPED.commands) planted.push(await put(home, `commands/devflow/${name}.md`));
    const session = await openSession(home);

    const swept = await sweepLegacyDevflowFiles({ claudeDir: home.claudeDir, report: NO_REFUSED, backups: session });

    expect([...swept.removed].sort()).toEqual([...planted].sort());
    expect([...session.snapshot().retiredRemoved].sort()).toEqual([...planted].sort());
    expect(session.snapshot().moved).toEqual([]);
    expect(backupRootOf(home), 'a retired file is removed, never copied to the backup folder').toBeNull();
    for (const file of planted) expect(await exists(file), file).toBe(false);
  });

  it('no longer removes a file of the user whose name only ends in -teams.md', async () => {
    await runInstall(home, { shape: 'full' });
    const mine = await put(home, 'commands/devflow/mine-teams.md', 'mine, for teams\n');
    const session = await openSession(home);

    const swept = await sweepLegacyDevflowFiles({ claudeDir: home.claudeDir, report: NO_REFUSED, backups: session });

    expect(swept.removed).toEqual([]);
    expect(await fs.readFile(mine, 'utf8')).toBe('mine, for teams\n');
  });

  it('removes no file whose name only a legacy list holds: review.md and specify-teams.md stay', async () => {
    await runInstall(home, { shape: 'full' });
    const review = await put(home, 'commands/devflow/review.md', 'my review command\n');
    const teams = await put(home, 'commands/devflow/specify-teams.md', 'my teams command\n');
    const session = await openSession(home);

    const swept = await sweepLegacyDevflowFiles({ claudeDir: home.claudeDir, report: NO_REFUSED, backups: session });

    expect(swept.removed).toEqual([]);
    expect(session.snapshot().retiredRemoved).toEqual([]);
    expect(await fs.readFile(review, 'utf8')).toBe('my review command\n');
    expect(await fs.readFile(teams, 'utf8')).toBe('my teams command\n');
  });

  it('names a retired command once when the install and the sweep share a session, and moves the unknown teams-suffixed file', async () => {
    await runInstall(home, { shape: 'full' });
    const retiredCommand = RETIRED_SHIPPED.commands[0];
    const retired = await put(home, `commands/devflow/${retiredCommand}.md`);
    const mine = await put(home, 'commands/devflow/mine-teams.md', 'mine, for teams\n');
    const session = await openSession(home);

    const report = await runInstall(home, { shape: 'full', backups: session });
    const swept = await sweepLegacyDevflowFiles({ claudeDir: home.claudeDir, report, backups: session });

    expect(swept.removed, 'the install removed it first').toEqual([]);
    expect(session.snapshot().retiredRemoved).toEqual([retired]);
    expect(session.snapshot().moved.map(unit => unit.original)).toEqual([mine]);
    expect(report.sweptOrphans.map(orphan => orphan.name)).not.toContain(retiredCommand);
    expect(summaryLines(session).filter(line => line.includes(`${retiredCommand}.md`)), 'the name prints on one line').toHaveLength(1);
  });

  it('names a retired file the install left, and the retired line counts it with the others', async () => {
    await runInstall(home, { shape: 'full' });
    const session = await openSession(home);
    const retired = await put(home, `commands/devflow/${RETIRED_SHIPPED.commands[0]}.md`);
    const swept = await sweepLegacyDevflowFiles({ claudeDir: home.claudeDir, report: NO_REFUSED, backups: session });

    expect(swept.removed).toEqual([retired]);
    expect(summaryLines(session)).toEqual([`Removed 1 retired devflow file(s): ${retired}`]);
  });

  it('skips a folder the session could not scan', async () => {
    await runInstall(home, { shape: 'full' });
    const retired = await put(home, `commands/devflow/${RETIRED_SHIPPED.commands[0]}.md`);
    const session = await testBackups(home.home, { claudeDir: home.claudeDir, devflowDir: home.devflowDir, entryCap: 1 });
    await session.prepass([at(home, 'commands/devflow')]);
    expect(session.isKept(at(home, 'commands/devflow')), 'precondition: the folder is over the cap').toBe(true);

    const swept = await sweepLegacyDevflowFiles({ claudeDir: home.claudeDir, report: NO_REFUSED, backups: session });

    expect(swept.removed).toEqual([]);
    expect(await exists(retired)).toBe(true);
  });

  it('never removes a name that is shipped today', async () => {
    await runInstall(home, { shape: 'full' });
    const shippedName = otherPluginCommand();
    const shippedFile = at(home, `commands/devflow/${shippedName}.md`);
    expect(await exists(shippedFile), 'precondition: the install wrote it').toBe(true);

    const swept = await sweepLegacyDevflowFiles({
      claudeDir: home.claudeDir, report: NO_REFUSED, legacyCommands: [shippedName], backups: await openSession(home),
    });

    expect(swept.removed).toEqual([]);
    expect(await exists(shippedFile)).toBe(true);
  });
});

describe('legacy skill folders', () => {
  const PREFIXED = firstPrefixedLegacyName();
  const sessionWithRetired = (retiredPaths: readonly string[]): BackupSession => createBackupSession({
    shipped: createPathSet([]),
    retired: createPathSet(retiredPaths),
    claudeDir: home.claudeDir,
    devflowDir: home.devflowDir,
    now: () => new Date(Date.UTC(2026, 9, 30, 12, 0, 0)),
    bytes: size => new Uint8Array(size).fill(7),
  });

  it('moves a bare legacy folder that holds a user file whole, by one rename, and names it', async () => {
    await runInstall(home, { shape: 'full' });
    const folder = 'skills/codebase-navigation';
    expect(LEGACY_SKILL_NAMES).toContain('codebase-navigation');
    await put(home, `${folder}/SKILL.md`, 'an old skill\n');
    await put(home, `${folder}/references/deep/mine.md`, 'my notes\n');
    const session = await openSession(home);
    const realRename = fs.rename.bind(fs);
    const renames: string[] = [];
    vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      renames.push(String(from));
      return realRename(from, to);
    });

    await sweepLegacySkillFolders({ claudeDir: home.claudeDir, backups: session, legacySkills: LEGACY_SKILL_NAMES });

    const run = await onlyRunFolder(home);
    expect(renames, 'one rename for the whole folder, and nothing else').toEqual([at(home, folder)]);
    expect(await exists(at(home, folder))).toBe(false);
    expect(await fs.readFile(inRun(run, `${folder}/SKILL.md`), 'utf8')).toBe('an old skill\n');
    expect(await fs.readFile(inRun(run, `${folder}/references/deep/mine.md`), 'utf8')).toBe('my notes\n');
    expect(session.snapshot().moved).toEqual([{ original: at(home, folder), backup: inRun(run, folder), kind: 'directory' }]);
    expect(session.snapshot().retiredRemoved).toEqual([]);
    expect(summaryLines(session).join('\n')).toContain(`${at(home, folder)}/ -> ${inRun(run, folder)}/`);
  });

  it('deletes no bare legacy folder: each one moves aside whole with its file', async () => {
    await runInstall(home, { shape: 'full' });
    const session = await openSession(home);
    const names = [...new Set(LEGACY_SKILL_NAMES)].filter(name =>
      !name.startsWith('devflow:') && session.classifyAt(at(home, `skills/${name}`), 'directory') !== 'shipped');
    expect(names.length).toBeGreaterThan(50);
    for (const name of names) await put(home, `skills/${name}/SKILL.md`, `old ${name}\n`);

    await sweepLegacySkillFolders({ claudeDir: home.claudeDir, backups: session, legacySkills: LEGACY_SKILL_NAMES });

    const run = await onlyRunFolder(home);
    for (const name of names) {
      expect(await exists(at(home, `skills/${name}`)), `${name} left skills/`).toBe(false);
      expect(await fs.readFile(inRun(run, `skills/${name}/SKILL.md`), 'utf8'), `${name} kept its file`).toBe(`old ${name}\n`);
    }
    expect(session.snapshot().moved).toHaveLength(names.length);
    expect(session.snapshot().failures).toEqual([]);
  });

  it('leaves skills/devflow, error-handling and pattern-check, and a skill of the user, where they are', async () => {
    const untouched = ['skills/devflow/SKILL.md', 'skills/error-handling/SKILL.md', 'skills/pattern-check/SKILL.md', 'skills/my-own-skill/SKILL.md'];
    for (const name of ['devflow', 'error-handling', 'pattern-check']) {
      expect(RETIRED_SHIPPED.skills, `${name} is a retired folder name`).toContain(name);
      expect(LEGACY_SKILL_NAMES, `${name} is in no legacy list`).not.toContain(name);
    }
    await runInstall(home, { shape: 'full' });
    for (const rel of untouched) await put(home, rel, `${rel}\n`);
    const session = await openSession(home);

    const report = await runInstall(home, { shape: 'full', backups: session });
    await sweepLegacyDevflowFiles({ claudeDir: home.claudeDir, report, backups: session });
    await sweepLegacySkillFolders({ claudeDir: home.claudeDir, backups: session, legacySkills: LEGACY_SKILL_NAMES });

    for (const rel of untouched) expect(await fs.readFile(at(home, rel), 'utf8'), rel).toBe(`${rel}\n`);
    expect(session.snapshot().moved).toEqual([]);
    expect(backupRootOf(home)).toBeNull();
  });

  it('moves a prefixed legacy folder that no release listed whole, once, and names it', async () => {
    await runInstall(home, { shape: 'full' });
    expect(RETIRED_SHIPPED.skillFiles, 'no release shipped this folder').not.toHaveProperty(PREFIXED);
    expect(LEGACY_SKILL_NAMES).toContain(PREFIXED);
    const folder = `skills/${PREFIXED}`;
    await put(home, `${folder}/SKILL.md`, 'an old prefixed skill\n');
    await put(home, `${folder}/mine.md`, 'mine\n');
    const session = await openSession(home);

    await sweepLegacySkillFolders({ claudeDir: home.claudeDir, backups: session, legacySkills: LEGACY_SKILL_NAMES });

    const run = await onlyRunFolder(home);
    expect(await exists(at(home, folder))).toBe(false);
    expect(await fs.readFile(inRun(run, `${folder}/mine.md`), 'utf8')).toBe('mine\n');
    expect(await fs.readFile(inRun(run, `${folder}/SKILL.md`), 'utf8')).toBe('an old prefixed skill\n');
    expect(session.snapshot().moved.map(unit => [unit.original, unit.kind])).toEqual([[at(home, folder), 'directory']]);
    expect(session.snapshot().retiredRemoved).toEqual([]);
  });

  it('names the prefixed folder once when the install moved it first', async () => {
    await runInstall(home, { shape: 'full' });
    const folder = `skills/${PREFIXED}`;
    await put(home, `${folder}/mine.md`, 'mine\n');
    const session = await openSession(home);

    await runInstall(home, { shape: 'full', backups: session });
    await sweepLegacySkillFolders({ claudeDir: home.claudeDir, backups: session, legacySkills: LEGACY_SKILL_NAMES });

    expect(session.snapshot().moved.filter(unit => unit.original === at(home, folder))).toHaveLength(1);
    expect(await fs.readFile(inRun(await onlyRunFolder(home), `${folder}/mine.md`), 'utf8')).toBe('mine\n');
  });

  it('with a released listing, removes only the listed files, moves the rest and removes the emptied folder', async () => {
    const name = `devflow:${FIXTURE_FOLDER.name}`;
    const listed = ['SKILL.md', 'references/guide.md'];
    const session = sessionWithRetired(listed.map(file => `skills/${name}/${file}`));
    for (const file of listed) await put(home, `skills/${name}/${file}`);
    await put(home, `skills/${name}/mine.md`, 'mine\n');
    await put(home, `skills/${name}/references/mine-ref.md`, 'mine too\n');

    await sweepLegacySkillFolders({
      claudeDir: home.claudeDir, backups: session, legacySkills: [name], retiredFiles: { [name]: listed },
    });

    const run = await onlyRunFolder(home);
    expect([...session.snapshot().retiredRemoved].sort()).toEqual(listed.map(file => at(home, `skills/${name}/${file}`)).sort());
    expect(session.snapshot().moved.map(unit => unit.original).sort()).toEqual([
      at(home, `skills/${name}/mine.md`),
      at(home, `skills/${name}/references/mine-ref.md`),
    ].sort());
    expect(await filesBelow(run)).toEqual([`skills/${name}/mine.md`, `skills/${name}/references/mine-ref.md`]);
    expect(await exists(at(home, `skills/${name}`)), 'the emptied folder is gone').toBe(false);
  });

  it('skips a name that is shipped today', async () => {
    await runInstall(home, { shape: 'full' });
    const note = await put(home, 'skills/devflow:git/mine-notes.md', 'my notes\n');
    const session = await openSession(home);

    await sweepLegacySkillFolders({ claudeDir: home.claudeDir, backups: session, legacySkills: ['devflow:git'] });

    expect(await fs.readFile(note, 'utf8')).toBe('my notes\n');
    expect(session.snapshot().moved).toEqual([]);
    expect(backupRootOf(home)).toBeNull();
  });

  it('makes no backup folder when no legacy folder stands', async () => {
    await runInstall(home, { shape: 'full' });
    const session = await openSession(home);

    await sweepLegacySkillFolders({ claudeDir: home.claudeDir, backups: session, legacySkills: LEGACY_SKILL_NAMES });

    expect(session.snapshot().moved).toEqual([]);
    expect(backupRootOf(home)).toBeNull();
  });
});
