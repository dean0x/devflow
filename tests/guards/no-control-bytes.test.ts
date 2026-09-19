/**
 * no-control-bytes — no shipped source file carries a RAW control byte.
 *
 * Why this is a guard and not a style preference
 * ----------------------------------------------
 * A character class written with literal control bytes (`/[<NUL>-<US><DEL>]/`)
 * behaves identically to the same class written with escapes — and makes the file
 * invisible to every grep-based guard in the repo. `grep` classifies a file
 * holding a NUL as binary, prints `Binary file matches` instead of the matching
 * lines, and `grep -c` reports nothing at all. Every repo-wide sweep over
 * `src/core/` then skips that file SILENTLY: the sweep still exits 0, still
 * reports "no violations", and the file it could not read is the one file a
 * reviewer would most want swept (this is PF-018's shape — a green check that
 * exercises nothing — arrived at through the corpus rather than the matcher).
 *
 * The escaped spelling is also the only reviewable one: a raw US or DEL byte in a
 * diff renders as nothing, so a byte added to or removed from the class is an
 * invisible change to a security-relevant sanitiser.
 *
 * Scope: every shipped source file under `src/` — the typed sources, the prompt
 * assets (`.md`/`.mds`), the Node scripts (`.cjs`/`.js`), the JSON, and the
 * extension-less shell hooks under `src/assets/scripts/`. `tests/` is outside the
 * scan by construction: fixtures legitimately seed hostile bytes, and this file's
 * own known-bad probe is one of them.
 *
 * Tab (0x09), LF (0x0A) and CR (0x0D) are excluded — they are ordinary text.
 * Everything else below 0x20, plus DEL (0x7F), is a violation.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import * as path from 'path';

import { scriptsDir } from '../../src/core/assets.js';
import { ROOT, walkFiles, type CorpusEntry } from '../helpers.js';

// ---------------------------------------------------------------------------
// Corpus
// ---------------------------------------------------------------------------

const SRC_DIR = path.join(ROOT, 'src');
const SCRIPTS_DIR = scriptsDir();

/** Extensions whose files are shipped source we author by hand. */
const SCANNED_EXTENSIONS: readonly string[] = ['.ts', '.md', '.mds', '.cjs', '.js', '.json'];

/**
 * A shell hook (`session-start-context`, `queue-append`, …) has no extension, so
 * the extension list cannot reach it. Accept extension-less files, but only under
 * `src/assets/scripts/` — that is where every such file lives, and an
 * extension-less file elsewhere under `src/` would be a binary asset.
 */
function isScannedFile(file: string): boolean {
  if (SCANNED_EXTENSIONS.includes(path.extname(file))) return true;
  return path.extname(file) === '' && file.startsWith(SCRIPTS_DIR + path.sep);
}

function scanCorpus(): CorpusEntry[] {
  return walkFiles(SRC_DIR, isScannedFile).map(file => ({
    path: path.relative(ROOT, file),
    // latin1 so every byte survives as one code unit: a UTF-8 decode would
    // replace an invalid sequence and could mask the very byte being hunted.
    content: readFileSync(file).toString('latin1'),
  }));
}

/** How the extension-less hook class is spelled in a reach report. */
const EXTENSIONLESS_CLASS = '(extension-less, under src/assets/scripts/)';

/**
 * Classes `isScannedFile` admits that the tree holds no member of today.
 *
 * `.js` is declared so a hand-authored Node script landing beside the `.cjs`
 * hooks is scanned from its first commit rather than after someone notices. The
 * tree has no `.js` file under `src/`, so the reach check cannot demand one.
 *
 * A NAMED list rather than a deletion from the declaration, and asserted below
 * to be genuinely unpopulated: the day a `.js` file lands, the entry goes red and
 * must be deleted, which restores the reach demand. An entry parked here that DOES
 * have members would be an exemption hiding real coverage — the prohibition and
 * its exemption registry are one authority (PF-067), so the exemption has to be
 * as falsifiable as the rule.
 */
const UNPOPULATED_CLASSES: readonly string[] = ['.js'];

/**
 * Named collector: the file classes `isScannedFile` admits that the corpus does
 * not actually hold.
 *
 * DERIVED from the declaration rather than from a hand-picked list of landmark
 * files. A named list reaches whatever its author happened to name: with one
 * `.ts`, one `.md`, one `.cjs` and one hook spelled out, `.mds`, `.js` and
 * `.json` were admitted by `isScannedFile` and probed by nothing — so deleting
 * `.mds` from SCANNED_EXTENSIONS dropped every command source, every reference
 * module and the Git agent's generator host out of the scan with all three arms
 * still green. That is PF-064's corpus claim failing while the matcher claim
 * holds, and it is the exact failure this file's own preamble describes.
 *
 * The extension-less clause has no extension to derive from, so it is reported
 * under its own name; together the two halves cover every branch of
 * `isScannedFile`.
 */
export function collectUnreachedClasses(corpus: readonly CorpusEntry[]): string[] {
  const unreached = SCANNED_EXTENSIONS.filter(ext => !corpus.some(e => e.path.endsWith(ext)));
  if (!corpus.some(e => path.extname(e.path) === '')) unreached.push(EXTENSIONLESS_CLASS);
  return unreached;
}

// ---------------------------------------------------------------------------
// The forbidden bytes, named
// ---------------------------------------------------------------------------

interface ForbiddenRange {
  /** How the range is written in a regular expression, escaped. */
  readonly spelling: string;
  /** Why it is forbidden / what it is, for the failure message. */
  readonly what: string;
}

/**
 * The C0 controls minus tab/LF/CR, plus DEL. Spelled as ranges rather than a
 * single blanket class so the two carve-outs are visible: a guard that forbade
 * `[\x00-\x1f]` wholesale would report every line of every file.
 */
const FORBIDDEN_RANGES: readonly ForbiddenRange[] = [
  { spelling: '\\x00-\\x08', what: 'C0 controls below tab (NUL…BS)' },
  { spelling: '\\x0b\\x0c', what: 'vertical tab and form feed' },
  { spelling: '\\x0e-\\x1f', what: 'C0 controls above CR (SO…US)' },
  { spelling: '\\x7f', what: 'DEL' },
];

// eslint-disable-next-line no-control-regex
const FORBIDDEN_BYTE = new RegExp(`[${FORBIDDEN_RANGES.map(r => r.spelling).join('')}]`);

/** Render one offending byte for a failure message. */
function describeByte(byte: string): string {
  return `0x${byte.charCodeAt(0).toString(16).padStart(2, '0')}`;
}

/**
 * Named collector: every `path:line` in the corpus holding a forbidden raw byte.
 *
 * Extracted so the live assertion and the known-bad probe below drive the SAME
 * matcher. Inline, `expect(violations).toEqual([])` would be green whether the
 * tree is clean or the regex stopped matching.
 */
export function collectControlByteSites(corpus: CorpusEntry[]): string[] {
  const sites: string[] = [];
  for (const entry of corpus) {
    const lines = entry.content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const hit = FORBIDDEN_BYTE.exec(lines[i]);
      if (hit) sites.push(`${entry.path}:${i + 1}: raw ${describeByte(hit[0])}`);
    }
  }
  return sites;
}

// ---------------------------------------------------------------------------
// Guard
// ---------------------------------------------------------------------------

describe('no-control-bytes: no shipped source file holds a raw control byte', () => {
  const corpus = scanCorpus();

  it('the scan covers the shipped source tree and is non-vacuous', () => {
    expect(
      corpus.length,
      'the control-byte scan corpus is empty — a guard over nothing forbids nothing',
    ).toBeGreaterThan(0);
    expect(
      SCANNED_EXTENSIONS.length,
      'the extension declaration is empty — the reach check below would range over nothing',
    ).toBeGreaterThan(0);

    // Every class `isScannedFile` admits must be reached, derived from the
    // declaration so the two cannot drift: an extension nobody can name a file
    // for is an extension the scan does not cover, and removing one from the
    // declaration drops its whole surface out of the sweep.
    const unreached = collectUnreachedClasses(corpus);
    const unexplained = unreached.filter(cls => !UNPOPULATED_CLASSES.includes(cls));
    expect(
      unexplained,
      `file class(es) admitted by isScannedFile that the corpus does not reach — the scope has ` +
      `silently shrunk, and every arm below is green about ground it never covered:\n  ` +
      unexplained.join('\n  '),
    ).toEqual([]);

    // The exemption half of the same authority: a class listed as unpopulated
    // that the tree now HAS a member of is an exemption suppressing live coverage.
    const nowPopulated = UNPOPULATED_CLASSES.filter(cls => !unreached.includes(cls));
    expect(
      nowPopulated,
      `class(es) listed in UNPOPULATED_CLASSES that the tree now holds a member of. Delete the ` +
      `entry — the reach demand is what scans them:\n  ${nowPopulated.join('\n  ')}`,
    ).toEqual([]);

    // Known-bad probe, same collector (R1(b)): the assertions above are emptiness
    // claims, so the collector must be shown to report a class that has gone
    // unreached rather than to return `[]` unconditionally. Reported against the
    // live baseline, so the probe stays about the class it drops.
    //
    // The `.mds` probe carries a second load, and it is the reason a class is
    // named here at all: a DERIVED reach set shrinks together with its
    // declaration, so deleting `.mds` from SCANNED_EXTENSIONS would leave the
    // live arm above green over a corpus that no longer holds a single command
    // source, reference module or generator host. Naming the class in the probe
    // is what makes that deletion red — and `.mds` is the class whose loss costs
    // the most, because the whole tracker mechanics surface is spelled in it.
    const newlyUnreached = (subset: CorpusEntry[]): string[] =>
      collectUnreachedClasses(subset).filter(cls => !unreached.includes(cls));
    expect(
      newlyUnreached(corpus.filter(e => !e.path.endsWith('.mds'))),
      'dropping every .mds file from the corpus must be reported as an unreached class',
    ).toEqual(['.mds']);
    expect(
      newlyUnreached(corpus.filter(e => path.extname(e.path) !== '')),
      'dropping the extension-less hooks must be reported — that clause has no extension to ' +
      'derive from, so it is the one class a purely extension-driven check would miss',
    ).toEqual([EXTENSIONLESS_CLASS]);
    expect(
      collectUnreachedClasses([]),
      'an empty corpus reaches no class at all',
    ).toEqual([...SCANNED_EXTENSIONS, EXTENSIONLESS_CLASS]);
  });

  it('no raw control byte appears anywhere under src/ (and a seeded one is reported)', () => {
    const violations = collectControlByteSites(corpus);
    expect(
      violations,
      'A raw control byte makes the whole file invisible to grep (grep prints ' +
      '"Binary file matches" and skips it), so every grep-based guard over that ' +
      'directory silently stops covering it while still exiting 0. Write the byte as ' +
      'an escape — `/[\\x00-\\x1f\\x7f]/` is behaviour-identical and greppable:\n  ' +
      violations.join('\n  '),
    ).toEqual([]);

    // Known-bad probe, asserted inside the same `it` (R1(b)): the assertion above
    // is an emptiness claim, so the matcher must be shown to see each forbidden
    // range — including the NUL that starts the real defect — and to leave
    // tab/LF/CR alone.
    const seeded: CorpusEntry[] = [
      { path: 'src/core/seed-nul.ts', content: "const s = raw.replace(/[\x00-\x1f]/g, '?')\n" },
      { path: 'src/core/seed-del.ts', content: 'const d = "\x7f"\n' },
      { path: 'src/assets/scripts/hooks/seed-hook', content: 'printf %s "\x0b"\n' },
      { path: 'src/core/seed-so.ts', content: 'const so = "\x0e"\n' },
    ];
    expect(collectControlByteSites(seeded)).toEqual([
      'src/core/seed-nul.ts:1: raw 0x00',
      'src/core/seed-del.ts:1: raw 0x7f',
      'src/assets/scripts/hooks/seed-hook:1: raw 0x0b',
      'src/core/seed-so.ts:1: raw 0x0e',
    ]);
    // …and the three text controls must NOT be reported, or the guard would
    // report every file in the tree and be deleted rather than obeyed.
    expect(
      collectControlByteSites([{ path: 'src/core/seed-ok.ts', content: 'a\tb\nc\r\n' }]),
      'tab, LF and CR are ordinary text',
    ).toEqual([]);
  });

  it('every forbidden range is named, and the ranges compose into the matcher', () => {
    // The table is the matcher (the guard-census shape): a range added to
    // FORBIDDEN_RANGES must be a range the regex expresses, and the boundary
    // bytes on either side of each carve-out are what a hand-written class gets
    // wrong. 0x09/0x0a/0x0d allowed; 0x08/0x0b/0x0e forbidden.
    expect(FORBIDDEN_RANGES.length, 'the range table is empty').toBeGreaterThan(0);
    for (const allowed of ['\x09', '\x0a', '\x0d']) {
      expect(FORBIDDEN_BYTE.test(allowed), `${describeByte(allowed)} must be allowed`).toBe(false);
    }
    for (const forbidden of ['\x00', '\x08', '\x0b', '\x0c', '\x0e', '\x1f', '\x7f']) {
      expect(FORBIDDEN_BYTE.test(forbidden), `${describeByte(forbidden)} must be forbidden`).toBe(true);
    }
  });
});
