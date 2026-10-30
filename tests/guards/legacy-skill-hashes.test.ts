/**
 * legacy-skill-hashes: the frozen table of released `SKILL.md` hashes that decides whether a bare
 * legacy skill folder is devflow's.
 *
 * What it asserts
 * ---------------
 * 1. Shape: the table is frozen all the way down, its names are in order, and each hash is 64
 *    lowercase hex characters, once per name.
 * 2. Coverage in both directions, against tests/fixtures/released-shipped-names.ts: every bare
 *    name of the legacy skill list that a release installed has an entry, and every entry is such
 *    a name. A name that no release installed has no entry, so no folder of that name is moved.
 * 3. The released copies in tests/fixtures/released-legacy-skills hash to an entry of the table
 *    under their own name and no other: the table, the hash function and the fixtures agree.
 * 4. Floors: the table never loses a name or a hash (tests/fixtures/numeric-floors.json).
 *
 * What a green run does NOT prove
 * -------------------------------
 * That every entry is the hash of a file a release installed: the table was made from the
 * published packages on 2026-10-30, and only the two fixtures are checked against it here. A
 * wrong entry could only make devflow move a folder that it did not make, and only when a
 * SKILL.md of exactly that content stands there.
 */

import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';

import { BARE_LEGACY_SKILL_HASHES } from '../../src/targets/claude-code/legacy-skill-hashes.js';
import { LEGACY_SKILL_NAMES } from '../../src/targets/claude-code/legacy.js';
import { RELEASED_SHIPPED_NAMES } from '../fixtures/released-shipped-names.js';
import { ROOT } from '../helpers.js';

const SHA256_HEX = /^[0-9a-f]{64}$/;

const isFrozenDeep = (value: unknown): boolean => {
  if (typeof value !== 'object' || value === null) return true;
  return Object.isFrozen(value) && Object.values(value).every(isFrozenDeep);
};

const isBare = (name: string): boolean => !name.startsWith('devflow:');

/** The bare names of the legacy skill list that a release installed as a skill folder. */
function releasedBareLegacyNames(): string[] {
  const released = new Set(RELEASED_SHIPPED_NAMES.skills);
  return [...new Set(LEGACY_SKILL_NAMES)].filter(name => isBare(name) && released.has(name)).sort();
}

const fixtureHash = (name: string): string =>
  createHash('sha256')
    .update(readFileSync(path.join(ROOT, 'tests', 'fixtures', 'released-legacy-skills', `${name}.SKILL.md`)))
    .digest('hex');

describe('BARE_LEGACY_SKILL_HASHES shape', () => {
  it('is frozen all the way down', () => {
    expect(isFrozenDeep(BARE_LEGACY_SKILL_HASHES)).toBe(true);
  });

  it('lists its names in order', () => {
    const names = Object.keys(BARE_LEGACY_SKILL_HASHES);
    expect(names).toEqual([...names].sort());
  });

  it('holds each hash as 64 lowercase hex characters, once per name', () => {
    for (const [name, list] of Object.entries(BARE_LEGACY_SKILL_HASHES)) {
      expect(list.length, `${name} has a hash`).toBeGreaterThan(0);
      expect(list.filter(hash => !SHA256_HEX.test(hash)), `${name} holds a malformed hash`).toEqual([]);
      expect(new Set(list).size, `${name} lists a hash twice`).toBe(list.length);
    }
  });
});

describe('BARE_LEGACY_SKILL_HASHES coverage', () => {
  it('has an entry for every bare legacy name that a release installed', () => {
    const missing = releasedBareLegacyNames().filter(name => !Object.hasOwn(BARE_LEGACY_SKILL_HASHES, name));
    expect(missing, 'a released bare legacy skill with no hash would never be moved').toEqual([]);
  });

  it('has an entry for nothing else: a name that no release installed bare has no hash', () => {
    const allowed = new Set(releasedBareLegacyNames());
    const extra = Object.keys(BARE_LEGACY_SKILL_HASHES).filter(name => !allowed.has(name));
    expect(extra).toEqual([]);
  });

  it('is not vacuous: the legacy list holds released and never-released bare names', () => {
    const released = releasedBareLegacyNames();
    const bare = [...new Set(LEGACY_SKILL_NAMES)].filter(isBare);
    expect(released.length).toBeGreaterThan(30);
    expect(bare.length).toBeGreaterThan(released.length);
    expect(released).toContain('python');
    expect(bare).toContain('explore');
    expect(released).not.toContain('explore');
  });
});

describe('the released copies in tests/fixtures/released-legacy-skills', () => {
  it.each(['python', 'typescript'])('%s hashes to an entry of its own name and of no other name', name => {
    const hash = fixtureHash(name);
    expect(BARE_LEGACY_SKILL_HASHES[name]).toContain(hash);
    const others = Object.entries(BARE_LEGACY_SKILL_HASHES).filter(([other, list]) => other !== name && list.includes(hash));
    expect(others.map(([other]) => other)).toEqual([]);
  });
});

describe('the table only grows', () => {
  it('keeps its names and hashes at or above their floors', () => {
    const names = Object.keys(BARE_LEGACY_SKILL_HASHES);
    const hashCount = Object.values(BARE_LEGACY_SKILL_HASHES).reduce((sum, list) => sum + list.length, 0);
    expect(names.length).toBeGreaterThanOrEqual(39);
    expect(hashCount).toBeGreaterThanOrEqual(64);
  });
});
