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
 * Last, it proves a partial install and a partial uninstall on an older release's install leave
 * every plugin that stays installed with all of its agents and the current commands. Removing the
 * retired agent files alone is not enough: that release's commands still name them, and the
 * agents that replace them are not on disk until something writes them.
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
import { DEVFLOW_PLUGINS, type PluginDefinition } from '../src/core/plugins.js';

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

  const OFF = ['--no-ambient', '--no-memory', '--no-curation', '--no-knowledge', '--no-rules'] as const;

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

  // -------------------------------------------------------------------------
  // The plugins that stay installed keep their agents (#466)
  // -------------------------------------------------------------------------

  const commandsDir = (): string => path.join(home, '.claude', 'commands', 'devflow');
  const OLD_COMMAND_TEXT = '# command text from the older release\n';

  /** The plugins the install record lists, as the registry defines them. */
  async function recordedPlugins(): Promise<PluginDefinition[]> {
    const manifest = JSON.parse(await fs.readFile(path.join(home, '.devflow', 'manifest.json'), 'utf-8')) as { plugins: string[] };
    return DEVFLOW_PLUGINS.filter(plugin => manifest.plugins.includes(plugin.name));
  }

  /** Every agent file a plugin declares, except the one `devflow init` converges on its own. */
  const agentFilesOf = (plugin: { agents: readonly string[] }): string[] =>
    plugin.agents.filter(agent => agent !== 'tracker').map(agent => `${agent}.md`);

  /** Every command file the plugins declare. */
  const commandFilesOf = (plugins: readonly { commands: readonly string[] }[]): string[] =>
    plugins.flatMap(plugin => plugin.commands.map(command => `${command.replace(/^\//, '')}.md`));

  /**
   * Turn a fresh install of `plugins` into what the older release left: the six old agent files in
   * place of the six new ones, and the older text in every command.
   */
  async function installOlderRelease(plugins: string): Promise<void> {
    const run = cli('init', `--plugin=${plugins}`, ...OFF);
    expect(run.status, run.out).toBe(0);
    for (const slug of NEW_SLUGS) await fs.rm(path.join(agentsDir(), `${slug}.md`), { force: true });
    await seedOldAgents();
    for (const file of await fs.readdir(commandsDir())) {
      await fs.writeFile(path.join(commandsDir(), file), OLD_COMMAND_TEXT, 'utf-8');
    }
  }

  async function expectEveryRemainingPluginWhole(): Promise<void> {
    const remaining = await recordedPlugins();
    expect(remaining.length, 'plugins the install record still lists').toBeGreaterThan(0);
    const agents = await fs.readdir(agentsDir());
    for (const plugin of remaining) {
      expect(agents, `agents of ${plugin.name}`).toEqual(expect.arrayContaining(agentFilesOf(plugin)));
    }
    for (const file of commandFilesOf(remaining)) {
      const text = await fs.readFile(path.join(commandsDir(), file), 'utf-8');
      expect(text, `${file} is the current command, not the older release's`).not.toBe(OLD_COMMAND_TEXT);
    }
    expect(await leftOver(), 'old agent files').toEqual([]);
    await expectUserAgentUntouched();
  }

  it('a partial init on an older release\'s install leaves every installed plugin with its agents and commands', async () => {
    await installOlderRelease('implement,bug-analysis,code-review');

    const run = cli('init', '--plugin=code-review', ...OFF);

    expect(run.status, run.out).toBe(0);
    const names = (await recordedPlugins()).map(plugin => plugin.name);
    expect(names, 'the install record keeps all three').toEqual(
      expect.arrayContaining(['devflow-implement', 'devflow-bug-analysis', 'devflow-code-review']),
    );
    await expectEveryRemainingPluginWhole();
    // The two plugins this run did not name need these two agents, which only the widened copy writes.
    expect(await fs.readdir(agentsDir())).toEqual(expect.arrayContaining(['fix.md', 'debug.md']));
  }, 2 * SPAWN_TIMEOUT_MS);

  it('a partial uninstall on an older release\'s install leaves every remaining plugin with its agents and commands', async () => {
    await installOlderRelease('implement,bug-analysis,self-review');

    const run = cli('uninstall', '--plugin=bug-analysis');

    expect(run.status, run.out).toBe(0);
    const names = (await recordedPlugins()).map(plugin => plugin.name);
    expect(names, 'the install record keeps the plugins that stay').toEqual(
      expect.arrayContaining(['devflow-implement', 'devflow-self-review']),
    );
    expect(names, 'the install record drops the removed plugin').not.toContain('devflow-bug-analysis');
    await expectEveryRemainingPluginWhole();
    expect(await fs.readdir(agentsDir())).toEqual(expect.arrayContaining(['fix.md', 'polish.md', 'harden.md']));
    await expect(fs.stat(path.join(commandsDir(), 'bug-analysis.md')), 'the removed plugin\'s command').rejects.toMatchObject({ code: 'ENOENT' });
    expect(run.out, 'the notice that points at a full init for hooks and scripts').toContain('to update the hooks and scripts');
  }, 3 * SPAWN_TIMEOUT_MS);

  it('a partial init with no retired agent file leaves the other plugins\' files alone', async () => {
    const installRun = cli('init', '--plugin=implement,code-review', ...OFF);
    expect(installRun.status, installRun.out).toBe(0);
    // polish belongs to implement, which this run does not name, and has no learning variant that
    // an install would converge back.
    const polishAgent = path.join(agentsDir(), 'polish.md');
    await fs.writeFile(polishAgent, '# my edit\n', 'utf-8');

    const run = cli('init', '--plugin=code-review', ...OFF);

    expect(run.status, run.out).toBe(0);
    expect(await fs.readFile(polishAgent, 'utf-8'), 'an agent of a plugin this run did not name').toBe('# my edit\n');
  }, 2 * SPAWN_TIMEOUT_MS);
});
