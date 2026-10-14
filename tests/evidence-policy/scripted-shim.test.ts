/**
 * The shim's `%q` log decoder. The fake git and gh log every argv with
 * `printf '%q '` in the C locale, and `readLog` reads it back through
 * `decodeQuotedArgv`. A `$'…'` word is bash's spelling of any byte past ASCII, so
 * the decoder must round-trip the fixed non-ASCII spellings the resolver sends
 * (`config.jſon`, `.devﬂow`) and must refuse anything else it cannot account for
 * rather than guess: a control byte, invalid UTF-8, an unknown escape or a word
 * that never closes.
 */

import { describe, it, expect } from 'vitest';
import { decodeQuotedArgv } from './scripted-shim.js';

describe('decodeQuotedArgv: the $\'…\' words bash logs for bytes past ASCII', () => {
  it.each([
    ['plain words and an empty argument', "ls-files -z '' x", ['ls-files', '-z', '', 'x']],
    ['a ligature spelled as octal UTF-8 bytes (\\357\\254\\202)', "$'.dev\\357\\254\\202ow/config.json'", ['.devﬂow/config.json']],
    ['an escaped quote beside a long s (\\305\\277)', "$'a\\'b\\305\\277'", ["a'bſ"]],
    ['an escaped backslash', "$'a\\\\b'", ['a\\b']],
    ['a $\'…\' word joined to plain text on both sides', "x$'\\305\\277'y z", ['xſy', 'z']],
  ])('decodes %s', (_name, line, argv) => {
    expect(decodeQuotedArgv(line)).toEqual(argv);
  });

  it.each([
    ['a raw newline (a control byte)', "$'a\nb'"],
    ['a raw tab (a control byte)', "$'a\tb'"],
    ['an octal control byte (\\001)', "$'\\001'"],
    ['an octal DEL (\\177)', "$'\\177'"],
    ['bash\'s own spelling of a newline (an unknown escape, \\n)', "$'\\n'"],
    ['raw non-ASCII characters whose code points would read as UTF-8 bytes (the fake logs in the C locale)', "$'Ã©'"],
    ['an octal byte that is not UTF-8 (\\377)', "$'\\377'"],
    ['a UTF-8 sequence cut short (\\357\\254)', "$'\\357\\254'"],
    ['an unknown escape (\\q)', "$'\\q'"],
    ['an unterminated word', "$'abc"],
    ['an unterminated word that ends on a backslash', "$'abc\\"],
  ])('refuses %s', (_name, line) => {
    expect(() => decodeQuotedArgv(line)).toThrow();
  });

  it('an unterminated plain quote is refused too', () => {
    expect(() => decodeQuotedArgv("'abc")).toThrow(/unterminated quote/);
  });
});
