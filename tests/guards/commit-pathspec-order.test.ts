/**
 * Commit pathspec-order guard.
 *
 * `git commit --only -- <paths> -m "<msg>"` does not commit: everything after `--`
 * is a pathspec, so git reads `-m` and the message as two more paths and fails with
 * `error: pathspec '-m' did not match any file(s) known to git`. The working form
 * puts every option before the separator: `git commit --only -m "<msg>" -- <paths>`.
 *
 * The Knowledge agent and the Git agent's setup-task both hand the model a scoped
 * `commit --only` recipe, and both are non-blocking — a failed commit is reported as
 * `KB_COMMIT: failed` / `CONVENTIONS_COMMIT: failed` and the run carries on, so a
 * misordered recipe never surfaces as a broken pipeline. This guard is what notices.
 *
 * It scans `src/assets/` rather than `dist/`: dist is compiled from src, so the src
 * scan sees the same text one step earlier and cannot be satisfied by a stale build.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import * as path from 'path';

import { ROOT, walkFiles } from '../helpers.js';

/**
 * A `git … commit` command in which a message option follows the `--` separator.
 * The separator is matched only as a standalone word (`\s--\s`), so `--only`,
 * `--message` and `--` inside a longer flag are not mistaken for it. The span stops
 * at a backtick or newline: one inline-code command, never two joined by prose.
 */
const MESSAGE_AFTER_SEPARATOR_RE = /\bcommit\b[^`\n]*\s--\s[^`\n]*\s(?:-m|--message)(?:[\s=]|$)/;

const SCANNED_EXTENSIONS: readonly string[] = ['.md', '.mds'];

interface Site {
  readonly file: string;
  readonly line: number;
  readonly text: string;
}

/** Named collector: every commit recipe under a root that puts `-m` after `--`. */
function collectMisorderedCommits(dir: string): { filesScanned: number; sites: Site[] } {
  const files = walkFiles(dir, file => SCANNED_EXTENSIONS.some(ext => file.endsWith(ext)));
  const sites: Site[] = [];
  for (const file of files) {
    const rel = path.relative(ROOT, file).split(path.sep).join('/');
    readFileSync(file, 'utf-8').split('\n').forEach((text, index) => {
      if (MESSAGE_AFTER_SEPARATOR_RE.test(text)) {
        sites.push({ file: rel, line: index + 1, text: text.trim() });
      }
    });
  }
  return { filesScanned: files.length, sites };
}

describe('commit recipes place -m before the -- pathspec separator', () => {
  it('the Knowledge agent commits its two files with the message before the pathspec', () => {
    const knowledge = readFileSync(path.join(ROOT, 'src', 'assets', 'agents', 'knowledge.md'), 'utf-8');
    const step = knowledge.split('\n').find(line => line.includes('**Commit only those paths**'));
    expect(step, 'knowledge.md: the "Commit only those paths" step is missing').toBeDefined();

    const command = /`(git -C "\{worktree\}" commit --only [^`]+)`/.exec(step ?? '')?.[1] ?? '';
    const message = command.indexOf(' -m ');
    const separator = command.indexOf(' -- ');
    expect(
      message !== -1 && separator !== -1 && message < separator,
      `knowledge.md: the commit must read \`commit --only -m "<msg>" -- <paths>\` — after \`--\` ` +
      `git treats -m as a path and the commit fails. Got: ${command}`,
    ).toBe(true);
    expect(command.slice(separator + 4)).toBe(
      '.devflow/features/index.md .devflow/features/{slug}/KNOWLEDGE.md',
    );
  });

  it('no commit recipe in src/assets/ puts -m after --', () => {
    const scan = collectMisorderedCommits(path.join(ROOT, 'src', 'assets'));
    expect(
      scan.filesScanned,
      'src/assets/ produced no scannable files — the guard would pass by reading nothing',
    ).toBeGreaterThan(50);
    const found = scan.sites.map(s => `${s.file}:${s.line}  ${s.text}`);
    expect(
      found,
      'commit recipe(s) with -m after the `--` separator — move every option before `--`:\n  ' +
      found.join('\n  '),
    ).toEqual([]);
  });

  it('known-bad probe: the pattern reads the broken shapes and passes the working ones', () => {
    const broken: ReadonlyArray<readonly [string, string]> = [
      ['knowledge shape', '`git -C "{worktree}" commit --only -- a.md b.md -m "docs: x"`'],
      ['conventions shape', '`git -C "{worktree}" commit --only -- .devflow/conventions.md -m "docs(devflow): x"`'],
      ['long option', 'git commit -- a.md --message="x"'],
    ];
    const missed = broken.filter(([, text]) => !MESSAGE_AFTER_SEPARATOR_RE.test(text)).map(([l]) => l);
    expect(missed, `broken shape(s) the pattern no longer reads:\n  ${missed.join('\n  ')}`).toEqual([]);

    const working: ReadonlyArray<readonly [string, string]> = [
      ['message first', '`git -C "{worktree}" commit --only -m "docs: x" -- a.md b.md`'],
      ['no separator', 'git commit --only tracker.md -m "x"'],
      ['separator on a different command', '`git add -- a.md` then `git commit -m "x"`'],
      ['stage step', '`git -C "{worktree}" add -- .devflow/conventions.md`'],
    ];
    const flagged = working.filter(([, text]) => MESSAGE_AFTER_SEPARATOR_RE.test(text)).map(([l]) => l);
    expect(flagged, `working shape(s) reported as broken:\n  ${flagged.join('\n  ')}`).toEqual([]);
  });
});
