/**
 * guard-census — the guard surface did not shrink (AC-2.6, GAP-49).
 *
 * Two claims, both about the SHAPE of the Phase-2 refactor rather than its content:
 *
 *   1. `tests/git-agent.test.ts` still carries at least as many RUNNING guards as it
 *      did. GAP-49: a pinned literal ("all 40 git-agent guards") is invalidated by the
 *      first phase that adds one. A count that may only RISE is the version of that
 *      claim that survives the next phase, so the number lives in
 *      `tests/fixtures/numeric-floors.json` — the one place in this repo where a
 *      number may be raised and may never be lowered.
 *
 *      A count alone cannot carry that claim. A count that accepts `it(` and
 *      `it.<modifier>(` alike reads `it.skip(` and `it.todo(` as live guards, and does
 *      not move at all for `describe.skip(` — the whole file silenced, the census still
 *      green at 73. That is PF-064's anatomy: a matcher that cannot express every shape
 *      the sink takes, over a predicate naming a proxy for the property rather than the
 *      property, yielding PF-018's outcome — a green test that no longer exercises
 *      anything. So the claim is carried by a PAIR: `countGuards` counts only
 *      declarations that run, and `collectDisabledGuards` must come back empty.
 *
 *   2. Registry Guard 6 (`tests/registry-integrity.test.ts`) is green with the
 *      OPERATION names UNCHANGED. Guard 6 checks that spawn-fence `OPERATION:`
 *      values and `## Operation:` headings agree; it does not check that the roster
 *      is the same roster. A phase that renamed an op while renaming its callers
 *      would keep Guard 6 green and silently change the contract, so the Phase-0
 *      set is named here and compared as a set.
 *
 * Why the count is not simply asserted inside `git-agent.test.ts`: the assertion
 * would be one of the `it(` occurrences it counts, so raising the floor and adding
 * the guard that enforces it would be the same edit. Here the two are separable.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import * as path from 'path';

import { ROOT, resolveAgentSource } from '../helpers.js';

// ---------------------------------------------------------------------------
// 1. git-agent.test.ts guard count
// ---------------------------------------------------------------------------

interface FloorEntry {
  id: string;
  floor: number;
  pattern: string;
  occurrences: number;
  sourceFile: string;
  description: string;
}

const FLOORS: { floors: FloorEntry[] } = JSON.parse(
  readFileSync(path.join(ROOT, 'tests', 'fixtures', 'numeric-floors.json'), 'utf-8'),
);

const GUARD_COUNT_FLOOR_ID = 'git-agent-guard-count';

/** The file whose guards are counted. Named once; read once. */
const COUNTED_FILE = 'tests/git-agent.test.ts';

/**
 * Named collector: every LIVE `it(` declaration in a test source.
 *
 * Bare `it(` only. No modifier spelling is live in the sense the floor claims:
 * `it.skip(` and `it.todo(` never run, `it.fails(` is green precisely when its
 * assertions fail, and `it.only(` leaves every other declaration in the file unrun.
 * Counting those as guards would let the census read 73 over a file that guards
 * nothing; `collectDisabledGuards` names each of them instead, so converting a guard
 * shows up twice — as a count that fell, and as a spelling that was reported.
 *
 * Anchored to the start of a line so a `submit(` or an `it(` inside a template
 * string cannot inflate the count — an inflated census is a census that lets a real
 * guard be deleted without noticing.
 */
export function countGuards(source: string): number {
  return (source.match(/^[ \t]*it[ \t]*\(/gm) ?? []).length;
}

/** One spelling that stops guards from running, and which guards it stops. */
interface DisablingSpelling {
  /** How it is written at the head of a declaration line. */
  readonly spelling: string;
  /** What stops running when it appears — the half a count of declarations cannot see. */
  readonly silences: string;
}

/**
 * Every spelling that makes a declaration guard nothing. Two families:
 *
 *   - DISABLING (`xit`, `it.skip`, `it.todo`, `it.fails`, `xdescribe`,
 *     `describe.skip`, `describe.todo`) — the declaration does not run, or runs
 *     inverted. The block-level half is the dangerous one: `tests/git-agent.test.ts`
 *     holds all 73 guards inside a SINGLE top-level `describe(`, so inserting five
 *     characters makes it `describe.skip(` and silences the whole file with the count
 *     still reading 73.
 *   - FOCUSING (`fit`, `it.only`, `fdescribe`, `describe.only`) — this declaration
 *     runs and the rest do not. An ADDED `it.only(` is not itself counted, so the
 *     count stays at exactly 73 while all 73 stop running: a floor on a count can
 *     never catch it, in either direction.
 *
 * The table is the matcher: `DISABLING_PATTERN` is built from it, so a spelling added
 * here is a spelling the collector sees, and the probe below drives every row.
 *
 * Non-goal: `it.skipIf` / `describe.skipIf` are deliberately absent. They ship
 * legitimately elsewhere in this suite as platform gates (`IS_WIN32`), and the narrowed
 * `countGuards` already refuses to count them, so converting a guard to one drops the
 * count below the floor and fails red on its own.
 */
export const DISABLING_SPELLINGS: readonly DisablingSpelling[] = [
  { spelling: 'xit', silences: 'this guard' },
  { spelling: 'it.skip', silences: 'this guard' },
  { spelling: 'it.todo', silences: 'this guard' },
  { spelling: 'it.fails', silences: 'this guard — it is green when its assertions FAIL' },
  { spelling: 'xdescribe', silences: 'every guard in the block' },
  { spelling: 'describe.skip', silences: 'every guard in the block' },
  { spelling: 'describe.todo', silences: 'every guard in the block' },
  { spelling: 'fit', silences: 'every OTHER guard in the file' },
  { spelling: 'it.only', silences: 'every OTHER guard in the file' },
  { spelling: 'fdescribe', silences: 'every guard outside the block' },
  { spelling: 'describe.only', silences: 'every guard outside the block' },
];

/** Escape a literal spelling for use inside a regular expression. */
function escapeLiteral(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Longest first, so no spelling can be shadowed by a prefix of itself. */
const DISABLING_PATTERN = [...DISABLING_SPELLINGS]
  .map(entry => entry.spelling)
  .sort((a, b) => b.length - a.length)
  .map(escapeLiteral)
  .join('|');

/**
 * Named collector: every site in `source` that stops a guard from running.
 *
 * Scanned line by line rather than with a `g` flag so each hit carries its line
 * number: "the census is not what it claims" is only actionable if it names where.
 * Line-anchored on the same terms as `countGuards` — the two collectors must agree
 * about what a declaration looks like or the pair does not compose.
 */
export function collectDisabledGuards(source: string): string[] {
  const declaration = new RegExp(`^[ \\t]*(${DISABLING_PATTERN})[ \\t]*\\(`);
  const silences = new Map(DISABLING_SPELLINGS.map(entry => [entry.spelling, entry.silences]));
  const found: string[] = [];
  source.split('\n').forEach((line, index) => {
    const match = declaration.exec(line);
    if (match) found.push(`line ${index + 1}: ${match[1]}( — silences ${silences.get(match[1])}`);
  });
  return found;
}

describe('guard census: git-agent.test.ts guard count has not decreased (AC-2.6)', () => {
  const source = readFileSync(path.join(ROOT, COUNTED_FILE), 'utf-8');
  const entry = FLOORS.floors.find(f => f.id === GUARD_COUNT_FLOOR_ID);

  it('the floor is registered in the numeric-floor manifest', () => {
    expect(
      entry,
      `"${GUARD_COUNT_FLOOR_ID}" is missing from tests/fixtures/numeric-floors.json. The floor ` +
      `belongs in the manifest, not inline: the manifest is what makes lowering it a visible edit.`,
    ).toBeDefined();
    // `sourceFile` names where the PATTERN is spelled, which is this file — the
    // manifest guard greps it there. The file being COUNTED is named in the
    // description and read below, and the two are deliberately different.
    expect(entry!.sourceFile, 'the entry must point at the file spelling the pattern')
      .toBe('tests/guards/guard-census.test.ts');
    expect(entry!.description, 'the description must name the file the floor counts')
      .toContain(COUNTED_FILE);
    expect(entry!.description.length, 'the entry must record what the number is').toBeGreaterThan(0);
  });

  it('the live count is at or above the registered floor', () => {
    const count = countGuards(source);
    // The floor is spelled here as well as in the manifest, on purpose: the manifest
    // pins the SITE that spells it, so the two must agree and the agreement is asserted.
    expect(
      entry!.floor,
      'the manifest floor and the assertion below must be the same number',
    ).toBe(73);
    expect(
      count,
      `${COUNTED_FILE} declares ${count} guards, floor ${entry!.floor}. A guard that moved ` +
      `with its text is not a guard that was deleted — repoint the corpus and keep the assertion ` +
      `(GAP-21). If a guard genuinely became unsatisfiable, its SUCCESSOR is what keeps the count ` +
      `whole ([DR-20] replaced one D10 scope guard with four).`,
    ).toBeGreaterThanOrEqual(73);
  });

  it('no declaration in the counted file is disabled or focused', () => {
    // The other half of the claim. A count of declarations is a census of the guard
    // surface only while every declaration runs: `countGuards` names a proxy for the
    // property, and this names the property (PF-064). Asserted empty, so the probe
    // below is what keeps it from being an assertion that cannot fail (PF-018).
    const disabled = collectDisabledGuards(source);
    expect(
      disabled,
      `${COUNTED_FILE} carries ${disabled.length} spelling(s) that stop guards running:\n` +
      `${disabled.join('\n')}\n` +
      `Re-enable the guard, or delete it — deleting moves the count, and the count is ` +
      `already guarded. Silencing is the move that leaves both numbers looking healthy.`,
    ).toEqual([]);
  });

  it('every disabling spelling is seen by one collector and refused by the other', () => {
    // Known-bad probe per ROW, not per family: the table is the matcher, so a spelling
    // it names but the regex cannot express is exactly the hole this guard exists to
    // close — a matcher is only as good as the shapes it can be shown to express (PF-064).
    for (const { spelling } of DISABLING_SPELLINGS) {
      const seeded = `describe('probe', () => {\n  ${spelling}('seeded', () => {});\n});\n`;
      expect(
        collectDisabledGuards(seeded),
        `${spelling}( is in the roster but the collector does not see it`,
      ).toHaveLength(1);
      expect(
        countGuards(seeded),
        `${spelling}( must not be counted as a live guard`,
      ).toBe(0);
    }
    // The opposite direction: a collector that reported everything would pass every
    // assertion above and fail only on the real file.
    expect(
      collectDisabledGuards("  it('live', () => {});\n"),
      'a live declaration must not be reported as disabled',
    ).toEqual([]);
  });

  it('the collector is non-vacuous and does not over-count', () => {
    expect(countGuards(source), 'the collector found no guards at all').toBeGreaterThan(0);
    // Known-bad probe: a silenced guard must move the number the assertion reads.
    // Seeded with `it.skip(` — the spelling a person reaching to quiet a failing guard
    // actually types. Seeding `xit(` instead would exercise a shape no plausible count
    // regex accepts, and so would prove nothing about the ones that can inflate it.
    const withOneSkipped = source.replace(/^[ \t]*it[ \t]*\(/m, '  it.skip(');
    expect(withOneSkipped, 'the skip probe must actually have seeded something').not.toBe(source);
    expect(
      countGuards(withOneSkipped),
      'skipping one declaration must lower the count — otherwise the floor tracks nothing',
    ).toBe(countGuards(source) - 1);
    expect(
      collectDisabledGuards(withOneSkipped),
      'the skipped declaration must also be named, so the failure says which one',
    ).toHaveLength(1);
    // The block-level case is the one no count can reach: every guard in the file sits
    // inside a single top-level `describe(`, so this silences all of them at once and
    // the number does not move at all.
    const withBlockSkipped = source.replace(/^[ \t]*describe[ \t]*\(/m, 'describe.skip(');
    expect(withBlockSkipped, 'the block probe must actually have seeded something').not.toBe(source);
    expect(
      countGuards(withBlockSkipped),
      'a skipped block must leave the count untouched — which is why the count is not the whole claim',
    ).toBe(countGuards(source));
    expect(
      collectDisabledGuards(withBlockSkipped),
      'a skipped block must be named by the collector that can see it',
    ).toHaveLength(1);
    // …and shapes that only LOOK like declarations must not raise it.
    expect(countGuards('const x = submit(1)\nconst s = `it(`\n'), 'over-counting shapes').toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 2. Registry Guard 6 — the operation roster is unchanged
// ---------------------------------------------------------------------------

/**
 * The 18 `## Operation:` names as they stood at Phase 0, in file order.
 *
 * A NAMED set, not a count: Guard 6 asserts spawn fences and headings agree, which
 * stays true across a coordinated rename. What Phase 2 promises is that no op was
 * renamed at all — the split moved mechanics, and a caller written against an
 * operation name in a release two versions ago still resolves.
 */
export const PHASE0_OPERATION_NAMES: readonly string[] = [
  'ensure-pr-ready',
  'validate-branch',
  'setup-task',
  'fetch-issue',
  'fetch-issues-batch',
  'post-review-summary',
  'manage-debt',
  'check-ci-status',
  'create-release',
  'gather-release-evidence',
  'learn-conventions',
  'fetch-review-threads',
  'resolve-review-threads',
  'post-resolution-summary',
  'check-merge-readiness',
  'backlink-shipped-issues',
  'ensure-traceable-issue',
  'post-wave-report',
];

/** Named collector: the `## Operation:` names an agent source declares, in file order. */
export function collectOperationNames(content: string): string[] {
  return [...content.matchAll(/^## Operation: (\S+)/gm)].map(m => m[1]);
}

describe('guard census: the operation roster is unchanged (AC-2.6, registry Guard 6)', () => {
  it('the compiled agent declares exactly the Phase-0 operation names, in order', () => {
    const names = collectOperationNames(resolveAgentSource('git').content);
    expect(
      names,
      'the operation roster changed. Registry Guard 6 stays green across a coordinated rename, so ' +
      'it cannot see this: a renamed op silently breaks every caller pinned to the old name.',
    ).toEqual(PHASE0_OPERATION_NAMES);
  });

  it('the roster check is non-vacuous, and the collector sees a seeded change', () => {
    expect(PHASE0_OPERATION_NAMES.length, 'the named set is empty').toBe(18);
    const seeded = '## Operation: setup-task\nbody\n\n## Operation: renamed-op\nbody\n';
    expect(collectOperationNames(seeded)).toEqual(['setup-task', 'renamed-op']);
  });
});
