/**
 * The build's compliance arms in reference modules (AC-39; TP-54).
 *
 * A reference module may carry compliance markers. The build splits it into operation
 * sections first and each section on its arms second: the section with the on arms
 * kept is the reference at its own path, and the section with the off arms kept is the
 * compliance-off reference under dist/compliance-off/skills/git/references/. That
 * tree is complete (a byte copy where a module has no arm) and leaves out the
 * references a compliance-off install omits.
 *
 * Every build here runs against a throwaway DEVFLOW_MDS_ROOT (runMdsBuild), so the
 * real src/ and dist/ trees are only ever read. The fake root holds two real
 * registered modules, `_pr` and `_references`, with short sections, because the
 * registry decides which modules the build accepts and how many sections each needs.
 * The sections are built from the production rosters, never from retyped lists.
 *
 * The real committed sources are held to the same tree in tests/build-mds.test.ts.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';

import { runMdsBuild, walkFiles } from './helpers.js';
import {
  COMPLIANCE_OFF_SKILL_REFS_OUTPUT_DIR,
  GIT_CROSS_CUTTING_DOCS,
  POSTING_OPS,
  PR_HOST_OPS,
  SKILL_REFS_OUTPUT_DIR,
  complianceOffOmittedRelPaths,
  resolveVariantModules,
} from '../src/core/mds-variants.js';
import { containsVariantMarker } from '../src/core/curation-variants.js';

vi.setConfig({ testTimeout: 120_000 });

const PR_MODULE = 'src/assets/mds/git/_pr.mds';
const DOCS_MODULE = 'src/assets/mds/git/_references.mds';

const CON = '<!-- compliance:on -->';
const COFF = '<!-- compliance:off -->';
const CEND = '<!-- compliance:end -->';

/** Fake roots made by this file, removed after each test whatever its outcome. */
const fakeRoots: string[] = [];

afterEach(async () => {
  for (const fakeRoot of fakeRoots.splice(0)) {
    await fs.rm(fakeRoot, { recursive: true, force: true });
  }
});

async function makeFakeRoot(): Promise<string> {
  const fakeRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-mds-refarms-'));
  fakeRoots.push(fakeRoot);
  return fakeRoot;
}

async function write(fakeRoot: string, rel: string, text: string): Promise<void> {
  const file = path.join(fakeRoot, ...rel.split('/'));
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, text, 'utf-8');
}

async function readIfPresent(fakeRoot: string, rel: string): Promise<string | null> {
  return fs.readFile(path.join(fakeRoot, ...rel.split('/')), 'utf-8').then(text => text, () => null);
}

/** A reference module's source: the steering block, a preamble, then one `<!-- op: NAME -->` section per entry. */
function moduleSource(sections: ReadonlyArray<readonly [string, string]>): string {
  const body = sections.map(([op, text]) => `<!-- op: ${op} -->\n${text}`).join('\n');
  return `---\noutput-dir: ${SKILL_REFS_OUTPUT_DIR}\n---\nModule preamble, emitted nowhere.\n\n${body}\n`;
}

/** The text of a section no test puts an arm in. */
function plain(op: string): string {
  return `Plain steps for ${op}.\n`;
}

/** The sections of the PR module: every registered op, with the named ones overridden. */
function prSections(overrides: Readonly<Record<string, string>> = {}): ReadonlyArray<readonly [string, string]> {
  return PR_HOST_OPS.map((op): readonly [string, string] => [op, overrides[op] ?? plain(op)]);
}

/** The sections of the cross-cutting module: every registered document, with the named ones overridden. */
function docSections(overrides: Readonly<Record<string, string>> = {}): ReadonlyArray<readonly [string, string]> {
  return GIT_CROSS_CUTTING_DOCS.map((doc): readonly [string, string] => [doc, overrides[doc] ?? plain(doc)]);
}

/** A section with one arm on each side of an else. */
const ARMED = `Read the status.\n${CON}\nName the publication line.\n${COFF}\nName the local result file.\n${CEND}\nEnd of steps.\n`;

/** Every `.md` under a tree of the fake root, as a sorted POSIX path relative to the tree. */
function treeFiles(fakeRoot: string, treeRel: string): string[] {
  const tree = path.join(fakeRoot, ...treeRel.split('/'));
  return walkFiles(tree, file => file.endsWith('.md'))
    .map(file => path.relative(tree, file).split(path.sep).join('/'))
    .sort();
}

const OMITTED: ReadonlySet<string> = (() => {
  const omitted = complianceOffOmittedRelPaths(resolveVariantModules());
  if (!omitted.ok) throw new Error('the shipped registry must agree with POSTING_OPS');
  return omitted.value;
})();

describe('a reference module with compliance arms (TP-54)', () => {
  const ARMED_OP = 'check-ci-status';
  const POSTING_ARMED_OP = 'resolve-review-threads';

  async function buildFixture(overrides: Readonly<Record<string, string>> = {}): Promise<{
    fakeRoot: string;
    status: number | null;
    combined: string;
  }> {
    const fakeRoot = await makeFakeRoot();
    await write(fakeRoot, PR_MODULE, moduleSource(prSections({
      [ARMED_OP]: ARMED,
      [POSTING_ARMED_OP]: `Resolve the thread.\n${CON}\nReply on the thread.\n${CEND}\n`,
      ...overrides,
    })));
    await write(fakeRoot, DOCS_MODULE, moduleSource(docSections()));
    const run = runMdsBuild(fakeRoot);
    return { fakeRoot, ...run };
  }

  it('writes the on arms at the reference path and the off arms under the compliance-off root', async () => {
    const { fakeRoot, status, combined } = await buildFixture();
    expect(status, combined).toBe(0);

    expect(await readIfPresent(fakeRoot, `${SKILL_REFS_OUTPUT_DIR}/pr/${ARMED_OP}.md`))
      .toBe('Read the status.\nName the publication line.\nEnd of steps.\n');
    expect(await readIfPresent(fakeRoot, `${COMPLIANCE_OFF_SKILL_REFS_OUTPUT_DIR}/pr/${ARMED_OP}.md`))
      .toBe('Read the status.\nName the local result file.\nEnd of steps.\n');
  });

  it('copies a reference with no arm into the compliance-off tree byte for byte', async () => {
    const { fakeRoot, status, combined } = await buildFixture();
    expect(status, combined).toBe(0);

    for (const rel of ['pr/validate-branch.md', 'pr/check-merge-readiness.md', 'trust-rule.md', 'decision-markers.md']) {
      const on = await readIfPresent(fakeRoot, `${SKILL_REFS_OUTPUT_DIR}/${rel}`);
      expect(on, `${rel} is missing from the compliance-on tree`).not.toBeNull();
      expect(await readIfPresent(fakeRoot, `${COMPLIANCE_OFF_SKILL_REFS_OUTPUT_DIR}/${rel}`), rel).toBe(on);
    }
  });

  it('holds exactly the files a compliance-off install carries: the on tree minus the omitted references', async () => {
    const { fakeRoot, status, combined } = await buildFixture();
    expect(status, combined).toBe(0);

    const onFiles = treeFiles(fakeRoot, SKILL_REFS_OUTPUT_DIR);
    const offFiles = treeFiles(fakeRoot, COMPLIANCE_OFF_SKILL_REFS_OUTPUT_DIR);
    expect(onFiles.filter(rel => OMITTED.has(rel)), 'the fixture is vacuous without an omitted reference in the on tree')
      .not.toEqual([]);
    expect(offFiles).toEqual(onFiles.filter(rel => !OMITTED.has(rel)));
  });

  it('writes no compliance-off file for a posting operation or the publication gate, and keeps their on files', async () => {
    const { fakeRoot, status, combined } = await buildFixture();
    expect(status, combined).toBe(0);

    for (const op of POSTING_OPS.filter(name => (PR_HOST_OPS as readonly string[]).includes(name))) {
      expect(await readIfPresent(fakeRoot, `${SKILL_REFS_OUTPUT_DIR}/pr/${op}.md`), `pr/${op}.md on`).not.toBeNull();
      expect(await readIfPresent(fakeRoot, `${COMPLIANCE_OFF_SKILL_REFS_OUTPUT_DIR}/pr/${op}.md`), `pr/${op}.md off`).toBeNull();
    }
    expect(await readIfPresent(fakeRoot, `${SKILL_REFS_OUTPUT_DIR}/publication-gate.md`)).not.toBeNull();
    expect(await readIfPresent(fakeRoot, `${COMPLIANCE_OFF_SKILL_REFS_OUTPUT_DIR}/publication-gate.md`)).toBeNull();
  });

  it('splits the arms of a posting operation for the on file even though it has no compliance-off file', async () => {
    const { fakeRoot, status, combined } = await buildFixture();
    expect(status, combined).toBe(0);
    expect(await readIfPresent(fakeRoot, `${SKILL_REFS_OUTPUT_DIR}/pr/${POSTING_ARMED_OP}.md`))
      .toBe('Resolve the thread.\nReply on the thread.\n');
  });

  it('leaves no marker in either tree', async () => {
    const { fakeRoot, status, combined } = await buildFixture();
    expect(status, combined).toBe(0);

    for (const tree of [SKILL_REFS_OUTPUT_DIR, COMPLIANCE_OFF_SKILL_REFS_OUTPUT_DIR]) {
      const files = treeFiles(fakeRoot, tree);
      expect(files.length, `${tree} holds no file: the check is vacuous`).toBeGreaterThan(0);
      for (const rel of files) {
        const text = await readIfPresent(fakeRoot, `${tree}/${rel}`);
        expect(containsVariantMarker(text ?? ''), `${tree}/${rel} carries a marker`).toBe(false);
      }
    }
  });

  it('prints the compliance-on file count for a module, not the count with its copies', async () => {
    const { status, combined } = await buildFixture();
    expect(status, combined).toBe(0);
    expect(combined).toContain(`${PR_MODULE} → ${SKILL_REFS_OUTPUT_DIR}/ (${PR_HOST_OPS.length} file(s))`);
  });

  it('keeps the references it writes on a rebuild and removes a compliance-off file it no longer writes', async () => {
    const { fakeRoot, status, combined } = await buildFixture();
    expect(status, combined).toBe(0);
    const before = treeFiles(fakeRoot, COMPLIANCE_OFF_SKILL_REFS_OUTPUT_DIR);
    await write(fakeRoot, `${COMPLIANCE_OFF_SKILL_REFS_OUTPUT_DIR}/pr/post-review-summary.md`, 'stale posting reference\n');
    await write(fakeRoot, `${COMPLIANCE_OFF_SKILL_REFS_OUTPUT_DIR}/pr/retired-op.md`, 'stale retired reference\n');

    const second = runMdsBuild(fakeRoot);
    expect(second.status, second.combined).toBe(0);

    const pruned = second.combined.split('\n').filter(line => line.includes('pruned:')).join('\n');
    expect(pruned).toContain(`${COMPLIANCE_OFF_SKILL_REFS_OUTPUT_DIR}/pr/post-review-summary.md`);
    expect(pruned).toContain(`${COMPLIANCE_OFF_SKILL_REFS_OUTPUT_DIR}/pr/retired-op.md`);
    expect(treeFiles(fakeRoot, COMPLIANCE_OFF_SKILL_REFS_OUTPUT_DIR), 'a written reference was pruned').toEqual(before);
  });

  it('prunes nothing it wrote when it builds the same tree twice', async () => {
    const { fakeRoot, status, combined } = await buildFixture();
    expect(status, combined).toBe(0);
    const second = runMdsBuild(fakeRoot);
    expect(second.status, second.combined).toBe(0);
    expect(second.combined.split('\n').filter(line => line.includes('pruned:'))).toEqual([]);
  });

  it('refuses an arm that runs across two operations, names the operation it is in, and writes nothing', async () => {
    const { fakeRoot, status, combined } = await buildFixture({
      [ARMED_OP]: `Read the status.\n${CON}\nName the publication line.\n`,
    });
    expect(status, `expected exit 1.\n${combined}`).toBe(1);
    expect(combined).toContain(`${PR_MODULE}: compliance-variant split refused in the '${ARMED_OP}' section`);
    expect(combined).toContain('is never closed with compliance:end');
    expect(combined).toContain("An arm must open and close inside one '<!-- op: NAME -->' section");
    expect(await readIfPresent(fakeRoot, `${SKILL_REFS_OUTPUT_DIR}/pr/${ARMED_OP}.md`), 'nothing is written for a refused module').toBeNull();
    expect(
      treeFiles(fakeRoot, COMPLIANCE_OFF_SKILL_REFS_OUTPUT_DIR).filter(rel => rel.startsWith('pr/')),
      'no compliance-off file for a refused module',
    ).toEqual([]);
  });

  it('refuses a marker spelled inside a line, with the line of the section and a neighbour to find it by', async () => {
    const { status, combined } = await buildFixture({
      [ARMED_OP]: `Read the status.\nAn arm ${CON} written in the middle of a line.\n`,
    });
    expect(status, `expected exit 1.\n${combined}`).toBe(1);
    expect(combined).toContain(`compliance-variant split refused in the '${ARMED_OP}' section`);
    expect(combined).toContain('(below "Read the status.")');
    expect(combined).toContain('Line numbers count that section, not the source');
  });

  it('refuses a written reference whose compliance-off text would be empty, naming the operation', async () => {
    const { fakeRoot, status, combined } = await buildFixture({
      'validate-branch': `${CON}\nOnly in the compliance-on reference.\n${CEND}\n`,
    });
    expect(status, `expected exit 1.\n${combined}`).toBe(1);
    expect(combined).toContain(`${PR_MODULE}: the 'validate-branch' section is empty in the compliance-off reference`);
    expect(await readIfPresent(fakeRoot, `${SKILL_REFS_OUTPUT_DIR}/pr/validate-branch.md`)).toBeNull();
  });

  it('refuses a section whose compliance-on text would be empty', async () => {
    const { status, combined } = await buildFixture({
      'validate-branch': `${COFF}\nOnly in the compliance-off reference.\n${CEND}\n`,
    });
    expect(status, `expected exit 1.\n${combined}`).toBe(1);
    expect(combined).toContain(`${PR_MODULE}: the 'validate-branch' section is empty in the on reference`);
  });

  it('still refuses a curation marker in a reference module, in the same fixture', async () => {
    const { fakeRoot, status, combined } = await buildFixture({
      'validate-branch': `A line.\n<!-- curation:on -->\nA curation line.\n<!-- curation:end -->\n`,
    });
    expect(status, `expected exit 1.\n${combined}`).toBe(1);
    expect(combined).toContain(`${PR_MODULE}: a reference module may not carry curation-variant markers`);
    expect(await readIfPresent(fakeRoot, `${SKILL_REFS_OUTPUT_DIR}/pr/validate-branch.md`)).toBeNull();
  });
});
