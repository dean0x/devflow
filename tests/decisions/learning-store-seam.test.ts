// tests/decisions/learning-store-seam.test.ts
//
// The CLI's view of the learning store (D-LEARNING-STORE-SEAM):
// src/core/learning-store.ts loads the package's own
// src/assets/scripts/hooks/lib/learning-store.cjs — the module json-helper's ops
// and the hooks run — through the evidence-policy seam's loadScript, shape-checks
// its surface, and answers a Result for a missing or unusable module, never a
// throw.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'module';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { scriptsDir } from '../../src/core/assets.js';
import {
  LEARNING_STORE_SCRIPT_NAME,
  LEARNING_STORE_SURFACE,
  formatLearningStoreUnavailable,
  loadLearningStore,
} from '../../src/core/learning-store.js';
import { LEARNING_STORE, ROOT } from './learning-fixtures.js';

const NODE_REQUIRE = createRequire(import.meta.url);

let tmp: string;

beforeAll(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'learning-store-seam-')));
});

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

/** A scripts directory holding `content` where the store lives. */
function scriptsDirWithStore(name: string, content: string): string {
  const dir = path.join(tmp, name);
  const file = path.join(dir, LEARNING_STORE_SCRIPT_NAME);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
  return dir;
}

describe('loadLearningStore — the package copy, shape-checked, never a throw', () => {
  it('loads join(scriptsDir(), hooks/lib/learning-store.cjs): the module the ops and the hooks run', () => {
    const packageCopy = path.join(scriptsDir(), LEARNING_STORE_SCRIPT_NAME);
    expect(packageCopy).toBe(LEARNING_STORE);
    expect(packageCopy.startsWith(path.join(ROOT, 'src', 'assets', 'scripts'))).toBe(true);

    const loaded = loadLearningStore();
    expect(loaded.ok).toBe(true);
    // The same module object the require cache holds for that exact path.
    expect(loaded.ok && loaded.value).toBe(NODE_REQUIRE(packageCopy));
  });

  it('names every function and constant the CLI calls, and the store exports each with its declared kind', () => {
    expect(Object.keys(LEARNING_STORE_SURFACE)).toEqual([
      'INACTIVE_STATUSES', 'ANCHOR_ID_RE',
      'readLearningState', 'buildListing', 'readListing', 'formatListing', 'showByKey',
      'restoreAnchor', 'clearUnreferenced', 'resetLearning',
    ]);
    const raw = NODE_REQUIRE(LEARNING_STORE) as Record<string, unknown>;
    for (const [key, kind] of Object.entries(LEARNING_STORE_SURFACE)) {
      const value = raw[key];
      switch (kind) {
        case 'function': expect(typeof value, key).toBe('function'); break;
        case 'regexp': expect(value, key).toBeInstanceOf(RegExp); break;
        case 'string-array':
          expect(Array.isArray(value) && value.every(v => typeof v === 'string'), key).toBe(true);
          break;
        default: throw new Error(`unexpected surface kind ${String(kind)} for ${key}`);
      }
    }
  });

  it('a scripts directory without the store ⇒ Err not-found', () => {
    const empty = path.join(tmp, 'no-store');
    fs.mkdirSync(empty);
    const loaded = loadLearningStore(empty);
    expect(loaded.ok).toBe(false);
    expect(!loaded.ok && loaded.error.kind).toBe('not-found');
    expect(!loaded.ok && loaded.error.path).toBe(path.join(empty, LEARNING_STORE_SCRIPT_NAME));
  });

  it('a store missing or mistyping surface keys ⇒ Err unusable naming each one', () => {
    const dir = scriptsDirWithStore(
      'partial',
      "'use strict';\nmodule.exports = { INACTIVE_STATUSES: ['Retired'], ANCHOR_ID_RE: /x/, clearUnreferenced: 'not a function' };\n",
    );
    const loaded = loadLearningStore(dir);
    expect(loaded.ok).toBe(false);
    const detail = !loaded.ok && loaded.error.kind === 'unusable' ? loaded.error.detail : '';
    expect(detail).toMatch(/clearUnreferenced/);
    expect(detail).toMatch(/readListing/);
    expect(detail).not.toMatch(/INACTIVE_STATUSES/);
    expect(detail).not.toMatch(/ANCHOR_ID_RE/);
  });

  it('a store that throws while loading ⇒ Err unusable', () => {
    const dir = scriptsDirWithStore('throws', "'use strict';\nthrow new Error('boom');\n");
    const loaded = loadLearningStore(dir);
    expect(!loaded.ok && loaded.error.kind).toBe('unusable');
  });
});

describe('formatLearningStoreUnavailable', () => {
  it('says the store could not be used and names the reinstall remedy, for each error kind', () => {
    const notFound = formatLearningStoreUnavailable({ kind: 'not-found', path: '/x/learning-store.cjs' });
    const unusable = formatLearningStoreUnavailable({ kind: 'unusable', path: '/x/learning-store.cjs', detail: 'missing: readListing' });
    expect(notFound).toBe('learning store not found — reinstall devflow-kit');
    expect(unusable).toBe('learning store failed to load — reinstall devflow-kit');
  });
});
