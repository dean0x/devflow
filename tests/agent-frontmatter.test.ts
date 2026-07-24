/**
 * Tests for src/core/agent-frontmatter.ts
 *
 * TDD: these tests were written BEFORE the implementation.
 * Protocol: RED → GREEN → REFACTOR.
 *
 * Coverage:
 *  - All 17 real shipped agent files (verbatim round-trips)
 *  - Synthetic edge cases: CRLF, missing frontmatter, unterminated frontmatter,
 *    model: in body, duplicate model lines, effort add/replace/remove
 */

import { describe, it, expect } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import {
  rewriteAgentFrontmatter,
  readFrontmatterModel,
} from '../src/core/agent-frontmatter.js';

const AGENTS_DIR = path.resolve(import.meta.dirname, '../src/assets/agents');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function readAgent(name: string): Promise<string> {
  return fs.readFile(path.join(AGENTS_DIR, name), 'utf-8');
}

// ---------------------------------------------------------------------------
// Real agent files — verbatim round-trips
// ---------------------------------------------------------------------------

describe('rewriteAgentFrontmatter — all 17 real agent files', () => {
  const AGENTS = [
    'bug-analyzer.md',
    'claude-md-auditor.md',
    'coder.md',
    'designer.md',
    'evaluator.md',
    'git.md',
    'knowledge.md',
    'learning.md',
    'researcher.md',
    'reviewer.md',
    'scrutinizer.md',
    'simplifier.md',
    'skimmer.md',
    'synthesizer.md',
    'tester.md',
    'triager.md',
    'validator.md',
  ];

  for (const agentFile of AGENTS) {
    describe(`${agentFile}`, () => {
      it('sets a new model — only the model line differs in the frontmatter', async () => {
        const original = await readAgent(agentFile);
        const originalModel = readFrontmatterModel(original);
        expect(originalModel.ok, `${agentFile} should have a readable model`).toBe(true);
        if (!originalModel.ok) return;

        const result = rewriteAgentFrontmatter(original, { model: 'haiku', effort: null });
        expect(result.ok, `${agentFile} rewrite should succeed`).toBe(true);
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

      it('re-applying same model is idempotent (changed: false)', async () => {
        const original = await readAgent(agentFile);
        const originalModel = readFrontmatterModel(original);
        if (!originalModel.ok) return;

        const firstPass = rewriteAgentFrontmatter(original, { model: originalModel.value, effort: null });
        expect(firstPass.ok).toBe(true);
        if (!firstPass.ok) return;

        // Reapplying same model → no byte change
        expect(firstPass.value.changed).toBe(false);
        expect(firstPass.value.content).toBe(original);
      });

      it('reverts to original model — content is byte-identical to original', async () => {
        const original = await readAgent(agentFile);
        const originalModel = readFrontmatterModel(original);
        if (!originalModel.ok) return;

        // Switch to a different model
        const switched = rewriteAgentFrontmatter(original, { model: 'gpt-5.6-sol', effort: null });
        if (!switched.ok) return;

        // Revert
        const reverted = rewriteAgentFrontmatter(switched.value.content, {
          model: originalModel.value,
          effort: null,
        });
        expect(reverted.ok).toBe(true);
        if (!reverted.ok) return;

        expect(reverted.value.content).toBe(original);
      });

      it('does not touch other frontmatter lines (skills, tools, description, etc.)', async () => {
        const original = await readAgent(agentFile);
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
