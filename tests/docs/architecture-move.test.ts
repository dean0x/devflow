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
 *
 * The curation paragraphs of architecture.md and the curation section of hooks.md
 * are not pinned by digest. They change with the code, so a second block of checks
 * holds the rules that the two docs must state in the same words.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'fs';
import { createHash } from 'crypto';
import * as os from 'os';
import * as path from 'path';
import { readManifest } from '../../src/core/manifest.js';
import { readMachineFeature } from '../../src/core/feature-switch.js';
import { readGateManifest } from '../../src/core/gate-level.js';

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
  { lead: 'LLM-vs-plumbing principle', bytes: 739, sha256: '21fc423e27ee801ddb9ef191e0738b02b10e63e2cf5fc925b6a9f16ff57aac2f' },
  { lead: 'Runtime data', bytes: 2263, sha256: '1f85b67f9e7af66d75f5e2418780fcc746598a408f5bd23d764665467538b6fe' },
  { lead: 'Feature Knowledge Bases', bytes: 890, sha256: 'dd42a02a5a0163e7e471b3d1610e415b4a0633d1d083e447aaf1362b0ee8512f' },
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

const HOOKS_LINES = readFileSync(path.join(ROOT, 'docs/reference/hooks.md'), 'utf8').split('\n');

/** A line of text with its runs of white space folded to one space. */
function flat(text: string | undefined): string {
  return (text ?? '').replace(/\s+/g, ' ');
}

function lineStarting(lines: readonly string[], start: string): string {
  const line = lines.find(candidate => candidate.startsWith(start));
  expect(line, `no line starts with ${start}`).toBeDefined();
  return flat(line);
}

describe('the curation move and switch paragraphs state the same rules', () => {
  const dataMove = lineStarting(ARCHITECTURE_LINES, '**Curation data move**');
  const switchRule = lineStarting(ARCHITECTURE_LINES, '**Curation switch**');
  const hooksPipeline = lineStarting(HOOKS_LINES, '**Curation pipeline**');
  const hooksMove = lineStarting(HOOKS_LINES, '**The ledger folder move**');
  const hooksBoth = lineStarting(HOOKS_LINES, 'When a project already has both folders');
  const hooksPointer = lineStarting(HOOKS_LINES, 'Until a project moves');

  const winner = '`.devflow/curation/` has a non-empty log, it wins and the old folder becomes the backup';
  const loser = 'the old ledger set moves in and the rest of the old folder becomes the backup';

  it('names the winner of a project with both folders by the new folder log alone', () => {
    for (const text of [dataMove, hooksBoth]) {
      expect(text).toContain(winner);
      expect(text).toContain(loser);
      expect(text).not.toContain('the folder with a non-empty log wins');
      expect(text).not.toContain('the folder whose log is non-empty wins');
    }
  });

  it('says which commands heal the manifest and which write nothing', () => {
    const heals = 'The first `devflow` command that loads the whole manifest (for example `devflow init` or `devflow flags --status`) heals it.';
    const quiet = 'The `--status` commands of curation, memory, knowledge and gates write nothing.';
    for (const text of [switchRule, hooksPipeline]) {
      expect(text).toContain(heals);
      expect(text).toContain(quiet);
      expect(text).not.toContain('The first read of an older manifest rewrites it once');
    }
  });

  it('says that a refusal and a failed move both leave the marker that the HUD shows', () => {
    expect(hooksMove).toContain('A refusal or a failed move leaves a marker');
    expect(hooksMove).toContain('A busy marker is a separate file, and the HUD does not show it.');
    expect(hooksPointer).toContain('when the move was refused or failed');
    expect(dataMove).toContain('a refused line after a refusal or a failed move');
  });
});

describe('the docs name whose backups uninstall removes', () => {
  const scope = 'removes the backups of the project at the git root of the current directory';

  it('says it in architecture.md and hooks.md', () => {
    for (const text of [
      lineStarting(ARCHITECTURE_LINES, '**Curation data move**'),
      lineStarting(HOOKS_LINES, 'When a project already has both folders'),
    ]) {
      expect(text).toContain(scope);
      expect(text).not.toContain('removes it with the project data');
      expect(text).not.toContain('It removes the backup with the project data');
    }
  });
});

describe('CLAUDE.md names the two rules that architecture.md describes', () => {
  const dataMove = lineStarting(ARCHITECTURE_LINES, '**Curation data move**');
  const switchRule = lineStarting(ARCHITECTURE_LINES, '**Curation switch**');
  const invariants = CLAUDE_MD.split('\n').filter(line => /^\d+\. /.test(line));

  it('numbers the invariants one to n with no gap', () => {
    expect(invariants.map(line => Number.parseInt(line, 10))).toEqual(invariants.map((_line, index) => index + 1));
    expect(invariants.length).toBeGreaterThanOrEqual(43);
  });

  it('the old folder is only moved, never read as a ledger', () => {
    expect(invariants[1]).toContain('Never read the old `.devflow/learning/` folder as a ledger. Only move it.');
    expect(dataMove).toContain('nothing reads the old folder as a ledger');
  });

  it('the manifest keeps the switch under both keys, every write sets both, and false wins', () => {
    expect(invariants[42]).toBe('43. The manifest keeps the curation switch in `curation` and `learning`. Every write sets both. False wins.');
    expect(switchRule).toContain('under two keys, `features.curation` and its pre-rename copy `features.learning`');
    expect(switchRule).toContain('Every write sets both to the same value');
    expect(switchRule).toContain('A `false` in either key wins');
  });

  it('describes the build command by its output paths', () => {
    expect(CLAUDE_MD).toContain('`npm run build:mds` (every MDS host, to the `dist/` paths above)');
  });
});

describe('the manifest heal that the docs describe holds in code', () => {
  const unhealed = JSON.stringify({
    version: '3.7.0', plugins: [], scope: 'user', installedAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    features: { ambient: true, memory: true, hud: false, knowledge: true, rules: true, flags: {}, proxy: false, learning: false },
  });

  it('the status readers of curation, memory, knowledge and gates leave an unhealed manifest as it is, and the full reader heals it', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'devflow-heal-doc-'));
    const file = path.join(dir, 'manifest.json');
    try {
      writeFileSync(file, unhealed, 'utf8');
      await readMachineFeature(dir, 'curation');
      await readMachineFeature(dir, 'memory');
      await readMachineFeature(dir, 'knowledge');
      await readGateManifest(dir);
      expect(readFileSync(file, 'utf8')).toBe(unhealed);

      const manifest = await readManifest(dir);
      expect(manifest?.features.curation).toBe(false);
      const healed = (JSON.parse(readFileSync(file, 'utf8')) as { features: Record<string, unknown> }).features;
      expect(healed.curation).toBe(false);
      expect(healed.learning).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
