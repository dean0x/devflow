/**
 * Tool-call sink bypass guard (P3a-S11/S12, AC-3.5, [DR-01], [DR-06], GAP-04).
 *
 * WHAT THIS GUARDS, AND WHY A GUARD IS THE ONLY THING THAT CAN
 * ------------------------------------------------------------
 * A file sink gates its post with a shell `&&` chain: the scrubber's non-zero
 * exit stops the `gh` command mechanically, and no prompt text is load-bearing.
 * A sink reached through a tool call has no `--body-file` and no shell operator
 * between the scrub and the post, so the chain cannot exist. GAP-04 records what
 * happens next: the recipe silently downgrades a MECHANICAL gate to an
 * INSTRUCTION, and an instruction is not a gate.
 *
 * `redact-secrets.cjs --emit` restores the mechanism — the scrubbed bytes are
 * only obtainable from behind a framing line the script alone can produce — but
 * the mechanism only holds while every posting mechanic actually uses it. That is
 * a property of PROSE, and prose has no compiler. This file is its compiler.
 *
 * FOUR CLAIMS, kept separate so no one of them can carry the others (PF-064):
 *   1. CONTRACT — the contract module states all four clauses: the
 *      `{SCRUBBED_BODY}` rule, `D11-OK`, `SECRET-EXPOSED` [DR-01] and the
 *      `<bytes>` verification [DR-06]. Asserted against the SOURCE `.mds`.
 *   2. BYPASS — the bypass regex is RED on real bypass shapes, proven inline.
 *   3. FORWARD — every posting mechanic that spells a body argument names all
 *      four clauses, and no file in the sink class posts an ungated body. The
 *      corpus is LIVE: a provider mechanics tree exists, so this arm is now
 *      evidence about shipped files rather than about the collector alone.
 *   4. PROBES — the forward collector is driven by seeded mechanics that omit
 *      exactly one clause each, so an inert collector is reported here rather
 *      than passing over a real corpus.
 *
 * SCOPE [E2]: the contract clauses are asserted against
 * `src/assets/mds/tracker/_mcp.mds`, the SOURCE, and not against the generated
 * `dist/skills/git/references/tracker/_mcp.md`. The source is the authority in
 * both gate states — the generated file exists only while a provider needs it,
 * and a guard about the contract's WORDING must not go quiet when the gate shuts.
 * An arm below asserts the generated copy carries the same clauses while it
 * exists, which is a different claim (the build emits what was authored) and is
 * kept separate for that reason.
 *
 * MDS ESCAPE ASYMMETRY: in an `.mds` source a brace in PROSE is written `\{`, and
 * raw inside a column-0 fence. The same literal therefore has two spellings in
 * one file, and a guard matching only one of them would pass or fail on where the
 * author happened to put the sentence. `unescapeMds` normalises before matching,
 * and a probe proves it.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import * as path from 'path';

import { compiledSkillRefsDir } from '../../src/core/assets.js';
import {
  MCP_BACKED_PROVIDER_SUBDIRS,
  MCP_CONTRACT_MODULE,
  mcpContractIsGenerated,
} from '../../src/core/mds-variants.js';
import { ROOT, walkFiles, type CorpusEntry } from '../helpers.js';

// ---------------------------------------------------------------------------
// Source reading
// ---------------------------------------------------------------------------

/**
 * Collapse MDS's prose brace escapes so one literal has one spelling.
 *
 * Only `\{` and `\}` — deliberately not a general unescape. Widening it would
 * start rewriting the module's own backslashes and the guard would be matching
 * text that appears in no artifact.
 */
export function unescapeMds(source: string): string {
  return source.replace(/\\\{/g, '{').replace(/\\\}/g, '}');
}

/** The contract module's source, fail-loud. Never the generated file [E2]. */
function contractSource(): string {
  const abs = path.join(ROOT, MCP_CONTRACT_MODULE.source);
  if (!existsSync(abs)) {
    throw new Error(
      `${MCP_CONTRACT_MODULE.source} is absent — the tool-call contract is what this guard is ` +
      `about, so there is nothing to assert. It is authored in 3a-4 (P3a-S12).`,
    );
  }
  return unescapeMds(readFileSync(abs, 'utf-8'));
}

// ---------------------------------------------------------------------------
// 1. CONTRACT — the four clauses, against the source module
// ---------------------------------------------------------------------------

/** One required clause of the tool-call D11 contract, and why it exists. */
interface ContractClause {
  readonly id: string;
  readonly literal: string;
  readonly why: string;
}

const CONTRACT_CLAUSES: readonly ContractClause[] = [
  {
    id: 'body placeholder',
    literal: '{SCRUBBED_BODY}',
    why:
      'the body argument has ONE spelling, so a mechanic that names any other value is visibly ' +
      'not using the gate',
  },
  {
    id: 'framing line',
    literal: 'D11-OK',
    why:
      'the framing line is the gate: bytes with no `D11-OK` line above them are bytes that were ' +
      'never scrubbed',
  },
  {
    id: 'rotation warning [DR-01]',
    literal: 'SECRET-EXPOSED (rotate {type} credential — the source file still holds it)',
    why:
      'a credential scrubbed out of a comment is still live in the source file. Redaction is not ' +
      'remediation; without this clause the one user who needs to rotate a key is never told',
  },
  {
    id: 'scrub count echo [DR-01]',
    literal: 'SCRUB: N',
    why:
      'the count is what makes the rotation warning conditional on something. Echoing it is also ' +
      'the only way the operator sees that a real secret was present',
  },
  {
    id: 'byte verification [DR-06]',
    literal: '<bytes>',
    why:
      'a Bash result is truncated by the harness with the HEAD and TAIL preserved and the MIDDLE ' +
      'elided, so the body arrives intact at both ends with a hole between them: a bare "no ' +
      'framing line ⇒ do not post" gate passes on it, and so would an eyeball. The byte count is ' +
      'the only thing that can see the hole (docs/reference/platform-assumptions.md records the ' +
      'shape and the limit)',
  },
];

/** Named collector: required clauses absent from a contract text. */
export function collectMissingClauses(text: string): string[] {
  return CONTRACT_CLAUSES.filter(c => !text.includes(c.literal)).map(c => `${c.id}: ${c.literal}`);
}

describe('tool-call contract: the source module states every D11 clause [E2]', () => {
  const source = contractSource();

  it('names all four clauses, and the byte check is stated as a REFUSAL not a note', () => {
    expect(
      collectMissingClauses(source),
      `the tool-call contract is missing clause(s). Each one is the only statement of a control ` +
      `that has no mechanical backstop at a tool-call sink:\n  ` +
      CONTRACT_CLAUSES.map(c => `${c.id} — ${c.why}`).join('\n  '),
    ).toEqual([]);

    // A clause is only a clause if it says what NOT to do. `<bytes>` mentioned in
    // passing beside a "verify if convenient" would satisfy a containment check
    // while gating nothing.
    expect(source, 'the byte check must forbid posting on mismatch').toContain('DO NOT POST');
    expect(
      source,
      'and it must name the DEGRADED reason, or the refusal is silent',
    ).toContain('TRACEABILITY: DEGRADED (redaction unavailable)');
  });

  it('forbids re-reading the raw body, and forbids every repair of a truncated one', () => {
    // The two ways a gated body becomes an ungated one without touching the gate:
    // re-composing from the raw file, and "helpfully" chunking a body the byte
    // check rejected.
    expect(source, 'the raw body must never be re-read').toContain('$DEVFLOW_BODY_RAW');
    for (const forbidden of ['NO base64', 'NO chunking', 'NO summarisation', 'NO re-encoding']) {
      expect(source, `the contract must forbid: ${forbidden}`).toContain(forbidden);
    }
  });

  it('forbids the HTTP fallback — the highest-value bypass of both controls (GAP-19)', () => {
    // A tool that is absent must degrade, never fall back to a transport that
    // bypasses the scrub gate AND reads a credential.
    for (const literal of ['curl', 'wget', 'credential from the environment']) {
      expect(source, `the no-HTTP-fallback clause must name: ${literal}`).toContain(literal);
    }
  });

  it('known-bad probe: the same collector reports each clause dropped in turn', () => {
    // Drives collectMissingClauses over the real source with one clause removed at
    // a time. Without this the empty-difference assertion above is equally green
    // for a collector that returns nothing.
    for (const clause of CONTRACT_CLAUSES) {
      const seeded = source.split(clause.literal).join('«removed»');
      expect(
        collectMissingClauses(seeded),
        `dropping "${clause.id}" must be reported`,
      ).toEqual([`${clause.id}: ${clause.literal}`]);
    }
    expect(CONTRACT_CLAUSES.length, 'the clause registry must be non-empty (PF-018)')
      .toBeGreaterThanOrEqual(5);
  });

  it('the clauses are pinned against the SOURCE, and the generated copy carries them too [E2]', () => {
    // Two separate claims, kept separate. The SOURCE is the authority in either
    // gate state — that is what [E2] is about, and it is why the clause table above
    // reads the `.mds`. What the generated copy owes, while the gate is open, is
    // that the build emitted what was authored; a compile step that dropped a
    // clause would leave every shipped posting mechanic pointing at a contract
    // missing the rule it invokes.
    expect(
      mcpContractIsGenerated(),
      'the gate is open on this tree — a registered provider needs the contract',
    ).toBe(true);
    const generated = path.join(compiledSkillRefsDir(), 'tracker', '_mcp.md');
    expect(
      existsSync(generated),
      `${generated} is absent while the gate is open — run \`npm run build\``,
    ).toBe(true);
    expect(
      collectMissingClauses(readFileSync(generated, 'utf-8')),
      'the generated contract is missing clause(s) the source states — the compile step dropped ' +
      'them, and every posting mechanic that names this file invokes a rule it no longer contains',
    ).toEqual([]);
  });

  it('unescapeMds normalises the prose spelling, and only the brace escapes', () => {
    expect(unescapeMds('spells `\\{SCRUBBED_BODY\\}` in prose')).toContain('{SCRUBBED_BODY}');
    expect(unescapeMds('a fenced {SCRUBBED_BODY}')).toContain('{SCRUBBED_BODY}');
    expect(
      unescapeMds('a literal backslash \\n and \\`tick\\`'),
      'a general unescape would rewrite text that appears in no artifact',
    ).toBe('a literal backslash \\n and \\`tick\\`');
  });
});

// ---------------------------------------------------------------------------
// 2. BYPASS — the regex, proven red on real bypass shapes
// ---------------------------------------------------------------------------

/**
 * A body-shaped argument assigned anything other than the gated placeholder.
 *
 * The alternation is the vocabulary a tracker tool call actually uses for the
 * field that carries user-visible text. The negative lookahead is the whole
 * guard: the ONLY accepted right-hand side is `{SCRUBBED_BODY}`, so a raw
 * variable, a heredoc, a composed string and a file path are all reported without
 * the guard having to enumerate them.
 *
 * Constructed per call — a shared `g`-flagged object carries `lastIndex` between
 * callers and would skip matches depending on call order.
 */
function bypassPattern(): RegExp {
  return /\b(?:body|description|content|text|markdown|adf|comment[_-]?body)\s*[:=]\s*(?!\{SCRUBBED_BODY\})\S/gi;
}

/** Named collector: bypass sites, as `{path}:{line}: {text}`. */
export function collectBypassSites(corpus: readonly CorpusEntry[]): string[] {
  const sites: string[] = [];
  for (const entry of corpus) {
    const lines = unescapeMds(entry.content).split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (bypassPattern().test(lines[i])) {
        sites.push(`${entry.path}:${i + 1}: ${lines[i].trim().slice(0, 100)}`);
      }
    }
  }
  return sites;
}

describe('bypass regex: red on every shape that posts an ungated body', () => {
  /** The three shapes §8.9 names, plus the ones they generalise to. */
  const KNOWN_BAD: readonly string[] = [
    'create_comment(body: $DEVFLOW_BODY_RAW)',
    'addCommentToJiraIssue(body: "$RAW")',
    'comment_body = $DEVFLOW_BODY_RAW',
    'description: "$(cat "$DEVFLOW_BODY_RAW")"',
    'markdown = <<EOF',
    'adf: renderAdf($RAW)',
    'text: summarise($DEVFLOW_BODY)',
  ];

  it('every known-bad bypass shape is reported', () => {
    expect(KNOWN_BAD.length, 'the known-bad corpus must be non-empty (PF-018)').toBeGreaterThan(0);
    const missed: string[] = [];
    for (const line of KNOWN_BAD) {
      const found = collectBypassSites([{ path: 'seed.md', content: line }]);
      if (found.length === 0) missed.push(line);
    }
    expect(
      missed,
      `bypass shape(s) the regex does not see — each is a posting mechanic that would ship an ` +
      `unscrubbed body past a gate that looks present:\n  ${missed.join('\n  ')}`,
    ).toEqual([]);
  });

  it('the gated spelling is the ONLY accepted right-hand side, in both MDS spellings', () => {
    for (const line of [
      'create_comment(body: {SCRUBBED_BODY})',
      'addCommentToIssue(body: \\{SCRUBBED_BODY\\})',
      'description: {SCRUBBED_BODY}',
    ]) {
      expect(
        collectBypassSites([{ path: 'seed.md', content: line }]),
        `"${line}" uses the gate and must not be reported`,
      ).toEqual([]);
    }
  });

  it('no file in the live sink class posts an ungated body', () => {
    // The bypass regex, applied to the corpus rather than only to seeds. Until a
    // provider mechanics tree existed there was nothing to apply it to; now there
    // is, and a control that only ever runs against its own known-bad samples is
    // a control nobody is subject to (PF-064).
    const corpus = postingMechanicCorpus();
    expect(corpus.length, 'empty sink class — run `npm run build`').toBeGreaterThan(0);
    const sites = collectBypassSites(corpus);
    expect(
      sites,
      'a body-shaped argument in the sink class is assigned something other than the gated ' +
      'placeholder. The ONLY accepted right-hand side is `{SCRUBBED_BODY}`, because the bytes ' +
      'behind it are obtainable only from behind a framing line the scrubber alone can ' +
      `produce:\n  ${sites.join('\n  ')}`,
    ).toEqual([]);
  });

  it('a near-miss placeholder is still a bypass', () => {
    // The failure mode a substring check would miss: a plausible-looking
    // placeholder that is not the one the script produces.
    for (const line of ['body: {SCRUBBED}', 'body: {BODY}', 'body: $SCRUBBED_BODY']) {
      expect(collectBypassSites([{ path: 'seed.md', content: line }]), `"${line}"`).not.toEqual([]);
    }
  });

  it('assert RAW never shares a line with a posting verb in the sink class', () => {
    // A second, independent control on the same failure: even a mechanic whose
    // body argument is spelled correctly must not mention the raw file on the
    // posting line, because that is where a "just in case" fallback gets written.
    // NO TRAILING boundary on the verb either, and for the same class of reason:
    // real tool names are compound (`addCommentToJiraIssue`,
    // `createCommentOnIssue`), so `\badd[_-]?comment\b` matches `addComment` and
    // then fails on the `T` that follows — inert against every actual tool name.
    // The leading `\b` stays, so `my_add_comment_helper` is still matched on its
    // own token and an arbitrary substring is not.
    //
    // A SPACE is admitted in the separator class alongside `_` and `-`, because
    // the contract's own rule is to select by capability DESCRIPTION rather than
    // by tool name — so a compliant mechanics file writes *add comment*, not
    // `addComment`. With only `[_-]?` this predicate matched every tool name and
    // no capability description, i.e. it was inert against exactly the corpus the
    // contract mandates. The conjunction with `RAW\b` on the SAME line is what
    // keeps the widening from reporting ordinary prose about adding comments.
    const POSTING_VERBS = /\b(?:create[_\- ]?comment|add[_\- ]?comment|post[_\- ]?comment|update[_\- ]?description|edit[_\- ]?comment)/i;
    // TRAILING boundary only. `\bRAW\b` cannot match `$DEVFLOW_BODY_RAW`: the
    // underscore before `RAW` is a word character, so there is no word boundary
    // there — and the variable the raw body actually travels in is exactly that
    // spelling. A leading `\b` would have made this predicate silently inert
    // against the one name it exists to catch.
    const RAW_REF = /RAW\b/;
    const offenders: string[] = [];
    for (const entry of postingMechanicCorpus()) {
      for (const [i, line] of unescapeMds(entry.content).split('\n').entries()) {
        if (POSTING_VERBS.test(line) && RAW_REF.test(line)) {
          offenders.push(`${entry.path}:${i + 1}: ${line.trim().slice(0, 100)}`);
        }
      }
    }
    expect(offenders, `posting verb sharing a line with RAW:\n  ${offenders.join('\n  ')}`).toEqual([]);
    // Known-bad, inline: driven over the tool-name spelling, the capability
    // spelling the contract actually mandates, and both spellings of the raw
    // reference.
    for (const line of [
      'create_comment(body: $DEVFLOW_BODY_RAW)',
      'addCommentToJiraIssue(body: "$RAW")',
      'Post through the *add comment* capability with $DEVFLOW_BODY_RAW.',
      'Fall back to the *update description* capability reading $RAW directly.',
    ]) {
      expect(POSTING_VERBS.test(line) && RAW_REF.test(line), `"${line}" must be caught`).toBe(true);
    }
    // …and does NOT fire on a gated line that never mentions the raw body.
    expect(RAW_REF.test('create_comment(body: {SCRUBBED_BODY})')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3 + 4. FORWARD — every posting mechanic names every clause
// ---------------------------------------------------------------------------

/**
 * The generated mechanics of every provider whose sink is a tool call.
 *
 * LIVE from Phase 3b: a provider mechanics tree exists, so every arm below is
 * evidence about shipped files. The emptiness assertion that stood here while the
 * tree did not exist is gone, deliberately and in the commit that gave the arm a
 * subject — it was written to go red at exactly this moment and its message said
 * so. Providers are read from MCP_BACKED_PROVIDER_SUBDIRS rather than listed, so
 * a provider added later joins this corpus by construction; a sub-directory that
 * does not exist contributes nothing, and the ★ arm below names every member of
 * the set so that absence is reported rather than absorbed.
 */
function postingMechanicCorpus(): CorpusEntry[] {
  const corpus: CorpusEntry[] = [];
  const refs = compiledSkillRefsDir();
  for (const subdir of MCP_BACKED_PROVIDER_SUBDIRS) {
    const dir = path.join(refs, ...subdir.split('/'));
    if (!existsSync(dir)) continue;
    for (const file of walkFiles(dir, f => f.endsWith('.md'))) {
      corpus.push({
        path: `${subdir}/${path.relative(dir, file)}`,
        content: readFileSync(file, 'utf-8'),
      });
    }
  }
  return corpus;
}

/**
 * Named collector: posting mechanics that spell the gated body placeholder but
 * fail to name one of the clauses that make it a gate.
 *
 * Scoped to files that DO spell `{SCRUBBED_BODY}`, because that is what makes a
 * file a posting mechanic. A file-level scope rather than a line-level one: the
 * rotation warning and the byte check are steps AROUND the post, not arguments to
 * it, so demanding them on the posting line would demand the wrong shape.
 */
export function collectUngatedPostingMechanics(corpus: readonly CorpusEntry[]): string[] {
  const violations: string[] = [];
  for (const entry of corpus) {
    const text = unescapeMds(entry.content);
    if (!text.includes('{SCRUBBED_BODY}')) continue;
    for (const missing of collectMissingClauses(text)) {
      violations.push(`${entry.path}: missing ${missing}`);
    }
  }
  return violations;
}

describe('forward arm: every posting mechanic names every clause [DR-01][DR-06]', () => {
  it('★ the live corpus reaches every tool-call provider and holds a real posting mechanic', () => {
    // PF-018, in the direction that matters now that a subject exists: every arm
    // below is an empty-difference assertion, and an empty corpus satisfies all of
    // them. So the corpus is asserted to be populated AND to contain a file that
    // actually spells the gated placeholder — a tree of read-only mechanics would
    // clear the first check and leave the forward arm proving nothing.
    const corpus = postingMechanicCorpus();
    expect(
      corpus.length,
      'no provider mechanics file was read — run `npm run build`; a posting-mechanic guard over ' +
      'zero posting mechanics reports success about nothing',
    ).toBeGreaterThan(0);

    // Corpus REACH, asserted PER MEMBER of the set the corpus ranges over. The
    // length check above is satisfied by any ONE provider, so a tree that failed
    // to generate — or was renamed — leaves every arm in this file green having
    // never read it: the matcher and the predicate are proven over ground the
    // corpus never covered, which is PF-064's second claim failing on its own.
    // Named per member rather than counted, because a count is a second number to
    // keep in step with the registry and it names nothing when it goes red.
    for (const subdir of MCP_BACKED_PROVIDER_SUBDIRS) {
      expect(
        corpus.some(e => e.path.startsWith(`${subdir}/`)),
        `no mechanics file was read under ${subdir} — every arm below would pass without ever ` +
        'reading this provider. Run `npm run build`.',
      ).toBe(true);
    }

    const posting = corpus.filter(e => unescapeMds(e.content).includes('{SCRUBBED_BODY}'));
    expect(
      posting.map(e => e.path),
      'the corpus holds no file that spells the gated body placeholder, so every clause arm below ' +
      'is skipped by its own scope filter',
    ).not.toEqual([]);
  });

  it('no posting mechanic in the live corpus is ungated', () => {
    expect(
      collectUngatedPostingMechanics(postingMechanicCorpus()),
      'a posting mechanic spells the gated body placeholder without naming the clauses that make ' +
      'it a gate. The placeholder alone is decoration: it is `D11-OK` that proves the bytes were ' +
      'scrubbed, `<bytes>` that proves they are whole, and `SECRET-EXPOSED` that tells the user ' +
      'to rotate what was found.',
    ).toEqual([]);
  });

  it('known-bad probe [DR-01]: a mechanic that omits the rotation line is reported', () => {
    // §8.9's named known-bad, verbatim in intent: a provider posting mechanic that
    // uses the gate and forgets the rotation warning.
    const seeded: CorpusEntry = {
      path: 'tracker/jira/post-resolution-summary.md',
      content: [
        '## Operation: post-resolution-summary',
        'Scrub with `--emit`, read the `D11-OK` line, verify `<bytes>`, then:',
        'addCommentToJiraIssue(issueKey: $KEY, body: {SCRUBBED_BODY})',
        'Echo `SCRUB: N [type:count,…]` into the output.',
      ].join('\n'),
    };
    expect(collectUngatedPostingMechanics([seeded])).toEqual([
      'tracker/jira/post-resolution-summary.md: missing rotation warning [DR-01]: ' +
      'SECRET-EXPOSED (rotate {type} credential — the source file still holds it)',
    ]);
  });

  it('known-bad probe [DR-06]: a mechanic naming D11-OK but not <bytes> is reported', () => {
    const seeded: CorpusEntry = {
      path: 'tracker/linear/comment.md',
      content: [
        '## Operation: comment',
        'Scrub with `--emit` and read the `D11-OK` line.',
        'create_comment(issueId: $ID, body: {SCRUBBED_BODY})',
        'Echo `SCRUB: N [type:count,…]`; on N > 0 emit',
        '`SECRET-EXPOSED (rotate {type} credential — the source file still holds it)`.',
      ].join('\n'),
    };
    expect(collectUngatedPostingMechanics([seeded])).toEqual([
      'tracker/linear/comment.md: missing byte verification [DR-06]: <bytes>',
    ]);
  });

  it('a fully gated seeded mechanic is NOT reported — the collector is not a blanket refusal', () => {
    const seeded: CorpusEntry = {
      path: 'tracker/jira/comment.md',
      content: [
        '## Operation: comment',
        'Scrub with `--emit`; require a `D11-OK` line and verify `<bytes>` before posting.',
        'addCommentToJiraIssue(issueKey: $KEY, body: {SCRUBBED_BODY})',
        'Echo `SCRUB: N [type:count,…]`; on N > 0 also emit',
        '`SECRET-EXPOSED (rotate {type} credential — the source file still holds it)`.',
      ].join('\n'),
    };
    expect(collectUngatedPostingMechanics([seeded])).toEqual([]);
  });

  it('a file that never spells the placeholder is out of scope, not a violation', () => {
    // A github mechanics file, a read-only op, or a contract document is not a
    // posting mechanic. Reporting them would make the arm unfixable.
    const seeded: CorpusEntry = {
      path: 'tracker/jira/fetch-issue.md',
      content: '## Operation: fetch-issue\nFetch by key and wrap the body in containment markers.\n',
    };
    expect(collectUngatedPostingMechanics([seeded])).toEqual([]);
  });
});
