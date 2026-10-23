/**
 * D-CHARTER-INSTALL-RENDER wiring: the install-time charter render has ONE writer.
 *
 * `composeScripts` copies the packaged scripts verbatim and skips the orchestrator charter and the implement
 * sentinel; `installRenderedCharter` writes both. This file holds the wiring around that writer:
 *
 *   - `copyDirectory` skips an explicit set of source paths and still copies everything when none is given;
 *   - `composeScripts` never writes either file, and never puts the full source over a render;
 *   - `installViaFileCopy` renders from the EFFECTIVE selection, reruns write nothing, and a render that
 *     fails warns without aborting the install;
 *   - `init --hud-only` renders from the manifest record, and from the empty set when there is none;
 *   - `uninstall --plugin` renders from the manifest record minus the removed plugins, skips without a
 *     record, and only ever removes the sentinel.
 *
 * The renders themselves, over every plugin set, are held by tests/installer/charter-render.test.ts. The
 * built CLI end to end is held by tests/installer/charter-render-e2e.test.ts.
 *
 * HOME safety: every directory below is an mkdtemp; nothing reads or writes the real ~/.claude or
 * ~/.devflow, and no test runs the CLI.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync, promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';

import { scriptsDir as packagedScriptsDir } from '../../src/core/assets.js';
import {
  DELETED_PLUGIN_NAMES,
  DEVFLOW_PLUGINS,
  LEGACY_PLUGIN_NAMES,
  buildScopedSkillsMap,
  type PluginDefinition,
} from '../../src/core/plugins.js';
import { readManifestPlugins, writeManifest } from '../../src/core/manifest.js';
import {
  composeScripts,
  copyDirectory,
  installViaFileCopy,
  type Spinner,
} from '../../src/targets/claude-code/installer.js';
import {
  CHARTER_RELPATH,
  HANDOFF_SENTINEL_RELPATH,
  charterInventory,
  installRenderedCharter,
  renderCharter,
} from '../../src/targets/claude-code/charter-render.js';
import { hudOnlyCharterPlugins } from '../../src/cli/commands/init.js';
import { charterPluginsAfterRemoval, runSelectivePhaseForScope } from '../../src/cli/commands/uninstall.js';
import { HANDOFF_PREFIX } from '../helpers/charter-guards.js';
import { makeManifest } from '../helpers.js';

const noopSpinner: Spinner = { start() {}, stop() {}, message() {} };

const SOURCE = readFileSync(path.join(packagedScriptsDir(), CHARTER_RELPATH), 'utf-8');
const SENTINEL_SOURCE = readFileSync(path.join(packagedScriptsDir(), HANDOFF_SENTINEL_RELPATH), 'utf-8');

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
const DEBUG = plugin('devflow-bug-analysis');

/** The charter as the installer renders it for a plugin set (the render is tested over every set elsewhere). */
function rendered(plugins: ReadonlyArray<PluginDefinition>): string {
  const inventory = charterInventory(plugins.map(p => p.name));
  const result = renderCharter(SOURCE, inventory.commands, inventory.agents);
  if (!result.ok) throw new Error(`render failed for the test oracle: ${result.reason} ${result.span}`);
  return result.content;
}

const handoffLines = (text: string): number => text.split('\n').filter(line => line.includes(HANDOFF_PREFIX)).length;

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-charter-wiring-'));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

const exists = (file: string): Promise<boolean> => fs.access(file).then(() => true, () => false);

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
// composeScripts is not a writer of the charter or the sentinel
// ---------------------------------------------------------------------------

describe('composeScripts: the verbatim script copy writes neither the charter nor the sentinel', () => {
  let scripts: string;
  const charterAt = (): string => path.join(scripts, CHARTER_RELPATH);
  const sentinelAt = (): string => path.join(scripts, HANDOFF_SENTINEL_RELPATH);

  beforeEach(() => {
    scripts = path.join(root, 'scripts');
  });

  it('copies the other scripts and leaves neither file behind', async () => {
    await composeScripts(scripts);
    expect(await exists(path.join(scripts, 'hooks', 'run-hook'))).toBe(true);
    expect(await exists(path.join(scripts, 'hud.sh'))).toBe(true);
    expect(await exists(charterAt())).toBe(false);
    expect(await exists(sentinelAt())).toBe(false);
  });

  it('the render writes both, executable, and a second render changes nothing', async () => {
    await composeScripts(scripts);
    const warnings: string[] = [];
    const first = await installRenderedCharter({
      scriptsDir: scripts, plugins: [CORE, AMBIENT, IMPLEMENT], warn: m => warnings.push(m), mode: 'install',
    });
    expect(first).toEqual({ charter: 'rewritten', sentinel: 'rewritten' });
    expect(warnings).toEqual([]);

    const charter = await snapshot(charterAt());
    const sentinel = await snapshot(sentinelAt());
    expect(sentinel.bytes).toBe(SENTINEL_SOURCE);
    expect(charter.mode).toBe(0o755);
    expect(sentinel.mode).toBe(0o755);

    const second = await installRenderedCharter({
      scriptsDir: scripts, plugins: [CORE, AMBIENT, IMPLEMENT], warn: m => warnings.push(m), mode: 'install',
    });
    expect(second).toEqual({ charter: 'unchanged', sentinel: 'unchanged' });
    expect(await snapshot(charterAt())).toEqual(charter);
    expect(await snapshot(sentinelAt())).toEqual(sentinel);
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
    expect(await exists(sentinelAt()), 'implement is not installed, so no sentinel').toBe(false);
  });

  it('a script copy does not bring a removed sentinel back', async () => {
    await composeScripts(scripts);
    await installRenderedCharter({
      scriptsDir: scripts, plugins: [CORE, AMBIENT, IMPLEMENT], warn: () => {}, mode: 'install',
    });
    await fs.rm(sentinelAt());

    await composeScripts(scripts);

    expect(await exists(sentinelAt())).toBe(false);
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
  const sentinelAt = (): string => path.join(devflowDir, 'scripts', HANDOFF_SENTINEL_RELPATH);

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
      curation: true,
      plugins: opts.plugins,
      effectivePlugins: effective,
      claudeDir,
      devflowDir,
      skillsMap: buildScopedSkillsMap(effective),
      agentsMap: new Map(),
      isPartialInstall: opts.isPartialInstall,
      spinner: noopSpinner,
      warn: (msg) => { warnings.push(msg); },
    });
  }

  it('a full install writes the charter rendered for its plugins and the sentinel when implement is in them', async () => {
    const plugins = [CORE, AMBIENT, IMPLEMENT, REVIEW];
    await install({ plugins, isPartialInstall: false });

    expect(await fs.readFile(charterAt(), 'utf-8')).toBe(rendered(plugins));
    expect(handoffLines(await fs.readFile(charterAt(), 'utf-8'))).toBe(1);
    expect(await fs.readFile(sentinelAt(), 'utf-8')).toBe(SENTINEL_SOURCE);
    expect(warnings).toEqual([]);
  });

  it('a selection without implement installs a charter with no handoff line and no sentinel', async () => {
    await install({ plugins: [CORE, AMBIENT, PLAN], isPartialInstall: false });

    expect(handoffLines(await fs.readFile(charterAt(), 'utf-8'))).toBe(0);
    expect(await exists(sentinelAt())).toBe(false);
  });

  it('a partial install renders from the effective selection, not from the plugins it copied', async () => {
    await install({ plugins: [CORE, AMBIENT, IMPLEMENT, REVIEW], isPartialInstall: false });
    // `init --plugin=devflow-bug-analysis`: only that plugin is copied, the prior selection stays installed.
    await install({
      plugins: [DEBUG],
      effectivePlugins: [CORE, AMBIENT, IMPLEMENT, REVIEW, DEBUG],
      isPartialInstall: true,
    });

    expect(await fs.readFile(charterAt(), 'utf-8')).toBe(rendered([CORE, AMBIENT, IMPLEMENT, REVIEW, DEBUG]));
    expect(await exists(sentinelAt()), 'implement stays installed').toBe(true);
  });

  it('a rerun with the same selection writes neither file again', async () => {
    const plugins = [CORE, AMBIENT, IMPLEMENT, REVIEW];
    await install({ plugins, isPartialInstall: false });
    const charter = await snapshot(charterAt());
    const sentinel = await snapshot(sentinelAt());

    await install({ plugins, isPartialInstall: false });

    expect(await snapshot(charterAt())).toEqual(charter);
    expect(await snapshot(sentinelAt())).toEqual(sentinel);
  });

  it('a render that cannot write warns and the install still completes', async () => {
    // A directory where the charter file belongs: the script copy skips that path, the writer cannot replace it.
    await fs.mkdir(charterAt(), { recursive: true });

    await expect(install({ plugins: [CORE, AMBIENT, IMPLEMENT], isPartialInstall: false })).resolves.toBeUndefined();

    expect(warnings.some(w => w.includes('charter render:'))).toBe(true);
    expect(await exists(path.join(devflowDir, 'scripts', 'hooks', 'run-hook')), 'the rest of the scripts were installed').toBe(true);
    expect(await exists(sentinelAt()), 'the sentinel has its own isolation').toBe(true);
  });
});

// ---------------------------------------------------------------------------
// init --hud-only: the plugin set it renders for
// ---------------------------------------------------------------------------

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

  it('the empty set renders no handoff line and writes no sentinel', async () => {
    const scripts = path.join(root, 'scripts');
    await composeScripts(scripts);
    const result = await installRenderedCharter({
      scriptsDir: scripts, plugins: hudOnlyCharterPlugins(null), warn: () => {}, mode: 'install',
    });
    expect(result.charter).toBe('rewritten');
    expect(handoffLines(await fs.readFile(path.join(scripts, CHARTER_RELPATH), 'utf-8'))).toBe(0);
    expect(await exists(path.join(scripts, HANDOFF_SENTINEL_RELPATH))).toBe(false);
  });

  it('a recorded set that holds implement keeps the sentinel and the handoff line', async () => {
    const scripts = path.join(root, 'scripts');
    await composeScripts(scripts);
    const manifest = makeManifest({ plugins: ['devflow-core-skills', 'devflow-implement'] });
    await installRenderedCharter({
      scriptsDir: scripts, plugins: hudOnlyCharterPlugins(manifest), warn: () => {}, mode: 'install',
    });
    expect(handoffLines(await fs.readFile(path.join(scripts, CHARTER_RELPATH), 'utf-8'))).toBe(1);
    expect(await exists(path.join(scripts, HANDOFF_SENTINEL_RELPATH))).toBe(true);
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
  const sentinelAt = (): string => path.join(devflowDir, 'scripts', HANDOFF_SENTINEL_RELPATH);

  /** An installed charter and sentinel for `plugins`, written by the real writer. */
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

  it('removing implement drops the handoff line and the sentinel and keeps the rest of the render', async () => {
    const installed = [CORE, AMBIENT, IMPLEMENT, REVIEW, DEBUG];
    await installCharterFor(installed);
    await recordManifest(installed.map(p => p.name));
    expect(handoffLines(await fs.readFile(charterAt(), 'utf-8'))).toBe(1);

    await runSelectivePhaseForScope({
      claudeDir, devflowDir, selectedPlugins: [IMPLEMENT], verbose: false, installedPlugins: installed,
    });

    expect(await fs.readFile(charterAt(), 'utf-8')).toBe(rendered([CORE, AMBIENT, REVIEW, DEBUG]));
    expect(await exists(sentinelAt())).toBe(false);
  });

  it('removing another plugin keeps the sentinel and rewrites nothing that did not change', async () => {
    const installed = [CORE, AMBIENT, IMPLEMENT, REVIEW];
    await installCharterFor(installed);
    await recordManifest(installed.map(p => p.name));

    await runSelectivePhaseForScope({
      claudeDir, devflowDir, selectedPlugins: [REVIEW], verbose: false, installedPlugins: installed,
    });

    expect(await fs.readFile(charterAt(), 'utf-8')).toBe(rendered([CORE, AMBIENT, IMPLEMENT]));
    expect(await fs.readFile(sentinelAt(), 'utf-8')).toBe(SENTINEL_SOURCE);
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

  it('with no manifest record it leaves the installed charter and the sentinel as they were', async () => {
    await installCharterFor([CORE, AMBIENT, IMPLEMENT]);
    const charter = await snapshot(charterAt());
    const sentinel = await snapshot(sentinelAt());

    await runSelectivePhaseForScope({
      claudeDir, devflowDir, selectedPlugins: [IMPLEMENT], verbose: false, installedPlugins: DEVFLOW_PLUGINS,
    });

    expect(await snapshot(charterAt())).toEqual(charter);
    expect(await snapshot(sentinelAt())).toEqual(sentinel);
  });

  it('never creates the charter or the sentinel', async () => {
    await recordManifest(['devflow-core-skills', 'devflow-ambient', 'devflow-implement', 'devflow-plan']);

    await runSelectivePhaseForScope({
      claudeDir, devflowDir, selectedPlugins: [PLAN], verbose: false, installedPlugins: [CORE, AMBIENT, IMPLEMENT, PLAN],
    });

    expect(await exists(charterAt())).toBe(false);
    expect(await exists(sentinelAt())).toBe(false);
  });

  it('never creates a sentinel that implement being installed would call for', async () => {
    // A charter an older release installed, with no sentinel: uninstall may take the sentinel away, never add it.
    await installCharterFor([CORE, AMBIENT, IMPLEMENT, PLAN]);
    await fs.rm(sentinelAt());
    await recordManifest(['devflow-core-skills', 'devflow-ambient', 'devflow-implement', 'devflow-plan']);

    await runSelectivePhaseForScope({
      claudeDir, devflowDir, selectedPlugins: [PLAN], verbose: false, installedPlugins: [CORE, AMBIENT, IMPLEMENT, PLAN],
    });

    expect(await exists(sentinelAt())).toBe(false);
  });

  it('a charter it cannot read does not stop the rest of the phase', async () => {
    await installCharterFor([CORE, AMBIENT, IMPLEMENT]);
    await recordManifest(['devflow-core-skills', 'devflow-ambient', 'devflow-implement']);
    await fs.rm(charterAt());
    await fs.mkdir(charterAt()); // a directory where the file belongs: neither read nor replaceable

    await expect(runSelectivePhaseForScope({
      claudeDir, devflowDir, selectedPlugins: [IMPLEMENT], verbose: false, installedPlugins: [CORE, AMBIENT, IMPLEMENT],
    })).resolves.toBeUndefined();

    const after = JSON.parse(await fs.readFile(path.join(devflowDir, 'manifest.json'), 'utf-8')) as { plugins: string[] };
    expect(after.plugins, 'the rest of the phase ran: the manifest dropped the plugin').not.toContain('devflow-implement');
  });
});
