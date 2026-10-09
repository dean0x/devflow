/**
 * Unit tests for src/core/learning-variants.ts: the splitter that turns one
 * compiled prompt body into its learning-on and learning-off variants
 * (D-LEARNING-VARIANTS; AC-127, AC-134).
 *
 * Every refusal is shown by a known-bad probe: a seeded body that must be refused
 * with that kind and that line, so a splitter that stopped refusing is named here.
 * Every arm of the happy path is asserted on exact bytes, because the contract is
 * byte-for-byte: a marker line goes whole, every other line stays as written.
 */

import { describe, it, expect } from 'vitest';
import {
  LEARNING_MARKER_RE,
  LEARNING_OFF_OUTPUT_DIR,
  containsLearningMarker,
  describeLearningSplitError,
  learningOffRelPath,
  splitLearningVariants,
  type LearningSplit,
  type LearningSplitError,
} from '../../src/core/learning-variants.js';

const ON = '<!-- learning:on -->';
const OFF = '<!-- learning:off -->';
const END = '<!-- learning:end -->';

/** Join lines the way a file holds them, ending in a newline. */
function body(...lines: string[]): string {
  return `${lines.join('\n')}\n`;
}

/** Split and unwrap, failing the test (not throwing in the module) on a refusal. */
function split(text: string): LearningSplit {
  const result = splitLearningVariants(text);
  if (!result.ok) throw new Error(`expected a split, got ${JSON.stringify(result.error)}`);
  return result.value;
}

/** Split and unwrap the refusal. */
function refusal(text: string): LearningSplitError {
  const result = splitLearningVariants(text);
  if (result.ok) throw new Error(`expected a refusal, got a split with hasArms=${result.value.hasArms}`);
  return result.error;
}

describe('a body with no marker', () => {
  it.each([
    ['empty', ''],
    ['one line, no newline', 'Just text.'],
    ['two paragraphs with a trailing newline', 'One.\n\nTwo.\n'],
    ['a learning word that is not a marker', 'Learning is on; see learning:on in the docs.\n'],
  ])('%s: both variants are the body, hasArms is false', (_label, text) => {
    expect(split(text)).toEqual({ on: text, off: text, hasArms: false });
  });
});

describe('arms and else', () => {
  it('an on arm is kept in the on variant and dropped from the off variant, marker lines removed whole', () => {
    const text = body('Before.', ON, 'Decisions line.', END, 'After.');
    expect(split(text)).toEqual({
      on: body('Before.', 'Decisions line.', 'After.'),
      off: body('Before.', 'After.'),
      hasArms: true,
    });
  });

  it('an off arm with no on arm before it is kept only in the off variant', () => {
    const text = body('Before.', OFF, 'No decisions are loaded.', END, 'After.');
    expect(split(text)).toEqual({
      on: body('Before.', 'After.'),
      off: body('Before.', 'No decisions are loaded.', 'After.'),
      hasArms: true,
    });
  });

  it('an off arm directly after an on arm is its else', () => {
    const text = body('Before.', ON, 'On text.', OFF, 'Off text.', END, 'After.');
    expect(split(text)).toEqual({
      on: body('Before.', 'On text.', 'After.'),
      off: body('Before.', 'Off text.', 'After.'),
      hasArms: true,
    });
  });

  it('keeps several arms in order and shares the lines between them', () => {
    const text = body('A', ON, 'on-1', END, 'B', ON, 'on-2', OFF, 'off-2', END, 'C', OFF, 'off-3', END, 'D');
    expect(split(text)).toEqual({
      on: body('A', 'on-1', 'B', 'on-2', 'C', 'D'),
      off: body('A', 'B', 'off-2', 'C', 'off-3', 'D'),
      hasArms: true,
    });
  });

  it('an arm holds many lines, blank lines inside it included', () => {
    const text = body('Before.', ON, '', 'Paragraph one.', '', 'Paragraph two.', END, '', 'After.');
    expect(split(text)).toEqual({
      on: body('Before.', '', 'Paragraph one.', '', 'Paragraph two.', '', 'After.'),
      off: body('Before.', '', 'After.'),
      hasArms: true,
    });
  });

  it('keeps no trailing newline when the body has none', () => {
    const text = [ON, 'on', OFF, 'off', END, 'tail'].join('\n');
    expect(split(text)).toEqual({ on: 'on\ntail', off: 'off\ntail', hasArms: true });
  });

  it('an arm at the very end of the body leaves the final newline in place', () => {
    const text = body('Head.', ON, 'on', END);
    expect(split(text)).toEqual({ on: body('Head.', 'on'), off: body('Head.'), hasArms: true });
  });
});

describe('where a marker may sit', () => {
  it('an indented marker is a marker, and the arm keeps its own indentation', () => {
    const text = body('- item', `  ${ON}`, '  - nested decisions item', `\t${END}`, '- next');
    expect(split(text)).toEqual({
      on: body('- item', '  - nested decisions item', '- next'),
      off: body('- item', '- next'),
      hasArms: true,
    });
  });

  it('trailing spaces and tabs after a marker are part of the marker line', () => {
    const text = body(`${ON}  \t`, 'on', `${OFF} `, 'off', `${END}\t`);
    expect(split(text)).toEqual({ on: body('on'), off: body('off'), hasArms: true });
  });

  it('a marker inside a fenced block splits the fence body and keeps both fence lines', () => {
    const text = body(
      '```js',
      'const a = 1',
      ON,
      'const DECISIONS_CONTEXT = load()',
      OFF,
      'const DECISIONS_CONTEXT = "(none)"',
      END,
      'run(a)',
      '```',
    );
    expect(split(text)).toEqual({
      on: body('```js', 'const a = 1', 'const DECISIONS_CONTEXT = load()', 'run(a)', '```'),
      off: body('```js', 'const a = 1', 'const DECISIONS_CONTEXT = "(none)"', 'run(a)', '```'),
      hasArms: true,
    });
  });

  it('a marker inside an agent frontmatter block splits its skills list', () => {
    const text = body(
      '---',
      'name: Code',
      'skills:',
      '  - devflow:git',
      ON,
      '  - devflow:apply-decisions',
      END,
      '  - devflow:testing',
      '---',
      '',
      '# Code',
    );
    expect(split(text)).toEqual({
      on: body('---', 'name: Code', 'skills:', '  - devflow:git', '  - devflow:apply-decisions', '  - devflow:testing', '---', '', '# Code'),
      off: body('---', 'name: Code', 'skills:', '  - devflow:git', '  - devflow:testing', '---', '', '# Code'),
      hasArms: true,
    });
  });

  it('a body with CRLF line endings splits the same way and keeps the carriage returns it does not drop', () => {
    const text = `Before.\r\n${ON}\r\non\r\n${OFF}\r\noff\r\n${END}\r\nAfter.\r\n`;
    expect(split(text)).toEqual({
      on: 'Before.\r\non\r\nAfter.\r\n',
      off: 'Before.\r\noff\r\nAfter.\r\n',
      hasArms: true,
    });
  });

  it('LEARNING_MARKER_RE matches exactly the three whole-line markers', () => {
    for (const word of ['on', 'off', 'end']) {
      expect(LEARNING_MARKER_RE.exec(`<!-- learning:${word} -->`)?.[1]).toBe(word);
      expect(LEARNING_MARKER_RE.exec(`\t  <!-- learning:${word} -->  \t`)?.[1]).toBe(word);
    }
    for (const notMarker of [
      '<!-- learning:on --> trailing text',
      'leading text <!-- learning:on -->',
      '<!--learning:on-->',
      '<!-- learning:ON -->',
      '<!-- learning:else -->',
      '<!-- learning: on -->',
      '',
    ]) {
      expect(LEARNING_MARKER_RE.test(notMarker), JSON.stringify(notMarker)).toBe(false);
    }
  });
});

describe('what the splitter refuses (known-bad probes, AC-134)', () => {
  it('nesting: an on arm inside an on arm', () => {
    expect(refusal(body('a', ON, 'x', ON, 'y', END, END))).toEqual({
      kind: 'nested-arm', line: 4, arm: 'on', openedAt: 2,
    });
  });

  it('nesting: an on arm inside an off arm', () => {
    expect(refusal(body(OFF, 'x', ON, 'y', END, END))).toEqual({
      kind: 'nested-arm', line: 3, arm: 'off', openedAt: 1,
    });
  });

  it('nesting: a second off in one arm', () => {
    expect(refusal(body(ON, 'x', OFF, 'y', OFF, 'z', END))).toEqual({
      kind: 'repeated-off', line: 5, openedAt: 3,
    });
    expect(refusal(body(OFF, 'y', OFF, 'z', END))).toEqual({ kind: 'repeated-off', line: 3, openedAt: 1 });
  });

  it('an end with no open arm', () => {
    expect(refusal(body('a', END, 'b'))).toEqual({ kind: 'unopened-end', line: 2 });
  });

  it('an end after an arm already closed', () => {
    expect(refusal(body(ON, 'x', END, END))).toEqual({ kind: 'unopened-end', line: 4 });
  });

  it('an unclosed on arm and an unclosed off arm', () => {
    expect(refusal(body('a', ON, 'x', 'b'))).toEqual({ kind: 'unclosed-arm', arm: 'on', openedAt: 2 });
    expect(refusal(body('a', ON, 'x', OFF, 'y'))).toEqual({ kind: 'unclosed-arm', arm: 'off', openedAt: 4 });
  });

  it('an empty arm: no line between the markers', () => {
    expect(refusal(body(ON, END))).toEqual({ kind: 'empty-arm', arm: 'on', openedAt: 1, closedAt: 2 });
    expect(refusal(body('a', OFF, END))).toEqual({ kind: 'empty-arm', arm: 'off', openedAt: 2, closedAt: 3 });
  });

  it('an empty arm: only blank lines between the markers', () => {
    expect(refusal(body(ON, '', '  ', '\t', END))).toEqual({ kind: 'empty-arm', arm: 'on', openedAt: 1, closedAt: 5 });
  });

  it('an empty on arm before an else, and an empty else', () => {
    expect(refusal(body(ON, OFF, 'y', END))).toEqual({ kind: 'empty-arm', arm: 'on', openedAt: 1, closedAt: 2 });
    expect(refusal(body(ON, 'x', OFF, END))).toEqual({ kind: 'empty-arm', arm: 'off', openedAt: 3, closedAt: 4 });
  });

  it('a stray marker: a marker attempt that is not a whole line', () => {
    expect(refusal(body('a', `text ${ON}`, 'b'))).toEqual({
      kind: 'stray-marker', line: 2, text: `text ${ON}`,
    });
    expect(refusal(body('<!--learning:on-->'))).toEqual({
      kind: 'stray-marker', line: 1, text: '<!--learning:on-->',
    });
    expect(refusal(body('<!-- Learning:End -->'))).toEqual({
      kind: 'stray-marker', line: 1, text: '<!-- Learning:End -->',
    });
  });

  it('a stray marker inside an open arm is refused too, and a long stray line is quoted short', () => {
    const long = `${'x'.repeat(200)} ${ON}`;
    const error = refusal(body(ON, 'content', long, END));
    expect(error.kind).toBe('stray-marker');
    expect(error.kind === 'stray-marker' && error.text.length).toBe(80);
  });

  it('a refusal returns no partial split', () => {
    const result = splitLearningVariants(body(ON, 'x'));
    expect(result.ok).toBe(false);
    expect(result).not.toHaveProperty('value');
  });
});

describe('describeLearningSplitError', () => {
  const ONE_OF_EACH: Readonly<Record<LearningSplitError['kind'], LearningSplitError>> = {
    'nested-arm': { kind: 'nested-arm', line: 7, arm: 'on', openedAt: 3 },
    'repeated-off': { kind: 'repeated-off', line: 9, openedAt: 5 },
    'unopened-end': { kind: 'unopened-end', line: 11 },
    'unclosed-arm': { kind: 'unclosed-arm', arm: 'off', openedAt: 13 },
    'empty-arm': { kind: 'empty-arm', arm: 'on', openedAt: 15, closedAt: 16 },
    'stray-marker': { kind: 'stray-marker', line: 17, text: 'x <!-- learning:on -->' },
  };

  it('names the line of every refusal kind, one sentence each', () => {
    for (const [kind, error] of Object.entries(ONE_OF_EACH)) {
      const text = describeLearningSplitError(error);
      expect(text, kind).toMatch(/\b(line|lines) \d+|opened at line \d+/);
      expect(text.includes('\n'), `${kind}: one line`).toBe(false);
      expect(text, kind).not.toMatch(/unhandled/);
    }
  });

  it('every kind the splitter can return has a row above (the table is the union)', () => {
    const produced = new Set<string>([
      refusal(body(ON, ON)).kind,
      refusal(body(ON, 'x', OFF, 'y', OFF, END)).kind,
      refusal(body(END)).kind,
      refusal(body(ON, 'x')).kind,
      refusal(body(ON, END)).kind,
      refusal(body(`x ${ON}`)).kind,
    ]);
    expect([...produced].sort()).toEqual(Object.keys(ONE_OF_EACH).sort());
  });
});

describe('containsLearningMarker', () => {
  it('sees a valid marker, a malformed one and one embedded in prose', () => {
    expect(containsLearningMarker(`a\n${ON}\nb`)).toBe(true);
    expect(containsLearningMarker('<!--learning:end-->')).toBe(true);
    expect(containsLearningMarker('see <!-- Learning : off --> here')).toBe(true);
  });

  it('is false for text that only mentions learning', () => {
    expect(containsLearningMarker('learning:on is a settings field\n<!-- an ordinary comment -->')).toBe(false);
    expect(containsLearningMarker('')).toBe(false);
  });
});

describe('where the learning-off variant lands', () => {
  it('learningOffRelPath puts a variant beside its kind under dist/learning-off', () => {
    expect(LEARNING_OFF_OUTPUT_DIR).toBe('dist/learning-off');
    expect(learningOffRelPath('commands', 'implement.md')).toBe('dist/learning-off/commands/implement.md');
    expect(learningOffRelPath('agents', 'code.md')).toBe('dist/learning-off/agents/code.md');
  });
});

describe('parity over generated bodies', () => {
  /** A small deterministic generator, so a failure replays from its seed. */
  function lcg(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 0x100000000;
    };
  }

  const MAX_CASES = 200;
  const MAX_SEGMENTS = 8;

  it('the on variant is the body with every on arm kept and the off variant the body with every off arm kept', () => {
    let withArms = 0;
    for (let seed = 1; seed <= MAX_CASES; seed++) {
      const next = lcg(seed);
      const lines: string[] = [];
      const wantOn: string[] = [];
      const wantOff: string[] = [];
      const segments = 1 + Math.floor(next() * MAX_SEGMENTS);
      for (let s = 0; s < segments; s++) {
        const kind = next();
        const indent = next() < 0.3 ? '  ' : '';
        if (kind < 0.4) {
          const plain = `${indent}plain ${seed}.${s}`;
          lines.push(plain);
          wantOn.push(plain);
          wantOff.push(plain);
        } else if (kind < 0.6) {
          const onLine = `${indent}only-on ${seed}.${s}`;
          lines.push(`${indent}${ON}`, onLine, `${indent}${END}`);
          wantOn.push(onLine);
        } else if (kind < 0.8) {
          const offLine = `${indent}only-off ${seed}.${s}`;
          lines.push(`${indent}${OFF}`, offLine, `${indent}${END}`);
          wantOff.push(offLine);
        } else {
          const onLine = `${indent}if-on ${seed}.${s}`;
          const offLine = `${indent}else-off ${seed}.${s}`;
          lines.push(`${indent}${ON}`, onLine, `${indent}${OFF}`, offLine, `${indent}${END}`);
          wantOn.push(onLine);
          wantOff.push(offLine);
        }
      }
      const got = split(`${lines.join('\n')}\n`);
      expect(got.on, `seed ${seed}`).toBe(`${wantOn.join('\n')}${wantOn.length > 0 ? '\n' : ''}`);
      expect(got.off, `seed ${seed}`).toBe(`${wantOff.join('\n')}${wantOff.length > 0 ? '\n' : ''}`);
      if (got.hasArms) withArms++;
      expect(got.hasArms, `seed ${seed}`).toBe(lines.some(l => LEARNING_MARKER_RE.test(l)));
    }
    // Non-vacuity: the generator reaches both shapes.
    expect(withArms, 'no generated body carried an arm').toBeGreaterThan(MAX_CASES / 2);
    expect(withArms, 'every generated body carried an arm').toBeLessThan(MAX_CASES);
  });
});
