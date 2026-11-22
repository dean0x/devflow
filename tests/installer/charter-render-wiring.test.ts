/**
 * D-CHARTER-INSTALL-RENDER wiring: the install-time charter render has ONE writer.
 *
 * `composeScripts` copies the packaged scripts verbatim and skips the orchestrator charter;
 * `installRenderedCharter` writes it. This file holds the wiring around that writer:
 *
 *   - `copyDirectory` skips an explicit set of source paths and still copies everything when none is given;
 *   - `composeScripts` never writes the charter, and never puts the full source over a render;
 *   - `installViaFileCopy` renders from the EFFECTIVE selection, reruns write nothing, and a render that
 *     fails warns without aborting the install;
 *   - `init --hud-only` renders from the manifest record, and from the empty set when there is none;
 *   - `uninstall --plugin` renders from the manifest record minus the removed plugins; without a record it
 *     leaves the charter as it is.
 *
 * The renders themselves, over every plugin set, are held by tests/installer/charter-render.test.ts. The
 * built CLI end to end is held by tests/installer/charter-render-e2e.test.ts.
 *
 * HOME safety: every install uses a temporary directory. The HUD-only command runs in the test process.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync, realpathSync, promises as fs } from 'fs';
import { createRequire } from 'node:module';
import * as os from 'os';
import * as path from 'path';
import * as p from '@clack/prompts';

import { scriptsDir as packagedScriptsDir } from '../../src/core/assets.js';
import { ALL_SWITCHES_ON } from '../../src/core/curation-variants.js';
import {
  DELETED_PLUGIN_NAMES,
  DEVFLOW_PLUGINS,
  LEGACY_PLUGIN_NAMES,
  buildScopedSkillsMap,
  type PluginDefinition,
} from '../../src/core/plugins.js';
import { readManifestPlugins, writeManifest } from '../../src/core/manifest.js';
import * as claudePaths from '../../src/targets/claude-code/claude-paths.js';
import {
  composeScripts,
  copyDirectory,
  installScripts,
  installViaFileCopy,
  type Spinner,
} from '../../src/targets/claude-code/installer.js';
import {
  CHARTER_RELPATH,
  charterInventory,
  installRenderedCharter,
  renderCharter,
} from '../../src/targets/claude-code/charter-render.js';
import { hudOnlyCharterPlugins, initCommand } from '../../src/cli/commands/init.js';
import { charterPluginsAfterRemoval, runSelectivePhaseForScope } from '../../src/cli/commands/uninstall.js';
import { makeManifest, testBackups } from '../helpers.js';
import { systemManagedSettingsAtRisk } from '../helpers/managed-settings.js';
import { assertTempHome } from '../setup/home-isolation.js';

vi.mock('node:module', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:module')>();
  return { ...original, createRequire: vi.fn(original.createRequire) };
});

const noopSpinner: Spinner = { start() {}, stop() {}, message() {} };
const CODEX_PATH_WARNING = 'The HUD cannot use the saved Codex usage tool path. ' +
  'Reinstall devflow-kit with umask 022 or in a trusted location. Run devflow init again.';

const SOURCE = readFileSync(path.join(packagedScriptsDir(), CHARTER_RELPATH), 'utf-8');

const plugin = (name: string): PluginDefinition => {
  const found = DEVFLOW_PLUGINS.find(p => p.name === name);
  if (found === undefined) throw new Error(`no such plugin: ${name}`);
  return found;
};

const CORE = plugin('devflow-core-skills');
const AMBIENT = plugin('devflow-ambient');
const IMPLEMENT = plugin('devflow-implement');
const REVIEW = plugin('devflow-code-review');
const PLAN = plugin('devflow-plan');
const BUG_ANALYSIS = plugin('devflow-bug-analysis');

/** The charter as the installer renders it for a plugin set (the render is tested over every set elsewhere). */
function rendered(plugins: ReadonlyArray<PluginDefinition>): string {
  const inventory = charterInventory(plugins.map(p => p.name));
  const result = renderCharter(SOURCE, inventory.commands, inventory.agents);
  if (!result.ok) throw new Error(`render failed for the test oracle: ${result.reason} ${result.span}`);
  return result.content;
}

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-charter-wiring-'));
});

afterEach(async () => {
  vi.mocked(createRequire).mockReset();
  await fs.rm(root, { recursive: true, force: true });
});

const exists = (file: string): Promise<boolean> => fs.access(file).then(() => true, () => false);

function expectedCodexBin(): string {
  const manifest = createRequire(import.meta.url).resolve('@dean0x/tokenmeter/package.json');
  return realpathSync(path.join(path.dirname(manifest), 'bin', 'tokenmeter.js'));
}

async function snapshot(file: string): Promise<{ bytes: string; mtimeMs: number; mode: number }> {
  const stat = await fs.stat(file);
  return { bytes: await fs.readFile(file, 'utf-8'), mtimeMs: stat.mtimeMs, mode: stat.mode & 0o777 };
}

// ---------------------------------------------------------------------------
// copyDirectory: the optional exclude set
// ---------------------------------------------------------------------------

describe('copyDirectory skips the source paths it is told to', () => {
  let src: string;
  let dest: string;

  beforeEach(async () => {
    src = path.join(root, 'src');
    dest = path.join(root, 'dest');
    await fs.mkdir(path.join(src, 'sub', 'deep'), { recursive: true });
    await fs.writeFile(path.join(src, 'top.txt'), 'top', 'utf-8');
    await fs.writeFile(path.join(src, 'sub', 'keep.txt'), 'keep', 'utf-8');
    await fs.writeFile(path.join(src, 'sub', 'skip.txt'), 'skip', 'utf-8');
    await fs.writeFile(path.join(src, 'sub', 'deep', 'inner.txt'), 'inner', 'utf-8');
  });

  it('copies the whole tree when no exclude set is given', async () => {
    await copyDirectory(src, dest);
    expect(await fs.readFile(path.join(dest, 'top.txt'), 'utf-8')).toBe('top');
    expect(await fs.readFile(path.join(dest, 'sub', 'skip.txt'), 'utf-8')).toBe('skip');
    expect(await fs.readFile(path.join(dest, 'sub', 'deep', 'inner.txt'), 'utf-8')).toBe('inner');
  });

  it('skips an excluded file at depth and copies its siblings', async () => {
    await copyDirectory(src, dest, new Set([path.join(src, 'sub', 'skip.txt')]));
    expect(await exists(path.join(dest, 'sub', 'skip.txt'))).toBe(false);
    expect(await fs.readFile(path.join(dest, 'sub', 'keep.txt'), 'utf-8')).toBe('keep');
    expect(await fs.readFile(path.join(dest, 'top.txt'), 'utf-8')).toBe('top');
  });

  it('skips an excluded directory with everything below it', async () => {
    await copyDirectory(src, dest, new Set([path.join(src, 'sub', 'deep')]));
    expect(await exists(path.join(dest, 'sub', 'deep'))).toBe(false);
    expect(await exists(path.join(dest, 'sub', 'keep.txt'))).toBe(true);
  });

  it('matches whole source paths, not names: the same file name elsewhere is still copied', async () => {
    await fs.writeFile(path.join(src, 'sub', 'top.txt'), 'nested', 'utf-8');
    await copyDirectory(src, dest, new Set([path.join(src, 'top.txt')]));
    expect(await exists(path.join(dest, 'top.txt'))).toBe(false);
    expect(await fs.readFile(path.join(dest, 'sub', 'top.txt'), 'utf-8')).toBe('nested');
  });

  it('never changes the source tree', async () => {
    await copyDirectory(src, dest, new Set([path.join(src, 'sub', 'skip.txt')]));
    expect(await fs.readFile(path.join(src, 'sub', 'skip.txt'), 'utf-8')).toBe('skip');
  });
});

// ---------------------------------------------------------------------------
// composeScripts is not a writer of the charter
// ---------------------------------------------------------------------------

describe('composeScripts: the verbatim script copy does not write the charter', () => {
  let scripts: string;
  const charterAt = (): string => path.join(scripts, CHARTER_RELPATH);

  beforeEach(() => {
    scripts = path.join(root, 'scripts');
  });

  it('copies the other scripts and leaves no charter behind', async () => {
    await composeScripts(scripts);
    expect(await exists(path.join(scripts, 'hooks', 'run-hook'))).toBe(true);
    expect(await exists(path.join(scripts, 'hud.sh'))).toBe(true);
    expect(await exists(charterAt())).toBe(false);
  });

  it('the render writes the charter, executable, and a second render changes nothing', async () => {
    await composeScripts(scripts);
    const warnings: string[] = [];
    const first = await installRenderedCharter({
      scriptsDir: scripts, plugins: [CORE, AMBIENT, IMPLEMENT], warn: m => warnings.push(m), mode: 'install',
    });
    expect(first).toEqual({ charter: 'rewritten' });
    expect(warnings).toEqual([]);

    const charter = await snapshot(charterAt());
    expect(charter.mode).toBe(0o755);

    const second = await installRenderedCharter({
      scriptsDir: scripts, plugins: [CORE, AMBIENT, IMPLEMENT], warn: m => warnings.push(m), mode: 'install',
    });
    expect(second).toEqual({ charter: 'unchanged' });
    expect(await snapshot(charterAt())).toEqual(charter);
  });

  it('a script copy over a render leaves the render, its mtime and its mode untouched', async () => {
    await composeScripts(scripts);
    await installRenderedCharter({
      scriptsDir: scripts, plugins: [CORE, AMBIENT, REVIEW], warn: () => {}, mode: 'install',
    });
    const charter = await snapshot(charterAt());
    expect(charter.bytes, 'a set without implement renders shorter than the source').not.toBe(SOURCE);

    await composeScripts(scripts);

    expect(await snapshot(charterAt())).toEqual(charter);
  });
});

// ---------------------------------------------------------------------------
// installScripts: the one owner of the script copy and the render
// ---------------------------------------------------------------------------

describe('installScripts: the script copy and the charter render are one step', () => {
  let scripts: string;
  const charterAt = (): string => path.join(scripts, CHARTER_RELPATH);

  beforeEach(() => {
    scripts = path.join(root, 'scripts');
  });

  it('leaves a whole tree: the copied scripts and the rendered charter', async () => {
    const warnings: string[] = [];
    await installScripts({ devflowDir: root, scriptsTarget: scripts, plugins: [CORE, AMBIENT, IMPLEMENT], warn: m => warnings.push(m) });

    expect(await exists(path.join(scripts, 'hooks', 'run-hook'))).toBe(true);
    expect(await exists(path.join(scripts, 'hud.sh'))).toBe(true);
    expect(await fs.readFile(charterAt(), 'utf-8')).toBe(rendered([CORE, AMBIENT, IMPLEMENT]));
    expect(warnings).toEqual([]);
  });

  it('renders for the plugins it is given: a set without implement gets no route to it', async () => {
    await installScripts({ devflowDir: root, scriptsTarget: scripts, plugins: [CORE, AMBIENT, REVIEW], warn: () => {} });

    expect(await fs.readFile(charterAt(), 'utf-8')).toBe(rendered([CORE, AMBIENT, REVIEW]));
    expect(await fs.readFile(charterAt(), 'utf-8')).not.toContain('devflow:implement');
  });

  it('a charter the render cannot read warns, and the copied scripts are still there', async () => {
    await fs.mkdir(charterAt(), { recursive: true });
    const warnings: string[] = [];

    await expect(
      installScripts({ devflowDir: root, scriptsTarget: scripts, plugins: [CORE, AMBIENT, IMPLEMENT], warn: m => warnings.push(m) }),
    ).resolves.toBeUndefined();

    expect(warnings.some(w => w.includes('charter render:'))).toBe(true);
    expect(await exists(path.join(scripts, 'hooks', 'run-hook'))).toBe(true);
  });

  it('is the only way to the verbatim copy: no module outside the installer imports composeScripts', async () => {
    const srcRoot = path.resolve(import.meta.dirname, '../../src');
    const installerFile = path.join('targets', 'claude-code', 'installer.ts');
    const importsCopy = /import\s*(?:type\s*)?\{[^}]*\bcomposeScripts\b[^}]*\}\s*from/;
    const importers: string[] = [];
    for (const relative of await fs.readdir(srcRoot, { recursive: true })) {
      if (!relative.endsWith('.ts') || relative === installerFile) continue;
      if (importsCopy.test(await fs.readFile(path.join(srcRoot, relative), 'utf-8'))) importers.push(relative);
    }
    expect(importers, 'a caller that copies the scripts itself skips the charter render: call installScripts').toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// installViaFileCopy renders from the effective selection
// ---------------------------------------------------------------------------

describe('installViaFileCopy: the render is its own step after the script copy', () => {
  let claudeDir: string;
  let devflowDir: string;
  let warnings: string[];
  const charterAt = (): string => path.join(devflowDir, 'scripts', CHARTER_RELPATH);

  beforeEach(async () => {
    claudeDir = path.join(root, 'claude');
    devflowDir = path.join(root, 'devflow');
    await fs.mkdir(claudeDir, { recursive: true });
    await fs.mkdir(devflowDir, { recursive: true });
    warnings = [];
  });

  async function install(opts: {
    plugins: PluginDefinition[];
    effectivePlugins?: PluginDefinition[];
    isPartialInstall: boolean;
  }): Promise<void> {
    const effective = opts.effectivePlugins ?? opts.plugins;
    await installViaFileCopy({
      switches: ALL_SWITCHES_ON,
      plugins: opts.plugins,
      effectivePlugins: effective,
      claudeDir,
      devflowDir,
      skillsMap: buildScopedSkillsMap(effective),
      agentsMap: new Map(),
      isPartialInstall: opts.isPartialInstall,
      spinner: noopSpinner,
      warn: (msg) => { warnings.push(msg); },
      backups: await testBackups(root, { claudeDir, devflowDir }),
    });
  }

  it('a full install writes the charter rendered for its plugins', async () => {
    const plugins = [CORE, AMBIENT, IMPLEMENT, REVIEW];
    await install({ plugins, isPartialInstall: false });

    expect(await fs.readFile(charterAt(), 'utf-8')).toBe(rendered(plugins));
    expect(warnings).toEqual([]);
  });

  it('a full install saves the Codex usage bin path with mode 0600', async () => {
    const state = path.join(devflowDir, 'tokenmeter.json');

    await install({ plugins: [CORE, AMBIENT, IMPLEMENT], isPartialInstall: false });

    await expect(fs.readFile(state, 'utf8').then((text): unknown => JSON.parse(text)))
      .resolves.toEqual({ version: 1, binPath: expectedCodexBin() });
    expect((await fs.stat(state)).mode & 0o777).toBe(0o600);
  });

  it('warns when it cannot save the Codex usage tool path and completes the install', async () => {
    await fs.mkdir(path.join(devflowDir, 'tokenmeter.json'));

    await install({ plugins: [CORE, AMBIENT, IMPLEMENT], isPartialInstall: false });

    expect(warnings).toEqual(['Could not save the Codex usage tool path. Run devflow init again.']);
    expect(await exists(path.join(devflowDir, 'scripts', 'hud.sh'))).toBe(true);
    expect(await fs.readFile(charterAt(), 'utf8')).toBe(rendered([CORE, AMBIENT, IMPLEMENT]));
  });

  it('a selection without implement installs a charter with no route to it', async () => {
    await install({ plugins: [CORE, AMBIENT, PLAN], isPartialInstall: false });

    expect(await fs.readFile(charterAt(), 'utf-8')).toBe(rendered([CORE, AMBIENT, PLAN]));
    expect(await fs.readFile(charterAt(), 'utf-8')).not.toContain('devflow:implement');
  });

  it('a partial install renders from the effective selection, not from the plugins it copied', async () => {
    await install({ plugins: [CORE, AMBIENT, IMPLEMENT, REVIEW], isPartialInstall: false });
    // `init --plugin=devflow-bug-analysis`: only that plugin is copied, the prior selection stays installed.
    await install({
      plugins: [BUG_ANALYSIS],
      effectivePlugins: [CORE, AMBIENT, IMPLEMENT, REVIEW, BUG_ANALYSIS],
      isPartialInstall: true,
    });

    expect(await fs.readFile(charterAt(), 'utf-8')).toBe(rendered([CORE, AMBIENT, IMPLEMENT, REVIEW, BUG_ANALYSIS]));
  });

  it('a rerun with the same selection does not write the charter again', async () => {
    const plugins = [CORE, AMBIENT, IMPLEMENT, REVIEW];
    await install({ plugins, isPartialInstall: false });
    const charter = await snapshot(charterAt());

    await install({ plugins, isPartialInstall: false });

    expect(await snapshot(charterAt())).toEqual(charter);
  });

  it('a charter the render cannot read warns and the install still completes', async () => {
    // A directory where the charter file belongs: the script copy skips that path, the writer cannot read it.
    await fs.mkdir(charterAt(), { recursive: true });

    await expect(install({ plugins: [CORE, AMBIENT, IMPLEMENT], isPartialInstall: false })).resolves.toBeUndefined();

    expect(warnings.some(w => w.includes('charter render:'))).toBe(true);
    expect(await exists(path.join(devflowDir, 'scripts', 'hooks', 'run-hook')), 'the rest of the scripts were installed').toBe(true);
  });
});

// ---------------------------------------------------------------------------
// init --hud-only: the plugin set it renders for
// ---------------------------------------------------------------------------

async function makeCodexPackage(mode: number): Promise<string> {
  const fixture = await fs.realpath(root);
  const pkg = path.join(fixture, 'node_modules', '@dean0x/tokenmeter');
  const entry = 'bin/tokenmeter.js';
  await fs.mkdir(path.join(pkg, 'bin'), { recursive: true, mode: 0o700 });
  await fs.mkdir(path.join(pkg, 'dist'), { mode: 0o700 });
  await fs.writeFile(path.join(pkg, entry), '', { mode: 0o600 });
  await fs.writeFile(path.join(pkg, 'package.json'), JSON.stringify({ bin: { tokenmeter: entry } }));
  await fs.chmod(pkg, mode);
  vi.mocked(createRequire).mockReturnValueOnce(createRequire(path.join(fixture, 'package.json')));
  return path.join(pkg, entry);
}

async function expectQuotaReaderReplacement(
  args: string[],
  expectedBin = expectedCodexBin(),
): Promise<void> {
  const cwd = process.cwd();
  const savedOptions = initCommand.options.map(option => {
    const key = option.attributeName();
    const value: unknown = initCommand.getOptionValue(key);
    return { key, value, source: initCommand.getOptionValueSource(key) };
  });
  const devflowDir = path.join(root, '.devflow');
  const state = path.join(devflowDir, 'tokenmeter.json');
  assertTempHome(root);
  const hudDir = path.join(devflowDir, 'scripts', 'hud');
  const retiredReader = path.join(hudDir, 'codex-usage.js');
  await fs.mkdir(hudDir, { recursive: true });
  await fs.writeFile(retiredReader, '');
  await fs.mkdir(path.join(root, '.claude'));
  await fs.writeFile(state, '{"version":1,"binPath":"stale"}');
  vi.stubEnv('HOME', root);
  vi.stubEnv('USERPROFILE', root);
  process.chdir(root);
  const exit = vi.spyOn(process, 'exit').mockImplementation(code => {
    throw new Error(`init exited with code ${code}`);
  });
  try {
    await initCommand.parseAsync(args, { from: 'user' });

    await expect(fs.lstat(retiredReader)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.readFile(state, 'utf8').then((text): unknown => JSON.parse(text)))
      .resolves.toEqual({ version: 1, binPath: expectedBin });
  } finally {
    exit.mockRestore();
    process.chdir(cwd);
    vi.unstubAllEnvs();
    for (const { key, value, source } of savedOptions) {
      if (source === undefined) initCommand.setOptionValue(key, value);
      else initCommand.setOptionValueWithSource(key, value, source);
    }
  }
}

it('init --hud-only replaces the old quota reader with the saved tool path', () =>
  expectQuotaReaderReplacement(['--hud-only']),
);

it.skipIf(systemManagedSettingsAtRisk()).each([
  { name: 'trusted', mode: 0o755, expectedWarnings: [] },
  { name: 'group-writable', mode: 0o775, expectedWarnings: [CODEX_PATH_WARNING] },
])('full init completes and reports Codex usage for a $name package', async ({ mode, expectedWarnings }) => {
  const binPath = await makeCodexPackage(mode);
  const managedPath = path.join(root, 'managed-settings.json');
  await fs.writeFile(managedPath, JSON.stringify({ permissions: { deny: ['Bash(sudo *)'] } }));
  const managedPathSpy = vi.spyOn(claudePaths, 'getManagedSettingsPath').mockReturnValue(managedPath);
  const warnings: string[] = [];
  const warn = vi.spyOn(p.log, 'warn').mockImplementation((message) => {
    warnings.push(message);
  });
  try {
    await expectQuotaReaderReplacement(['--recommended', '--security', 'none', '--no-proxy'], binPath);
  } finally {
    warn.mockRestore();
    managedPathSpy.mockRestore();
  }

  expect(warnings.filter(message => message.includes('Codex usage'))).toEqual(expectedWarnings);
  expect((await fs.stat(path.dirname(path.dirname(binPath)))).mode & 0o777).toBe(mode);
  await expect(fs.lstat(managedPath)).rejects.toMatchObject({ code: 'ENOENT' });
});

describe('hudOnlyCharterPlugins: the record of the machine, or nothing', () => {
  it('no manifest, or one readManifest refused, is the empty set', () => {
    expect(hudOnlyCharterPlugins(null)).toEqual([]);
  });

  it('a recorded selection is kept as recorded', () => {
    const manifest = makeManifest({ plugins: ['devflow-core-skills', 'devflow-code-review', 'devflow-implement'] });
    expect(hudOnlyCharterPlugins(manifest)).toEqual(['devflow-core-skills', 'devflow-code-review', 'devflow-implement']);
  });

  it('a name the registry does not have selects nothing', () => {
    const manifest = makeManifest({ plugins: ['devflow-implement', 'devflow-not-a-plugin'] });
    expect(hudOnlyCharterPlugins(manifest)).toEqual(['devflow-implement']);
  });

  it('a recorded legacy name resolves to the plugin that replaced it', () => {
    const mapped = Object.entries(LEGACY_PLUGIN_NAMES).filter(([, current]) => DEVFLOW_PLUGINS.some(p => p.name === current));
    expect(mapped.length, 'the legacy table maps at least one name to a plugin the registry has').toBeGreaterThan(0);
    for (const [legacy, current] of mapped) {
      expect(hudOnlyCharterPlugins(makeManifest({ plugins: [legacy] }))).toEqual([current]);
    }
  });

  it('a recorded name the registry deleted selects nothing', () => {
    expect(DELETED_PLUGIN_NAMES.length).toBeGreaterThan(0);
    expect(hudOnlyCharterPlugins(makeManifest({ plugins: [...DELETED_PLUGIN_NAMES] }))).toEqual([]);
  });

  it('the empty set renders a charter that routes to no workflow', async () => {
    const scripts = path.join(root, 'scripts');
    await composeScripts(scripts);
    const result = await installRenderedCharter({
      scriptsDir: scripts, plugins: hudOnlyCharterPlugins(null), warn: () => {}, mode: 'install',
    });
    expect(result.charter).toBe('rewritten');
    const charter = await fs.readFile(path.join(scripts, CHARTER_RELPATH), 'utf-8');
    expect(charter).toBe(rendered([]));
    expect(charter).not.toContain('devflow:implement');
  });

  it('a recorded set that holds implement keeps its route in the charter', async () => {
    const scripts = path.join(root, 'scripts');
    await composeScripts(scripts);
    const manifest = makeManifest({ plugins: ['devflow-core-skills', 'devflow-implement'] });
    await installRenderedCharter({
      scriptsDir: scripts, plugins: hudOnlyCharterPlugins(manifest), warn: () => {}, mode: 'install',
    });
    const charter = await fs.readFile(path.join(scripts, CHARTER_RELPATH), 'utf-8');
    expect(charter).toBe(rendered([CORE, IMPLEMENT]));
    expect(charter).toContain('devflow:implement');
  });
});

// ---------------------------------------------------------------------------
// uninstall --plugin: the plugin set it renders for
// ---------------------------------------------------------------------------

describe('readManifestPlugins: the recorded plugins, read without touching the file', () => {
  const manifestAt = (): string => path.join(root, 'manifest.json');

  it('returns the recorded names in order', async () => {
    await writeManifest(root, makeManifest({ plugins: ['devflow-core-skills', 'devflow-plan'] }));
    expect(await readManifestPlugins(root)).toEqual(['devflow-core-skills', 'devflow-plan']);
  });

  it('is null for no file, for text that is not JSON and for a record that is not manifest-shaped', async () => {
    expect(await readManifestPlugins(root)).toBeNull();
    await fs.writeFile(manifestAt(), '{not json', 'utf-8');
    expect(await readManifestPlugins(root)).toBeNull();
    await fs.writeFile(manifestAt(), JSON.stringify({ plugins: ['devflow-plan'] }), 'utf-8');
    expect(await readManifestPlugins(root), 'a manifest readManifest would refuse is no record').toBeNull();
    await fs.writeFile(manifestAt(), '["devflow-plan"]', 'utf-8');
    expect(await readManifestPlugins(root)).toBeNull();
  });

  it('a record that lists no plugin is an empty list, not null', async () => {
    await writeManifest(root, makeManifest({ plugins: [] }));
    expect(await readManifestPlugins(root)).toEqual([]);
  });

  it('skips an entry that is not a string', async () => {
    const body = { ...makeManifest({ plugins: [] }), plugins: ['devflow-plan', 7, null, 'devflow-implement'] };
    await fs.writeFile(manifestAt(), JSON.stringify(body), 'utf-8');
    expect(await readManifestPlugins(root)).toEqual(['devflow-plan', 'devflow-implement']);
  });

  it('writes nothing, even for a manifest readManifest would heal', async () => {
    // No curation switch and a legacy key: readManifest rewrites this file on read. This reader must not.
    const body = JSON.stringify({
      version: '3.2.0', plugins: ['devflow-plan'], scope: 'user', futureKey: 'kept',
      features: { ambient: false, memory: false, kb: true }, installedAt: 'then', updatedAt: 'then',
    });
    await fs.writeFile(manifestAt(), body, 'utf-8');
    const before = await fs.stat(manifestAt());

    expect(await readManifestPlugins(root)).toEqual(['devflow-plan']);

    expect(await fs.readFile(manifestAt(), 'utf-8')).toBe(body);
    expect((await fs.stat(manifestAt())).mtimeMs).toBe(before.mtimeMs);
  });
});

describe('charterPluginsAfterRemoval: the recorded plugins minus the removed plugins', () => {
  it('no record is null, never the registry', () => {
    expect(charterPluginsAfterRemoval(null, ['devflow-implement'])).toBeNull();
  });

  it('drops the removed plugins and keeps the rest in recorded order', () => {
    const recorded = ['devflow-core-skills', 'devflow-implement', 'devflow-plan'];
    expect(charterPluginsAfterRemoval(recorded, ['devflow-implement'])).toEqual(['devflow-core-skills', 'devflow-plan']);
  });

  it('a record that lists no plugin is a record of nothing installed, not a missing record', () => {
    expect(charterPluginsAfterRemoval([], ['devflow-implement'])).toEqual([]);
  });

  it('removing every recorded plugin leaves the empty set', () => {
    expect(charterPluginsAfterRemoval(['devflow-implement'], ['devflow-implement'])).toEqual([]);
  });

  it('removing a plugin the record does not hold changes nothing', () => {
    const recorded = ['devflow-core-skills', 'devflow-plan'];
    expect(charterPluginsAfterRemoval(recorded, ['devflow-implement'])).toEqual(recorded);
  });

  it('a name the registry does not have selects nothing', () => {
    expect(charterPluginsAfterRemoval(['devflow-plan', 'devflow-not-a-plugin'], [])).toEqual(['devflow-plan']);
  });

  it('a recorded legacy name is mapped before the removal, so removing the plugin that replaced it removes it', () => {
    const mapped = Object.entries(LEGACY_PLUGIN_NAMES).filter(([, current]) => DEVFLOW_PLUGINS.some(p => p.name === current));
    expect(mapped.length).toBeGreaterThan(0);
    for (const [legacy, current] of mapped) {
      expect(charterPluginsAfterRemoval([legacy], [])).toEqual([current]);
      expect(charterPluginsAfterRemoval([legacy], [current])).toEqual([]);
    }
  });
});

describe('runSelectivePhaseForScope renders the charter for the plugins that stay', () => {
  let claudeDir: string;
  let devflowDir: string;
  const charterAt = (): string => path.join(devflowDir, 'scripts', CHARTER_RELPATH);

  /** An installed charter for `plugins`, written by the real writer. */
  async function installCharterFor(plugins: PluginDefinition[]): Promise<void> {
    await installRenderedCharter({
      scriptsDir: path.join(devflowDir, 'scripts'), plugins, warn: () => {}, mode: 'install',
    });
  }

  async function recordManifest(plugins: string[]): Promise<void> {
    await writeManifest(devflowDir, makeManifest({ plugins }));
  }

  beforeEach(async () => {
    claudeDir = path.join(root, 'claude');
    devflowDir = path.join(root, 'devflow');
    await fs.mkdir(claudeDir, { recursive: true });
    await fs.mkdir(devflowDir, { recursive: true });
  });

  it('removing implement drops its route and keeps the rest of the render', async () => {
    const installed = [CORE, AMBIENT, IMPLEMENT, REVIEW, BUG_ANALYSIS];
    await installCharterFor(installed);
    await recordManifest(installed.map(p => p.name));
    expect(await fs.readFile(charterAt(), 'utf-8')).toContain('devflow:implement');

    await runSelectivePhaseForScope({
      claudeDir, devflowDir, selectedPlugins: [IMPLEMENT], verbose: false, installedPlugins: installed,
    });

    expect(await fs.readFile(charterAt(), 'utf-8')).toBe(rendered([CORE, AMBIENT, REVIEW, BUG_ANALYSIS]));
    expect(await fs.readFile(charterAt(), 'utf-8')).not.toContain('devflow:implement');
  });

  it('removing another plugin keeps the route to implement', async () => {
    const installed = [CORE, AMBIENT, IMPLEMENT, REVIEW];
    await installCharterFor(installed);
    await recordManifest(installed.map(p => p.name));

    await runSelectivePhaseForScope({
      claudeDir, devflowDir, selectedPlugins: [REVIEW], verbose: false, installedPlugins: installed,
    });

    expect(await fs.readFile(charterAt(), 'utf-8')).toBe(rendered([CORE, AMBIENT, IMPLEMENT]));
    expect(await fs.readFile(charterAt(), 'utf-8')).toContain('devflow:implement');
  });

  it('renders from the manifest record, not from the installedPlugins the caller passes', async () => {
    // The caller's list is the registry fallback; the record says a smaller set is installed.
    await installCharterFor([CORE, AMBIENT, IMPLEMENT, REVIEW]);
    await recordManifest(['devflow-core-skills', 'devflow-ambient', 'devflow-implement', 'devflow-code-review']);

    await runSelectivePhaseForScope({
      claudeDir, devflowDir, selectedPlugins: [IMPLEMENT], verbose: false, installedPlugins: DEVFLOW_PLUGINS,
    });

    expect(await fs.readFile(charterAt(), 'utf-8')).toBe(rendered([CORE, AMBIENT, REVIEW]));
  });

  it('with no manifest record it leaves the installed charter as it was', async () => {
    await installCharterFor([CORE, AMBIENT, IMPLEMENT]);
    const charter = await snapshot(charterAt());

    await runSelectivePhaseForScope({
      claudeDir, devflowDir, selectedPlugins: [IMPLEMENT], verbose: false, installedPlugins: DEVFLOW_PLUGINS,
    });

    expect(await snapshot(charterAt())).toEqual(charter);
  });

  it('in a legacy local install a manifest that is a link is not read: the charter stays', async () => {
    const installed = [CORE, AMBIENT, IMPLEMENT, REVIEW];
    await installCharterFor(installed);
    const elsewhere = path.join(root, 'elsewhere');
    await fs.mkdir(elsewhere);
    await writeManifest(elsewhere, makeManifest({ plugins: installed.map(p => p.name) }));
    await fs.symlink(path.join(elsewhere, 'manifest.json'), path.join(devflowDir, 'manifest.json'));
    const charter = await snapshot(charterAt());

    await runSelectivePhaseForScope({
      claudeDir, devflowDir, selectedPlugins: [IMPLEMENT], verbose: false, installedPlugins: installed, scope: 'local',
    });

    expect(await snapshot(charterAt())).toEqual(charter);
    expect((await fs.lstat(path.join(devflowDir, 'manifest.json'))).isSymbolicLink()).toBe(true);
  });

  it('never creates the charter', async () => {
    await recordManifest(['devflow-core-skills', 'devflow-ambient', 'devflow-implement', 'devflow-plan']);

    await runSelectivePhaseForScope({
      claudeDir, devflowDir, selectedPlugins: [PLAN], verbose: false, installedPlugins: [CORE, AMBIENT, IMPLEMENT, PLAN],
    });

    expect(await exists(charterAt())).toBe(false);
  });

  it('a charter it cannot read does not stop the rest of the phase', async () => {
    await installCharterFor([CORE, AMBIENT, IMPLEMENT]);
    await recordManifest(['devflow-core-skills', 'devflow-ambient', 'devflow-implement']);
    await fs.rm(charterAt());
    await fs.mkdir(charterAt()); // a directory where the file belongs: neither read nor replaceable
    const warn = vi.spyOn(p.log, 'warn').mockImplementation(() => undefined);

    await expect(runSelectivePhaseForScope({
      claudeDir, devflowDir, selectedPlugins: [IMPLEMENT], verbose: false, installedPlugins: [CORE, AMBIENT, IMPLEMENT],
    })).resolves.toEqual({ replacedLinks: [], refusedFolders: [] });

    const charterWarnings = warn.mock.calls.filter(([message]) => message.includes('charter render:'));
    expect(charterWarnings, 'the unreadable charter is reported once').toHaveLength(1);
    const after = JSON.parse(await fs.readFile(path.join(devflowDir, 'manifest.json'), 'utf-8')) as { plugins: string[] };
    expect(after.plugins, 'the rest of the phase ran: the manifest dropped the plugin').not.toContain('devflow-implement');
  });
});
