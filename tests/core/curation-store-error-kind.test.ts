// tests/core/curation-store-error-kind.test.ts
//
// The kinds a curation store function can refuse with (src/core/curation-store.ts).
// CurationStoreError.kind is a union of those literals, so a compare against a kind
// the store never returns fails to compile. tsconfig.scripts.json type-checks this
// file, which makes the `@ts-expect-error` line below a compile-time check. The
// runtime test keeps the list equal to the kinds the store and move modules return.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { CURATION_STORE_ERROR_KINDS, type CurationStoreError } from '../../src/core/curation-store.js';
import { CURATION_MOVE, CURATION_STORE } from '../decisions/curation-fixtures.js';

/** The refusal builders in the store, each taking the kind as its first argument. */
const REFUSAL_BUILDERS = ['putRefusal', 'assignRefusal', 'retireRefusal', 'restoreRefusal'];

/** Every kind literal a module names: `kind: 'x'` (a JSDoc union names each alternative) and a refusal builder's first argument. */
function kindLiterals(file: string): string[] {
  const source = readFileSync(file, 'utf-8');
  const found = new Set<string>();
  for (const match of source.matchAll(/kind: ((?:'[a-z-]+'\s*\|?\s*)+)/g)) {
    for (const literal of match[1].matchAll(/'([a-z-]+)'/g)) found.add(literal[1]);
  }
  const builders = new RegExp(`(?:${REFUSAL_BUILDERS.join('|')})\\(\\s*'([a-z-]+)'`, 'g');
  for (const match of source.matchAll(builders)) found.add(match[1]);
  return [...found].sort();
}

describe('CurationStoreError.kind', () => {
  it('accepts a kind the store returns and rejects any other at compile time', () => {
    const known: CurationStoreError = { kind: 'busy', message: 'the lock is held' };
    // @ts-expect-error 'buzy' is not a kind the store returns
    const misspelled: CurationStoreError = { kind: 'buzy', message: 'the lock is held' };
    expect([known.kind, misspelled.kind]).toEqual(['busy', 'buzy']);
  });

  it.each([
    ['the store', CURATION_STORE, 20],
    ['the move module', CURATION_MOVE, 2],
  ])('lists every kind %s returns', (_name, file, atLeast) => {
    const named = kindLiterals(file);
    expect(named.length, 'the scan found the kind literals').toBeGreaterThanOrEqual(atLeast);
    expect(named.filter(kind => !(CURATION_STORE_ERROR_KINDS as readonly string[]).includes(kind))).toEqual([]);
  });

  it('holds each kind once', () => {
    expect(new Set(CURATION_STORE_ERROR_KINDS).size).toBe(CURATION_STORE_ERROR_KINDS.length);
  });
});
