/**
 * The build layer of the workflow skill folders (#675 PR A; TP-18, TP-41 static part,
 * TP-63 build side, TP-65 baseline).
 *
 * A workflow skill folder is one core host that becomes `SKILL.md` beside reference
 * hosts. The build compiles it as a UNIT, because its build id is made from all of its
 * files: every variant key (on, curation-off, compliance-off, both-off) gets a COMPLETE
 * folder for its own file list, the same id is stamped into the first heading of every
 * file outside references/, and the reference files stay byte-equal.
 *
 * PR A ships an EMPTY real registry (WORKFLOW_FOLDERS), so no host in src/assets becomes
 * a folder and every other file the build writes is unchanged. The layer is therefore
 * proved on the five-host FIXTURE (tests/fixtures/workflow-folder.ts), built against a
 * throwaway DEVFLOW_MDS_ROOT whose registry the test injects through
 * DEVFLOW_MDS_WORKFLOW_FOLDERS. The real src/ and dist/ trees are only ever read, and
 * the self-scan at the end holds this file to that.
 */

import { describe, it, expect, afterAll, beforeAll, vi } from 'vitest';
import { promises as fs, readFileSync } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createHash } from 'crypto';
import { spawnSync } from 'child_process';

import { collectSpawnScoping, walkFiles, type BuildRun } from './helpers.js';
import {
  FIXTURE_DIR,
  FIXTURE_FOLDER,
  FIXTURE_HOST_SOURCES,
  FIXTURE_SOURCES,
  writeFixtureSources,
} from './fixtures/workflow-folder.js';
import {
  BUILD_ID_LENGTH,
  WORKFLOW_FOLDERS_OUTPUT_DIR,
  checkFolderBuildIds,
  isStampedWorkflowFile,
  readBuildId,
  workflowFolderFiles,
  workflowFoldersRootRelPath,
  type CompiledFolderFile,
  type WorkflowFolder,
} from '../src/core/mds-variants.js';
import {
  VARIANT_KEYS,
  VARIANT_MANIFEST_REL_PATH,
  parseVariantManifest,
  type VariantKey,
} from '../src/core/curation-variants.js';

vi.setConfig({ testTimeout: 120_000 });

const ROOT = path.resolve(import.meta.dirname, '..');
const TSX_BIN = path.join(ROOT, 'node_modules', '.bin', 'tsx');
const SCRIPT = path.join(ROOT, 'scripts', 'build-mds.ts');
/** This file's own source, read by the self-scan at the end. */
const SELF = import.meta.filename;

const REGISTRY_ENV = 'DEVFLOW_MDS_WORKFLOW_FOLDERS';

/** Fake roots made by this file, removed after the run whatever its outcome. */
const fakeRoots: string[] = [];

afterAll(async () => {
  for (const fakeRoot of fakeRoots.splice(0)) {
    await fs.rm(fakeRoot, { recursive: true, force: true });
  }
});

async function makeFakeRoot(): Promise<string> {
  const fakeRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-mds-workflow-'));
  fakeRoots.push(fakeRoot);
  return fakeRoot;
}

/**
 * Run the real build script against a fake root, handing it a workflow folder registry.
 *
 * `registry` is the JSON text of the registry, or null for none: the build then uses its
 * shipped registry, which is empty.
 */
function runBuild(fakeRoot: string, registry: string | null): BuildRun {
  const inherited: NodeJS.ProcessEnv = { ...process.env };
  if (registry === null) delete inherited[REGISTRY_ENV];
  else inherited[REGISTRY_ENV] = registry;
  const result = spawnSync(TSX_BIN, [SCRIPT], {
    cwd: ROOT,
    encoding: 'utf-8',
    timeout: 60_000,
    env: { ...inherited, DEVFLOW_MDS_ROOT: fakeRoot },
  });
  if (result.error) throw result.error;
  return { status: result.status, combined: (result.stdout ?? '') + (result.stderr ?? '') };
}

function registryJson(folders: readonly WorkflowFolder[] = [FIXTURE_FOLDER]): string {
  return JSON.stringify(folders);
}

interface FixtureBuild {
  readonly root: string;
  readonly run: BuildRun;
}

/** Write the fixture into a new root (with overrides) and build it against the fixture registry. */
async function buildFixture(
  overrides: Readonly<Record<string, string | null>> = {},
  registry: string | null = registryJson(),
): Promise<FixtureBuild> {
  const root = await makeFakeRoot();
  await writeFixtureSources(root, overrides);
  return { root, run: runBuild(root, registry) };
}

/** Every `.md` of one folder under one variant key: POSIX path inside the folder to text. */
function readFolder(root: string, key: VariantKey, folder = FIXTURE_FOLDER.name): Map<string, string> {
  const dir = path.join(root, ...`${workflowFoldersRootRelPath(key)}/${folder}`.split('/'));
  const files = new Map<string, string>();
  for (const file of walkFiles(dir, f => f.endsWith('.md'))) {
    files.set(path.relative(dir, file).split(path.sep).join('/'), readFileSync(file, 'utf-8'));
  }
  return files;
}

function sortedKeys(files: ReadonlyMap<string, string>): string[] {
  return [...files.keys()].sort();
}

function asFolderFiles(files: ReadonlyMap<string, string>): CompiledFolderFile[] {
  return [...files].map(([file, body]) => ({ file, body }));
}

/** The build id the first heading of a stamped file carries. */
function idOf(files: ReadonlyMap<string, string>): string {
  const checked = checkFolderBuildIds(asFolderFiles(files));
  if (!checked.ok) throw new Error(`the folder does not read back one build id: ${JSON.stringify(checked.error)}`);
  return checked.value;
}

const STAMP_RE = / \[build [0-9a-f]{12}\]/;

/** The files in the order of the independent expectation below, never derived from the code under test. */
const ALL_FILES = ['SKILL.md', 'base-note.md', 'ci-fix.md', 'references/evidence-asks.md', 'references/levels.md'];
const COMPLIANCE_OFF_FILES = ALL_FILES.filter(file => file !== 'references/evidence-asks.md');
const EXPECTED_FILES: Readonly<Record<VariantKey, readonly string[]>> = {
  on: ALL_FILES,
  'curation-off': ALL_FILES,
  'compliance-off': COMPLIANCE_OFF_FILES,
  'both-off': COMPLIANCE_OFF_FILES,
};

// ---------------------------------------------------------------------------
// The fixture build
// ---------------------------------------------------------------------------

describe('the five-host fixture build', () => {
  let built: FixtureBuild;

  beforeAll(async () => {
    built = await buildFixture();
  }, 120_000);

  it('compiles the five hosts and exits 0', () => {
    expect(built.run.status, built.run.combined).toBe(0);
    expect(built.run.combined).toContain('5 host(s) to compile');
    expect(built.run.combined).toContain('1 partial(s) skipped');
    expect(built.run.combined).toContain('MDS: 5 compiled, 0 error(s)');
    expect(FIXTURE_HOST_SOURCES).toHaveLength(5);
  });

  it('TP-18: every variant key holds a complete folder for its own file list', () => {
    for (const key of VARIANT_KEYS) {
      const files = readFolder(built.root, key);
      expect(sortedKeys(files), `variant key '${key}'`).toEqual([...EXPECTED_FILES[key]].sort());
      expect(sortedKeys(files), `variant key '${key}' against the registry's own list`)
        .toEqual([...workflowFolderFiles(FIXTURE_FOLDER, key)].sort());
    }
  });

  it('the compliance-gated reference is in the compliance-on folders only', () => {
    for (const key of VARIANT_KEYS) {
      const onlyOn = key === 'on' || key === 'curation-off';
      expect(readFolder(built.root, key).has('references/evidence-asks.md'), `variant key '${key}'`).toBe(onlyOn);
    }
  });

  it('TP-63: the core compiles to SKILL.md with its real frontmatter minus the build keys', () => {
    for (const key of VARIANT_KEYS) {
      const core = readFolder(built.root, key).get('SKILL.md') ?? '';
      expect(core, `variant key '${key}'`).toMatch(
        /^---\nname: devflow:flow\ndescription: Fixture workflow skill for the build layer tests\n---\n/,
      );
      expect(core).not.toContain('output-dir');
    }
  });

  it('a reference host sheds its whole steering block and ships with no frontmatter', () => {
    for (const key of VARIANT_KEYS) {
      for (const [file, text] of readFolder(built.root, key)) {
        if (file === 'SKILL.md') continue;
        expect(text.startsWith('---'), `${key}/${file}`).toBe(false);
        expect(text, `${key}/${file}`).not.toContain('output-dir');
        expect(text, `${key}/${file}`).toContain('Shared line from the partial.');
      }
    }
  });

  it('each key keeps its own arms: the on arms in the on key, the off arms in the key that turns the axis off', () => {
    const core = (key: VariantKey): string => readFolder(built.root, key).get('SKILL.md') ?? '';
    const ci = (key: VariantKey): string => readFolder(built.root, key).get('ci-fix.md') ?? '';

    expect(core('on')).toContain('write the learned entry');
    expect(core('on')).toContain('read references/evidence-asks.md');
    expect(core('curation-off')).toContain('skip the entry');
    expect(core('curation-off')).not.toContain('learned entry');
    expect(core('curation-off')).toContain('read references/evidence-asks.md');
    expect(core('compliance-off')).toContain('write the learned entry');
    expect(core('compliance-off')).toContain('inline the evidence asks here');
    expect(core('compliance-off')).not.toContain('references/evidence-asks.md');
    expect(core('both-off')).toContain('skip the entry');
    expect(core('both-off')).toContain('inline the evidence asks here');

    expect(ci('on')).toContain('Post the CI result as a comment.');
    expect(ci('compliance-off')).toContain('Keep the CI result in the local file.');
    expect(ci('compliance-off')).not.toContain('Post the CI result');
    expect(ci('both-off')).toContain('Keep the CI result in the local file.');
  });

  it('a file with no arm is a byte copy of the on text under every key that holds it', () => {
    const onLevels = readFolder(built.root, 'on').get('references/levels.md');
    expect(onLevels).toContain('Full, standard, lean.');
    for (const key of VARIANT_KEYS) {
      expect(readFolder(built.root, key).get('references/levels.md'), `variant key '${key}'`).toBe(onLevels);
    }
    expect(readFolder(built.root, 'curation-off').get('references/evidence-asks.md'))
      .toBe(readFolder(built.root, 'on').get('references/evidence-asks.md'));
  });

  it('TP-41: every stamped file of one folder and key carries the same build id, in its first heading', () => {
    for (const key of VARIANT_KEYS) {
      const files = readFolder(built.root, key);
      const id = idOf(files);
      expect(id, `variant key '${key}'`).toMatch(new RegExp(`^[0-9a-f]{${BUILD_ID_LENGTH}}$`));
      for (const [file, text] of files) {
        if (!isStampedWorkflowFile(file)) continue;
        const heading = text.split('\n').find(line => line.startsWith('# '));
        expect(heading, `${key}/${file}`).toMatch(new RegExp(` \\[build ${id}\\]$`));
        expect(text.match(/\[build [0-9a-f]{12}\]/g), `${key}/${file}: one stamp, nowhere else`).toHaveLength(1);
      }
    }
  });

  it('TP-41: the reference files are outside the stamp and the check', () => {
    for (const key of VARIANT_KEYS) {
      for (const [file, text] of readFolder(built.root, key)) {
        if (isStampedWorkflowFile(file)) continue;
        expect(file.startsWith('references/'), file).toBe(true);
        expect(text, `${key}/${file}`).not.toMatch(STAMP_RE);
        expect(readBuildId(text).ok, `${key}/${file}`).toBe(false);
      }
    }
    expect(readFolder(built.root, 'on').get('references/levels.md')).toBe(
      '# Levels\n\nShared line from the partial.\n\nFull, standard, lean.\n',
    );
  });

  it('TP-41: the id is the first 12 hex digits of the SHA-256 over the bodies before the stamp, sorted by file name', () => {
    for (const key of VARIANT_KEYS) {
      const files = readFolder(built.root, key);
      const hash = createHash('sha256');
      for (const file of [...files.keys()].sort()) {
        const body = (files.get(file) ?? '').replace(STAMP_RE, '');
        hash.update(`${file}\n${Buffer.byteLength(body, 'utf8')}\n`);
        hash.update(body, 'utf8');
        hash.update('\n');
      }
      expect(idOf(files), `variant key '${key}'`).toBe(hash.digest('hex').slice(0, 12));
    }
  });

  it('TP-41: the four keys have four ids, because their folders differ', () => {
    const ids = VARIANT_KEYS.map(key => idOf(readFolder(built.root, key)));
    expect(new Set(ids).size, ids.join(', ')).toBe(4);
  });

  it('TP-41: a folder that mixes build ids stops the check, and names every file with its id', () => {
    const files = readFolder(built.root, 'on');
    const id = idOf(files);
    const foreign = id === 'a'.repeat(12) ? 'b'.repeat(12) : 'a'.repeat(12);
    const mixed = new Map(files);
    mixed.set('ci-fix.md', (files.get('ci-fix.md') ?? '').replace(`[build ${id}]`, `[build ${foreign}]`));

    const checked = checkFolderBuildIds(asFolderFiles(mixed));
    expect(checked.ok).toBe(false);
    if (checked.ok || checked.error.kind !== 'mixed-ids') throw new Error(JSON.stringify(checked));
    expect(Object.fromEntries(checked.error.ids.map(entry => [entry.file, entry.id]))).toEqual({
      'SKILL.md': id,
      'base-note.md': id,
      'ci-fix.md': foreign,
    });
  });

  it('TP-41: a stamped file that lost its stamp stops the check by name', () => {
    const files = new Map(readFolder(built.root, 'on'));
    files.set('base-note.md', (files.get('base-note.md') ?? '').replace(STAMP_RE, ''));
    const checked = checkFolderBuildIds(asFolderFiles(files));
    expect(checked.ok).toBe(false);
    expect(!checked.ok && checked.error).toEqual({ kind: 'unstamped', file: 'base-note.md', reason: 'no-stamp' });
  });

  it('a folder is not a prompt: the variant manifest lists none and keeps its shape', async () => {
    const text = await fs.readFile(path.join(built.root, ...VARIANT_MANIFEST_REL_PATH.split('/')), 'utf-8');
    const manifest = parseVariantManifest(text);
    expect(manifest.ok).toBe(true);
    expect(manifest.ok && manifest.value).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Same sources, same id; a changed source, a new id (TP-41)
// ---------------------------------------------------------------------------

describe('the build id follows the sources and nothing else (TP-41)', () => {
  it('the same sources give the same id and the same bytes in a fresh root', async () => {
    const first = await buildFixture();
    const second = await buildFixture();
    expect(first.run.status, first.run.combined).toBe(0);
    expect(second.run.status, second.run.combined).toBe(0);

    for (const key of VARIANT_KEYS) {
      const a = readFolder(first.root, key);
      const b = readFolder(second.root, key);
      expect(idOf(a), `variant key '${key}'`).toBe(idOf(b));
      expect(Object.fromEntries(b), `variant key '${key}'`).toEqual(Object.fromEntries(a));
    }
  });

  it('a rebuild of the same root rewrites the same bytes', async () => {
    const first = await buildFixture();
    expect(first.run.status, first.run.combined).toBe(0);
    const before = Object.fromEntries(VARIANT_KEYS.map(key => [key, Object.fromEntries(readFolder(first.root, key))]));

    const again = runBuild(first.root, registryJson());
    expect(again.status, again.combined).toBe(0);
    const after = Object.fromEntries(VARIANT_KEYS.map(key => [key, Object.fromEntries(readFolder(first.root, key))]));
    expect(after).toEqual(before);
  });

  it('a changed stamped file gives a new id under every key, and the others keep the old text', async () => {
    const base = await buildFixture();
    const changed = await buildFixture({
      [`${FIXTURE_DIR}/base-note.mds`]:
        '---\noutput-dir: dist/workflows\n---\n@import "./_shared.mds" as shared\n# Base note\n\n{{shared.shared_line()}}\n\nA different note.\n',
    });
    expect(changed.run.status, changed.run.combined).toBe(0);
    for (const key of VARIANT_KEYS) {
      expect(idOf(readFolder(changed.root, key)), `variant key '${key}'`).not.toBe(idOf(readFolder(base.root, key)));
      expect(readFolder(changed.root, key).get('references/levels.md'))
        .toBe(readFolder(base.root, key).get('references/levels.md'));
    }
  });

  it('a changed reference file moves the id of its folder and stays unstamped and byte-equal to its body', async () => {
    const base = await buildFixture();
    const changed = await buildFixture({
      [`${FIXTURE_DIR}/references/levels.mds`]:
        '---\noutput-dir: dist/workflows\n---\n@import "../_shared.mds" as shared\n# Levels\n\n{{shared.shared_line()}}\n\nFull only.\n',
    });
    expect(changed.run.status, changed.run.combined).toBe(0);
    expect(idOf(readFolder(changed.root, 'on'))).not.toBe(idOf(readFolder(base.root, 'on')));
    expect(readFolder(changed.root, 'on').get('references/levels.md'))
      .toBe('# Levels\n\nShared line from the partial.\n\nFull only.\n');
  });
});

// ---------------------------------------------------------------------------
// A key that lacks a file of its own list fails the build (TP-18)
// ---------------------------------------------------------------------------

describe('a variant key that lacks a file of its own list fails the build (TP-18)', () => {
  it('a missing compliance-gated host fails the keys that list it and not the keys that omit it', async () => {
    const { root, run } = await buildFixture({ [`${FIXTURE_DIR}/references/evidence-asks.mds`]: null });
    expect(run.status, run.combined).toBe(1);
    expect(run.combined).toContain("variant key 'on' lacks 'references/evidence-asks.md'");
    expect(run.combined).toContain("variant key 'curation-off' lacks 'references/evidence-asks.md'");
    expect(run.combined).not.toContain("variant key 'compliance-off'");
    expect(run.combined).not.toContain("variant key 'both-off'");
    expect(run.combined).toContain(`${FIXTURE_DIR}/references/evidence-asks.mds`);
    await expect(fs.stat(path.join(root, ...WORKFLOW_FOLDERS_OUTPUT_DIR.split('/')))).rejects.toThrow();
  });

  it('a missing host that every key lists fails all four keys, and writes no file of the folder', async () => {
    const { root, run } = await buildFixture({ [`${FIXTURE_DIR}/base-note.mds`]: null });
    expect(run.status, run.combined).toBe(1);
    for (const key of VARIANT_KEYS) {
      expect(run.combined).toContain(`variant key '${key}' lacks 'base-note.md'`);
      expect(readFolder(root, key).size, `variant key '${key}' was left half-written`).toBe(0);
    }
  });

  it('a missing core fails the build', async () => {
    const { run } = await buildFixture({ [`${FIXTURE_DIR}/SKILL.mds`]: null });
    expect(run.status, run.combined).toBe(1);
    expect(run.combined).toContain("lacks 'SKILL.md'");
  });

  it('a registered folder none of whose hosts exists fails the build rather than vanishing', async () => {
    const root = await makeFakeRoot();
    await writeFixtureSources(root, Object.fromEntries(FIXTURE_HOST_SOURCES.map(source => [source, null])));
    await fs.mkdir(path.join(root, 'src', 'assets', 'commands'), { recursive: true });
    await fs.writeFile(
      path.join(root, 'src', 'assets', 'commands', 'hello.mds'),
      '---\ndescription: hello\noutput-dir: dist/commands\n---\n# Hello\n',
      'utf-8',
    );
    const run = runBuild(root, registryJson());
    expect(run.status, run.combined).toBe(1);
    expect(run.combined).toContain("workflow skill folder 'flow'");
    expect(run.combined).toContain("lacks 'SKILL.md'");
  });

  it('a host that cannot carry the build id is named, and the folder is not written', async () => {
    const { root, run } = await buildFixture({
      [`${FIXTURE_DIR}/ci-fix.mds`]: '---\noutput-dir: dist/workflows\n---\nNo heading in this file.\n',
    });
    expect(run.status, run.combined).toBe(1);
    expect(run.combined).toContain('ci-fix.md');
    expect(run.combined).toContain('no heading line to carry the build id');
    for (const key of VARIANT_KEYS) expect(readFolder(root, key).size).toBe(0);
  });

  it('a source that already carries a stamp is refused', async () => {
    const { run } = await buildFixture({
      [`${FIXTURE_DIR}/ci-fix.mds`]:
        '---\noutput-dir: dist/workflows\n---\n# CI fix [build 0123456789ab]\n\nText.\n',
    });
    expect(run.status, run.combined).toBe(1);
    expect(run.combined).toContain('already carries a build stamp');
  });
});

// ---------------------------------------------------------------------------
// The registry and the hosts it names
// ---------------------------------------------------------------------------

describe('the registry decides which hosts become a folder (D-WORKFLOW-FOLDER-BUILD)', () => {
  it('the shipped registry is empty, so a workflow host is refused and nothing is written', async () => {
    const { root, run } = await buildFixture({}, null);
    expect(run.status, run.combined).toBe(1);
    expect(run.combined).toContain('is not registered in WORKFLOW_FOLDERS');
    for (const source of FIXTURE_HOST_SOURCES) expect(run.combined).toContain(source);
    for (const key of VARIANT_KEYS) expect(readFolder(root, key).size).toBe(0);
  });

  it('an empty shipped registry adds nothing to a build with no workflow host', async () => {
    const root = await makeFakeRoot();
    await fs.mkdir(path.join(root, 'src', 'assets', 'commands'), { recursive: true });
    await fs.writeFile(
      path.join(root, 'src', 'assets', 'commands', 'hello.mds'),
      '---\ndescription: hello\noutput-dir: dist/commands\n---\n# Hello\n',
      'utf-8',
    );
    const run = runBuild(root, null);
    expect(run.status, run.combined).toBe(0);
    expect(await fs.readFile(path.join(root, 'dist', 'commands', 'hello.md'), 'utf-8'))
      .toBe('---\ndescription: hello\n---\n# Hello\n');
    for (const key of VARIANT_KEYS) {
      await expect(fs.stat(path.join(root, ...workflowFoldersRootRelPath(key).split('/'))), key).rejects.toThrow();
    }
  });

  it('output-name: on a workflow host is refused', async () => {
    const { run } = await buildFixture({
      [`${FIXTURE_DIR}/base-note.mds`]:
        '---\noutput-dir: dist/workflows\noutput-name: other\n---\n# Base note\n',
    });
    expect(run.status, run.combined).toBe(1);
    expect(run.combined).toContain('output-name: is not valid on a workflow skill host');
  });

  it('the core host must be named SKILL, the only name the third name rule accepts', async () => {
    const renamed: WorkflowFolder = { ...FIXTURE_FOLDER, core: `${FIXTURE_DIR}/main.mds` };
    const { run } = await buildFixture(
      {
        [`${FIXTURE_DIR}/SKILL.mds`]: null,
        [`${FIXTURE_DIR}/main.mds`]: FIXTURE_SOURCES[`${FIXTURE_DIR}/SKILL.mds`],
      },
      registryJson([renamed]),
    );
    expect(run.status, run.combined).toBe(1);
    expect(run.combined).toContain('must be named SKILL.mds');
  });

  it('the core keeps a real name: and description:, or the build fails', async () => {
    const { run } = await buildFixture({
      [`${FIXTURE_DIR}/SKILL.mds`]:
        '---\nname: devflow:flow\noutput-dir: dist/workflows\n---\n# Flow\n',
    });
    expect(run.status, run.combined).toBe(1);
    expect(run.combined).toContain("no 'description:' value in its frontmatter");
  });

  it('a registry that the core refuses stops the build before dist/ is touched', async () => {
    const bad = registryJson([{ ...FIXTURE_FOLDER, name: 'Flow' }]);
    const { root, run } = await buildFixture({}, bad);
    expect(run.status, run.combined).toBe(1);
    expect(run.combined).toContain(REGISTRY_ENV);
    await expect(fs.stat(path.join(root, 'dist'))).rejects.toThrow();
  });

  it('a registry that is not JSON stops the build before dist/ is touched', async () => {
    const { root, run } = await buildFixture({}, '{not json');
    expect(run.status, run.combined).toBe(1);
    expect(run.combined).toContain(`${REGISTRY_ENV} is not valid JSON`);
    await expect(fs.stat(path.join(root, 'dist'))).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Orphans are pruned
// ---------------------------------------------------------------------------

describe('orphan folders and nested orphan files are pruned', () => {
  it('removes a folder no registered folder names and a nested file no host wrote, under all four trees', async () => {
    const { root, run } = await buildFixture();
    expect(run.status, run.combined).toBe(0);
    const before = Object.fromEntries(VARIANT_KEYS.map(key => [key, Object.fromEntries(readFolder(root, key))]));

    const seeded: string[] = [];
    for (const key of VARIANT_KEYS) {
      const tree = path.join(root, ...workflowFoldersRootRelPath(key).split('/'));
      const orphanFile = path.join(tree, 'gone', 'references', 'old.md');
      const orphanNested = path.join(tree, 'flow', 'references', 'old-reference.md');
      const orphanRoot = path.join(tree, 'flow', 'old-note.md');
      for (const file of [orphanFile, orphanNested, orphanRoot]) {
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, '# Old\n', 'utf-8');
        seeded.push(file);
      }
    }

    const again = runBuild(root, registryJson());
    expect(again.status, again.combined).toBe(0);
    for (const file of seeded) await expect(fs.stat(file), file).rejects.toThrow();
    for (const key of VARIANT_KEYS) {
      const tree = path.join(root, ...workflowFoldersRootRelPath(key).split('/'));
      await expect(fs.stat(path.join(tree, 'gone')), `${key}: the orphan folder`).rejects.toThrow();
    }
    const after = Object.fromEntries(VARIANT_KEYS.map(key => [key, Object.fromEntries(readFolder(root, key))]));
    expect(after).toEqual(before);
    expect(again.combined).toContain('(no workflow skill folder)');
    expect(again.combined).toContain('(no workflow skill host)');
  });

  it('removes every folder when the registry is empty', async () => {
    const { root, run } = await buildFixture();
    expect(run.status, run.combined).toBe(0);
    await fs.rm(path.join(root, 'src', 'assets', 'commands', 'flow'), { recursive: true });
    await fs.mkdir(path.join(root, 'src', 'assets', 'commands'), { recursive: true });
    await fs.writeFile(
      path.join(root, 'src', 'assets', 'commands', 'hello.mds'),
      '---\ndescription: hello\noutput-dir: dist/commands\n---\n# Hello\n',
      'utf-8',
    );

    const again = runBuild(root, null);
    expect(again.status, again.combined).toBe(0);
    for (const key of VARIANT_KEYS) expect(readFolder(root, key).size, key).toBe(0);
    for (const key of VARIANT_KEYS) {
      await expect(fs.stat(path.join(root, ...workflowFoldersRootRelPath(key).split('/'), 'flow')), key).rejects.toThrow();
    }
  });
});

// ---------------------------------------------------------------------------
// Build time (TP-65): the PA1 baseline on the five-host fixture build
// ---------------------------------------------------------------------------

describe('the five-host fixture build time (TP-65)', () => {
  /** The bound a single build spawn may take in the suite: TP-65's per-site stop. */
  const SITE_BOUND_MS = 30_000;

  it('reports the median of three fixture builds, each inside the per-site bound', async () => {
    const elapsed: number[] = [];
    for (let run = 0; run < 3; run++) {
      const root = await makeFakeRoot();
      await writeFixtureSources(root);
      const started = performance.now();
      const result = runBuild(root, registryJson());
      elapsed.push(performance.now() - started);
      expect(result.status, result.combined).toBe(0);
    }
    const sorted = [...elapsed].sort((a, b) => a - b);
    console.info(
      `five-host fixture build: ${elapsed.map(ms => `${(ms / 1000).toFixed(2)} s`).join(', ')}; ` +
      `median ${(sorted[1] / 1000).toFixed(2)} s`,
    );
    for (const ms of elapsed) expect(ms).toBeLessThan(SITE_BOUND_MS);
  });
});

// ---------------------------------------------------------------------------
// Isolation
// ---------------------------------------------------------------------------

describe('this file never builds the real tree', () => {
  it('every build it spawns is scoped to a throwaway DEVFLOW_MDS_ROOT', () => {
    const scan = collectSpawnScoping(readFileSync(SELF, 'utf-8'));
    expect(scan.total, 'the scan found no spawn site: it is not reading this file').toBeGreaterThan(0);
    expect(scan.unscoped, 'a build spawn without DEVFLOW_MDS_ROOT would rebuild the real dist/').toEqual([]);
  });
});
