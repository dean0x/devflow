/**
 * TP-8 (AC-3): `devflow init` and a selective `devflow uninstall --plugin` leave the user's own
 * data byte for byte as it was: the preference profile and the tracker conventions under the
 * machine folder, and under a project's `.devflow/docs/` the design docs, the ticket sets, the
 * per-ticket plans and the wave reports and wave evidence files that the removed dynamic commands
 * wrote. The same init runs remove the retired dynamic command files that an earlier release
 * installed, on a full install and on a partial one.
 *
 * Both commands run in-process against a temp home and a temp project, with stdout replaced.
 * Nothing here reads or writes the real home.
 */
import { execFileSync } from 'child_process';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { initCommand } from '../../src/cli/commands/init.js';
import { uninstallCommand } from '../../src/cli/commands/uninstall.js';
import { assertTempHome, TEMP_HOME_PREFIX } from '../setup/home-isolation.js';

const INIT_ARGS = ['--recommended', '--no-ambient', '--no-memory', '--no-knowledge', '--no-hud'];
const PLUGIN = 'devflow-bug-analysis';
const PARTIAL_PLUGIN = 'devflow-typescript';
const MULTI_RUN_TIMEOUT_MS = 120_000;

/** The command files of the four removed dynamic commands, which an earlier release installed. */
const RETIRED_DYNAMIC_COMMANDS = ['dynamic-build', 'dynamic-plan', 'dynamic-profile', 'dynamic-tickets'] as const;

const DOCS = 'project/.devflow/docs';
const SET = '756-sunset/2026-11-05_0209';

/** The user's own data, as path relative to the base folder -> bytes. */
const USER_DATA: Readonly<Record<string, string>> = {
  'home/.devflow/preference-profile.md': '# My preferences\n\nI keep these.\n',
  'home/.devflow/tracker/jira.md': '---\nprovider: jira\n---\nmy conventions\n',
  [`${DOCS}/design/756-sunset.2026-11-05_0209.md`]: '# A design doc\n',
  [`${DOCS}/waves/wave-1-report.md`]: '# Wave 1 report\n\nWhat the wave did.\n',
  [`${DOCS}/waves/wave-2-report.md`]: '# Wave 2 report\n',
  [`${DOCS}/waves/${SET}/wave-report.md`]: '# Wave report\n\nA nested wave report.\n',
  [`${DOCS}/tickets/${SET}/TICKET-1.md`]: '# TICKET-1\n\nA ticket of the set.\n',
  [`${DOCS}/tickets/${SET}/tracking-issue.md`]: '# Tracking issue\n\n- TICKET-1\n',
  [`${DOCS}/design/${SET}/TICKET-1-plan.md`]: '# Plan for TICKET-1\n\n1. A step.\n',
  [`${DOCS}/design/${SET}/DECISIONS-NEEDED.md`]: '# Decisions needed\n\n- One open question.\n',
  [`${DOCS}/evidence-wave-756-sunset.md`]: '# Wave evidence\n',
  [`${DOCS}/evidence-result-wave-756-sunset.md`]: '# Wave evidence result\n',
  [`${DOCS}/readiness-wave-756-sunset.md`]: '# Wave readiness\n',
};

let base: string;
let cwd: string;
let written: string[];

const at = (rel: string): string => path.join(base, ...rel.split('/'));

async function readUserData(): Promise<Record<string, string | null>> {
  const out: Record<string, string | null> = {};
  for (const rel of Object.keys(USER_DATA)) {
    out[rel] = await fs.readFile(at(rel), 'utf-8').catch(() => null);
  }
  return out;
}

beforeEach(async () => {
  base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), TEMP_HOME_PREFIX)));
  assertTempHome(base);
  console.log(`user-data-kept test home: ${base}`);
  await fs.mkdir(at('home/.claude'), { recursive: true });
  await fs.mkdir(at('project'), { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: at('project') });
  for (const [rel, text] of Object.entries(USER_DATA)) {
    await fs.mkdir(path.dirname(at(rel)), { recursive: true });
    await fs.writeFile(at(rel), text, 'utf-8');
  }
  written = [];
  vi.stubEnv('HOME', at('home'));
  vi.stubEnv('USERPROFILE', at('home'));
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
    written.push(String(chunk));
    return true;
  });
  cwd = process.cwd();
  process.chdir(at('project'));
});

afterEach(async () => {
  process.chdir(cwd);
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  process.exitCode = 0;
  await fs.rm(base, { recursive: true, force: true });
});

/** Run a real command, with its option state cleared first. */
async function run(command: typeof initCommand | typeof uninstallCommand, args: string[]): Promise<void> {
  (command as unknown as { _optionValues: Record<string, unknown> })._optionValues = {};
  await command.parseAsync(args, { from: 'user' });
}

const retiredCommandFile = (name: string): string => at(`home/.claude/commands/devflow/${name}.md`);
const present = (file: string): Promise<boolean> => fs.access(file).then(() => true, () => false);

/** Put a command file of an earlier release into the installed commands folder, before any init. */
async function plantRetiredCommands(names: readonly string[]): Promise<void> {
  for (const name of names) {
    const file = retiredCommandFile(name);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, `# the retired /${name} command of an earlier release\n`, 'utf-8');
    expect(await present(file), `precondition: ${name} is installed`).toBe(true);
  }
}

/**
 * The init run printed a removal line for the retired command files. A file that the install moved
 * aside as an unknown one is gone from the folder too, so this also checks the move line is absent.
 */
function expectRetiredCommandsRemoved(removalLine: RegExp): void {
  const output = written.join('');
  expect(output, 'the removal line is printed').toMatch(removalLine);
  expect(output, 'nothing was moved aside as an unknown file').not.toMatch(/Moved \d+ item\(s\)/);
}

/** The line of a full install, which lists the retired files it removed. */
const FULL_INSTALL_REMOVAL = /Removed \d+ retired devflow file\(s\)/;
/** The line of a partial install, which names the command that the registry no longer lists. */
const PARTIAL_INSTALL_REMOVAL = /Removed \d+ orphaned asset\(s\) no longer in the registry: command dynamic-plan/;

describe('the user\'s own data through init and a selective uninstall', () => {
  it('stays byte-identical through a first init, a second init and the uninstall of one plugin, and the first init removes the retired dynamic commands', { timeout: MULTI_RUN_TIMEOUT_MS }, async () => {
    expect(await readUserData(), 'the data is in place before the first run').toEqual(USER_DATA);
    const stale = [RETIRED_DYNAMIC_COMMANDS[0], RETIRED_DYNAMIC_COMMANDS[2]];
    await plantRetiredCommands(stale);

    await run(initCommand, INIT_ARGS);
    const installed = await present(at('home/.claude/commands/devflow'));
    expect(installed, `init installed the commands folder:\n${written.join('')}`).toBe(true);
    for (const name of stale) expect(await present(retiredCommandFile(name)), `init removed the retired ${name} command:\n${written.join('')}`).toBe(false);
    expectRetiredCommandsRemoved(FULL_INSTALL_REMOVAL);
    for (const name of stale) expect(written.join(''), `the removal line names ${name}`).toContain(`${name}.md`);
    expect(await readUserData(), 'after the first init').toEqual(USER_DATA);

    await run(initCommand, INIT_ARGS);
    expect(await readUserData(), 'after the second init').toEqual(USER_DATA);

    await run(uninstallCommand, ['--plugin', PLUGIN, '--scope', 'user']);
    const stillInstalled = await present(at('home/.claude/commands/devflow/bug-analysis.md'));
    expect(stillInstalled, `the uninstall removed the plugin's command:\n${written.join('')}`).toBe(false);
    expect(await readUserData(), 'after the selective uninstall').toEqual(USER_DATA);
  });

  it('a partial init removes a retired dynamic command and keeps the data byte-identical', { timeout: MULTI_RUN_TIMEOUT_MS }, async () => {
    await plantRetiredCommands([RETIRED_DYNAMIC_COMMANDS[1]]);

    await run(initCommand, ['--plugin', PARTIAL_PLUGIN, ...INIT_ARGS]);

    expect(await present(retiredCommandFile(RETIRED_DYNAMIC_COMMANDS[1])), `the partial init removed the retired command:\n${written.join('')}`).toBe(false);
    expectRetiredCommandsRemoved(PARTIAL_INSTALL_REMOVAL);
    expect(await readUserData(), 'after the partial init').toEqual(USER_DATA);
  });
});
