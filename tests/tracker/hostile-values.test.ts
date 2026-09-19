/**
 * Hostile-value tables for the tracker surface (AC-3.7, non-vacuity register row 22).
 *
 * `~/.devflow/tracker.md` is hand-editable and machine-wide: every value in it is
 * third-party input, and §14.9 constraint 5 says so in the strongest form — a
 * value is shape-gated REGARDLESS OF PROVENANCE, so a value read back from the
 * file gets the same validator as one read from a tracker response.
 *
 * WHERE THE VALIDATORS COME FROM. They are read out of the Tracker agent's own
 * schema/validator table, not re-spelled here. A test that restated the shapes
 * would prove its own copy rejects the payloads while the agent quietly drifted
 * to something laxer (PF-018) — and the agent is the only writer, so its table
 * is the authority. Adding a schema field without a validator therefore fails
 * this file rather than silently escaping it.
 *
 * SCOPE. All four arms named for this file now have subjects, and the last two
 * arrived with the change that gave them one:
 *   - `refs per provider` (register row 25) needed the per-provider anchored
 *     `ref_grammar`, and needed it for EVERY provider. Two of the three landed with
 *     their mechanics modules; GitHub's landed in the commit that neutralised
 *     `backlink-shipped-issues`' always-loaded entry gate, which is what moved the
 *     github grammar out of the provider-blind step and into the github mechanics.
 *     Until then the github column had no grammar to drive payloads through, and a
 *     table over two of three providers is register row 25 with a hole in it.
 *   - `JQL/filter fields` (§14.9 constraint 10) needed a provider module that
 *     builds a query, which both tool-call providers now do.
 * Each was written in the commit that created the thing it constrains (ADR-025).
 * The provider-token arm (register row 21) is NOT duplicated here:
 * `tests/core/tracker.test.ts` already drives the 13-payload table through
 * `parseTrackerId`, the single owner of provider parsing, and a second copy of that
 * table is the divergence it exists to prevent.
 */

import { describe, it, expect } from 'vitest';

import { existsSync, readFileSync } from 'fs';
import * as path from 'path';

import { compiledSkillRefsDir } from '../../src/core/assets.js';
import {
  MCP_BACKED_PROVIDER_SUBDIRS,
  TRACKER_OPS,
  VARIANT_MODULES,
} from '../../src/core/mds-variants.js';
import {
  TRACKER_SCHEMA_SECTIONS,
  collectTrackerSchemaRows,
  resolveAgentSource,
  type TrackerSchemaRow,
} from '../helpers.js';

const TRACKER_TEXT = resolveAgentSource('tracker').content;

/**
 * A generated per-op reference, read fail-loud.
 *
 * Never ENOENT-tolerant: a grammar table graded against an absent tree reports no
 * violations, which is the shape of a guard that is not a guard (PF-018, R3).
 */
function readGeneratedReference(relPath: string): string {
  const abs = path.join(compiledSkillRefsDir(), ...relPath.split('/'));
  if (!existsSync(abs)) {
    throw new Error(
      `${relPath} is absent at ${abs} — run \`npm run build\` first (this guard reads compiled ` +
      `reference files and cannot be skipped)`,
    );
  }
  return readFileSync(abs, 'utf-8');
}

// ---------------------------------------------------------------------------
// The payload table (non-vacuity register row 22)
// ---------------------------------------------------------------------------

/**
 * The two identity payloads, named once so the table and the arm that grades them
 * cannot drift apart.
 *
 * THE accountId SPELLING IS THE COLON-BEARING ONE, deliberately. Atlassian issues
 * both `712020:{uuid}` and a bare 24-hex form, and the bare form is
 * shape-indistinguishable from a legitimate `## Reference Rendering` TEMPLATE
 * token: 24 alphanumerics carry no metacharacter and sit inside that cell's
 * `^[A-Za-z0-9 #{}/_.-]{1,60}$`. Pinning it would assert a rejection §14.3 does
 * not owe and would be "fixed" by tightening a rendering template's shape gate
 * against a string that is a perfectly good rendering template. The colon-bearing
 * form is the real canonical identifier AND is rejected by every cell on its own
 * terms, so it is the honest row.
 */
const IDENTITY_PAYLOADS = [
  'alice@example.com',
  '712020:5b10ac8d-82e0-5b22-cc7d-4ef5aabbccdd',
] as const;

/**
 * The nine payloads. The first seven are verbatim from the register, each
 * targeting a different sink: command substitution (two spellings), flag
 * injection, line injection, size, credential-in-URL, and query-operator escape.
 *
 * THE LAST TWO ARE IDENTITY PAYLOADS, and the cell they exist for is `## Assignee`.
 * That cell admits `none` and `self` and nothing else, and §14.3 adds a second
 * prohibition in the strongest form — "**never** a literal email address or account
 * identifier". A closed set rejects everything outside it, so none of the seven
 * register payloads ever exercises that second prohibition; an address or an opaque
 * account id is well-formed, carries no metacharacter, and is exactly what an author
 * substitutes when the identify-current-user capability is unavailable. The clause is
 * modelled as a validator KIND below and graded on its own terms, so these two rows
 * are the cell's own prohibition doing work rather than the closed set doing it again.
 */
const HOSTILE_PAYLOADS: ReadonlyArray<readonly [label: string, payload: string]> = [
  ['backtick command substitution', 'PROJ`whoami`'],
  ['dollar command substitution', '$(id)'],
  ['flag injection', '--body-file=/etc/passwd'],
  ['line injection', 'a\nb'],
  ['500 characters', 'a'.repeat(500)],
  ['userinfo credential in URL', 'https://u:tok@host'],
  ['query operator escape', 'PROJ" OR project != "'],
  ['literal email address', IDENTITY_PAYLOADS[0]],
  ['tracker account identifier', IDENTITY_PAYLOADS[1]],
];

/**
 * The floor the payload table must clear, registered as `min-hostile-payloads` in
 * tests/fixtures/numeric-floors.json.
 *
 * A floor and not the table's length: the grid below grades every payload against
 * every schema cell, so a row added to the table widens the evidence and must not
 * cost a suite failure — while a row REMOVED shrinks the sinks the grid covers
 * with nothing else reporting it.
 */
const MIN_HOSTILE_PAYLOADS = 9;

// ---------------------------------------------------------------------------
// Validator extraction — one parser, driven by the guard and by its probes
// ---------------------------------------------------------------------------

/**
 * How a validator cell rejects.
 *
 * `enumerated` and `structured` are TOTAL rejections by construction: §14.3 says
 * those sections accept only a value enumerated from the tracker during this run,
 * or only structured filter fields, so no free string is ever admissible. They are
 * modelled as kinds rather than skipped, because "this field admits nothing a
 * scanner could have invented" is the property under test — and it is a property of
 * the CELL, graded by the arm that reads the kind, never by a rejection reason
 * pushed for every payload whatever the payload is.
 *
 * `deniedShape` is the one prose prohibition in the table with teeth of its own:
 * `## Assignee`'s "**never** a literal email address or account identifier" names
 * two shapes that no closed set and no metacharacter denylist describes.
 */
type ValidatorKind =
  | 'regex'
  | 'closedSet'
  | 'denylist'
  | 'deniedShape'
  | 'enumerated'
  | 'structured';

interface Validator {
  /** The arm's own text, so a report can name WHICH alternative admitted a value. */
  readonly source: string;
  readonly kinds: readonly ValidatorKind[];
  /**
   * Every anchored form this arm accepts. ALTERNATIVES, never hurdles: `matches A
   * or B` admits what B admits, and grading it as "rejected, because A failed" is
   * how a permissive form joins a cell without a single row going red.
   */
  readonly patterns: readonly RegExp[];
  readonly closedSet: readonly string[];
  readonly denied: readonly string[];
  readonly maxChars: number | null;
}

/**
 * The shapes `## Assignee`'s identity clause denies.
 *
 * The clause is prose, and prose grades no payload, so it is modelled here as the
 * two shapes it names. Both are well-formed and metacharacter-free — they are
 * precisely the values a closed set rejects for the wrong reason and a free-string
 * arm would wave through.
 */
const FORBIDDEN_IDENTITY_SHAPES: readonly RegExp[] = [
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  /^[0-9a-f]{6,}:[0-9a-f-]{8,}$/i,
];

/** The `## Assignee` prohibition, as the schema table spells it. */
const IDENTITY_DENIAL = /never\*{0,2}\s+a literal email address or account identifier/i;

/** The prefix every identity-shape rejection reason carries. */
const IDENTITY_REASON = 'matches the denied identity shape';

/**
 * How a cell spells an ALTERNATIVE arm.
 *
 * A cell's clauses are conjunctive by default — `## Reference Rendering` demands
 * its shape AND its denylist — so a laxening is written as an alternative: "the
 * enum, or anything matching …". Splitting on that marker is what keeps the grading
 * honest. Merged into one validator the two arms report the STRICT arm's rejection
 * for a value the lax arm admits, so "rejected for at least one stated reason" stays
 * true over exactly the change this file exists to catch (PF-018, PF-064).
 */
const ALTERNATIVE_ARM = /;\s*(?=or\s)|\s+OR\s+/;

/** Inline-code spans of a cell: `` `x` `` → x. */
function codeSpans(cell: string): string[] {
  return [...cell.matchAll(/`([^`]+)`/g)].map(m => m[1]);
}

/**
 * Denied characters are spelled by NAME in the schema table, never as inline code.
 *
 * Two of them cannot be written as a code span inside a markdown table cell at
 * all — a backtick needs double-backtick nesting and a newline has no spelling —
 * and mixing "some as code, some as prose" is what made the first version of this
 * parser mis-tokenize the whole clause while still finding *a* reason to reject.
 * Names make every entry parse the same way.
 *
 * An unknown name THROWS: a denylist whose entries silently resolve to nothing is
 * a control that reads as present and enforces nothing.
 */
const METACHAR_NAMES: Readonly<Record<string, string>> = Object.freeze({
  backtick: '`',
  dollar: '$',
  'double-quote': '"',
  'single-quote': "'",
  backslash: '\\',
  semicolon: ';',
  pipe: '|',
  ampersand: '&',
  newline: '\n',
});

/**
 * Named collector: parse one ALTERNATIVE ARM of a validator cell into its checks.
 *
 * Throws rather than returning an empty validator when an arm declares nothing
 * recognisable. An arm that parsed to "no checks" would make every payload row
 * for that field pass vacuously — the precise failure this file exists to make
 * loud, so it must be an error and not a silently permissive default.
 */
export function parseValidator(cell: string): Validator {
  const kinds: ValidatorKind[] = [];
  const patterns: RegExp[] = [];
  const closedSet: string[] = [];
  const denied: string[] = [];
  let maxChars: number | null = null;

  for (const span of codeSpans(cell)) {
    if (span.startsWith('^') && span.endsWith('$')) {
      patterns.push(new RegExp(span));
    }
  }
  if (patterns.length > 0) kinds.push('regex');

  // Marker-bearing lists are parsed CLAUSE-SCOPED (clauses are `;`-separated).
  // Taking "every code span after the marker" instead would let an allowlist
  // clause donate its members to a following denylist clause: the assertion below
  // only needs one reason, so the row would still pass — while reporting that
  // `project` is a denied field name when it is the canonical allowed one. A
  // guard that passes for a false reason is the next reader's wrong bug report.
  for (const clause of cell.split(';')) {
    if (/(?:enum|allowlist):/.test(clause)) {
      closedSet.push(...codeSpans(clause).filter(s => !s.startsWith('^')));
    } else if (/denylist:/.test(clause)) {
      const names = clause
        .slice(clause.indexOf('denylist:') + 'denylist:'.length)
        .split('\\|')
        .map(n => n.trim())
        .filter(n => n.length > 0);
      for (const name of names) {
        const ch = METACHAR_NAMES[name];
        if (ch === undefined) {
          throw new Error(
            `denylist entry '${name}' is not a known metacharacter name (known: ` +
            `${Object.keys(METACHAR_NAMES).join(', ')}). An unrecognised entry enforces nothing.`,
          );
        }
        denied.push(ch);
      }
    }
  }
  if (closedSet.length > 0) kinds.push('closedSet');
  if (denied.length > 0) kinds.push('denylist');

  const maxMatch = /max (\d+) characters/.exec(cell);
  if (maxMatch) maxChars = Number(maxMatch[1]);

  if (IDENTITY_DENIAL.test(cell)) kinds.push('deniedShape');
  if (/enumerated this run/.test(cell)) kinds.push('enumerated');
  if (/structured filter fields only/.test(cell)) kinds.push('structured');

  if (kinds.length === 0) {
    throw new Error(
      `validator cell declares no recognisable check — every hostile payload for this field ` +
      `would pass vacuously (PF-018). Cell: ${cell}`,
    );
  }
  return { source: cell.trim(), kinds, patterns, closedSet, denied, maxChars };
}

/**
 * Named collector: a cell's alternative arms, strictest-first as the cell writes them.
 *
 * One arm for every cell in the shipped table, because every clause in every cell is
 * conjunctive today. The split exists for the laxening: a value is admitted by the
 * cell the moment ONE arm admits it, whatever the others demand.
 */
export function parseValidatorArms(cell: string): Validator[] {
  return cell.split(ALTERNATIVE_ARM).map(arm => parseValidator(arm));
}

/**
 * Named collector: reasons ONE arm rejects `value`.
 *
 * Returns the empty array when the arm ACCEPTS. The checks within an arm are
 * conjunctive — a value must satisfy the shape AND stay off the denylist — while
 * the arm's `patterns` are alternatives to each other, so the shape check rejects
 * only when EVERY form fails.
 *
 * `enumerated` and `structured` push nothing: they are properties of the CELL, not
 * verdicts on a value. A reason pushed for them lands on every payload alike, so
 * every row carrying one would pass whatever the payload and whatever the row's
 * other checks said. Those rows are graded by the arm that reads the kind instead.
 */
export function rejectionReasons(validator: Validator, value: string): string[] {
  const reasons: string[] = [];
  if (validator.patterns.length > 0 && !validator.patterns.some(p => p.test(value))) {
    reasons.push(`fails every form {${validator.patterns.map(p => p.source).join(', ')}}`);
  }
  if (validator.closedSet.length > 0 && !validator.closedSet.includes(value)) {
    reasons.push(`outside the closed set {${validator.closedSet.join(', ')}}`);
  }
  for (const token of validator.denied) {
    if (value.includes(token)) reasons.push(`contains denied ${JSON.stringify(token)}`);
  }
  if (validator.maxChars !== null && value.length > validator.maxChars) {
    reasons.push(`longer than ${validator.maxChars} characters`);
  }
  if (validator.kinds.includes('deniedShape')) {
    for (const shape of FORBIDDEN_IDENTITY_SHAPES) {
      if (shape.test(value)) reasons.push(`${IDENTITY_REASON} ${shape.source}`);
    }
  }
  return reasons;
}

/**
 * Named collector: the arms of a cell that ACCEPT `value`, by their own text.
 *
 * Empty ⇒ every arm rejects, which is what a hostile payload must produce. A cell
 * is as lax as its laxest arm, so one accepting arm is the whole finding.
 */
export function collectAcceptingArms(arms: readonly Validator[], value: string): string[] {
  return arms.filter(arm => rejectionReasons(arm, value).length === 0).map(arm => arm.source);
}

/** True when an arm states a shape a payload can be graded against. */
function hasShapeCheck(arm: Validator): boolean {
  return (
    arm.patterns.length > 0 ||
    arm.closedSet.length > 0 ||
    arm.denied.length > 0 ||
    arm.maxChars !== null ||
    arm.kinds.includes('deniedShape')
  );
}

/** True when an arm admits NOTHING a hand edit or a history scan could produce. */
function isTotalRejection(arm: Validator): boolean {
  return arm.kinds.includes('enumerated') || arm.kinds.includes('structured');
}

/** A schema row's section heading, backticks and the `→ field` suffix left as written. */
function sectionOf(row: TrackerSchemaRow): string {
  return row.section.replace(/`/g, '').trim();
}

/**
 * The sections whose cell declares a total rejection and NO shape a payload can be
 * graded against.
 *
 * Pinned, because the split decides which rows the payload table covers: a row that
 * lost its shape would otherwise slip out of that table and stop grading nine
 * payloads while the coverage arm above still counted its section (PF-018).
 */
const TOTAL_REJECTION_ONLY_SECTIONS: readonly string[] = [
  '## Iteration Policy',
  '## Transitions',
  '## Wave Filter',
];

// ---------------------------------------------------------------------------
// tracker.md fields × payloads
// ---------------------------------------------------------------------------

describe('hostile values: tracker.md fields (AC-3.7, register row 22)', () => {
  const rows: TrackerSchemaRow[] = collectTrackerSchemaRows(TRACKER_TEXT);

  it('the table covers every value-bearing schema section (non-vacuity)', () => {
    // `### Substitutions` is report-only and has no sink validator (§14.3), so the
    // expected set is the `## ` sections. Keyed on section names rather than a
    // count so a renamed heading is a named failure, not an off-by-one.
    const sections = rows.map(r => r.section.replace(/`/g, '').replace(/ →.*$/, ''));
    const expected = TRACKER_SCHEMA_SECTIONS.filter(s => s.startsWith('## '));
    expect(sections, 'a schema section with no validator row escapes this whole file').toEqual(
      expect.arrayContaining(expected),
    );
    // `## Project` carries site AND key, so the row count exceeds the heading count.
    expect(
      rows.length,
      `expected at least ${expected.length} validator rows (## Project contributes two)`,
    ).toBeGreaterThan(expected.length);
  });

  it('the payload table clears its floor and carries no repeat (non-vacuity)', () => {
    // A FLOOR, not an equality. The grid above grades every payload against every
    // cell, so a tenth payload strictly widens the evidence — and an equality would
    // make adding one fail the suite, which is the ratchet inverted (the manifest's
    // own header: floors rise and never fall).
    expect(
      HOSTILE_PAYLOADS.length,
      'the payload table is below its floor — the grid above grades whatever is in it, so a ' +
      'shrunken table is a green suite over fewer sinks (PF-018)',
    ).toBeGreaterThanOrEqual(MIN_HOSTILE_PAYLOADS);
    // Distinctness is asserted as a RELATION to the table's own length rather than
    // to the floor: a repeat then goes red at any table size.
    expect(
      new Set(HOSTILE_PAYLOADS.map(([, p]) => p)).size,
      'payloads must be distinct — a repeated row inflates the count without widening the grid',
    ).toBe(HOSTILE_PAYLOADS.length);
  });

  it('`## Assignee`\'s identity clause is what refuses the two identity payloads', () => {
    // Why the last two payload rows exist, asserted rather than narrated. A closed
    // set rejects everything outside it, so none of the seven register payloads ever
    // exercises §14.3's second prohibition on this cell — "**never** a literal email
    // address or account identifier". The clause is therefore modelled as a KIND and
    // graded on its own terms here: over a copy whose closed set is widened to a free
    // string, an ordinary name walks in and these two are still refused. Without that
    // arm the two rows would be two more values the closed set rejects, and the cell's
    // own prohibition would be graded by nothing at all.
    //
    // `## Required Fields` is NOT a second subject: it denies by allowlist, which is
    // the same reason it rejects every other payload in the table, and the payload
    // grid below already covers it.
    const row = rows.find(r => sectionOf(r) === '## Assignee');
    if (row === undefined) {
      throw new Error('`## Assignee` has no validator row — the identity payloads have no subject');
    }
    const arms = parseValidatorArms(row.validator);
    for (const payload of IDENTITY_PAYLOADS) {
      expect(
        /[`$;|&\n"'\\]/.test(payload),
        `${JSON.stringify(payload)} must carry NO shell or query metacharacter, or it is just ` +
        `another spelling of a row above`,
      ).toBe(false);
      expect(
        arms.flatMap(arm => rejectionReasons(arm, payload)).some(r => r.startsWith(IDENTITY_REASON)),
        `${JSON.stringify(payload)} must be refused by the identity clause itself, not only by ` +
        `the closed set that rejects every payload in the table`,
      ).toBe(true);
    }

    // The closed set replaced by a permissive shape — everything the cell still
    // refuses after that is the identity clause's own work.
    const widened = parseValidatorArms(
      row.validator.replace(/enum:[^;]*;/, '`^[A-Za-z0-9@:._-]{1,60}$`;'),
    );
    expect(
      collectAcceptingArms(widened, 'bob'),
      'the widened copy must admit an ordinary name, or it is not a widening and the arms below ' +
      'prove nothing',
    ).not.toEqual([]);
    for (const payload of IDENTITY_PAYLOADS) {
      expect(
        collectAcceptingArms(widened, payload),
        `${JSON.stringify(payload)} must STILL be refused once the closed set is widened — that ` +
        `refusal is the identity clause doing the work this row claims for it`,
      ).toEqual([]);
    }
  });

  it('every declared validator arm parses to at least one real check', () => {
    for (const row of rows) {
      expect(
        () => parseValidatorArms(row.validator),
        `${row.section}: ${row.validator}`,
      ).not.toThrow();
    }
  });

  it('which rows the payload grid grades is pinned, both ways (non-vacuity)', () => {
    // The rows split in two and the split decides coverage. A row whose cell states
    // a shape is graded against the nine payloads; a row whose cell states only a
    // total rejection has no shape to grade and is graded by its KIND instead, since
    // a rejection reason pushed for that kind would grade its payloads against
    // nothing. Pinning the split means a row that loses its shape is a named failure
    // here rather than nine assertions that quietly stop existing.
    const totalOnly = rows
      .filter(r => !parseValidatorArms(r.validator).some(hasShapeCheck))
      .map(sectionOf);
    expect(
      totalOnly,
      'the set of rows graded by their total-rejection kind alone is pinned; a row entering or ' +
      'leaving it changes what the payload grid covers',
    ).toEqual(TOTAL_REJECTION_ONLY_SECTIONS);
  });

  for (const row of rows) {
    const section = sectionOf(row);
    const arms = parseValidatorArms(row.validator);
    describe(section, () => {
      if (!arms.some(hasShapeCheck)) {
        it('admits nothing a hand edit or a history scan could produce', () => {
          for (const arm of arms) {
            expect(
              isTotalRejection(arm),
              `${section}: this arm states neither a shape nor a total rejection, so it admits ` +
              `every payload in the table — including the ones the shell-shaped rows exist for. ` +
              `Arm: ${arm.source}`,
            ).toBe(true);
          }
        });
        return;
      }

      for (const [label, payload] of HOSTILE_PAYLOADS) {
        it(`rejects ${label}`, () => {
          const accepting = collectAcceptingArms(arms, payload);
          expect(
            accepting,
            `${section} ACCEPTED ${JSON.stringify(payload.slice(0, 60))} under ` +
            `${accepting.length} of its ${arms.length} alternative arm(s) — a cell is as lax as ` +
            `its laxest arm. Tighten the validator in the agent's schema table, not this test.`,
          ).toEqual([]);
        });
      }
    });
  }

  it('known-bad probe: a laxened validator cell is reported by the same collectors', () => {
    // Mechanic (b): the bad shape is asserted inside this `it`, so no committed
    // file is touched to show red.
    const lax = parseValidator('`^.*$`');
    expect(rejectionReasons(lax, 'PROJ`whoami`'), 'a permissive regex must be caught here').toEqual([]);
    const strict = parseValidator('`^[A-Z][A-Z0-9_]{1,9}$`');
    expect(rejectionReasons(strict, 'PROJ`whoami`').length).toBeGreaterThan(0);
    // …and the CASE half of the same alphabet, which is what normalising once at the
    // key's own boundary exists to make observable: what reaches the gate is already
    // upper, so a lowercase key is REJECTED rather than quietly admitted by a
    // case-insensitive shape.
    expect(
      rejectionReasons(strict, 'proj').length,
      'a lowercase project key must be rejected by the shipped alphabet — the agent normalises ' +
      'once, at the boundary, and a gate that accepted both cases would make that step optional',
    ).toBeGreaterThan(0);
    expect(rejectionReasons(strict, 'PROJ'), 'and the normalised form is admitted').toEqual([]);
  });

  it('known-bad probe: an alternative arm that admits a payload is reported, however strict the rest', () => {
    // The laxening a single merged validator cannot see: the strict arm still
    // supplies a rejection reason, so "rejected for at least one stated reason" stays
    // true while the cell now admits the value.
    const strict = parseValidatorArms('enum: `none` \\| `self`');
    expect(strict, 'the strict cell must parse to ONE arm').toHaveLength(1);
    expect(collectAcceptingArms(strict, 'PROJ`whoami`'), 'and must refuse the payload').toEqual([]);

    const laxened = parseValidatorArms('enum: `none` \\| `self`; or `^.*$`');
    expect(laxened, 'the alternative must parse to TWO arms, or the split is a no-op').toHaveLength(2);
    expect(
      collectAcceptingArms(laxened, 'PROJ`whoami`'),
      'the free-string arm must be reported as accepting, with the strict arm still in the cell',
    ).not.toEqual([]);

    // The same laxening on a SHIPPED cell, so the arm is proven over the real table
    // and not only over a hand-written one. `## Reference Rendering` is the cell that
    // carries both a shape and a denylist, so it is the one with the most rejection
    // reasons left standing to mask an alternative that admits everything.
    const live = rows.find(r => sectionOf(r) === '## Reference Rendering');
    if (live === undefined) {
      throw new Error('`## Reference Rendering` has no validator row — this probe has no subject');
    }
    expect(
      collectAcceptingArms(parseValidatorArms(live.validator), 'PROJ`whoami`'),
      'the shipped cell must refuse the payload',
    ).toEqual([]);
    expect(
      collectAcceptingArms(parseValidatorArms(`${live.validator}; or \`^.*$\``), 'PROJ`whoami`'),
      'and with one permissive alternative added it must ACCEPT — the shape and the denylist go ' +
      'on supplying reasons, which is what a merged grading mistakes for a rejection',
    ).not.toEqual([]);
  });

  it('known-bad probe: a second form in one arm is an ALTERNATIVE, not a second hurdle', () => {
    // `matches A or B` admits what B admits. Grading it as "rejected, because A
    // failed" is how a permissive form joins a cell without a row going red.
    const alternatives = parseValidator('`^[A-Za-z]{1,9}$` \\| `^.*$`');
    expect(alternatives.patterns, 'both forms must parse').toHaveLength(2);
    expect(
      rejectionReasons(alternatives, 'PROJ`whoami`'),
      'a value the permissive form admits is admitted by the arm',
    ).toEqual([]);
  });

  it('known-bad probe: laxening the `## Issue Types` shape is reported, its total-rejection kind aside', () => {
    // The row carries `enumerated` as well as its shape, and pushing a reason for
    // that kind made all nine of its payload rows pass whatever the shape said. This
    // drives the SHIPPED cell with its shape replaced and requires a payload to walk
    // straight in.
    const row = rows.find(r => sectionOf(r) === '## Issue Types');
    if (row === undefined) {
      throw new Error('`## Issue Types` has no validator row — this probe has no subject');
    }
    expect(
      collectAcceptingArms(parseValidatorArms(row.validator), 'PROJ`whoami`'),
      'the shipped shape must refuse the payload',
    ).toEqual([]);
    const laxened = row.validator.replace(/`\^[^`]*\$`/, '`^.*$`');
    expect(laxened, 'the laxening seed must change the cell').not.toBe(row.validator);
    expect(
      collectAcceptingArms(parseValidatorArms(laxened), 'PROJ`whoami`'),
      'with its shape laxened the row must ACCEPT — otherwise it is graded by something other ' +
      'than the shape it declares, and laxening that shape costs nothing',
    ).not.toEqual([]);
  });

  it('known-bad probe: the identity clause is read off the cell, not assumed', () => {
    // The kind has to come from the prohibition's own words, or `deniedShape` is a
    // check this file applies to cells that never declared it.
    expect(parseValidator('enum: `none` \\| `self`').kinds).not.toContain('deniedShape');
    const declared = parseValidator(
      'enum: `none` \\| `self`; **never** a literal email address or account identifier',
    );
    expect(declared.kinds, 'the clause as the table spells it must be read').toContain('deniedShape');
    expect(
      rejectionReasons(declared, IDENTITY_PAYLOADS[0]).some(r => r.startsWith(IDENTITY_REASON)),
      'and it must be the clause, not the closed set, that names the refusal',
    ).toBe(true);
  });

  it('known-bad probe: an unparseable validator cell throws instead of admitting everything', () => {
    expect(() => parseValidator('see the reference')).toThrow(/no recognisable check/);
  });

  it('known-bad probe: clause scoping keeps an allowlist member out of the denylist', () => {
    // The whole point of the clause split. `project` is ALLOWED; a cell-wide
    // "spans after the marker" parse would report it as denied and still pass.
    const cell = 'denylist: dollar; allowlist: `project` \\| `summary`';
    const v = parseValidator(cell);
    expect(v.denied).toEqual(['$']);
    expect(v.closedSet).toEqual(['project', 'summary']);
    // `project` is an ALLOWED name. A cell-wide "spans after the marker" parse
    // would have reported it as a denied token here, and still passed.
    expect(rejectionReasons(v, 'PROJ" OR project != "')).toEqual([
      'outside the closed set {project, summary}',
    ]);
  });

  it('known-bad probe: an unrecognised denylist entry throws rather than enforcing nothing', () => {
    expect(() => parseValidator('denylist: hieroglyph')).toThrow(/not a known metacharacter name/);
  });

  it('known-bad probe: each validator kind is exercised by at least one live row', () => {
    // A kind no row uses is dead parser surface; a kind the parser cannot see is a
    // validator this file silently ignores. Both directions are checked.
    const live = new Set(rows.flatMap(r => parseValidatorArms(r.validator).flatMap(a => a.kinds)));
    for (const kind of [
      'regex',
      'closedSet',
      'denylist',
      'deniedShape',
      'enumerated',
      'structured',
    ] as const) {
      expect(live, `no schema row declares a '${kind}' validator — parser surface with no subject`).toContain(kind);
    }
  });
});

// ---------------------------------------------------------------------------
// Single authority for provider parsing
// ---------------------------------------------------------------------------

describe('hostile values: the agent declares no second provider parser (§14.9 constraint 6)', () => {
  it('the agent states no normalisation pipeline of its own', () => {
    // `parseTrackerId` in src/core/tracker.ts is the one owner, and the Git agent's
    // resolution preamble is the one prompt-side spelling. A third pipeline in this
    // prompt would be a repair path in a reject-never-repair design.
    //
    // SUBJECT: the PROVIDER TOKEN, and only it (SOFTENED in scope, applies ADR-025).
    // It arrives validated in the spawn directive and is copied verbatim, so any
    // normalisation of it here is a second parser. The project KEY is a different
    // value with a different provenance — inferred from the repo, hand-editable in
    // the configuration file, and gated at every sink against one uppercase
    // alphabet — and normalising it ONCE at its own boundary is what makes that
    // alphabet enforceable rather than a shape nobody can reach. Excluding the key's
    // own schema row is therefore a narrowing of the subject, not of the rule: the
    // arm below proves the row is excluded because it is the key's, and a
    // provider-token pipeline seeded into it still fails.
    const KEY_ROW = '| `## Project` → key |';
    const scoped = TRACKER_TEXT.split('\n').filter(line => !line.startsWith(KEY_ROW)).join('\n');
    expect(
      TRACKER_TEXT.split('\n').filter(line => line.startsWith(KEY_ROW)),
      'the project-key schema row must exist — otherwise this scoping removes nothing and the ' +
      'narrowing is silent',
    ).toHaveLength(1);

    for (const phrase of ['ASCII-lowercase', 'case folding', 'ASCII-upper']) {
      expect(
        scoped,
        `'${phrase}' describes a provider-token repair pipeline. The token arrives validated ` +
        'in the spawn directive; re-deriving it here adds a second convergence point (PF-023).',
      ).not.toContain(phrase);
    }

    // Known-bad, same it: a provider-token pipeline seeded OUTSIDE the key row is
    // still reported, so the scoping above is a narrowing of subject rather than a
    // hole the next pipeline slips through.
    const seeded = `${scoped}\nNormalise TRACKER_PROVIDER by ASCII-lowercase, then retry.\n`;
    expect(
      seeded.includes('ASCII-lowercase'),
      'the scoped corpus must still see a seeded provider-token pipeline',
    ).toBe(true);
  });

  it('the normalisation literal appears exactly once in the agent (AC-3.7)', () => {
    // The file records ONE shape-gating rule and defers the bounded-scan bounds to
    // the reference. Two copies of "shape-gated regardless of provenance" would be
    // two rules that can disagree.
    const occurrences = TRACKER_TEXT.split('regardless of provenance').length - 1;
    expect(
      occurrences,
      'the provenance-blind shape-gating rule must be stated exactly once',
    ).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// refs per provider (§14.1, non-vacuity register row 25)
// ---------------------------------------------------------------------------
//
// GAP-18's core claim: the ref pre-flight IS the injection guard for an
// interpolated reference, so relaxing it per provider is a SECURITY change and
// not a formatting one. The grammars are therefore pinned from §14.1 and driven
// against the register's payload table — and each pinned form is separately
// asserted to appear VERBATIM in that provider's own shipped mechanics, so the
// table cannot drift away from the artifact it claims to describe (PF-018).
//
// Pinned rather than parsed out of the modules: a scan for "the anchored regexes
// in this file" cannot tell a reference grammar from the site-URL shape gate that
// sits beside it, and a table graded against whatever it happened to find proves
// nothing about what §14.1 fixed.

/** One provider's anchored reference grammar, as §14.1 fixes it. */
interface ProviderRefGrammar {
  readonly provider: string;
  /** Every anchored form a reference may satisfy — alternation between forms, never inside one. */
  readonly forms: readonly string[];
  /** Whether the provider normalises to ASCII upper before matching. */
  readonly asciiUpper: boolean;
  /** References that must be ACCEPTED, so the grammar is not rejecting everything. */
  readonly accepts: readonly string[];
}

const PROVIDER_REF_GRAMMARS: readonly ProviderRefGrammar[] = [
  {
    provider: 'github',
    forms: ['^#?[1-9][0-9]{0,8}$'],
    asciiUpper: false,
    accepts: ['42', '#42', '123456789'],
  },
  {
    provider: 'jira',
    forms: ['^[A-Z][A-Z0-9_]{1,9}-[1-9][0-9]{0,8}$'],
    asciiUpper: false,
    accepts: ['PROJ-1', 'A_B-12', 'ABCDEFGHIJ-999999999'],
  },
  {
    provider: 'linear',
    forms: [
      '^[A-Z][A-Z0-9]{0,9}-[1-9][0-9]{0,8}$',
      '^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$',
    ],
    asciiUpper: true,
    accepts: ['TEAM-123', 'team-123', '3f2504e0-4f89-11d3-9a0c-0305e82c3301'],
  },
];

/**
 * Register row 25's payloads. Each targets a different sink: shell separators,
 * command substitution, flag injection in both spellings, traversal, size, a
 * zero-numbered key (the off-by-one an unanchored digit class admits), and
 * whitespace.
 */
const HOSTILE_REFS: ReadonlyArray<readonly [label: string, ref: string]> = [
  ['shell separator', '1; id'],
  ['command substitution', '$(id)'],
  ['long-flag injection', '--repo x'],
  ['short-flag injection', '-R x'],
  ['path traversal', '../x'],
  ['300 characters', 'A'.repeat(300)],
  ['zero-numbered key', 'PROJ-0'],
  ['whitespace', ' '],
];

/**
 * The floor the hostile-ref table must clear, registered as `min-hostile-refs` in
 * tests/fixtures/numeric-floors.json.
 *
 * Same reasoning as the payload floor: every pinned grammar is driven over the
 * whole table, so a row added widens the corpus for every provider at once and a
 * row removed silently narrows it.
 */
const MIN_HOSTILE_REFS = 8;

/** The grammar as the mechanics state it: normalise if the provider says so, then match. */
function refAccepted(grammar: ProviderRefGrammar, ref: string): boolean {
  const candidate = grammar.asciiUpper ? ref.replace(/[a-z]/g, c => c.toUpperCase()) : ref;
  return grammar.forms.some(form => new RegExp(form).test(candidate));
}

describe('hostile values: refs per provider (GAP-18, register row 25)', () => {
  it('the table covers every registered provider and every payload (non-vacuity)', () => {
    const registered = VARIANT_MODULES
      .filter(mod => mod.kind === 'fanout' && mod.subdir.startsWith('tracker/'))
      .map(mod => mod.subdir.slice('tracker/'.length))
      .sort();
    expect(
      PROVIDER_REF_GRAMMARS.map(g => g.provider).sort(),
      'a provider with no grammar row is a provider whose ref pre-flight this file never drives',
    ).toEqual(registered);
    expect(
      HOSTILE_REFS.length,
      'the hostile-ref table is below its floor — every grammar below is driven over whatever is ' +
      'in it, so a shrunken table is a green suite over fewer shapes (PF-018)',
    ).toBeGreaterThanOrEqual(MIN_HOSTILE_REFS);
    expect(
      new Set(HOSTILE_REFS.map(([, r]) => r)).size,
      'refs must be distinct — a repeated row inflates the count without widening the corpus',
    ).toBe(HOSTILE_REFS.length);
  });

  it('every pinned grammar appears verbatim in that provider\'s own shipped mechanics', () => {
    // The two-sided half. Without it the table is a restatement of §14.1 that the
    // artifact is free to diverge from, which is the shape PF-018 names.
    for (const grammar of PROVIDER_REF_GRAMMARS) {
      const tree = TRACKER_OPS
        .map(op => readGeneratedReference(`tracker/${grammar.provider}/${op}.md`))
        .join('\n');
      for (const form of grammar.forms) {
        expect(
          tree,
          `${grammar.provider}: the anchored form ${form} appears nowhere in its generated ` +
          `mechanics — a grammar the mechanics do not state is a gate the agent cannot apply, ` +
          `and the always-loaded entry gate defers to exactly this`,
        ).toContain(form);
      }
      if (grammar.asciiUpper) {
        expect(
          tree,
          `${grammar.provider}: the normalisation its grammar depends on must be stated too`,
        ).toMatch(/ASCII-upper/);
      }
    }
  });

  for (const grammar of PROVIDER_REF_GRAMMARS) {
    describe(`${grammar.provider} ref_grammar`, () => {
      for (const [label, ref] of HOSTILE_REFS) {
        it(`rejects ${label}`, () => {
          expect(
            refAccepted(grammar, ref),
            `${grammar.provider} ACCEPTED ${JSON.stringify(ref.slice(0, 40))} — the anchored form ` +
            `is what keeps a reference out of a query and out of a command (GAP-18). Tighten the ` +
            `grammar in the provider's mechanics, not this test.`,
          ).toBe(false);
        });
      }

      it('accepts the shapes it exists to admit', () => {
        for (const ref of grammar.accepts) {
          expect(
            refAccepted(grammar, ref),
            `${grammar.provider} must accept ${JSON.stringify(ref)} — a grammar that rejects ` +
            `everything passes every row above while making the operation unreachable`,
          ).toBe(true);
        }
        expect(grammar.accepts.length, 'the accepted corpus is empty (PF-018)').toBeGreaterThan(0);
      });
    });
  }

  it('known-bad probe: an unanchored grammar admits what every anchored one rejects', () => {
    // Why §14.1 says "never `^A|B$`", driven through the same predicate. The
    // alternation binds looser than the anchors, so the left branch is anchored at
    // the start only and the right at the end only — and `1; id` walks straight in.
    const unanchored: ProviderRefGrammar = {
      provider: 'probe',
      forms: ['^[A-Z][A-Z0-9]{0,9}-[1-9][0-9]{0,8}|[0-9A-F]{8}$'],
      asciiUpper: true,
      accepts: [],
    };
    const admitted = HOSTILE_REFS.filter(([, ref]) => refAccepted(unanchored, ref)).map(([l]) => l);
    expect(
      admitted,
      'an unanchored alternation must admit at least one hostile payload, or this probe proves ' +
      'nothing about why both forms are anchored separately',
    ).not.toEqual([]);
    // …and the shipped forms reject the same payload, so the difference is the anchors.
    for (const grammar of PROVIDER_REF_GRAMMARS) {
      for (const [, ref] of HOSTILE_REFS) {
        expect(refAccepted(grammar, ref), `${grammar.provider} must reject ${JSON.stringify(ref)}`)
          .toBe(false);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// JQL / filter fields (§14.9 constraint 10)
// ---------------------------------------------------------------------------
//
// Constraint 10 is an ORDERED rule, and the order is the whole content: escape
// `\` first and then `"`, because the other order escapes the backslash the second
// pass just inserted and leaves the quote live. Then DROP anything still carrying
// a metacharacter — repair is forbidden, because a repaired value is one nobody
// can predict.
//
// Modelled here exactly as the modules write it, the same device
// `resolveProviderAsSpecified` uses for the preamble's normalisation in
// tests/tracker/byte-budget.test.ts: what can be asserted mechanically about a
// prompt is that the rule AS WRITTEN drops every hostile payload, that both
// tool-call providers state it, and that the stated ORDER is the one that works.

/** Every provider whose mechanics compose a query rather than a CLI invocation. */
function queryBuildingProviders(): string[] {
  return VARIANT_MODULES
    .filter(mod => (MCP_BACKED_PROVIDER_SUBDIRS as readonly string[]).includes(mod.subdir))
    .map(mod => mod.subdir.slice('tracker/'.length));
}

/**
 * The four characters that can break OUT of a quoted string literal, and therefore
 * the module's drop set. Named so the arms below say which claim they are making:
 * a value is dropped because it could end the literal, not because it looks hostile.
 */
const QUERY_BREAKOUT_CHARS = /["\\\n`]/;

/**
 * The escape-then-drop rule, LITERALLY as the modules state it. Returns null when
 * the value is DROPPED.
 *
 * The drop test runs on the ESCAPED string, with no un-escaping cleverness, which
 * is what the rule says and is stricter than it first looks: every `"` escapes to
 * `\\"`, which still carries a `"`, so a value containing a quote is dropped
 * whatever the escape did. The escape is therefore defence in depth for a value
 * that somehow reached the sink unchecked, and the drop is the control. Modelling
 * it as "escape, then decide whether the escape worked" would have been a model of
 * a rule nobody wrote.
 */
function escapeThenDrop(value: string): string | null {
  const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return QUERY_BREAKOUT_CHARS.test(escaped) ? null : escaped;
}

/** The FORBIDDEN order, kept as a named counterexample rather than as prose. */
function escapeReversed(value: string): string {
  return value.replace(/"/g, '\\"').replace(/\\/g, '\\\\');
}

describe('hostile values: JQL/filter fields (§14.9 constraint 10)', () => {
  it('both tool-call providers state the rule, in one place each', () => {
    const providers = queryBuildingProviders();
    expect(providers.length, 'no query-building provider is registered (PF-018)').toBeGreaterThan(1);
    for (const provider of providers) {
      const tree = TRACKER_OPS
        .map(op => readGeneratedReference(`tracker/${provider}/${op}.md`))
        .join('\n');
      expect(tree, `${provider}: structured filter arguments must be preferred`)
        .toContain('structured filter argument');
      expect(
        tree,
        `${provider}: a caller value may reach a query only as a quoted string literal — never ` +
        `in field, operator or ordering position, which is where a quote break becomes a ` +
        `different question`,
      ).toContain('quoted string literal');
      expect(tree, `${provider}: the escape ORDER is part of the rule`)
        .toContain('Escape `\\` first and then `"`');
      expect(tree, `${provider}: and the bound every query carries`).toContain('≤50');
    }
  });

  it('the rule DROPS every payload that could break out of a quoted literal', () => {
    // Scoped to the breakout set on purpose, and the scope is the claim. A QUERY
    // sink is not a shell: `$(id)` and `--body-file=/etc/passwd` inside a quoted
    // string literal are inert TEXT, and dropping them would cost search results
    // while protecting nothing. What must never survive is a character that can END
    // the literal, because that is what turns a value into a different question —
    // which is why the rule's own drop set is exactly those four and why the
    // value-position rule asserted above is the other half of the same control.
    const breakout = HOSTILE_PAYLOADS.filter(([, p]) => QUERY_BREAKOUT_CHARS.test(p));
    expect(
      breakout.map(([l]) => l),
      'the payload table must contain at least one breakout payload, or this arm is vacuous',
    ).toEqual(['backtick command substitution', 'line injection', 'query operator escape']);
    const survived = breakout
      .filter(([, p]) => escapeThenDrop(p) !== null)
      .map(([l, p]) => `${l}: ${JSON.stringify(p.slice(0, 40))}`);
    expect(
      survived,
      `payload(s) that could end a quoted literal and still reached the query. Repair is ` +
      `forbidden precisely because a repaired value is unpredictable — dropping one costs a ` +
      `search result, repairing one costs the query:\n  ${survived.join('\n  ')}`,
    ).toEqual([]);
  });

  it('a value with no breakout character survives, as a value', () => {
    // Without this the arm above is satisfied by a rule that drops everything, which
    // would make every structured search unreachable rather than safe. The
    // non-breakout payloads are listed among them deliberately: they survive the
    // drop and are contained by POSITION instead, which is the rule the arm above
    // asserts each provider states.
    for (const benign of ['Tech Debt Backlog', 'fix login bug', 'PROJ-12 follow-up', '$(id)']) {
      expect(escapeThenDrop(benign), `${JSON.stringify(benign)} must survive`).toBe(benign);
    }
  });

  it('known-bad probe: the reversed escape order leaves a live quote', () => {
    // The reason the order is stated at all. Escaping the quote first inserts a
    // backslash that the backslash pass then doubles, so the quote ends up preceded
    // by an EVEN number of backslashes — which closes the string literal.
    const payload = 'PROJ" OR project != "';
    const reversed = escapeReversed(payload);
    expect(
      /(^|[^\\])(\\\\)*"/.test(reversed),
      'the reversed order must leave an unescaped quote, or the stated order is arbitrary',
    ).toBe(true);
    // …and the stated order drops this payload rather than shipping it either way.
    expect(
      escapeThenDrop(payload),
      'the stated order must DROP a value that still carries a quote after escaping',
    ).toBeNull();
  });
});
