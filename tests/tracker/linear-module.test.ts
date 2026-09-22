/**
 * Linear provider mechanics — rank 4, its borrowed cap, and what it admits it
 * cannot do (P3c).
 *
 * WHAT THIS FILE OWNS, AND WHAT IT DELIBERATELY DOES NOT
 * ------------------------------------------------------
 * Phase 3c is the commit that makes the tracker references tree hold THREE
 * providers. The claims that are Linear's alone live here:
 *
 *   1. RANK 4 (OD-12) — a stock official server for this provider exposes no
 *      viewer/"me" tool and its attachment create is a binary upload rather than
 *      the URL-link form, so neither the entity-property rung nor the
 *      author-filtered rung is reachable. The module ships POST-WITH-WARNING and
 *      says so: `dedup unavailable — duplicate possible`, posted anyway, and the
 *      absent identity capability is never a reason to suppress (B-6).
 *   2. THE MARKER PREDICATE (AC-3.14) — first-line exact match PLUS a second
 *      discriminator, because rank 4 has no author column to compare against.
 *      Namespaced per comment kind, one owner each, no leak.
 *   3. THE PROVIDER SIGNAL — HTTP **400** `RATELIMITED`, not 429, including its
 *      tool-error-text form. A status-shaped detector reads 400 as a generic 4xx
 *      and keeps fanning out, which is the one way this provider's backpressure
 *      is missed entirely.
 *   4. THE REF GRAMMAR — the anchored key form OR a UUID, after ASCII-upper
 *      normalisation, with no unanchored alternation (§14.1).
 *   5. KNOWN UNKNOWNS (GAP-40) — `32767` is BORROWED from the sibling provider
 *      and measured by no phase, so the module carries a `## Known Unknowns`
 *      section, the rank-4 statement, and a filed probe issue with an owner.
 *   6. THE AGGREGATE CALL BUDGET [DR-09] — rung 4 is this provider's ONLY rung,
 *      so the paged-marker product is the common path rather than the edge.
 *
 * NOT here: the cross-provider literal matrix and the [DR-08] batch negative are
 * `tests/provider-literals.test.ts`', per §8.10/P3c-S5 — those range over every
 * provider, and a per-provider copy of a cross-provider claim is the second
 * authority [DR-19] forbids. The three-column parity scan is
 * `tests/tracker/jira-module.test.ts`', which §8.11 makes non-vacuous by adding
 * this provider as a row rather than by growing a second scan.
 *
 * CORPUS, AND WHY BOTH SIDES ARE READ
 * -----------------------------------
 * Claims about the `## Known Unknowns` section are about the SOURCE module: that
 * section is module-level prose, which the build emits nowhere by design (a
 * column-0 `## ` inside a generated reference terminates its operation section —
 * PF-063). Every claim about mechanics is about the GENERATED files, because that
 * is what a spawn reads. Each assertion names the side it reads, and every dist
 * read is fail-loud with a build hint (R3).
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import * as path from 'path';

import { compiledSkillRefsDir } from '../../src/core/assets.js';
import {
  MCP_BACKED_PROVIDER_SUBDIRS,
  MIN_VARIANT_PAIRS,
  TRACKER_OPS,
  VARIANT_MODULES,
  generatedReferenceManifest,
  mcpContractIsGenerated,
  type VariantModule,
} from '../../src/core/mds-variants.js';
import {
  ROOT,
  TOOL_CALL_MECHANICS_CLAIMS,
  collectMissingMechanicsClaims,
  collectPerItemFetchVerbs,
  type ProviderCorpus,
  type ProviderRefVocabulary,
} from '../helpers.js';
import { MIN_REFERENCE_CHARS } from './reference-floor.js';

// ---------------------------------------------------------------------------
// Sources and generated files
// ---------------------------------------------------------------------------

/** The three provider mechanics modules, addressed by the registry, never by guess. */
const GITHUB_MODULE = 'src/assets/mds/tracker/_github.mds';
const JIRA_MODULE = 'src/assets/mds/tracker/_jira.mds';
const LINEAR_MODULE = 'src/assets/mds/tracker/_linear.mds';

/** The provider sub-directory `_linear.mds` is registered against. */
const LINEAR_SUBDIR = 'tracker/linear';

function readSource(relPath: string): string {
  const abs = path.join(ROOT, relPath);
  if (!existsSync(abs)) {
    throw new Error(
      `${relPath} is absent. The Linear mechanics module is authored in P3c-S1; without it every ` +
      `assertion below would describe a provider that does not ship, and the three-provider ` +
      `parity scan §8.11 makes non-vacuous would still be comparing two.`,
    );
  }
  return readFileSync(abs, 'utf-8');
}

/**
 * A generated reference, read fail-loud.
 *
 * Never ENOENT-tolerant: tolerance is what lets a literal guard pass by measuring
 * an absent file, and every literal below is the only statement of a provider fact.
 */
function readGenerated(relPath: string): string {
  const abs = path.join(compiledSkillRefsDir(), ...relPath.split('/'));
  if (!existsSync(abs)) {
    throw new Error(
      `${relPath} is absent at ${abs} — run \`npm run build\` first (this guard reads compiled ` +
      `reference files and cannot be skipped)`,
    );
  }
  return readFileSync(abs, 'utf-8');
}

function linearRel(op: string): string {
  return `${LINEAR_SUBDIR}/${op}.md`;
}

/** Every generated Linear reference, concatenated — the whole provider surface. */
function linearTree(): string {
  return TRACKER_OPS.map(op => readGenerated(linearRel(op))).join('\n');
}

/**
 * MDS prose escapes collapsed, so one literal has one spelling.
 *
 * `_linear.mds` writes `\{` in prose and a raw `{` inside a column-0 fence, so a
 * source-side assertion on a braced literal would pass or fail on where the author
 * put the sentence. Same narrow rule as the bypass guard's own `unescapeMds` — only
 * the brace pair, so the module's other backslashes are not rewritten into text
 * that appears in no artifact.
 */
function unescapeMds(source: string): string {
  return source.replace(/\\\{/g, '{').replace(/\\\}/g, '}');
}

// ---------------------------------------------------------------------------
// 1. Registration — the third provider, on the shared roster
// ---------------------------------------------------------------------------

/**
 * One registry row, addressed by its source path and raised by name when absent.
 *
 * `find(...)!` would hand the arm an `undefined` that surfaces as "cannot read
 * properties of undefined" a line later, naming neither the registry nor the
 * module that left it — and a module leaving the registry is precisely what these
 * arms exist to report.
 */
function requireVariantModule(source: string): VariantModule {
  const found = VARIANT_MODULES.find(m => m.source === source);
  if (found === undefined) {
    throw new Error(
      `${source} is not in VARIANT_MODULES (registered: ` +
      `${VARIANT_MODULES.map(m => m.source).join(', ')}). An unregistered reference module is ` +
      `refused by the build with a message naming the registry — the emitted filenames come from ` +
      `the op roster, so there is nothing to fall back to.`,
    );
  }
  return found;
}

describe('linear module: registration and the roster it shares', () => {
  it('is registered against tracker/linear and shares the op roster with the other providers', () => {
    const linear = requireVariantModule(LINEAR_MODULE);
    expect(linear.subdir, 'the provider sub-directory decides the gate').toBe(LINEAR_SUBDIR);
    expect(linear.kind, 'a provider module fans out one file per op').toBe('fanout');
    // STRUCTURAL file-set parity, for the third time: every provider row reads the
    // SAME exported roster, so a provider cannot acquire or lose an op without
    // moving every provider with it. Asserted by identity against BOTH siblings —
    // a roster shared with one and not the other is the asymmetry parity forbids.
    const github = requireVariantModule(GITHUB_MODULE);
    const jira = requireVariantModule(JIRA_MODULE);
    expect(linear.ops, 'the roster is TRACKER_OPS, by identity').toBe(TRACKER_OPS);
    expect(linear.ops, 'and the same object the GitHub row reads').toBe(github.ops);
    expect(linear.ops, 'and the same object the Jira row reads').toBe(jira.ops);
  });

  it('is an MCP-backed provider, so it loads the tool-call contract', () => {
    expect(
      (MCP_BACKED_PROVIDER_SUBDIRS as readonly string[]).includes(LINEAR_SUBDIR),
      'tracker/linear must be one of the gated sub-directories, or its mechanics name a contract ' +
      'whose generation nothing keys on',
    ).toBe(true);
    expect(
      mcpContractIsGenerated(),
      'the gate must be open — this provider reaches its tracker through a tool call',
    ).toBe(true);
    for (const op of TRACKER_OPS) {
      expect(generatedReferenceManifest(), `${linearRel(op)} must be in the install manifest`)
        .toContain(linearRel(op));
    }
  });

  it('the roster is long enough for the assertions below to discriminate', () => {
    expect(
      TRACKER_OPS.length,
      `only ${TRACKER_OPS.length} op(s) — a roster short enough to enumerate by hand is ` +
      `satisfied by any implementation that returns something (GAP-42)`,
    ).toBeGreaterThanOrEqual(MIN_VARIANT_PAIRS);
  });
});

// ---------------------------------------------------------------------------
// 2. Generated-file shape
// ---------------------------------------------------------------------------

describe('linear module: the generated per-op references', () => {
  it('every op has a generated Linear reference opening with its own anchor on line 1', () => {
    for (const op of TRACKER_OPS) {
      const content = readGenerated(linearRel(op));
      expect(
        content.split('\n')[0],
        `${linearRel(op)}: line 1 must be this op's anchor`,
      ).toBe(`## Operation: ${op}`);
      expect(content.length, `${linearRel(op)} is thin`).toBeGreaterThanOrEqual(MIN_REFERENCE_CHARS);
    }
  });

  it('every generated Linear reference says which provider and op it is loaded for', () => {
    for (const op of TRACKER_OPS) {
      expect(
        readGenerated(linearRel(op)),
        `${linearRel(op)}: no load-condition sentence`,
      ).toContain(`the resolved tracker provider is \`linear\` and the operation is \`${op}\``);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Rank 4 (OD-12, B-6) — post-with-warning, never suppress on missing evidence
// ---------------------------------------------------------------------------

/**
 * The second discriminator carried on every Linear marker line.
 *
 * Danger JS's trick, hardened: the marker alone is a string a person discussing a
 * release might plausibly type as their first line, and rank 4 has no author
 * column to settle it. A full project URL on the same line is not something that
 * happens by coincidence.
 *
 * It is part of the MARKER, not a visible footer: `git.md`'s attribution rule
 * confines the `*Posted by …*` footer to the two summary operations, and these
 * three comment kinds carry the marker only.
 */
const DISCRIMINATOR_URL = 'https://github.com/dean0x/devflow';

describe('linear module: rank 4 — post with a warning (OD-12, B-6)', () => {
  const backlink = readGenerated(linearRel('backlink-shipped-issues'));

  it('states the rank, and states WHY the higher rungs are unreachable', () => {
    // The rank is the load-bearing fact: a reader who does not know the ladder
    // stopped at 4 will read the DEGRADED line below as a transient failure and
    // look for a configuration fix that does not exist.
    expect(backlink, 'the reached rung must be named').toContain('rank 4');
    expect(
      backlink,
      'the reason the identity rung is unreachable must be stated — six catalogues agree that a ' +
      'stock official server exposes no viewer/"me" tool, and an unexplained rank reads as a bug',
    ).toMatch(/no .{0,40}\bcurrent-user\b|no viewer/i);
    expect(
      backlink,
      'and the reason the URL-idempotency rung is unreachable: the attachment create takes a ' +
      'binary payload, not a URL, so the documented idempotency cannot be reached at all',
    ).toMatch(/binary|base64/i);
  });

  it('degrades with the canonical reason and POSTS — the absent capability never suppresses', () => {
    expect(
      backlink,
      'the canonical §14.2 reason for an unresolvable identity',
    ).toContain('TRACEABILITY: DEGRADED (dedup unavailable — duplicate possible)');
    expect(
      backlink,
      'B-6: the absent identity capability is not evidence of a prior post. Suppressing on it ' +
      'turns a missing capability into a silently skipped release back-link',
    ).toMatch(/never a reason to suppress|post anyway/i);
  });

  it('the marker predicate is first-line equality PLUS a second discriminator (AC-3.14)', () => {
    expect(
      backlink,
      'rank 4 has no author column, so the marker is the only evidence a comment is devflow\'s: ' +
      'it must be bound to line 1',
    ).toMatch(/first[- ]line/i);
    expect(
      backlink,
      'a marker anywhere but line 1 must NOT suppress — a marker at line 5 of a third-party ' +
      'comment is quoted prose, and a substring search is how a quoter acquires the power to ' +
      'silence a release note',
    ).toMatch(/does not suppress|never suppress/i);
    expect(
      backlink,
      'and the second discriminator, because without an author filter a first line that merely ' +
      'reads like the marker is indistinguishable from the marker',
    ).toContain(DISCRIMINATOR_URL);
  });
});

/**
 * The three comment kinds and their marker namespaces (§14.4 `marker_format`).
 *
 * §14.4's spellings, not GitHub's: the GitHub wave marker is frozen by the Phase-0
 * golden as `devflow:wave-report`, and the appendix fixes the per-kind namespace as
 * `devflow:wave`. No reader crosses providers, so they cannot collide — and the
 * three-provider marker table only stays one table while every provider uses the
 * appendix's spelling.
 */
const MARKER_NAMESPACES: ReadonlyArray<{ readonly kind: string; readonly op: string }> = [
  { kind: 'devflow:shipped', op: 'backlink-shipped-issues' },
  { kind: 'devflow:wave', op: 'post-wave-report' },
  { kind: 'devflow:traceability', op: 'ensure-traceable-issue' },
];

describe('linear module: marker namespaces (AC-3.14, GAP-20)', () => {
  it('each comment kind carries its own namespace, in the op that posts it', () => {
    for (const { kind, op } of MARKER_NAMESPACES) {
      expect(
        readGenerated(linearRel(op)),
        `${linearRel(op)}: must own the ${kind} marker namespace`,
      ).toContain(kind);
    }
    expect(
      MARKER_NAMESPACES.length,
      'the namespace table is empty, so the loop above ran zero times (PF-018)',
    ).toBeGreaterThanOrEqual(3);
  });

  it('no marker namespace leaks into an op that does not own it', () => {
    const leaks: string[] = [];
    for (const { kind, op } of MARKER_NAMESPACES) {
      for (const other of TRACKER_OPS) {
        if (other === op) continue;
        if (readGenerated(linearRel(other)).includes(kind)) leaks.push(`${linearRel(other)}: ${kind}`);
      }
    }
    expect(
      leaks,
      `a marker namespace named outside its owning operation. The operation owns the marker and ` +
      `callers pass inputs only; a second namer is the caller-restated literal that already ` +
      `diverged once and produced duplicate comments:\n  ${leaks.join('\n  ')}`,
    ).toEqual([]);
  });

  it('every marker line carries the discriminator, in all three kinds', () => {
    // The discriminator is per-marker, so it has to be on every marker rather than
    // stated once as policy: a kind that dropped it would dedup on the marker alone
    // and inherit exactly the false-positive rank 4 cannot otherwise rule out.
    for (const { kind, op } of MARKER_NAMESPACES) {
      const lines = readGenerated(linearRel(op)).split('\n').filter(l => l.includes(kind));
      expect(lines.length, `${linearRel(op)}: no line names ${kind}`).toBeGreaterThan(0);
      expect(
        lines.some(l => l.includes(DISCRIMINATOR_URL)),
        `${linearRel(op)}: ${kind} appears on no line that also carries the discriminator`,
      ).toBe(true);
    }
  });

  it('GitHub\'s frozen wave spelling does not leak into this provider', () => {
    // The one mandated divergence, asserted as a negative so it cannot be "fixed"
    // by copying GitHub's marker across.
    expect(
      linearTree(),
      '`devflow:wave-report` is GitHub\'s spelling, frozen by the Phase-0 golden. §14.4 fixes the ' +
      'per-kind namespace as `devflow:wave`, and the appendix wins for every new provider',
    ).not.toContain('devflow:wave-report');
  });
});

// ---------------------------------------------------------------------------
// 4. The provider signal — HTTP 400 RATELIMITED, not 429
// ---------------------------------------------------------------------------

describe('linear module: the rate-limit signal is a 400 RATELIMITED (P3c-S1)', () => {
  const backlink = readGenerated(linearRel('backlink-shipped-issues'));

  it('names the literal, the status code, and the tool-error-text form', () => {
    expect(backlink, 'the signal literal').toContain('RATELIMITED');
    expect(
      backlink,
      'the status code must be named as 400. D4\'s status-shaped detector treats a generic 4xx as ' +
      '"degrade this item and continue", so an unnamed 400 keeps the fan-out running straight ' +
      'into the penalty window this rung exists to stop',
    ).toContain('400');
    expect(
      backlink,
      'and the form the signal actually arrives in: a tool call surfaces it as error TEXT rather ' +
      'than as a status line, so a detector that only reads statuses never sees it',
    ).toMatch(/error text|tool[- ]error/i);
    expect(
      backlink,
      'the response to the signal is STOP, never wait-and-continue: continuing to issue requests ' +
      'into an active limit extends it',
    ).toContain('STOP');
  });

  it('states that this provider publishes no pre-emptive remaining count', () => {
    // The absence has to be written down. A module that simply omitted the rung
    // would read as an oversight, and the next author would add GitHub's.
    expect(
      backlink,
      'the no-pre-emptive-rung statement — a rung keyed on a count this provider does not ' +
      'publish would never engage, which reads as coverage and is none',
    ).toMatch(/no pre-emptive|not publish/i);
  });
});

// ---------------------------------------------------------------------------
// 5. The ref grammar — anchored key form OR a UUID, after ASCII-upper (§14.1)
// ---------------------------------------------------------------------------

/**
 * The two anchored forms §14.1 fixes for this provider, pinned here and asserted
 * against the shipped artifact.
 *
 * Pinned rather than parsed out of the module: a scan for "the regexes in the file"
 * cannot tell a ref grammar from the site-URL shape gate that sits beside it, and a
 * guard that grades whatever it found proves nothing about what §14.1 fixed. The
 * two-sidedness comes from the assertion that each pinned form appears verbatim in
 * the provider's own tree, plus the payload table below driving the real regex.
 */
const LINEAR_REF_GRAMMARS: readonly string[] = [
  '^[A-Z][A-Z0-9]{0,9}-[1-9][0-9]{0,8}$',
  '^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$',
];

/** Refs that must be ACCEPTED after ASCII-upper normalisation. */
const ACCEPTED_REFS: readonly string[] = [
  'TEAM-123',
  'team-123',
  'A-1',
  'ABCDEFGHIJ-999999999',
  '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
];

/**
 * Register row 25's payloads. Each targets a different sink: shell separators,
 * command substitution, flag injection (two spellings), traversal, size, a
 * zero-numbered key, whitespace, and the three LINE-TERMINATOR spellings.
 *
 * The terminator rows are the ones this file's own evaluation context hides. A
 * ref is interpolated into a query and into a command, and the grammar that
 * admits it is applied by an agent through `grep -E`, through Python, or by eye —
 * and in those contexts `$` matches before a trailing newline, where in
 * JavaScript it does not. A payload table driven only by `new RegExp(...).test`
 * therefore reports a pass for the one input the shipped reading would let
 * through.
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
  ['trailing newline', 'TEAM-123\n'],
  ['trailing carriage return', 'TEAM-123\r'],
  ['embedded newline', 'TEAM\n-123'],
];

/**
 * An anchored form under the PERMISSIVE reading — the one a `grep -E`, Python or
 * Ruby reader applies, where `$` matches at the end of the string OR immediately
 * before a final newline.
 *
 * Modelled by stripping one trailing newline before the JavaScript test, which is
 * exactly the difference between the two anchor semantics. Testing under the
 * permissive reading is the conservative direction: a payload this rejects is
 * rejected by every reader, and one it accepts is a payload some reader admits.
 */
function matchesPermissively(source: string, value: string): boolean {
  return new RegExp(source).test(value.replace(/\n$/, ''));
}

/**
 * The gate AS THE SHIPPED MODULE STATES IT: ASCII-upper, then either anchored
 * form read permissively, with the module's own end-of-STRING clause refusing any
 * value that carries a line terminator.
 *
 * The clause is modelled here rather than assumed, and the arm below pins that
 * the shipped mechanics actually state it — a model that invented the refusal
 * would grade the artifact against a rule the artifact does not carry.
 */
function acceptsRef(ref: string): boolean {
  const normalised = ref.replace(/[a-z]/g, c => c.toUpperCase());
  if (/[\n\r]/.test(normalised)) return false;
  return LINEAR_REF_GRAMMARS.some(source => matchesPermissively(source, normalised));
}

describe('linear module: the anchored ref grammar and its UUID alternative (§14.1)', () => {
  it('both anchored forms appear verbatim in the shipped Linear references', () => {
    const tree = linearTree();
    for (const grammar of LINEAR_REF_GRAMMARS) {
      expect(
        tree,
        `the anchored form ${grammar} appears nowhere in the generated Linear tree — a grammar ` +
        `the mechanics do not state is a gate the agent cannot apply`,
      ).toContain(grammar);
    }
    expect(
      tree,
      '§14.1: never `^A|B$`. The alternation is between two SEPARATELY anchored forms, because a ' +
      'single anchor pair around an alternation anchors one branch only',
    ).not.toMatch(/\^\[A-Z\]\[A-Z0-9\]\{0,9\}-\[1-9\]\[0-9\]\{0,8\}\|/);
    expect(
      tree,
      'the normalisation that makes a lowercase key admissible must be stated, or the grammar ' +
      'rejects every ref a branch name carries',
    ).toMatch(/ASCII-upper/);
  });

  it('accepts the key form and the UUID form, after normalisation', () => {
    for (const ref of ACCEPTED_REFS) {
      expect(acceptsRef(ref), `${JSON.stringify(ref)} must be accepted`).toBe(true);
    }
    expect(ACCEPTED_REFS.length, 'the accepted corpus is empty (PF-018)').toBeGreaterThan(0);
  });

  it('known-bad table: every hostile ref is REJECTED by the grammar as written', () => {
    const accepted = HOSTILE_REFS.filter(([, ref]) => acceptsRef(ref)).map(([label]) => label);
    expect(
      accepted,
      `hostile ref(s) accepted by the grammar this module states: ${accepted.join(', ')}. The ` +
      `anchored form is what keeps a ref out of a query and out of a command`,
    ).toEqual([]);
    expect(
      HOSTILE_REFS.length,
      'the hostile corpus is too thin to discriminate — the filter above would be empty for a ' +
      'grammar that accepted everything (PF-018)',
    ).toBeGreaterThanOrEqual(11);
  });

  it('the mechanics state that an anchor binds the whole STRING, so a newline fails', () => {
    // The clause `acceptsRef` models. Without it the payload table above would be
    // grading the artifact against a rule only this file believes in.
    expect(
      linearTree(),
      'the anchored forms ship into a prompt and are applied by `grep -E`, Python or by eye, ' +
      'where `$` matches before a trailing newline. Unless the mechanics say the anchor binds ' +
      'the whole string, a ref carrying one satisfies the gate and reaches a query and a command',
    ).toContain('anchored at both ends of the STRING (a newline fails it)');
  });

  it('known-bad probe: the permissive reading alone admits a trailing newline', () => {
    // The divergence itself, asserted rather than described. The first expectation
    // is the shipped reading WITHOUT the clause; the second is the gate with it;
    // the third is why a JavaScript-only model never reported the gap.
    expect(
      LINEAR_REF_GRAMMARS.some(source => matchesPermissively(source, 'TEAM-123\n')),
      'a `grep -E` or Python reader accepts a trailing newline against these forms — if this is ' +
      'false the permissive model has stopped modelling anything and the payload rows are inert',
    ).toBe(true);
    expect(
      acceptsRef('TEAM-123\n'),
      'and the stated clause is what refuses it',
    ).toBe(false);
    expect(
      new RegExp(LINEAR_REF_GRAMMARS[0]).test('TEAM-123\n'),
      "JavaScript's own `$` rejects it unaided, which is exactly why a test written in this " +
      'file\'s evaluation context reported a pass over the one input that could get through',
    ).toBe(false);
  });

  it('the per-ref DEGRADED reason names this provider, and the aggregate arm exists', () => {
    const backlink = readGenerated(linearRel('backlink-shipped-issues'));
    expect(
      backlink,
      'the per-ref reason, instantiated for this provider (§14.2)',
    ).toContain('TRACEABILITY: DEGRADED (issue reference "{ref}" does not match linear reference grammar)');
    expect(
      backlink,
      'and [DR-04(c)]\'s aggregate reason, owned by the pre-flight',
    ).toContain('TRACEABILITY: DEGRADED (no parseable refs for provider {p})');
  });
});

// ---------------------------------------------------------------------------
// 6. Never COMPLETE over dropped or unresolvable refs
// ---------------------------------------------------------------------------

describe('linear module: a dropped or unresolvable ref never reports COMPLETE', () => {
  it('backlink-shipped-issues refuses COMPLETE when the pre-flight dropped everything', () => {
    expect(
      readGenerated(linearRel('backlink-shipped-issues')),
      'a green COMPLETE over zero processed issues is the report a release believes',
    ).toContain('never report the status as `COMPLETE`');
  });

  it('gather-release-evidence cannot report COMPLETE — closing refs are unsupported here', () => {
    const evidence = readGenerated(linearRel('gather-release-evidence'));
    expect(
      evidence,
      '§14.4 fixes closing_refs_for_commit as unsupported on this provider; the cell is DEGRADED, ' +
      'not blank',
    ).toContain('TRACEABILITY: DEGRADED (unsupported by linear)');
    expect(
      evidence,
      'an enrichment that could not resolve its closing refs is PARTIAL, never COMPLETE',
    ).toContain('never report the status as `COMPLETE`');
  });
});

// ---------------------------------------------------------------------------
// 7. [DR-09] The per-op aggregate call budget — rung 4 is the ONLY rung
// ---------------------------------------------------------------------------

const AGGREGATE_BUDGET = {
  items: '≤50',
  pages: '≤2',
  product: '≤100',
} as const;

describe('linear module: the per-op aggregate call budget [DR-09]', () => {
  const backlink = readGenerated(linearRel('backlink-shipped-issues'));

  it('states both factors AND the product', () => {
    expect(backlink, 'the per-op item bound').toContain(AGGREGATE_BUDGET.items);
    expect(backlink, 'the page bound on a paged marker scan').toContain(AGGREGATE_BUDGET.pages);
    expect(
      backlink,
      `the PRODUCT must be stated. On this provider rung 4 is the ONLY rung, so the paged marker ` +
      `scan is the common path rather than the edge, and ${AGGREGATE_BUDGET.items} items × ` +
      `${AGGREGATE_BUDGET.pages} pages is the figure that decides whether the op fits inside the ` +
      `provider's rate budget at all`,
    ).toContain(AGGREGATE_BUDGET.product);
    expect(
      backlink,
      'exceeding the budget is reported, never silently truncated',
    ).toContain('TRUNCATED ({n} not processed)');
  });

  it('the product is arithmetically what the factors say', () => {
    const num = (s: string): number => Number(s.replace('≤', ''));
    expect(
      num(AGGREGATE_BUDGET.items) * num(AGGREGATE_BUDGET.pages),
      'the stated product must equal the product of the stated factors',
    ).toBe(num(AGGREGATE_BUDGET.product));
  });

  it('prefers the hoisted single-pass shape over the per-item ladder', () => {
    expect(
      backlink,
      'the reference must state the hoisted alternative — a budget with no cheaper path beside ' +
      'it reads as an endorsement of the expensive one',
    ).toContain('hoist');
  });
});

// ---------------------------------------------------------------------------
// 8. fetch-issues-batch is ONE query [DR-08], read on this provider's own file
// ---------------------------------------------------------------------------

describe('linear module: fetch-issues-batch is one filtered query [DR-08]', () => {
  const batch = readGenerated(linearRel('fetch-issues-batch'));

  it('states the single filtered query, its bound, and the truncation report', () => {
    expect(batch, 'the batch must be ONE filtered query keyed on the resolved list')
      .toContain('issues(filter:');
    expect(batch, 'a query with no page bound is an unbounded read').toContain('first:');
    expect(batch, 'the ≤50 bound §14.4 fixes for every provider').toContain('≤50');
    expect(batch, 'over the bound the remainder is reported, never silently dropped')
      .toContain('TRUNCATED ({n} not processed)');
  });

  it('names no per-item fetch verb and no single-key fetch capability', () => {
    // The cross-provider arm lives in tests/provider-literals.test.ts; this one is
    // the provider-local half, so a module authored here goes red in its own suite
    // rather than only in a scan that ranges over three trees.
    expect(
      collectPerItemFetchVerbs(batch),
      'a per-item fetch inside the batch reference re-grows the N+1 Phase 2 removed from GitHub. ' +
      'Parity asserts the file exists and is non-empty — it cannot see the difference between ' +
      'one query and fifty [DR-08]',
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 9. `## Known Unknowns` + the filed probe issue (P3c-S3, GAP-40)
// ---------------------------------------------------------------------------

/** The filed probe issue for the borrowed cap — an owner, not a TODO. */
const PROBE_ISSUE = '#343';

describe('linear module: Known Unknowns and the filed probe issue (P3c-S3, GAP-40)', () => {
  const source = readSource(LINEAR_MODULE);

  it('the module carries a `## Known Unknowns` section', () => {
    expect(
      source,
      'GAP-40: this provider\'s cap is borrowed and measured by no phase. A module that shipped ' +
      'the number without the section would present a guess as a measurement',
    ).toContain('## Known Unknowns');
  });

  it('the section lives in module prose, which the build emits NOWHERE (PF-063)', () => {
    // A column-0 `## ` inside a generated reference terminates its operation section
    // for every guard that reads it through extractOpSectionFromCorpus — everything
    // below goes silently invisible while the bytes stay on disk. The section
    // therefore belongs above the first section marker, where the splitter drops it,
    // and the user-facing copy lives in the CLI reference instead.
    const firstMarker = source.indexOf('<!-- op: ');
    expect(firstMarker, 'the module must carry section markers').toBeGreaterThan(0);
    expect(
      source.indexOf('## Known Unknowns'),
      'the section must sit in module-level prose, above the first section marker',
    ).toBeLessThan(firstMarker);
    for (const op of TRACKER_OPS) {
      expect(
        readGenerated(linearRel(op)),
        `${linearRel(op)} carries the Known Unknowns heading — a column-0 \`## \` after line 1 ` +
        `truncates this op's section for every union-mode guard (PF-063)`,
      ).not.toContain('## Known Unknowns');
    }
  });

  it('says the cap is BORROWED and not measured, and names the number', () => {
    expect(source, 'the cap itself').toContain('32767');
    expect(
      source,
      'and that it is borrowed rather than measured — the whole content of the unknown',
    ).toMatch(/borrowed/i);
  });

  it('carries the rank-4 statement and the filed probe issue with an owner', () => {
    expect(source, 'the rank must be stated where the unknowns are').toContain('rank 4');
    expect(
      source,
      `${PROBE_ISSUE} must be greppable from the module. A follow-up with no artifact and no ` +
      `owner is not a deliverable — which is exactly what GAP-40 recorded about this number`,
    ).toContain(PROBE_ISSUE);
  });

  it('known-bad probe: the placement predicate reports a section moved below the first marker', () => {
    // The only COMPUTED predicate in this block is the placement one — the rest are
    // containment arms, which cannot pass over a corpus that says nothing. So it is
    // the placement predicate that is driven over a seeded copy here, and the seed
    // is the one relocation that matters: a section below the first marker ships the
    // heading into every generated reference and truncates each op's section for
    // every union-mode guard (PF-063).
    const firstMarker = source.indexOf('<!-- op: ');
    const relocated =
      source.slice(0, firstMarker).split('## Known Unknowns').join('## A heading that is not it') +
      source.slice(firstMarker) +
      '\n## Known Unknowns\n';
    expect(relocated, 'the relocation seed must change the source').not.toBe(source);
    expect(
      relocated.indexOf('## Known Unknowns'),
      'the live arm reads "above the first marker"; over this copy it must read below it, or the ' +
      'probe drives nothing',
    ).toBeGreaterThan(relocated.indexOf('<!-- op: '));
  });
});

// ---------------------------------------------------------------------------
// 10. (AC-3.18, §14.9-2) No HTTP fallback anywhere in the Linear mechanics
// ---------------------------------------------------------------------------

/**
 * The transports a Linear mechanics file may never reach for.
 *
 * GAP-19's highest-value bypass: a tool that is absent is a capability that is
 * absent, and improvising an HTTP call around it bypasses BOTH the D11 scrub gate
 * and the no-credential-read rule in one move.
 */
const FORBIDDEN_TRANSPORTS: readonly RegExp[] = [
  /\bcurl\b/i,
  /\bwget\b/i,
  /Authorization:/,
  /\bgh (?:issue|api|pr|release)\b/,
  /\$\{?LINEAR_[A-Z_]*(?:TOKEN|KEY|SECRET|PASSWORD)/,
];

/** Named collector: forbidden transport shapes, as `{line}: {text}`. */
export function collectForbiddenTransports(text: string): string[] {
  const found: string[] = [];
  for (const [i, line] of text.split('\n').entries()) {
    for (const shape of FORBIDDEN_TRANSPORTS) {
      if (shape.test(line)) found.push(`${i + 1}: ${line.trim().slice(0, 90)}`);
    }
  }
  return found;
}

describe('linear module: tool calls only — no HTTP, no CLI, no credential read (AC-3.18)', () => {
  it('no generated Linear reference constructs a request or names a credential', () => {
    const offenders: string[] = [];
    for (const op of TRACKER_OPS) {
      for (const site of collectForbiddenTransports(readGenerated(linearRel(op)))) {
        offenders.push(`${linearRel(op)}:${site}`);
      }
    }
    expect(
      offenders,
      `a Linear mechanics file reaches the tracker other than through a tool call. §14.9-2 is ` +
      `absolute: never construct an HTTP request, never run a command-line client, never read a ` +
      `tracker credential from the environment:\n  ${offenders.join('\n  ')}`,
    ).toEqual([]);
  });

  it('known-bad probe: the same collector reports each forbidden transport', () => {
    for (const seeded of [
      'curl -H "Authorization: Bearer $LINEAR_API_KEY" https://api.linear.app/graphql',
      'wget -qO- https://api.linear.app/graphql',
      'gh issue comment 12 --body-file "$DEVFLOW_BODY"',
      'export TOKEN=$LINEAR_API_KEY',
    ]) {
      expect(
        collectForbiddenTransports(seeded).length,
        `"${seeded}" must be reported`,
      ).toBeGreaterThan(0);
    }
    // …and the legitimate neighbour it sits beside: the scrubber invocation, which
    // is a node call on a local script and not a transport.
    expect(
      collectForbiddenTransports(
        'node "${DEVFLOW_DIR:-$HOME/.devflow}/scripts/redact-secrets.cjs" --emit "$DEVFLOW_BODY_RAW"',
      ),
      'the scrub invocation must not be reported — it is the gate, not a transport',
    ).toEqual([]);
    expect(FORBIDDEN_TRANSPORTS.length, 'the transport table is empty (PF-018)').toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 11. Query safety and the contract invocation
// ---------------------------------------------------------------------------

describe('linear module: query safety and the cross-cutting rules it invokes', () => {
  // REPOINTED, per-literal, when `### Query safety` moved into the shared
  // authoring module `_mcp.mds` (ADR-025): the rule is no longer text this
  // module's source spells, so the source is no longer where it can be read. It
  // is read where it is GUARANTEED to appear instead — the one operation that
  // composes a query, in this provider's emitted mechanics — which is also the
  // side a spawn reads, and the side the sibling arm below already reads.
  const querySafety = unescapeMds(readGenerated(linearRel('ensure-traceable-issue')));

  it('structured filter fields are preferred and a built query is value-quoted only', () => {
    expect(querySafety, 'structured filter arguments first (§14.9-10)')
      .toContain('structured filter argument');
    expect(
      querySafety,
      'a value may only ever reach a query as a quoted string literal — never in field, ' +
      'operator or ordering position, which is where a quote break becomes a different question',
    ).toContain('quoted string literal');
    expect(querySafety, 'escape order is part of the rule: backslash first, then quote')
      .toContain('Escape `\\` first and then `"`');
    expect(
      querySafety,
      'and anything still carrying a metacharacter after escaping is DROPPED, never repaired',
    ).toMatch(/drop|reject/i);
  });

  it('render_collapsed_block degrades to a pointer sentence, with the preservation order', () => {
    const traceable = readGenerated(linearRel('ensure-traceable-issue'));
    expect(
      traceable,
      'this provider\'s comment format has no collapsed-block analogue, so the collapsed artifact ' +
      'comment becomes a pointer sentence rather than a silently flattened dump',
    ).toContain('pointer sentence');
    expect(
      traceable,
      'and the preservation order says WHICH bytes survive a truncation: the marker, then the ' +
      'status lines, then the pointer — the untrusted middle is what gets cut',
    ).toContain('32767');
  });

  it('every posting mechanic invokes the tool-call contract by name, never restates it', () => {
    const namers: string[] = [];
    for (const op of TRACKER_OPS) {
      const content = readGenerated(linearRel(op));
      if (!content.includes('{SCRUBBED_BODY}')) continue;
      namers.push(linearRel(op));
      expect(
        content,
        `${linearRel(op)}: a posting mechanic must invoke the contract that governs it`,
      ).toContain('The tool-call contract governs');
      expect(
        content,
        `${linearRel(op)}: a posting mechanic must NOT compose the contract's path. The contract is ` +
        `a per-SPAWN load named once, from the agent preamble; a per-operation path made it look ` +
        `per-operation, and five of these ten files did not carry it at all (PF-058).`,
      ).not.toContain('references/tracker/_mcp.md');
    }
    expect(
      namers.length,
      'no Linear reference spells the gated body placeholder — either no op posts (and AC-3.5\'s ' +
      'forward arm has no subject) or the placeholder is spelled some other way',
    ).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 10. AC-3.3 / AC-3.11 / §14.3 — the clauses this provider's mechanics own
// ---------------------------------------------------------------------------
//
// The claim TABLE lives in tests/helpers.ts: each of these sentences is made per
// provider and is the SAME sentence for every tool-call provider, so a copy in
// this suite and another in the sibling one would be two authorities on one
// contract. The vocabulary below is the only per-provider part — this provider
// renders a `reference`, so its branch token is `REF` (§14.1).
//
// All three AC-3.3 clauses shipped as prose in this module with no test
// containing any of the three strings, so the criterion rested on nobody
// condensing the paragraph away. AC-3.11's branch shape is here for the opposite
// reason: the always-loaded agent deliberately does NOT restate it, so this file
// is its only statement and its only possible pin.

const LINEAR_VOCABULARY: ProviderRefVocabulary = {
  refToken: 'REF',
  refNoun: 'reference',
};

/** The shipped Linear corpus, read through this file's own fail-loud reader. */
const LINEAR_CORPUS: ProviderCorpus = {
  label: LINEAR_SUBDIR,
  vocab: LINEAR_VOCABULARY,
  read: op => readGenerated(linearRel(op)),
};

/**
 * One op's text out of a corpus read once.
 *
 * The map is declared `Map<string, string>` and so is the reader `ProviderCorpus`
 * takes, so a key outside `TRACKER_OPS` is a real possibility rather than one the
 * literal-union inference of `as const` hides behind a `!`. A miss NAMES the op:
 * without it the only signal is a `TypeError` several frames later (PF-069).
 */
function readFromCorpus(corpus: ReadonlyMap<string, string>, op: string): string {
  const text = corpus.get(op);
  if (text === undefined) {
    throw new Error(
      `${LINEAR_SUBDIR}: no pre-read reference for op \`${op}\` — this probe's corpus is keyed by ` +
      `TRACKER_OPS, so a claim naming an op outside the roster reaches nothing`,
    );
  }
  return text;
}

describe('linear module: the clauses AC-3.3, AC-3.11 and §14.3 fix here', () => {
  for (const criterion of ['AC-3.3', 'AC-3.11', '\u00a714.3']) {
    it(`states every ${criterion} clause its mechanics own`, () => {
      const claims = TOOL_CALL_MECHANICS_CLAIMS.filter(c => c.criterion === criterion);
      expect(
        claims.length,
        `no claim carries criterion ${criterion} — the arm ranges over nothing (PF-018)`,
      ).toBeGreaterThan(0);
      const missing = collectMissingMechanicsClaims(LINEAR_CORPUS, claims);
      expect(
        missing,
        `${criterion} clause(s) absent from this provider's generated mechanics:\n  ` +
        missing.join('\n  '),
      ).toEqual([]);
    });
  }

  it('known-bad probe: each clause, deleted from a copy, is reported by the same collector', () => {
    // Mechanic (b) — the wounded copy is built inside this `it` from the shipped
    // bytes, so no committed file is touched to show red, and it is done per ROW:
    // a pattern that has drifted off the shipped wording would otherwise sit in the
    // table matching nothing while the arms above passed on every other row.
    const pristine = new Map<string, string>(
      TRACKER_OPS.map(op => [op, readGenerated(linearRel(op))]),
    );
    const tree = (): string => [...pristine.values()].join('\n');
    expect(
      collectMissingMechanicsClaims(
        { label: 'pristine', vocab: LINEAR_VOCABULARY, read: op => readFromCorpus(pristine, op) },
        TOOL_CALL_MECHANICS_CLAIMS,
      ),
      'the collector must be silent on the shipped mechanics, or the probe proves nothing',
    ).toEqual([]);

    for (const claim of TOOL_CALL_MECHANICS_CLAIMS) {
      const pattern = claim.pattern(LINEAR_VOCABULARY);
      const wounded = new Map<string, string>(
        [...pristine].map(([op, text]) => [op, text.replace(pattern, '')]),
      );
      expect(
        [...wounded.values()].join('\n'),
        `the pattern for "${claim.label}" matched nothing in this provider's mechanics, so ` +
        `deleting it was a no-op and the row cannot be shown live`,
      ).not.toBe(tree());
      const reported = collectMissingMechanicsClaims(
        {
          label: 'wounded',
          vocab: LINEAR_VOCABULARY,
          read: op => readFromCorpus(wounded, op),
        },
        TOOL_CALL_MECHANICS_CLAIMS,
      );
      expect(
        reported.some(v => v.includes(claim.label)),
        `removing "${claim.label}" must be reported by the same collector, got:\n  ` +
        reported.join('\n  '),
      ).toBe(true);
    }
  });
});
