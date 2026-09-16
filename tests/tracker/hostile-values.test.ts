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
 * SCOPE AT THIS SUBTASK (3a-2). Two of the four arms named for this file have no
 * subject yet, and an empty `describe` asserts nothing while reading as coverage:
 *   - `refs per provider` (register row 25) needs the per-provider anchored
 *     `ref_grammar` defines — those land with `_jira.mds` (3b) and `_linear.mds` (3c).
 *   - `JQL/filter fields` (§14.9 constraint 10) needs a provider module that
 *     builds a query — same two subtasks.
 * Both are written against their modules in 3b/3c, in the commit that creates the
 * thing they constrain (ADR-025). The provider-token arm (register row 21) is NOT
 * duplicated here either: `tests/core/tracker.test.ts` already drives the 13-payload
 * table through `parseTrackerId`, the single owner of provider parsing, and a second
 * copy of that table is the divergence it exists to prevent.
 */

import { describe, it, expect } from 'vitest';

import {
  TRACKER_SCHEMA_SECTIONS,
  collectTrackerSchemaRows,
  resolveAgentSource,
  type TrackerSchemaRow,
} from '../helpers.js';

const TRACKER_TEXT = resolveAgentSource('tracker').content;

// ---------------------------------------------------------------------------
// The payload table (non-vacuity register row 22)
// ---------------------------------------------------------------------------

/**
 * The seven payloads, verbatim from the register. Each targets a different sink:
 * command substitution (two spellings), flag injection, line injection, size,
 * credential-in-URL, and query-operator escape.
 */
const HOSTILE_PAYLOADS: ReadonlyArray<readonly [label: string, payload: string]> = [
  ['backtick command substitution', 'PROJ`whoami`'],
  ['dollar command substitution', '$(id)'],
  ['flag injection', '--body-file=/etc/passwd'],
  ['line injection', 'a\nb'],
  ['500 characters', 'a'.repeat(500)],
  ['userinfo credential in URL', 'https://u:tok@host'],
  ['query operator escape', 'PROJ" OR project != "'],
];

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
 * scanner could have invented" is the property under test.
 */
type ValidatorKind = 'regex' | 'closedSet' | 'denylist' | 'enumerated' | 'structured';

interface Validator {
  readonly kinds: readonly ValidatorKind[];
  readonly patterns: readonly RegExp[];
  readonly closedSet: readonly string[];
  readonly denied: readonly string[];
  readonly maxChars: number | null;
}

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
 * Named collector: parse one validator cell into the checks it declares.
 *
 * Throws rather than returning an empty validator when a cell declares nothing
 * recognisable. A cell that parsed to "no checks" would make every payload row
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

  if (/enumerated this run/.test(cell)) kinds.push('enumerated');
  if (/structured filter fields only/.test(cell)) kinds.push('structured');

  if (kinds.length === 0) {
    throw new Error(
      `validator cell declares no recognisable check — every hostile payload for this field ` +
      `would pass vacuously (PF-018). Cell: ${cell}`,
    );
  }
  return { kinds, patterns, closedSet, denied, maxChars };
}

/**
 * Named collector: reasons the declared validator rejects `value`.
 *
 * Returns the empty array when the validator ACCEPTS — so an assertion reads
 * "rejected for at least one stated reason", and the reason is in the message.
 */
export function rejectionReasons(validator: Validator, value: string): string[] {
  const reasons: string[] = [];
  for (const pattern of validator.patterns) {
    if (!pattern.test(value)) reasons.push(`fails ${pattern.source}`);
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
  // Total-rejection kinds: nothing a history scan or a hand edit produces is
  // admissible, because the admissible set is built from this run's enumeration.
  if (validator.kinds.includes('enumerated')) reasons.push('not enumerated this run');
  if (validator.kinds.includes('structured')) reasons.push('not a structured filter field');
  return reasons;
}

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

  it('the payload table still has all seven rows (non-vacuity)', () => {
    expect(HOSTILE_PAYLOADS).toHaveLength(7);
    expect(new Set(HOSTILE_PAYLOADS.map(([, p]) => p)).size, 'payloads must be distinct').toBe(7);
  });

  it('every declared validator parses to at least one real check', () => {
    for (const row of rows) {
      expect(
        () => parseValidator(row.validator),
        `${row.section}: ${row.validator}`,
      ).not.toThrow();
    }
  });

  for (const row of collectTrackerSchemaRows(TRACKER_TEXT)) {
    describe(row.section, () => {
      const validator = parseValidator(row.validator);

      for (const [label, payload] of HOSTILE_PAYLOADS) {
        it(`rejects ${label}`, () => {
          const reasons = rejectionReasons(validator, payload);
          expect(
            reasons.length,
            `${row.section} ACCEPTED ${JSON.stringify(payload.slice(0, 60))} — the declared ` +
            `validator (${row.validator}) admits it. Tighten the validator in the agent's ` +
            `schema table, not this test.`,
          ).toBeGreaterThan(0);
        });
      }
    });
  }

  it('known-bad probe: a laxened validator cell is reported by the same collectors', () => {
    // Mechanic (b): the bad shape is asserted inside this `it`, so no committed
    // file is touched to show red.
    const lax = parseValidator('`^.*$`');
    expect(rejectionReasons(lax, 'PROJ`whoami`'), 'a permissive regex must be caught here').toEqual([]);
    const strict = parseValidator('`^[A-Za-z][A-Za-z0-9_]{0,9}$`');
    expect(rejectionReasons(strict, 'PROJ`whoami`').length).toBeGreaterThan(0);
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
    const live = new Set(rows.flatMap(r => parseValidator(r.validator).kinds));
    for (const kind of ['regex', 'closedSet', 'denylist', 'enumerated', 'structured'] as const) {
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
    for (const phrase of ['ASCII-lowercase', 'case folding', 'ASCII-upper']) {
      expect(
        TRACKER_TEXT,
        `'${phrase}' describes a provider-token repair pipeline. The token arrives validated ` +
        'in the spawn directive; re-deriving it here adds a second convergence point (PF-023).',
      ).not.toContain(phrase);
    }
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
