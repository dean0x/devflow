/**
 * Tests for src/core/agent-frontmatter.ts
 *
 * TDD: these tests were written BEFORE the implementation.
 * Protocol: RED → GREEN → REFACTOR.
 *
 * Coverage:
 *  - All registered agents resolved via resolveAllAgents() / getAllAgentNames() (verbatim
 *    round-trips); enumeration is completeness-asserted so no agent is silently missing.
 *  - Synthetic edge cases: CRLF, missing frontmatter, unterminated frontmatter,
 *    model: in body, duplicate model lines, effort add/replace/remove
 */

import { describe, it, expect } from 'vitest';
import {
  carryStampedTools,
  isWholeServerTool,
  readFrontmatterEffort,
  readFrontmatterModel,
  readStampedTools,
  rewriteAgentFrontmatter,
  stampAgentTools,
} from '../src/core/agent-frontmatter.js';
import { resolveAgentSource, resolveAllAgents } from './helpers.js';
import { getAllAgentNames } from '../src/core/plugins.js';

const AGENT_NAMES = getAllAgentNames();

/**
 * The effort a shipped agent file carries, in the form the rewriter takes: a level, or
 * null when the file has no effort line. A reapply passes the shipped effort back through
 * the rewrite, so a round-trip on a real file has to do the same: null would strip it.
 */
function shippedEffort(content: string): string | null {
  const result = readFrontmatterEffort(content);
  return result.ok && result.value !== '' ? result.value : null;
}

// ---------------------------------------------------------------------------
// Real agent files — verbatim round-trips
// ---------------------------------------------------------------------------

describe(`rewriteAgentFrontmatter — all ${AGENT_NAMES.length} real agent files`, () => {
  it('corpus covers all registered agents (completeness — avoids GAP-07)', () => {
    expect([...resolveAllAgents().keys()]).toEqual(expect.arrayContaining(getAllAgentNames()));
  });

  for (const name of AGENT_NAMES) {
    describe(`${name}.md`, () => {
      it('sets a new model — only the model line differs in the frontmatter', () => {
        const original = resolveAgentSource(name).content;
        const originalModel = readFrontmatterModel(original);
        expect(originalModel.ok, `${name}.md should have a readable model`).toBe(true);
        if (!originalModel.ok) return;

        const result = rewriteAgentFrontmatter(original, { model: 'haiku', effort: shippedEffort(original) });
        expect(result.ok, `${name}.md rewrite should succeed`).toBe(true);
        if (!result.ok) return;

        // Body (everything after the closing ---) must be byte-identical
        const originalBody = original.slice(original.indexOf('---\n', 4) + 4);
        const rewrittenBody = result.value.content.slice(result.value.content.indexOf('---\n', 4) + 4);
        expect(rewrittenBody).toBe(originalBody);

        // If original model was 'haiku', changed should be false
        if (originalModel.value === 'haiku') {
          expect(result.value.changed).toBe(false);
        } else {
          expect(result.value.changed).toBe(true);
          // The rewritten content should parse back to 'haiku'
          const readBack = readFrontmatterModel(result.value.content);
          expect(readBack.ok).toBe(true);
          if (readBack.ok) expect(readBack.value).toBe('haiku');
        }
      });

      it('re-applying same model is idempotent (changed: false)', () => {
        const original = resolveAgentSource(name).content;
        const originalModel = readFrontmatterModel(original);
        if (!originalModel.ok) return;

        const firstPass = rewriteAgentFrontmatter(original, { model: originalModel.value, effort: shippedEffort(original) });
        expect(firstPass.ok).toBe(true);
        if (!firstPass.ok) return;

        // Reapplying same model → no byte change
        expect(firstPass.value.changed).toBe(false);
        expect(firstPass.value.content).toBe(original);
      });

      it('reverts to original model — content is byte-identical to original', () => {
        const original = resolveAgentSource(name).content;
        const originalModel = readFrontmatterModel(original);
        if (!originalModel.ok) return;

        // Switch to a different model
        const switched = rewriteAgentFrontmatter(original, { model: 'gpt-5.6-sol', effort: shippedEffort(original) });
        if (!switched.ok) return;

        // Revert
        const reverted = rewriteAgentFrontmatter(switched.value.content, {
          model: originalModel.value,
          effort: shippedEffort(original),
        });
        expect(reverted.ok).toBe(true);
        if (!reverted.ok) return;

        expect(reverted.value.content).toBe(original);
      });

      it('does not touch other frontmatter lines (skills, tools, description, etc.)', () => {
        const original = resolveAgentSource(name).content;
        const result = rewriteAgentFrontmatter(original, { model: 'opus', effort: null });
        if (!result.ok) return;

        // Extract frontmatter bodies (between --- markers)
        const fmBody = (content: string): string => {
          const m = /^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/.exec(content);
          return m ? m[1] : '';
        };

        const origLines = fmBody(original).split('\n').filter(l => !l.startsWith('model:') && !l.startsWith('effort:'));
        const rewriteLines = fmBody(result.value.content).split('\n').filter(l => !l.startsWith('model:') && !l.startsWith('effort:'));
        expect(rewriteLines).toEqual(origLines);
      });
    });
  }
});

// ---------------------------------------------------------------------------
// readFrontmatterModel
// ---------------------------------------------------------------------------

describe('readFrontmatterModel', () => {
  it('reads the model from a simple frontmatter', () => {
    const content = '---\nname: Test\nmodel: sonnet\n---\n\nbody';
    const result = readFrontmatterModel(content);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe('sonnet');
  });

  it('returns error for missing frontmatter', () => {
    const content = 'no frontmatter here\nmodel: sonnet\n';
    const result = readFrontmatterModel(content);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('no-frontmatter');
  });

  it('returns error for unterminated frontmatter', () => {
    const content = '---\nname: Test\nmodel: sonnet\n';
    const result = readFrontmatterModel(content);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('unterminated-frontmatter');
  });

  it('ignores model: lines that appear in the body', () => {
    const content = '---\nname: Test\nmodel: opus\n---\n\nmodel: this-should-be-ignored\n';
    const result = readFrontmatterModel(content);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe('opus');
  });

  it('handles model with extra whitespace', () => {
    const content = '---\nname: Test\nmodel:   haiku  \n---\n\nbody';
    const result = readFrontmatterModel(content);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe('haiku');
  });

  it('handles CRLF frontmatter', () => {
    const content = '---\r\nname: Test\r\nmodel: sonnet\r\n---\r\n\r\nbody';
    const result = readFrontmatterModel(content);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe('sonnet');
  });
});

// ---------------------------------------------------------------------------
// readFrontmatterEffort
// ---------------------------------------------------------------------------

describe('readFrontmatterEffort', () => {
  it('reads the effort from the leading frontmatter block', () => {
    const content = '---\nname: Test\nmodel: sonnet\neffort: medium\n---\n\nbody';
    const result = readFrontmatterEffort(content);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe('medium');
  });

  it('returns Ok("") when the frontmatter carries no effort line', () => {
    const content = '---\nname: Test\nmodel: sonnet\n---\n\nbody';
    const result = readFrontmatterEffort(content);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe('');
  });

  it('ignores an effort: line in the body', () => {
    const content = '---\nname: Test\nmodel: opus\n---\n\neffort: max\n';
    const result = readFrontmatterEffort(content);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe('');
  });

  it('returns the frontmatter effort, not the body line, when both exist', () => {
    const content = '---\nname: Test\neffort: low\n---\n\neffort: max\n';
    const result = readFrontmatterEffort(content);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe('low');
  });

  it('returns error for missing frontmatter', () => {
    const result = readFrontmatterEffort('no frontmatter here\neffort: high\n');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('no-frontmatter');
  });

  it('returns error for unterminated frontmatter', () => {
    const result = readFrontmatterEffort('---\nname: Test\neffort: high\n');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('unterminated-frontmatter');
  });

  it('trims surrounding whitespace', () => {
    const result = readFrontmatterEffort('---\nname: Test\neffort:   high  \n---\n\nbody');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe('high');
  });

  it('handles CRLF frontmatter', () => {
    const result = readFrontmatterEffort('---\r\nname: Test\r\neffort: xhigh\r\n---\r\n\r\nbody');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe('xhigh');
  });
});

// ---------------------------------------------------------------------------
// Synthetic: CRLF files
// ---------------------------------------------------------------------------

describe('rewriteAgentFrontmatter — CRLF files', () => {
  it('preserves CRLF line endings throughout', () => {
    const content = '---\r\nname: Test\r\nmodel: sonnet\r\n---\r\n\r\nbody content\r\n';
    const result = rewriteAgentFrontmatter(content, { model: 'opus', effort: null });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // All line endings in the output must be CRLF
    expect(result.value.content).not.toMatch(/(?<!\r)\n/);
    // Model was changed
    expect(result.value.changed).toBe(true);
    const readBack = readFrontmatterModel(result.value.content);
    expect(readBack.ok).toBe(true);
    if (readBack.ok) expect(readBack.value).toBe('opus');
  });

  it('CRLF re-apply same model → changed: false, content unchanged', () => {
    const content = '---\r\nname: Test\r\nmodel: sonnet\r\n---\r\n\r\nbody\r\n';
    const result = rewriteAgentFrontmatter(content, { model: 'sonnet', effort: null });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.changed).toBe(false);
    expect(result.value.content).toBe(content);
  });
});

// ---------------------------------------------------------------------------
// Synthetic: every other key survives a rewrite
// ---------------------------------------------------------------------------

describe('rewriteAgentFrontmatter — tools, disallowedTools, skills and omitClaudeMd survive', () => {
  const frontmatterLines = (content: string): string[] => {
    const m = /^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/.exec(content);
    return m ? m[1].split(/\r?\n/) : [];
  };
  const withoutModelAndEffort = (content: string): string[] =>
    frontmatterLines(content).filter(l => !l.startsWith('model:') && !l.startsWith('effort:'));

  const BLOCK_LISTS = [
    '---',
    'name: Test',
    'description: "A description: with a colon"',
    'model: sonnet',
    'effort: medium',
    'skills:',
    '  - devflow:worktree-support',
    'disallowedTools:',
    '  - Agent',
    '  - Skill',
    'omitClaudeMd: true',
    '---',
    '',
    'body',
    '',
  ].join('\n');
  const INLINE_TOOLS = '---\nname: Test\nmodel: haiku\ntools: ["Bash", "Read"]\nomitClaudeMd: true\n---\n\nbody\n';

  for (const [label, content] of [['a block-list file', BLOCK_LISTS], ['an inline-array file', INLINE_TOOLS]] as const) {
    describe(label, () => {
      const edits = [
        ['a model change', { model: 'opus', effort: null }],
        ['an effort replacement', { model: 'sonnet', effort: 'max' }],
        ['an effort addition', { model: 'haiku', effort: 'high' }],
        ['an effort removal', { model: 'haiku', effort: null }],
      ] as const;
      for (const [edit, opts] of edits) {
        it(`keeps every other frontmatter line byte-identical through ${edit}`, () => {
          const result = rewriteAgentFrontmatter(content, { model: opts.model, effort: opts.effort });
          expect(result.ok).toBe(true);
          if (!result.ok) return;
          expect(withoutModelAndEffort(result.value.content)).toEqual(withoutModelAndEffort(content));
          // The body is untouched too.
          expect(result.value.content.slice(result.value.content.lastIndexOf('---\n') + 4))
            .toBe(content.slice(content.lastIndexOf('---\n') + 4));
        });
      }
    });
  }

  it('an effort addition lands directly after the model line, ahead of the keys it must not disturb', () => {
    const result = rewriteAgentFrontmatter(INLINE_TOOLS, { model: 'haiku', effort: 'medium' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(frontmatterLines(result.value.content)).toEqual([
      'name: Test', 'model: haiku', 'effort: medium', 'tools: ["Bash", "Read"]', 'omitClaudeMd: true',
    ]);
  });
});

// ---------------------------------------------------------------------------
// Synthetic: error cases
// ---------------------------------------------------------------------------

describe('rewriteAgentFrontmatter — error cases', () => {
  it('returns no-frontmatter error when content has no --- block', () => {
    const content = 'name: Test\nmodel: sonnet\nbody\n';
    const result = rewriteAgentFrontmatter(content, { model: 'opus', effort: null });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('no-frontmatter');
  });

  it('returns unterminated-frontmatter error when --- block is never closed', () => {
    const content = '---\nname: Test\nmodel: sonnet\n';
    const result = rewriteAgentFrontmatter(content, { model: 'opus', effort: null });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('unterminated-frontmatter');
  });

  it('model: in body is NOT modified (only frontmatter is touched)', () => {
    const content = '---\nname: Test\nmodel: haiku\n---\n\nSome body text with model: something here.\n';
    const result = rewriteAgentFrontmatter(content, { model: 'opus', effort: null });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Body must still contain the original model: line
    expect(result.value.content).toContain('\nSome body text with model: something here.\n');
    // But the frontmatter model was updated
    const readBack = readFrontmatterModel(result.value.content);
    if (readBack.ok) expect(readBack.value).toBe('opus');
  });
});

// ---------------------------------------------------------------------------
// Synthetic: effort line handling
// ---------------------------------------------------------------------------

describe('rewriteAgentFrontmatter — effort line', () => {
  it('inserts effort after model when no existing effort line', () => {
    const content = '---\nname: Test\nmodel: sonnet\nother: value\n---\n\nbody\n';
    const result = rewriteAgentFrontmatter(content, { model: 'sonnet', effort: 'high' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.changed).toBe(true);
    // effort: line must appear immediately after model: line
    const lines = result.value.content.split('\n');
    const modelIdx = lines.findIndex(l => l.startsWith('model:'));
    expect(lines[modelIdx + 1]).toBe('effort: high');
  });

  it('replaces existing effort line', () => {
    const content = '---\nname: Test\nmodel: sonnet\neffort: low\nother: value\n---\n\nbody\n';
    const result = rewriteAgentFrontmatter(content, { model: 'sonnet', effort: 'max' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.changed).toBe(true);
    expect(result.value.content).toContain('effort: max');
    // Only one effort line
    const effortCount = (result.value.content.match(/^effort:/gm) ?? []).length;
    expect(effortCount).toBe(1);
  });

  it('removes effort when effort: null and effort line exists', () => {
    const content = '---\nname: Test\nmodel: sonnet\neffort: high\nother: value\n---\n\nbody\n';
    const result = rewriteAgentFrontmatter(content, { model: 'sonnet', effort: null });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.changed).toBe(true);
    expect(result.value.content).not.toMatch(/^effort:/m);
    // No double blank lines inside frontmatter block only
    const fmBodyMatch = /^---\r?\n([\s\S]*?)\r?\n---/.exec(result.value.content);
    const fmBody = fmBodyMatch ? fmBodyMatch[1] : result.value.content;
    expect(fmBody).not.toMatch(/\n\n/);
  });

  it('effort: null with no existing effort line → unchanged', () => {
    const content = '---\nname: Test\nmodel: sonnet\n---\n\nbody\n';
    const result = rewriteAgentFrontmatter(content, { model: 'sonnet', effort: null });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.changed).toBe(false);
    expect(result.value.content).toBe(content);
  });

  it('re-applying same effort → changed: false', () => {
    const content = '---\nname: Test\nmodel: sonnet\neffort: medium\n---\n\nbody\n';
    const result = rewriteAgentFrontmatter(content, { model: 'sonnet', effort: 'medium' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.changed).toBe(false);
    expect(result.value.content).toBe(content);
  });

  it('effort in CRLF file: inserts with CRLF', () => {
    const content = '---\r\nname: Test\r\nmodel: sonnet\r\n---\r\n\r\nbody\r\n';
    const result = rewriteAgentFrontmatter(content, { model: 'sonnet', effort: 'low' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.changed).toBe(true);
    // Effort line must use CRLF
    expect(result.value.content).toContain('effort: low\r\n');
    // No bare LF in the output
    expect(result.value.content).not.toMatch(/(?<!\r)\n/);
  });

  it('removing effort from CRLF file: no double blank lines and no bare LF', () => {
    const content = '---\r\nname: Test\r\nmodel: sonnet\r\neffort: high\r\nother: value\r\n---\r\n\r\nbody\r\n';
    const result = rewriteAgentFrontmatter(content, { model: 'sonnet', effort: null });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.changed).toBe(true);
    expect(result.value.content).not.toMatch(/^effort:/m);
    expect(result.value.content).not.toMatch(/(?<!\r)\n/);
  });
});

// ---------------------------------------------------------------------------
// Synthetic: duplicate model lines
// ---------------------------------------------------------------------------

describe('rewriteAgentFrontmatter — duplicate model lines', () => {
  it('only replaces the first model: line when duplicates exist', () => {
    // Malformed but we must be robust
    const content = '---\nname: Test\nmodel: haiku\nmodel: sonnet\n---\n\nbody\n';
    const result = rewriteAgentFrontmatter(content, { model: 'opus', effort: null });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // First model line updated
    const lines = result.value.content.split('\n');
    const modelLines = lines.filter(l => l.startsWith('model:'));
    expect(modelLines[0]).toBe('model: opus');
  });
});

// ---------------------------------------------------------------------------
// Body immutability
// ---------------------------------------------------------------------------

describe('rewriteAgentFrontmatter — body bytes untouched', () => {
  it('body content is byte-identical after model change', () => {
    const body = '\nbody line 1\nbody line 2\n\n# Section\n\nMore content\n';
    const content = `---\nname: Test\nmodel: haiku\ndescription: desc\n---${body}`;
    const result = rewriteAgentFrontmatter(content, { model: 'opus', effort: null });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Body starts after the second ---\n
    const closeIdx = result.value.content.indexOf('\n---\n') + 5;
    expect(result.value.content.slice(closeIdx)).toBe(body.slice(1)); // body without leading \n
  });
});

// ---------------------------------------------------------------------------
// REL-4 + TS-2 regression: effort removal edge cases
// ---------------------------------------------------------------------------

describe('rewriteAgentFrontmatter — effort removal edge cases (REL-4/TS-2)', () => {
  it('effort as last key (LF): removal yields clean ...\\n--- with no stray blank line', () => {
    // effort: is the last frontmatter key — no key follows it
    const content = '---\nname: Test\nmodel: sonnet\neffort: high\n---\n\nbody\n';
    const result = rewriteAgentFrontmatter(content, { model: 'sonnet', effort: null });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.changed).toBe(true);
    expect(result.value.content).not.toMatch(/^effort:/m);
    // Must NOT contain a blank line before the closing ---
    expect(result.value.content).not.toContain('\n\n---');
    // Round-trip: content must be parseable and model unchanged
    const readBack = readFrontmatterModel(result.value.content);
    expect(readBack.ok).toBe(true);
    if (readBack.ok) expect(readBack.value).toBe('sonnet');
  });

  it('effort as last key (CRLF): removal yields clean ...\\r\\n--- with no stray blank line', () => {
    const content = '---\r\nname: Test\r\nmodel: sonnet\r\neffort: high\r\n---\r\n\r\nbody\r\n';
    const result = rewriteAgentFrontmatter(content, { model: 'sonnet', effort: null });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.changed).toBe(true);
    expect(result.value.content).not.toMatch(/^effort:/m);
    // Must NOT contain a blank line before the closing ---
    expect(result.value.content).not.toContain('\r\n\r\n---');
    // Must preserve CRLF throughout (no bare LF)
    expect(result.value.content).not.toMatch(/(?<!\r)\n/);
    const readBack = readFrontmatterModel(result.value.content);
    expect(readBack.ok).toBe(true);
    if (readBack.ok) expect(readBack.value).toBe('sonnet');
  });

  it('intentional blank line inside frontmatter body survives effort removal byte-identically', () => {
    // A multi-line YAML value that legitimately contains a blank line.
    // The global \n{2,} collapse in the old implementation would corrupt this.
    const content = [
      '---',
      'name: Test',
      'description: |',
      '  line one',
      '',
      '  line two',
      'model: sonnet',
      'effort: low',
      '---',
      '',
      'body',
      '',
    ].join('\n');
    const result = rewriteAgentFrontmatter(content, { model: 'sonnet', effort: null });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.changed).toBe(true);
    expect(result.value.content).not.toMatch(/^effort:/m);
    // The intentional blank line inside the description value must be preserved
    expect(result.value.content).toContain('  line one\n\n  line two');
  });
});

// ---------------------------------------------------------------------------
// stampAgentTools — whole-server entries on the inline tools line
// ---------------------------------------------------------------------------

describe('stampAgentTools', () => {
  const source = [
    '---',
    'name: Git',
    'description: seeded',
    'model: haiku',
    'effort: medium',
    'tools: ["Bash", "Read", "Write", "ToolSearch"]',
    'skills:',
    '  - devflow:git',
    'omitClaudeMd: true',
    '---',
    '',
    '# Body',
    'tools: ["Body", "Line"]',
    '',
  ].join('\n');

  const stamp = (content: string, tools: string[]): string => {
    const result = stampAgentTools(content, tools);
    if (!result.ok) throw new Error(`stamp failed: ${result.error}`);
    return result.value.content;
  };

  it('appends the whole-server entries to the tools line and changes nothing else', () => {
    const out = stamp(source, ['mcp__github', 'mcp__claude_ai_Linear']);
    expect(out).toBe(source.replace(
      'tools: ["Bash", "Read", "Write", "ToolSearch"]',
      'tools: ["Bash", "Read", "Write", "ToolSearch", "mcp__github", "mcp__claude_ai_Linear"]',
    ));
    expect(out).toContain('tools: ["Body", "Line"]');
  });

  it('is idempotent: stamping the same list again moves no byte and reports unchanged', () => {
    const once = stamp(source, ['mcp__github', 'mcp__linear']);
    const again = stampAgentTools(once, ['mcp__github', 'mcp__linear']);
    expect(again.ok && again.value.content).toBe(once);
    expect(again.ok && again.value.changed).toBe(false);
  });

  it('replaces the previous stamp instead of adding to it, and an empty list removes it', () => {
    const first = stamp(source, ['mcp__github', 'mcp__linear']);
    const second = stamp(first, ['mcp__x']);
    expect(second).toBe(stamp(source, ['mcp__x']));
    expect(second).not.toContain('mcp__github');
    expect(stamp(second, [])).toBe(source);
  });

  it('keeps a non-whole-server mcp__ tool entry, which is a different kind of entry', () => {
    const withTool = source.replace('"Bash"', '"Bash", "mcp__srv__some_tool"');
    const out = stamp(withTool, ['mcp__github']);
    expect(out).toContain('"mcp__srv__some_tool"');
    expect(out).toContain('"mcp__github"');
    expect(stamp(out, [])).toBe(withTool);
  });

  it('drops a duplicate entry in the list it is given', () => {
    expect(stamp(source, ['mcp__a', 'mcp__a'])).toContain('"ToolSearch", "mcp__a"]');
    expect(stamp(source, ['mcp__a', 'mcp__a']).match(/mcp__a/g)).toHaveLength(1);
  });

  it('preserves CRLF line endings byte for byte', () => {
    const crlf = source.replace(/\n/g, '\r\n');
    const out = stamp(crlf, ['mcp__github']);
    expect(out).toBe(crlf.replace('"ToolSearch"]', '"ToolSearch", "mcp__github"]'));
    expect(out.replace(/\r\n/g, '').includes('\n')).toBe(false);
    expect(stamp(out, [])).toBe(crlf);
  });

  it('writes into an empty tools line', () => {
    const empty = source.replace('tools: ["Bash", "Read", "Write", "ToolSearch"]', 'tools: []');
    expect(stamp(empty, ['mcp__a', 'mcp__b'])).toContain('tools: ["mcp__a", "mcp__b"]');
  });

  it('rejects a free-text or malformed entry instead of repairing it', () => {
    for (const bad of ['mcp__', 'mcp__a__b', 'mcp__a b', 'mcp__a"]\nmodel: x', 'Bash', 'mcp__' + 'x'.repeat(65), '', 'mcp__a,b']) {
      const result = stampAgentTools(source, [bad]);
      expect(result.ok, bad).toBe(false);
      if (!result.ok) expect(result.error).toBe('invalid-tool');
    }
  });

  it('refuses a file with no inline tools line, a block-list tools key or no frontmatter', () => {
    const blockList = source.replace('tools: ["Bash", "Read", "Write", "ToolSearch"]', 'tools:\n  - Bash');
    const noTools = source.replace(/tools: \[[^\n]*\]\n/, '');
    expect(stampAgentTools(blockList, ['mcp__a'])).toEqual({ ok: false, error: 'no-tools-line' });
    expect(stampAgentTools(noTools, ['mcp__a'])).toEqual({ ok: false, error: 'no-tools-line' });
    expect(stampAgentTools('# no frontmatter\ntools: ["A"]\n', ['mcp__a'])).toEqual({ ok: false, error: 'no-frontmatter' });
    expect(stampAgentTools('---\ntools: ["A"]\n', ['mcp__a'])).toEqual({ ok: false, error: 'unterminated-frontmatter' });
  });

  it('does not touch a tools: line in the body, and the rewriter keeps the stamp when it reapplies a mapping', () => {
    const out = stamp(source, ['mcp__github']);
    expect(out.split('\n').filter(line => line.startsWith('tools:'))).toHaveLength(2);
    const rewritten = rewriteAgentFrontmatter(out, { model: 'sonnet', effort: 'high' });
    expect(rewritten.ok && rewritten.value.content).toContain('tools: ["Bash", "Read", "Write", "ToolSearch", "mcp__github"]');
  });
});

describe('isWholeServerTool', () => {
  it('admits mcp__<server> and refuses a tool entry, a wildcard and a bad charset', () => {
    for (const ok of ['mcp__github', 'mcp__claude_ai_Atlassian', 'mcp__a-b', 'mcp__' + 'x'.repeat(64)]) {
      expect(isWholeServerTool(ok), ok).toBe(true);
    }
    for (const bad of ['mcp__', 'mcp__*', 'mcp__a__b', 'mcp__a.b', 'Bash', 'mcp_github', 'mcp__' + 'x'.repeat(65)]) {
      expect(isWholeServerTool(bad), bad).toBe(false);
    }
  });
});

describe('readStampedTools and carryStampedTools', () => {
  const installed = [
    '---', 'name: Git', 'model: haiku', 'tools: ["Bash", "Read", "mcp__github", "mcp__linear"]', '---', '', 'variant A', '',
  ].join('\n');
  const variant = [
    '---', 'name: Git', 'model: haiku', 'tools: ["Bash", "Read"]', '---', '', 'variant B', '',
  ].join('\n');

  it('reads the stamped entries in order', () => {
    expect(readStampedTools(installed)).toEqual({ ok: true, value: ['mcp__github', 'mcp__linear'] });
    expect(readStampedTools(variant)).toEqual({ ok: true, value: [] });
    expect(readStampedTools('no frontmatter')).toEqual({ ok: false, error: 'no-frontmatter' });
  });

  it('carries the installed stamp onto a variant, so a variant switch keeps it and a repeat is byte-equal', () => {
    const carried = carryStampedTools(variant, installed);
    expect(carried).toBe(variant.replace('"Read"]', '"Read", "mcp__github", "mcp__linear"]'));
    expect(carryStampedTools(carried, carried)).toBe(carried);
  });

  it('returns the source unchanged when there is nothing safe to carry', () => {
    expect(carryStampedTools(variant, variant)).toBe(variant);
    expect(carryStampedTools(variant, 'not an agent file')).toBe(variant);
    expect(carryStampedTools('not an agent file', installed)).toBe('not an agent file');
  });
});
