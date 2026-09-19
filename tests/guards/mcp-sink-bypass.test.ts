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
 * FIVE CLAIMS, kept separate so no one of them can carry the others (PF-064):
 *   1. CONTRACT — the contract module states every clause in CONTRACT_CLAUSES:
 *      the `{SCRUBBED_BODY}` rule, `D11-OK`, `SECRET-EXPOSED` and the `SCRUB: N`
 *      echo that makes it conditional [DR-01], and the `<bytes>` verification
 *      [DR-06]. Asserted against the SOURCE `.mds`.
 *   2. BYPASS — the bypass matcher is RED on real bypass shapes, proven inline.
 *      Two shapes, because a sink has two spellings: the ARGUMENT form
 *      (`body: X`) and the PROSE form (`the description field carrying X`) that
 *      §14.4's select-by-capability-description rule produces. What the matcher
 *      deliberately cannot express is written down on the collector (PF-064).
 *   3. FORWARD — every posting mechanic that spells a body argument names every
 *      clause, and no file in the sink class posts an ungated body. The
 *      corpus is LIVE: a provider mechanics tree exists, so this arm is now
 *      evidence about shipped files rather than about the collector alone.
 *   4. PROBES — the forward collector is driven by seeded mechanics that omit
 *      exactly one clause each, so an inert collector is reported here rather
 *      than passing over a real corpus.
 *   5. RESIDUE — the gate's guarantee is about the SINK, and the staging file is
 *      a second sink: `$DEVFLOW_BODY_RAW` holds precisely the bytes the scrub
 *      exists to delete (PF-066's second defect). So the always-loaded D11 block
 *      is asserted to REMOVE every staging file it creates, and to remove them in
 *      the one shape that works as shell — armed as a `trap` so a `D11-FAIL` path
 *      is covered too, with a plain `rm` because a permission layer refuses the
 *      flagged form, and with the gate's status captured ahead of the removals
 *      (PF-066's third defect: cleanup that runs after the gate overwrites `$?`
 *      and reports a refusal as success). Claim 5 is about the file-sink and
 *      tool-call halves alike: one rule, in the block every spawn loads.
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

import { compiledSkillRefsDir, skillsDir } from '../../src/core/assets.js';
import {
  MCP_BACKED_PROVIDER_SUBDIRS,
  MCP_CONTRACT_MODULE,
  mcpContractIsGenerated,
} from '../../src/core/mds-variants.js';
import {
  ROOT,
  gitAgentSinkCorpus,
  resolveAgentSource,
  walkFiles,
  type CorpusEntry,
} from '../helpers.js';

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
// 1. CONTRACT — every clause in the registry, against the source module
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

  it('names every clause in the registry, and states the byte check as a REFUSAL not a note', () => {
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
 * The vocabulary a tracker tool call uses for the field carrying user-visible
 * text. Shared by both shapes below so one field name cannot be gated in the
 * argument spelling and ungated in the prose one.
 */
const BODY_FIELDS = 'body|description|content|text|markdown|adf|comment[_-]?body';

/**
 * A body-shaped ARGUMENT assigned anything other than the gated placeholder.
 *
 * The negative lookahead is the whole guard: the ONLY accepted right-hand side is
 * `{SCRUBBED_BODY}`, so a raw variable, a heredoc, a composed string and a file
 * path are all reported without the guard having to enumerate them.
 *
 * Constructed per call — a shared `g`-flagged object carries `lastIndex` between
 * callers and would skip matches depending on call order.
 */
function bypassPattern(): RegExp {
  return new RegExp(`\\b(?:${BODY_FIELDS})\\s*[:=]\\s*(?!\\{SCRUBBED_BODY\\})\\S`, 'gi');
}

/**
 * The same sink written as PROSE: `the description field carrying X`.
 *
 * This shape has no `key: value` form for the argument matcher to see, and it is
 * not a hypothetical spelling — it is what the contract's own doctrine produces.
 * §14.4 requires a mechanic to select a capability by DESCRIPTION and never by
 * tool name, so a compliant author writes a sentence rather than a call, and the
 * body argument arrives inside that sentence. Both shipped
 * `ensure-traceable-issue` mechanics already carry one. A matcher that reads only
 * the argument form is therefore inert against exactly the shape this repo's
 * rules steer authors towards — PF-064's matcher claim, failing on the wording
 * the contract mandates.
 *
 * The right-hand side is captured rather than rejected outright, because one
 * non-placeholder spelling is legitimate: see GATED_ANAPHOR.
 */
function prosePattern(): RegExp {
  return new RegExp(
    `\\b(?:${BODY_FIELDS})\\s+field\\s+(?:carrying|holding|containing|bearing|set to)\\s+` +
    `(?!\\{SCRUBBED_BODY\\})([^\\s.;][^.;]*)`,
    'gi',
  );
}

/**
 * The one non-placeholder right-hand side a prose sink may use: a back-reference
 * to the gated value already named earlier in the sentence.
 *
 * Admitted ONLY when `{SCRUBBED_BODY}` is spelled on the same line, which is what
 * makes it a reference rather than a promise. `…the description field carrying
 * the same gated value` on a line that never names the placeholder is a dangling
 * anaphor — it reads as gated and instructs nothing — so it is reported.
 */
const GATED_ANAPHOR = /^the same gated value\b/i;

/**
 * Named collector: bypass sites, as `{path}:{line}: {text}`.
 *
 * DELIBERATE NON-GOALS, written down rather than inferred from a green run
 * (PF-064). This matcher reads ONE LINE at a time and ONE named field per match,
 * so it cannot express:
 *   - a body composed across several lines and referenced later by a variable
 *     the mechanic introduced (`$BODY` assigned in step 2, posted in step 5);
 *   - a field named by a synonym outside BODY_FIELDS (`summary`, `note`,
 *     `payload`) — widening the vocabulary is the fix, not a smarter matcher;
 *   - an indirect reference with no field word at all ("post the value from
 *     step 3"), which has no syntactic handle to key on.
 * The forward arm below is the control that covers what this one cannot: it
 * demands every clause that makes the placeholder a gate, per FILE, so a mechanic
 * evading this matcher still has to state the gate it is evading.
 */
export function collectBypassSites(corpus: readonly CorpusEntry[]): string[] {
  const sites: string[] = [];
  for (const entry of corpus) {
    const lines = unescapeMds(entry.content).split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const report = (): void => {
        sites.push(`${entry.path}:${i + 1}: ${line.trim().slice(0, 100)}`);
      };
      if (bypassPattern().test(line)) {
        report();
        continue;
      }
      for (const match of line.matchAll(prosePattern())) {
        if (GATED_ANAPHOR.test(match[1].trim()) && line.includes('{SCRUBBED_BODY}')) continue;
        report();
        break;
      }
    }
  }
  return sites;
}

/**
 * A posting verb, in either spelling an author reaches for.
 *
 * NO TRAILING boundary, deliberately: real tool names are compound
 * (`addCommentToJiraIssue`, `createCommentOnIssue`), so `\badd[_-]?comment\b`
 * matches `addComment` and then fails on the `T` that follows — inert against
 * every actual tool name. The leading `\b` stays, so `my_add_comment_helper` is
 * still matched on its own token and an arbitrary substring is not.
 *
 * A SPACE is admitted in the separator class alongside `_` and `-`, because the
 * contract's own rule is to select by capability DESCRIPTION rather than by tool
 * name — so a compliant mechanics file writes *add comment*, not `addComment`.
 * With only `[_-]?` this matched every tool name and no capability description,
 * i.e. it was inert against exactly the corpus the contract mandates.
 */
const POSTING_VERBS = /\b(?:create[_\- ]?comment|add[_\- ]?comment|post[_\- ]?comment|update[_\- ]?description|edit[_\- ]?comment)/i;

/**
 * A reference to the raw, unscrubbed body file.
 *
 * TRAILING boundary only. `\bRAW\b` cannot match `$DEVFLOW_BODY_RAW`: the
 * underscore before `RAW` is a word character, so there is no word boundary there
 * — and the variable the raw body actually travels in is exactly that spelling. A
 * leading `\b` would make this silently inert against the one name it exists to
 * catch.
 */
const RAW_REF = /RAW\b/;

/**
 * Named collector: lines where a posting verb shares a line with the raw body.
 *
 * The conjunction of the two patterns is the predicate, and it is named here so
 * the live assertion and its known-bad probe drive the SAME one. Inline, the
 * probe re-spelled `POSTING_VERBS.test(l) && RAW_REF.test(l)` over literals —
 * which proves the copy fires, not the guard. The conjunction is also what keeps
 * the widened verb class from reporting ordinary prose about adding comments.
 */
export function collectRawRefOnPostingLine(corpus: readonly CorpusEntry[]): string[] {
  const offenders: string[] = [];
  for (const entry of corpus) {
    for (const [i, line] of unescapeMds(entry.content).split('\n').entries()) {
      if (POSTING_VERBS.test(line) && RAW_REF.test(line)) {
        offenders.push(`${entry.path}:${i + 1}: ${line.trim().slice(0, 100)}`);
      }
    }
  }
  return offenders;
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
    // The PROSE shape — no `key: value` anywhere in it, so the argument matcher
    // alone is blind to every one of these. This is the spelling §14.4's
    // select-by-capability-description rule produces, and both shipped
    // `ensure-traceable-issue` mechanics are written in it.
    'or on a new issue through the *create issue* capability with the description field carrying $DEVFLOW_BODY_RAW.',
    'Open the issue with the body field holding the composed markdown.',
    'Use the *update description* capability with the description field set to $RAW.',
    // A DANGLING anaphor: it reads as gated, but the line never names the value
    // it claims to reuse, so the mechanic instructs nothing.
    'On a new issue, use the description field carrying the same gated value.',
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
      // The prose shape, gated the two ways it can be: by naming the placeholder,
      // and by referring back to one the same line already named.
      'with the description field carrying {SCRUBBED_BODY}',
      'Post through the *add comment* capability with arguments (issue key, body: ' +
      '\\{SCRUBBED_BODY\\}), or on a new issue through the *create issue* capability with the ' +
      'description field carrying the same gated value.',
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
    const corpus = postingMechanicCorpus();
    expect(
      corpus.length,
      'empty sink class — run `npm run build`. This arm is an emptiness claim like its sibling, ' +
      'so a corpus of zero files satisfies it while the probe below still passes: the predicate ' +
      'would be proven live over ground nothing ever read (PF-018)',
    ).toBeGreaterThan(0);

    const offenders = collectRawRefOnPostingLine(corpus);
    expect(offenders, `posting verb sharing a line with RAW:\n  ${offenders.join('\n  ')}`).toEqual([]);

    // Known-bad, driven through the SAME collector rather than by re-spelling the
    // conjunction over literals: a probe that re-implements the predicate proves
    // the copy is live, not the guard. Covers the tool-name spelling, the
    // capability spelling the contract actually mandates, and both spellings of
    // the raw reference.
    for (const line of [
      'create_comment(body: $DEVFLOW_BODY_RAW)',
      'addCommentToJiraIssue(body: "$RAW")',
      'Post through the *add comment* capability with $DEVFLOW_BODY_RAW.',
      'Fall back to the *update description* capability reading $RAW directly.',
    ]) {
      expect(
        collectRawRefOnPostingLine([{ path: 'seed.md', content: line }]),
        `"${line}" must be caught`,
      ).toEqual([`seed.md:1: ${line}`]);
    }
    // …and does NOT fire on a gated line that never mentions the raw body, nor on
    // prose about adding comments that names no raw file.
    for (const line of [
      'create_comment(body: {SCRUBBED_BODY})',
      'Post through the *add comment* capability with arguments (issue key, body: {SCRUBBED_BODY}).',
    ]) {
      expect(
        collectRawRefOnPostingLine([{ path: 'seed.md', content: line }]),
        `"${line}" is gated and must not be reported`,
      ).toEqual([]);
    }
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

// ---------------------------------------------------------------------------
// 5. RESIDUE — the staging files are removed, and the removal works as shell
// ---------------------------------------------------------------------------

/**
 * Every staging file the D11 recipes create, spelled as the shell quotes it.
 *
 * QUOTED, not bare: `$DEVFLOW_BODY` is a prefix of `$DEVFLOW_BODY_RAW`, so a bare
 * substring test for the shorter name is satisfied by the longer one and the
 * scrubbed body could drop out of the removal unnoticed. The quotes are also the
 * shape the removal must actually use — an unquoted operand is a word-splitting
 * bug in the one line that touches a path nobody chose.
 */
const D11_STAGING_FILES: readonly string[] = [
  '"$DEVFLOW_BODY_RAW"',
  '"$DEVFLOW_BODY"',
  '"$DEVFLOW_NOTES_RAW"',
  '"$DEVFLOW_NOTES"',
];

/** A flagged `rm` — `rm -f`, `rm -rf`, `rm --force`, in any spacing. */
const FLAGGED_RM = /\brm\s+-{1,2}[A-Za-z]/;

/**
 * The always-loaded agent's removal line, fail-loud.
 *
 * ONE line by construction: a removal split across lines is a removal whose order
 * relative to the gate cannot be read off the text, and the ordering is half the
 * control. Throwing rather than returning undefined keeps every claim below from
 * reporting "missing" about a line the search simply failed to locate.
 */
export function d11RemovalLine(agent: string): string {
  const line = unescapeMds(agent)
    .split('\n')
    .find(l => l.includes('trap ') && l.includes('rm -- '));
  if (line === undefined) {
    throw new Error(
      'the always-loaded D11 block states no removal for the staging files it creates. ' +
      '$DEVFLOW_BODY_RAW holds exactly the bytes the scrub exists to delete, so an abandoned ' +
      'one is a second sink with no gate over it (PF-066).',
    );
  }
  return line;
}

/** One property the removal owes, and the failure it prevents. */
interface RemovalClaim {
  readonly label: string;
  readonly holds: (line: string) => boolean;
  readonly why: string;
}

const REMOVAL_CLAIMS: readonly RemovalClaim[] = [
  {
    label: 'names every staging file',
    holds: line => D11_STAGING_FILES.every(f => line.includes(f)),
    why:
      'the RAW pair is the credential residue and the scrubbed pair is the litter; a removal ' +
      'that names three of the four leaves the fourth behind on every invocation of every op',
  },
  {
    label: 'is armed as a trap, on the abnormal exits too',
    holds: line => /\btrap\b/.test(line) && /\bEXIT\b/.test(line) && /\bINT\b/.test(line),
    why:
      'a removal written as the last statement of a chain runs only when the chain reaches it — ' +
      'so the `D11-FAIL` path, the path that matters most, is exactly the one that skips it',
  },
  {
    label: 'removes with a plain `rm`',
    holds: line => line.includes('rm -- ') && !FLAGGED_RM.test(line),
    why:
      'the flagged form is refused by the permission layer these recipes run under, and a ' +
      'cleanup that cannot run is not one (PF-066: a control written as shell must work as shell)',
  },
  {
    label: "captures the gate's status before removing and exits on it",
    holds: line => {
      const captured = line.indexOf('GATE=$?');
      const removed = line.indexOf('rm -- ');
      return captured !== -1 && removed !== -1 && captured < removed
        && line.lastIndexOf('exit "$GATE"') > removed;
    },
    why:
      'PF-066 defect (3): a removal placed after the gate overwrites `$?`, so the scrubber\'s ' +
      'refusal is reported as success — the same swallowing the `&&` discipline forbids, ' +
      'arriving by a different route',
  },
];

/** Named collector: properties the removal line does not have. */
export function collectMissingRemovalClaims(line: string): string[] {
  return REMOVAL_CLAIMS.filter(c => !c.holds(line)).map(c => `missing: ${c.label} — ${c.why}`);
}

/**
 * Named collector: lines anywhere in the sink class that remove a staging file
 * with a FLAGGED `rm`.
 *
 * Class-wide rather than owner-only, because this is the half a second author
 * gets wrong: the owner's line can be perfect while a provider reference spells
 * its own instantiation with `rm -f`, and `rm -f` is the spelling every shell
 * habit reaches for first.
 */
export function collectFlaggedRemovals(corpus: readonly CorpusEntry[]): string[] {
  const offenders: string[] = [];
  for (const entry of corpus) {
    for (const [i, line] of unescapeMds(entry.content).split('\n').entries()) {
      if (!FLAGGED_RM.test(line)) continue;
      if (!D11_STAGING_FILES.some(f => line.includes(f))) continue;
      offenders.push(`${entry.path}:${i + 1}: ${line.trim().slice(0, 100)}`);
    }
  }
  return offenders;
}

/**
 * The whole D11 sink class: the always-loaded agent, the generated references,
 * and the hand-authored references of the `devflow:git` skill.
 *
 * The third of those is where the concrete GitHub chains live, and it is not
 * under `dist/` — the skill installs it as authored — so a corpus built only from
 * the compiled tree would never read the file that holds the most shell.
 */
function d11SinkClass(): CorpusEntry[] {
  const corpus = gitAgentSinkCorpus();
  const handAuthored = path.join(skillsDir(), 'git', 'references');
  for (const file of walkFiles(handAuthored, f => f.endsWith('.md'), 1)) {
    corpus.push({ path: file, content: readFileSync(file, 'utf-8') });
  }
  return corpus;
}

describe('residue: the D11 staging files are removed, in a shape that runs (PF-066)', () => {
  it('the always-loaded block owns the removal, with every property that makes it work', () => {
    const line = d11RemovalLine(resolveAgentSource('git').content);
    const violations = collectMissingRemovalClaims(line);
    expect(
      violations,
      `the D11 removal is stated but incomplete:\n  ${violations.join('\n  ')}`,
    ).toEqual([]);
  });

  it('known-bad probe: each property, broken in turn, is reported by the same collector', () => {
    // Mechanic (b): every bad shape is built from the shipped line inside this
    // `it`, per PROPERTY — a claim whose predicate has drifted off the shipped
    // wording would otherwise sit here matching nothing while the arm above passes
    // on the other three (PF-018).
    const pristine = d11RemovalLine(resolveAgentSource('git').content);
    expect(
      collectMissingRemovalClaims(pristine),
      'the collector must be silent on the shipped line, or the probe below proves nothing',
    ).toEqual([]);

    const wounds: ReadonlyArray<{ label: string; line: string }> = [
      {
        label: 'names every staging file',
        line: pristine.replace(' "$DEVFLOW_NOTES_RAW"', ''),
      },
      {
        label: 'is armed as a trap, on the abnormal exits too',
        line: pristine.replace(/trap '/, '').replace(/' EXIT INT TERM/, ''),
      },
      {
        label: 'removes with a plain `rm`',
        line: pristine.replace('rm -- ', 'rm -f -- '),
      },
      {
        label: "captures the gate's status before removing and exits on it",
        line: pristine.replace('GATE=$?; rm -- ', 'rm -- ').replace('; exit "$GATE"', '; GATE=$?'),
      },
    ];
    for (const { label, line } of wounds) {
      expect(line, `the wound for "${label}" changed nothing — the probe is inert`)
        .not.toBe(pristine);
      expect(
        collectMissingRemovalClaims(line).map(v => v.split(' — ')[0]),
        `breaking "${label}" must be reported by the same collector`,
      ).toContain(`missing: ${label}`);
    }
    expect(REMOVAL_CLAIMS.length, 'the claim table is empty (PF-018)').toBeGreaterThanOrEqual(4);

    // …and the case the claims cannot express, because there is no line to test:
    // the ORIGINAL defect, an agent that creates the staging files and removes
    // none of them. The finder is what reports it, so the finder is driven too.
    expect(
      () => d11RemovalLine('## Comment-sink scrub (D11)\n`DEVFLOW_BODY_RAW="$(mktemp)"` per call.\n'),
      'an agent with no removal at all must be reported by the finder, not read as a pass',
    ).toThrow(/states no removal/);
  });

  it('no file in the sink class removes a staging file with a flagged `rm`', () => {
    const corpus = d11SinkClass();
    expect(
      corpus.length,
      'the sink class is empty — run `npm run build`; an absence arm over zero files reports ' +
      'success about nothing (PF-018)',
    ).toBeGreaterThan(0);
    expect(
      corpus.some(e => unescapeMds(e.content).includes('rm -- ')),
      'no file in the sink class removes a staging file at all, so the flagged-form arm below ' +
      'is an absence claim over ground that carries no removals',
    ).toBe(true);
    const offenders = collectFlaggedRemovals(corpus);
    expect(
      offenders,
      'a staging file is removed with a flagged `rm`. The permission layer these recipes run ' +
      `under refuses that form, so the cleanup silently never happens:\n  ${offenders.join('\n  ')}`,
    ).toEqual([]);
  });

  it('known-bad probe: the flagged-form collector fires, and spares the plain form', () => {
    for (const line of [
      'trap \'GATE=$?; rm -f "$DEVFLOW_BODY_RAW"; exit "$GATE"\' EXIT',
      'rm -rf "$DEVFLOW_NOTES_RAW"',
      'rm --force "$DEVFLOW_BODY"',
    ]) {
      expect(
        collectFlaggedRemovals([{ path: 'seed.md', content: line }]),
        `"${line}" must be caught`,
      ).toEqual([`seed.md:1: ${line}`]);
    }
    for (const line of [
      'rm -- "$DEVFLOW_BODY_RAW" "$DEVFLOW_BODY" 2>/dev/null',
      'rm -rf build/            # not a staging file',
    ]) {
      expect(
        collectFlaggedRemovals([{ path: 'seed.md', content: line }]),
        `"${line}" must not be reported`,
      ).toEqual([]);
    }
  });
});
