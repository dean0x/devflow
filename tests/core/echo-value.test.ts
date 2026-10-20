/**
 * describeEchoedValue — the one sanitizer for a value that a terminal message echoes.
 *
 * The class must cover every control character a terminal acts on: C0 (U+0000-U+001F),
 * DEL (U+007F) and C1 (U+0080-U+009F, where U+009B is the one-character CSI). A name
 * read from a repository is third-party input at this sink.
 *
 * The control characters below are written with escapes: tests/guards/no-control-bytes
 * keeps raw control bytes out of the shipped sources, and this file follows the same rule.
 */

import { describe, it, expect } from 'vitest';
import { describeEchoedValue } from '../../src/core/echo-value.js';

/** Every character the sanitizer must replace. */
const CONTROL_CHARACTERS: readonly string[] = [
  ...Array.from({ length: 0x20 }, (_, i) => String.fromCharCode(i)),
  '\x7f',
  ...Array.from({ length: 0x20 }, (_, i) => String.fromCharCode(0x80 + i)),
];

describe('describeEchoedValue: control characters', () => {
  it.each(CONTROL_CHARACTERS.map(char => [`U+${char.charCodeAt(0).toString(16).padStart(4, '0')}`, char]))(
    'replaces %s',
    (_label, char) => {
      expect(describeEchoedValue(`a${char}b`)).toBe('a?b');
    },
  );

  it('keeps an escape sequence and a newline from reaching the terminal', () => {
    const out = describeEchoedValue('evil\x1b]0;title\x07\nname\x9b31m');
    expect(out).toBe('evil?]0;title??name?31m');
  });

  it('leaves printable and non-ASCII text alone', () => {
    expect(describeEchoedValue('naïve € \u{1f600}')).toBe('naïve € \u{1f600}');
  });
});

describe('describeEchoedValue: the length bound', () => {
  it('cuts at 40 code points by default and marks the cut', () => {
    expect(describeEchoedValue('x'.repeat(41))).toBe(`${'x'.repeat(40)}…`);
    expect(describeEchoedValue('x'.repeat(40))).toBe('x'.repeat(40));
  });

  it('takes a longer bound for a message', () => {
    const message = 'y'.repeat(300);
    expect(describeEchoedValue(message, 400)).toBe(message);
    expect(describeEchoedValue(message, 100)).toBe(`${'y'.repeat(100)}…`);
  });

  it('cuts by code point, never inside an astral character', () => {
    const out = describeEchoedValue('\u{1f600}'.repeat(5), 3);
    expect(out).toBe(`${'\u{1f600}'.repeat(3)}…`);
  });

  it('falls back to the default bound for a bound that is not a positive integer', () => {
    for (const bad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(describeEchoedValue('x'.repeat(50), bad), String(bad)).toBe(`${'x'.repeat(40)}…`);
    }
  });
});

describe('describeEchoedValue: a value that is not a string', () => {
  it('renders its type', () => {
    expect(describeEchoedValue(null)).toBe('<null>');
    expect(describeEchoedValue(7)).toBe('<number>');
    expect(describeEchoedValue({ toString: () => 'x' })).toBe('<object>');
  });
});
