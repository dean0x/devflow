/**
 * The §14.3 heading oracle is itself guarded.
 *
 * `TRACKER_SCHEMA_SECTIONS` in tests/helpers.ts is the THIRD PARTY the writer↔reader
 * heading seam binds to, so that two prompt files which both lost a section cannot
 * agree with each other and stay green. A third party is only worth having if IT
 * cannot silently shrink, and a length FLOOR cannot carry that claim: `>= 11` counts
 * duplicates, so a list that drops one heading and repeats another clears the floor
 * while describing a ten-section schema — and the reader block legitimately spells
 * `## Reference Rendering` twice, so a duplicate in that position looks ordinary.
 *
 * The check therefore lives at the oracle's CONSTRUCTION — exactly
 * `TRACKER_SCHEMA_SECTION_COUNT` distinct headings, no repeats, enforced at import so
 * every suite that binds to the list inherits it. This file is what makes that check
 * falsifiable: it drives the same collector, and the same throwing wrapper, over each
 * mutation the floor used to admit, and it records with a probe the one mutation the
 * collector is deliberately silent about (PF-064 — an absence result is a statement
 * about the shapes the matcher can express, never about the property).
 */

import { describe, it, expect } from 'vitest';

import {
  TRACKER_SCHEMA_SECTIONS,
  TRACKER_SCHEMA_SECTION_COUNT,
  collectSchemaOracleDefects,
  requireSchemaOracle,
} from '../helpers.js';

/** The count defect's wording, built from the constant rather than typed twice. */
function countDefect(distinct: number): string {
  return `${distinct} distinct heading(s); §14.3 fixes ${TRACKER_SCHEMA_SECTION_COUNT}`;
}

describe('the §14.3 heading oracle cannot silently shrink', () => {
  it('the shipped list is well formed — every probe below is a mutation of a clean base', () => {
    // Non-vacuity first. If the shipped list already tripped the collector, each
    // probe would be reporting the base rather than its own mutation.
    expect(
      collectSchemaOracleDefects(TRACKER_SCHEMA_SECTIONS),
      'the shipped oracle must be silent, or the probes below prove nothing',
    ).toEqual([]);
    expect(TRACKER_SCHEMA_SECTIONS.length).toBe(TRACKER_SCHEMA_SECTION_COUNT);
    expect(
      new Set(TRACKER_SCHEMA_SECTIONS).size,
      'the list carries no repeat, so `length` and the distinct count are the same number here ' +
      'and the collector below is what keeps them the same number later',
    ).toBe(TRACKER_SCHEMA_SECTION_COUNT);
  });

  it('known-bad probe: DROP-ONE is reported', () => {
    const dropped = TRACKER_SCHEMA_SECTIONS.slice(0, -1);
    expect(
      collectSchemaOracleDefects(dropped),
      'a section deleted from the oracle shrinks the contract every schema guard compares against',
    ).toEqual([countDefect(TRACKER_SCHEMA_SECTION_COUNT - 1)]);
    expect(() => requireSchemaOracle(dropped)).toThrow(/distinct heading/);
  });

  it('known-bad probe: DROP-ONE + DUPLICATE-ONE is reported — the mutation a floor admits', () => {
    // The compound mutation is the one that matters: it leaves the LENGTH at
    // TRACKER_SCHEMA_SECTION_COUNT, so every `>= 11` or `toHaveLength(11)` check
    // passes over a schema that has lost `### Substitutions` entirely.
    const wounded = [...TRACKER_SCHEMA_SECTIONS.slice(0, -1), TRACKER_SCHEMA_SECTIONS[0]];
    expect(wounded, 'the mutation must preserve the length, or it is not this mutation')
      .toHaveLength(TRACKER_SCHEMA_SECTIONS.length);
    expect(collectSchemaOracleDefects(wounded)).toEqual([
      `duplicate heading: ${TRACKER_SCHEMA_SECTIONS[0]}`,
      countDefect(TRACKER_SCHEMA_SECTION_COUNT - 1),
    ]);
    expect(() => requireSchemaOracle(wounded)).toThrow(/duplicate heading/);
  });

  it('known-bad probe: a bare DUPLICATE is reported even when no section was lost', () => {
    // The distinct count is still right here, so only the repeat itself is a defect.
    // Reported anyway: a repeated entry inflates every length comparison a consumer
    // makes, which is the mechanism the compound mutation above exploits.
    const repeated = [...TRACKER_SCHEMA_SECTIONS, TRACKER_SCHEMA_SECTIONS[0]];
    expect(collectSchemaOracleDefects(repeated))
      .toEqual([`duplicate heading: ${TRACKER_SCHEMA_SECTIONS[0]}`]);
    expect(() => requireSchemaOracle(repeated)).toThrow(/duplicate heading/);
  });

  it('known-bad probe: ADD-ONE is reported', () => {
    const grown = [...TRACKER_SCHEMA_SECTIONS, '## Invented Section'];
    expect(
      collectSchemaOracleDefects(grown),
      'a section added to the oracle and to nothing else makes both directions of the ' +
      'writer↔reader seam report it as missing, which reads as a prompt defect',
    ).toEqual([countDefect(TRACKER_SCHEMA_SECTION_COUNT + 1)]);
    expect(() => requireSchemaOracle(grown)).toThrow(/distinct heading/);
  });

  it('a SYNCHRONIZED rename is a declared NON-GOAL, and the probe records it as one', () => {
    // What a clean result does NOT cover, proven rather than asserted in prose.
    // A heading renamed here AND in the Tracker agent's template AND in the
    // Git-agent's reader block is well formed, so this collector is silent. Nothing
    // committed can arbitrate it: §14.3 lives under `.devflow/docs/design/`, which is
    // gitignored, so there is no fourth artifact to compare against.
    //
    // What IS covered, and is the reason the non-goal is narrow: a rename in ONE of
    // the three places breaks the ordered writer↔oracle equality or the reader↔oracle
    // membership, both of which bind to this list.
    const renamed = TRACKER_SCHEMA_SECTIONS.map(
      section => (section === '## Tech Debt' ? '## Technical Debt' : section),
    );
    expect(renamed, 'the mutation must really change the list').not.toEqual([...TRACKER_SCHEMA_SECTIONS]);
    expect(
      collectSchemaOracleDefects(renamed),
      'a consistently renamed list is well formed BY DESIGN. Recorded with a probe so a later ' +
      'reader cannot mistake this collector for rename coverage — that is the misreading an ' +
      'empty absence result invites (PF-064)',
    ).toEqual([]);
  });

  it('the collector reports every defect it finds, not the first', () => {
    // A collector that returned early would report the duplicate and hide the shrink,
    // and the shrink is the one that changes what the schema means.
    const both = [TRACKER_SCHEMA_SECTIONS[0], TRACKER_SCHEMA_SECTIONS[0]];
    expect(collectSchemaOracleDefects(both)).toEqual([
      `duplicate heading: ${TRACKER_SCHEMA_SECTIONS[0]}`,
      countDefect(1),
    ]);
  });
});
