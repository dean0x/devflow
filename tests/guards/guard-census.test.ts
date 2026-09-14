/**
 * guard-census — the guard surface did not shrink (AC-2.6, GAP-49).
 *
 * Two claims, both about the SHAPE of the Phase-2 refactor rather than its content:
 *
 *   1. `tests/git-agent.test.ts` still carries at least as many guards as it did.
 *      GAP-49: the AC used to pin "all 40 git-agent guards", a literal Phase 0 had
 *      already invalidated. A count that may only RISE is the version of that claim
 *      that survives the next phase, so the number lives in
 *      `tests/fixtures/numeric-floors.json` — the one place in this repo where a
 *      number may be raised and may never be lowered.
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
 * Named collector: every `it(` / `it.<modifier>(` declaration in a test source.
 *
 * Anchored to the start of a line so a `submit(` or an `it(` inside a template
 * string cannot inflate the count — an inflated census is a census that lets a real
 * guard be deleted without noticing.
 */
export function countGuards(source: string): number {
  return (source.match(/^[ \t]*it(?:\.\w+)?[ \t]*\(/gm) ?? []).length;
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
    ).toBe(68);
    expect(
      count,
      `${COUNTED_FILE} declares ${count} guards, floor ${entry!.floor}. A guard that moved ` +
      `with its text is not a guard that was deleted — repoint the corpus and keep the assertion ` +
      `(GAP-21). If a guard genuinely became unsatisfiable, its SUCCESSOR is what keeps the count ` +
      `whole ([DR-20] replaced one D10 scope guard with four).`,
    ).toBeGreaterThanOrEqual(68);
  });

  it('the collector is non-vacuous and does not over-count', () => {
    expect(countGuards(source), 'the collector found no guards at all').toBeGreaterThan(0);
    // Known-bad probe: a deleted guard must move the number the assertion reads.
    const withOneRemoved = source.replace(/^[ \t]*it(?:\.\w+)?[ \t]*\(/m, '  xit(');
    expect(
      countGuards(withOneRemoved),
      'removing one declaration must lower the count — otherwise the floor tracks nothing',
    ).toBe(countGuards(source) - 1);
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
