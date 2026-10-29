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
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';

import { formatRefusedFoldersSummary, formatReplacedLinksSummary } from '../../src/cli/commands/install-report.js';
import { removeAllDevFlow } from '../../src/cli/commands/uninstall.js';
import { installViaFileCopy, planOverlayUnits, type Spinner } from '../../src/targets/claude-code/installer.js';
import { applyVariantToggle, convergeVariantAxes, describePostingLeft, type VariantMachineState } from '../../src/targets/claude-code/curation-install.js';
import { convergeReferences } from '../../src/targets/claude-code/reference-converge.js';
import { compiledSkillRefsDir } from '../../src/core/assets.js';
import { renderVariantManifest } from '../../src/core/curation-variants.js';
import { generatedReferenceManifest, installedReferenceManifest } from '../../src/core/mds-variants.js';
import { buildAssetMaps, DEVFLOW_PLUGINS } from '../../src/core/plugins.js';
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

function installInto(dir: string, home: string, compliance: boolean, isPartialInstall = false) {
  return installViaFileCopy({
    curation: true,
    compliance,
    plugins: [],
    effectivePlugins: CORE,
    claudeDir: dir,
    devflowDir: home,
    skillsMap: SKILLS,
    agentsMap: new Map(),
    isPartialInstall,
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

  it('a references directory that is a link is a failure: nothing is written, pruned or removed through it', async () => {
    await installInto(claudeDir, devflowDir, true);
    const elsewhere = path.join(tmp, 'elsewhere-refs');
    await fs.rename(installedRefs(), elsewhere);
    await fs.symlink(elsewhere, installedRefs(), 'dir');
    await fs.writeFile(path.join(elsewhere, 'pr', 'not-in-the-manifest.md'), 'a file the prune would remove\n', 'utf-8');
    await fs.chmod(path.join(elsewhere, 'trust-rule.md'), 0o600);
    const before = await fileMap(elsewhere);

    const result = await convergeReferences({ claudeDir, devflowDir, compliance: false, warn });

    expect(result.converged).toBe(false);
    expect(result.unproven).toBe(true);
    expect(result.rewritten).toEqual([]);
    expect(result.failures.join('\n')).toContain(installedRefs());
    expect(result.stillPosting, 'the removal refuses the gate below the link and names it').toContain(flatFile(GATE));
    expect(await fileMap(elsewhere), 'the linked directory was not converged').toEqual(before);
    expect((await fs.stat(path.join(elsewhere, 'trust-rule.md'))).mode & 0o777, 'no mode was set through the link').toBe(0o600);
    expect((await fs.lstat(installedRefs())).isSymbolicLink(), 'the link itself is left in place').toBe(true);
  });
});

describe('a compliance-off install keeps the posting files out of the skill copy', () => {
  const POSTING = 'devflow:git/references/github-posting.md';
  const POSTING_FILES = [POSTING, ASKS];

  /**
   * A compliance-off full install in which every unlink of a posting file is refused, so the removal
   * that follows the copy cannot clean up, and in which every copied file is recorded: a posting file
   * that the copy wrote is still on disk afterwards.
   */
  async function installOffWithRefusedRemoval() {
    const copiedTo: string[] = [];
    const stuck = new Set(POSTING_FILES.map(entry => flatFile(entry)));
    const realCopy = fs.copyFile.bind(fs);
    const realUnlink = fs.unlink.bind(fs);
    const copy = vi.spyOn(fs, 'copyFile').mockImplementation(async (from, to, mode) => {
      copiedTo.push(String(to));
      return realCopy(from, to, mode);
    });
    const unlink = vi.spyOn(fs, 'unlink').mockImplementation(async (target) => {
      if (stuck.has(String(target))) throw Object.assign(new Error('operation not permitted'), { code: 'EPERM' });
      return realUnlink(target);
    });
    try {
      return { report: await installInto(claudeDir, devflowDir, false), copiedTo };
    } finally {
      copy.mockRestore();
      unlink.mockRestore();
    }
  }

  it.each([
    ['the shipped skill', false],
    ['a valid shadow of the git skill', true],
  ] as const)('%s: no posting file is copied, so a refused removal has nothing to leave behind', async (_name, shadowed) => {
    if (shadowed) {
      const shadow = path.join(devflowDir, 'skills', 'git');
      await fs.mkdir(path.join(shadow, 'references'), { recursive: true });
      await fs.writeFile(path.join(shadow, 'SKILL.md'), 'a shadow of the git skill\n', 'utf-8');
      await fs.writeFile(path.join(shadow, 'references', 'github-posting.md'), 'posting text the shadow supplies\n', 'utf-8');
      await fs.writeFile(path.join(shadow, 'references', 'my-notes.md'), 'a note the shadow supplies\n', 'utf-8');
    }

    const { report, copiedTo } = await installOffWithRefusedRemoval();

    expect(report.shadowedSkills.includes('git'), 'precondition: the shadow is the skill that was copied').toBe(shadowed);
    for (const entry of POSTING_FILES) {
      expect(copiedTo, `${entry} is never copied`).not.toContain(flatFile(entry));
      expect(await exists(flatFile(entry)), `${entry} is not on the machine`).toBe(false);
    }
    expect(report.sweepFailures, 'there was nothing for the removal to fail on').toEqual([]);
    if (shadowed) expect(await exists(path.join(installedRefs(), 'my-notes.md')), 'the rest of the shadow is copied').toBe(true);
  });

  it('compliance on copies both files, as before', async () => {
    await installInto(claudeDir, devflowDir, true);

    for (const entry of POSTING_FILES) expect(await exists(flatFile(entry)), `${entry} is installed`).toBe(true);
  });
});

const GENERATED = 'trust-rule.md';
const HAND_AUTHORED = 'detection.md';
const STRAY = path.join('pr', 'not-in-the-manifest.md');
const MODE_FILE = 'sources.md';

/** Move an installed folder aside, link its place to it, and make every write an install would do show as a change. */
async function linkAway(installed: string, outside: string, refs: string): Promise<void> {
  await fs.rename(installed, outside);
  await fs.symlink(outside, installed, 'dir');
  await fs.writeFile(path.join(refs, GENERATED), 'a generated reference the overlay would rewrite\n', 'utf-8');
  await fs.writeFile(path.join(refs, HAND_AUTHORED), 'a skill reference the copy would overwrite\n', 'utf-8');
  await fs.writeFile(path.join(refs, STRAY), 'a file the prune would remove\n', 'utf-8');
  await fs.chmod(path.join(refs, MODE_FILE), 0o600);
}

async function expectUntouched(outside: string, refs: string, before: { files: Record<string, string>; tree: string[] }): Promise<void> {
  expect(await fileMap(outside), 'no byte below the link changed').toEqual(before.files);
  expect(await walk(outside), 'nothing was added below the link, staging residue included').toEqual(before.tree);
  expect(await exists(path.join(refs, STRAY)), 'the stray file is still there').toBe(true);
  expect((await fs.stat(path.join(refs, MODE_FILE))).mode & 0o777, 'no mode was set through the link').toBe(0o600);
}

/** Every entry below `dir` as relative path -> kind, mode and bytes (a link: its target), so a changed byte, mode, file or folder shows. */
async function treeSnapshot(dir: string, prefix = ''): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const entry of await fs.readdir(dir)) {
    const rel = prefix === '' ? entry : `${prefix}/${entry}`;
    const full = path.join(dir, entry);
    const stat = await fs.lstat(full);
    const mode = (stat.mode & 0o777).toString(8);
    if (stat.isSymbolicLink()) out[rel] = `link:${await fs.readlink(full)}`;
    else if (stat.isDirectory()) Object.assign(out, { [`${rel}/`]: `dir:${mode}` }, await treeSnapshot(full, rel));
    else out[rel] = `file:${mode}:${(await fs.readFile(full)).toString('base64')}`;
  }
  return out;
}

/** One folder kind a partial install writes. */
interface FolderCase {
  readonly name: string;
  /** Cases of one unit share a refusal: a linked references folder refuses the whole `devflow:git` skill. */
  readonly unit: string;
  readonly folder: () => string;
  /** A file below the folder that an unguarded install rewrites. */
  readonly marker: string;
  /** A file below the folder that an unguarded install removes or leaves, and a guarded one never touches. */
  readonly stray: string;
  /** What the user keeps in the marker, from the installed bytes; a text only the user wrote when omitted. */
  readonly userBytes?: (installed: string) => string;
  /** Whether the refusal also reaches the overlay report, one failure for each overlay unit. */
  readonly overlay: boolean;
}

const STAMP_LINE = 'Installed language focuses: (none)';
const FOLDER_CASES: readonly FolderCase[] = [
  {
    name: 'commands/devflow', unit: 'commands', overlay: false,
    folder: () => path.join(claudeDir, 'commands', 'devflow'),
    marker: 'code-review.md', stray: 'stray.md',
    // A stamp the run restamps and a text the copy rewrites, so each write is its own failure.
    userBytes: installed => installed.replace(STAMP_LINE, 'Installed language focuses: python'),
  },
  {
    name: 'agents/devflow', unit: 'agents', overlay: false,
    folder: () => path.join(claudeDir, 'agents', 'devflow'),
    marker: 'review.md', stray: 'stray.md',
  },
  {
    name: 'rules/devflow', unit: 'rules', overlay: false,
    folder: () => path.join(claudeDir, 'rules', 'devflow'),
    marker: 'security.md', stray: 'stray.md',
  },
  {
    name: 'a skill folder other than devflow:git', unit: 'skill', overlay: false,
    folder: () => path.join(skillsRoot(), 'devflow:agent-references'),
    marker: 'SKILL.md', stray: 'stray.md',
  },
  {
    name: 'devflow:git', unit: 'git', overlay: true,
    folder: () => path.join(skillsRoot(), 'devflow:git'),
    marker: 'SKILL.md', stray: path.join('references', 'pr', 'not-in-the-manifest.md'),
  },
  {
    name: 'devflow:git/references', unit: 'git', overlay: true,
    folder: () => installedRefs(),
    marker: GENERATED, stray: STRAY,
  },
];

const markerOf = (folderCase: FolderCase): string => path.join(folderCase.folder(), folderCase.marker);

/** Install the folder kinds of FOLDER_CASES together: code-review's command and agents, a core rule, and two skills. */
function installEveryFolder(isPartialInstall: boolean) {
  const added = DEVFLOW_PLUGINS.filter(p => p.name === 'devflow-code-review');
  return installViaFileCopy({
    curation: true,
    compliance: true,
    plugins: added,
    effectivePlugins: [...CORE, ...added],
    claudeDir,
    devflowDir,
    skillsMap: SKILLS,
    agentsMap: buildAssetMaps(added).agentsMap,
    rulesMap: new Map([['security', 'devflow-core-skills']]),
    isPartialInstall,
    spinner: noopSpinner,
    warn,
  });
}

describe('a partial install refuses every linked devflow folder and writes nothing through it', () => {
  const STALE = 'a file the install rewrites\n';

  /** The marker bytes of a first install, and every marker turned stale: only a write puts the installed bytes back. */
  async function installThenStale(skip: (folderCase: FolderCase) => boolean): Promise<Map<string, Buffer>> {
    await installEveryFolder(false);
    const installed = new Map<string, Buffer>();
    for (const folderCase of FOLDER_CASES) installed.set(folderCase.name, await fs.readFile(markerOf(folderCase)));
    for (const folderCase of FOLDER_CASES) if (!skip(folderCase)) await fs.writeFile(markerOf(folderCase), STALE, 'utf-8');
    return installed;
  }

  it.each(FOLDER_CASES)('$name that is a link: nothing is written through it, and the refusal is reported', async (linked) => {
    const installed = await installThenStale(folderCase => folderCase.unit === linked.unit);
    const folder = linked.folder();
    const outside = path.join(tmp, 'outside');
    await fs.rename(folder, outside);
    await fs.symlink(outside, folder, 'dir');
    const markerFile = path.join(outside, linked.marker);
    const user = linked.userBytes?.(installed.get(linked.name)!.toString('utf-8')) ?? 'a file only the user keeps\n';
    await fs.writeFile(markerFile, user, 'utf-8');
    await fs.chmod(markerFile, 0o600);
    await fs.mkdir(path.dirname(path.join(outside, linked.stray)), { recursive: true });
    await fs.writeFile(path.join(outside, linked.stray), 'a stray file only the user keeps\n', 'utf-8');
    const before = await treeSnapshot(outside);
    expect(before[linked.marker], 'precondition: the marker is the 0600 file the user keeps').toMatch(/^file:600:/);

    const report = await installEveryFolder(true);

    expect(await treeSnapshot(outside), 'no byte, mode, file or folder below the link changed').toEqual(before);
    expect((await fs.lstat(folder)).isSymbolicLink(), 'the link itself is left in place').toBe(true);
    expect(await fs.readlink(folder)).toBe(outside);
    expect(report.refusedFolders, 'the refusal is reported, once').toEqual([folder]);
    expect(report.replacedLinks, 'a partial install replaces no link').toEqual([]);

    const lines = formatRefusedFoldersSummary(report);
    expect(lines).toHaveLength(1);
    expect(lines[0].level).toBe('warn');
    expect(lines[0].message).toContain(folder);
    expect(lines[0].message).toContain('Nothing was written there');

    if (linked.overlay) {
      const units = planOverlayUnits(installedReferenceManifest({ compliance: true }));
      expect(report.overlayFailures, 'one refusal per overlay unit').toHaveLength(units.length);
      for (const failure of report.overlayFailures) expect(failure.error).toContain(folder);
      expect(report.overlaidRefs).toEqual([]);
      expect(report.unchangedRefs).toEqual([]);
    } else {
      expect(report.overlayFailures).toEqual([]);
    }

    for (const other of FOLDER_CASES.filter(folderCase => folderCase.unit !== linked.unit)) {
      expect(await fs.readFile(markerOf(other)), `${other.name} is still written`).toEqual(installed.get(other.name));
    }
  });

  it('over real folders a partial install writes every folder and reports no refusal', async () => {
    const installed = await installThenStale(() => false);

    const report = await installEveryFolder(true);

    expect(report.refusedFolders).toEqual([]);
    expect(report.overlayFailures).toEqual([]);
    expect(formatRefusedFoldersSummary(report)).toEqual([]);
    for (const folderCase of FOLDER_CASES) {
      expect(await fs.readFile(markerOf(folderCase)), `${folderCase.name} is written`).toEqual(installed.get(folderCase.name));
    }
  });
});

describe('a full install replaces a linked folder and leaves the linked folder as it is', () => {
  /** The skill a fresh full install writes, to compare the replacement with. */
  async function freshSkill(name: string): Promise<Record<string, string>> {
    const home = path.join(tmp, 'fresh');
    await fs.mkdir(home, { recursive: true });
    await installInto(path.join(home, 'claude'), path.join(home, 'devflow'), true);
    return fileMap(path.join(skillsRoot(path.join(home, 'claude')), name));
  }

  it('a skill folder that is a link: it is replaced by a real folder with the whole skill, and reported', async () => {
    await installInto(claudeDir, devflowDir, true);
    const installed = path.join(skillsRoot(), 'devflow:git');
    const outside = path.join(tmp, 'outside-skill');
    await linkAway(installed, outside, path.join(outside, 'references'));
    const before = { files: await fileMap(outside), tree: await walk(outside) };

    const report = await installInto(claudeDir, devflowDir, true);

    await expectUntouched(outside, path.join(outside, 'references'), before);
    const stat = await fs.lstat(installed);
    expect(stat.isSymbolicLink(), 'the link is gone').toBe(false);
    expect(stat.isDirectory(), 'a real folder stands in its place').toBe(true);
    expect(await fileMap(installed), 'the folder holds the whole installed skill, references included').toEqual(await freshSkill('devflow:git'));
    expect(report.replacedLinks).toEqual([installed]);
    expect(report.overlayFailures).toEqual([]);
    expect(report.overlaidRefs.length, 'the references were installed').toBeGreaterThan(0);
  });

  it('a references folder that is a link: it is replaced by a real folder with every reference, and reported', async () => {
    await installInto(claudeDir, devflowDir, true);
    const outside = path.join(tmp, 'outside-refs');
    await linkAway(installedRefs(), outside, outside);
    const before = { files: await fileMap(outside), tree: await walk(outside) };

    const report = await installInto(claudeDir, devflowDir, true);

    await expectUntouched(outside, outside, before);
    expect((await fs.lstat(installedRefs())).isDirectory(), 'a real folder stands in its place').toBe(true);
    expect(await fileMap(path.join(skillsRoot(), 'devflow:git')), 'the skill is complete').toEqual(await freshSkill('devflow:git'));
    expect(report.replacedLinks).toEqual([installedRefs()]);
    expect(report.overlayFailures).toEqual([]);
  });

  it('a folder of another skill that is a link: it is replaced, reported, and the linked folder is untouched', async () => {
    await installInto(claudeDir, devflowDir, true);
    const installed = path.join(skillsRoot(), 'devflow:agent-references');
    const outside = path.join(tmp, 'outside-other-skill');
    await fs.rename(installed, outside);
    await fs.symlink(outside, installed, 'dir');
    await fs.writeFile(path.join(outside, 'stray.md'), 'a file only the user keeps\n', 'utf-8');
    await fs.chmod(path.join(outside, 'stray.md'), 0o600);
    const before = { files: await fileMap(outside), tree: await walk(outside) };

    const report = await installInto(claudeDir, devflowDir, true);

    expect(await fileMap(outside)).toEqual(before.files);
    expect(await walk(outside)).toEqual(before.tree);
    expect((await fs.stat(path.join(outside, 'stray.md'))).mode & 0o777).toBe(0o600);
    expect((await fs.lstat(installed)).isDirectory(), 'a real folder stands in its place').toBe(true);
    expect(await fileMap(installed)).toEqual(await freshSkill('devflow:agent-references'));
    expect(report.replacedLinks).toEqual([installed]);
  });

  it('the agents folder that is a link: it is unlinked and reported, and the linked folder is untouched', async () => {
    await installInto(claudeDir, devflowDir, true);
    const agents = path.join(claudeDir, 'agents', 'devflow');
    const outside = path.join(tmp, 'outside-agents');
    await fs.mkdir(outside, { recursive: true });
    await fs.writeFile(path.join(outside, 'mine.md'), 'an agent only the user keeps\n', 'utf-8');
    await fs.chmod(path.join(outside, 'mine.md'), 0o600);
    await fs.rm(agents, { recursive: true, force: true });
    await fs.mkdir(path.dirname(agents), { recursive: true });
    await fs.symlink(outside, agents, 'dir');
    const before = { files: await fileMap(outside), tree: await walk(outside) };

    const report = await installInto(claudeDir, devflowDir, true);

    expect(await fileMap(outside)).toEqual(before.files);
    expect(await walk(outside)).toEqual(before.tree);
    expect((await fs.stat(path.join(outside, 'mine.md'))).mode & 0o777).toBe(0o600);
    const after = await fs.lstat(agents).catch(() => null);
    expect(after?.isSymbolicLink() ?? false, 'the link is gone').toBe(false);
    expect(report.replacedLinks).toEqual([agents]);
  });

  // The commands and rules folders are the two a full install replaces before it writes anything, from
  // the pre-clean that opens the install; a partial install refuses them instead.
  const FULL_INSTALL_FOLDERS = FOLDER_CASES.filter(folderCase => folderCase.unit === 'commands' || folderCase.unit === 'rules');

  it.each(FULL_INSTALL_FOLDERS)('$name that is a link: it is replaced by a real folder with every file, reported, and the linked folder keeps every byte', async (linked) => {
    await installEveryFolder(false);
    const folder = linked.folder();
    const installed = await fileMap(folder);
    const outside = path.join(tmp, 'outside-folder');
    await fs.rename(folder, outside);
    await fs.symlink(outside, folder, 'dir');
    await fs.writeFile(path.join(outside, linked.marker), 'a file only the user keeps\n', 'utf-8');
    await fs.chmod(path.join(outside, linked.marker), 0o600);
    await fs.writeFile(path.join(outside, linked.stray), 'a stray file only the user keeps\n', 'utf-8');
    const before = await treeSnapshot(outside);
    expect(before[linked.marker], 'precondition: the marker is the 0600 file the user keeps').toMatch(/^file:600:/);

    const report = await installEveryFolder(false);

    expect(await treeSnapshot(outside), 'no byte, mode, file or folder below the link changed').toEqual(before);
    const stat = await fs.lstat(folder);
    expect(stat.isSymbolicLink(), 'the link is gone').toBe(false);
    expect(stat.isDirectory(), 'a real folder stands in its place').toBe(true);
    expect(await fileMap(folder), 'the folder holds what a first install wrote').toEqual(installed);
    expect(report.replacedLinks, 'the replaced link is reported').toEqual([folder]);
    expect(report.refusedFolders).toEqual([]);

    const lines = formatReplacedLinksSummary(report);
    expect(lines).toHaveLength(1);
    expect(lines[0].level).toBe('warn');
    expect(lines[0].message).toContain(folder);
    expect(lines[0].message).toContain('left as it was');
  });

  it('over real folders a full install reports no replaced link', async () => {
    await installInto(claudeDir, devflowDir, true);

    const report = await installInto(claudeDir, devflowDir, true);

    expect(report.replacedLinks).toEqual([]);
  });

  it('a link that cannot be removed is refused like a partial install refuses it: nothing is written through it', async () => {
    await installInto(claudeDir, devflowDir, true);
    const installed = path.join(skillsRoot(), 'devflow:git');
    const outside = path.join(tmp, 'outside-stuck');
    await linkAway(installed, outside, path.join(outside, 'references'));
    const before = { files: await fileMap(outside), tree: await walk(outside) };
    const realUnlink = fs.unlink.bind(fs);
    const unlink = vi.spyOn(fs, 'unlink').mockImplementation(async (target) => {
      if (target === installed) throw Object.assign(new Error('operation not permitted'), { code: 'EPERM' });
      return realUnlink(target);
    });

    let report;
    try {
      report = await installInto(claudeDir, devflowDir, true);
    } finally {
      unlink.mockRestore();
    }

    await expectUntouched(outside, path.join(outside, 'references'), before);
    expect(report.replacedLinks).toEqual([]);
    expect(report.overlayFailures.length, 'the overlay is refused').toBeGreaterThan(0);
    expect(report.overlaidRefs).toEqual([]);
    expect((await fs.lstat(installed)).isSymbolicLink(), 'the link is left in place').toBe(true);
  });

  it('the summary names each replaced link and says the linked folder was left as it was', async () => {
    await installInto(claudeDir, devflowDir, true);
    const installed = path.join(skillsRoot(), 'devflow:git');
    await linkAway(installed, path.join(tmp, 'outside-summary'), path.join(tmp, 'outside-summary', 'references'));

    const report = await installInto(claudeDir, devflowDir, true);
    const lines = formatReplacedLinksSummary(report);

    expect(lines).toHaveLength(1);
    expect(lines[0].level).toBe('warn');
    expect(lines[0].message).toContain(installed);
    expect(lines[0].message).toContain('left as it was');
    expect(formatReplacedLinksSummary({ replacedLinks: [] })).toEqual([]);
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
