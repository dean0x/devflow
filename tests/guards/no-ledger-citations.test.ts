/**
 * no-ledger-citations — no learning-ledger ID reaches committed text.
 *
 * The learning ledger under `.devflow/learning/` is gitignored and numbered per
 * machine, so an `ADR-NNN` or `PF-NNN` resolves on no other clone, and numbers
 * have been reused: a citation that named the right entry when it was written
 * can name an unrelated one later. An ID may appear only in what stays inside a
 * session — an agent's reasoning, a handoff to the next agent, a report to its
 * caller. Anything committed, pushed or posted states the rule in words.
 *
 * What it asserts
 * ---------------
 * The file list is the worktree as git sees it: tracked files plus untracked,
 * unignored ones, so a new file is checked before anyone stages it. Files with a
 * NUL byte are binary and skipped.
 *
 * 1. FULL BAN. No three-digit ledger ID in any spelling in `src/**`,
 *    `scripts/**`, the root `vitest*.config.ts` files, `docs/**`, the root prose
 *    (`CLAUDE.md`, `README.md`, `CONTRIBUTING.md`, `.devflow/conventions.md`),
 *    the feature knowledge index, every feature `KNOWLEDGE.md`, and
 *    `tests/fixtures/numeric-floors.json`. People and agents on every clone read
 *    these, and none of them is test data.
 * 2. TEST COMMENTARY. In `tests/**\/*.ts` only comments and the title argument
 *    of `describe` / `it` / `test` (with their `.each`, `.for`, `.skip`,
 *    `.only`, `.todo`, `.concurrent`, `.skipIf` and `.runIf` forms) are read,
 *    and only the shapes a citation takes are flagged: `applies`, `avoids`,
 *    `per` or `see` before an ID, an ID that opens or closes a parenthesis or a
 *    bracket, and an ID in the possessive. A test's data can legitimately be a
 *    ledger ID — the ledger plumbing is tested on rows that carry them — so
 *    string literals in code are never read, and a title that names the fixture
 *    row it describes is data description, not a citation.
 *
 * Excluded everywhere: `CHANGELOG.md` (released history is not rewritten), the
 * golden fixtures under `tests/fixtures/golden/` and any install-snapshot golden
 * (frozen bytes), and `.devflow/learning/**` (the ledger itself). Placeholders
 * such as `ADR-NNN` carry no three digits and pass by construction.
 *
 * Test files are read strings first: quoted strings, template literals (and the
 * code inside their substitutions) and regular-expression literals are consumed
 * before a comment opener is looked for, so a `//` inside a string is never a
 * comment and comment-shaped text inside data is never scanned.
 *
 * What a green run does NOT prove
 * -------------------------------
 * In test files, an ID with no citation shape — mid-sentence ("the shape it
 * names"), as a leading label, or inside a parenthesised list that it neither
 * opens nor closes — is not matched, and neither is anything in a string
 * literal, assertion messages included. That arm is narrower than the full ban
 * on purpose: test commentary describes fixture rows by their IDs. An ID
 * assembled at run time is not representable. A regular-expression literal is
 * recognised by the token before it, as JavaScript tooling commonly does without
 * a parser: a literal opening a statement right after `)` is read as a division
 * and the rest of its line as code. Files outside the roots above — CI
 * workflows, package metadata, the other fixtures under `tests/` — are not read.
 */

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import { existsSync, readFileSync, statSync } from 'fs';
import * as path from 'path';

import { ROOT, type CorpusEntry } from '../helpers.js';

// ---------------------------------------------------------------------------
// The rule
// ---------------------------------------------------------------------------

/** Any learning-ledger ID: the full ban. */
const LEDGER_ID = /\b(?:ADR|PF)-\d{3}\b/g;

/**
 * The shapes a citation takes in test commentary: a citing verb before an ID,
 * an ID opening a parenthesis or bracket (optionally after `see` / `per` /
 * `cf.`), an ID closing one, and an ID in the possessive with a straight or a
 * typographic apostrophe.
 */
const CITATION =
  /\b(?:applies|avoids|per|see)\s+(?:ADR|PF)-\d{3}\b|[([][ \t]*(?:(?:see|per|cf\.)\s+)?(?:ADR|PF)-\d{3}\b|\b(?:ADR|PF)-\d{3}[ \t]*[)\]]|\b(?:ADR|PF)-\d{3}['\u2019]s\b/gi;

const REMEDY = 'ledger IDs stay on the machine — state the rule in words (see the apply-decisions skill)';

type Area =
  | 'src'
  | 'scripts'
  | 'vitest-config'
  | 'docs'
  | 'root-prose'
  | 'features-index'
  | 'feature-kb'
  | 'numeric-floors'
  | 'tests';

/** Every scanned root, in report order. `tests` is the commentary arm; the rest are the full ban. */
const SCANNED_AREAS: ReadonlyArray<{ readonly id: Area; readonly label: string }> = [
  { id: 'src', label: 'src/**' },
  { id: 'scripts', label: 'scripts/**' },
  { id: 'vitest-config', label: 'root vitest*.config.ts' },
  { id: 'docs', label: 'docs/**' },
  { id: 'root-prose', label: 'root prose' },
  { id: 'features-index', label: '.devflow/features/index.md' },
  { id: 'feature-kb', label: '.devflow/features/*/KNOWLEDGE.md' },
  { id: 'numeric-floors', label: 'tests/fixtures/numeric-floors.json' },
  { id: 'tests', label: 'tests/**/*.ts comments and titles' },
];

const ROOT_PROSE: readonly string[] = ['CLAUDE.md', 'README.md', 'CONTRIBUTING.md', '.devflow/conventions.md'];

/** Paths no arm reads, whichever root they sit under. */
function isExcluded(rel: string): boolean {
  return rel === 'CHANGELOG.md'
    || rel.startsWith('tests/fixtures/golden/')
    || /(?:^|\/)install-snapshot-[^/]*\.txt$/.test(rel)
    || rel.startsWith('.devflow/learning/');
}

/** The arm a repo-relative path belongs to, or undefined when no arm reads it. */
function areaOf(rel: string): Area | undefined {
  if (isExcluded(rel)) return undefined;
  if (rel.startsWith('src/')) return 'src';
  if (rel.startsWith('scripts/')) return 'scripts';
  if (/^vitest[^/]*\.config\.ts$/.test(rel)) return 'vitest-config';
  if (rel.startsWith('docs/')) return 'docs';
  if (ROOT_PROSE.includes(rel)) return 'root-prose';
  if (rel === '.devflow/features/index.md') return 'features-index';
  if (/^\.devflow\/features\/[^/]+\/KNOWLEDGE\.md$/.test(rel)) return 'feature-kb';
  if (rel === 'tests/fixtures/numeric-floors.json') return 'numeric-floors';
  if (rel.startsWith('tests/') && rel.endsWith('.ts')) return 'tests';
  return undefined;
}

// ---------------------------------------------------------------------------
// Strings-first lexer for test files
// ---------------------------------------------------------------------------

/** A significant code token: an identifier, one punctuator character, or a literal. */
interface CodeToken {
  readonly kind: 'ident' | 'punct' | 'number' | 'string' | 'template' | 'regex';
  readonly text: string;
  readonly start: number;
}

/** A comment's source span. */
interface CommentSpan {
  readonly start: number;
  readonly end: number;
}

/** Words after which a `/` opens a regular expression rather than dividing. */
const KEYWORDS_BEFORE_REGEX: ReadonlySet<string> = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw',
  'case', 'do', 'else', 'yield', 'await',
]);

/** Deepest `${…}` nesting the lexer descends into; anything deeper is read as template text. */
const MAX_SUBSTITUTION_DEPTH = 32;

const IDENT_START = /[A-Za-z_$\u0080-￿]/;
const IDENT_PART = /[\w$\u0080-￿]/;
const NUMBER_PART = /[\w.]/;

function isSpace(c: string): boolean {
  return c <= ' ' || c === ' ' || c === '﻿';
}

/** A `/` opens a regular expression unless the token before it ends an operand. */
function regexAllowed(prev: CodeToken | undefined): boolean {
  if (prev === undefined) return true;
  if (prev.kind === 'punct') return prev.text !== ')' && prev.text !== ']';
  if (prev.kind === 'ident') return KEYWORDS_BEFORE_REGEX.has(prev.text);
  return false;
}

/** End of the quoted string opening at `open`; an unterminated one ends at its newline. */
function quotedEnd(src: string, open: number): number {
  const quote = src[open];
  let i = open + 1;
  while (i < src.length) {
    const c = src[i];
    if (c === '\\') i += 2;
    else if (c === quote) return i + 1;
    else if (c === '\n') return i;
    else i++;
  }
  return src.length;
}

/** End of the regular expression opening at `open`, or -1 when none closes on its line. */
function regexEnd(src: string, open: number): number {
  let inClass = false;
  let i = open + 1;
  while (i < src.length) {
    const c = src[i];
    if (c === '\n') return -1;
    if (c === '\\') {
      i += 2;
      continue;
    }
    if (inClass) {
      if (c === ']') inClass = false;
    } else if (c === '[') {
      inClass = true;
    } else if (c === '/') {
      i++;
      while (i < src.length && /[A-Za-z]/.test(src[i])) i++;
      return i;
    }
    i++;
  }
  return -1;
}

/**
 * End of the template literal opening at `open`. The code inside each `${…}` is
 * lexed in turn, so a comment there is collected and a backtick there opens a
 * nested template rather than closing this one.
 */
function templateEnd(src: string, open: number, comments: CommentSpan[], depth: number): number {
  let i = open + 1;
  while (i < src.length) {
    const c = src[i];
    if (c === '\\') i += 2;
    else if (c === '`') return i + 1;
    else if (c === '$' && src[i + 1] === '{' && depth < MAX_SUBSTITUTION_DEPTH) {
      i = lexCode(src, i + 2, true, comments, [], depth + 1);
    } else i++;
  }
  return src.length;
}

/**
 * Lexes code from `pos`, collecting comments and significant tokens. Literals are
 * consumed before a comment opener is considered. With `inSubstitution` it stops
 * just past the `}` that closes the substitution and returns that index.
 */
function lexCode(
  src: string,
  pos: number,
  inSubstitution: boolean,
  comments: CommentSpan[],
  tokens: CodeToken[],
  depth: number,
): number {
  let braces = 0;
  let prev: CodeToken | undefined;
  let i = pos;
  while (i < src.length) {
    const c = src[i];
    if (isSpace(c)) {
      i++;
      continue;
    }
    if (c === '/' && src[i + 1] === '/') {
      const newline = src.indexOf('\n', i);
      const end = newline === -1 ? src.length : newline;
      comments.push({ start: i, end });
      i = end;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const close = src.indexOf('*/', i + 2);
      const end = close === -1 ? src.length : close + 2;
      comments.push({ start: i, end });
      i = end;
      continue;
    }
    let kind: CodeToken['kind'];
    let end: number;
    if (c === '\'' || c === '"') {
      kind = 'string';
      end = quotedEnd(src, i);
    } else if (c === '`') {
      kind = 'template';
      end = templateEnd(src, i, comments, depth);
    } else if (c === '/' && regexAllowed(prev) && regexEnd(src, i) !== -1) {
      kind = 'regex';
      end = regexEnd(src, i);
    } else if (IDENT_START.test(c)) {
      kind = 'ident';
      end = i + 1;
      while (end < src.length && IDENT_PART.test(src[end])) end++;
    } else if (c >= '0' && c <= '9') {
      kind = 'number';
      end = i + 1;
      while (end < src.length && NUMBER_PART.test(src[end])) end++;
    } else {
      if (inSubstitution && c === '{') braces++;
      if (inSubstitution && c === '}') {
        if (braces === 0) return i + 1;
        braces--;
      }
      kind = 'punct';
      end = i + 1;
    }
    const token: CodeToken = { kind, text: src.slice(i, end), start: i };
    tokens.push(token);
    prev = token;
    i = end;
  }
  return i;
}

const TEST_FUNCTIONS: ReadonlySet<string> = new Set(['describe', 'it', 'test']);
/** Modifiers that leave the chain a test function: `it.skip(…)`, `describe.concurrent.only(…)`. */
const CHAIN_MODIFIERS: ReadonlySet<string> = new Set(['skip', 'only', 'todo', 'concurrent', 'sequential', 'fails', 'shuffle']);
/** Modifiers called first, whose result takes the title: `it.each(table)(…)`, `test.skipIf(cond)(…)`. */
const CALLING_MODIFIERS: ReadonlySet<string> = new Set(['each', 'for', 'skipIf', 'runIf']);
const MAX_CHAIN = 8;
const MAX_ARGUMENT_TOKENS = 20_000;

function isPunct(token: CodeToken | undefined, text: string): boolean {
  return token?.kind === 'punct' && token.text === text;
}

/** Index just past the `)` matching the `(` at `open`, or -1. */
function afterParens(tokens: readonly CodeToken[], open: number): number {
  let depth = 0;
  for (let k = open; k < tokens.length && k < open + MAX_ARGUMENT_TOKENS; k++) {
    if (isPunct(tokens[k], '(')) depth++;
    else if (isPunct(tokens[k], ')') && --depth === 0) return k + 1;
  }
  return -1;
}

/** The title argument of every `describe` / `it` / `test` call, when it is a string or template literal. */
function collectTitles(tokens: readonly CodeToken[]): CodeToken[] {
  const titles: CodeToken[] = [];
  for (let k = 0; k < tokens.length; k++) {
    if (tokens[k].kind !== 'ident' || !TEST_FUNCTIONS.has(tokens[k].text)) continue;
    if (isPunct(tokens[k - 1], '.')) continue;
    let j = k + 1;
    let isTestCall = true;
    for (let step = 0; step < MAX_CHAIN; step++) {
      if (!isPunct(tokens[j], '.') || tokens[j + 1]?.kind !== 'ident') break;
      const modifier = tokens[j + 1].text;
      j += 2;
      if (CHAIN_MODIFIERS.has(modifier)) continue;
      if (!CALLING_MODIFIERS.has(modifier)) {
        isTestCall = false;
        break;
      }
      if (tokens[j]?.kind === 'template') {
        j++;
        continue;
      }
      j = isPunct(tokens[j], '(') ? afterParens(tokens, j) : -1;
      if (j === -1) {
        isTestCall = false;
        break;
      }
    }
    if (!isTestCall || !isPunct(tokens[j], '(')) continue;
    const first = tokens[j + 1];
    if (first?.kind === 'string' || first?.kind === 'template') titles.push(first);
  }
  return titles;
}

/** One piece of test commentary: a comment or a title, with its offset in the file. */
interface Commentary {
  readonly start: number;
  readonly text: string;
}

/** Every comment and every test title in a test file's source. */
function extractCommentary(src: string): { comments: Commentary[]; titles: Commentary[] } {
  const spans: CommentSpan[] = [];
  const tokens: CodeToken[] = [];
  lexCode(src, 0, false, spans, tokens, 0);
  return {
    comments: spans.map(s => ({ start: s.start, text: src.slice(s.start, s.end) })),
    titles: collectTitles(tokens).map(t => ({ start: t.start, text: t.text })),
  };
}

// ---------------------------------------------------------------------------
// Named collector
// ---------------------------------------------------------------------------

interface LedgerViolation {
  area: Area;
  path: string;
  line: number;
  text: string;
}

function lineOf(content: string, offset: number): number {
  let line = 1;
  for (let i = content.indexOf('\n'); i !== -1 && i < offset; i = content.indexOf('\n', i + 1)) line++;
  return line;
}

/**
 * Every violation in `corpus`: each entry is routed by `areaOf`, the full ban
 * applies to its whole text, and test files are read for citations in their
 * comments and titles only. Pure — the live arms and the seeded probes run it.
 */
function collectLedgerViolations(corpus: readonly CorpusEntry[]): LedgerViolation[] {
  const found: LedgerViolation[] = [];
  for (const entry of corpus) {
    const area = areaOf(entry.path);
    if (area === undefined) continue;
    const report = (offset: number, text: string): void => {
      found.push({ area, path: entry.path, line: lineOf(entry.content, offset), text: text.replace(/\s+/g, ' ') });
    };
    if (area !== 'tests') {
      for (const m of entry.content.matchAll(LEDGER_ID)) report(m.index, m[0]);
      continue;
    }
    const { comments, titles } = extractCommentary(entry.content);
    for (const piece of [...comments, ...titles]) {
      for (const m of piece.text.matchAll(CITATION)) report(piece.start + m.index, m[0]);
    }
  }
  return found.sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line);
}

function formatViolation(v: LedgerViolation): string {
  return `${v.path}:${v.line}: ${v.text}`;
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

/** A listed file's text, or undefined when it is gone from the worktree, not a regular file, or binary. */
function readText(rel: string): string | undefined {
  const abs = path.join(ROOT, rel);
  let bytes: Buffer;
  try {
    if (!statSync(abs).isFile()) return undefined;
    bytes = readFileSync(abs);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw err;
  }
  return bytes.includes(0) ? undefined : bytes.toString('utf8');
}

const corpus: readonly CorpusEntry[] = listWorktreeFiles()
  .filter(rel => areaOf(rel) !== undefined)
  .flatMap(rel => {
    const content = readText(rel);
    return content === undefined ? [] : [{ path: rel, content }];
  });

let liveViolations: LedgerViolation[] | undefined;
function violationsIn(area: Area): LedgerViolation[] {
  liveViolations ??= collectLedgerViolations(corpus);
  return liveViolations.filter(v => v.area === area);
}

// ---------------------------------------------------------------------------
// Live arms
// ---------------------------------------------------------------------------

describe('no learning-ledger ID in committed text', () => {
  for (const area of SCANNED_AREAS) {
    const claim = area.id === 'tests' ? 'carry no ledger citation' : 'carries no ledger ID';
    it(`${area.label} ${claim}`, () => {
      expect(violationsIn(area.id).map(formatViolation), REMEDY).toEqual([]);
    });
  }
});

describe('no-ledger-citations guard: corpus reach', () => {
  for (const area of SCANNED_AREAS) {
    it(`reaches ${area.label}`, () => {
      expect(
        corpus.filter(e => areaOf(e.path) === area.id).length,
        `no file under ${area.label} was read — the arm would pass over nothing`,
      ).toBeGreaterThan(0);
    });
  }

  for (const file of ROOT_PROSE) {
    it.runIf(existsSync(path.join(ROOT, file)))(`reaches ${file}`, () => {
      expect(corpus.map(e => e.path)).toContain(file);
    });
  }

  it('the extractor reads comments and test titles out of the real tests corpus', () => {
    const commentary = corpus.filter(e => areaOf(e.path) === 'tests').map(e => extractCommentary(e.content));
    const comments = commentary.reduce((n, c) => n + c.comments.length, 0);
    const titles = commentary.reduce((n, c) => n + c.titles.length, 0);
    expect(comments, 'no comment extracted from tests/**/*.ts').toBeGreaterThan(0);
    expect(titles, 'no describe/it/test title extracted from tests/**/*.ts').toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Seeded probes: red on every shape each arm claims to read, green on
// placeholders, data and anything outside the arm.
// ---------------------------------------------------------------------------

describe('no-ledger-citations guard: seeded probes', () => {
  const TEST_FILE = 'tests/guards/example.test.ts';

  const FULL_BAN_BAD: ReadonlyArray<{ name: string; entry: CorpusEntry }> = [
    { name: 'a citing comment in source', entry: { path: 'src/core/example.ts', content: '// see PF-123 for why\nexport const x = 1;\n' } },
    { name: 'a bare ID in a doc', entry: { path: 'docs/reference/example.md', content: 'The split follows ADR-123.\n' } },
    { name: 'an ID held as data in a script', entry: { path: 'scripts/example.ts', content: "const anchor = 'PF-123';\n" } },
    { name: 'an ID in a vitest config', entry: { path: 'vitest.config.ts', content: '// pool settings, see PF-123\n' } },
    { name: 'an ID in root prose', entry: { path: 'CLAUDE.md', content: 'Plumbing only (ADR-123).\n' } },
    { name: 'an ID in the conventions file', entry: { path: '.devflow/conventions.md', content: 'Branch names follow ADR-123.\n' } },
    { name: 'an ID in the features index', entry: { path: '.devflow/features/index.md', content: '| x | per PF-123 |\n' } },
    { name: 'an ID in a feature knowledge base', entry: { path: '.devflow/features/example/KNOWLEDGE.md', content: '- applies ADR-123\n' } },
    { name: 'an ID in a numeric-floor description', entry: { path: 'tests/fixtures/numeric-floors.json', content: '{ "description": "vacuous otherwise (PF-123)" }\n' } },
  ];

  for (const probe of FULL_BAN_BAD) {
    it(`full ban reports ${probe.name}`, () => {
      expect(collectLedgerViolations([probe.entry]).map(formatViolation)).toHaveLength(1);
    });
  }

  const TEST_ARM_BAD: ReadonlyArray<{ name: string; content: string }> = [
    { name: 'a line comment that avoids an ID', content: '// avoids PF-123\n' },
    { name: 'a parenthesised ID in a block comment', content: '/* (ADR-123) */\n' },
    { name: 'a JSDoc see-citation', content: '/**\n * The rule holds (see PF-123: the reason).\n */\n' },
    { name: 'a per-citation', content: '// the rule, per ADR-123\n' },
    { name: 'an ID closing a parenthesis', content: '// (the reason, PF-123)\n' },
    { name: 'a bracketed ID', content: '// [ADR-123]\n' },
    { name: 'a cf.-citation', content: '// (cf. PF-123)\n' },
    { name: 'an it title', content: "it('rejects it (PF-123)', () => {});\n" },
    { name: 'a describe.each title', content: "describe.each([[1]])('case %s [ADR-123]', () => {});\n" },
    { name: 'a test.skip title', content: "test.skip('pending (PF-123)', () => {});\n" },
    { name: 'an it.concurrent title', content: "it.concurrent('runs (see ADR-123)', async () => {});\n" },
    { name: 'a tagged-template it.each title', content: "it.each`\n  a\n  ${1}\n`('row $a (PF-123)', () => {});\n" },
    { name: 'a template-literal title', content: 'it(`labels ${1} (PF-123)`, () => {});\n' },
    { name: 'a comment after a regex literal holding a backtick', content: 'const re = /`/;\n// see PF-123\n' },
    { name: 'a comment after a regex literal holding a quote', content: "const re = /['\"]/g;\n// see PF-123\n" },
    { name: 'a comment after a nested template', content: 'const t = `a ${`b`} c`;\n// see PF-123\n' },
    { name: 'a comment inside a template substitution', content: 'const t = `${/* see PF-123 */ 1}`;\n' },
    { name: 'a possessive with a straight apostrophe', content: "// the matcher is PF-123's first claim\n" },
    { name: 'a possessive with a typographic apostrophe', content: '// ADR-123\u2019s split still holds\n' },
  ];

  for (const probe of TEST_ARM_BAD) {
    it(`test arm reports ${probe.name}`, () => {
      expect(collectLedgerViolations([{ path: TEST_FILE, content: probe.content }]).map(formatViolation)).toHaveLength(1);
    });
  }

  it('names the file and line a citation sits on, then the matched text', () => {
    const found = collectLedgerViolations([{ path: TEST_FILE, content: 'const a = 1;\n\n// see PF-123\n' }]);
    expect(found.map(formatViolation)).toEqual([`${TEST_FILE}:3: see PF-123`]);
  });

  const TEST_ARM_GOOD: ReadonlyArray<{ name: string; content: string }> = [
    { name: 'placeholders', content: '// applies ADR-NNN\n/* (PF-NNN) */\n// ADR-XOR-PF\n' },
    { name: 'placeholder, glued and four-digit possessives', content: "// PF-NNN's rule, ADR-NNN\u2019s split\n// XPF-123's key, PF-1234's number\n" },
    { name: 'a citing phrase held in a string literal', content: "const s = 'applies ADR-001';\n" },
    { name: 'an ID held as data', content: "const id = 'PF-123';\nconst row = { anchor: 'ADR-123' };\n" },
    { name: 'an assertion message', content: "expect(x, 'vacuous otherwise (PF-123)').toBe(1);\n" },
    { name: 'a // inside a string', content: "const url = 'https://example.com/x // see PF-123';\n" },
    { name: 'comment-shaped text in a template literal', content: 'const t = `/* (PF-123) */`;\n' },
    { name: 'comment-shaped text in a regex literal', content: 'const re = /\\/\\/ see PF-123/;\n' },
    { name: 'a Jira-style key and a four-digit number', content: '// tracked as PROJ-123 (see PROJ-123)\n// (PF-1234)\n' },
    { name: 'a title that names the fixture row it describes', content: "it('renders the ADR-123 heading', () => {});\n" },
    { name: 'a comment that describes a fixture row by its ID', content: '// row ADR-123 is retired in this fixture\n' },
    { name: 'a method that happens to be named test', content: "/x/.test('see PF-123');\nobj.it('(PF-123)');\n" },
  ];

  for (const probe of TEST_ARM_GOOD) {
    it(`test arm passes ${probe.name}`, () => {
      expect(collectLedgerViolations([{ path: TEST_FILE, content: probe.content }]).map(formatViolation)).toEqual([]);
    });
  }

  it('the full ban passes placeholders, Jira-style keys and longer numbers', () => {
    const clean: CorpusEntry[] = [
      { path: 'docs/reference/example.md', content: 'Cite as `ADR-NNN` or `PF-NNN`; never ADR-XOR-PF.\n' },
      { path: 'src/core/example.ts', content: "const key = 'PROJ-123';\nconst wider = 'PF-1234';\nconst glued = 'XPF-123';\n" },
    ];
    expect(collectLedgerViolations(clean).map(formatViolation)).toEqual([]);
  });

  it('reads nothing that is excluded or outside every root', () => {
    const ignored: CorpusEntry[] = [
      { path: 'CHANGELOG.md', content: '- Fixed the rule (PF-123).\n' },
      { path: 'tests/fixtures/golden/example.ts', content: '// see PF-123\n' },
      { path: 'tests/fixtures/golden/install-snapshot-example.txt', content: 'see PF-123\n' },
      { path: '.devflow/learning/decisions.md', content: '## ADR-123: a decision\n' },
      { path: '.github/workflows/example.yml', content: '# see PF-123\n' },
    ];
    expect(collectLedgerViolations(ignored).map(formatViolation)).toEqual([]);
  });
});
