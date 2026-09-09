/**
 * Numeric floor manifest guard (P0-S22, AC-0.17, DR-27a).
 *
 * Mechanizes the "no pinned floor may decrease" rule.
 * Each entry in tests/fixtures/numeric-floors.json records a numeric floor
 * (e.g., host file count = 13) along with the exact assertion pattern that
 * encodes it (e.g., "toHaveLength(13)") and the source file that contains it.
 *
 * This guard verifies:
 *   1. Each pattern still exists in the designated source file (floor not decreased).
 *   2. New entries are allowed — only existing entries are checked.
 *   3. Non-vacuity: manifest is non-empty; seeded decrement proves the guard is live.
 *
 * To raise a floor: update both the test assertion AND the manifest entry's
 * `floor` and `pattern` fields. Do not lower either — this guard will fail.
 *
 * Mechanic 2 (H10) for non-vacuity: an inline known-bad scenario proves that
 * replacing the real pattern with a decremented pattern makes the guard fail —
 * without touching any committed source file.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import * as path from 'path';

const ROOT = path.resolve(import.meta.dirname, '../..');

// ---------------------------------------------------------------------------
// Load manifest
// ---------------------------------------------------------------------------

interface FloorEntry {
  id: string;
  floor: number;
  pattern: string;
  /**
   * How many sites in `sourceFile` spell this floor. Checking mere presence is
   * not enough when a pattern repeats: `toBe(14)` appears at 3 sites and
   * `60_000` at 21, so lowering one of them leaves the pattern present and the
   * decrease undetected. The guard requires at least this many matches.
   */
  occurrences: number;
  sourceFile: string;
  description: string;
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

interface FloorManifest {
  version: number;
  comment: string;
  floors: FloorEntry[];
}

const MANIFEST_PATH = path.join(ROOT, 'tests', 'fixtures', 'numeric-floors.json');

function loadManifest(): FloorManifest {
  try {
    return JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8')) as FloorManifest;
  } catch (err) {
    throw new Error(
      `Failed to load ${MANIFEST_PATH}: ${String(err)}\n` +
      `  Ensure tests/fixtures/numeric-floors.json is committed and valid JSON.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Guard
// ---------------------------------------------------------------------------

describe('numeric floor manifest guard (DR-27a, P0-S22)', () => {
  it('manifest loads and contains non-empty floors array (non-vacuity)', () => {
    const manifest = loadManifest();
    expect(manifest.version, 'manifest must carry a version field').toBeGreaterThan(0);
    expect(
      manifest.floors.length,
      'floors array must be non-empty — guard would be vacuous otherwise (PF-018)',
    ).toBeGreaterThan(0);
    for (const entry of manifest.floors) {
      expect(entry.id.length, `entry must have a non-empty id`).toBeGreaterThan(0);
      expect(entry.floor, `entry "${entry.id}" floor must be a positive integer`).toBeGreaterThan(0);
      expect(entry.pattern.length, `entry "${entry.id}" must have a non-empty pattern`).toBeGreaterThan(0);
      expect(
        entry.occurrences,
        `entry "${entry.id}" must record how many sites spell the floor (occurrences ≥ 1)`,
      ).toBeGreaterThanOrEqual(1);
      expect(entry.sourceFile.length, `entry "${entry.id}" must name a sourceFile`).toBeGreaterThan(0);
      expect(entry.description.length, `entry "${entry.id}" must have a description`).toBeGreaterThan(0);
    }
  });

  it('every pinned floor pattern still exists in its designated source file (no floor may decrease)', () => {
    const manifest = loadManifest();
    const violations: string[] = [];

    for (const entry of manifest.floors) {
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
          `  floor   : ${entry.floor}\n` +
          `  desc    : ${entry.description}\n` +
          `  → An assertion was likely lowered below the pinned floor (DR-27a).\n` +
          `    If the floor was intentionally raised, or a pinned site deliberately removed,\n` +
          `    update numeric-floors.json with the new floor, pattern and occurrences.`,
        );
      }
    }

    expect(
      violations,
      `Numeric floor violations (DR-27a):\n\n${violations.join('\n\n')}`,
    ).toHaveLength(0);
  });

  it("every entry's pattern actually encodes its floor (a pattern that doesn't is unenforceable)", () => {
    // Without this, {floor: 999, pattern: "toBe(14)"} passes forever: the guard
    // only greps the pattern, so the recorded floor would be decorative. It is
    // also the precondition for the decrement probe below.
    const manifest = loadManifest();
    const violations: string[] = [];

    for (const entry of manifest.floors) {
      if (renderFloorToken(entry.pattern, entry.floor) === null) {
        violations.push(
          `[${entry.id}] pattern "${entry.pattern}" does not contain its floor ${entry.floor} ` +
          `(plain "${entry.floor}" or grouped "${groupDigits(entry.floor)}")`,
        );
      }
    }

    expect(
      violations,
      `Manifest entries whose pattern does not encode the floor:\n${violations.join('\n')}`,
    ).toHaveLength(0);
  });

  it('non-vacuity: a decremented pattern would fail the guard for EVERY entry (mechanic 2, H10)', () => {
    // Runs over every entry, not just floors[0]. Probing one entry left the rest
    // unproven — and the probe silently no-opped on any pattern whose numeral is
    // digit-grouped ("60_000" does not contain "60000", so the replace was an
    // identity and the "pattern must be gone" assertion would fail for the wrong
    // reason). renderFloorToken handles both spellings.
    const manifest = loadManifest();
    expect(manifest.floors.length, 'manifest must have at least one entry for the probe').toBeGreaterThan(0);

    for (const entry of manifest.floors) {
      const absPath = path.join(ROOT, entry.sourceFile);
      const realContent = readFileSync(absPath, 'utf-8');

      // GREEN half: the real pattern is present at the recorded number of sites,
      // so the guard passes today.
      expect(
        countOccurrences(realContent, entry.pattern),
        `[${entry.id}] real pattern "${entry.pattern}" must appear ≥ ${entry.occurrences}× in ${entry.sourceFile}`,
      ).toBeGreaterThanOrEqual(entry.occurrences);

      // RED half: lowering a SINGLE site is enough to trip the guard. This is
      // the case a presence-only check misses whenever occurrences > 1.
      const token = renderFloorToken(entry.pattern, entry.floor)!;
      const decrementedPattern = entry.pattern.replace(
        token,
        renderSameStyle(entry.floor - 1, token),
      );
      expect(
        decrementedPattern,
        `[${entry.id}] decremented pattern must differ from the real one`,
      ).not.toBe(entry.pattern);

      const syntheticContent = realContent.replace(entry.pattern, decrementedPattern);
      expect(
        countOccurrences(syntheticContent, entry.pattern),
        `[${entry.id}] non-vacuity: lowering one of ${entry.occurrences} site(s) must drop the ` +
        `match count below the pinned occurrences — otherwise a partial floor decrease is invisible`,
      ).toBeLessThan(entry.occurrences);
    }
  });
});

// ---------------------------------------------------------------------------
// Floor-token helpers
//
// A floor may be spelled plainly ("3072") or digit-grouped ("60_000") in the
// assertion it pins. Both spellings must round-trip for the decrement probe.
// ---------------------------------------------------------------------------

/** Render a number with underscore digit grouping: 60000 → "60_000". */
function groupDigits(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '_');
}

/** The exact substring of `pattern` that spells `floor`, or null if absent. */
function renderFloorToken(pattern: string, floor: number): string | null {
  const plain = String(floor);
  if (pattern.includes(plain)) return plain;
  const grouped = groupDigits(floor);
  if (pattern.includes(grouped)) return grouped;
  return null;
}

/** Render `n` in the same spelling style as `token` (grouped or plain). */
function renderSameStyle(n: number, token: string): string {
  return token.includes('_') ? groupDigits(n) : String(n);
}
