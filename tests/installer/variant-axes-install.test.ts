/**
 * The compliance-off install refusal and the variant a machine installs, against a
 * fake package root (TP-9, TP-10, TP-11).
 *
 * With compliance off the installer reads the variant manifest (dist/variant-axes.json)
 * and refuses, before it writes any file, when the manifest is absent or invalid or when
 * a prompt that carries a compliance arm has no file for the machine's EXACT switches. A
 * both-off machine needs the file built for both axes and never falls through to the
 * curation-off file. A prompt with no compliance arm falls through to its normal file.
 *
 * Every install here runs against a temp CLAUDE dir, a temp devflow dir and a temp package
 * root that this file seeds, so nothing reads the real build state and nothing touches the
 * real HOME. A refusal is shown by a snapshot of both install dirs, with files already in
 * them, taken before and after: the refused run must leave the tree byte for byte as it was,
 * which also proves the pre-clean of a full install did not run.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  installCommandsAndAgents,
  installViaFileCopy,
  type Spinner,
} from '../../src/targets/claude-code/installer.js';
import type { AgentSourceDirs } from '../../src/core/assets.js';
import { renderVariantManifest, type VariantManifestHost } from '../../src/core/curation-variants.js';
import { buildAssetMaps, type PluginDefinition } from '../../src/core/plugins.js';
import { TRACKER_MCP_SERVERS_DEFAULT } from '../../src/core/tracker.js';
import { assertTempHome } from '../setup/home-isolation.js';
import { testBackups } from '../helpers.js';

const noopSpinner: Spinner = { start() {}, stop() {}, message() {} };

/** The deepest directory the snapshot descends; the seeded trees are far shallower. */
const MAX_SNAPSHOT_DEPTH = 8;

/** Where each off variant lives, spelled out so a wrong tree in the owner is not copied here. */
const TREE = {
  curationOff: 'dist/curation-off',
  complianceOff: 'dist/compliance-off',
  bothOff: 'dist/curation-compliance-off',
} as const;

type Variant = 'ON' | 'CURATION-OFF' | 'COMPLIANCE-OFF' | 'BOTH-OFF' | 'SRC';

/** The text a fixture file holds: its own name and the variant it stands for. */
const text = (name: string, variant: Variant): string => `${name} ${variant}\n`;

const host = (
  kind: 'commands' | 'agents',
  name: string,
  curation: boolean,
  compliance: boolean,
): VariantManifestHost => ({ kind, name, axes: { curation, compliance } });

/**
 * The fixture roster, by arms:
 *   commands/implement and agents/code  carry both arms
 *   commands/plan                       carries a compliance arm only
 *   commands/debug                      carries a curation arm only
 *   agents/fix                          carries none
 * agents/evaluate is hand-authored: it is in src/assets/agents and not in the manifest.
 * Every name is a registry name, because the install sweeps the names the registry lacks.
 */
const ROSTER: readonly VariantManifestHost[] = [
  host('commands', 'implement', true, true),
  host('commands', 'plan', false, true),
  host('commands', 'debug', true, false),
  host('agents', 'code', true, true),
  host('agents', 'fix', false, false),
];

const PLUGIN: PluginDefinition = {
  name: 'devflow-variant-axes-fixture',
  description: 'Test fixture for the compliance-off install refusal',
  commands: ['/implement', '/plan', '/debug'],
  agents: ['code', 'fix', 'evaluate'],
  skills: [],
  requires: [],
  optional: false,
  rules: [],
};

let tmp: string;
let claudeDir: string;
let devflowDir: string;
let pkg: string;
let warnings: string[];

const warn = (msg: string): void => { warnings.push(msg); };

async function write(file: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content, 'utf-8');
}

async function exists(file: string): Promise<boolean> {
  try { await fs.access(file); return true; } catch { return false; }
}

const inPkg = (rel: string): string => path.join(pkg, ...rel.split('/'));
const installedCommand = (name: string): string => path.join(claudeDir, 'commands', 'devflow', `${name}.md`);
const installedAgent = (name: string): string => path.join(claudeDir, 'agents', 'devflow', `${name}.md`);
const manifestFile = (): string => inPkg('dist/variant-axes.json');

async function writeManifest(hosts: readonly VariantManifestHost[] = ROSTER): Promise<void> {
  const rendered = renderVariantManifest(hosts);
  if (!rendered.ok) throw new Error(`fixture manifest refused: ${JSON.stringify(rendered.error)}`);
  await write(manifestFile(), rendered.value);
}

/**
 * Seed the package root: the normal file of every roster host, an off file for each variant a
 * host with those arms gets (a curation-only host gets curation-off, a compliance-only host
 * compliance-off, a host with both gets all three), and evaluate under src.
 */
async function seedPackage(): Promise<void> {
  for (const { kind, name, axes } of ROSTER) {
    await write(inPkg(`dist/${kind}/${name}.md`), text(name, 'ON'));
    if (axes.curation) await write(inPkg(`${TREE.curationOff}/${kind}/${name}.md`), text(name, 'CURATION-OFF'));
    if (axes.compliance) await write(inPkg(`${TREE.complianceOff}/${kind}/${name}.md`), text(name, 'COMPLIANCE-OFF'));
    if (axes.curation && axes.compliance) await write(inPkg(`${TREE.bothOff}/${kind}/${name}.md`), text(name, 'BOTH-OFF'));
  }
  await write(inPkg(path.posix.join('src', 'assets', 'agents', 'evaluate.md')), text('evaluate', 'SRC'));
  await writeManifest();
}

/** Files already installed, so a pre-clean or an overwrite by a refused run would show. */
async function seedInstalled(): Promise<void> {
  await write(installedCommand('implement'), 'OLD implement\n');
  await write(installedCommand('stale'), 'OLD stale\n');
  await write(installedAgent('code'), 'OLD code\n');
  await write(path.join(claudeDir, 'rules', 'devflow', 'old.md'), 'OLD rule\n');
}

/** Every directory and file below `root`, keyed by relative path, with file text as the value. */
async function snapshot(root: string, dir: string = root, depth = 0): Promise<Record<string, string>> {
  if (depth > MAX_SNAPSHOT_DEPTH) throw new Error(`snapshot deeper than ${MAX_SNAPSHOT_DEPTH} under ${root}`);
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return {};
  }
  const out: Record<string, string> = {};
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(root, full);
    if (entry.isDirectory()) {
      out[`${rel}/`] = '';
      Object.assign(out, await snapshot(root, full, depth + 1));
    } else {
      out[rel] = await fs.readFile(full, 'utf-8');
    }
  }
  return out;
}

async function snapshotBoth(): Promise<{ claude: Record<string, string>; devflow: Record<string, string> }> {
  return { claude: await snapshot(claudeDir), devflow: await snapshot(devflowDir) };
}

interface Machine {
  curation: boolean;
  compliance: boolean;
  isPartialInstall?: boolean;
  agentSourceDirs?: AgentSourceDirs;
}

async function install(machine: Machine): Promise<unknown> {
  return installViaFileCopy({
    backups: await testBackups(tmp, { claudeDir, devflowDir }),
    plugins: [PLUGIN],
    claudeDir,
    devflowDir,
    skillsMap: new Map(),
    agentsMap: buildAssetMaps([PLUGIN]).agentsMap,
    isPartialInstall: machine.isPartialInstall ?? false,
    spinner: noopSpinner,
    curation: machine.curation,
    compliance: machine.compliance,
    packageRoot: pkg,
    agentSourceDirs: machine.agentSourceDirs,
    warn,
  });
}

/** Run `run`, require that it is refused, require that it left both install dirs as they were, and return the message. */
async function expectRefused(run: () => Promise<unknown>): Promise<string> {
  const before = await snapshotBoth();
  const error = await run().then(() => null, (caught: unknown) => caught);
  expect(error, 'the install must be refused').toBeInstanceOf(Error);
  expect(await snapshotBoth(), 'a refused install must write nothing').toEqual(before);
  return (error as Error).message;
}

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-variant-axes-install-'));
  expect(() => assertTempHome(tmp)).not.toThrow();
  claudeDir = path.join(tmp, 'claude');
  devflowDir = path.join(tmp, 'devflow');
  pkg = path.join(tmp, 'pkg');
  warnings = [];
  await fs.mkdir(claudeDir, { recursive: true });
  await fs.mkdir(devflowDir, { recursive: true });
  await seedPackage();
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Which file each machine installs (TP-10 and TP-11, the install that is allowed)
// ---------------------------------------------------------------------------

describe('the variant each machine installs', () => {
  const MACHINES: ReadonlyArray<{
    readonly label: string;
    readonly curation: boolean;
    readonly compliance: boolean;
    readonly expected: Readonly<Record<'implement' | 'plan' | 'debug' | 'code' | 'fix' | 'evaluate', Variant>>;
  }> = [
    {
      label: 'curation on, compliance on',
      curation: true,
      compliance: true,
      expected: { implement: 'ON', plan: 'ON', debug: 'ON', code: 'ON', fix: 'ON', evaluate: 'SRC' },
    },
    {
      label: 'curation off, compliance on',
      curation: false,
      compliance: true,
      expected: { implement: 'CURATION-OFF', plan: 'ON', debug: 'CURATION-OFF', code: 'CURATION-OFF', fix: 'ON', evaluate: 'SRC' },
    },
    {
      label: 'curation on, compliance off',
      curation: true,
      compliance: false,
      expected: { implement: 'COMPLIANCE-OFF', plan: 'COMPLIANCE-OFF', debug: 'ON', code: 'COMPLIANCE-OFF', fix: 'ON', evaluate: 'SRC' },
    },
    {
      label: 'curation off, compliance off',
      curation: false,
      compliance: false,
      expected: { implement: 'BOTH-OFF', plan: 'COMPLIANCE-OFF', debug: 'CURATION-OFF', code: 'BOTH-OFF', fix: 'ON', evaluate: 'SRC' },
    },
  ];

  for (const { label, curation, compliance, expected } of MACHINES) {
    it(`${label}: each prompt comes from the file for the machine's exact switches`, async () => {
      await install({ curation, compliance });

      for (const name of ['implement', 'plan', 'debug'] as const) {
        expect(await fs.readFile(installedCommand(name), 'utf-8'), `command ${name}`).toBe(text(name, expected[name]));
      }
      for (const name of ['code', 'fix', 'evaluate'] as const) {
        expect(await fs.readFile(installedAgent(name), 'utf-8'), `agent ${name}`).toBe(text(name, expected[name]));
      }
    });
  }

  it('compliance on reads no manifest: the install succeeds with none in the package', async () => {
    await fs.rm(manifestFile());
    expect(await exists(manifestFile()), 'the fixture must have no manifest').toBe(false);

    await install({ curation: true, compliance: true });

    expect(await fs.readFile(installedAgent('code'), 'utf-8')).toBe(text('code', 'ON'));
  });

  it('compliance on reads no manifest even when the one in the package is not valid', async () => {
    await write(manifestFile(), 'not json {');

    await install({ curation: false, compliance: true });

    expect(await fs.readFile(installedAgent('code'), 'utf-8')).toBe(text('code', 'CURATION-OFF'));
  });
});

// ---------------------------------------------------------------------------
// TP-9: compliance off refuses before any file is written
// ---------------------------------------------------------------------------

describe('compliance off refuses an install whose variant manifest cannot be trusted (TP-9)', () => {
  beforeEach(async () => {
    await seedInstalled();
  });

  it('a missing manifest refuses the install, names the file and the build step, and writes nothing', async () => {
    await fs.rm(manifestFile());

    const message = await expectRefused(() => install({ curation: true, compliance: false }));

    expect(message).toContain('Variant manifest does not exist');
    expect(message).toContain(manifestFile());
    expect(message).toContain('npm run build:mds');
    expect(await fs.readFile(installedAgent('code'), 'utf-8'), 'the installed file is as it was').toBe('OLD code\n');
  });

  it('a manifest that cannot be read refuses the install', async () => {
    await fs.rm(manifestFile());
    await fs.mkdir(manifestFile());

    const message = await expectRefused(() => install({ curation: true, compliance: false }));

    expect(message).toContain('Variant manifest cannot be read');
  });

  it.each([
    ['text that is not JSON', 'not json {', 'the text is not JSON'],
    ['a version other than 1', '{"version":2,"hosts":{}}', 'the version is not 1'],
    ['a host key that climbs out of the tree', '{"version":1,"hosts":{"agents/../x":{"curation":true,"compliance":true}}}', 'agents/../x'],
    ['a host with one axis missing', '{"version":1,"hosts":{"agents/code":{"curation":true}}}', 'agents/code'],
  ])('known-bad probe: %s refuses the install and writes nothing', async (_label, content, reason) => {
    await write(manifestFile(), content);

    const message = await expectRefused(() => install({ curation: true, compliance: false }));

    expect(message).toContain('Variant manifest is not valid');
    expect(message).toContain(manifestFile());
    expect(message).toContain(reason);
  });

  it('a compliance-armed prompt with no compliance-off file refuses the install, though its normal file exists', async () => {
    expect(await exists(inPkg('dist/agents/code.md')), 'the normal file is there to be installed wrongly').toBe(true);
    await fs.rm(inPkg(`${TREE.complianceOff}/agents/code.md`));

    const message = await expectRefused(() => install({ curation: true, compliance: false }));

    expect(message).toContain(`${TREE.complianceOff}/agents/code.md`);
    expect(message).not.toContain(`${TREE.complianceOff}/commands/implement.md`);
    expect(message).toContain('no file was written');
    expect(await fs.readFile(installedAgent('code'), 'utf-8')).toBe('OLD code\n');
  });

  it('a partial install is refused the same way', async () => {
    await fs.rm(manifestFile());

    const message = await expectRefused(() => install({ curation: true, compliance: false, isPartialInstall: true }));

    expect(message).toContain('Variant manifest does not exist');
  });

  it('control: a partial install with the manifest and every file present installs the compliance-off files', async () => {
    await install({ curation: true, compliance: false, isPartialInstall: true });

    expect(await fs.readFile(installedCommand('implement'), 'utf-8')).toBe(text('implement', 'COMPLIANCE-OFF'));
    expect(await fs.readFile(installedAgent('code'), 'utf-8')).toBe(text('code', 'COMPLIANCE-OFF'));
  });

  it('the copy alone, as the selective uninstall reaches it, is refused before it writes', async () => {
    await fs.rm(inPkg(`${TREE.complianceOff}/commands/implement.md`));

    const message = await expectRefused(() => installCommandsAndAgents({
      plugins: [PLUGIN],
      agentsMap: buildAssetMaps([PLUGIN]).agentsMap,
      claudeDir,
      curation: true,
      compliance: false,
      packageRoot: pkg,
      trackerServers: TRACKER_MCP_SERVERS_DEFAULT,
      warn,
    }));

    expect(message).toContain(`${TREE.complianceOff}/commands/implement.md`);
  });

  it('the copy alone installs the compliance-off files when every one is there', async () => {
    await installCommandsAndAgents({
      plugins: [PLUGIN],
      agentsMap: buildAssetMaps([PLUGIN]).agentsMap,
      claudeDir,
      curation: true,
      compliance: false,
      packageRoot: pkg,
      trackerServers: TRACKER_MCP_SERVERS_DEFAULT,
      warn,
    });

    expect(await fs.readFile(installedCommand('implement'), 'utf-8')).toBe(text('implement', 'COMPLIANCE-OFF'));
    expect(await fs.readFile(installedAgent('code'), 'utf-8')).toBe(text('code', 'COMPLIANCE-OFF'));
  });

  it('checks every compliance-armed prompt in the manifest, not only the selected ones, and names at most five', async () => {
    const extras = [1, 2, 3, 4, 5, 6, 7].map(n => host('commands', `extra-${n}`, false, true));
    await writeManifest([...ROSTER, ...extras]);

    const message = await expectRefused(() => install({ curation: true, compliance: false }));

    expect(message).toContain('Variant file not found for 7 prompt(s)');
    expect(message).toContain(`${TREE.complianceOff}/commands/extra-1.md`);
    expect(message).toContain(`${TREE.complianceOff}/commands/extra-5.md`);
    expect(message).not.toContain('extra-6.md');
    expect(message).toContain('and 2 more');
  });

  it('control: the same extra prompts, with their compliance-off files present, do not stop the install', async () => {
    const extras = [1, 2, 3, 4, 5, 6, 7].map(n => host('commands', `extra-${n}`, false, true));
    await writeManifest([...ROSTER, ...extras]);
    for (const { name } of extras) {
      await write(inPkg(`${TREE.complianceOff}/commands/${name}.md`), text(name, 'COMPLIANCE-OFF'));
    }

    await install({ curation: true, compliance: false });

    expect(await fs.readFile(installedAgent('code'), 'utf-8')).toBe(text('code', 'COMPLIANCE-OFF'));
    expect(await fs.readFile(installedCommand('plan'), 'utf-8')).toBe(text('plan', 'COMPLIANCE-OFF'));
  });
});

// ---------------------------------------------------------------------------
// TP-10: a both-off machine finds the file for both axes, or refuses
// ---------------------------------------------------------------------------

describe('a both-off machine never falls through to the curation-off file (TP-10)', () => {
  beforeEach(async () => {
    await seedInstalled();
  });

  it('refuses when a prompt with both arms has no both-off file, though its curation-off file exists', async () => {
    expect(await exists(inPkg(`${TREE.curationOff}/agents/code.md`)), 'the curation-off file is there to be installed wrongly').toBe(true);
    expect(await exists(inPkg(`${TREE.complianceOff}/agents/code.md`))).toBe(true);
    await fs.rm(inPkg(`${TREE.bothOff}/agents/code.md`));

    const message = await expectRefused(() => install({ curation: false, compliance: false }));

    expect(message).toContain(`${TREE.bothOff}/agents/code.md`);
    expect(message).toContain('curation off and compliance off');
    expect(await fs.readFile(installedAgent('code'), 'utf-8'), 'the curation-off bytes were never installed').toBe('OLD code\n');
  });

  it('refuses the same way for a command with both arms', async () => {
    await fs.rm(inPkg(`${TREE.bothOff}/commands/implement.md`));

    const message = await expectRefused(() => install({ curation: false, compliance: false }));

    expect(message).toContain(`${TREE.bothOff}/commands/implement.md`);
    expect(await fs.readFile(installedCommand('implement'), 'utf-8')).toBe('OLD implement\n');
  });

  it('a prompt with only a compliance arm needs its compliance-off file, and refuses without it', async () => {
    expect(await exists(inPkg('dist/commands/plan.md'))).toBe(true);
    await fs.rm(inPkg(`${TREE.complianceOff}/commands/plan.md`));

    const message = await expectRefused(() => install({ curation: false, compliance: false }));

    expect(message).toContain(`${TREE.complianceOff}/commands/plan.md`);
  });

  it('a prompt with only a curation arm is not checked: it installs its curation-off file', async () => {
    await install({ curation: false, compliance: false });

    expect(await fs.readFile(installedCommand('debug'), 'utf-8')).toBe(text('debug', 'CURATION-OFF'));
  });

  it('known-bad probe: a machine with curation off and compliance on does install the curation-off file for that prompt', async () => {
    await fs.rm(inPkg(`${TREE.bothOff}/agents/code.md`));

    await install({ curation: false, compliance: true });

    expect(await fs.readFile(installedAgent('code'), 'utf-8')).toBe(text('code', 'CURATION-OFF'));
  });
});

// ---------------------------------------------------------------------------
// The file the copy takes is the file the check required
// ---------------------------------------------------------------------------

describe('a compliance-armed prompt installs the file the check required', () => {
  beforeEach(async () => {
    await seedInstalled();
  });

  /** The same roster with agents/fix made a prompt that carries a compliance arm only. */
  async function writeComplianceOnlyAgentManifest(): Promise<void> {
    await writeManifest(ROSTER.map(({ kind, name, axes }) => (
      kind === 'agents' && name === 'fix' ? host(kind, name, false, true) : host(kind, name, axes.curation, axes.compliance)
    )));
    await write(inPkg(`${TREE.complianceOff}/agents/fix.md`), text('fix', 'COMPLIANCE-OFF'));
  }

  it('a both-off machine refuses a command whose compliance-off file is shadowed by a curation-off file', async () => {
    await write(inPkg(`${TREE.curationOff}/commands/plan.md`), text('plan', 'CURATION-OFF'));

    const message = await expectRefused(() => install({ curation: false, compliance: false }));

    expect(message).toContain(`${TREE.complianceOff}/commands/plan.md`);
    expect(message).toContain(`${TREE.curationOff}/commands/plan.md`);
    expect(message).toContain('npm run build:mds');
    expect(message).toContain('no file was written');
    expect(await fs.readFile(installedCommand('implement'), 'utf-8')).toBe('OLD implement\n');
  });

  it('a both-off machine refuses an agent whose compliance-off file is shadowed by a curation-off file', async () => {
    await writeComplianceOnlyAgentManifest();
    await write(inPkg(`${TREE.curationOff}/agents/fix.md`), text('fix', 'CURATION-OFF'));

    const message = await expectRefused(() => install({ curation: false, compliance: false }));

    expect(message).toContain(`${TREE.complianceOff}/agents/fix.md`);
    expect(message).toContain(`${TREE.curationOff}/agents/fix.md`);
    expect(message).toContain('npm run build:mds');
    expect(await fs.readFile(installedAgent('code'), 'utf-8')).toBe('OLD code\n');
  });

  it('the copy alone refuses a shadowed compliance-off file before it writes', async () => {
    await write(inPkg(`${TREE.curationOff}/commands/plan.md`), text('plan', 'CURATION-OFF'));

    const message = await expectRefused(() => installCommandsAndAgents({
      plugins: [PLUGIN],
      agentsMap: buildAssetMaps([PLUGIN]).agentsMap,
      claudeDir,
      curation: false,
      compliance: false,
      packageRoot: pkg,
      trackerServers: TRACKER_MCP_SERVERS_DEFAULT,
      warn,
    }));

    expect(message).toContain(`${TREE.curationOff}/commands/plan.md`);
  });

  it('an injected agent list that reaches another file first is refused', async () => {
    const injected: AgentSourceDirs = [inPkg('dist/agents'), inPkg('src/assets/agents')];

    const message = await expectRefused(() => install({ curation: true, compliance: false, agentSourceDirs: injected }));

    expect(message).toContain(`${TREE.complianceOff}/agents/code.md`);
    expect(message).toContain('dist/agents/code.md');
  });

  it('control: an injected agent list that reaches the required file first installs it', async () => {
    const injected: AgentSourceDirs = [inPkg(`${TREE.complianceOff}/agents`), inPkg('dist/agents'), inPkg('src/assets/agents')];

    await install({ curation: true, compliance: false, agentSourceDirs: injected });

    expect(await fs.readFile(installedAgent('code'), 'utf-8')).toBe(text('code', 'COMPLIANCE-OFF'));
    expect(await fs.readFile(installedAgent('evaluate'), 'utf-8')).toBe(text('evaluate', 'SRC'));
  });

  it('control: a both-off machine installs the compliance-off files of the prompts that carry only that arm', async () => {
    await writeComplianceOnlyAgentManifest();

    await install({ curation: false, compliance: false });

    expect(await fs.readFile(installedCommand('plan'), 'utf-8')).toBe(text('plan', 'COMPLIANCE-OFF'));
    expect(await fs.readFile(installedAgent('fix'), 'utf-8')).toBe(text('fix', 'COMPLIANCE-OFF'));
    expect(await fs.readFile(installedCommand('implement'), 'utf-8')).toBe(text('implement', 'BOTH-OFF'));
    expect(await fs.readFile(installedAgent('code'), 'utf-8')).toBe(text('code', 'BOTH-OFF'));
  });
});

// ---------------------------------------------------------------------------
// TP-11: a prompt with no compliance arm falls through to its normal file
// ---------------------------------------------------------------------------

describe('a prompt with no compliance arm falls through with compliance off (TP-11)', () => {
  it('a curation-only prompt installs its normal file on a machine with curation on', async () => {
    expect(await exists(inPkg(`${TREE.curationOff}/commands/debug.md`)), 'its curation-off file must not be chosen').toBe(true);

    await install({ curation: true, compliance: false });

    expect(await fs.readFile(installedCommand('debug'), 'utf-8')).toBe(text('debug', 'ON'));
  });

  it('a prompt with no arm and a hand-authored agent absent from the manifest install their one file', async () => {
    await install({ curation: true, compliance: false });

    expect(await fs.readFile(installedAgent('fix'), 'utf-8')).toBe(text('fix', 'ON'));
    expect(await fs.readFile(installedAgent('evaluate'), 'utf-8')).toBe(text('evaluate', 'SRC'));
  });

  it('a manifest with no compliance arm and no compliance tree installs on both curation settings', async () => {
    const noCompliance = ROSTER.map(({ kind, name, axes }) => host(kind, name, axes.curation, false));
    await writeManifest(noCompliance);
    await fs.rm(inPkg(TREE.complianceOff), { recursive: true });
    await fs.rm(inPkg(TREE.bothOff), { recursive: true });

    await install({ curation: true, compliance: false });
    expect(await fs.readFile(installedCommand('implement'), 'utf-8')).toBe(text('implement', 'ON'));
    expect(await fs.readFile(installedAgent('code'), 'utf-8')).toBe(text('code', 'ON'));

    await install({ curation: false, compliance: false });
    expect(await fs.readFile(installedCommand('implement'), 'utf-8')).toBe(text('implement', 'CURATION-OFF'));
    expect(await fs.readFile(installedAgent('code'), 'utf-8')).toBe(text('code', 'CURATION-OFF'));
    expect(await fs.readFile(installedAgent('fix'), 'utf-8')).toBe(text('fix', 'ON'));
  });
});
