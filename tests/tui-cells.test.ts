/**
 * Unit tests for src/cli/tui/cells.ts — shared TUI cell helpers.
 *
 * sanitizeCell is the PF-023 sink for disk-sourced flag values (render.ts:85):
 * the point where a persisted value like `spellcheck=$'a\nb'` is stopped from
 * breaking the one-string-per-terminal-line frame contract. Tests here pin the
 * contract at the sink rather than through two renderers (agents-view and
 * flags-view).
 *
 * avoids PF-018: each assertion names a specific behavior and would fail against
 * a no-op or broken implementation of the named function.
 */

import { describe, it, expect } from 'vitest';
import { sanitizeCell, padToVisible, truncateVisible } from '../src/cli/tui/cells.js';
import { stripAnsi } from '../src/core/ansi.js';

// ---------------------------------------------------------------------------
// sanitizeCell — PF-023 sink: collapses layout-breaking whitespace, strips ANSI
// ---------------------------------------------------------------------------

describe('sanitizeCell', () => {
  it('collapses TAB to a single space', () => {
    expect(sanitizeCell('a\tb')).toBe('a b');
  });

  it('collapses LF to a single space', () => {
    expect(sanitizeCell('a\nb')).toBe('a b');
  });

  it('collapses mixed TAB and LF — each becomes one space independently', () => {
    // Each layout-breaking character collapses to a single space;
    // consecutive instances produce consecutive spaces (not folded further).
    expect(sanitizeCell('a\tb\nc')).toBe('a b c');
  });

  it('strips ANSI SGR escape sequences', () => {
    expect(sanitizeCell('\x1b[31mred\x1b[0m')).toBe('red');
  });

  it('strips ANSI then collapses layout-breaking whitespace (ANSI + TAB)', () => {
    expect(sanitizeCell('\x1b[31mred\x1b[0m\tvalue')).toBe('red value');
  });

  it('passes through plain ASCII unchanged', () => {
    expect(sanitizeCell('hello world')).toBe('hello world');
  });

  it('returns empty string for empty input', () => {
    expect(sanitizeCell('')).toBe('');
  });

  it('returns only space when input is a bare LF', () => {
    // Regression: a persisted multi-line value that is just a newline
    expect(sanitizeCell('\n')).toBe(' ');
  });
});

// ---------------------------------------------------------------------------
// padToVisible — measures visible (ANSI-stripped) length for padding
// ---------------------------------------------------------------------------

describe('padToVisible', () => {
  it('pads a plain string to the requested visible width', () => {
    expect(padToVisible('ab', 5)).toBe('ab   ');
  });

  it('measures ANSI-stripped length so styled text reaches the correct column', () => {
    // '\x1b[31mab\x1b[0m' has 2 visible chars; pad to 5 adds 3 spaces after the ANSI reset
    const result = padToVisible('\x1b[31mab\x1b[0m', 5);
    expect(stripAnsi(result)).toBe('ab   ');
    expect(stripAnsi(result).length).toBe(5);
  });

  it('adds no padding when the visible length already equals width', () => {
    expect(padToVisible('hello', 5)).toBe('hello');
  });

  it('adds no padding and does NOT truncate when visible length exceeds width', () => {
    // padToVisible is a padding function only — no truncation side-effect
    expect(padToVisible('toolong', 4)).toBe('toolong');
  });

  it('pads to width 1 from an empty string', () => {
    expect(padToVisible('', 1)).toBe(' ');
  });
});

// ---------------------------------------------------------------------------
// truncateVisible — drops styling across truncation boundary; unchanged when fits
// ---------------------------------------------------------------------------

describe('truncateVisible', () => {
  it('returns the original plain string unchanged when visible length fits within maxWidth', () => {
    expect(truncateVisible('ab', 5)).toBe('ab');
  });

  it('preserves ANSI styling when the string fits within maxWidth', () => {
    const styled = '\x1b[31mab\x1b[0m';
    // Fits → returns s as-is, styling intact
    expect(truncateVisible(styled, 5)).toBe(styled);
  });

  it('truncates a plain string to maxWidth visible characters including the ellipsis', () => {
    // truncate(s, 3): slice(0, 2) + '…' → 'he…' (3 visible chars)
    expect(truncateVisible('hello', 3)).toBe('he…');
    expect(truncateVisible('hello', 3).length).toBe(3);
  });

  it('drops ANSI styling across the truncation boundary (rebuilds from stripped text)', () => {
    // Input: styled 'hello'; truncation discards the ANSI codes and works on raw text
    const result = truncateVisible('\x1b[31mhello\x1b[0m', 3);
    expect(result).toBe('he…');
    // No escape codes survive the truncation
    expect(stripAnsi(result)).toBe(result);
  });

  it('truncated result has exactly maxWidth visible characters', () => {
    // maxWidth=4: slice(0, 3) + '…' → 'abc…' (4 chars)
    const result = truncateVisible('abcdefgh', 4);
    expect(result).toBe('abc…');
    expect(result.length).toBe(4);
  });

  it('handles exactly maxWidth — no truncation, no ellipsis', () => {
    // string length equals maxWidth exactly → returned unchanged
    expect(truncateVisible('abc', 3)).toBe('abc');
  });
});
