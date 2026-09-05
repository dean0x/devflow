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
  sourceFile: string;
  description: string;
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

      if (!content.includes(entry.pattern)) {
        violations.push(
          `[${entry.id}] pattern not found in ${entry.sourceFile}:\n` +
          `  pattern : ${entry.pattern}\n` +
          `  floor   : ${entry.floor}\n` +
          `  desc    : ${entry.description}\n` +
          `  → The assertion was likely lowered below the pinned floor (DR-27a).\n` +
          `    If the floor was intentionally raised, update numeric-floors.json with the new floor and pattern.`,
        );
      }
    }

    expect(
      violations,
      `Numeric floor violations (DR-27a):\n\n${violations.join('\n\n')}`,
    ).toHaveLength(0);
  });

  it('non-vacuity: a floor pattern replaced with a decremented form would fail the guard (mechanic 2, H10)', () => {
    const manifest = loadManifest();

    // Pick the first entry as the known-bad probe.
    const entry = manifest.floors[0];
    expect(entry, 'manifest must have at least one entry for non-vacuity probe').toBeDefined();

    const absPath = path.join(ROOT, entry.sourceFile);
    const realContent = readFileSync(absPath, 'utf-8');

    // Step 1: Real pattern must exist in the source file (guard would pass = GREEN).
    expect(
      realContent.includes(entry.pattern),
      `non-vacuity: real pattern "${entry.pattern}" must exist in ${entry.sourceFile}`,
    ).toBe(true);

    // Step 2: Build decremented pattern — replace the floor number with (floor - 1).
    // Example: "toHaveLength(13)" → "toHaveLength(12)"
    const decrementedPattern = entry.pattern.replace(
      String(entry.floor),
      String(entry.floor - 1),
    );

    // Step 3: Simulate the guard on a synthetic content where the real pattern
    // is replaced by the decremented pattern — mimicking a floor decrease.
    const syntheticContent = realContent.replace(entry.pattern, decrementedPattern);

    // The real pattern must NOT exist in the synthetic content (it was replaced).
    expect(
      syntheticContent.includes(entry.pattern),
      `non-vacuity: after simulated decrement, real pattern "${entry.pattern}" must be gone`,
    ).toBe(false);

    // The guard would report a violation on syntheticContent.
    // We prove this inline by checking that includes() returns false:
    const guardWouldFail = !syntheticContent.includes(entry.pattern);
    expect(
      guardWouldFail,
      `non-vacuity: guard must detect missing pattern after decrement — mechanic 2 (H10)`,
    ).toBe(true);
  });
});
