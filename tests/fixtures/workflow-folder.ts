/**
 * tests/fixtures/workflow-folder.ts
 *
 * THE five-host fixture of a workflow skill folder: one core host and four reference
 * hosts, as sources for a throwaway DEVFLOW_MDS_ROOT and as the registry that names
 * them. The build layer ships with an EMPTY real registry (WORKFLOW_FOLDERS), so every
 * test of the layer builds this fixture instead of a shipped folder.
 *
 *   SKILL.mds                    core: real frontmatter, a curation arm and a compliance arm
 *   base-note.mds                reference in the folder root: carries the build id
 *   ci-fix.mds                   reference in the folder root, with a compliance arm
 *   references/levels.mds        reference under references/: outside the build id
 *   references/evidence-asks.mds reference under references/, omitted from the
 *                                compliance-off folders
 *
 * Every host imports the one partial by the ALIAS form, the only import form the build's
 * compile-time guard allows; tests/build-mds-compile-time.test.ts compiles these hosts
 * against its budget.
 *
 * Rows are data. Consumers: tests/build-mds-workflow-folder.test.ts,
 * tests/build-mds-compile-time.test.ts.
 */

import { promises as fs } from 'fs';
import * as path from 'path';

import type { WorkflowFolder } from '../../src/core/mds-variants.js';

/** The fixture folder's directory in the fake root, repo-relative. */
export const FIXTURE_DIR = 'src/assets/commands/flow';

export const FIXTURE_FOLDER: WorkflowFolder = {
  name: 'flow',
  core: `${FIXTURE_DIR}/SKILL.mds`,
  references: [
    { source: `${FIXTURE_DIR}/base-note.mds`, file: 'base-note.md' },
    { source: `${FIXTURE_DIR}/ci-fix.mds`, file: 'ci-fix.md' },
    { source: `${FIXTURE_DIR}/references/levels.mds`, file: 'references/levels.md' },
    {
      source: `${FIXTURE_DIR}/references/evidence-asks.mds`,
      file: 'references/evidence-asks.md',
      omittedWhenComplianceOff: true,
    },
  ],
};

/** The steering block of a reference host: the build reads output-dir from it and sheds the whole block. */
const STEERING_BLOCK = '---\noutput-dir: dist/workflows\n---\n';

/** The partial every fixture host imports. It has no output-dir, so the build skips it as a partial. */
const PARTIAL = [
  '@define shared_line():',
  'Shared line from the partial.',
  '@end',
  '',
  '@export shared_line',
  '',
].join('\n');

const CORE = [
  '---',
  'name: devflow:flow',
  'description: Fixture workflow skill for the build layer tests',
  'output-dir: dist/workflows',
  '---',
  '@import "./_shared.mds" as shared',
  '# Flow',
  '',
  '{{shared.shared_line()}}',
  '',
  '<!-- curation:on -->',
  'Curation step: write the learned entry.',
  '<!-- curation:off -->',
  'Curation step: skip the entry.',
  '<!-- curation:end -->',
  '',
  '<!-- compliance:on -->',
  'Compliance step: read references/evidence-asks.md.',
  '<!-- compliance:off -->',
  'Compliance step: inline the evidence asks here.',
  '<!-- compliance:end -->',
  '',
  '## Step 1',
  '',
  'Read base-note.md on this branch.',
  '',
].join('\n');

const BASE_NOTE = `${STEERING_BLOCK}@import "./_shared.mds" as shared\n# Base note\n\n{{shared.shared_line()}}\n\nThe base note text.\n`;

const CI_FIX = [
  STEERING_BLOCK.trimEnd(),
  '@import "./_shared.mds" as shared',
  '# CI fix',
  '',
  '{{shared.shared_line()}}',
  '',
  '<!-- compliance:on -->',
  'Post the CI result as a comment.',
  '<!-- compliance:off -->',
  'Keep the CI result in the local file.',
  '<!-- compliance:end -->',
  '',
].join('\n');

const LEVELS = `${STEERING_BLOCK}@import "../_shared.mds" as shared\n# Levels\n\n{{shared.shared_line()}}\n\nFull, standard, lean.\n`;

const EVIDENCE_ASKS = `${STEERING_BLOCK}@import "../_shared.mds" as shared\n# Evidence asks\n\n{{shared.shared_line()}}\n\nAsk for the ticket link.\n`;

/**
 * The project-root marker of the fixture folder. The hosts under references/ import the
 * partial across one directory (`../_shared.mds`), and the resolver refuses an import that
 * leaves the project root, which without a marker is the importing host's own directory.
 */
const ROOT_MARKER = 'MDS project-root marker: the hosts under references/ import ../_shared.mds.\n';

/** Every source of the fixture, keyed by its repo-relative path. */
export const FIXTURE_SOURCES: Readonly<Record<string, string>> = {
  [`${FIXTURE_DIR}/.mdsroot`]: ROOT_MARKER,
  [`${FIXTURE_DIR}/_shared.mds`]: PARTIAL,
  [`${FIXTURE_DIR}/SKILL.mds`]: CORE,
  [`${FIXTURE_DIR}/base-note.mds`]: BASE_NOTE,
  [`${FIXTURE_DIR}/ci-fix.mds`]: CI_FIX,
  [`${FIXTURE_DIR}/references/levels.mds`]: LEVELS,
  [`${FIXTURE_DIR}/references/evidence-asks.mds`]: EVIDENCE_ASKS,
};

/** The five hosts, repo-relative: the registry's own list, never retyped. */
export const FIXTURE_HOST_SOURCES: readonly string[] = [
  FIXTURE_FOLDER.core,
  ...FIXTURE_FOLDER.references.map(ref => ref.source),
];

/**
 * Write the fixture into a root, with the given sources replacing or adding to it.
 *
 * @param overrides - Source text by repo-relative path; a `null` value leaves that file out.
 */
export async function writeFixtureSources(
  root: string,
  overrides: Readonly<Record<string, string | null>> = {},
): Promise<void> {
  const sources: Record<string, string | null> = { ...FIXTURE_SOURCES, ...overrides };
  for (const [rel, text] of Object.entries(sources)) {
    if (text === null) continue;
    const file = path.join(root, ...rel.split('/'));
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, text, 'utf-8');
  }
}
