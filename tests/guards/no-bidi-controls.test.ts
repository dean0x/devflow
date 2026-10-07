/**
 * no-bidi-controls — no raw bidirectional control character in the source or
 * test trees.
 *
 * A bidirectional control character changes how the text after it is DISPLAYED
 * without changing what a compiler, an interpreter or a test runner reads. An
 * editor, a terminal and a diff render it as nothing, so a reviewer cannot see
 * it, and in code it can make a line read differently from what runs. A test
 * that needs one as data spells it as a JavaScript escape sequence: a
 * backslash, the letter u and the four hex digits of the code point. The value
 * at run time is the same, and the escape stays visible in review.
 *
 * How one gets in: an escape sequence typed into an agent's Edit or Write call
 * is decoded on the way to the file, so the file receives the raw character
 * while the test it sits in stays green. Make such an edit with a script that
 * builds the backslash itself, then check the written bytes.
 *
 * What it asserts
 * ---------------
 * The file list is the worktree as git lists it, tracked files plus untracked,
 * unignored ones, under `src/` and `tests/`, so a new file is checked before
 * anyone stages it. A file holding a NUL byte is binary and is not read; the
 * files skipped that way must be exactly BINARY_FILES (none today), so a file
 * the scan stops reading turns an arm red instead of leaving a silent gap.
 * Every other regular file is read as UTF-8, and each raw code point in
 * BIDI_CONTROLS is reported with its file, line, column and name.
 * BIDI_CONTROLS is pinned to the code points Unicode gives the Bidi_Control
 * property: U+061C, U+200E, U+200F, U+202A to U+202E and U+2066 to U+2069.
 *
 * Non-vacuity: a known-bad probe for every code point under each tree, each
 * character built at run time with String.fromCodePoint and never written into
 * this file; a known-good probe holding only escape text; and reach, per tree
 * and for this file itself.
 *
 * What a green run does NOT prove
 * -------------------------------
 * Files outside `src/` and `tests/` are not read: `docs/`, `scripts/`, the root
 * prose, CI workflows. A symbolic link is not followed. A file in an encoding
 * other than UTF-8 is still read as UTF-8, so a bidi control in UTF-16 text
 * does not decode as one. Other invisible characters (a zero-width space, a
 * line or paragraph separator, a byte-order mark) do not reorder text and are
 * not reported. A character a program builds at run time, as this file's
 * probes do, is not in the text and is not seen.
 */

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import { lstatSync, readFileSync } from 'fs';
import * as path from 'path';

import { ROOT, type CorpusEntry } from '../helpers.js';

// ---------------------------------------------------------------------------
// The rule
// ---------------------------------------------------------------------------

interface BidiControl {
  readonly codePoint: number;
  /** The Unicode character name, for the failure message. */
  readonly name: string;
}

/** Every code point Unicode gives the Bidi_Control property; an arm below pins the table to it. */
const BIDI_CONTROLS: readonly BidiControl[] = [
  { codePoint: 0x061c, name: 'ARABIC LETTER MARK' },
  { codePoint: 0x200e, name: 'LEFT-TO-RIGHT MARK' },
  { codePoint: 0x200f, name: 'RIGHT-TO-LEFT MARK' },
  { codePoint: 0x202a, name: 'LEFT-TO-RIGHT EMBEDDING' },
  { codePoint: 0x202b, name: 'RIGHT-TO-LEFT EMBEDDING' },
  { codePoint: 0x202c, name: 'POP DIRECTIONAL FORMATTING' },
  { codePoint: 0x202d, name: 'LEFT-TO-RIGHT OVERRIDE' },
  { codePoint: 0x202e, name: 'RIGHT-TO-LEFT OVERRIDE' },
  { codePoint: 0x2066, name: 'LEFT-TO-RIGHT ISOLATE' },
  { codePoint: 0x2067, name: 'RIGHT-TO-LEFT ISOLATE' },
  { codePoint: 0x2068, name: 'FIRST STRONG ISOLATE' },
  { codePoint: 0x2069, name: 'POP DIRECTIONAL ISOLATE' },
];

const NAMES: ReadonlyMap<number, string> = new Map(BIDI_CONTROLS.map(c => [c.codePoint, c.name]));

/**
 * The matcher: a character class of the table's characters, built at run time
 * so this file never holds one raw. Used only through matchAll, which copies
 * the expression, so the global flag's lastIndex never carries between calls.
 */
const BIDI_CONTROL = new RegExp(`[${BIDI_CONTROLS.map(c => String.fromCodePoint(c.codePoint)).join('')}]`, 'gu');

const REMEDY =
  'write each character as a JavaScript escape sequence (a backslash, u and the four hex digits): ' +
  'the run-time value is the same and a reviewer can see it. Make the edit with a script that builds ' +
  'the backslash itself, because an escape typed into an Edit or Write call lands as the raw character';

/** The trees the guard reads, in report order. */
const TREES = [
  { id: 'src', prefix: 'src/' },
  { id: 'tests', prefix: 'tests/' },
] as const;

type Tree = (typeof TREES)[number]['id'];

/** The tree a repo-relative path belongs to, or undefined when the guard does not read it. */
function treeOf(rel: string): Tree | undefined {
  return TREES.find(t => rel.startsWith(t.prefix))?.id;
}

interface BidiViolation {
  tree: Tree;
  path: string;
  line: number;
  /** 1-based, in UTF-16 code units, as editors count. */
  column: number;
  codePoint: number;
}

/** `U+XXXX`. */
function notation(codePoint: number): string {
  return `U+${codePoint.toString(16).toUpperCase().padStart(4, '0')}`;
}

function lineOf(content: string, offset: number): number {
  let line = 1;
  for (let i = content.indexOf('\n'); i !== -1 && i < offset; i = content.indexOf('\n', i + 1)) line++;
  return line;
}

/**
 * Named collector: every raw bidi control in `corpus`, routed by `treeOf`, with
 * its file, line and column. Pure — the live arms and the seeded probes run it.
 */
function collectBidiControls(corpus: readonly CorpusEntry[]): BidiViolation[] {
  const found: BidiViolation[] = [];
  for (const entry of corpus) {
    const tree = treeOf(entry.path);
    if (tree === undefined) continue;
    for (const m of entry.content.matchAll(BIDI_CONTROL)) {
      const codePoint = m[0].codePointAt(0);
      if (codePoint === undefined) continue;
      const lineStart = entry.content.lastIndexOf('\n', m.index - 1) + 1;
      found.push({ tree, path: entry.path, line: lineOf(entry.content, m.index), column: m.index - lineStart + 1, codePoint });
    }
  }
  return found.sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line || a.column - b.column);
}

function formatViolation(v: BidiViolation): string {
  return `${v.path}:${v.line}:${v.column}: raw ${notation(v.codePoint)} ${NAMES.get(v.codePoint) ?? 'unnamed'}`;
}

// ---------------------------------------------------------------------------
// Corpus
// ---------------------------------------------------------------------------

const MAX_LISTING_BYTES = 16 * 1024 * 1024;

/** Tracked files plus untracked, unignored ones, as git lists them at the repo root. */
function listWorktreeFiles(): string[] {
  const listing = execFileSync(
    'git',
    ['-c', 'core.fsmonitor=false', 'ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: MAX_LISTING_BYTES },
  );
  return [...new Set(listing.split('\0').filter(rel => rel !== ''))];
}

/** A listed file's bytes, or undefined when it is gone from the worktree or is not a regular file. */
function readBytes(rel: string): Buffer | undefined {
  const abs = path.join(ROOT, rel);
  try {
    if (!lstatSync(abs).isFile()) return undefined;
    return readFileSync(abs);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw err;
  }
}

/**
 * Listed files under `src/` or `tests/` the scan skips because they hold a NUL
 * byte. None today: every file in both trees is text. A binary file that lands
 * there is named here, so the files the guard does not read stay a reviewed list.
 */
const BINARY_FILES: readonly string[] = [];

const corpus: CorpusEntry[] = [];
const skippedAsBinary: string[] = [];
for (const rel of listWorktreeFiles().filter(f => treeOf(f) !== undefined)) {
  const bytes = readBytes(rel);
  if (bytes === undefined) continue;
  if (bytes.includes(0)) skippedAsBinary.push(rel);
  else corpus.push({ path: rel, content: bytes.toString('utf8') });
}

/** This file, as the corpus spells its path. */
const SELF = path.relative(ROOT, import.meta.filename).split(path.sep).join('/');

let liveViolations: BidiViolation[] | undefined;
function violationsIn(tree: Tree): string[] {
  liveViolations ??= collectBidiControls(corpus);
  return liveViolations.filter(v => v.tree === tree).map(formatViolation);
}

// ---------------------------------------------------------------------------
// Live arms
// ---------------------------------------------------------------------------

describe('no raw bidirectional control character in the source or test trees', () => {
  for (const tree of TREES) {
    it(`${tree.prefix}** holds none`, () => {
      expect(violationsIn(tree.id), REMEDY).toEqual([]);
    });
  }
});

describe('no-bidi-controls guard: corpus reach', () => {
  for (const tree of TREES) {
    it(`reads the files under ${tree.prefix}`, () => {
      expect(
        corpus.filter(e => treeOf(e.path) === tree.id).length,
        `no file under ${tree.prefix} was read — the arm would pass over nothing`,
      ).toBeGreaterThan(0);
    });
  }

  it('reads this file, so the guard is held to its own rule', () => {
    expect(corpus.map(e => e.path)).toContain(SELF);
  });

  it('skips as binary exactly the files named in BINARY_FILES', () => {
    expect(
      skippedAsBinary,
      'a listed file under src/ or tests/ holds a NUL byte, so the scan does not read it and a bidi ' +
      'control in it would pass unseen. If the file really is binary, name it in BINARY_FILES',
    ).toEqual([...BINARY_FILES]);
  });
});

// ---------------------------------------------------------------------------
// Seeded probes: red on every code point under each tree, green on escape text,
// on invisible characters that are not bidi controls, and outside both trees.
// ---------------------------------------------------------------------------

describe('no-bidi-controls guard: seeded probes', () => {
  const BACKSLASH = String.fromCharCode(0x5c);
  /** The escape text a test writes instead of the raw character, built here so this file holds none. */
  const escapeOf = (codePoint: number): string => `${BACKSLASH}u${codePoint.toString(16).padStart(4, '0')}`;
  const PREFIX = "const s = 'a";

  for (const tree of TREES) {
    const file = `${tree.prefix}example.ts`;
    for (const control of BIDI_CONTROLS) {
      it(`reports a raw ${notation(control.codePoint)} under ${tree.prefix}`, () => {
        const content = `${PREFIX}${String.fromCodePoint(control.codePoint)}b';\n`;
        expect(collectBidiControls([{ path: file, content }]).map(formatViolation)).toEqual([
          `${file}:1:${PREFIX.length + 1}: raw ${notation(control.codePoint)} ${control.name}`,
        ]);
      });
    }
  }

  it('names the line and column of every character, not only the first on a line', () => {
    const rlo = String.fromCodePoint(0x202e);
    const lri = String.fromCodePoint(0x2066);
    const content = `one\ntwo\n  x${rlo}y${lri}z\n`;
    expect(collectBidiControls([{ path: 'tests/example.test.ts', content }]).map(formatViolation)).toEqual([
      'tests/example.test.ts:3:4: raw U+202E RIGHT-TO-LEFT OVERRIDE',
      'tests/example.test.ts:3:6: raw U+2066 LEFT-TO-RIGHT ISOLATE',
    ]);
  });

  it('passes the escape text a test writes instead', () => {
    const content = BIDI_CONTROLS.map(c => `${PREFIX}${escapeOf(c.codePoint)}b';\n`).join('');
    expect(content.length, 'the escape probe must hold text').toBeGreaterThan(0);
    expect(collectBidiControls(TREES.map(t => ({ path: `${t.prefix}example.ts`, content }))).map(formatViolation)).toEqual([]);
  });

  it('passes invisible characters that are not bidi controls, and right-to-left letters', () => {
    // A zero-width space, the line and paragraph separators, a byte-order mark
    // and a no-break space do not reorder text; Hebrew and Arabic letters are
    // right-to-left text, not controls. Tests hold all of them as data.
    const others = [0x200b, 0x2028, 0x2029, 0xfeff, 0x00a0, 0x05d0, 0x0627].map(cp => String.fromCodePoint(cp)).join('');
    expect(collectBidiControls([{ path: 'tests/example.test.ts', content: `${PREFIX}${others}b';\n` }]).map(formatViolation)).toEqual([]);
  });

  it('reads nothing outside src/ and tests/', () => {
    const content = `a${String.fromCodePoint(0x202e)}b\n`;
    const outside = ['docs/example.md', 'scripts/example.ts', 'CHANGELOG.md', '.github/workflows/example.yml', 'srcx/example.ts', 'testsuite/example.ts'];
    expect(collectBidiControls(outside.map(p => ({ path: p, content }))).map(formatViolation)).toEqual([]);
  });

  it('the table is every code point Unicode gives the Bidi_Control property', () => {
    const property = /\p{Bidi_Control}/u;
    const expected: number[] = [];
    for (let cp = 0; cp <= 0x10ffff; cp++) {
      if (cp >= 0xd800 && cp <= 0xdfff) continue;
      if (property.test(String.fromCodePoint(cp))) expected.push(cp);
    }
    expect(BIDI_CONTROLS.map(c => notation(c.codePoint))).toEqual(expected.map(notation));
  });
});
