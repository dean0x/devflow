/**
 * no-permission-skip-in-hooks — no hook script passes a permission-skip flag, the
 * skip-all permission mode or an allow-list flag.
 *
 * The memory worker's write is limited to its staged file. `background-memory-update`
 * runs `claude -p` under `--permission-mode dontAsk` with user settings only, and passes
 * an Edit allow rule for the staged file and an Edit deny rule for every path under it
 * through `--settings`. A flag that skips the permission check, selects the skip-all
 * mode or pre-approves tools without limiting a path would widen that limit, so no file
 * under `src/assets/scripts/hooks/` spells one.
 *
 * What it asserts
 * ---------------
 * Every file under `src/assets/scripts/hooks/`, any depth and any extension (the hook
 * scripts are extensionless), holds none of the spellings in FORBIDDEN_ARGV
 * (tests/fixtures/forbidden-argv.ts). The same array backs the argv check in
 * tests/eager-memory-refresh.test.ts, so what the spawn passes and what the source
 * spells are held to one list. The scan is by substring and reads comments as well as
 * code: prose that names a flag is one edit from becoming the flag.
 *
 * Scope: the hook scripts, where the spawn lives. Other trees (the integration test
 * helpers, docs on what the platform offers) may spell these words.
 *
 * Non-vacuity: the scan must read a real corpus, including the two files that build the
 * spawn, and a literal planted in a throwaway copy of a hooks tree is reported by the
 * same collector while a clean file beside it is not. No committed file is touched.
 */

import { describe, it, expect } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';

import { ROOT, walkFiles } from '../helpers.js';
import { FORBIDDEN_ARGV } from '../fixtures/forbidden-argv.js';

const HOOKS_DIR = path.join(ROOT, 'src', 'assets', 'scripts', 'hooks');

interface ForbiddenHit {
  /** Relative to the scanned hooks directory, POSIX-spelled. */
  readonly file: string;
  readonly literal: string;
}

/** Named collector: every FORBIDDEN_ARGV spelling found in any file under a hooks directory. */
function collectForbiddenArgv(hooksDir: string): { filesScanned: string[]; hits: ForbiddenHit[] } {
  const files = walkFiles(hooksDir, () => true);
  const filesScanned = files.map(file => path.relative(hooksDir, file).split(path.sep).join('/'));
  const hits: ForbiddenHit[] = [];
  files.forEach((file, index) => {
    const content = readFileSync(file, 'utf-8');
    for (const literal of FORBIDDEN_ARGV) {
      if (content.includes(literal)) hits.push({ file: filesScanned[index], literal });
    }
  });
  return { filesScanned, hits };
}

describe('no hook script passes a permission-skip, skip-all mode or allow-list flag', () => {
  const scan = collectForbiddenArgv(HOOKS_DIR);

  it('the list is non-empty and every entry is a flag or a mode name', () => {
    expect(FORBIDDEN_ARGV.length, 'an empty list forbids nothing').toBeGreaterThan(0);
    for (const literal of FORBIDDEN_ARGV) {
      expect(literal.length, 'an empty entry matches every file').toBeGreaterThan(0);
    }
  });

  it('the scan reads the hooks tree, the worker and the helper that builds its settings included', () => {
    expect(
      scan.filesScanned.length,
      'src/assets/scripts/hooks/ produced too few files — the guard would pass by reading nothing',
    ).toBeGreaterThan(20);
    expect(scan.filesScanned).toContain('background-memory-update');
    expect(scan.filesScanned).toContain('memory-permission');
  });

  it('no file under src/assets/scripts/hooks/ spells one', () => {
    const found = scan.hits.map(h => `${h.file}: ${h.literal}`);
    expect(
      found,
      'a hook script spells a permission-skip flag, the skip-all mode or an allow-list flag; ' +
      'the memory worker\'s write is limited to its staged file by `--permission-mode dontAsk`, ' +
      'user settings only, an Edit allow rule and an Edit deny rule:\n  ' + found.join('\n  '),
    ).toEqual([]);
  });

  it('known-bad probe: a literal planted in a throwaway hooks tree is reported, a clean file is not', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'devflow-permission-skip-probe-'));
    try {
      mkdirSync(path.join(dir, 'lib'));
      writeFileSync(path.join(dir, 'clean-hook'), '#!/bin/bash\nclaude -p --permission-mode dontAsk\n');
      const clean = collectForbiddenArgv(dir);
      expect(clean.filesScanned, 'the probe tree must be read').toEqual(['clean-hook']);
      expect(clean.hits, 'a file with none of the spellings must not be reported').toEqual([]);

      // One plant per spelling, each in a different place: an extensionless script, a
      // nested helper and a comment line, so a scan narrowed by extension, depth or
      // comment-skipping stops seeing the plant and this row goes red.
      const plants = FORBIDDEN_ARGV.map((literal, i) => {
        const shapes: ReadonlyArray<readonly [string, string]> = [
          [`planted-hook-${i}`, `claude -p ${literal}\n`],
          [path.join('lib', `planted-${i}.cjs`), `const args = ['${literal}'];\n`],
          [`planted-comment-${i}`, `# ${literal} would widen the limit\n`],
        ];
        const [file, content] = shapes[i % shapes.length];
        return [literal, file, content] as const;
      });
      for (const [, file, content] of plants) writeFileSync(path.join(dir, file), content);

      const planted = collectForbiddenArgv(dir);
      for (const [literal] of plants) {
        expect(
          planted.hits.map(h => h.literal),
          `a planted "${literal}" must be reported`,
        ).toContain(literal);
      }
      expect(
        planted.hits.map(h => h.file),
        'the clean file stays unreported beside the planted ones',
      ).not.toContain('clean-hook');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
