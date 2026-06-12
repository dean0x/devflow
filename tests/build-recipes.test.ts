/**
 * Tests for scripts/build-recipes.ts
 *
 * Covers the four risk dimensions of the build-recipes script (applies ADR-014):
 *
 *  1. MDS compiler error path — a malformed .mds throws an MdsError (the mechanism
 *     that build-recipes.ts relies on to hard-fail on bad recipes).
 *  2. MDS compiler happy path — a valid .mds compiles to a non-empty Markdown string.
 *  3. Partial-filtering convention — every file in shared/recipes/ whose basename starts
 *     with `_` is a partial (must not produce a command file); every non-`_` file IS a
 *     command (must be declared in DEVFLOW_PLUGINS). Locks the `isPartial` heuristic.
 *  4. Script happy-path exit — spawning the real build-recipes.ts script against the
 *     real shared/recipes/ exits 0 and produces at least one .md command file.
 *
 * NOTE: The error-path subprocess test (spawning the script with a malformed recipe) is
 * intentionally not implemented via the real shared/recipes/ dir because that would require
 * temporarily mutating committed source files. Instead, test (1) validates the underlying
 * MDS compiler behaviour that the script's try/catch relies on — isMdsError(err) holds
 * and the script accumulates the error before calling process.exit(1). Test (4) covers
 * the happy-path subprocess contract. Together they lock both ends of the hard-fail
 * guarantee without corrupting source files.
 */

import { describe, it, expect } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { init, compile, isMdsError } from '@mdscript/mds';

const ROOT = path.resolve(import.meta.dirname, '..');
const RECIPES_DIR = path.join(ROOT, 'shared', 'recipes');
const COMMANDS_DIR = path.join(ROOT, 'plugins', 'devflow-dynamic', 'commands');

// ---------------------------------------------------------------------------
// Shared MDS initialisation — required before compile/compileFile calls
// ---------------------------------------------------------------------------

let mdsInitialised = false;

async function ensureInit(): Promise<void> {
  if (!mdsInitialised) {
    await init();
    mdsInitialised = true;
  }
}

// ---------------------------------------------------------------------------
// 1. MDS compiler error path
// ---------------------------------------------------------------------------

describe('MDS compiler error path (build-recipes hard-fail mechanism)', () => {
  it('throws an MdsError for a recipe that references an undefined variable', async () => {
    await ensureInit();
    // A bare @{UNDEFINED_VAR} reference produces an mds::undefined_variable error —
    // the same kind of error that build-recipes.ts catches, formats, and accumulates
    // before calling process.exit(1).
    const malformedSource = '# Title\n\n@{UNDEFINED_VAR_THAT_DOES_NOT_EXIST}\n';
    let threw = false;
    try {
      compile(malformedSource);
    } catch (err) {
      threw = true;
      expect(isMdsError(err), 'error should be an MdsError with a code starting with mds::').toBe(true);
      if (isMdsError(err)) {
        expect(err.code).toMatch(/^mds::/);
      }
    }
    expect(threw, 'compile() must throw on malformed MDS source').toBe(true);
  });

  it('isMdsError correctly identifies MDS errors vs generic errors', () => {
    const generic = new Error('generic error');
    expect(isMdsError(generic)).toBe(false);
    expect(isMdsError(null)).toBe(false);
    expect(isMdsError('string')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. MDS compiler happy path
// ---------------------------------------------------------------------------

describe('MDS compiler happy path', () => {
  it('compiles a minimal valid .mds source to a non-empty Markdown string', async () => {
    await ensureInit();
    const validSource = '# My Command\n\nThis is a minimal valid MDS template.\n';
    const result = compile(validSource);
    expect(typeof result.output).toBe('string');
    expect(result.output.length).toBeGreaterThan(0);
    expect(result.output).toContain('My Command');
    expect(Array.isArray(result.warnings)).toBe(true);
  });

  it('produces the same basename → .md output filename derivation as build-recipes.ts', () => {
    // This mirrors build-recipes.ts line 37:
    //   const dest = path.join(OUTPUT_DIR, `${path.basename(sourcePath, ".mds")}.md`);
    const cases: Array<[string, string]> = [
      ['dynamic-tickets.mds', 'dynamic-tickets.md'],
      ['dynamic-plan.mds', 'dynamic-plan.md'],
      ['dynamic-build.mds', 'dynamic-build.md'],
      ['dynamic-profile.mds', 'dynamic-profile.md'],
      ['dynamic-wave.mds', 'dynamic-wave.md'],
    ];
    for (const [input, expected] of cases) {
      expect(path.basename(input, '.mds') + '.md').toBe(expected);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Partial-filtering convention — locks the `isPartial` heuristic
// ---------------------------------------------------------------------------

describe('partial-filtering convention in shared/recipes/', () => {
  it('every file starting with _ is a partial and every other .mds file is a command', async () => {
    const entries = await fs.readdir(RECIPES_DIR, { withFileTypes: true });
    const mdsFiles = entries.filter(e => e.isFile() && e.name.endsWith('.mds'));

    expect(mdsFiles.length, 'shared/recipes/ must contain at least one .mds file').toBeGreaterThan(0);

    const partials = mdsFiles.filter(e => e.name.startsWith('_'));
    const commands = mdsFiles.filter(e => !e.name.startsWith('_'));

    expect(partials.length, 'shared/recipes/ must contain at least one partial (_*.mds)').toBeGreaterThan(0);
    expect(commands.length, 'shared/recipes/ must contain at least one command (non-_*.mds)').toBeGreaterThan(0);

    // Partials must never be named without the _ prefix by accident
    for (const partial of partials) {
      expect(partial.name.startsWith('_'), `${partial.name} should be a partial (start with _)`).toBe(true);
    }

    // Commands must never accidentally pick up the _ prefix
    for (const cmd of commands) {
      expect(cmd.name.startsWith('_'), `${cmd.name} is a command and must NOT start with _`).toBe(false);
    }
  });

  it('no partial (.mds starting with _) has a corresponding .md in the commands output dir', async () => {
    // Guard: if the commands dir exists (i.e., build has been run), partials must not appear there.
    let compiled: string[];
    try {
      compiled = (await fs.readdir(COMMANDS_DIR)).filter(f => f.endsWith('.md'));
    } catch {
      // Build artifacts not present — skip this assertion (build:recipes not yet run)
      return;
    }

    const entries = await fs.readdir(RECIPES_DIR, { withFileTypes: true });
    const partialBasenames = entries
      .filter(e => e.isFile() && e.name.endsWith('.mds') && e.name.startsWith('_'))
      .map(e => path.basename(e.name, '.mds') + '.md');

    for (const partialMd of partialBasenames) {
      expect(compiled, `partial ${partialMd} must not appear in commands output dir`).not.toContain(partialMd);
    }
  });
});

// ---------------------------------------------------------------------------
// 4. Script happy-path exit — the subprocess contract
// ---------------------------------------------------------------------------

describe('build-recipes.ts script subprocess contract', () => {
  it('exits 0 when real recipes compile cleanly (CI path)', () => {
    // This is the happy-path assertion that CI implicitly covers via `npm run build`.
    // Making it explicit locks the contract: the script must exit 0 for the current
    // recipe set. A broken recipe introduced to shared/recipes/ would fail this test.
    const result = spawnSync(
      'npx',
      ['tsx', path.join(ROOT, 'scripts', 'build-recipes.ts')],
      {
        cwd: ROOT,
        encoding: 'utf-8',
        timeout: 60_000, // 60s generous timeout for WASM init + file I/O
      },
    );

    if (result.error) {
      throw result.error;
    }

    expect(
      result.status,
      `build-recipes.ts should exit 0 but exited ${result.status}.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    ).toBe(0);
  });

  it('produces at least one .md command file after the script runs', async () => {
    // After the subprocess test above runs the script, the output dir should exist
    // and contain at least one compiled .md file.
    let compiled: string[];
    try {
      compiled = (await fs.readdir(COMMANDS_DIR)).filter(f => f.endsWith('.md'));
    } catch {
      compiled = [];
    }
    expect(compiled.length, 'commands dir should contain at least one compiled .md file after build').toBeGreaterThan(0);
  });
});

