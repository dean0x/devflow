/**
 * Reader ↔ writer seam: every provider source the Git agent can resolve from must
 * be one some writer actually lifecycles.
 *
 * The Git agent's preamble resolves a provider from a small ordered list of
 * sources. The WRITER side of the feature — `applyTrackerSentinel`, and through it
 * the session-start directive that spawns the Tracker agent and the
 * `~/.devflow/tracker.md` it writes — is driven by ONE of them: the machine-wide
 * `features.tracker.provider` in the manifest. `github` needs no writer at all: the
 * sentinel is REMOVED for it, no conventions are inferred, and the preamble emits
 * no status line.
 *
 * So the invariant is a containment, not an equality:
 *
 *   { sources the reader can resolve a non-github provider from, without DEGRADED }
 *       ⊆ { what the writer lifecycles } ∪ { github }
 *
 * Break it and the failure is silent and permanent rather than loud: a repo-local
 * `.devflow/config.json` naming a provider the manifest does not know resolves on
 * the READ side, while no sentinel is written, no setup directive is emitted, no
 * `tracker.md` is ever created — and every op reports the same
 * `TRACEABILITY: DEGRADED (tracker not configured)` with no command that can clear
 * it. That is PF-023's shape: an invariant asserted at one end and enforced at
 * neither sink.
 *
 * The per-repo key stays usable because it NARROWS: `github`, or the manifest's own
 * provider. Anything else is refused at the read with the canonical
 * `tracker configuration mismatch` reason and the remedy on the same line, so the
 * user is told which command re-opens the path instead of being left in a state
 * with no exit. That narrowing clause is what keeps the containment true, which is
 * why this file asserts the clause is stated and not merely that the rung list is
 * short.
 *
 * Both sides are read from the shipped files — the agent host (a generated artifact
 * tsc never sees, PF-024) and `src/`. Every collector is driven by a known-bad
 * sample in the same `it`, so no arm can pass because an extractor silently stopped
 * returning anything (PF-018).
 *
 * The sibling seam `tests/seams/tracker-key-path.test.ts` asserts that the two
 * READERS of each key classify the same bytes the same way. This one asserts that a
 * source with a reader has a writer at all.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import * as path from 'path';

import { DEFAULT_TRACKER_PROVIDER } from '../../src/core/tracker.js';
import { ROOT, walkFiles } from '../helpers.js';

const GIT_AGENT_HOST = path.join(ROOT, 'src', 'assets', 'agents', 'git.mds');
const SRC_DIR = path.join(ROOT, 'src');

/** The canonical §14.2 reason an inadmissible per-repo key resolves to. */
// The per-repo rung's OWN reason, split by cause. The unsplit spelling is a prefix
// of both halves, so pinning it would have been satisfied by the conventions-file
// half too — a rung asserted to carry a reason that names the other file.
const MISMATCH_REASON = 'tracker configuration mismatch (repository override)';
/** The command that re-opens the path the mismatch closes. */
const REMEDY = 'devflow tracker --set';

/** The one function that owns the presence sentinel [DR-10]. */
const SENTINEL_FN = 'applyTrackerSentinel';
/** The parser every reader of the per-repo key must route through. */
const PER_REPO_PARSER = 'parseTrackerOverride';

// ---------------------------------------------------------------------------
// Named collectors — the reader
// ---------------------------------------------------------------------------

/** A provider source the preamble's resolution order names, in its stated order. */
export interface ResolutionRung {
  readonly position: number;
  /** What the rung reads: the per-repo config file, the manifest, or the default. */
  readonly source: 'per-repo-config' | 'manifest' | 'default-github' | 'unclassified';
  readonly text: string;
}

/**
 * Named collector: the rungs of the preamble's resolution order.
 *
 * The bullet spells them `(1) … ; (2) … ; (3) …` on ONE line, so the line is found
 * by its own label and split on the numbered markers rather than on punctuation
 * that also appears inside a rung. A rung that names none of the three known
 * artifacts is returned as `unclassified` rather than dropped: a source this seam
 * does not recognise is exactly what it exists to report, and a collector that
 * silently ignored it would make the containment arm below vacuous for every NEW
 * source — which is the shape of the defect that motivated this file.
 *
 * Returns `[]` when the bullet is absent, so a renamed or deleted resolution order
 * is reported as unstated instead of read as agreement.
 */
export function collectResolutionRungs(source: string): ResolutionRung[] {
  const line = source
    .split('\n')
    .find(l => l.includes('Resolution order') && l.includes('.devflow/config.json'));
  if (line === undefined) return [];
  const markers = [...line.matchAll(/\((\d+)\)/g)];
  return markers.map((marker, index) => {
    const start = marker.index + marker[0].length;
    const end = index + 1 < markers.length ? markers[index + 1].index : line.length;
    const text = line.slice(start, end).trim();
    const source_ =
      text.includes('.devflow/config.json') ? 'per-repo-config'
        : text.includes('features.tracker.provider') ? 'manifest'
          : new RegExp(`^\`?${DEFAULT_TRACKER_PROVIDER}\`?\\.?$`).test(text) ? 'default-github'
            : 'unclassified';
    return { position: Number(marker[1]), source: source_, text };
  });
}

/**
 * Named collector: the parts of the NARROWING clause the per-repo rung must carry.
 *
 * Returns the names of the parts that are MISSING, so an empty array is the healthy
 * answer and the failure message names what is absent rather than printing the
 * whole bullet. The five parts are what make the rung admissible: it must say it
 * narrows, name both values it admits, refuse everything else with the canonical
 * reason, and put the remedy where the refusal is read.
 */
export function collectMissingNarrowingParts(rungText: string): string[] {
  const parts: [string, boolean][] = [
    ['the narrowing statement', /narrow/i.test(rungText)],
    [`the admitted default (\`${DEFAULT_TRACKER_PROVIDER}\`)`, rungText.includes(DEFAULT_TRACKER_PROVIDER)],
    ['the admitted manifest provider', /manifest/i.test(rungText)],
    [`the canonical reason (${MISMATCH_REASON})`, rungText.includes(MISMATCH_REASON)],
    [`the remedy (${REMEDY})`, rungText.includes(REMEDY)],
  ];
  return parts.filter(([, present]) => !present).map(([name]) => name);
}

/**
 * Named collector: the rungs that can introduce a provider no writer lifecycles.
 *
 * A rung is admissible on exactly three grounds, and the third is the whole reason
 * the per-repo key survives Phase 3:
 *
 *   - it resolves the default, which needs no writer (the sentinel is REMOVED for
 *     `github`, nothing is inferred, and the preamble emits no status line);
 *   - its source is one the writer lifecycles;
 *   - it is the per-repo key AND it narrows — its admitted values are then a subset
 *     of {`github`, the manifest's provider}, so it introduces no provider of its
 *     own and needs no lifecycle of its own.
 *
 * Everything else is returned. Narrowing is read from the rung's own text through
 * `collectMissingNarrowingParts`, so a rung that loses the clause stops being
 * admissible here rather than staying admissible on the strength of its name.
 */
export function collectInadmissibleRungs(
  rungs: readonly ResolutionRung[],
  lifecycled: readonly string[],
): string[] {
  return rungs
    .filter(rung => {
      if (rung.source === 'default-github') return false;
      if (lifecycled.includes(rung.source)) return false;
      if (rung.source === 'per-repo-config') return collectMissingNarrowingParts(rung.text).length > 0;
      return true;
    })
    .map(rung => `(${rung.position}) ${rung.source}: ${rung.text}`);
}

// ---------------------------------------------------------------------------
// Named collectors — the writer
// ---------------------------------------------------------------------------

/** Every `.ts` file under `src/`, read once. */
function srcFiles(): { path: string; content: string }[] {
  return walkFiles(SRC_DIR, f => f.endsWith('.ts')).map(file => ({
    path: path.relative(ROOT, file),
    content: readFileSync(file, 'utf-8'),
  }));
}

/**
 * Named collector: the provider sources the sentinel lifecycle can observe.
 *
 * The sentinel is the writer side's entry point — it is what the session-start gate
 * stats before it forks anything, so a provider it never sees is a provider whose
 * conventions are never inferred. `manifest` is in the set by construction: the
 * sentinel's owners are `devflow init` and `devflow tracker --set`, both of which
 * resolve the provider from the manifest, and the sibling seam pins that key path
 * against the hook that reads it.
 *
 * `per-repo-config` joins the set only if some module both READS the per-repo key —
 * through `parseTrackerOverride`, the one parser the field's doc comment allows —
 * and DRIVES the sentinel. That is the code change this seam is waiting for: widen
 * the writer and the containment admits the rung, with no edit here.
 *
 * Returns a sorted array so the containment arm's message is stable.
 */
export function collectWriterLifecycledSources(
  files: readonly { path: string; content: string }[],
): string[] {
  const sources = new Set<string>(['manifest']);
  for (const file of files) {
    if (file.content.includes(SENTINEL_FN) && file.content.includes(PER_REPO_PARSER)) {
      sources.add('per-repo-config');
    }
  }
  return [...sources].sort();
}

/**
 * Named collector: the files that call the sentinel owner at all.
 *
 * Non-vacuity for the collector above: if `applyTrackerSentinel` were renamed, the
 * membership test would answer "no per-repo lifecycle" for a tree in which the
 * whole writer had moved. This reports the call sites so that answer is backed by a
 * function that exists.
 */
export function collectSentinelSites(
  files: readonly { path: string; content: string }[],
): string[] {
  return files
    .filter(file => new RegExp(`\\b${SENTINEL_FN}\\b`).test(file.content))
    .map(file => file.path)
    .sort();
}

// ---------------------------------------------------------------------------
// The seam
// ---------------------------------------------------------------------------

describe('tracker provider sources: the reader admits no source the writer never lifecycles', () => {
  const gitHost = readFileSync(GIT_AGENT_HOST, 'utf-8');
  const files = srcFiles();

  it('the preamble states its resolution order (collector is live)', () => {
    const rungs = collectResolutionRungs(gitHost);
    expect(
      rungs,
      'no resolution-order bullet naming `.devflow/config.json` was found in the Git agent host — ' +
        'the reader half of this seam is missing or was renamed, and every arm below would be vacuous',
    ).not.toHaveLength(0);
    expect(
      rungs.map(rung => rung.position),
      'the rungs must be numbered contiguously from 1 — a gap means the collector read a ' +
        'parenthesised number that is not a rung',
    ).toEqual(rungs.map((_, index) => index + 1));

    // Known-bad, same it: a seeded extra source is classified, not dropped; a
    // source line without the order label is not a resolution order.
    const seeded = collectResolutionRungs(
      '- **Resolution order, first hit wins:** (1) the `tracker` key in `.devflow/config.json`; ' +
        '(2) **repo ref-grammar corroboration**; (3) `features.tracker.provider`; (4) `github`.',
    );
    expect(seeded.map(rung => rung.source)).toEqual([
      'per-repo-config', 'unclassified', 'manifest', 'default-github',
    ]);
    expect(collectResolutionRungs('- the `.devflow/config.json` value is read here\n')).toEqual([]);
  });

  it('every rung reads a source this seam can classify', () => {
    const unclassified = collectResolutionRungs(gitHost).filter(rung => rung.source === 'unclassified');
    expect(
      unclassified.map(rung => `(${rung.position}) ${rung.text}`),
      'the preamble resolves from a source this seam does not know about. A new source needs a ' +
        'writer that lifecycles it — a sentinel written for it, and therefore conventions inferred ' +
        'for it — or the provider it resolves can never be configured and every op degrades forever',
    ).toEqual([]);
  });

  it('the writer lifecycles the manifest, and the sentinel it drives exists', () => {
    const sites = collectSentinelSites(files);
    expect(
      sites,
      `no file under src/ names ${SENTINEL_FN} — the sentinel owner was renamed, and the ` +
        'lifecycle collector below would report "manifest only" for a tree whose writer had moved',
    ).not.toHaveLength(0);
    expect(collectWriterLifecycledSources(files)).toContain('manifest');

    // Known-bad, same it: a module that both reads the per-repo key and drives the
    // sentinel widens the lifecycled set, and that is the change this seam waits for.
    expect(
      collectWriterLifecycledSources([
        { path: 'seed.ts', content: `${PER_REPO_PARSER}(cfg.tracker); await ${SENTINEL_FN}(dir, p);` },
      ]),
    ).toEqual(['manifest', 'per-repo-config']);
    expect(
      collectWriterLifecycledSources([{ path: 'seed.ts', content: `${PER_REPO_PARSER}(cfg.tracker);` }]),
      'reading the key without driving the sentinel is the current state, not a lifecycle',
    ).toEqual(['manifest']);
    expect(collectSentinelSites([{ path: 'seed.ts', content: 'nothing here' }])).toEqual([]);
  });

  it('every non-github rung the reader resolves from is one the writer lifecycles', () => {
    const lifecycled = collectWriterLifecycledSources(files);
    const rungs = collectResolutionRungs(gitHost);

    const inadmissible = collectInadmissibleRungs(rungs, lifecycled);
    expect(
      inadmissible,
      `the reader resolves a provider from source(s) the writer never lifecycles ` +
        `[writer: ${lifecycled.join(', ')}]. A provider resolved from one of these gets no ` +
        `sentinel, so no setup directive is emitted, no conventions file is ever written, and ` +
        `every tracker op reports DEGRADED permanently:\n  ${inadmissible.join('\n  ')}`,
    ).toEqual([]);

    // Known-bad, same it: a re-added corroboration rung is reported, an unnarrowed
    // per-repo rung is reported, and a narrowed one is not — the three verdicts the
    // filter exists to tell apart.
    const seeded = collectResolutionRungs(
      '- **Resolution order, first hit wins:** (1) the `tracker` key in `.devflow/config.json` — ' +
        'authoritative when present; (2) **repo ref-grammar corroboration**; ' +
        '(3) `features.tracker.provider`; (4) `github`.',
    );
    expect(collectInadmissibleRungs(seeded, lifecycled).map(entry => entry.slice(0, 22))).toEqual([
      '(1) per-repo-config: t',
      '(2) unclassified: **re',
    ]);
    expect(
      collectInadmissibleRungs(rungs, [...lifecycled, 'per-repo-config']),
      'a writer that DID lifecycle the per-repo key would admit the rung on its own terms',
    ).toEqual([]);
  });

  it('the per-repo rung is admissible because it NARROWS, and says so where it is read', () => {
    // The containment arm above passes for the per-repo rung only while the rung
    // cannot introduce a provider of its own. That is a property of the PROSE, so it
    // is asserted against the prose: drop the narrowing clause and the rung silently
    // becomes a fourth provider source with no writer.
    const [rung] = collectResolutionRungs(gitHost).filter(r => r.source === 'per-repo-config');
    expect(rung, 'the per-repo rung is gone — the sibling key-path seam covers the same bullet')
      .toBeDefined();
    expect(
      collectMissingNarrowingParts(rung!.text),
      `the per-repo rung is missing part(s) of its narrowing clause. Without them a repo-local ` +
        `key names any provider it likes, the machine has no sentinel for it, and the user is ` +
        `left in a permanent DEGRADED with no command named at the point of refusal`,
    ).toEqual([]);

    // Known-bad, same it: the pre-narrowing spelling is reported part by part, and a
    // clause that states the rule but hides the remedy is reported too.
    expect(
      collectMissingNarrowingParts('the `tracker` key in `.devflow/config.json` — authoritative when present;'),
    ).toEqual([
      'the narrowing statement',
      `the admitted default (\`${DEFAULT_TRACKER_PROVIDER}\`)`,
      'the admitted manifest provider',
      `the canonical reason (${MISMATCH_REASON})`,
      `the remedy (${REMEDY})`,
    ]);
    expect(
      collectMissingNarrowingParts(
        'the key NARROWS only — `github` or the manifest\'s own provider, else ' +
          `\`TRACEABILITY: DEGRADED (${MISMATCH_REASON})\`;`,
      ),
    ).toEqual([`the remedy (${REMEDY})`]);

    // …and the OTHER half of the split reason does not satisfy this rung. Both
    // halves share a prefix, so a rung that named the conventions-file cause would
    // have passed an `includes` on the unsplit spelling while pointing the reader
    // at a file the rung has nothing to do with.
    expect(
      collectMissingNarrowingParts(
        'the key NARROWS only — `github` or the manifest\'s own provider, else ' +
          '`TRACEABILITY: DEGRADED (tracker configuration mismatch (conventions file))`, ' +
          'remedy `devflow tracker --set {id}`;',
      ),
      'the conventions-file cause must NOT satisfy the per-repo rung\'s reason requirement',
    ).toEqual([`the canonical reason (${MISMATCH_REASON})`]);
  });
});
