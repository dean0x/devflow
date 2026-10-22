/**
 * Unit tests for src/core/curation-variants.ts: the splitter that turns one
 * compiled prompt body into its variants, on two marker axes (curation and
 * compliance) (D-LEARNING-VARIANTS; AC-127, AC-134).
 *
 * Every refusal is shown by a known-bad probe: a seeded body that must be refused
 * with that kind and that line, so a splitter that stopped refusing is named here.
 * Every arm of the happy path is asserted on exact bytes, because the contract is
 * byte-for-byte: a marker line goes whole, every other line stays as written.
 */

import { describe, it, expect } from 'vitest';
import {
  BOTH_OFF_OUTPUT_DIR,
  COMPLIANCE_OFF_OUTPUT_DIR,
  CURATION_OFF_OUTPUT_DIR,
  LEGACY_OFF_OUTPUT_DIR,
  VARIANT_KEYS,
  VARIANT_MARKER_RE,
  containsCurationMarker,
  describeCurationSplitError,
  describeVariantSplitError,
  curationOffRelPath,
  splitCurationVariants,
  splitVariants,
  type CurationSplit,
  type VariantSplit,
  type VariantSplitError,
} from '../../src/core/curation-variants.js';

const ON = '<!-- curation:on -->';
const OFF = '<!-- curation:off -->';
const END = '<!-- curation:end -->';
const CON = '<!-- compliance:on -->';
const COFF = '<!-- compliance:off -->';
const CEND = '<!-- compliance:end -->';

/** Join lines the way a file holds them, ending in a newline. */
function body(...lines: string[]): string {
  return `${lines.join('\n')}\n`;
}

/** Split and unwrap, failing the test (not throwing in the module) on a refusal. */
function split(text: string): CurationSplit {
  const result = splitCurationVariants(text);
  if (!result.ok) throw new Error(`expected a split, got ${JSON.stringify(result.error)}`);
  return result.value;
}

/** Split and unwrap the refusal. */
function refusal(text: string): VariantSplitError {
  const result = splitCurationVariants(text);
  if (result.ok) throw new Error(`expected a refusal, got a split with hasArms=${result.value.hasArms}`);
  return result.error;
}

/** Split on both axes and unwrap, failing the test (not throwing in the module) on a refusal. */
function splitBoth(text: string): VariantSplit {
  const result = splitVariants(text);
  if (!result.ok) throw new Error(`expected a split, got ${JSON.stringify(result.error)}`);
  return result.value;
}

/** Split on both axes and unwrap the refusal. */
function refusalBoth(text: string): VariantSplitError {
  const result = splitVariants(text);
  if (result.ok) throw new Error(`expected a refusal, got a split with hasArms=${JSON.stringify(result.value.hasArms)}`);
  return result.error;
}

describe('a body with no marker', () => {
  it.each([
    ['empty', ''],
    ['one line, no newline', 'Just text.'],
    ['two paragraphs with a trailing newline', 'One.\n\nTwo.\n'],
    ['a curation word that is not a marker', 'Curation is on; see curation:on in the docs.\n'],
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

  it('VARIANT_MARKER_RE matches exactly the six whole-line markers, and names the axis and the word', () => {
    for (const axis of ['curation', 'compliance']) {
      for (const word of ['on', 'off', 'end']) {
        const bare = VARIANT_MARKER_RE.exec(`<!-- ${axis}:${word} -->`);
        expect([bare?.[1], bare?.[2]]).toEqual([axis, word]);
        const padded = VARIANT_MARKER_RE.exec(`\t  <!-- ${axis}:${word} -->  \t`);
        expect([padded?.[1], padded?.[2]]).toEqual([axis, word]);
      }
    }
    for (const notMarker of [
      '<!-- curation:on --> trailing text',
      'leading text <!-- curation:on -->',
      '<!--curation:on-->',
      '<!-- curation:ON -->',
      '<!-- curation:else -->',
      '<!-- curation: on -->',
      '<!-- compliance:on --> trailing text',
      'leading text <!-- compliance:end -->',
      '<!--compliance:on-->',
      '<!-- compliance:ON -->',
      '<!-- compliance:else -->',
      '<!-- compliance: on -->',
      '<!-- privacy:on -->',
      '',
    ]) {
      expect(VARIANT_MARKER_RE.test(notMarker), JSON.stringify(notMarker)).toBe(false);
    }
  });
});

describe('what the splitter refuses (known-bad probes, AC-134)', () => {
  it('nesting: an on arm inside an on arm', () => {
    expect(refusal(body('a', ON, 'x', ON, 'y', END, END))).toEqual({
      kind: 'nested-arm', axis: 'curation', line: 4, arm: 'on', openedAt: 2,
    });
  });

  it('nesting: an on arm inside an off arm', () => {
    expect(refusal(body(OFF, 'x', ON, 'y', END, END))).toEqual({
      kind: 'nested-arm', axis: 'curation', line: 3, arm: 'off', openedAt: 1,
    });
  });

  it('nesting: a second off in one arm', () => {
    expect(refusal(body(ON, 'x', OFF, 'y', OFF, 'z', END))).toEqual({
      kind: 'repeated-off', axis: 'curation', line: 5, openedAt: 3,
    });
    expect(refusal(body(OFF, 'y', OFF, 'z', END))).toEqual({
      kind: 'repeated-off', axis: 'curation', line: 3, openedAt: 1,
    });
  });

  it('an end with no open arm', () => {
    expect(refusal(body('a', END, 'b'))).toEqual({ kind: 'unopened-end', axis: 'curation', line: 2 });
  });

  it('an end after an arm already closed', () => {
    expect(refusal(body(ON, 'x', END, END))).toEqual({ kind: 'unopened-end', axis: 'curation', line: 4 });
  });

  it('an unclosed on arm and an unclosed off arm', () => {
    expect(refusal(body('a', ON, 'x', 'b'))).toEqual({
      kind: 'unclosed-arm', axis: 'curation', arm: 'on', openedAt: 2,
    });
    expect(refusal(body('a', ON, 'x', OFF, 'y'))).toEqual({
      kind: 'unclosed-arm', axis: 'curation', arm: 'off', openedAt: 4,
    });
  });

  it('an empty arm: no line between the markers', () => {
    expect(refusal(body(ON, END))).toEqual({
      kind: 'empty-arm', axis: 'curation', arm: 'on', openedAt: 1, closedAt: 2,
    });
    expect(refusal(body('a', OFF, END))).toEqual({
      kind: 'empty-arm', axis: 'curation', arm: 'off', openedAt: 2, closedAt: 3,
    });
  });

  it('an empty arm: only blank lines between the markers', () => {
    expect(refusal(body(ON, '', '  ', '\t', END))).toEqual({
      kind: 'empty-arm', axis: 'curation', arm: 'on', openedAt: 1, closedAt: 5,
    });
  });

  it('an empty on arm before an else, and an empty else', () => {
    expect(refusal(body(ON, OFF, 'y', END))).toEqual({
      kind: 'empty-arm', axis: 'curation', arm: 'on', openedAt: 1, closedAt: 2,
    });
    expect(refusal(body(ON, 'x', OFF, END))).toEqual({
      kind: 'empty-arm', axis: 'curation', arm: 'off', openedAt: 3, closedAt: 4,
    });
  });

  it('a stray marker: a marker attempt that is not a whole line', () => {
    expect(refusal(body('a', `text ${ON}`, 'b'))).toEqual({
      kind: 'stray-marker', axis: 'curation', line: 2, text: `text ${ON}`,
    });
    expect(refusal(body('<!--curation:on-->'))).toEqual({
      kind: 'stray-marker', axis: 'curation', line: 1, text: '<!--curation:on-->',
    });
    expect(refusal(body('<!-- Curation:End -->'))).toEqual({
      kind: 'stray-marker', axis: 'curation', line: 1, text: '<!-- Curation:End -->',
    });
  });

  it('a stray marker inside an open arm is refused too, and a long stray line is quoted short', () => {
    const long = `${'x'.repeat(200)} ${ON}`;
    const error = refusal(body(ON, 'content', long, END));
    expect(error.kind).toBe('stray-marker');
    expect(error.kind === 'stray-marker' && error.text.length).toBe(80);
  });

  it('a retired marker is refused in any spacing or case, whole line or embedded (TP-4)', () => {
    const spellings = [
      '<!-- learning:on -->',
      '<!-- learning:off -->',
      '<!-- learning:end -->',
      '<!--learning:on-->',
      '<!-- Learning:End -->',
      '<!-- LEARNING : OFF -->',
      '\t<!--   learning :on-->  ',
      'text <!-- learning:on --> more text',
    ];
    for (const spelling of spellings) {
      expect(refusal(body('a', spelling, 'b')), JSON.stringify(spelling)).toEqual({
        kind: 'legacy-marker', line: 2, text: spelling.trim(),
      });
    }
  });

  it('a retired marker is never an alias: it is refused inside a current arm and beside current markers', () => {
    expect(refusal(body(ON, 'content', '<!-- learning:off -->', 'other', END))).toEqual({
      kind: 'legacy-marker', line: 3, text: '<!-- learning:off -->',
    });
    expect(refusal(body('<!-- learning:on -->', 'content', END))).toEqual({
      kind: 'legacy-marker', line: 1, text: '<!-- learning:on -->',
    });
  });

  it('a refusal returns no partial split', () => {
    const result = splitCurationVariants(body(ON, 'x'));
    expect(result.ok).toBe(false);
    expect(result).not.toHaveProperty('value');
  });
});

describe('the two-axis split (TP-1)', () => {
  it('yields four bodies, keeping a line only where every open arm matches', () => {
    const text = body('Head.', ON, 'c-on', OFF, 'c-off', END, 'Mid.', CON, 'p-on', COFF, 'p-off', CEND, 'Tail.');
    expect(splitBoth(text)).toEqual({
      bodies: {
        on: body('Head.', 'c-on', 'Mid.', 'p-on', 'Tail.'),
        'curation-off': body('Head.', 'c-off', 'Mid.', 'p-on', 'Tail.'),
        'compliance-off': body('Head.', 'c-on', 'Mid.', 'p-off', 'Tail.'),
        'both-off': body('Head.', 'c-off', 'Mid.', 'p-off', 'Tail.'),
      },
      hasArms: { curation: true, compliance: true },
    });
  });

  it('keys the bodies by exactly the four variant names', () => {
    expect([...VARIANT_KEYS]).toEqual(['on', 'curation-off', 'compliance-off', 'both-off']);
    expect(Object.keys(splitBoth('Just text.\n').bodies).sort()).toEqual([...VARIANT_KEYS].sort());
  });

  it('reports one hasArms flag per axis', () => {
    expect(splitBoth(body('a', ON, 'x', END)).hasArms).toEqual({ curation: true, compliance: false });
    expect(splitBoth(body('a', CON, 'x', CEND)).hasArms).toEqual({ curation: false, compliance: true });
    expect(splitBoth(body('a', 'b')).hasArms).toEqual({ curation: false, compliance: false });
  });

  it('a body with no marker is every variant, byte for byte', () => {
    for (const text of ['', 'Just text.', 'One.\n\nTwo.\n', 'The compliance:on setting; <!-- an ordinary comment -->\n']) {
      const { bodies } = splitBoth(text);
      for (const key of VARIANT_KEYS) expect(bodies[key], `${key}: ${JSON.stringify(text)}`).toBe(text);
    }
  });

  it('a compliance arm has an else, and a standalone off arm is kept only where compliance is off', () => {
    const text = body('Head.', CON, 'p-on', COFF, 'p-off', CEND, COFF, 'only-off', CEND, 'Tail.');
    expect(splitBoth(text).bodies).toEqual({
      on: body('Head.', 'p-on', 'Tail.'),
      'curation-off': body('Head.', 'p-on', 'Tail.'),
      'compliance-off': body('Head.', 'p-off', 'only-off', 'Tail.'),
      'both-off': body('Head.', 'p-off', 'only-off', 'Tail.'),
    });
  });

  it('compliance markers keep their indentation rules: indented, inside a fence, with CRLF', () => {
    const fenced = body('```', 'a', `  ${CON}`, '  p-on', `\t${COFF}`, '  p-off', `${CEND}  `, '```');
    expect(splitBoth(fenced).bodies.on).toBe(body('```', 'a', '  p-on', '```'));
    expect(splitBoth(fenced).bodies['compliance-off']).toBe(body('```', 'a', '  p-off', '```'));
    const crlf = `Before.\r\n${CON}\r\non\r\n${COFF}\r\noff\r\n${CEND}\r\nAfter.\r\n`;
    expect(splitBoth(crlf).bodies.on).toBe('Before.\r\non\r\nAfter.\r\n');
    expect(splitBoth(crlf).bodies['both-off']).toBe('Before.\r\noff\r\nAfter.\r\n');
  });

  it('the curation projection keeps the compliance-on side and ignores compliance in its flag', () => {
    const text = body('Head.', ON, 'c-on', OFF, 'c-off', END, CON, 'p-on', COFF, 'p-off', CEND, 'Tail.');
    expect(split(text)).toEqual({
      on: body('Head.', 'c-on', 'p-on', 'Tail.'),
      off: body('Head.', 'c-off', 'p-on', 'Tail.'),
      hasArms: true,
    });
    expect(split(body('Head.', CON, 'p-on', COFF, 'p-off', CEND)).hasArms).toBe(false);
  });
});

describe('a body with no compliance marker (TP-2)', () => {
  const CASES: ReadonlyArray<readonly [label: string, text: string, wantOn: string, wantOff: string]> = [
    ['no marker at all', 'One.\n\nTwo.\n', 'One.\n\nTwo.\n', 'One.\n\nTwo.\n'],
    [
      'an on arm with its else',
      body('Before.', ON, 'On text.', OFF, 'Off text.', END, 'After.'),
      body('Before.', 'On text.', 'After.'),
      body('Before.', 'Off text.', 'After.'),
    ],
    [
      'several arms and a standalone off arm',
      body('A', ON, 'on-1', END, 'B', ON, 'on-2', OFF, 'off-2', END, 'C', OFF, 'off-3', END, 'D'),
      body('A', 'on-1', 'B', 'on-2', 'C', 'D'),
      body('A', 'B', 'off-2', 'C', 'off-3', 'D'),
    ],
    [
      'indented markers in a list',
      body('- item', `  ${ON}`, '  - nested decisions item', `\t${END}`, '- next'),
      body('- item', '  - nested decisions item', '- next'),
      body('- item', '- next'),
    ],
    [
      'CRLF line endings',
      `Before.\r\n${ON}\r\non\r\n${OFF}\r\noff\r\n${END}\r\nAfter.\r\n`,
      'Before.\r\non\r\nAfter.\r\n',
      'Before.\r\noff\r\nAfter.\r\n',
    ],
  ];

  it.each(CASES)('%s: the curation bytes are the same in both compliance states', (_label, text, wantOn, wantOff) => {
    const { bodies, hasArms } = splitBoth(text);
    expect(bodies.on).toBe(wantOn);
    expect(bodies['compliance-off']).toBe(wantOn);
    expect(bodies['curation-off']).toBe(wantOff);
    expect(bodies['both-off']).toBe(wantOff);
    expect(hasArms.compliance).toBe(false);
    expect(split(text)).toEqual({ on: wantOn, off: wantOff, hasArms: hasArms.curation });
  });

  it('a refusal is the same refusal from the two-axis split and from the curation projection', () => {
    for (const text of [body(ON, ON), body(END), body(ON, 'x'), body(ON, END), body(`x ${ON}`), body('<!-- learning:on -->')]) {
      expect(splitVariants(text)).toEqual(splitCurationVariants(text));
    }
  });
});

describe('what the two-axis split refuses (TP-3)', () => {
  it('nesting within one axis: a compliance on arm inside a compliance arm', () => {
    expect(refusalBoth(body('a', CON, 'x', CON, 'y', CEND, CEND))).toEqual({
      kind: 'nested-arm', axis: 'compliance', line: 4, arm: 'on', openedAt: 2,
    });
    expect(refusalBoth(body(COFF, 'x', CON, 'y', CEND, CEND))).toEqual({
      kind: 'nested-arm', axis: 'compliance', line: 3, arm: 'off', openedAt: 1,
    });
  });

  it('nesting within one axis is refused even when an arm of the other axis sits between', () => {
    expect(refusalBoth(body(CON, ON, 'x', CON, 'y', CEND, END, CEND))).toEqual({
      kind: 'nested-arm', axis: 'compliance', line: 4, arm: 'on', openedAt: 1,
    });
    expect(refusalBoth(body(ON, CON, 'x', ON, 'y', END, CEND, END))).toEqual({
      kind: 'nested-arm', axis: 'curation', line: 4, arm: 'on', openedAt: 1,
    });
  });

  it('a second compliance off in one arm', () => {
    expect(refusalBoth(body(CON, 'x', COFF, 'y', COFF, 'z', CEND))).toEqual({
      kind: 'repeated-off', axis: 'compliance', line: 5, openedAt: 3,
    });
  });

  it('interleaved arms: the outer arm closes before the inner one', () => {
    expect(refusalBoth(body(ON, 'x', CON, 'y', END, 'z', CEND))).toEqual({
      kind: 'interleaved-arm', axis: 'curation', marker: 'end', line: 5, openedAt: 1, innerAxis: 'compliance', innerOpenedAt: 3,
    });
    expect(refusalBoth(body(CON, 'x', ON, 'y', CEND, 'z', END))).toEqual({
      kind: 'interleaved-arm', axis: 'compliance', marker: 'end', line: 5, openedAt: 1, innerAxis: 'curation', innerOpenedAt: 3,
    });
  });

  it('interleaved arms: the outer arm turns to its else while the inner one is open', () => {
    expect(refusalBoth(body(ON, 'x', CON, 'y', OFF, 'z', END, 'w', CEND))).toEqual({
      kind: 'interleaved-arm', axis: 'curation', marker: 'off', line: 5, openedAt: 1, innerAxis: 'compliance', innerOpenedAt: 3,
    });
  });

  it('an empty compliance arm: no line, or only blank lines, between the markers', () => {
    expect(refusalBoth(body(CON, CEND))).toEqual({
      kind: 'empty-arm', axis: 'compliance', arm: 'on', openedAt: 1, closedAt: 2,
    });
    expect(refusalBoth(body('a', COFF, '', '  ', CEND))).toEqual({
      kind: 'empty-arm', axis: 'compliance', arm: 'off', openedAt: 2, closedAt: 5,
    });
    expect(refusalBoth(body(CON, COFF, 'y', CEND))).toEqual({
      kind: 'empty-arm', axis: 'compliance', arm: 'on', openedAt: 1, closedAt: 2,
    });
    expect(refusalBoth(body(CON, 'x', COFF, CEND))).toEqual({
      kind: 'empty-arm', axis: 'compliance', arm: 'off', openedAt: 3, closedAt: 4,
    });
  });

  it('an empty arm inside an arm of the other axis is still empty', () => {
    expect(refusalBoth(body(ON, 'x', CON, CEND, END))).toEqual({
      kind: 'empty-arm', axis: 'compliance', arm: 'on', openedAt: 3, closedAt: 4,
    });
  });

  it('an unclosed compliance arm, and the innermost one when two are open', () => {
    expect(refusalBoth(body('a', CON, 'x', 'b'))).toEqual({
      kind: 'unclosed-arm', axis: 'compliance', arm: 'on', openedAt: 2,
    });
    expect(refusalBoth(body('a', CON, 'x', COFF, 'y'))).toEqual({
      kind: 'unclosed-arm', axis: 'compliance', arm: 'off', openedAt: 4,
    });
    expect(refusalBoth(body(ON, 'x', CON, 'y'))).toEqual({
      kind: 'unclosed-arm', axis: 'compliance', arm: 'on', openedAt: 3,
    });
    expect(refusalBoth(body(ON, 'x', CON, 'y', CEND))).toEqual({
      kind: 'unclosed-arm', axis: 'curation', arm: 'on', openedAt: 1,
    });
  });

  it('a compliance end with no open compliance arm, whatever the other axis has open', () => {
    expect(refusalBoth(body('a', CEND, 'b'))).toEqual({ kind: 'unopened-end', axis: 'compliance', line: 2 });
    expect(refusalBoth(body(CON, 'x', CEND, CEND))).toEqual({ kind: 'unopened-end', axis: 'compliance', line: 4 });
    expect(refusalBoth(body(ON, 'x', CEND, END))).toEqual({ kind: 'unopened-end', axis: 'compliance', line: 3 });
  });

  it('a stray compliance marker: an attempt that is not a whole line', () => {
    for (const stray of [`text ${CON}`, '<!--compliance:on-->', '<!-- Compliance:End -->', '<!-- compliance:ON -->']) {
      expect(refusalBoth(body('a', stray, 'b')), JSON.stringify(stray)).toEqual({
        kind: 'stray-marker', axis: 'compliance', line: 2, text: stray,
      });
    }
  });

  it('a stray compliance marker inside an open arm of the other axis, quoted short when long', () => {
    const error = refusalBoth(body(ON, 'content', `${'x'.repeat(200)} ${CEND}`, END));
    expect(error.kind).toBe('stray-marker');
    expect(error.kind === 'stray-marker' && error.axis).toBe('compliance');
    expect(error.kind === 'stray-marker' && error.text.length).toBe(80);
  });

  it('a retired marker is refused beside compliance markers too', () => {
    expect(refusalBoth(body(CON, 'content', '<!-- learning:off -->', CEND))).toEqual({
      kind: 'legacy-marker', line: 3, text: '<!-- learning:off -->',
    });
  });

  it('a refusal returns no partial split', () => {
    const result = splitVariants(body(CON, 'x'));
    expect(result.ok).toBe(false);
    expect(result).not.toHaveProperty('value');
  });
});

describe('one axis nested inside the other (TP-4)', () => {
  it('a compliance arm inside a curation arm, in both its on part and its else', () => {
    const text = body(
      'Head.', ON, 'c-on', CON, 'p-on', COFF, 'p-off', CEND, 'c-on-tail', OFF, 'c-off', END, 'Tail.',
    );
    expect(splitBoth(text)).toEqual({
      bodies: {
        on: body('Head.', 'c-on', 'p-on', 'c-on-tail', 'Tail.'),
        'curation-off': body('Head.', 'c-off', 'Tail.'),
        'compliance-off': body('Head.', 'c-on', 'p-off', 'c-on-tail', 'Tail.'),
        'both-off': body('Head.', 'c-off', 'Tail.'),
      },
      hasArms: { curation: true, compliance: true },
    });
  });

  it('a curation arm inside a compliance arm', () => {
    const text = body('Head.', CON, 'p-on', ON, 'c-on', OFF, 'c-off', END, CEND, 'Tail.');
    expect(splitBoth(text).bodies).toEqual({
      on: body('Head.', 'p-on', 'c-on', 'Tail.'),
      'curation-off': body('Head.', 'p-on', 'c-off', 'Tail.'),
      'compliance-off': body('Head.', 'Tail.'),
      'both-off': body('Head.', 'Tail.'),
    });
  });

  it('an outer arm whose only content is the inner arm is not empty', () => {
    const text = body('Head.', ON, CON, 'p', CEND, END, 'Tail.');
    expect(splitBoth(text).bodies).toEqual({
      on: body('Head.', 'p', 'Tail.'),
      'curation-off': body('Head.', 'Tail.'),
      'compliance-off': body('Head.', 'Tail.'),
      'both-off': body('Head.', 'Tail.'),
    });
  });

  it('an inner arm inside the else of the outer axis', () => {
    const text = body('Head.', OFF, CON, 'q', COFF, 'r', CEND, END, 'Tail.');
    expect(splitBoth(text).bodies).toEqual({
      on: body('Head.', 'Tail.'),
      'curation-off': body('Head.', 'q', 'Tail.'),
      'compliance-off': body('Head.', 'Tail.'),
      'both-off': body('Head.', 'r', 'Tail.'),
    });
  });

  it('two nested groups in one body, one nested each way', () => {
    const text = body('H', ON, 'a', CON, 'b', CEND, END, CON, 'c', ON, 'd', END, CEND, 'T');
    expect(splitBoth(text).bodies).toEqual({
      on: body('H', 'a', 'b', 'c', 'd', 'T'),
      'curation-off': body('H', 'c', 'T'),
      'compliance-off': body('H', 'a', 'T'),
      'both-off': body('H', 'T'),
    });
  });
});

describe('parity over generated two-axis bodies', () => {
  type Axis = 'curation' | 'compliance';
  type State = Readonly<Record<Axis, 'on' | 'off'>>;
  const MARKERS: Readonly<Record<Axis, readonly [string, string, string]>> = {
    curation: [ON, OFF, END],
    compliance: [CON, COFF, CEND],
  };
  const STATES: Readonly<Record<(typeof VARIANT_KEYS)[number], State>> = {
    on: { curation: 'on', compliance: 'on' },
    'curation-off': { curation: 'off', compliance: 'on' },
    'compliance-off': { curation: 'on', compliance: 'off' },
    'both-off': { curation: 'off', compliance: 'off' },
  };

  function lcg(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 0x100000000;
    };
  }

  /** A generated piece: its source lines, and the lines each variant keeps, from an oracle that never reads the markers. */
  interface Piece {
    readonly lines: readonly string[];
    readonly kept: (state: State) => readonly string[];
  }

  function arm(axis: Axis, id: string, withElse: boolean, onSide: boolean): Piece {
    const [on, off, end] = MARKERS[axis];
    const onText = `${axis}-on ${id}`;
    const offText = `${axis}-off ${id}`;
    if (onSide && withElse) {
      return { lines: [on, onText, off, offText, end], kept: s => (s[axis] === 'on' ? [onText] : [offText]) };
    }
    if (onSide) {
      return { lines: [on, onText, end], kept: s => (s[axis] === 'on' ? [onText] : []) };
    }
    return { lines: [off, offText, end], kept: s => (s[axis] === 'off' ? [offText] : []) };
  }

  const MAX_CASES = 200;
  const MAX_SEGMENTS = 8;

  it('every variant is the body with the arms it matches kept, nested or not', () => {
    let nested = 0;
    for (let seed = 1; seed <= MAX_CASES; seed++) {
      const next = lcg(seed);
      const pieces: Piece[] = [];
      const segments = 1 + Math.floor(next() * MAX_SEGMENTS);
      for (let s = 0; s < segments; s++) {
        const id = `${seed}.${s}`;
        const axis: Axis = next() < 0.5 ? 'curation' : 'compliance';
        const other: Axis = axis === 'curation' ? 'compliance' : 'curation';
        const kind = next();
        if (kind < 0.3) {
          const plain = `plain ${id}`;
          pieces.push({ lines: [plain], kept: () => [plain] });
        } else if (kind < 0.7) {
          pieces.push(arm(axis, id, next() < 0.5, next() < 0.7));
        } else {
          // An outer arm that holds a line, an inner arm of the other axis, and a line.
          nested++;
          const [on, , end] = MARKERS[axis];
          const inner = arm(other, `${id}.in`, next() < 0.5, next() < 0.7);
          const head = `head ${id}`;
          const tail = `tail ${id}`;
          pieces.push({
            lines: [on, head, ...inner.lines, tail, end],
            kept: st => (st[axis] === 'on' ? [head, ...inner.kept(st), tail] : []),
          });
        }
      }
      const got = splitBoth(`${pieces.flatMap(p => p.lines).join('\n')}\n`);
      for (const key of VARIANT_KEYS) {
        const want = pieces.flatMap(p => p.kept(STATES[key]));
        expect(got.bodies[key], `seed ${seed}, ${key}`).toBe(`${want.join('\n')}${want.length > 0 ? '\n' : ''}`);
      }
    }
    expect(nested, 'no generated body nested one axis in the other').toBeGreaterThan(MAX_CASES / 4);
  });
});

describe('describeVariantSplitError', () => {
  const ONE_OF_EACH: Readonly<Record<VariantSplitError['kind'], VariantSplitError>> = {
    'nested-arm': { kind: 'nested-arm', axis: 'compliance', line: 7, arm: 'on', openedAt: 3 },
    'interleaved-arm': {
      kind: 'interleaved-arm', axis: 'curation', marker: 'end', line: 8, openedAt: 2, innerAxis: 'compliance', innerOpenedAt: 4,
    },
    'repeated-off': { kind: 'repeated-off', axis: 'compliance', line: 9, openedAt: 5 },
    'unopened-end': { kind: 'unopened-end', axis: 'compliance', line: 11 },
    'unclosed-arm': { kind: 'unclosed-arm', axis: 'compliance', arm: 'off', openedAt: 13 },
    'empty-arm': { kind: 'empty-arm', axis: 'compliance', arm: 'on', openedAt: 15, closedAt: 16 },
    'stray-marker': { kind: 'stray-marker', axis: 'compliance', line: 17, text: 'x <!-- compliance:on -->' },
    'legacy-marker': { kind: 'legacy-marker', line: 19, text: '<!-- learning:on -->' },
  };

  it('names the line of every refusal kind, one sentence each', () => {
    for (const [kind, error] of Object.entries(ONE_OF_EACH)) {
      const text = describeVariantSplitError(error);
      expect(text, kind).toMatch(/\b(line|lines) \d+|opened at line \d+/);
      expect(text.includes('\n'), `${kind}: one line`).toBe(false);
      expect(text, kind).not.toMatch(/unhandled/);
    }
  });

  it('names the axis of every refusal that has one, so a compliance fault is not reported as a curation fault', () => {
    for (const [kind, error] of Object.entries(ONE_OF_EACH)) {
      if (kind === 'legacy-marker' || kind === 'interleaved-arm') continue;
      const text = describeVariantSplitError(error);
      expect(text, kind).toMatch(/compliance/);
      expect(text, kind).not.toMatch(/curation/);
    }
  });

  it('an interleaving names both arms and both lines', () => {
    const text = describeVariantSplitError(ONE_OF_EACH['interleaved-arm']);
    expect(text).toContain('line 8');
    expect(text).toContain('line 2');
    expect(text).toContain('line 4');
    expect(text).toContain('curation:end');
    expect(text).toContain('compliance');
  });

  it('the curation-named describer is the same function, kept for the build as it stands', () => {
    expect(describeCurationSplitError).toBe(describeVariantSplitError);
  });

  it('every kind the splitter can return has a row above (the table is the union)', () => {
    const produced = new Set<string>([
      refusal(body(ON, ON)).kind,
      refusalBoth(body(ON, 'x', CON, 'y', END, 'z', CEND)).kind,
      refusal(body(ON, 'x', OFF, 'y', OFF, END)).kind,
      refusal(body(END)).kind,
      refusal(body(ON, 'x')).kind,
      refusal(body(ON, END)).kind,
      refusal(body(`x ${ON}`)).kind,
      refusal(body('<!-- learning:on -->')).kind,
    ]);
    expect([...produced].sort()).toEqual(Object.keys(ONE_OF_EACH).sort());
  });
});

describe('containsCurationMarker', () => {
  it('sees a valid marker, a malformed one and one embedded in prose', () => {
    expect(containsCurationMarker(`a\n${ON}\nb`)).toBe(true);
    expect(containsCurationMarker('<!--curation:end-->')).toBe(true);
    expect(containsCurationMarker('see <!-- Curation : off --> here')).toBe(true);
  });

  it('is false for text that only mentions curation', () => {
    expect(containsCurationMarker('curation:on is a settings field\n<!-- an ordinary comment -->')).toBe(false);
    expect(containsCurationMarker('')).toBe(false);
  });

  it('also sees the retired spelling, in any spacing or case', () => {
    expect(containsCurationMarker('<!-- learning:on -->')).toBe(true);
    expect(containsCurationMarker('<!--learning:end-->')).toBe(true);
    expect(containsCurationMarker('see <!-- LEARNING : off --> here')).toBe(true);
    expect(containsCurationMarker('learning:on is only a word here')).toBe(false);
  });
});

describe('where the curation-off variant lands', () => {
  it('curationOffRelPath puts a variant beside its kind under dist/curation-off', () => {
    expect(CURATION_OFF_OUTPUT_DIR).toBe('dist/curation-off');
    expect(curationOffRelPath('commands', 'implement.md')).toBe('dist/curation-off/commands/implement.md');
    expect(curationOffRelPath('agents', 'code.md')).toBe('dist/curation-off/agents/code.md');
  });

  it('the retired off tree is a different folder under dist, so the prune never touches the live one', () => {
    expect(LEGACY_OFF_OUTPUT_DIR).toBe('dist/learning-off');
    expect(LEGACY_OFF_OUTPUT_DIR).not.toBe(CURATION_OFF_OUTPUT_DIR);
    expect(CURATION_OFF_OUTPUT_DIR.startsWith(`${LEGACY_OFF_OUTPUT_DIR}/`)).toBe(false);
    expect(LEGACY_OFF_OUTPUT_DIR.startsWith(`${CURATION_OFF_OUTPUT_DIR}/`)).toBe(false);
  });

  it('the compliance-off and both-off trees are named under dist, and no tree sits inside another', () => {
    expect(COMPLIANCE_OFF_OUTPUT_DIR).toBe('dist/compliance-off');
    expect(BOTH_OFF_OUTPUT_DIR).toBe('dist/curation-compliance-off');
    const trees = [CURATION_OFF_OUTPUT_DIR, COMPLIANCE_OFF_OUTPUT_DIR, BOTH_OFF_OUTPUT_DIR, LEGACY_OFF_OUTPUT_DIR];
    expect(new Set(trees).size).toBe(trees.length);
    for (const tree of trees) {
      for (const other of trees) {
        if (tree !== other) expect(tree.startsWith(`${other}/`), `${tree} inside ${other}`).toBe(false);
      }
    }
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
      expect(got.hasArms, `seed ${seed}`).toBe(lines.some(l => VARIANT_MARKER_RE.test(l)));
    }
    // Non-vacuity: the generator reaches both shapes.
    expect(withArms, 'no generated body carried an arm').toBeGreaterThan(MAX_CASES / 2);
    expect(withArms, 'every generated body carried an arm').toBeLessThan(MAX_CASES);
  });
});
