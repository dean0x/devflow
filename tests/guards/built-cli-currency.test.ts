/**
 * `requireBuiltCli` reports a STALE dist, not merely an absent one.
 *
 * tests/guards/literal-agent-paths.test.ts owns the ABSENCE contract — throws with
 * a build hint when `dist/cli.js` is not there. This file owns the other half, and
 * the two are different claims: existence is not currency. `requireBuiltCli` gates
 * the only executable coverage of a `devflow` action BODY, so a `dist/cli.js` older
 * than the sources it was compiled from means every subprocess suite downstream
 * certifies a build nobody is shipping — PF-018's first mechanism in its quietest
 * form, where the target exists but is not the one under review.
 *
 * Every arm is HERMETIC: temp roots with hand-stamped mtimes, never the real tree.
 * A probe that measured the repo's own `dist/` would be green or red according to
 * whether somebody had just built, which is the property under test rather than a
 * precondition for testing it. Stamping the times with `utimesSync` also keeps the
 * arms off any sleep — a currency check compared with `<` needs an ORDER, not a
 * delay, and a test that waited for the clock would be the flake PF-055 describes.
 *
 * The `src/assets` arm is the false-positive half, and it is the one that decides
 * whether this check can live in the suite at all. Agent prompts, skills, commands
 * and hooks under `src/assets` are edited constantly and are COPIED rather than
 * compiled, so if a prose edit there read as a stale CLI the check would be red for
 * most of any working day and would be deleted within the week.
 */

import { describe, it, expect } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';

import { requireBuiltCli } from '../helpers.js';

/** Fixed epoch seconds, oldest first. An order, never a wall-clock wait. */
const OLD = 1_700_000_000;
const NEW = 1_700_001_000;

/** Write `file` (creating its parents) and stamp its mtime. */
function writeAt(file: string, mtime: number): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, '// probe\n');
  utimesSync(file, mtime, mtime);
}

/**
 * Build a hermetic root, hand it to `body`, and remove it.
 *
 * `sources` is a map of repo-relative path to mtime; `cli` is the `dist/cli.js`
 * mtime, or null to leave the artifact out entirely.
 */
function withRoot(
  sources: Readonly<Record<string, number>>,
  cli: number | null,
  body: (root: string) => void,
): void {
  const root = mkdtempSync(path.join(tmpdir(), 'devflow-cli-currency-'));
  try {
    for (const [rel, mtime] of Object.entries(sources)) {
      writeAt(path.join(root, ...rel.split('/')), mtime);
    }
    if (cli !== null) writeAt(path.join(root, 'dist', 'cli.js'), cli);
    body(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe('requireBuiltCli currency contract', () => {
  it('GREEN: a dist compiled after every source resolves to the artifact', () => {
    withRoot({ 'src/cli.ts': OLD, 'src/core/tracker.ts': OLD }, NEW, root => {
      expect(requireBuiltCli(root)).toBe(path.join(root, 'dist', 'cli.js'));
    });
  });

  it('RED: a source modified after the build is reported, naming the file and the build step', () => {
    withRoot({ 'src/cli.ts': OLD, 'src/core/tracker.ts': NEW }, OLD, root => {
      expect(() => requireBuiltCli(root)).toThrow(/dist\/cli\.js is STALE/);
      expect(() => requireBuiltCli(root)).toThrow(/npm run build/);
      // The offender is NAMED. "Something is stale" sends a reader to rebuild and
      // guess; the path says which edit the artifact has not caught up with.
      expect(() => requireBuiltCli(root)).toThrow(/src[/\\]core[/\\]tracker\.ts/);
    });
  });

  it('a source edited in the same instant as the build is NOT stale — the compare is strict', () => {
    // `tsc` writes its outputs while the clock is still on the edit's second on a
    // coarse filesystem. Equal-time must resolve, or the check reports the build
    // that just ran.
    withRoot({ 'src/cli.ts': NEW }, NEW, root => {
      expect(requireBuiltCli(root)).toBe(path.join(root, 'dist', 'cli.js'));
    });
  });

  it('a `src/assets` edit is NOT a stale CLI — that tree is copied, never compiled', () => {
    // The false-positive arm. tsconfig.json excludes `src/assets`, and this is where
    // the agent prompts, skills, commands and hooks live: if editing one read as a
    // stale CLI, every subprocess suite would be red for most of a working day.
    withRoot(
      { 'src/cli.ts': OLD, 'src/assets/skills/git/SKILL.md': NEW, 'src/assets/scripts/hooks/preamble': NEW },
      1_700_000_500,
      root => {
        expect(requireBuiltCli(root)).toBe(path.join(root, 'dist', 'cli.js'));
      },
    );
  });

  it('a compile input NESTED below the top level is still read', () => {
    // The scan is recursive or it is theatre: `src/cli/commands/` and
    // `src/targets/claude-code/` are where most of the CLI actually lives, and a
    // one-level scan would be green for every edit that matters.
    withRoot({ 'src/targets/claude-code/post-install.ts': NEW }, OLD, root => {
      expect(() => requireBuiltCli(root)).toThrow(/post-install\.ts/);
    });
  });

  it('a `src/` holding no compile input is REPORTED, not passed over (PF-018)', () => {
    // A scan that goes empty stops guarding and says nothing — the second mechanism
    // PF-018 records. A source tree with no `.ts` is not a tree this check can make
    // any claim about, so it refuses rather than returning.
    withRoot({ 'src/assets/skills/git/SKILL.md': NEW }, OLD, root => {
      expect(() => requireBuiltCli(root)).toThrow(/holds no \.ts\/\.json compile input/);
    });
  });

  it('a hermetic root with no `src/` at all resolves — absence is its only claim', () => {
    // What the temp roots in the ABSENCE contract next door look like: they carry a
    // `dist/` and nothing else, and there is nothing for them to be stale against.
    withRoot({}, OLD, root => {
      expect(requireBuiltCli(root)).toBe(path.join(root, 'dist', 'cli.js'));
    });
  });

  it('absence still outranks currency — a missing artifact is reported as missing', () => {
    // Ordering matters for the message: "STALE" over an artifact that is not there
    // would send a reader looking for a file to compare.
    withRoot({ 'src/cli.ts': NEW }, null, root => {
      expect(() => requireBuiltCli(root)).toThrow(/dist\/cli\.js is absent/);
    });
  });
});
