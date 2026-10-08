/**
 * Guard: every compiled command binds `$ARGUMENTS` once, inside a
 * `<command-input>` block.
 *
 * D-ARGS-ONCE. Claude Code substitutes the placeholder at EVERY occurrence in a
 * command file, so a long argument (a pasted plan, a stack trace) is copied into
 * the main-thread context once per occurrence. A host binds it once, in its input
 * section, and every later step names the bound text `COMMAND_INPUT`. The
 * placeholder sits on its own line inside a tag pair, never in an inline code
 * span: a multi-line or backtick-bearing argument breaks a code span and leaves
 * the rest of the command mis-parsed, whereas a tag pair holds it whole.
 *
 * What this guard holds, over `dist/commands/*.md`:
 *   - at most `MAX_ARGUMENTS_PER_COMMAND` placeholders per file, the literal and
 *     the positional spellings (`$ARGUMENTS[N]`, a `$` before a digit) counted
 *     together, so a positional placeholder cannot slip past a literal-only count;
 *   - no positional spelling at all — nothing in this repository binds one;
 *   - exactly one literal in each host that compiles the tracker grammar
 *     (`TRACKER_PARTIAL_ADOPTERS`), because those hosts scan the input for issue
 *     references and so must hold it;
 *   - each placeholder sits between a `<command-input>` line and a
 *     `</command-input>` line;
 *   - exactly the hosts in `INPUT_BOUND_COMMANDS` carry one, and no other
 *     command does.
 *
 * Cloned from `requires-closure.test.ts` in shape: every assertion runs through a
 * named collector, and the known-bad probes drive THAT collector with a seeded
 * body, so a collector that silently saw nothing cannot make the guard pass. The
 * corpus is read loudly: an absent `dist/commands` or one holding no command files
 * throws, because a guard that skips on a missing build is not a guard.
 */

import { describe, it, expect } from 'vitest';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { TRACKER_PARTIAL_ADOPTERS } from '../fixtures/mds-manifest.js';

const ROOT = path.resolve(import.meta.dirname, '../..');
const COMMANDS_DIR = path.join(ROOT, 'dist', 'commands');

/**
 * The most placeholders one compiled command may carry. A ratchet: it may be
 * lowered, never raised (`arguments-once-max` in tests/fixtures/numeric-floors.json).
 */
const MAX_ARGUMENTS_PER_COMMAND = 1;

/**
 * The commands that bind the user's input, as a set rather than a count: a count
 * stays green when one host drops its binding and another gains one in the same
 * commit. The five tracker adopters bind it because they scan it for issue
 * references; the other three read it as their subject.
 */
const INPUT_BOUND_COMMANDS: readonly string[] = [
  ...TRACKER_PARTIAL_ADOPTERS,
  'explore',
  'release',
  'research',
];

const BLOCK_OPEN = '<command-input>';
const BLOCK_CLOSE = '</command-input>';

/** A command name (file stem) mapped to its compiled body. */
type Corpus = ReadonlyMap<string, string>;

// ---------------------------------------------------------------------------
// Named collectors
// ---------------------------------------------------------------------------

/** Every literal placeholder in a body, `$ARGUMENTS[N]` excluded. */
function countLiteral(body: string): number {
  return (body.match(/\$ARGUMENTS(?!\[)/g) ?? []).length;
}

/** Every positional spelling in a body: `$ARGUMENTS[N]` and a `$` before a digit. */
function countPositional(body: string): number {
  return (body.match(/\$ARGUMENTS\[|\$[0-9]/g) ?? []).length;
}

/**
 * Named collector: the 1-based line numbers of every placeholder that sits OUTSIDE
 * a `<command-input>` … `</command-input>` pair, plus one entry (line 0) for a
 * block opened and never closed.
 */
function placeholdersOutsideBlock(body: string): number[] {
  const outside: number[] = [];
  let inBlock = false;
  const lines = body.split('\n');
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].trim();
    if (line === BLOCK_OPEN) { inBlock = true; continue; }
    if (line === BLOCK_CLOSE) { inBlock = false; continue; }
    if (!inBlock && (countLiteral(lines[index]) > 0 || countPositional(lines[index]) > 0)) {
      outside.push(index + 1);
    }
  }
  if (inBlock) outside.push(0);
  return outside;
}

/**
 * Named collector: every way a corpus breaks the once-per-command rule. The live
 * arm and every known-bad probe call this one function.
 */
function collectArgumentViolations(corpus: Corpus): string[] {
  const violations: string[] = [];
  if (corpus.size === 0) {
    return ['the corpus is empty — dist/commands held no command files, so nothing was checked'];
  }

  for (const [name, body] of corpus) {
    const literal = countLiteral(body);
    const positional = countPositional(body);
    if (literal + positional > MAX_ARGUMENTS_PER_COMMAND) {
      violations.push(
        `${name}.md carries ${literal + positional} placeholders; the most one command may bind is ` +
        `${MAX_ARGUMENTS_PER_COMMAND}. Name the bound text COMMAND_INPUT instead of repeating the placeholder.`,
      );
    }
    if (positional > 0) {
      violations.push(`${name}.md carries ${positional} positional placeholder(s); none is ever bound`);
    }
    for (const line of placeholdersOutsideBlock(body)) {
      violations.push(
        line === 0
          ? `${name}.md opens a ${BLOCK_OPEN} block and never closes it`
          : `${name}.md line ${line}: a placeholder outside a ${BLOCK_OPEN} block`,
      );
    }
  }

  for (const adopter of TRACKER_PARTIAL_ADOPTERS) {
    const body = corpus.get(adopter);
    if (body === undefined) {
      violations.push(`${adopter}.md is absent from the corpus — a tracker adopter must be compiled`);
    } else if (countLiteral(body) !== 1) {
      violations.push(
        `${adopter}.md carries ${countLiteral(body)} literal placeholders; a tracker adopter scans the ` +
        'input for issue references and so binds it exactly once',
      );
    }
  }
  return violations;
}

/**
 * Named collector: the commands that bind the input, compared to the named set —
 * a command that gained a binding, and one that lost it.
 */
function collectBindingSetViolations(corpus: Corpus): string[] {
  const bound = [...corpus].filter(([, body]) => countLiteral(body) > 0).map(([name]) => name).sort();
  const expected = [...INPUT_BOUND_COMMANDS].sort();
  const violations: string[] = [];
  for (const name of bound) {
    if (!expected.includes(name)) violations.push(`${name}.md binds the input but is not in INPUT_BOUND_COMMANDS`);
  }
  for (const name of expected) {
    if (!bound.includes(name)) violations.push(`${name}.md is in INPUT_BOUND_COMMANDS but binds no input`);
  }
  return violations;
}

/**
 * Read the compiled commands. Throws, never skips, when the build is absent or
 * holds nothing — the remedy is in the message.
 */
async function readCommandCorpus(dir: string): Promise<Corpus> {
  let entries: string[];
  try {
    entries = (await fs.readdir(dir)).filter(entry => entry.endsWith('.md')).sort();
  } catch {
    throw new Error(`${dir} is absent — run \`npm run build\` first (the once-per-command guard cannot be skipped)`);
  }
  if (entries.length === 0) {
    throw new Error(`${dir} holds no command files — run \`npm run build\` first (the guard cannot be skipped)`);
  }
  const corpus = new Map<string, string>();
  for (const entry of entries) {
    corpus.set(entry.replace(/\.md$/, ''), await fs.readFile(path.join(dir, entry), 'utf-8'));
  }
  return corpus;
}

/** A minimal bound body: one placeholder inside its block. */
const BOUND_BODY = `# Cmd\n\n${BLOCK_OPEN}\n$ARGUMENTS\n${BLOCK_CLOSE}\n\nThe text is COMMAND_INPUT.\n`;

/** A corpus in which every tracker adopter and every other input-bound command is well formed. */
function wellFormedCorpus(): Map<string, string> {
  return new Map(INPUT_BOUND_COMMANDS.map(name => [name, BOUND_BODY]));
}

// ---------------------------------------------------------------------------
// Live: the compiled commands
// ---------------------------------------------------------------------------

describe('arguments once (D-ARGS-ONCE): the compiled commands', () => {
  it('reads a non-empty corpus that includes every tracker adopter and the static release command', async () => {
    const corpus = await readCommandCorpus(COMMANDS_DIR);
    expect(corpus.size, 'no compiled command was read').toBeGreaterThan(0);
    for (const adopter of TRACKER_PARTIAL_ADOPTERS) {
      expect(corpus.has(adopter), `${adopter}.md is absent from dist/commands`).toBe(true);
    }
    expect(corpus.has('release'), 'release.md is the hand-authored command and must be copied through').toBe(true);
  });

  it('every command binds the input at most once, inside a block, and each adopter binds it exactly once', async () => {
    const violations = collectArgumentViolations(await readCommandCorpus(COMMANDS_DIR));
    expect(violations, `D-ARGS-ONCE violations:\n  ${violations.join('\n  ')}`).toEqual([]);
  });

  it('exactly the named commands bind the input', async () => {
    const violations = collectBindingSetViolations(await readCommandCorpus(COMMANDS_DIR));
    expect(violations, `binding-set violations:\n  ${violations.join('\n  ')}`).toEqual([]);
  });

  it('a missing or empty corpus throws instead of passing', async () => {
    await expect(readCommandCorpus(path.join(ROOT, 'dist', 'no-such-commands-dir'))).rejects.toThrow(/npm run build/);
    const empty = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-empty-corpus-'));
    try {
      await expect(readCommandCorpus(empty)).rejects.toThrow(/holds no command files/);
    } finally {
      await fs.rm(empty, { recursive: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Known-bad probes: the same collectors, seeded
// ---------------------------------------------------------------------------

describe('arguments once (D-ARGS-ONCE): known-bad probes', () => {
  it('the well-formed corpus is clean, so the probes below fail for the seeded reason alone', () => {
    expect(collectArgumentViolations(wellFormedCorpus())).toEqual([]);
    expect(collectBindingSetViolations(wellFormedCorpus())).toEqual([]);
  });

  it('a body with two placeholders fails', () => {
    const corpus = wellFormedCorpus();
    corpus.set('implement', `${BOUND_BODY}\nFetch $ARGUMENTS again.\n`);
    const violations = collectArgumentViolations(corpus);
    expect(violations.some(v => v.startsWith('implement.md carries 2 placeholders'))).toBe(true);
  });

  it('a body with a positional placeholder fails, in either spelling', () => {
    for (const positional of ['$1', '$ARGUMENTS[0]']) {
      const corpus = wellFormedCorpus();
      corpus.set('explore', `${BOUND_BODY}\nThe first word is ${positional}.\n`);
      const violations = collectArgumentViolations(corpus);
      expect(violations.some(v => v.includes('explore.md') && v.includes('positional')), positional).toBe(true);
    }
  });

  it('a lone positional placeholder is not mistaken for the literal binding', () => {
    const corpus = wellFormedCorpus();
    corpus.set('plan', `# Cmd\n\n${BLOCK_OPEN}\n$ARGUMENTS[0]\n${BLOCK_CLOSE}\n`);
    const violations = collectArgumentViolations(corpus);
    expect(violations.some(v => v.startsWith('plan.md carries 0 literal placeholders'))).toBe(true);
    expect(violations.some(v => v.includes('plan.md') && v.includes('positional'))).toBe(true);
  });

  it('a tracker adopter with no placeholder fails', () => {
    const corpus = wellFormedCorpus();
    corpus.set('debug', '# Cmd\n\nNo input is bound here.\n');
    const violations = collectArgumentViolations(corpus);
    expect(violations.some(v => v.startsWith('debug.md carries 0 literal placeholders'))).toBe(true);
  });

  it('a tracker adopter missing from the corpus fails', () => {
    const corpus = wellFormedCorpus();
    corpus.delete('dynamic-plan');
    expect(collectArgumentViolations(corpus)).toContain(
      'dynamic-plan.md is absent from the corpus — a tracker adopter must be compiled',
    );
  });

  it('an empty corpus fails', () => {
    expect(collectArgumentViolations(new Map())).toHaveLength(1);
  });

  it('a placeholder outside a block fails, and so does a block that never closes', () => {
    const bare = wellFormedCorpus();
    bare.set('research', '# Cmd\n\nThe topic is `$ARGUMENTS`.\n');
    expect(collectArgumentViolations(bare).some(v => v.includes('research.md line 3'))).toBe(true);

    const unclosed = wellFormedCorpus();
    unclosed.set('release', `# Cmd\n\n${BLOCK_OPEN}\n$ARGUMENTS\n`);
    expect(collectArgumentViolations(unclosed).some(v => v.includes('release.md opens'))).toBe(true);
  });

  it('a command that binds the input without being named, and one that loses its binding, are both reported', () => {
    const gained = wellFormedCorpus();
    gained.set('resolve', BOUND_BODY);
    expect(collectBindingSetViolations(gained)).toEqual(['resolve.md binds the input but is not in INPUT_BOUND_COMMANDS']);

    const lost = wellFormedCorpus();
    lost.set('research', '# Cmd\n');
    expect(collectBindingSetViolations(lost)).toEqual(['research.md is in INPUT_BOUND_COMMANDS but binds no input']);
  });
});
