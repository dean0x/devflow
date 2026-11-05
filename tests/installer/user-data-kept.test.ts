/**
 * TP-8 (AC-3): `devflow init` and a selective `devflow uninstall --plugin` leave the user's own
 * data byte for byte as it was: the preference profile and the tracker conventions under the
 * machine folder, and the design docs and wave reports under a project's `.devflow/docs/`.
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
const MULTI_RUN_TIMEOUT_MS = 120_000;

/** The user's own data, as path relative to the base folder -> bytes. */
const USER_DATA: Readonly<Record<string, string>> = {
  'home/.devflow/preference-profile.md': '# My preferences\n\nI keep these.\n',
  'home/.devflow/tracker/jira.md': '---\nprovider: jira\n---\nmy conventions\n',
  'project/.devflow/docs/design/756-sunset.2026-11-05_0209.md': '# A design doc\n',
  'project/.devflow/docs/waves/wave-1-report.md': '# Wave 1 report\n\nWhat the wave did.\n',
  'project/.devflow/docs/waves/wave-2-report.md': '# Wave 2 report\n',
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

describe('the user\'s own data through init and a selective uninstall', () => {
  it('stays byte-identical through a first init, a second init and the uninstall of one plugin', { timeout: MULTI_RUN_TIMEOUT_MS }, async () => {
    expect(await readUserData(), 'the data is in place before the first run').toEqual(USER_DATA);

    await run(initCommand, INIT_ARGS);
    const installed = await fs.access(at('home/.claude/commands/devflow')).then(() => true, () => false);
    expect(installed, `init installed the commands folder:\n${written.join('')}`).toBe(true);
    expect(await readUserData(), 'after the first init').toEqual(USER_DATA);

    await run(initCommand, INIT_ARGS);
    expect(await readUserData(), 'after the second init').toEqual(USER_DATA);

    await run(uninstallCommand, ['--plugin', PLUGIN, '--scope', 'user']);
    const removed = await fs.access(at('home/.claude/commands/devflow/bug-analysis.md')).then(() => false, () => true);
    expect(removed, `the uninstall removed the plugin's command:\n${written.join('')}`).toBe(true);
    expect(await readUserData(), 'after the selective uninstall').toEqual(USER_DATA);
  });
});
