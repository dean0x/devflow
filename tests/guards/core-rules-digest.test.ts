/**
 * core-rules-digest — an agent that omits CLAUDE.md and the rules restates the core rules
 * it works by, and carries exactly the lines its table row declares.
 *
 * Decisions recorded here:
 *
 *  - D-OMIT-CLAUDEMD-SET   tests/fixtures/agent-config.ts (the header): `omitClaudeMd: true`
 *                          drops CLAUDE.md AND `~/.claude/rules/**` from a subagent's context,
 *                          where devflow installs its rules, so an agent that omits them loses
 *                          the rules it was told to follow.
 *  - D-CORE-RULES-DIGEST   tests/fixtures/agent-config.ts (CORE_RULES_DIGEST): one source of
 *                          truth, one short line per core rule. A body carries the lines its row
 *                          declares, byte for byte, as bullets under one `## Core rules`
 *                          heading. The set of omitting agents is derived from the table rows,
 *                          so a new omitting agent is covered without an edit to this file.
 *
 * The arms run through named collectors, each with a known-bad probe over the same collector.
 *
 * What a green run does NOT prove
 * -------------------------------
 * - It proves a body carries the digest it declares, and that each digest line still restates
 *   text in a rule file. It does not prove an agent follows a line, or that the lines an agent
 *   declares are the ones it needs; the row is a judgment this file only holds still.
 * - A phrase check reads src/assets/rules/*.md, the source the installer copies from, not the
 *   rule files installed on a machine (a shadow override at ~/.devflow/rules is a user's own).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import * as path from 'path';

import { getAllAgentNames } from '../../src/core/plugins.js';
import { ROOT, resolveAgentSource, splitFrontmatter } from '../helpers.js';
import {
  AGENT_CONFIG,
  CORE_RULES_DIGEST,
  OMIT_CLAUDE_MD_DIGESTS,
  deriveOmitDigests,
  type AgentConfigRow,
  type DigestEntry,
  type DigestKey,
} from '../fixtures/agent-config.js';

const RULES_DIR = path.join(ROOT, 'src', 'assets', 'rules');
const HEADING = '## Core rules';
const DIGEST_KEYS = Object.keys(CORE_RULES_DIGEST) as DigestKey[];
/** One short line: a digest line longer than this is a paragraph, and every spawn pays for it. */
const MAX_LINE_CHARS = 160;
/**
 * D-CODE-QUIET (the R-452c outcome): the Code-family bodies (Code, Fix, Refactor) keep CLAUDE.md,
 * so their rows declare no digest. They still carry the context-economy line verbatim as one
 * shared output line, so that one line is allowed in those bodies and no other digest line is.
 */
const CODE_FAMILY_SHARED_OUTPUT_LINE: ReadonlyMap<string, readonly DigestKey[]> = new Map([
  ['code', ['context-economy']],
  ['fix', ['context-economy']],
  ['refactor', ['context-economy']],
]);
const allowedFor = (name: string): readonly DigestKey[] => CODE_FAMILY_SHARED_OUTPUT_LINE.get(name) ?? [];

// ---------------------------------------------------------------------------
// Named collectors
// ---------------------------------------------------------------------------

/** The block an agent body carries for `declared`: the heading, a blank line, one bullet per line. */
function bulletsFor(declared: readonly DigestKey[]): string[] {
  return declared.map(key => `- ${CORE_RULES_DIGEST[key].line}`);
}

/**
 * Every way a body departs from its declared digest: a missing, reworded, extra, reordered or
 * undeclared line, a heading that is not there once, or a bullet under it that is not a digest line.
 * A line in `allowed` may appear without a declaration (a named, recorded exception); it is never required.
 */
function collectBodyDefects(body: string, declared: readonly DigestKey[], allowed: readonly DigestKey[] = []): string[] {
  const out: string[] = [];
  const lines = body.split('\n');
  const headingAt = lines.map((line, i) => (line === HEADING ? i : -1)).filter(i => i !== -1);

  if (declared.length === 0) {
    if (headingAt.length > 0) out.push(`carries a "${HEADING}" heading it does not declare`);
  } else if (headingAt.length !== 1) {
    out.push(`has the "${HEADING}" heading ${headingAt.length} times, expected once`);
  } else {
    const from = headingAt[0];
    const found: string[] = [];
    let i = from + 1;
    if (lines[i] !== '') out.push('has no blank line under the heading');
    else i++;
    while (i < lines.length && lines[i].startsWith('- ')) found.push(lines[i++]);
    const expected = bulletsFor(declared);
    if (found.join('\n') !== expected.join('\n')) {
      out.push(`block reads [${found.join(' | ')}], the row declares [${expected.join(' | ')}]`);
    }
  }

  for (const key of DIGEST_KEYS) {
    const present = body.includes(CORE_RULES_DIGEST[key].line);
    if (present && !declared.includes(key) && !allowed.includes(key)) out.push(`carries the undeclared digest line "${key}"`);
    if (!present && declared.includes(key)) out.push(`lacks the declared digest line "${key}"`);
  }
  return out;
}

/** Every way a digest entry is not one short line restating text that is in the rules. */
function collectEntryDefects(key: string, entry: DigestEntry, rulesCorpus: string): string[] {
  const out: string[] = [];
  if (/[\r\n]/.test(entry.line)) out.push(`${key}: the line spans more than one line`);
  if (entry.line.length > MAX_LINE_CHARS) out.push(`${key}: the line is ${entry.line.length} chars, over ${MAX_LINE_CHARS}`);
  if (entry.phrases.length === 0) out.push(`${key}: no backing phrase`);
  for (const phrase of entry.phrases) {
    if (phrase.trim() === '') out.push(`${key}: an empty phrase`);
    else if (!entry.line.includes(phrase)) out.push(`${key}: the line does not contain its phrase "${phrase}"`);
    else if (!rulesCorpus.includes(phrase)) out.push(`${key}: "${phrase}" is in no file under src/assets/rules/`);
  }
  return out;
}

/** Every way a row's digest departs from its omitClaudeMd flag or from the digest map. */
function collectRowDigestDefects(name: string, row: AgentConfigRow): string[] {
  const out: string[] = [];
  const at = `${name}`;
  if (row.omitClaudeMd && row.digest.length === 0) out.push(`${at}: omits CLAUDE.md and declares no digest line`);
  if (!row.omitClaudeMd && row.digest.length > 0) out.push(`${at}: keeps CLAUDE.md and declares a digest`);
  for (const key of row.digest) {
    if (!DIGEST_KEYS.includes(key)) out.push(`${at}: declares the unknown digest line "${key}"`);
  }
  if (new Set(row.digest).size !== row.digest.length) out.push(`${at}: repeats a digest line`);
  const order = row.digest.map(key => DIGEST_KEYS.indexOf(key));
  if (order.some((n, i) => i > 0 && n < order[i - 1])) out.push(`${at}: lists its digest lines out of the digest's order`);
  return out;
}

/** The `omitClaudeMd:` value of a frontmatter block's inner text, or null when the key is absent. */
function omitValueOf(inner: string): string | null {
  const match = /^omitClaudeMd:[ \t]*(\S*)[ \t]*$/m.exec(inner);
  return match === null ? null : match[1];
}

/** True when the frontmatter ships `omitClaudeMd: true`. */
const omits = (inner: string): boolean => omitValueOf(inner) === 'true';

// ---------------------------------------------------------------------------
// The live corpus
// ---------------------------------------------------------------------------

const rulesCorpus = readdirSync(RULES_DIR)
  .filter(file => file.endsWith('.md'))
  .sort()
  .map(file => readFileSync(path.join(RULES_DIR, file), 'utf-8'))
  .join('\n');

interface AgentText {
  name: string;
  inner: string;
  body: string;
}

function readAgentText(name: string): AgentText {
  const split = splitFrontmatter(resolveAgentSource(name).content);
  if (!split) throw new Error(`${name}.md has no frontmatter block`);
  return { name, inner: split.inner, body: split.body };
}

const REGISTERED = getAllAgentNames();
const texts = new Map<string, AgentText>(REGISTERED.map(name => [name, readAgentText(name)]));

// ---------------------------------------------------------------------------
// The arms
// ---------------------------------------------------------------------------

describe('the digest map (D-CORE-RULES-DIGEST)', () => {
  it('holds the five core-rule lines, each one short line', () => {
    expect(DIGEST_KEYS).toEqual(['context-economy', 'untrusted-input', 'no-secrets', 'escape-output', 'bounded-loops']);
  });

  it('every line restates text that is still in a rule file', () => {
    expect(rulesCorpus.length).toBeGreaterThan(0);
    for (const key of DIGEST_KEYS) {
      expect(collectEntryDefects(key, CORE_RULES_DIGEST[key], rulesCorpus), key).toEqual([]);
    }
  });

  it('known-bad probes: an invented rule, a long line, a phrase outside the line and no phrase are reported', () => {
    const real = CORE_RULES_DIGEST['context-economy'];
    expect(collectEntryDefects('x', real, rulesCorpus)).toEqual([]);
    const invented: DigestEntry = { line: 'Fail fast and never swallow an error.', phrases: ['Fail fast and never swallow an error'] };
    expect(collectEntryDefects('x', invented, rulesCorpus)).toEqual(['x: "Fail fast and never swallow an error" is in no file under src/assets/rules/']);
    expect(collectEntryDefects('x', { ...real, line: real.line + ' ' + real.line }, rulesCorpus).join('\n')).toContain('over 160');
    expect(collectEntryDefects('x', { line: real.line, phrases: ['not in the line'] }, rulesCorpus)).toEqual([
      'x: the line does not contain its phrase "not in the line"',
    ]);
    expect(collectEntryDefects('x', { line: real.line, phrases: [] }, rulesCorpus)).toEqual(['x: no backing phrase']);
    expect(collectEntryDefects('x', { line: `${real.line}\nmore`, phrases: real.phrases }, rulesCorpus)).toEqual([
      'x: the line spans more than one line',
    ]);
  });
});

describe('the rows declare their digest (D-OMIT-CLAUDEMD-SET)', () => {
  for (const [name, row] of Object.entries(AGENT_CONFIG)) {
    it(`${name}: the digest agrees with omitClaudeMd`, () => {
      expect(collectRowDigestDefects(name, row)).toEqual([]);
    });
  }

  it('known-bad probes: an omitting row with no digest, a keeping row with one, an unknown, repeated or reordered line', () => {
    const omitting = AGENT_CONFIG.triage;
    expect(collectRowDigestDefects('x', omitting)).toEqual([]);
    expect(collectRowDigestDefects('x', { ...omitting, digest: [] })).toEqual(['x: omits CLAUDE.md and declares no digest line']);
    expect(collectRowDigestDefects('x', { ...AGENT_CONFIG.code, digest: ['no-secrets'] })).toEqual(['x: keeps CLAUDE.md and declares a digest']);
    expect(collectRowDigestDefects('x', { ...omitting, digest: ['made-up' as DigestKey] })).toContain('x: declares the unknown digest line "made-up"');
    expect(collectRowDigestDefects('x', { ...omitting, digest: ['no-secrets', 'no-secrets'] })).toContain('x: repeats a digest line');
    expect(collectRowDigestDefects('x', { ...omitting, digest: ['no-secrets', 'context-economy'] })).toContain(
      "x: lists its digest lines out of the digest's order",
    );
  });

  it('Tracker declares its digest on its row, like every other omitting agent', () => {
    expect(AGENT_CONFIG.tracker.digest).toEqual(['context-economy', 'untrusted-input', 'no-secrets', 'bounded-loops']);
    expect(collectRowDigestDefects('tracker', AGENT_CONFIG.tracker)).toEqual([]);
  });
});

describe('the set of omitting agents is derived from the rows', () => {
  it('holds every row that omits CLAUDE.md, with its digest', () => {
    const expected = Object.entries(AGENT_CONFIG).filter(([, row]) => row.omitClaudeMd).map(([name]) => name);
    expect([...OMIT_CLAUDE_MD_DIGESTS.keys()].sort()).toEqual([...expected].sort());
  });

  it('covers Skim, Synthesize and Explore, which omitted CLAUDE.md before the digest', () => {
    for (const name of ['skim', 'synthesize', 'explore']) {
      expect(OMIT_CLAUDE_MD_DIGESTS.has(name), name).toBe(true);
    }
  });

  it('is the twelve agents D-OMIT-CLAUDEMD-SET names, and never Code, Harden or Polish', () => {
    expect([...OMIT_CLAUDE_MD_DIGESTS.keys()].sort()).toEqual(
      ['curate', 'evaluate', 'explore', 'git', 'knowledge', 'research', 'skim', 'synthesize', 'test', 'tracker', 'triage', 'validate'],
    );
    for (const name of ['code', 'harden', 'polish']) expect(OMIT_CLAUDE_MD_DIGESTS.has(name), name).toBe(false);
  });

  it('known-bad probe: a new omitting row joins the set without any list being edited', () => {
    const table = { ...AGENT_CONFIG, newagent: { ...AGENT_CONFIG.skim, digest: ['no-secrets'] as DigestKey[] } };
    expect(deriveOmitDigests(table).get('newagent')).toEqual(['no-secrets']);
    expect(deriveOmitDigests(AGENT_CONFIG).has('newagent')).toBe(false);
  });
});

describe('every registered agent ships the flag its declaration says', () => {
  it('reads every registered agent', () => {
    expect([...texts.keys()].sort()).toEqual([...REGISTERED].sort());
    expect(REGISTERED.length).toBeGreaterThan(0);
  });

  for (const name of REGISTERED) {
    it(`${name}.md: omitClaudeMd is ${OMIT_CLAUDE_MD_DIGESTS.has(name) ? 'true' : 'off'}`, () => {
      const { inner } = texts.get(name) as AgentText;
      expect(omits(inner)).toBe(OMIT_CLAUDE_MD_DIGESTS.has(name));
    });
  }

  it('known-bad probes: the flag reader tells true, false and absent apart', () => {
    expect(omits('name: X\nomitClaudeMd: true\n')).toBe(true);
    expect(omits('name: X\nomitClaudeMd: false\n')).toBe(false);
    expect(omits('name: X\nmodel: haiku\n')).toBe(false);
    expect(omitValueOf('name: X\nmodel: haiku\n')).toBeNull();
  });
});

describe('every body carries exactly its declared digest lines', () => {
  for (const name of REGISTERED) {
    const declared = OMIT_CLAUDE_MD_DIGESTS.get(name) ?? [];
    it(`${name}.md carries ${declared.length === 0 ? 'no digest line' : declared.join(', ')}`, () => {
      expect(collectBodyDefects((texts.get(name) as AgentText).body, declared, allowedFor(name))).toEqual([]);
    });
  }

  describe('known-bad probes over the same collector', () => {
    const declared: DigestKey[] = ['context-economy', 'no-secrets'];
    const block = [HEADING, '', ...bulletsFor(declared)].join('\n');
    const body = `# Agent\n\nIntro.\n\n${block}\n\n## Next\n`;

    it('is quiet on a body that carries exactly its declaration', () => {
      expect(collectBodyDefects(body, declared)).toEqual([]);
    });

    it('reports a declared line that is missing', () => {
      const without = body.replace(`${bulletsFor(declared)[1]}\n`, '');
      expect(collectBodyDefects(without, declared).join('\n')).toContain('lacks the declared digest line "no-secrets"');
    });

    it('reports a reworded line', () => {
      const reworded = body.replace('No hardcoded secrets', 'Avoid hardcoded secrets');
      expect(collectBodyDefects(reworded, declared).length).toBeGreaterThan(0);
    });

    it('reports an undeclared digest line, in the block or in prose', () => {
      const extra = body.replace(`${bulletsFor(declared)[1]}\n`, `${bulletsFor(declared)[1]}\n${bulletsFor(['escape-output'])[0]}\n`);
      expect(collectBodyDefects(extra, declared).join('\n')).toContain('undeclared digest line "escape-output"');
      const prose = `${body}\n${CORE_RULES_DIGEST['untrusted-input'].line}\n`;
      expect(collectBodyDefects(prose, declared).join('\n')).toContain('undeclared digest line "untrusted-input"');
    });

    it('reports a bullet in the block that is not a digest line', () => {
      const extra = body.replace(`${bulletsFor(declared)[1]}\n`, `${bulletsFor(declared)[1]}\n- Always be kind.\n`);
      expect(collectBodyDefects(extra, declared).join('\n')).toContain('block reads');
    });

    it('reports reordered lines, a missing or doubled heading, and a heading on an agent that declares none', () => {
      const reordered = [HEADING, '', ...bulletsFor(['no-secrets', 'context-economy'])].join('\n');
      expect(collectBodyDefects(`x\n\n${reordered}\n`, declared).join('\n')).toContain('block reads');
      expect(collectBodyDefects(body.replace(HEADING, '## Rules'), declared).join('\n')).toContain('0 times');
      expect(collectBodyDefects(`${body}\n${block}\n`, declared).join('\n')).toContain('2 times');
      expect(collectBodyDefects(body, []).join('\n')).toContain('heading it does not declare');
    });

    it('allows the shared output line in the Code-family bodies and only there', () => {
      const line = CORE_RULES_DIGEST['context-economy'].line;
      const prose = `# Agent\n\n${line}\n`;
      for (const name of ['code', 'fix', 'refactor']) {
        expect(allowedFor(name), name).toEqual(['context-economy']);
        expect(collectBodyDefects(prose, [], allowedFor(name)), name).toEqual([]);
      }
    });

    it('reports the shared output line on an agent that keeps CLAUDE.md and is not in the Code family', () => {
      const prose = `# Agent\n\n${CORE_RULES_DIGEST['context-economy'].line}\n`;
      expect(allowedFor('polish')).toEqual([]);
      expect(collectBodyDefects(prose, [], allowedFor('polish')).join('\n')).toContain('undeclared digest line "context-economy"');
    });

    it('reports a different undeclared digest line in a Code-family body', () => {
      const prose = `# Agent\n\n${CORE_RULES_DIGEST['context-economy'].line}\n\n${CORE_RULES_DIGEST['no-secrets'].line}\n`;
      expect(collectBodyDefects(prose, [], allowedFor('code')).join('\n')).toContain('undeclared digest line "no-secrets"');
    });

    it('reports a block with no blank line under the heading', () => {
      expect(collectBodyDefects(body.replace(`${HEADING}\n\n`, `${HEADING}\n`), declared).join('\n')).toContain('no blank line');
    });
  });
});
