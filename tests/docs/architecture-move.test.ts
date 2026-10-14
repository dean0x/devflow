/**
 * Architecture move guard — the 13 Architecture Overview paragraphs live in
 * `docs/reference/architecture.md` word for word, and CLAUDE.md no longer
 * carries them.
 *
 * CLAUDE.md is loaded into every session, so the long descriptions moved to a
 * doc that no session loads up front, and CLAUDE.md keeps one binding line per
 * rule. The move must lose no text. Each paragraph is pinned by its bold lead,
 * its byte length and the SHA-256 of its full line as it stood in CLAUDE.md
 * before the move, so a reworded or truncated paragraph in architecture.md
 * fails. The CLAUDE.md side checks that no paragraph is left behind: neither
 * its bold lead at a line start nor its opening words.
 *
 * Non-vacuity: the paragraph table is checked for size, every digest must hit a
 * line of architecture.md, and a seeded one-word edit is shown to miss.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { createHash } from 'crypto';
import * as path from 'path';

const ROOT = path.resolve(import.meta.dirname, '../..');

interface MovedParagraph {
  readonly lead: string;
  readonly bytes: number;
  readonly sha256: string;
}

/**
 * The 13 paragraphs, as CLAUDE.md held them before the move. A deliberate edit of a
 * paragraph, such as an agent rename, re-sets its length and digest in the same commit.
 */
const MOVED_PARAGRAPHS: readonly MovedParagraph[] = [
  { lead: 'LLM-vs-plumbing principle', bytes: 739, sha256: 'c5d362ddb9c5115d98fa453427fd4adce8a9e49e6a705c51ee1d29ae7ce34417' },
  { lead: 'Runtime data', bytes: 2202, sha256: '2465292446d9cd0652a99572931d8158bce81a885746f03bfa0c9aea49b52a26' },
  { lead: 'Feature Knowledge Bases', bytes: 890, sha256: 'ea20f3ff1fdb2d0b9774fe9cf544423d10a6544533582a490ca186d14b02a134' },
  { lead: 'Rules', bytes: 319, sha256: 'd6826dc4b431132b12df032831419dd384630b6a9b62244122fcbf6bb15963e9' },
  { lead: 'Selection-scoped Skill Installation', bytes: 532, sha256: '6fb4e7f9edd3e3fadfa766384dfcedffaddb178beff86543823dfe0aa8aec9fb' },
  { lead: 'Compliance', bytes: 1528, sha256: '246b5c7d82448d2cbc46cf846e2b8e185b229336ae6417839db8e52569ac9891' },
  { lead: 'Claude Code Flags', bytes: 782, sha256: '7843e9825d330ea42971a6b3d61ceec28477d788ec60c792d42557005e8b38b7' },
  { lead: 'Model Strategy', bytes: 648, sha256: '1fb14555419880ae686c7ef37fcb6e8d97b08825cb6939aa138c014e167f523c' },
  { lead: 'Review publication', bytes: 1420, sha256: '494c9c9fbbc36dd1d93610630d34f58aa474922a189540432a959801d84fe775' },
  { lead: 'Evidence policy', bytes: 1419, sha256: 'e8f0f7b9d8cb829e070e2f2d8c83c88e1a8009c85f4687a342372f7117c63052' },
  { lead: 'Tracker', bytes: 895, sha256: 'c73951d8312ee66465ce3f329b74c5b3a6dcd8bc85f205b8b4d02c24d4e02ce2' },
  { lead: 'Tracker operations', bytes: 1557, sha256: 'f93baf91cb6fa4eb54c3b0514475dc6607627d1910f1c8dd27f112ce549fed01' },
  { lead: 'Tracker lifecycle', bytes: 966, sha256: '97b2b188242776a49c89f4cbca03523dfe6830ae93cd06f51e077adeaaf867e3' },
];

/** Characters of a paragraph's opening that must not survive in CLAUDE.md. */
const OPENING_CHARS = 60;

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

const ARCHITECTURE_LINES = readFileSync(path.join(ROOT, 'docs/reference/architecture.md'), 'utf8').split('\n');
const CLAUDE_MD = readFileSync(path.join(ROOT, 'CLAUDE.md'), 'utf8');

function findParagraph(lines: readonly string[], lead: string): string | undefined {
  return lines.find(line => line.startsWith(`**${lead}**`));
}

describe('Architecture Overview paragraphs moved to docs/reference/architecture.md', () => {
  it('pins 13 paragraphs with distinct leads', () => {
    expect(MOVED_PARAGRAPHS).toHaveLength(13);
    expect(new Set(MOVED_PARAGRAPHS.map(p => p.lead)).size).toBe(13);
  });

  for (const paragraph of MOVED_PARAGRAPHS) {
    it(`carries "${paragraph.lead}" verbatim`, () => {
      const line = findParagraph(ARCHITECTURE_LINES, paragraph.lead);
      expect(line, `architecture.md has no paragraph led by **${paragraph.lead}**`).toBeDefined();
      expect(Buffer.byteLength(line ?? '', 'utf8')).toBe(paragraph.bytes);
      expect(sha256(line ?? '')).toBe(paragraph.sha256);
    });

    it(`leaves "${paragraph.lead}" out of CLAUDE.md`, () => {
      expect(findParagraph(CLAUDE_MD.split('\n'), paragraph.lead)).toBeUndefined();
      const line = findParagraph(ARCHITECTURE_LINES, paragraph.lead) ?? '';
      expect(line.length).toBeGreaterThan(OPENING_CHARS);
      expect(CLAUDE_MD).not.toContain(line.slice(0, OPENING_CHARS));
    });
  }

  it('the digest check is live (a one-word edit misses)', () => {
    const [first] = MOVED_PARAGRAPHS;
    const line = findParagraph(ARCHITECTURE_LINES, first.lead) ?? '';
    expect(sha256(line)).toBe(first.sha256);
    expect(sha256(line.replace(/\s\S+$/, ' changed'))).not.toBe(first.sha256);
    expect(findParagraph(['**Other**: text'], first.lead)).toBeUndefined();
  });
});
