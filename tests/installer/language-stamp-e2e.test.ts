/**
 * End to end: the installed /code-review carries the language focuses the machine's selection
 * installs (D-LANGUAGE-FOCUS-STAMP, #428 AC-309 to AC-311, AC-316).
 *
 * Drives the REAL compiled CLI (`node dist/cli.js`) against isolated temp HOMEs, because the unit tests in
 * language-stamp.test.ts call the installer, the converge and the selective phase directly and cannot see a
 * wiring mistake between the CLI and them. Every claim here is about the bytes of the installed file in a
 * user's ~/.claude afterwards, read from disk and never from the source template.
 *
 * HOME safety: every spawn gets its env from the shared `sandboxEnv(tmpHome)`, which pins HOME to a temp
 * directory and refuses a real home, and the HOME is seeded with `~/.claude` first, because without it init
 * exits 0 at Claude Code detection before reaching the code under test. The first assertion of each scenario
 * is on installed bytes, never on an exit code a short-circuit also returns.
 *
 * Requires a build (`npm run build`): the spawned CLI reads dist/ and dist/learning-off.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'child_process';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';

import { requireBuiltCli, sandboxEnv } from '../helpers.js';
import { assertTempHome } from '../setup/home-isolation.js';

const CLI = requireBuiltCli();
const ROOT = path.resolve(import.meta.dirname, '../..');

/** One CLI spawn under load runs well past vitest's 5 s default. */
const SUBPROCESS_TIMEOUT_MS = 120_000;
/** A scenario that chains several spawns gets a budget of several. */
const SCENARIO_TIMEOUT_MS = 8 * SUBPROCESS_TIMEOUT_MS;

/** Flags that keep every install down to the commands, skills and manifest this file is about. */
const QUIET = ['--no-ambient', '--no-memory', '--no-knowledge', '--no-rules'] as const;

const STAMP_PREFIX = 'Installed language focuses: ';

let tmpHome: string;

const claudeDir = (): string => path.join(tmpHome, '.claude');
const installedCommand = (name: string): string => path.join(claudeDir(), 'commands', 'devflow', `${name}.md`);

interface Run { status: number | null; out: string }

function runCli(cwd: string, ...args: string[]): Run {
  const result = spawnSync('node', [CLI, ...args], {
    encoding: 'utf-8',
    timeout: SUBPROCESS_TIMEOUT_MS,
    cwd,
    env: sandboxEnv(tmpHome),
  });
  if (result.error) throw result.error;
  return { status: result.status, out: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

function okCli(...args: string[]): string {
  const { status, out } = runCli(os.tmpdir(), ...args);
  expect(status, `devflow ${args.join(' ')} failed:\n${out}`).toBe(0);
  return out;
}

const init = (...flags: string[]): string => okCli('init', ...QUIET, '--recommended', ...flags);

/** The stamp line of an installed command, read from disk; a description of what was found when it is not exactly one. */
async function stampOf(name: string): Promise<string> {
  const lines = (await fs.readFile(installedCommand(name), 'utf-8')).split('\n').filter(l => l.startsWith(STAMP_PREFIX));
  return lines.length === 1 ? lines[0].slice(STAMP_PREFIX.length) : `<${lines.length} stamp lines>`;
}

async function stampCarriers(): Promise<string[]> {
  const dir = path.join(claudeDir(), 'commands', 'devflow');
  const out: string[] = [];
  for (const file of (await fs.readdir(dir)).filter(f => f.endsWith('.md')).sort()) {
    if ((await fs.readFile(path.join(dir, file), 'utf-8')).split('\n').some(l => l.startsWith(STAMP_PREFIX))) out.push(file);
  }
  return out;
}

/** The learning-off variant of a command when the host has an arm, else null. */
async function learningOffBytes(name: string): Promise<string | null> {
  try { return await fs.readFile(path.join(ROOT, 'dist', 'learning-off', 'commands', `${name}.md`), 'utf-8'); } catch { return null; }
}

beforeEach(async () => {
  tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-stamp-e2e-'));
  expect(() => assertTempHome(tmpHome)).not.toThrow();
  // init refuses a HOME with no ~/.claude: Claude Code's presence check, not under test.
  await fs.mkdir(claudeDir(), { recursive: true });
});

afterEach(async () => {
  await fs.rm(tmpHome, { recursive: true, force: true });
});

describe('init stamps the installed /code-review from the selection (AC-309)', () => {
  it('(b) a default selection stamps (none), and the installed file is the build, byte for byte', async () => {
    init();

    expect(await stampOf('code-review')).toBe('(none)');
    expect(await fs.readFile(installedCommand('code-review'), 'utf-8'))
      .toBe(await fs.readFile(path.join(ROOT, 'dist', 'commands', 'code-review.md'), 'utf-8'));
  }, SCENARIO_TIMEOUT_MS);

  it('(a, c) a full install with devflow-typescript selected stamps typescript, and a later selection change re-stamps', async () => {
    init();
    init('--plugin=devflow-typescript');
    // A full re-init now: the selection comes from the manifest, language plugins included.
    init();
    expect(await stampOf('code-review'), 'a full install with devflow-typescript selected').toBe('typescript');

    init('--plugin=devflow-go');
    expect(await stampOf('code-review'), 'registry order, not selection order').toBe('typescript, go');
    expect(await stampCarriers(), 'only /code-review carries the stamp').toEqual(['code-review.md']);
  }, SCENARIO_TIMEOUT_MS);
});

describe('a partial install re-stamps without a full re-init (AC-310)', () => {
  it('init --plugin=devflow-typescript leaves the already-installed code-review stamping typescript', async () => {
    init();
    // /dynamic-build ships with the optional devflow-dynamic plugin; install it so "carries no stamp" is a claim about a real file.
    init('--plugin=devflow-dynamic');
    expect(await stampOf('code-review')).toBe('(none)');
    const before = await fs.stat(installedCommand('dynamic-build'));

    const out = okCli('init', ...QUIET, '--recommended', '--plugin=devflow-typescript');

    expect(await stampOf('code-review')).toBe('typescript');
    expect(out).not.toMatch(/language stamp/);
    // The partial run did not re-copy the other plugins' commands.
    expect((await fs.stat(installedCommand('dynamic-build'))).ino).toBe(before.ino);
    expect(await stampCarriers(), 'dynamic-build carries no stamp').toEqual(['code-review.md']);
    expect(await fs.readFile(installedCommand('dynamic-build'), 'utf-8'))
      .toBe(await fs.readFile(path.join(ROOT, 'dist', 'commands', 'dynamic-build.md'), 'utf-8'));
  }, SCENARIO_TIMEOUT_MS);
});

describe('selective uninstall re-stamps the remaining selection (AC-311)', () => {
  it('uninstall --plugin=devflow-typescript drops typescript and leaves every other focus in the list', async () => {
    init();
    init('--plugin=devflow-typescript');
    init('--plugin=devflow-go');
    init('--plugin=devflow-rust');
    expect(await stampOf('code-review'), 'setup: three language plugins stamped').toBe('typescript, go, rust');

    const out = okCli('uninstall', '--plugin=devflow-typescript');

    expect(await stampOf('code-review')).toBe('go, rust');
    expect(out).not.toMatch(/language stamp/);
    // The typescript skill went with the plugin: the stamp and the skills on disk agree.
    await expect(fs.access(path.join(claudeDir(), 'skills', 'devflow:typescript'))).rejects.toThrow();
    await expect(fs.access(path.join(claudeDir(), 'skills', 'devflow:go', 'SKILL.md'))).resolves.toBeUndefined();
  }, SCENARIO_TIMEOUT_MS);

  it('removing the last language plugin stamps (none)', async () => {
    init();
    init('--plugin=devflow-go');
    expect(await stampOf('code-review')).toBe('go');

    okCli('uninstall', '--plugin=devflow-go');

    expect(await stampOf('code-review')).toBe('(none)');
  }, SCENARIO_TIMEOUT_MS);
});

describe('a learning toggle keeps the stamp (the composition with the variant converge)', () => {
  it('--disable then --enable switches the variant of code-review and keeps the list, byte for byte', async () => {
    init();
    init('--plugin=devflow-typescript');
    init('--plugin=devflow-go');
    const onBytes = await fs.readFile(installedCommand('code-review'), 'utf-8');
    expect(await stampOf('code-review')).toBe('typescript, go');

    okCli('learning', '--disable');
    const off = await fs.readFile(installedCommand('code-review'), 'utf-8');
    expect(off, 'the learning-off variant of the command').not.toBe(onBytes);
    expect(off).toBe((await learningOffBytes('code-review') as string).replace(`${STAMP_PREFIX}(none)`, `${STAMP_PREFIX}typescript, go`));
    expect(await stampOf('code-review')).toBe('typescript, go');

    okCli('learning', '--enable');
    expect(await fs.readFile(installedCommand('code-review'), 'utf-8'), 'back to the stamped learning-on file').toBe(onBytes);
  }, SCENARIO_TIMEOUT_MS);

  it('a re-init on the same switch leaves the stamped learning-off file identical', async () => {
    init();
    init('--plugin=devflow-typescript');
    init('--no-learning');
    const content = await fs.readFile(installedCommand('code-review'), 'utf-8');
    expect(content.split('\n')).toContain(`${STAMP_PREFIX}typescript`);
    expect(content, 'the learning-off variant, stamped').toBe((await learningOffBytes('code-review') as string).replace(`${STAMP_PREFIX}(none)`, `${STAMP_PREFIX}typescript`));

    init('--no-learning');

    expect(await fs.readFile(installedCommand('code-review'), 'utf-8')).toBe(content);
  }, SCENARIO_TIMEOUT_MS);
});
