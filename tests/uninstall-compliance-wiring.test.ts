/**
 * The rewrite that follows a selective uninstall of a retired agent file hands the
 * machine's compliance switch to the installer, so the switch decides what the rewrite
 * needs from the package.
 *
 * With compliance off the installer reads dist/variant-axes.json and refuses, before it
 * writes a command or an agent, when the file is missing. With compliance on it reads
 * nothing. The unit tests of the installer pass the switch themselves, so only a call
 * through `refreshRetainedCommandsAndAgents` shows that it passes the manifest's switch
 * and not a constant: a package without the manifest is rewritten from on a compliance-on
 * machine and is refused on a compliance-off one.
 *
 * The package root is a staged copy that carries no manifest (tests/helpers/staged-package.ts),
 * reached through the one package-root resolver. Every path runs in-process under temp
 * directories; each call passes its own `claudeDir` and `devflowDir`, and the setup file
 * points HOME at a temp directory. Requires a build, because the staged package copies it.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as p from '@clack/prompts';
import { refreshRetainedCommandsAndAgents } from '../src/cli/commands/uninstall.js';
import { VARIANT_MANIFEST_REL_PATH } from '../src/core/curation-variants.js';
import { DEVFLOW_PLUGINS } from '../src/core/plugins.js';
import { stagePackage, type StagedPackage } from './helpers/staged-package.js';

/** The package root the installer reads from; the real root while unset. */
const packageRoot = vi.hoisted(() => ({ override: undefined as string | undefined }));

vi.mock('../src/core/paths.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/core/paths.js')>();
  return { ...actual, getPackageRoot: () => packageRoot.override ?? actual.getPackageRoot() };
});

/** The agent file an older release left, which starts the rewrite. */
const RETIRED_AGENT = 'code-fix';
/** Text that no compiled command equals, so a rewrite is visible on disk. */
const OLD_COMMAND_TEXT = '# command text from the older release\n';

/** One staged copy of the build is a few seconds of file copying. */
const STAGING_TIMEOUT_MS = 60_000;

let staged: StagedPackage;

beforeAll(async () => {
  staged = await stagePackage({ withVariantManifest: false });
  packageRoot.override = staged.root;
}, STAGING_TIMEOUT_MS);

afterAll(async () => {
  packageRoot.override = undefined;
  await staged.remove();
});

describe('the rewrite after a selective uninstall passes the compliance switch of the manifest', () => {
  let home: string;
  let warn: ReturnType<typeof vi.spyOn>;
  let info: ReturnType<typeof vi.spyOn>;

  const claudeDir = (): string => path.join(home, '.claude');
  const devflowDir = (): string => path.join(home, '.devflow');
  const commandFile = (): string => path.join(claudeDir(), 'commands', 'devflow', 'implement.md');
  const agentsDir = (): string => path.join(claudeDir(), 'agents', 'devflow');
  const lines = (spy: { mock: { calls: readonly (readonly unknown[])[] } }): string[] => spy.mock.calls.map(call => String(call[0]));

  beforeEach(async () => {
    home = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-uninstall-compliance-')));
    warn = vi.spyOn(p.log, 'warn').mockImplementation(() => undefined);
    info = vi.spyOn(p.log, 'info').mockImplementation(() => undefined);
    await fs.mkdir(path.dirname(commandFile()), { recursive: true });
    await fs.writeFile(commandFile(), OLD_COMMAND_TEXT, 'utf-8');
  });

  afterEach(async () => {
    await fs.rm(home, { recursive: true, force: true });
  });

  async function writeManifest(compliance: { enabled: boolean; frameworks: string[] }): Promise<void> {
    await fs.mkdir(devflowDir(), { recursive: true });
    await fs.writeFile(path.join(devflowDir(), 'manifest.json'), JSON.stringify({
      version: '3.5.0',
      plugins: ['devflow-implement'],
      scope: 'user',
      features: { ambient: false, memory: false, compliance },
      installedAt: 'x',
      updatedAt: 'x',
    }), 'utf-8');
  }

  function refresh(): Promise<void> {
    const retained = DEVFLOW_PLUGINS.filter(plugin => plugin.name === 'devflow-implement');
    expect(retained, 'the registry holds devflow-implement once').toHaveLength(1);
    return refreshRetainedCommandsAndAgents({
      claudeDir: claudeDir(),
      devflowDir: devflowDir(),
      retained,
      retiredAgents: [RETIRED_AGENT],
    });
  }

  it('writes nothing for a compliance-off machine whose package has no variant manifest, and names the manifest', async () => {
    await writeManifest({ enabled: false, frameworks: [] });

    await refresh();

    expect(await fs.readFile(commandFile(), 'utf-8'), 'the command is as it was').toBe(OLD_COMMAND_TEXT);
    await expect(fs.stat(agentsDir()), 'no agent was written').rejects.toMatchObject({ code: 'ENOENT' });
    expect(lines(info).filter(line => line.includes('wrote the current commands')), 'no success note').toEqual([]);
    const warned = lines(warn).filter(line => line.includes(RETIRED_AGENT));
    expect(warned, 'one warning names the removed agent file').toHaveLength(1);
    expect(warned[0], 'the warning names the missing manifest').toContain(VARIANT_MANIFEST_REL_PATH);
  });

  it('rewrites the commands and agents for a compliance-on machine from the same package, which needs no variant manifest', async () => {
    await writeManifest({ enabled: true, frameworks: ['gdpr'] });

    await refresh();

    expect(await fs.readFile(commandFile(), 'utf-8'), 'the command was rewritten').not.toBe(OLD_COMMAND_TEXT);
    expect((await fs.readdir(agentsDir())).length, 'the agents were written').toBeGreaterThan(0);
    expect(lines(info).filter(line => line.includes('wrote the current commands and agents')), 'the note').toHaveLength(1);
    expect(lines(warn)).toEqual([]);
  });
});
