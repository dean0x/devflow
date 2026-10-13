/**
 * The six-agent rename (#466) leaves no orphan agent file behind.
 *
 * A machine that ran the older release holds `~/.claude/agents/devflow/{code-fix, code-edit,
 * scrutinize, simplify, diagnose, learning}.md`. The orphan sweep needs no new code for the
 * rename: every install sweeps `agents/devflow/` against the live agent names, a selective
 * uninstall sweeps the same directory, and a full uninstall removes it whole. This file proves
 * that for all six old slugs on all four paths.
 *
 * It also holds the line the sweep must not cross: a user's own `~/.claude/agents/simplify.md`
 * lives outside the devflow namespace and survives every path byte for byte.
 *
 * Every spawn runs the built CLI under a temp HOME from `sandboxEnv`, which refuses a real home.
 * Requires a build: `npm run build` first.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { requireBuiltCli, sandboxEnv } from './helpers.js';

const CLI = requireBuiltCli();
const SPAWN_TIMEOUT_MS = 120_000;

/** The slugs the six renamed agents shipped under, which a machine may still hold. */
const OLD_SLUGS = ['code-fix', 'code-edit', 'scrutinize', 'simplify', 'diagnose', 'learning'] as const;
/** The slugs they ship under now. */
const NEW_SLUGS = ['fix', 'refactor', 'harden', 'polish', 'debug', 'curate'] as const;

const USER_OWN_AGENT = 'my own simplify agent, not devflow\'s\n';

describe('the six renamed agents leave no orphan agent file (#466)', () => {
  const homes: string[] = [];
  let home: string;

  const agentsDir = (): string => path.join(home, '.claude', 'agents', 'devflow');
  const userAgentFile = (): string => path.join(home, '.claude', 'agents', 'simplify.md');

  async function freshHome(): Promise<string> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-orphan-sweep-'));
    homes.push(dir);
    // `devflow init` refuses a machine without a Claude Code directory.
    await fs.mkdir(path.join(dir, '.claude'), { recursive: true });
    await fs.writeFile(path.join(dir, '.claude', 'settings.json'), '{}\n', 'utf-8');
    return dir;
  }

  function cli(...args: string[]): { status: number | null; out: string } {
    const result = spawnSync(process.execPath, [CLI, ...args], {
      cwd: os.tmpdir(),
      encoding: 'utf-8',
      timeout: SPAWN_TIMEOUT_MS,
      env: sandboxEnv(home),
      input: '',
    });
    if (result.error) throw result.error;
    return { status: result.status, out: `${result.stdout ?? ''}${result.stderr ?? ''}` };
  }

  const OFF = ['--no-ambient', '--no-memory', '--no-learning', '--no-knowledge', '--no-rules'] as const;

  /** The files a previous release left, plus the user's own agent of the same name as one of them. */
  async function seedOldAgents(): Promise<void> {
    await fs.mkdir(agentsDir(), { recursive: true });
    for (const slug of OLD_SLUGS) await fs.writeFile(path.join(agentsDir(), `${slug}.md`), `# ${slug}\n`, 'utf-8');
    await fs.mkdir(path.dirname(userAgentFile()), { recursive: true });
    await fs.writeFile(userAgentFile(), USER_OWN_AGENT, 'utf-8');
  }

  async function leftOver(): Promise<string[]> {
    const names = await fs.readdir(agentsDir()).catch(() => [] as string[]);
    return OLD_SLUGS.filter(slug => names.includes(`${slug}.md`));
  }

  async function expectUserAgentUntouched(): Promise<void> {
    expect(await fs.readFile(userAgentFile(), 'utf-8'), 'the user\'s own agent file').toBe(USER_OWN_AGENT);
  }

  beforeEach(async () => { home = await freshHome(); });

  afterEach(async () => {
    for (const dir of homes.splice(0)) await fs.rm(dir, { recursive: true, force: true });
  });

  it('seeds one file per old slug, so the sweep checks below start from a real orphan set', async () => {
    await seedOldAgents();

    expect(await leftOver()).toEqual([...OLD_SLUGS]);
  });

  it('a full init removes all six and installs the agents that replace them', async () => {
    await seedOldAgents();

    const run = cli('init', '--recommended', ...OFF);

    expect(run.status, run.out).toBe(0);
    expect(await leftOver(), 'old agent files after init').toEqual([]);
    const installed = await fs.readdir(agentsDir());
    // refactor ships with the ambient plugin, which this run leaves off.
    for (const slug of NEW_SLUGS.filter(s => s !== 'refactor')) expect(installed, slug).toContain(`${slug}.md`);
    await expectUserAgentUntouched();
  }, SPAWN_TIMEOUT_MS);

  it('init --plugin removes all six too, because the sweep runs on every install', async () => {
    await seedOldAgents();

    const run = cli('init', '--plugin=implement', ...OFF);

    expect(run.status, run.out).toBe(0);
    expect(await leftOver(), 'old agent files after a selective init').toEqual([]);
    await expectUserAgentUntouched();
  }, SPAWN_TIMEOUT_MS);

  it('uninstall --plugin removes all six, and leaves the other plugin\'s agents', async () => {
    const installRun = cli('init', '--plugin=implement,self-review', ...OFF);
    expect(installRun.status, installRun.out).toBe(0);
    await seedOldAgents();

    const run = cli('uninstall', '--plugin=implement');

    expect(run.status, run.out).toBe(0);
    expect(await leftOver(), 'old agent files after a selective uninstall').toEqual([]);
    expect(await fs.readdir(agentsDir()), 'self-review keeps its agents').toEqual(expect.arrayContaining(['polish.md', 'harden.md']));
    await expectUserAgentUntouched();
  }, 2 * SPAWN_TIMEOUT_MS);

  it('a full uninstall removes the devflow agents directory, old files included', async () => {
    const installRun = cli('init', '--recommended', ...OFF);
    expect(installRun.status, installRun.out).toBe(0);
    await seedOldAgents();

    const run = cli('uninstall');

    expect(run.status, run.out).toBe(0);
    await expect(fs.stat(agentsDir()), 'the devflow agents directory').rejects.toMatchObject({ code: 'ENOENT' });
    await expectUserAgentUntouched();
  }, 2 * SPAWN_TIMEOUT_MS);
});
