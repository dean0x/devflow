/**
 * CLAUDE.md docs guard — the Tracker block and the skill-installation heading.
 *
 * CLAUDE.md is loaded into every session in this repository, so its length is a
 * recurring cost and its vocabulary is what a contributor learns first. Two
 * properties are mechanized here because both drift silently:
 *
 *   1. The Tracker block stays within a character cap. It is the paragraph run
 *      most likely to absorb every new tracker detail, and a paragraph that
 *      grows a sentence per change has no natural stopping point.
 *   2. The Tracker block names no INTERNAL identifier. `ADR-026`, `PF-012`,
 *      `DR-10`, `OD-15` and `§14.2` address entries in the learning ledger, in
 *      a design artifact or in a phase brief — none of which a reader of
 *      CLAUDE.md has open. A citation that cannot be followed is decoration,
 *      and a mis-numbered one is worse than none.
 *
 * Plus the end-state naming check: skills install for the SELECTED plugins and
 * their declared `requires:`, so the heading is `Selection-scoped Skill
 * Installation`. The old `Universal Skill Installation` heading describes an
 * install shape that no longer exists.
 *
 * Both collectors are named and both are driven against seeded known-bad input,
 * so a guard that stops seeing its subject fails instead of passing vacuously.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import * as path from 'path';

const ROOT = path.resolve(import.meta.dirname, '../..');

/**
 * Max characters of the CLAUDE.md Tracker block (all its paragraphs plus the
 * blank lines between them). Measured at the pin well under this value; may be
 * LOWERED after a pass that cuts the text, never raised — a cap raised to fit
 * whatever the block grew into is not a cap.
 */
const TRACKER_BLOCK_MAX_CHARS = 3500;

/** How many paragraphs the block is expected to carry, at minimum. */
const TRACKER_BLOCK_MIN_PARAGRAPHS = 3;

/**
 * The Tracker block: every CONSECUTIVE bold-lead paragraph whose lead begins
 * with `Tracker`, starting at the first one.
 *
 * Addressed by its own lead rather than by line numbers, so inserting a
 * paragraph above it does not silently re-point the guard at something else.
 * The run ends at the first bold-lead paragraph that is not a Tracker one, at a
 * markdown heading, or at a fence.
 */
function collectTrackerBlock(markdown: string): string {
  const lines = markdown.split('\n');
  const start = lines.findIndex(line => /^\*\*Tracker\b/.test(line));
  if (start === -1) return '';
  const out: string[] = [];
  for (let i = start; i < lines.length; i++) {
    const line = lines[i];
    if (i > start && (/^#/.test(line) || /^```/.test(line))) break;
    if (i > start && /^\*\*/.test(line) && !/^\*\*Tracker\b/.test(line)) break;
    out.push(line);
  }
  // Trim the trailing blank line the run picks up before the next paragraph.
  while (out.length > 0 && out[out.length - 1].trim() === '') out.pop();
  return out.join('\n');
}

/**
 * Internal identifiers: ledger anchors, design-review markers, open decisions
 * and section coordinates. Each addresses a document the reader of CLAUDE.md
 * does not have.
 */
function collectInternalIds(text: string): string[] {
  return text.match(/ADR-\d+|PF-\d+|DR-\d+|OD-\d+|§\d+/g) ?? [];
}

const CLAUDE_MD = readFileSync(path.join(ROOT, 'CLAUDE.md'), 'utf8');

describe('CLAUDE.md: the Tracker block', () => {
  it('is present and carries the end-state paragraph run', () => {
    const block = collectTrackerBlock(CLAUDE_MD);
    expect(block.length).toBeGreaterThan(0);
    const paragraphs = block.split('\n').filter(line => /^\*\*Tracker\b/.test(line));
    expect(paragraphs.length).toBeGreaterThanOrEqual(TRACKER_BLOCK_MIN_PARAGRAPHS);
  });

  it(`is at most ${TRACKER_BLOCK_MAX_CHARS} characters`, () => {
    const block = collectTrackerBlock(CLAUDE_MD);
    expect(block.length).toBeLessThanOrEqual(TRACKER_BLOCK_MAX_CHARS);
  });

  it('names no internal identifier', () => {
    expect(collectInternalIds(collectTrackerBlock(CLAUDE_MD))).toEqual([]);
  });

  it('collectTrackerBlock and collectInternalIds are live (known-bad probes)', () => {
    const seeded = [
      '**Prior paragraph**: untouched.',
      '',
      '**Tracker**: first, citing ADR-026 and PF-012.',
      '',
      '**Tracker operations**: second, citing DR-10 and OD-15 and §14.2.',
      '',
      '**Tracker lifecycle**: third.',
      '',
      '**Next paragraph**: must not be collected.',
    ].join('\n');
    const block = collectTrackerBlock(seeded);
    expect(block).toContain('**Tracker lifecycle**');
    expect(block).not.toContain('Next paragraph');
    expect(block).not.toContain('Prior paragraph');
    expect(collectInternalIds(block)).toEqual(['ADR-026', 'PF-012', 'DR-10', 'OD-15', '§14']);
    expect(collectInternalIds('no identifiers here')).toEqual([]);
  });
});

describe('CLAUDE.md: skill installation is described as selection-scoped', () => {
  it('carries the Selection-scoped Skill Installation paragraph', () => {
    expect(CLAUDE_MD).toContain('**Selection-scoped Skill Installation**');
  });

  it('does not describe skill installation as universal', () => {
    expect(CLAUDE_MD).not.toContain('Universal Skill Installation');
  });
});
