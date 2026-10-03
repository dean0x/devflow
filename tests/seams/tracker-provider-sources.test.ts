/**
 * Reader ↔ writer seam: every provider source the Git agent can resolve from must
 * be one some writer actually lifecycles.
 *
 * The READER is the Git agent's preamble. It resolves the provider from ONE
 * source: the closed-vocabulary line `resolve-settings.cjs` prints, which folds
 * the team's committed `.devflow/project.json`, the personal `.devflow/config.json`
 * and the machine manifest (D-SETTINGS-LINE). The WRITER is session-start
 * Section 3, which spawns the Tracker agent that writes the provider's
 * conventions file. It reads the machine provider from the `.tracker.enabled`
 * sentinel and — only when the project's own file names a tracker — asks the SAME
 * script (D-TRACKER-PER-PROVIDER-CONVENTIONS). `github` needs no writer at all: no
 * conventions are inferred for it and the preamble emits no status line.
 *
 * So the invariant is a containment, not an equality:
 *
 *   { sources the reader can resolve a non-github provider from }
 *       ⊆ { what the writer lifecycles } ∪ { github }
 *
 * Break it and the failure is silent and permanent rather than loud: a provider
 * the reader resolves while the writer never sees it gets no Tracker run, no
 * conventions file is ever written, and every op reports the same
 * `TRACEABILITY: DEGRADED (tracker not configured)` with no command that can clear
 * it — an invariant asserted at one end and enforced at neither.
 *
 * The personal override stays usable because the SCRIPT narrows it — to `github`
 * or the provider already resolved — and flags anything else `TRACKER_WARN=mismatch`,
 * which the prompt refuses with the canonical reason and a remedy on the same
 * line. The narrowing itself is tests/evidence-policy/settings-mode.test.ts's to
 * prove against the script; this file asserts the prompt still says what the
 * refusal is, because that is where the user is told how to leave the state.
 *
 * Both sides are read from the shipped files — the agent host (a generated
 * artifact tsc never sees) and the hook. Every collector is driven by a
 * known-bad sample in the same `it`, so no arm can pass because an extractor
 * silently stopped returning anything.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import * as path from 'path';

import { scriptsDir } from '../../src/core/assets.js';
import { ROOT } from '../helpers.js';

const GIT_AGENT_HOST = path.join(ROOT, 'src', 'assets', 'agents', 'git.mds');
const CONTEXT_HOOK = path.join(scriptsDir(), 'hooks', 'session-start-context');

/** The canonical §14.2 reason a refused personal override resolves to. */
// The personal override's OWN reason, split by cause. The unsplit spelling is a
// prefix of both halves, so pinning it would have been satisfied by the
// conventions-file half too — a refusal asserted to carry a reason that names the
// other file.
const MISMATCH_REASON = 'tracker configuration mismatch (repository override)';
/**
 * The edit that re-opens the path the mismatch closes. The refused value is the
 * personal override itself, so the remedy names that key and that file: `devflow
 * tracker --set` moves only the machine default, which a repository's project.json
 * selection outranks, so naming it sent a user to a command that changed nothing.
 */
const REMEDY = 'the personal `config.json` `tracker` key';
/** The superseded remedy — the machine-default command. */
const RETIRED_REMEDY = 'devflow tracker --set';

/** The one resolver both sides must consult. */
const SETTINGS_SCRIPT = 'resolve-settings.cjs';

/**
 * Every artifact a prompt or hook could resolve a provider from, by the literal
 * that names it. A source is recognised by NAME so a new one is classified
 * rather than missed: the containment arm is only as strong as this list.
 */
const PROVIDER_SOURCES: ReadonlyArray<readonly [string, RegExp]> = [
  ['settings-line', /resolve-settings\.cjs/],
  ['sentinel', /\.tracker\.enabled/],
  ['project-file', /\.devflow\/project\.json|\$PROJECT_DEVFLOW_DIR\/project\.json/],
  ['personal-file', /\.devflow\/config\.json/],
  ['manifest', /manifest\.json|features\.tracker\.provider/],
];

/** Classify a line of text by the provider sources it names. */
function sourcesNamedIn(text: string): string[] {
  return PROVIDER_SOURCES.filter(([, pattern]) => pattern.test(text)).map(([name]) => name);
}

// ---------------------------------------------------------------------------
// Named collectors — the reader
// ---------------------------------------------------------------------------

/** The Git agent's provider-resolution preamble, from its heading to the next `## `. */
export function resolutionPreamble(source: string): string {
  const at = source.indexOf('## Tracker provider resolution');
  if (at === -1) return '';
  const rest = source.slice(at + 1);
  const next = rest.search(/^## /m);
  return next === -1 ? source.slice(at) : source.slice(at, at + 1 + next);
}

/**
 * Named collector: the provider sources the preamble resolves from.
 *
 * Returns the sorted, de-duplicated set of source names over the preamble's lines.
 * An empty preamble returns `[]`, which the liveness arm reports as unstated
 * rather than reading it as agreement.
 */
export function collectReaderSources(preamble: string): string[] {
  return [...new Set(preamble.split('\n').flatMap(sourcesNamedIn))].sort();
}

/**
 * Named collector: the parts of the mismatch refusal the prompt must state.
 *
 * Returns the names of the parts that are MISSING, so an empty array is the
 * healthy answer. The refusal is what keeps a narrowing override from being a
 * silent dead end: it must name the warning it answers, say the override narrows,
 * name the default it admits, refuse with the canonical reason, and put the
 * remedy where the refusal is read.
 */
export function collectMissingRefusalParts(preamble: string): string[] {
  const line = preamble.split('\n').find(l => l.includes('TRACKER_WARN=mismatch')) ?? '';
  const parts: [string, boolean][] = [
    ['the warning it answers (TRACKER_WARN=mismatch)', line !== ''],
    ['the narrowing statement', /narrow/i.test(line)],
    ['the admitted default (`github`)', line.includes('`github`')],
    [`the canonical reason (${MISMATCH_REASON})`, line.includes(`DEGRADED (${MISMATCH_REASON})`)],
    [`the remedy (${REMEDY})`, line.includes(REMEDY) && !line.includes(RETIRED_REMEDY)],
  ];
  return parts.filter(([, present]) => !present).map(([name]) => name);
}

// ---------------------------------------------------------------------------
// Named collectors — the writer
// ---------------------------------------------------------------------------

/** Section 3 of the hook, from its banner to the output block. */
export function section3(source: string): string {
  const at = source.indexOf('# --- Section 3:');
  const end = source.indexOf('# --- Output ---');
  return at === -1 || end === -1 ? '' : source.slice(at, end);
}

/**
 * Named collector: the provider sources the writer consults, from its LIVE lines.
 *
 * Comment lines are skipped — documentation that names a source is not a reader —
 * so a source the hook only mentions cannot widen the lifecycled set.
 */
export function collectWriterSources(section: string): string[] {
  const live = section.split('\n').filter(l => !l.trimStart().startsWith('#'));
  return [...new Set(live.flatMap(sourcesNamedIn))].sort();
}

/**
 * Named collector: the reader sources the writer does not lifecycle.
 *
 * A reader source is admissible when the writer consults it too. The settings
 * line needs no further argument: the writer runs the same script, so whatever it
 * folds, both sides fold identically. Everything else the reader names is
 * returned.
 */
export function collectUnlifecycledSources(reader: readonly string[], writer: readonly string[]): string[] {
  return reader.filter(source => !writer.includes(source));
}

// ---------------------------------------------------------------------------
// The seam
// ---------------------------------------------------------------------------

describe('tracker provider sources: the reader admits no source the writer never lifecycles', () => {
  const preamble = resolutionPreamble(readFileSync(GIT_AGENT_HOST, 'utf-8'));
  const writer = collectWriterSources(section3(readFileSync(CONTEXT_HOOK, 'utf-8')));

  it('the preamble resolves from the settings line alone (collector is live)', () => {
    expect(preamble, 'the Git agent host has no provider-resolution preamble').not.toBe('');
    expect(
      collectReaderSources(preamble),
      'the preamble must resolve the provider from resolve-settings.cjs and name no config file ' +
        'as a source of its own — a second source is a second, unvalidated parser',
    ).toEqual(['settings-line']);

    // Known-bad, same it: the pre-#393 two-rung order is classified source by
    // source, and text without a preamble heading is no preamble.
    const seeded = collectReaderSources(
      '## Tracker provider resolution\n- (1) the `tracker` key in `.devflow/config.json`; ' +
        '(2) `~/.devflow/manifest.json` key `features.tracker.provider`; (3) `github`.\n',
    );
    expect(seeded).toEqual(['manifest', 'personal-file']);
    expect(resolutionPreamble('no heading here')).toBe('');
  });

  it('the writer consults the sentinel and the same settings script', () => {
    expect(
      writer,
      'Section 3 could not be located, or it no longer reads the sentinel and the settings script — ' +
        'the containment arm below would compare against nothing',
    ).toEqual(expect.arrayContaining(['sentinel', 'settings-line']));

    // Known-bad, same it: a comment naming the script is not a reader.
    expect(collectWriterSources('# resolve-settings.cjs is the resolver\n  : noop\n')).toEqual([]);
    expect(collectWriterSources('  L=$(node "$D/resolve-settings.cjs" "$R")\n')).toEqual(['settings-line']);
  });

  it('every source the reader resolves from is one the writer lifecycles', () => {
    const unlifecycled = collectUnlifecycledSources(collectReaderSources(preamble), writer);
    expect(
      unlifecycled,
      `the reader resolves a provider from source(s) the writer never consults ` +
        `[writer: ${writer.join(', ')}]. A provider resolved from one of these gets no Tracker ` +
        `run, no conventions file is ever written, and every tracker op reports DEGRADED ` +
        `permanently:\n  ${unlifecycled.join('\n  ')}`,
    ).toEqual([]);

    // Known-bad, same it: a reader that went back to the personal file directly is
    // reported, because no writer lifecycles that file on its own.
    expect(collectUnlifecycledSources(['personal-file', 'settings-line'], writer)).toEqual(['personal-file']);
  });

  it('a refused personal override is reported where it is read, with its remedy', () => {
    expect(
      collectMissingRefusalParts(preamble),
      'the preamble is missing part(s) of the mismatch refusal. Without them a personal override ' +
        'the script refused leaves the user in a DEGRADED state with no command named at the ' +
        'point of refusal',
    ).toEqual([]);

    // Known-bad, same it: a bare mapping is reported part by part, and the OTHER
    // half of the split reason does not satisfy the refusal.
    expect(
      collectMissingRefusalParts('- `TRACKER_WARN=mismatch` ⇒ `TRACEABILITY: DEGRADED (unknown tracker provider)`'),
    ).toEqual([
      'the narrowing statement',
      'the admitted default (`github`)',
      `the canonical reason (${MISMATCH_REASON})`,
      `the remedy (${REMEDY})`,
    ]);
    expect(
      collectMissingRefusalParts(
        '- `TRACKER_WARN=mismatch` ⇒ `TRACEABILITY: DEGRADED (tracker configuration mismatch ' +
          '(conventions file))`: the override NARROWS only, to `github`; remedy: correct or drop the personal `config.json` `tracker` key.',
      ),
      'the conventions-file cause must NOT satisfy the refusal\'s reason requirement',
    ).toEqual([`the canonical reason (${MISMATCH_REASON})`]);
    expect(
      collectMissingRefusalParts(
        `- \`TRACKER_WARN=mismatch\` ⇒ \`TRACEABILITY: DEGRADED (${MISMATCH_REASON})\`: the override NARROWS only, ` +
          'to `github`; remedy `devflow tracker --set {id}` or drop the override.',
      ),
      'the machine-default command is not the remedy for a refused personal override',
    ).toEqual([`the remedy (${REMEDY})`]);
    expect(collectMissingRefusalParts('')).toHaveLength(5);
  });
});
