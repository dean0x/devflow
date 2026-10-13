/**
 * The rewrite that follows a selective uninstall of a retired agent file (#466).
 *
 * When `devflow uninstall --plugin` removes an agent file that an older release left, the
 * commands of the plugins that stay installed still spawn that agent. The uninstall then writes
 * the current commands and agents of those plugins (`refreshRetainedCommandsAndAgents`).
 *
 * D-CLI-NO-SYMLINK: a legacy local install lives in a repository, which can commit any command
 * file as a symbolic link. `fs.copyFile` writes through a link, so the rewrite never runs in a
 * legacy local scope. That scope is also one `devflow init` can not update.
 *
 * Every path runs in-process under temp directories. The real `~/.claude` and `~/.devflow` are
 * never reached: the setup file points HOME at a temp directory, and every call here passes its
 * own `claudeDir` and `devflowDir`. Requires a build, because the rewrite reads the compiled
 * commands from `dist/`: `npm run build` first.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs, lstatSync } from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as p from '@clack/prompts';
import { resolveInstalledPlugins, runSelectivePhaseForScope } from '../src/cli/commands/uninstall.js';
import { DEVFLOW_PLUGINS, type PluginDefinition } from '../src/core/plugins.js';

/** The agent file an older release left, which starts the rewrite. */
const RETIRED_AGENT = 'code-fix';
/** Text that no compiled command equals, so a rewrite is visible on disk. */
const OLD_COMMAND_TEXT = '# command text from the older release\n';
const LINKED_TARGET_TEXT = '# a file outside the legacy install\n';

function pluginNamed(name: string): PluginDefinition {
  const found = DEVFLOW_PLUGINS.filter(plugin => plugin.name === name);
  expect(found, `the registry holds ${name} once`).toHaveLength(1);
  return found[0];
}

async function exists(target: string): Promise<boolean> {
  return fs.access(target).then(() => true, () => false);
}

describe('a selective uninstall in a legacy local install writes no command through a link (D-CLI-NO-SYMLINK)', () => {
  let repo: string;
  let outside: string;
  let warn: ReturnType<typeof vi.spyOn>;
  let info: ReturnType<typeof vi.spyOn>;

  const claudeDir = (): string => path.join(repo, '.claude');
  const devflowDir = (): string => path.join(repo, '.devflow');
  const commandsDir = (): string => path.join(claudeDir(), 'commands', 'devflow');
  const agentsDir = (): string => path.join(claudeDir(), 'agents', 'devflow');

  beforeEach(async () => {
    repo = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-refresh-repo-')));
    outside = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-refresh-outside-')));
    warn = vi.spyOn(p.log, 'warn').mockImplementation(() => undefined);
    info = vi.spyOn(p.log, 'info').mockImplementation(() => undefined);

    // An older release's legacy local install: a retired agent file, one command that is a
    // link to a file outside the repository, one plain command, and the install record.
    await fs.mkdir(commandsDir(), { recursive: true });
    await fs.mkdir(agentsDir(), { recursive: true });
    await fs.mkdir(devflowDir(), { recursive: true });
    await fs.writeFile(path.join(agentsDir(), `${RETIRED_AGENT}.md`), `# ${RETIRED_AGENT}\n`, 'utf-8');
    await fs.writeFile(path.join(outside, 'implement.md'), LINKED_TARGET_TEXT, 'utf-8');
    await fs.symlink(path.join(outside, 'implement.md'), path.join(commandsDir(), 'implement.md'));
    await fs.writeFile(path.join(commandsDir(), 'bug-analysis.md'), OLD_COMMAND_TEXT, 'utf-8');
    await fs.writeFile(path.join(devflowDir(), 'manifest.json'), JSON.stringify({
      version: '3.5.0',
      plugins: ['devflow-implement', 'devflow-bug-analysis', 'devflow-self-review'],
      scope: 'local',
      features: { ambient: false, memory: false },
      installedAt: 'x',
      updatedAt: 'x',
    }), 'utf-8');
  });

  afterEach(async () => {
    await fs.rm(repo, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  });

  const lines = (spy: ReturnType<typeof vi.spyOn>): string[] => spy.mock.calls.map(call => String(call[0]));

  it('leaves the file a linked command leads to as it was, writes no other command, and tells the user to remove the install in full', async () => {
    await runSelectivePhaseForScope({
      claudeDir: claudeDir(),
      devflowDir: devflowDir(),
      selectedPlugins: [pluginNamed('devflow-self-review')],
      verbose: false,
      installedPlugins: await resolveInstalledPlugins(devflowDir()),
      scope: 'local',
    });

    // Non-vacuity: the retired file is removed, which is what starts the rewrite in any other scope.
    expect(await exists(path.join(agentsDir(), `${RETIRED_AGENT}.md`)), 'the retired agent file').toBe(false);
    expect(await fs.readFile(path.join(outside, 'implement.md'), 'utf-8'), 'the file the link leads to').toBe(LINKED_TARGET_TEXT);
    expect(lstatSync(path.join(commandsDir(), 'implement.md')).isSymbolicLink(), 'the link is left as it was').toBe(true);
    expect(await fs.readFile(path.join(commandsDir(), 'bug-analysis.md'), 'utf-8'), 'a plain command of a plugin that stays').toBe(OLD_COMMAND_TEXT);
    const agentsLeft = await fs.readdir(agentsDir());
    for (const plugin of [pluginNamed('devflow-implement'), pluginNamed('devflow-bug-analysis')]) {
      for (const agent of plugin.agents.filter(name => name !== 'tracker')) {
        expect(agentsLeft, `${agent} of ${plugin.name}`).not.toContain(`${agent}.md`);
      }
    }

    const warned = lines(warn);
    const notice = warned.filter(line => line.includes(RETIRED_AGENT));
    expect(notice, 'one warning names the removed agent file').toHaveLength(1);
    expect(notice[0]).toContain('legacy local install');
    expect(notice[0], 'the remedy for a legacy local install').toContain('`devflow uninstall --scope local`');
    expect(notice[0], 'a legacy local install can not be updated with init').not.toContain('devflow init');
    expect(lines(info).filter(line => line.includes('wrote the current commands')), 'no success note').toEqual([]);
  });
});
