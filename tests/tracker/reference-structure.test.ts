/**
 * Generated-reference structure guard — the structural half of PF-063.
 *
 * PF-063 recorded a defect the containment oracle cannot see: a block moved
 * BYTE-IDENTICALLY into a generated reference carried its source's grammar with
 * it. In `SKILL.md` a level-2 heading is just a section; in a generated reference
 * it is a section TERMINATOR, because `extractOpSectionFromCorpus` slices an
 * operation at the next column-0 `## ` line. Everything below the moved heading
 * became invisible to every union-mode guard while the bytes sat on disk,
 * diffable and containment-green. Byte equality answers whether these are the
 * same bytes and never whether they still mean the same thing.
 *
 * The pitfall's recorded remedy has two halves. The first is a convention:
 * demote a heading the grammar rather than the content forces down, `##` → `###`,
 * as it moves. The second is what makes the first hold — "make the rule
 * structural rather than advisory: forbid the reserved token at the destination
 * and ASSERT that prohibition, because a convention that lives only in a handoff
 * is one agent away from being re-broken." This file is that assertion.
 *
 * Demotion alone was never sufficient, because some `## ` lines MUST ship. A
 * heredoc that composes a GitHub issue body carries the issue's own Markdown:
 * `manage-debt.md`'s `## Items` is the literal body of the successor tech-debt
 * issue, and `ensure-traceable-issue.md` carries six such lines across its
 * `gh issue create` heredoc and its D3 template fence. Those cannot be demoted —
 * demoting them would change what GitHub renders. So the boundary rule itself had
 * to become fence-aware (`collectUnfencedH2` in tests/helpers.ts), and the
 * structural prohibition is stated over UNFENCED headings only.
 *
 * Three claims, kept separate so no one of them can carry the others (PF-064):
 *   1. SEMANTIC REACH — the real extractor, over the real generated tree, returns
 *      the text that used to be hidden below a fenced `## `. This is the probe
 *      PF-063 asks the byte-equality oracle to be paired with.
 *   2. STRUCTURE — no generated reference carries an unfenced column-0 `## ` after
 *      its own leading heading, so no future edit can re-truncate a section.
 *   3. NON-VACUITY — the live corpus actually contains fenced `## ` lines, so
 *      claim 2 is not satisfied by a corpus that never exercises the fence rule,
 *      and the collector is driven by a known-bad probe in both directions.
 */

import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import * as os from 'os';
import * as path from 'path';

import { compiledSkillRefsDir } from '../../src/core/assets.js';
import {
  PR_HOST_DESTINATION_ROOT,
  PR_HOST_OPS,
  TRACKER_GITHUB_OPS,
  generatedReferenceManifest,
} from '../../src/core/mds-variants.js';
import {
  ROOT,
  collectUnfencedH2,
  extractOpSectionFromCorpus,
  gitAgentSinkCorpus,
} from '../helpers.js';

// ---------------------------------------------------------------------------
// Corpus
// ---------------------------------------------------------------------------

interface GeneratedReference {
  /** Manifest-relative path, e.g. `tracker/github/manage-debt.md`. */
  relPath: string;
  content: string;
}

/**
 * Read every declared generated reference. Throws with a build hint rather than
 * returning an empty list: a structure scan over an absent tree reports zero
 * violations, which is the shape of a guard that is not a guard (PF-018). A build
 * artifact is a throw, never a `skipIf` — only an external binary the repo cannot
 * produce earns a capability gate.
 *
 * @param dir - Directory to resolve manifest paths against (default: the compiled
 *   references tree). Pass a temp dir to exercise the throw hermetically.
 */
function readGeneratedReferences(dir: string = compiledSkillRefsDir()): GeneratedReference[] {
  return generatedReferenceManifest().map(relPath => {
    const absPath = path.join(dir, relPath);
    try {
      return { relPath, content: readFileSync(absPath, 'utf-8') };
    } catch {
      throw new Error(
        `Generated reference ${relPath} is absent at ${absPath} — run \`npm run build\` first ` +
        '(this guard reads compiled reference files and cannot be skipped)',
      );
    }
  });
}

/** Per-op reference relPath for a tracker operation. */
function trackerOpRelPath(op: string): string {
  return `tracker/github/${op}.md`;
}

/** The emitted path of a PR-host operation's mechanics. */
function prHostOpRelPath(op: string): string {
  return `${PR_HOST_DESTINATION_ROOT}/${op}.md`;
}

/**
 * Every per-op reference the anchor rule ranges over, as `(op, relPath)` pairs.
 *
 * Tracker ops UNION PR-host ops, because the rule is about the FILE SHAPE every
 * union-mode extraction depends on, and a `pr/` file is extracted exactly the way
 * a `tracker/{provider}/` one is. Iterating only the tracker roster would leave
 * eight generated files whose line 1 nothing checks — and a displaced anchor there
 * silently truncates every D10, D11 and numeric-bound guard that now reads them
 * (PF-063).
 */
const PER_OP_REFERENCES: readonly { readonly op: string; readonly relPath: string }[] = [
  ...TRACKER_GITHUB_OPS.map(op => ({ op, relPath: trackerOpRelPath(op) })),
  ...PR_HOST_OPS.map(op => ({ op, relPath: prHostOpRelPath(op) })),
];

/**
 * How many column-0 `## ` lines the live generated tree must carry INSIDE a fence.
 *
 * A FLOOR (registered in tests/fixtures/numeric-floors.json): the structure arm
 * below asserts an absence, and an absence over a corpus that never exercises the
 * fence rule is satisfied for the wrong reason. Raising it only demands more real
 * evidence; lowering it re-admits a corpus in which fence-awareness is untested
 * outside the synthetic probes. Today: `manage-debt.md`'s `## Items` plus the six
 * heredoc/template headings in `ensure-traceable-issue.md`.
 */
const MIN_FENCED_H2 = 7;

/** Ratchet-manifest id of the floor on how many generated references must exist. */
const MANIFEST_SIZE_FLOOR_ID = 'generated-reference-manifest-size';

/** The fields of a `floors` entry this file reads. */
interface FloorEntry {
  id: string;
  floor: number;
}

/**
 * The registered floor on the SIZE of the generated-reference corpus.
 *
 * The corpus below is built by mapping `generatedReferenceManifest()`, so its size
 * has to be checked against an authority OUTSIDE that call: any assertion phrased in
 * terms of the manifest's own length is equally satisfied by 13 files and by none,
 * and the emptiness it claims to catch is precisely the case it cannot see (PF-018).
 *
 * That authority is the ratchet manifest, read here rather than re-spelled as a
 * literal. Only the site that `tests/fixtures/numeric-floors.json` names for this entry —
 * `tests/installer/reference-overlay.test.ts` — is ratchet-protected, because
 * tests/guards/numeric-floor-manifest.test.ts greps each entry's pattern in the
 * sourceFile it records and nowhere else. A number copied into this file would sit
 * outside that protection and could be walked down alone.
 */
function registeredManifestSizeFloor(): number {
  const manifestPath = path.join(ROOT, 'tests', 'fixtures', 'numeric-floors.json');
  const { floors } = JSON.parse(readFileSync(manifestPath, 'utf-8')) as { floors: FloorEntry[] };
  const entry = floors.find(f => f.id === MANIFEST_SIZE_FLOOR_ID);
  expect(
    entry,
    `"${MANIFEST_SIZE_FLOOR_ID}" is not registered in tests/fixtures/numeric-floors.json — the ` +
    'corpus-size assertion has no independent floor to read and would assert nothing (PF-018)',
  ).toBeDefined();
  expect(
    entry!.floor,
    `the registered floor (${entry!.floor}) must cover at least the ${TRACKER_GITHUB_OPS.length} ` +
    'per-op references, or clearing it says nothing about the corpus being whole',
  ).toBeGreaterThanOrEqual(TRACKER_GITHUB_OPS.length);
  return entry!.floor;
}

// ---------------------------------------------------------------------------
// Named collector — driven by the live guard AND by the known-bad probe
// ---------------------------------------------------------------------------

/**
 * Every unfenced column-0 `## ` line in a generated reference OTHER than the
 * file's own leading heading on line 1.
 *
 * Each such line terminates the file's operation section early for every guard
 * reading it through `extractOpSectionFromCorpus`, so each one is a violation.
 * Returns `{relPath}:{line}: {heading}` strings — the file and line a fix needs.
 *
 * Both this collector and the extractor's terminator search call
 * `collectUnfencedH2`, so a probe cannot stay green after the fence rule changes
 * (PF-018).
 */
export function collectStrayUnfencedH2(refs: readonly GeneratedReference[]): string[] {
  const violations: string[] = [];
  for (const ref of refs) {
    for (const heading of collectUnfencedH2(ref.content)) {
      if (heading.line === 1) continue;
      violations.push(`${ref.relPath}:${heading.line}: ${heading.text}`);
    }
  }
  return violations;
}

// ---------------------------------------------------------------------------
// 1. Semantic reach — the extractor returns what a fenced `## ` used to hide
// ---------------------------------------------------------------------------

describe('PF-063 semantic probe: a fenced `## ` no longer hides a reference tail', () => {
  it('manage-debt: the whole archive chain is inside the extracted section', () => {
    // `## Items` at manage-debt.md:64 is the successor issue's own body, written
    // inside the archive function's bash fence. Before the boundary rule became
    // fence-aware the section ended on the line above it, so lines 64-78 — the
    // scrub, the `gh issue create --body-file`, the `post_scrubbed` back-link and
    // the close — sat outside every union-mode guard's slice.
    const { content } = extractOpSectionFromCorpus(
      gitAgentSinkCorpus(), 'manage-debt', { mode: 'union' },
    );
    expect(
      content,
      'manage-debt: the archive chain below the fenced `## Items` line is outside the extracted ' +
      'section — every D11/D4 guard reading this op is examining an empty tail (PF-063)',
    ).toContain('gh issue close "$old_issue"');
    expect(
      content,
      'manage-debt: the successor-issue create step is outside the extracted section',
    ).toContain('--body-file "$DEVFLOW_BODY") \\');
  });

  it('ensure-traceable-issue: the create recipe and the D3 template are inside the extracted section', () => {
    // Six fenced `## ` lines (the heredoc issue body at :30/:33/:38 and the D3
    // template at :56/:59/:62). The first of them used to end the section on
    // line 29, hiding the `gh issue create … --body-file` recipe and the whole
    // `### Traceability Issue Template (D3)` block.
    const { content } = extractOpSectionFromCorpus(
      gitAgentSinkCorpus(), 'ensure-traceable-issue', { mode: 'union' },
    );
    expect(
      content,
      'ensure-traceable-issue: the `gh issue create` recipe below the fenced heredoc headings is ' +
      'outside the extracted section (PF-063)',
    ).toContain('--assignee "username"');
    expect(
      content,
      'ensure-traceable-issue: the D3 template block is outside the extracted section (PF-063)',
    ).toContain('### Traceability Issue Template (D3)');
  });
});

// ---------------------------------------------------------------------------
// 2. Structure — no generated reference can re-truncate its own section
// ---------------------------------------------------------------------------

describe('generated references carry no unfenced `## ` below their own heading (PF-063)', () => {
  const refs = readGeneratedReferences();

  it('the corpus clears the registered manifest-size floor and every file has content', () => {
    const floor = registeredManifestSizeFloor();
    expect(
      refs.length,
      `the generated-reference corpus holds ${refs.length} file(s), floor ${floor} ` +
      `(${MANIFEST_SIZE_FLOOR_ID} in tests/fixtures/numeric-floors.json). An emptied or narrowed ` +
      'manifest empties this scan, and the structure arm below then reports zero violations over ' +
      'nothing (PF-018).',
    ).toBeGreaterThanOrEqual(floor);
    expect(
      refs.map(r => r.relPath),
      'every tracker AND PR-host operation must contribute a per-op reference to the scan',
    ).toEqual(expect.arrayContaining(PER_OP_REFERENCES.map(r => r.relPath)));
    for (const ref of refs) {
      expect(ref.content.length, `${ref.relPath} is empty`).toBeGreaterThan(0);
    }
  });

  it('every per-op reference opens with its own `## Operation:` anchor on line 1', () => {
    // The anchor is the one unfenced `## ` a per-op reference is allowed, and it
    // must be the FIRST line: a preamble above it would put the anchor's own
    // heading into the "stray" class and make the arm below unfalsifiable.
    for (const { op, relPath } of PER_OP_REFERENCES) {
      const ref = refs.find(r => r.relPath === relPath);
      expect(ref, `${relPath} is missing from the manifest`).toBeDefined();
      const headings = collectUnfencedH2(ref!.content);
      expect(
        headings[0],
        `${ref!.relPath}: no unfenced heading at all — the op anchor is fenced or absent`,
      ).toBeDefined();
      expect(headings[0].line, `${ref!.relPath}: the op anchor is not on line 1`).toBe(1);
      expect(headings[0].text, `${ref!.relPath}: line 1 is not this op's anchor`)
        .toBe(`## Operation: ${op}`);
    }
  });

  it('no generated reference carries an unfenced `## ` after line 1', () => {
    expect(
      collectStrayUnfencedH2(refs),
      'A column-0 `## ` line outside a code fence terminates the operation section for every guard ' +
      'reading this file through extractOpSectionFromCorpus — everything below it becomes silently ' +
      'invisible while the bytes stay on disk and containment stays green (PF-063). Demote the ' +
      'heading to `###`; if it is issue/PR body text that must render as a level-2 heading on the ' +
      'tracker, put it inside a code fence where it belongs.',
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 3. Non-vacuity — the fence rule is exercised, and the collector has teeth
// ---------------------------------------------------------------------------

describe('reference-structure guard: non-vacuity (PF-018)', () => {
  const refs = readGeneratedReferences();

  it('the live corpus really does contain fenced `## ` lines', () => {
    // Without this, the arm above is satisfied by a corpus in which no `## ` line
    // appears anywhere — it would then be asserting nothing about the fence rule
    // it depends on. Count the column-0 `## ` lines the scanner ruled FENCED.
    let fenced = 0;
    const carriers: string[] = [];
    for (const ref of refs) {
      const unfenced = new Set(collectUnfencedH2(ref.content).map(h => h.line));
      const inFence = ref.content
        .split('\n')
        .map((line, i) => ({ line: i + 1, text: line }))
        .filter(l => l.text.startsWith('## ') && !unfenced.has(l.line));
      if (inFence.length > 0) carriers.push(ref.relPath);
      fenced += inFence.length;
    }
    expect(
      fenced,
      `only ${fenced} fenced \`## \` lines in the generated tree, floor ${MIN_FENCED_H2}. The fence ` +
      'arm of the boundary rule is then under-exercised by the live corpus and its correctness ' +
      'rests on the synthetic probes alone (PF-018)',
    ).toBeGreaterThanOrEqual(MIN_FENCED_H2);
    expect(carriers, 'the known fenced-heading carriers must both be in the scan').toEqual(
      expect.arrayContaining([
        'tracker/github/manage-debt.md',
        'tracker/github/ensure-traceable-issue.md',
      ]),
    );
  });

  it('known-bad probe: an unfenced mid-body `## ` is caught, and the same line fenced is not', () => {
    const body = (heading: string) =>
      `## Operation: probe-op\n\nprose\n\n${heading}\n\ntail\n`;

    const red = collectStrayUnfencedH2([
      { relPath: 'tracker/github/probe-op.md', content: body('## Items') },
    ]);
    expect(
      red,
      'the collector did not flag an unfenced mid-body `## ` — the structure arm is dead',
    ).toEqual(['tracker/github/probe-op.md:5: ## Items']);

    const green = collectStrayUnfencedH2([
      {
        relPath: 'tracker/github/probe-op.md',
        content: body('```bash\nprintf \'%s\\n\' "## Items"\n```'),
      },
    ]);
    expect(
      green,
      'the collector flagged a FENCED `## ` — a guard that also rejects the issue-body headings ' +
      'that must ship would force them out of the references that need them',
    ).toEqual([]);
  });

  it('the corpus read fails loud on an unbuilt tree, naming the file and the build step', () => {
    // The manifest is derived from the registry, so an entry with no file is an
    // unbuilt tree, never a skip condition. Driven against an EMPTY temp root so
    // the throw is exercised without touching the real dist (PF-055).
    const empty = mkdtempSync(path.join(os.tmpdir(), 'devflow-refs-'));
    try {
      expect(
        () => readGeneratedReferences(empty),
        'an absent generated tree must throw — a structure scan over nothing reports zero ' +
        'violations and reads as a pass (PF-018)',
      ).toThrow(/npm run build/);
      expect(() => readGeneratedReferences(empty)).toThrow(/tracker\/github\//);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});
