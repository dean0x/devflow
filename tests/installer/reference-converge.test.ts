/**
 * The references kind of the variant converge: a compliance toggle re-runs the reference overlay
 * with the manifest and the one source root of the switch, then the removal list or the restore
 * (AC-41, AC-50; TP-57, TP-58, TP-68).
 *
 * Every test installs into temp Claude and devflow directories with the REAL built references
 * (a fixture of a shape the build never produces proves nothing), and nothing reads or writes the
 * real HOME. The toggle tests compare the converged tree with a FRESH install of the same state:
 * the converge is right only when it ends where an install would have started.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';

import { removeAllDevFlow } from '../../src/cli/commands/uninstall.js';
import { installViaFileCopy, type Spinner } from '../../src/targets/claude-code/installer.js';
import { applyVariantToggle, convergeVariantAxes, describePostingLeft, type VariantMachineState } from '../../src/targets/claude-code/curation-install.js';
import { convergeReferences } from '../../src/targets/claude-code/reference-converge.js';
import { compiledSkillRefsDir } from '../../src/core/assets.js';
import { renderVariantManifest } from '../../src/core/curation-variants.js';
import { generatedReferenceManifest, installedReferenceManifest } from '../../src/core/mds-variants.js';
import { DEVFLOW_PLUGINS } from '../../src/core/plugins.js';
import { assertTempHome } from '../setup/home-isolation.js';

const noopSpinner: Spinner = { start() {}, stop() {}, message() {} };

const GATE = 'devflow:git/references/publication-gate.md';
const ASKS = 'devflow:agent-references/references/commands/implement-evidence-asks.md';
const CORE = DEVFLOW_PLUGINS.filter(p => p.name === 'devflow-core-skills');
const SKILLS = new Map([['git', 'devflow-core-skills'], ['agent-references', 'devflow-core-skills']]);
const RUNNING = '3.3.0';

let tmp: string;
let claudeDir: string;
let devflowDir: string;
let warnings: string[];

const warn = (msg: string): void => { warnings.push(msg); };
const skillsRoot = (dir: string = claudeDir): string => path.join(dir, 'skills');
const installedRefs = (dir: string = claudeDir): string => path.join(skillsRoot(dir), 'devflow:git', 'references');
const flatFile = (entry: string, dir: string = claudeDir): string => path.join(skillsRoot(dir), ...entry.split('/'));
const exists = (file: string): Promise<boolean> => fs.lstat(file).then(() => true, () => false);

async function walk(dir: string, prefix = ''): Promise<string[]> {
  const out: string[] = [];
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) out.push(`${rel}/`, ...(await walk(path.join(dir, entry.name), rel)));
    else out.push(rel);
  }
  return out.sort();
}

/** Every file below `dir` as relative path -> base64 bytes. */
async function fileMap(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const rel of await walk(dir)) {
    if (!rel.endsWith('/')) out[rel] = (await fs.readFile(path.join(dir, rel))).toString('base64');
  }
  return out;
}

/** The surface a compliance switch moves in one machine's install: the git references and the evidence asks. */
async function referenceSurface(dir: string): Promise<Record<string, string>> {
  const surface = await fileMap(installedRefs(dir));
  const asks = flatFile(ASKS, dir);
  if (await exists(asks)) surface['agent-references:implement-evidence-asks.md'] = (await fs.readFile(asks)).toString('base64');
  return surface;
}

function machine(compliance: boolean): VariantMachineState {
  return { features: { curation: true, compliance: { enabled: compliance, frameworks: [] }, rules: false } };
}

function installInto(dir: string, home: string, compliance: boolean) {
  return installViaFileCopy({
    curation: true,
    compliance,
    plugins: [],
    effectivePlugins: CORE,
    claudeDir: dir,
    devflowDir: home,
    skillsMap: SKILLS,
    agentsMap: new Map(),
    isPartialInstall: false,
    spinner: noopSpinner,
    warn,
  });
}

function converge(compliance: boolean, packageRoot?: string) {
  return convergeVariantAxes({ claudeDir, devflowDir, manifest: machine(compliance), plugins: CORE, warn, packageRoot });
}

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-ref-converge-'));
  expect(() => assertTempHome(tmp)).not.toThrow();
  claudeDir = path.join(tmp, 'claude');
  devflowDir = path.join(tmp, 'devflow');
  warnings = [];
  await fs.mkdir(claudeDir, { recursive: true });
  await fs.mkdir(devflowDir, { recursive: true });
  for (const rel of generatedReferenceManifest()) {
    await fs.access(path.join(compiledSkillRefsDir(), ...rel.split('/'))).catch(() => {
      throw new Error(`dist/skills/git/references/${rel} is absent — run \`npm run build\` before this suite.`);
    });
  }
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('a compliance toggle through the converge ends where a fresh install of that state starts (TP-57)', () => {
  it('disable then enable: each state is byte-equal to a fresh install of it, and a repeat moves nothing', async () => {
    // The two fresh installs the converge must match.
    const freshOn = path.join(tmp, 'fresh-on');
    const freshOff = path.join(tmp, 'fresh-off');
    for (const [dir, compliance] of [[freshOn, true], [freshOff, false]] as const) {
      await fs.mkdir(path.join(dir, 'home'), { recursive: true });
      await installInto(path.join(dir, 'claude'), path.join(dir, 'home'), compliance);
    }
    const onSurface = await referenceSurface(path.join(freshOn, 'claude'));
    const offSurface = await referenceSurface(path.join(freshOff, 'claude'));
    expect(Object.keys(onSurface).length, 'precondition: the two states differ').toBeGreaterThan(Object.keys(offSurface).length);

    await installInto(claudeDir, devflowDir, true);
    expect(await referenceSurface(claudeDir), 'precondition: the machine starts as a fresh compliance-on install').toEqual(onSurface);

    const disabled = await converge(false);
    expect(disabled.converged, warnings.join('\n')).toBe(true);
    expect(disabled.posting).toEqual({ kind: 'clear' });
    expect(await referenceSurface(claudeDir)).toEqual(offSurface);
    expect(disabled.references.rewritten.length, 'the disable rewrote references').toBeGreaterThan(0);
    expect(disabled.references.removed, 'and removed the flat files by name').toEqual(expect.arrayContaining([GATE, ASKS]));

    const again = await converge(false);
    expect(again.references.rewritten, 'a repeat disable writes nothing').toEqual([]);
    expect(again.references.removed, 'and has nothing left to remove').toEqual([]);
    expect(await referenceSurface(claudeDir)).toEqual(offSurface);

    const enabled = await converge(true);
    expect(enabled.converged, warnings.join('\n')).toBe(true);
    expect(await referenceSurface(claudeDir)).toEqual(onSurface);
    expect(enabled.references.restored, 'the enable wrote the evidence asks back').toContain(ASKS);

    const enabledAgain = await converge(true);
    expect(enabledAgain.references.rewritten).toEqual([]);
    expect(enabledAgain.references.restored).toEqual([]);
  });

  it('a user file in the references root survives both toggles, and the tracker provider file is untouched (TP-58)', async () => {
    await installInto(claudeDir, devflowDir, true);
    const mine = path.join(installedRefs(), 'my-own-notes.md');
    await fs.writeFile(mine, 'a note of mine\n', 'utf-8');
    const provider = path.join(devflowDir, 'tracker', 'github.md');
    await fs.mkdir(path.dirname(provider), { recursive: true });
    await fs.writeFile(provider, '---\nprovider: github\n---\nmy conventions\n', 'utf-8');
    const before = await fileMap(path.join(devflowDir, 'tracker'));

    await converge(false);
    expect(await fs.readFile(mine, 'utf-8')).toBe('a note of mine\n');
    await converge(true);
    expect(await fs.readFile(mine, 'utf-8')).toBe('a note of mine\n');
    expect(await fileMap(path.join(devflowDir, 'tracker'))).toEqual(before);
  });

  it('a link at a removal path is unlinked and its target is untouched', async () => {
    await installInto(claudeDir, devflowDir, true);
    const outside = path.join(tmp, 'outside.md');
    await fs.writeFile(outside, 'foreign bytes\n', 'utf-8');
    await fs.rm(flatFile(GATE));
    await fs.symlink(outside, flatFile(GATE));

    const result = await converge(false);

    expect(result.converged, warnings.join('\n')).toBe(true);
    expect(await exists(flatFile(GATE)), 'the link is gone').toBe(false);
    expect(await fs.readFile(outside, 'utf-8')).toBe('foreign bytes\n');
  });

  it('a skill that is not installed is not created by a toggle', async () => {
    const result = await converge(false);

    expect(result.references).toMatchObject({ converged: true, rewritten: [], removed: [], restored: [] });
    for (const skill of ['devflow:git', 'devflow:agent-references']) {
      expect(await exists(path.join(skillsRoot(), skill)), `the toggle created no ${skill} directory`).toBe(false);
    }
  });
});

describe('the references converge fails closed on the off side', () => {
  it('a directory at a removal path leaves the converge failed and names the file as still posting', async () => {
    await installInto(claudeDir, devflowDir, true);
    await fs.rm(flatFile(ASKS));
    await fs.mkdir(flatFile(ASKS));
    await fs.writeFile(path.join(flatFile(ASKS), 'inner.md'), 'in the way\n', 'utf-8');

    const result = await converge(false);

    expect(result.converged).toBe(false);
    expect(result.references.stillPosting).toEqual([flatFile(ASKS)]);
    expect(result.posting).toEqual({ kind: 'left', files: [flatFile(ASKS)] });
    expect(describePostingLeft(result.posting).join('\n')).toContain('implement-evidence-asks.md');
    expect(await fs.readFile(path.join(flatFile(ASKS), 'inner.md'), 'utf-8'), 'nothing inside the directory was touched').toBe('in the way\n');
    expect(await exists(flatFile(GATE)), 'the other files are still removed').toBe(false);
  });

  it('an absent compliance-off root fails the converge, writes nothing and never falls through to the compliance-on root (AC-50, TP-68)', async () => {
    await installInto(claudeDir, devflowDir, true);
    const before = await fileMap(claudeDir);
    // A package whose compliance-on tree is complete and carries a sentinel, and whose compliance-off tree is absent.
    const pkg = path.join(tmp, 'pkg');
    const onRoot = path.join(pkg, 'dist', 'skills', 'git', 'references');
    for (const rel of generatedReferenceManifest()) {
      await fs.mkdir(path.dirname(path.join(onRoot, ...rel.split('/'))), { recursive: true });
      await fs.writeFile(path.join(onRoot, ...rel.split('/')), 'ON-TREE-SENTINEL\n', 'utf-8');
    }

    const result = await convergeReferences({ claudeDir, devflowDir, compliance: false, warn, packageRoot: pkg });

    expect(result.converged).toBe(false);
    expect(result.unproven).toBe(true);
    expect(result.failures.join('\n')).toContain(path.join(pkg, 'dist', 'compliance-off', 'skills', 'git', 'references'));
    expect(result.rewritten).toEqual([]);
    // Only the three flat files are touched, and only by removal: no reference carries the sentinel.
    const after = await fileMap(claudeDir);
    for (const [rel, bytes] of Object.entries(after)) {
      expect(Buffer.from(bytes, 'base64').toString('utf-8'), rel).not.toContain('ON-TREE-SENTINEL');
    }
    for (const rel of Object.keys(after)) expect(before, rel).toHaveProperty(rel);
  });

  it('through the composed converge an absent compliance-off root makes posting unknown, never clear', async () => {
    await installInto(claudeDir, devflowDir, true);
    const pkg = path.join(tmp, 'pkg');
    const rendered = renderVariantManifest([]);
    if (!rendered.ok) throw new Error('fixture variant manifest refused');
    await fs.mkdir(path.join(pkg, 'dist'), { recursive: true });
    await fs.writeFile(path.join(pkg, 'dist', 'variant-axes.json'), rendered.value, 'utf-8');

    const result = await converge(false, pkg);

    expect(result.converged).toBe(false);
    expect(result.posting.kind).toBe('unknown');
    expect(result.posting.kind === 'unknown' && result.posting.reason).toContain('installed references');
  });

  it('compliance on: an absent compliance-on root fails the converge too, with nothing written', async () => {
    await installInto(claudeDir, devflowDir, false);
    const before = await referenceSurface(claudeDir);
    const pkg = path.join(tmp, 'pkg');
    await fs.mkdir(pkg, { recursive: true });

    const result = await convergeReferences({ claudeDir, devflowDir, compliance: true, warn, packageRoot: pkg });

    expect(result.converged).toBe(false);
    expect(result.stillPosting).toEqual([]);
    expect(result.unproven, 'the unproven flag belongs to the off side').toBe(false);
    expect(await referenceSurface(claudeDir)).toEqual(before);
  });

  it('a skill directory that is a link is a failure: nothing is written through it', async () => {
    await installInto(claudeDir, devflowDir, true);
    const elsewhere = path.join(tmp, 'elsewhere');
    await fs.rename(path.join(skillsRoot(), 'devflow:git'), elsewhere);
    await fs.symlink(elsewhere, path.join(skillsRoot(), 'devflow:git'), 'dir');
    const before = await fileMap(elsewhere);

    const result = await converge(false);

    expect(result.converged).toBe(false);
    expect(result.posting.kind).toBe('unknown');
    expect(await fileMap(elsewhere), 'the linked directory was not converged').toEqual(before);
  });
});

describe('the version-skew check keeps the references where they are', () => {
  async function seedManifest(version: string, compliance: boolean): Promise<void> {
    await fs.writeFile(path.join(devflowDir, 'manifest.json'), JSON.stringify({
      version,
      plugins: ['devflow-core-skills'],
      scope: 'user',
      features: { ambient: false, memory: false, hud: false, knowledge: true, curation: true, learning: true, rules: false, compliance: { enabled: compliance, frameworks: [] } },
      installedAt: '2026-10-10T00:00:00.000Z',
      updatedAt: '2026-10-10T00:00:00.000Z',
    }), 'utf-8');
  }

  it('a compliance-off toggle across a skew converges nothing and says the posting steps remain', async () => {
    await installInto(claudeDir, devflowDir, true);
    await seedManifest('3.2.0', true);
    const before = await referenceSurface(claudeDir);

    const outcome = await applyVariantToggle({ claudeDir, devflowDir, axis: 'compliance', enabled: false, runningVersion: RUNNING, warn });

    expect(outcome.kind).toBe('skipped');
    expect(outcome.kind === 'skipped' && outcome.message).toContain('posting steps remain installed until devflow init');
    expect(await referenceSurface(claudeDir)).toEqual(before);
  });

  it('a toggle at the running version converges the references and records the install', async () => {
    await installInto(claudeDir, devflowDir, true);
    await seedManifest(RUNNING, true);

    const outcome = await applyVariantToggle({ claudeDir, devflowDir, axis: 'compliance', enabled: false, runningVersion: RUNNING, warn });

    expect(outcome.kind).toBe('converged');
    if (outcome.kind !== 'converged') return;
    expect(outcome.result.converged, warnings.join('\n')).toBe(true);
    expect(outcome.result.references.removed).toEqual(expect.arrayContaining([GATE, ASKS]));
    expect(await exists(flatFile(ASKS))).toBe(false);
    for (const rel of installedReferenceManifest({ compliance: false })) {
      expect(await exists(path.join(installedRefs(), ...rel.split('/'))), `${rel} stays installed`).toBe(true);
    }
  });
});

describe('uninstall removes the installed references in both states', () => {
  it.each([[true], [false]])('compliance %s: no devflow:git or devflow:agent-references directory is left', async (compliance) => {
    await installInto(claudeDir, devflowDir, compliance);
    await converge(compliance);
    expect(await exists(installedRefs()), 'precondition: the references are installed').toBe(true);

    await removeAllDevFlow(claudeDir, path.join(devflowDir, 'scripts'), false);

    for (const skill of ['devflow:git', 'devflow:agent-references']) {
      expect(await exists(path.join(skillsRoot(), skill)), `${skill} must be gone`).toBe(false);
    }
  });
});
