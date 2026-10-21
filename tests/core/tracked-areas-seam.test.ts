// tests/core/tracked-areas-seam.test.ts
//
// The CLI's view of the tracked-areas check: src/core/tracked-areas.ts loads the
// package's own src/assets/scripts/hooks/lib/tracked-areas.cjs (the module the move and
// the backup sweep run) through the evidence-policy seam's loadScript, shape-checks its
// surface, and answers a Result for a missing or unusable module, never a throw.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'module';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { scriptsDir } from '../../src/core/assets.js';
import {
  TRACKED_AREAS_SCRIPT_NAME,
  TRACKED_AREAS_SURFACE,
  loadTrackedAreas,
} from '../../src/core/tracked-areas.js';
import { ROOT } from '../decisions/curation-fixtures.js';

const NODE_REQUIRE = createRequire(import.meta.url);
const LEAF = path.join(ROOT, 'src', 'assets', 'scripts', 'hooks', 'lib', 'tracked-areas.cjs');

let tmp: string;

beforeAll(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tracked-areas-seam-')));
});

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('loadTrackedAreas: the package copy, shape-checked, never a throw', () => {
  it('loads join(scriptsDir(), hooks/lib/tracked-areas.cjs): the module the move and the sweep run', () => {
    expect(path.join(scriptsDir(), TRACKED_AREAS_SCRIPT_NAME)).toBe(LEAF);
    const loaded = loadTrackedAreas();
    expect(loaded.ok).toBe(true);
    expect(loaded.ok && loaded.value).toBe(NODE_REQUIRE(LEAF));
  });

  it('names the one function the CLI calls, and the module exports it as a function', () => {
    expect(Object.keys(TRACKED_AREAS_SURFACE)).toEqual(['checkTrackedAreas']);
    expect(typeof (NODE_REQUIRE(LEAF) as Record<string, unknown>).checkTrackedAreas).toBe('function');
  });

  it('a scripts directory without the module is a not-found error naming the path', () => {
    const empty = path.join(tmp, 'no-leaf');
    fs.mkdirSync(empty);
    const loaded = loadTrackedAreas(empty);
    expect(!loaded.ok && loaded.error.kind).toBe('not-found');
    expect(!loaded.ok && loaded.error.path).toBe(path.join(empty, TRACKED_AREAS_SCRIPT_NAME));
  });

  it('a module without the function is an unusable error naming it', () => {
    const dir = path.join(tmp, 'partial-leaf');
    const file = path.join(dir, TRACKED_AREAS_SCRIPT_NAME);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "'use strict';\nmodule.exports = {};\n", 'utf8');
    const loaded = loadTrackedAreas(dir);
    expect(!loaded.ok && loaded.error.kind).toBe('unusable');
    expect(!loaded.ok && loaded.error.kind === 'unusable' && loaded.error.detail).toMatch(/checkTrackedAreas/);
  });
});
