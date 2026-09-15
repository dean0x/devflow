/**
 * Numeric ratchet manifest guard (P0-S22, AC-0.17, DR-27a).
 *
 * Mechanizes two rules with one mechanism:
 *   - no pinned FLOOR may decrease   (`floors` in tests/fixtures/numeric-floors.json)
 *   - no pinned CEILING may increase (`ceilings` in the same file)
 *
 * Each entry records a number (e.g. host file count = 13, BUDGET_GIT_MD = 55_750)
 * along with the exact assertion pattern that encodes it and the source file that
 * contains it.
 *
 * Why both directions. A floors-only manifest guards the counts and leaves every
 * budget unguarded in the direction that matters: `BUDGET_GIT_MD` could be raised
 * to whatever dist/agents/git.md grew into, and each guard would stay green while
 * asserting nothing but "the current size is the current size". A ceiling may be
 * LOWERED as the artifact shrinks — that is the ratchet tightening — and may never
 * be raised.
 *
 * This guard verifies, for both arrays:
 *   1. Each pattern still exists in the designated source file, at the recorded
 *      number of sites (the value has not moved in the forbidden direction).
 *   2. New entries are allowed — only existing entries are checked.
 *   3. Each entry's pattern actually spells its value, so the record is enforceable.
 *   4. Non-vacuity: both arrays are non-empty, and a seeded bad value proves the
 *      guard is live — DECREMENTED for a floor, INCREMENTED for a ceiling.
 *
 * To move a pin: update both the assertion AND the manifest entry's value,
 * `pattern` and `occurrences` — and only in the permitted direction.
 *
 * Mechanic 2 (H10) for non-vacuity: the known-bad scenario is synthesised in
 * memory, so no committed source file is ever touched to show red.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import * as path from 'path';

const ROOT = path.resolve(import.meta.dirname, '../..');

// ---------------------------------------------------------------------------
// Load manifest
// ---------------------------------------------------------------------------

/** Which way a pinned value may never move. */
type Ratchet = 'floor' | 'ceiling';

interface RawEntry {
  id: string;
  /** Present on `floors` entries. */
  floor?: number;
  /** Present on `ceilings` entries. */
  ceiling?: number;
  pattern: string;
  /**
   * How many sites in `sourceFile` spell this value. Checking mere presence is
   * not enough when a pattern repeats: `toBe(14)` appears at 5 sites and
   * `60_000` at 21, so moving one of them leaves the pattern present and the
   * change undetected. The guard requires at least this many matches.
   */
  occurrences: number;
  sourceFile: string;
  description: string;
}

interface PinnedEntry {
  id: string;
  /** The pinned number, whichever direction it ratchets. */
  value: number;
  pattern: string;
  occurrences: number;
  sourceFile: string;
  description: string;
  ratchet: Ratchet;
  /** Human label for messages: "floor" / "ceiling". */
  label: string;
}

interface RatchetManifest {
  version: number;
  comment: string;
  floors: RawEntry[];
  ceilings: RawEntry[];
}

const MANIFEST_PATH = path.join(ROOT, 'tests', 'fixtures', 'numeric-floors.json');

function loadManifest(): RatchetManifest {
  try {
    return JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8')) as RatchetManifest;
  } catch (err) {
    throw new Error(
      `Failed to load ${MANIFEST_PATH}: ${String(err)}\n` +
      `  Ensure tests/fixtures/numeric-floors.json is committed and valid JSON.`,
    );
  }
}

/**
 * Normalise one array of the manifest into direction-tagged entries.
 * `floor` and `ceiling` are separate keys on purpose: an entry that carried a
 * bare `value` would read identically in both arrays, and a paste between them
 * would silently flip the ratchet direction.
 */
function pinned(ratchet: Ratchet): PinnedEntry[] {
  const manifest = loadManifest();
  const raw = ratchet === 'floor' ? manifest.floors : manifest.ceilings;
  if (!Array.isArray(raw)) {
    throw new Error(`numeric-floors.json has no "${ratchet}s" array — both arrays are required`);
  }
  return raw.map(entry => ({
    id: entry.id,
    value: (ratchet === 'floor' ? entry.floor : entry.ceiling) as number,
    pattern: entry.pattern,
    occurrences: entry.occurrences,
    sourceFile: entry.sourceFile,
    description: entry.description,
    ratchet,
    label: ratchet,
  }));
}

/** Count non-overlapping occurrences of `needle` in `haystack`. */
function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let index = 0;
  while ((index = haystack.indexOf(needle, index)) !== -1) {
    count++;
    index += needle.length;
  }
  return count;
}

// ---------------------------------------------------------------------------
// The four checks, written once and run over both arrays
// ---------------------------------------------------------------------------

function checkShape(entries: readonly PinnedEntry[], arrayName: string): void {
  expect(
    entries.length,
    `${arrayName} array must be non-empty — guard would be vacuous otherwise (PF-018)`,
  ).toBeGreaterThan(0);
  for (const entry of entries) {
    expect(entry.id.length, `entry must have a non-empty id`).toBeGreaterThan(0);
    expect(
      entry.value,
      `entry "${entry.id}" ${entry.label} must be a positive integer — a missing ` +
      `"${entry.ratchet}" key reads as undefined and makes the entry unenforceable`,
    ).toBeGreaterThan(0);
    expect(entry.pattern.length, `entry "${entry.id}" must have a non-empty pattern`).toBeGreaterThan(0);
    expect(
      entry.occurrences,
      `entry "${entry.id}" must record how many sites spell the value (occurrences ≥ 1)`,
    ).toBeGreaterThanOrEqual(1);
    expect(entry.sourceFile.length, `entry "${entry.id}" must name a sourceFile`).toBeGreaterThan(0);
    expect(entry.description.length, `entry "${entry.id}" must have a description`).toBeGreaterThan(0);
  }
}

/** Named collector: entries whose pattern no longer appears often enough in its source. */
function collectMovedPins(entries: readonly PinnedEntry[]): string[] {
  const violations: string[] = [];
  const forbidden = (e: PinnedEntry) => (e.ratchet === 'floor' ? 'lowered' : 'raised');

  for (const entry of entries) {
    const absPath = path.join(ROOT, entry.sourceFile);
    let content: string;
    try {
      content = readFileSync(absPath, 'utf-8');
    } catch {
      violations.push(
        `[${entry.id}] source file not found: ${entry.sourceFile}\n` +
        `  → Ensure the file exists; if it was moved, update the manifest.`,
      );
      continue;
    }

    const found = countOccurrences(content, entry.pattern);
    if (found < entry.occurrences) {
      violations.push(
        `[${entry.id}] pattern found ${found}× in ${entry.sourceFile}, expected ≥ ${entry.occurrences}:\n` +
        `  pattern : ${entry.pattern}\n` +
        `  ${entry.label.padEnd(7)} : ${entry.value}\n` +
        `  desc    : ${entry.description}\n` +
        `  → An assertion was likely ${forbidden(entry)} past the pinned ${entry.label} (DR-27a).\n` +
        `    If it was moved in the permitted direction, or a pinned site deliberately removed,\n` +
        `    update numeric-floors.json with the new value, pattern and occurrences.`,
      );
    }
  }
  return violations;
}

/** Named collector: entries whose pattern does not actually spell their value. */
function collectUnencodedPins(entries: readonly PinnedEntry[]): string[] {
  return entries
    .filter(entry => renderValueToken(entry.pattern, entry.value) === null)
    .map(entry =>
      `[${entry.id}] pattern "${entry.pattern}" does not contain its ${entry.label} ${entry.value} ` +
      `(plain "${entry.value}" or grouped "${groupDigits(entry.value)}")`,
    );
}

/**
 * Seed each entry's value one step in the FORBIDDEN direction and prove the same
 * presence check would report it. Runs over every entry, not just the first:
 * probing one left the rest unproven.
 */
function probeForbiddenDirection(entries: readonly PinnedEntry[]): void {
  expect(entries.length, 'array must have at least one entry for the probe').toBeGreaterThan(0);

  for (const entry of entries) {
    const absPath = path.join(ROOT, entry.sourceFile);
    const realContent = readFileSync(absPath, 'utf-8');

    // GREEN half: the real pattern is present at the recorded number of sites,
    // so the guard passes today.
    expect(
      countOccurrences(realContent, entry.pattern),
      `[${entry.id}] real pattern "${entry.pattern}" must appear ≥ ${entry.occurrences}× in ${entry.sourceFile}`,
    ).toBeGreaterThanOrEqual(entry.occurrences);

    // RED half: moving a SINGLE site one step the wrong way is enough to trip the
    // guard — a floor DOWN, a ceiling UP. This is the case a presence-only check
    // misses whenever occurrences > 1.
    const token = renderValueToken(entry.pattern, entry.value)!;
    const badValue = entry.ratchet === 'floor' ? entry.value - 1 : entry.value + 1;
    const badPattern = entry.pattern.replace(token, renderSameStyle(badValue, token));
    expect(
      badPattern,
      `[${entry.id}] the seeded pattern must differ from the real one`,
    ).not.toBe(entry.pattern);

    const syntheticContent = realContent.replace(entry.pattern, badPattern);
    expect(
      countOccurrences(syntheticContent, entry.pattern),
      `[${entry.id}] non-vacuity: moving one of ${entry.occurrences} site(s) ` +
      `${entry.ratchet === 'floor' ? 'below' : 'above'} the pinned ${entry.label} must drop the ` +
      `match count below the pinned occurrences — otherwise a partial change is invisible`,
    ).toBeLessThan(entry.occurrences);
  }
}

// ---------------------------------------------------------------------------
// Floors — may rise, never fall
// ---------------------------------------------------------------------------

describe('numeric floor manifest guard (DR-27a, P0-S22)', () => {
  it('manifest loads and contains a non-empty floors array (non-vacuity)', () => {
    expect(loadManifest().version, 'manifest must carry a version field').toBeGreaterThan(0);
    checkShape(pinned('floor'), 'floors');
  });

  it('every pinned floor pattern still exists in its designated source file (no floor may decrease)', () => {
    const violations = collectMovedPins(pinned('floor'));
    expect(
      violations,
      `Numeric floor violations (DR-27a):\n\n${violations.join('\n\n')}`,
    ).toHaveLength(0);
  });

  it("every entry's pattern actually encodes its floor (a pattern that doesn't is unenforceable)", () => {
    // Without this, {floor: 999, pattern: "toBe(14)"} passes forever: the guard
    // only greps the pattern, so the recorded floor would be decorative. It is
    // also the precondition for the decrement probe below.
    const violations = collectUnencodedPins(pinned('floor'));
    expect(
      violations,
      `Manifest entries whose pattern does not encode the floor:\n${violations.join('\n')}`,
    ).toHaveLength(0);
  });

  it('non-vacuity: a DECREMENTED pattern would fail the guard for EVERY floor entry (mechanic 2, H10)', () => {
    // The probe handles both spellings of a numeral: "60_000" does not contain
    // "60000", so a naive replace would be an identity and the assertion would
    // fail for the wrong reason. renderValueToken resolves the spelling first.
    probeForbiddenDirection(pinned('floor'));
  });
});

// ---------------------------------------------------------------------------
// Ceilings — may be lowered, never raised
// ---------------------------------------------------------------------------

describe('numeric ceiling manifest guard (DR-27a, mirrored arm)', () => {
  it('manifest contains a non-empty ceilings array (non-vacuity)', () => {
    checkShape(pinned('ceiling'), 'ceilings');
  });

  it('every pinned ceiling pattern still exists in its designated source file (no ceiling may increase)', () => {
    const violations = collectMovedPins(pinned('ceiling'));
    expect(
      violations,
      `Numeric ceiling violations (DR-27a):\n\n${violations.join('\n\n')}`,
    ).toHaveLength(0);
  });

  it("every entry's pattern actually encodes its ceiling (a pattern that doesn't is unenforceable)", () => {
    const violations = collectUnencodedPins(pinned('ceiling'));
    expect(
      violations,
      `Manifest entries whose pattern does not encode the ceiling:\n${violations.join('\n')}`,
    ).toHaveLength(0);
  });

  it('non-vacuity: an INCREMENTED pattern would fail the guard for EVERY ceiling entry (mechanic 2, H10)', () => {
    // The mirror of the floor probe. A budget raised to fit whatever the artifact
    // grew into asserts nothing; this proves the guard sees that move.
    probeForbiddenDirection(pinned('ceiling'));
  });

  it('the two arrays are disjoint — no constant ratchets in both directions at once', () => {
    // A pin present in both arrays could never move at all, which is a freeze,
    // not a ratchet; more likely it is a paste that flipped a direction silently.
    const floorIds = new Set(pinned('floor').map(e => e.id));
    const both = pinned('ceiling').filter(e => floorIds.has(e.id)).map(e => e.id);
    expect(both, `ids registered as both floor and ceiling: ${both.join(', ')}`).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Value-token helpers
//
// A pinned value may be spelled plainly ("3072") or digit-grouped ("60_000") in
// the assertion it pins. Both spellings must round-trip for the seeded probes.
// ---------------------------------------------------------------------------

/** Render a number with underscore digit grouping: 60000 → "60_000". */
function groupDigits(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '_');
}

/** The exact substring of `pattern` that spells `value`, or null if absent. */
function renderValueToken(pattern: string, value: number): string | null {
  const plain = String(value);
  if (pattern.includes(plain)) return plain;
  const grouped = groupDigits(value);
  if (pattern.includes(grouped)) return grouped;
  return null;
}

/** Render `n` in the same spelling style as `token` (grouped or plain). */
function renderSameStyle(n: number, token: string): string {
  return token.includes('_') ? groupDigits(n) : String(n);
}
