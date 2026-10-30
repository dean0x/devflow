/**
 * What `installViaFileCopy` does with a file it did not ship, on a full install and on a partial
 * one: the file moves to the backup folder at the same relative path with the same bytes, the
 * report names both paths, and a file devflow shipped in an earlier release is removed and named
 * instead. Every test works in a temp home, with the clock and the random bytes injected through
 * the backup session, and nothing here reads or writes the real home.
 */
import { promises as fs } from 'fs';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { formatBackupSummary } from '../../src/cli/commands/install-report.js';
import { RETIRED_SHIPPED } from '../../src/core/retired-shipped-names.js';
import { assertTempHome } from '../setup/home-isolation.js';
import {
  DEFAULT_PLUGINS,
  at,
  backupRootOf,
  exists,
  filesBelow,
  makeHome,
  onlyRunFolder,
  put,
  removeHome,
  runInstall,
  type TestHome,
} from './install-backup-harness.js';

let home: TestHome;

beforeEach(async () => {
  home = await makeHome();
  assertTempHome(home.home);
  console.log(`install-backup-install test home: ${await fs.realpath(home.home)}`);
});

afterEach(async () => {
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
    const foreign = 'skills/devflow:mine-own-skill';
    await put(home, `${foreign}/SKILL.md`, 'my skill\n');
    await put(home, `${foreign}/references/deep.md`, 'deep\n');

    const report = await runInstall(home, { shape: 'full' });

    const run = await onlyRunFolder(home);
    expect(await exists(at(home, foreign))).toBe(false);
    expect(await fs.readFile(inRun(run, `${foreign}/references/deep.md`), 'utf8')).toBe('deep\n');
    expect(movedOriginals(report)).toEqual([at(home, foreign)]);
    expect(report.sweptOrphans.map(orphan => orphan.name)).not.toContain('mine-own-skill');
  });
});

describe('a partial install moves only what its sweeps would remove', () => {
  it('moves an unknown .md from commands and agents, an unknown devflow:* folder and an unknown reference, and names the references/pr file', async () => {
    await runInstall(home, { shape: 'full' });
    const planted: Record<string, string> = {
      'commands/devflow/mine.md': 'my command\n',
      'agents/devflow/mine.md': 'my agent\n',
      'skills/devflow:mine-own-skill/SKILL.md': 'my skill\n',
      'skills/devflow:git/references/pr/mine-pr.md': 'my pr note\n',
      'skills/devflow:git/references/tracker/mine/notes.md': 'my tracker notes\n',
    };
    for (const [rel, text] of Object.entries(planted)) await put(home, rel, text);

    const report = await runInstall(home, { shape: 'partial' });

    const run = await onlyRunFolder(home);
    expect(await exists(at(home, 'commands/devflow/mine.md'))).toBe(false);
    expect(await exists(at(home, 'agents/devflow/mine.md'))).toBe(false);
    expect(await exists(at(home, 'skills/devflow:mine-own-skill'))).toBe(false);
    expect(await exists(at(home, 'skills/devflow:git/references/pr/mine-pr.md'))).toBe(false);
    expect(await exists(at(home, 'skills/devflow:git/references/tracker/mine'))).toBe(false);
    for (const rel of ['commands/devflow/mine.md', 'agents/devflow/mine.md', 'skills/devflow:mine-own-skill/SKILL.md', 'skills/devflow:git/references/pr/mine-pr.md', 'skills/devflow:git/references/tracker/mine/notes.md']) {
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
