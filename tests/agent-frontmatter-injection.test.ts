/**
 * T10 — Frontmatter injection matrix
 *
 * Verifies that rewriteAgentFrontmatter rejects all payloads that contain
 * characters outside the MODEL_NAME_RE charset (S1) and that stripAnsi
 * neutralises terminal-escape sequences of all kinds (S2).
 *
 * AC-S1: rewriteAgentFrontmatter must return Err('invalid-model') for every
 *        payload; the file content returned must be the original — no write.
 * AC-S2: stripAnsi must reduce every terminal-escape payload to plain text.
 */

import { describe, it, expect } from 'vitest';
import {
  rewriteAgentFrontmatter,
  readFrontmatterModel,
  MODEL_NAME_RE,
  isValidModelName,
  type RewriteOptions,
} from '../src/core/agent-frontmatter.js';
import { stripAnsi } from '../src/hud/colors.js';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeAgent(model: string, body = 'description: test agent\n'): string {
  return `---\nmodel: ${model}\n---\n${body}`;
}

// ---------------------------------------------------------------------------
// MODEL_NAME_RE and isValidModelName — charset boundary
// ---------------------------------------------------------------------------

describe('MODEL_NAME_RE — accepted model names', () => {
  const validNames = [
    // Devflow aliases
    'sonnet',
    'opus',
    'haiku',
    'fable',
    'inherit',
    // Full Anthropic IDs
    'claude-3-5-sonnet-20241022',
    'claude-sonnet-4-6',
    'claude-opus-3',
    // GPT IDs
    'gpt-5.6-sol',
    'gpt-5.5',
    // Short IDs
    'a',
    // Max-length (64 chars)
    'a' + 'b'.repeat(63),
  ];

  for (const name of validNames) {
    it(`accepts "${name}"`, () => {
      expect(isValidModelName(name)).toBe(true);
    });
  }
});

describe('MODEL_NAME_RE — rejected model names (S1 injection payloads)', () => {
  const invalidNames = [
    // Empty
    '',
    // Starts with non-alphanumeric
    '-claude',
    '.model',
    '_hidden',
    // YAML-breaking characters
    'gpt-4\ntools:\n  - bash',
    'model: evil\n---\nfree: body',
    'claude\r\ntools: [bash]',
    // Shell metacharacters
    'gpt$(rm -rf /)',
    'gpt`id`',
    'gpt;id',
    'gpt&&id',
    'gpt||id',
    'gpt|cat /etc/passwd',
    // Null byte
    'gpt\x00-4',
    // Space
    'gpt 4',
    // Angle brackets
    'gpt<4>',
    // Quotes
    "gpt'4",
    'gpt"4',
    // Colon (YAML separator)
    'gpt:4',
    // Hash (YAML comment)
    'gpt#4',
    // Bracket (YAML flow sequence)
    'gpt[4]',
    // Brace (YAML flow mapping)
    'gpt{4}',
    // At sign
    'gpt@4',
    // Slash (path traversal risk)
    '../etc/passwd',
    'gpt/4',
    // Exceeds 64 chars
    'a' + 'b'.repeat(64),
  ];

  for (const name of invalidNames) {
    it(`rejects ${JSON.stringify(name)}`, () => {
      expect(isValidModelName(name)).toBe(false);
    });
  }
});

// ---------------------------------------------------------------------------
// AC-S1 — rewriteAgentFrontmatter injection gate
// ---------------------------------------------------------------------------

describe('AC-S1 — rewriteAgentFrontmatter rejects injection payloads', () => {
  const injectionPayloads = [
    // Newline injection — would add YAML keys
    'gpt-4\ntools:\n  - bash',
    'gpt-4\r\ntools: [bash]',
    // YAML front-matter escape
    'gpt\n---\nfree: body\n---',
    // Shell metacharacters
    '$(whoami)',
    'a;b',
    'a && b',
    'a || b',
    // Null byte
    'a\x00b',
    // Space in name
    'gpt 4',
    // Empty string
    '',
    // Starts with hyphen (invalid)
    '-bad',
  ];

  const opts: RewriteOptions = { model: '', effort: null };

  for (const payload of injectionPayloads) {
    it(`returns Err('invalid-model') for ${JSON.stringify(payload)}`, () => {
      const original = makeAgent('sonnet');
      const result = rewriteAgentFrontmatter(original, { ...opts, model: payload });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe('invalid-model');
      }
    });

    it(`writes nothing to file content for ${JSON.stringify(payload)}`, () => {
      // The original content must be unchanged (no partial write).
      const original = makeAgent('sonnet');
      const result = rewriteAgentFrontmatter(original, { ...opts, model: payload });
      // Unconditional assertion 1: injection gate must always reject (avoids PF-018 —
      // a conditional guard on result.ok here was the original defect: result.ok is
      // always false for these payloads, so the old assertions NEVER ran).
      expect(result.ok).toBe(false);
      // Unconditional assertion 2: no modified content was produced.
      // Pure-function guarantee: an Err result produces no output content. If a
      // regression causes ok:true, the output must still be byte-identical to the
      // original (no injection reached the file).
      const writtenContent = result.ok ? result.value.content : original;
      expect(writtenContent).toBe(original);
    });
  }

  it('accepts a well-formed model name after a series of rejections', () => {
    const original = makeAgent('sonnet');
    const result = rewriteAgentFrontmatter(original, { model: 'gpt-5.6-sol', effort: null });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const readBack = readFrontmatterModel(result.value.content);
      expect(readBack.ok && readBack.value).toBe('gpt-5.6-sol');
    }
  });
});

// ---------------------------------------------------------------------------
// AC-S1b — rewriteAgentFrontmatter effort injection guard (C2-SEC-4)
//
// String.prototype.replace() with a string replacement expands $&, $`, $',
// and $1 as special patterns.  The effort rewrite path must use a replacement
// FUNCTION so these characters are written verbatim (defence-in-depth).
//
// Note: callers (agents.ts) enum-validate effort against EFFORT_LEVELS before
// reaching this module, so hostile effort values are not reachable in production.
// These tests guard the module boundary independently (belt-and-braces).
// ---------------------------------------------------------------------------

describe('AC-S1b — effort field safe replacement (no $-pattern expansion)', () => {
  // Base fixture with an existing effort line to exercise the replace path.
  const withEffort = '---\nmodel: sonnet\neffort: low\n---\ndescription: test agent\n';
  // Base fixture WITHOUT an effort line to exercise the insert path.
  const noEffort = '---\nmodel: sonnet\n---\ndescription: test agent\n';

  it('writes $& literally on effort replace (not the full-match expansion)', () => {
    // Without a replacement function, "$&" expands to the entire EFFORT_RE match
    // (e.g. "effort: low"), yielding "effort: loweffort: lowhigh" — a corruption.
    const result = rewriteAgentFrontmatter(withEffort, { model: 'sonnet', effort: 'low$&high' });
    expect(result.ok).toBe(true);
    const content = result.ok ? result.value.content : withEffort;
    expect(content).toContain('effort: low$&high');
    // Regression guard: the $& expansion artefact must not appear.
    expect(content).not.toContain('effort: loweffort:');
  });

  it('writes $` literally on effort replace (pre-match expansion pattern)', () => {
    const result = rewriteAgentFrontmatter(withEffort, { model: 'sonnet', effort: 'a$`b' });
    expect(result.ok).toBe(true);
    const content = result.ok ? result.value.content : withEffort;
    expect(content).toContain('effort: a$`b');
  });

  it("writes $' literally on effort replace (post-match expansion pattern)", () => {
    const result = rewriteAgentFrontmatter(withEffort, { model: 'sonnet', effort: "a$'b" });
    expect(result.ok).toBe(true);
    const content = result.ok ? result.value.content : withEffort;
    expect(content).toContain("effort: a$'b");
  });

  it('writes $1 literally on effort replace (capture-group expansion pattern)', () => {
    // $1 expands to the first capture group of EFFORT_RE (the current effort value).
    // Without a replacement function, "prefix$1suffix" would expand the captured
    // group rather than write the literal dollar-one.
    const result = rewriteAgentFrontmatter(withEffort, { model: 'sonnet', effort: 'pre$1suf' });
    expect(result.ok).toBe(true);
    const content = result.ok ? result.value.content : withEffort;
    expect(content).toContain('effort: pre$1suf');
  });

  it('writes $& literally on effort INSERT (fresh line, already uses fn replacement)', () => {
    // The insert path (no existing effort line) already uses a function replacement.
    // This test locks that behaviour so it cannot regress to a string replacement.
    const result = rewriteAgentFrontmatter(noEffort, { model: 'sonnet', effort: 'low$&high' });
    expect(result.ok).toBe(true);
    const content = result.ok ? result.value.content : noEffort;
    expect(content).toContain('effort: low$&high');
  });
});

// ---------------------------------------------------------------------------
// AC-S2 — stripAnsi terminal-escape matrix
// ---------------------------------------------------------------------------

describe('AC-S2 — stripAnsi removes all terminal-escape families', () => {
  const escapePayloads: Array<{ label: string; input: string; expected: string }> = [
    // SGR (colour / attribute sequences) — the only family the old pattern covered
    {
      label: 'SGR reset',
      input: '\x1b[0mgpt-5\x1b[0m',
      expected: 'gpt-5',
    },
    {
      label: 'SGR colour',
      input: '\x1b[31mred\x1b[0m',
      expected: 'red',
    },
    {
      label: 'SGR with semicolons',
      input: '\x1b[1;31;40mbold-red-on-black\x1b[0m',
      expected: 'bold-red-on-black',
    },

    // CSI with intermediate bytes (e.g. cursor movement, erase)
    {
      label: 'CSI cursor up',
      input: '\x1b[2Agpt',
      expected: 'gpt',
    },
    {
      label: 'CSI erase line',
      input: 'gpt\x1b[2Kmore',
      expected: 'gptmore',
    },
    {
      label: 'CSI with ? (private)',
      input: '\x1b[?25lgpt\x1b[?25h',
      expected: 'gpt',
    },
    {
      label: 'CSI with intermediate / and final byte',
      input: '\x1b[ @gpt',
      expected: 'gpt',
    },

    // OSC sequences (title set, hyperlinks)
    {
      label: 'OSC BEL-terminated',
      input: '\x1b]0;window title\x07gpt',
      expected: 'gpt',
    },
    {
      label: 'OSC ST-terminated',
      input: '\x1b]8;;https://example.com\x1b\\link text\x1b]8;;\x1b\\gpt',
      expected: 'link textgpt',
    },

    // Two-byte C1 sequences (Fe sequences)
    {
      label: 'ESC-N (SS2)',
      input: '\x1bNgpt',
      expected: 'gpt',
    },
    {
      label: 'ESC-M (reverse index)',
      input: '\x1bMgpt',
      expected: 'gpt',
    },
    {
      label: 'ESC-\\ (ST)',
      input: '\x1b\\gpt',
      expected: 'gpt',
    },

    // C0 control characters (not TAB/LF/CR)
    {
      label: 'NULL byte',
      input: 'gpt\x00name',
      expected: 'gptname',
    },
    {
      label: 'BEL',
      input: 'gpt\x07name',
      expected: 'gptname',
    },
    {
      label: 'BS',
      input: 'gpt\x08name',
      expected: 'gptname',
    },
    {
      label: 'VT (vertical tab)',
      input: 'gpt\x0bname',
      expected: 'gptname',
    },
    {
      label: 'FF (form feed)',
      input: 'gpt\x0cname',
      expected: 'gptname',
    },
    {
      label: 'DEL (0x7f)',
      input: 'gpt\x7fname',
      expected: 'gptname',
    },
    {
      label: 'ESC alone (not part of CSI/OSC/C1)',
      input: 'gpt\x1bname',
      // ESC followed by 'n' (not in [@-Z\\-_] or '[' or ']') falls outside the
      // ANSI_PATTERN and CTRL_PATTERN — 'n' is a printable char. ESC itself
      // is in the C0 range (\x1b = 0x1b = 27 < 0x20) so CTRL_PATTERN strips it;
      // 'n' remains.
      expected: 'gptname',
    },

    // Combination: mixed injection in a model-id-shaped string
    {
      label: 'injection inside model-id',
      input: 'gpt\x1b[31m-5\x1b[0m.6',
      expected: 'gpt-5.6',
    },
  ];

  for (const { label, input, expected } of escapePayloads) {
    it(label, () => {
      expect(stripAnsi(input)).toBe(expected);
    });
  }

  it('leaves plain text unchanged', () => {
    expect(stripAnsi('gpt-5.6-sol')).toBe('gpt-5.6-sol');
    expect(stripAnsi('claude-sonnet-4-6')).toBe('claude-sonnet-4-6');
    expect(stripAnsi('')).toBe('');
  });

  it('preserves TAB and LF (not control-stripped)', () => {
    // TAB (0x09) and LF (0x0a) are the only exempted ASCII controls.
    expect(stripAnsi('\t')).toBe('\t');
    expect(stripAnsi('\n')).toBe('\n');
  });

  it('strips CR (0x0d — in CTRL_PATTERN range 0x0b-0x1f)', () => {
    // CR is a terminal-control character: it moves the cursor to the start of
    // the line and can be used to overwrite visible output.  Strip it.
    expect(stripAnsi('\r')).toBe('');
  });
});
