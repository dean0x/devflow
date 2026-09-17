/**
 * Jira provider mechanics — the module, its literals, and its call budget (P3b).
 *
 * WHAT THIS FILE OWNS, AND WHAT IT DELIBERATELY DOES NOT
 * ------------------------------------------------------
 * Phase 3b is the first commit in which the tracker references tree holds TWO
 * providers, so it is the first commit in which parity is a property rather than
 * an aspiration. Three claims live here and nowhere else:
 *
 *   1. PARITY — file-set and define-set parity across every registered provider
 *      module, in BOTH directions, with every define non-empty. File-set parity is
 *      STRUCTURAL: every registry row reads the same exported `TRACKER_OPS`, so a
 *      divergence is a compile error rather than a test failure. Define-set parity
 *      is asserted, because a define is a name inside a module body that no type
 *      sees. §8.11 makes AC-3.8 non-vacuous at THREE providers, which is the state
 *      of the scan below — it grew by a row, not by a rewrite.
 *   2. PROVIDER LITERALS — `32767` present; `60000` and `X-RateLimit-Remaining`
 *      absent; `Retry-After` present (AC-3.13). Jira has no pre-emptive remaining
 *      count, so a module that names one has copied GitHub's backpressure model
 *      into a provider that cannot support it.
 *   3. MECHANICS PROPERTIES — the single-query batch [DR-08], the aggregate call
 *      budget [DR-09], the first-line namespaced marker (AC-3.14), the never-
 *      `COMPLETE` rule (AC-3.4), and the no-HTTP-fallback negative (AC-3.18).
 *
 * NOT here: the cross-provider LITERAL matrix is `tests/provider-literals.test.ts`',
 * per P3c-S5, and Linear's own mechanics are `tests/tracker/linear-module.test.ts`'.
 * What stayed is the parity scan, because parity is a property of the SET of
 * providers and has no per-provider home: it lives in the file that first had two
 * columns to compare, and it grew by one row when the third arrived.
 *
 * CORPUS, AND WHY BOTH SIDES ARE READ
 * -----------------------------------
 * Some claims are about the SOURCE module (`_jira.mds`) and some about the
 * GENERATED files (`dist/skills/git/references/tracker/jira/*.md`). They are not
 * interchangeable: a define name exists only in the source, and the `## Operation:`
 * anchor grammar is a property of the generated file. Every claim below names which
 * side it reads, and every dist read is fail-loud with a build hint (R3).
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
} from '../../src/core/mds-variants.js';
import {
  PER_ITEM_FETCH_SHAPES,
  ROOT,
  TOOL_CALL_MECHANICS_CLAIMS,
  collectMissingMechanicsClaims,
  collectPerItemFetchVerbs,
  type ProviderCorpus,
  type ProviderRefVocabulary,
} from '../helpers.js';

// ---------------------------------------------------------------------------
// Sources and generated files
// ---------------------------------------------------------------------------

/** The two provider mechanics modules, addressed by the registry, never by guess. */
const GITHUB_MODULE = 'src/assets/mds/tracker/_github.mds';
const JIRA_MODULE = 'src/assets/mds/tracker/_jira.mds';

/** The provider sub-directory `_jira.mds` is registered against. */
const JIRA_SUBDIR = 'tracker/jira';

function readSource(relPath: string): string {
  const abs = path.join(ROOT, relPath);
  if (!existsSync(abs)) {
    throw new Error(
      `${relPath} is absent. The Jira mechanics module is authored in P3b-S1; without it every ` +
      `parity assertion below would compare one provider against nothing.`,
    );
  }
  return readFileSync(abs, 'utf-8');
}

/**
 * A generated reference, read fail-loud.
 *
 * Never ENOENT-tolerant: `referenceChars`-style tolerance is what lets a literal
 * guard pass by measuring an absent file, and every literal below is the only
 * statement of a provider fact.
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

function jiraRel(op: string): string {
  return `${JIRA_SUBDIR}/${op}.md`;
}

/**
 * MDS prose escapes collapsed, so one literal has one spelling.
 *
 * `_jira.mds` writes `\{` in prose and a raw `{` inside a column-0 fence, so a
 * source-side assertion on `{SCRUBBED_BODY}` would pass or fail on where the
 * author put the sentence. Same narrow rule as the bypass guard's own
 * `unescapeMds` — only the brace pair, so the module's other backslashes are not
 * rewritten into text that appears in no artifact.
 */
function unescapeMds(source: string): string {
  return source.replace(/\\\{/g, '{').replace(/\\\}/g, '}');
}

// ---------------------------------------------------------------------------
// 1. Registration — the gate this module opens, and the roster it shares
// ---------------------------------------------------------------------------

describe('jira module: registration and the contract gate it opens', () => {
  it('is registered against tracker/jira and shares the op roster with GitHub', () => {
    const jira = VARIANT_MODULES.find(m => m.source === JIRA_MODULE);
    expect(
      jira,
      `${JIRA_MODULE} is not in VARIANT_MODULES. An unregistered reference module is refused by ` +
      `the build with a message naming the registry — the emitted filenames come from the op ` +
      `roster, so there is nothing to fall back to.`,
    ).toBeDefined();
    expect(jira!.subdir, 'the provider sub-directory decides the gate').toBe(JIRA_SUBDIR);
    expect(jira!.kind, 'a provider module fans out one file per op').toBe('fanout');
    // STRUCTURAL file-set parity: both rows read the SAME exported roster, so a
    // provider cannot acquire or lose an op without moving every provider with it.
    // Asserted by identity, not by set equality — set equality over two hand-listed
    // rosters is the drift this arrangement removes.
    const github = VARIANT_MODULES.find(m => m.source === GITHUB_MODULE)!;
    expect(
      jira!.ops,
      'both provider rows must read one roster — file-set parity is then a compile-time property',
    ).toBe(github.ops);
    expect(jira!.ops, 'and that roster is TRACKER_OPS').toBe(TRACKER_OPS);
  });

  it('opening the gate generates the tool-call contract, and the manifest carries it', () => {
    // The gate is keyed on a registered module landing in an MCP-backed sub-directory
    // (mcpContractIsGenerated). 3b opens it by registering `_jira.mds` and by nothing
    // else — there is no flag, no frontmatter key and no second edit.
    expect(
      (MCP_BACKED_PROVIDER_SUBDIRS as readonly string[]).includes(JIRA_SUBDIR),
      'tracker/jira must be one of the gated sub-directories, or registering this module opens ' +
      'nothing and the contract stays ungenerated while its consumers name it',
    ).toBe(true);
    expect(
      mcpContractIsGenerated(),
      'the shipped registry must now OPEN the contract gate — the Jira mechanics name the ' +
      'tool-call contract, so a shut gate ships ten references pointing at a file nobody has',
    ).toBe(true);
    expect(generatedReferenceManifest()).toContain('tracker/_mcp.md');
    for (const op of TRACKER_OPS) {
      expect(generatedReferenceManifest(), `${jiraRel(op)} must be in the install manifest`)
        .toContain(jiraRel(op));
    }
  });

  it('the roster is long enough for the parity assertions below to discriminate', () => {
    expect(
      TRACKER_OPS.length,
      `only ${TRACKER_OPS.length} op(s) — a roster short enough to enumerate by hand is ` +
      `satisfied by any implementation that returns something (GAP-42)`,
    ).toBeGreaterThanOrEqual(MIN_VARIANT_PAIRS);
  });
});

// ---------------------------------------------------------------------------
// 2. Define-set parity — both directions, every define non-empty
// ---------------------------------------------------------------------------

/**
 * Named collector: the `@define NAME():` names a reference module declares.
 *
 * Anchored at column 0 because a `@define` inside a fence is sample text, and
 * bounded to the identifier charset the build's own parser accepts.
 */
export function collectDefineNames(source: string): string[] {
  return [...source.matchAll(/^@define ([A-Za-z_][A-Za-z0-9_]*)\(\):/gm)].map(m => m[1]);
}

/**
 * Named collector: each define's body, keyed by name.
 *
 * A body runs from the line after its `@define` to the matching column-0 `@end`.
 * Returned so emptiness is a property of the body rather than of the file.
 */
export function collectDefineBodies(source: string): Map<string, string> {
  const bodies = new Map<string, string>();
  const lines = source.split('\n');
  let current: string | null = null;
  let buffer: string[] = [];
  for (const line of lines) {
    const open = /^@define ([A-Za-z_][A-Za-z0-9_]*)\(\):/.exec(line);
    if (open !== null) {
      current = open[1];
      buffer = [];
      continue;
    }
    if (line === '@end' && current !== null) {
      bodies.set(current, buffer.join('\n'));
      current = null;
      continue;
    }
    if (current !== null) buffer.push(line);
  }
  return bodies;
}

/**
 * The floor a define's body must clear, shared with the generated-reference floor.
 *
 * Read from the containment suite's constant rather than re-spelled: the two
 * measure the same thing one step apart — a define that kept its heading and lost
 * its body compiles into exactly the reference that floor exists to catch.
 */
const MIN_DEFINE_CHARS = 80;

/** A registered provider module: the sub-directory it is registered for, and its source. */
interface ProviderModule {
  readonly name: string;
  readonly source: string;
}

/**
 * One registered provider, named rather than assumed.
 *
 * A miss is a registry change and is raised as one: `find(...)!` would hand the
 * arm below an `undefined` that surfaces as "cannot read properties of undefined"
 * somewhere downstream instead of naming the provider that left the registry.
 */
function requireProvider(providers: readonly ProviderModule[], name: string): ProviderModule {
  const found = providers.find(p => p.name === name);
  if (found === undefined) {
    throw new Error(
      `\`${name}\` is not a registered provider module (registered: ` +
      `${providers.map(p => p.name).join(', ')}) — this arm has no subject`,
    );
  }
  return found;
}

/**
 * The floor a cell's mechanics claim must clear.
 *
 * `**Mechanics held here:**` is a header EVERY define carries, so its presence is
 * boilerplate and decides nothing about the cell beneath it. What §14.4 asks for is
 * the sentence after the header: a cell whose header runs straight into nothing is
 * the blank the rule forbids, wearing a filled cell's heading.
 */
const MIN_MECHANICS_CLAIM_CHARS = 40;

/** A define body's mechanics claim — the text after the header, on the header's own line. */
const MECHANICS_CLAIM_RE = /^\*\*Mechanics held here:\*\*(.*)$/m;

/**
 * Named collector: the instruction lines under a define's `### Process` heading.
 *
 * Numbered steps and bullets both count — `create-release` holds a fragment of the
 * operation's step 5 and states it as bullets — and the heading itself never does:
 * a `### Process` with nothing under it is the other half of a blank cell.
 */
export function collectProcessInstructions(body: string): string[] {
  const instructions: string[] = [];
  let inProcess = false;
  for (const line of body.split('\n')) {
    if (/^### /.test(line)) {
      inProcess = /^### Process\b/.test(line);
      continue;
    }
    if (inProcess && /^\s*(?:\d+[a-z]?\.|[-*])\s/.test(line)) instructions.push(line.trim());
  }
  return instructions;
}

/** A §14.4 cell whose capability the artifact fixes as undefined for one provider. */
interface KnownUndefinedCell {
  readonly op: string;
  readonly provider: string;
  readonly capability: string;
}

/**
 * §14.4's known-undefined cells, as data.
 *
 * Every other cell of the op × provider matrix is `supported` and owes its
 * mechanics. A cell listed here owes the instantiated
 * `DEGRADED (unsupported by {provider})` literal instead, so no module can quietly
 * claim a capability §14.4 fixes as absent.
 *
 * §14.4's other known-undefined cell is `transition` on GitHub, and it has no row
 * here because the GitHub module declares no transition step at all: there is no
 * cell body that would carry the literal, and a row over nothing grades nothing.
 */
const KNOWN_UNDEFINED_CELLS: readonly KnownUndefinedCell[] = [
  { op: 'gather-release-evidence', provider: 'jira', capability: 'closing_refs_for_commit' },
  { op: 'gather-release-evidence', provider: 'linear', capability: 'closing_refs_for_commit' },
];

/**
 * Named collector: §14.4 matrix cells that answer nothing.
 *
 * One pass over the op ROSTER, so a cell is reported when its define is missing as
 * well as when its define says nothing. What each cell owes is read from
 * `KNOWN_UNDEFINED_CELLS` and not from what the body happens to contain: a
 * predicate satisfied by a header every define carries decides no cell at all, and
 * one that infers `supported` from the ABSENCE of a DEGRADED literal lets a
 * provider drop the literal and stay green (PF-018, PF-064).
 */
export function collectBlankMatrixCells(provider: string, source: string): string[] {
  const blanks: string[] = [];
  const bodies = collectDefineBodies(source);
  for (const op of TRACKER_OPS) {
    const define = op.replace(/-/g, '_');
    const body = bodies.get(define);
    if (body === undefined) {
      blanks.push(`${provider}/${op}: no \`@define ${define}()\` — the cell has no body at all`);
      continue;
    }
    const claim = (MECHANICS_CLAIM_RE.exec(body)?.[1] ?? '').trim();
    if (claim.length < MIN_MECHANICS_CLAIM_CHARS) {
      blanks.push(
        `${provider}/${op}: ${claim.length} ch behind the mechanics header, floor ` +
        `${MIN_MECHANICS_CLAIM_CHARS} — a header with nothing behind it answers nothing`,
      );
    }
    const undefinedCell = KNOWN_UNDEFINED_CELLS.find(c => c.op === op && c.provider === provider);
    if (undefinedCell !== undefined) {
      if (!body.includes(`DEGRADED (unsupported by ${provider})`)) {
        blanks.push(
          `${provider}/${op}: §14.4 fixes \`${undefinedCell.capability}\` as undefined here, so ` +
          `the cell owes \`DEGRADED (unsupported by ${provider})\` and never names it`,
        );
      }
      continue;
    }
    if (collectProcessInstructions(body).length === 0) {
      blanks.push(
        `${provider}/${op}: \`### Process\` holds no step — the cell claims to hold this op's ` +
        `mechanics and holds a heading`,
      );
    }
  }
  return blanks;
}

/**
 * The defines a provider module may declare BESIDES its ten operation sections.
 *
 * A REGISTRY, not a relaxation (ADR-025). The roster arm below still asserts the
 * operation defines are exactly the op roster; this table is asserted in both
 * directions beside it, so a provider that declares a define listed here for
 * another provider is reported, and one that drops a define this table gives it
 * is reported too. A define in neither list falls into the operation partition
 * and the roster arm reports it — which is what keeps the widening to exactly the
 * rows written here.
 *
 * `comment_cap` is deliberately not owned by every provider. It renders the
 * comment-body cap, which is a number per SINK rather than a shared constant, and
 * the two tool-call providers are the ones that render it from a define; the CLI
 * provider states its own inline, including inside a shell fence where an MDS
 * invocation would not expand at all.
 */
interface ModuleDefine {
  readonly name: string;
  /** The providers whose module declares it — exactly, in both directions. */
  readonly providers: readonly string[];
  /**
   * What the body must look like. A value define cannot clear MIN_DEFINE_CHARS,
   * whose subject is an operation section that kept its heading and lost its
   * body, so it is held to its own shape instead of to nothing.
   */
  readonly bodyShape: RegExp;
  readonly why: string;
}

const MODULE_DEFINES: readonly ModuleDefine[] = [
  {
    name: 'comment_cap',
    providers: ['jira', 'linear'],
    bodyShape: /^[1-9][0-9]{3,5}$/,
    why:
      'the comment-body cap. Written out at each site it is a value that can drift at one of ' +
      'them while every other site and a presence-only guard stay green, and the truncation ' +
      'floor derives from it — so the number has one owner per module and every site invokes it',
  },
];

/** The registered non-operation define names. */
const MODULE_DEFINE_NAMES = new Set(MODULE_DEFINES.map(d => d.name));

/** Named collector: the define names that stand for an OPERATION section. */
export function collectOpDefineNames(source: string): string[] {
  return collectDefineNames(source).filter(name => !MODULE_DEFINE_NAMES.has(name));
}

/** Named collector: the registered non-operation define names a module declares. */
export function collectModuleDefineNames(source: string): string[] {
  return collectDefineNames(source).filter(name => MODULE_DEFINE_NAMES.has(name));
}

describe('cross-provider define-set parity, both directions (AC-3.8, §8.11)', () => {
  /**
   * Every registered provider module, read from the registry rather than listed.
   *
   * Derived, so a provider registered later joins the scan by construction and
   * cannot ship with a define set nobody compared. The length assertion below is
   * what keeps the derivation honest in the other direction: §8.11 makes AC-3.8
   * non-vacuous at THREE providers, and a registry that lost one would otherwise
   * shrink the scan silently.
   */
  const PROVIDERS: readonly ProviderModule[] =
    VARIANT_MODULES
      .filter(mod => mod.kind === 'fanout' && mod.subdir.startsWith('tracker/'))
      .map(mod => ({
        name: mod.subdir.slice('tracker/'.length),
        source: readSource(mod.source),
      }));

  /** Every ordered pair of distinct providers — both directions, by construction. */
  const PAIRS = PROVIDERS.flatMap(a => PROVIDERS.filter(b => b.name !== a.name).map(b => [a, b] as const));

  it('the scan really holds three providers', () => {
    expect(
      PROVIDERS.length,
      'a one- or two-provider parity scan is what §8.11 calls vacuous (GAP-42): with one column ' +
      'it is satisfied by any module at all, and with two the "every provider agrees" claim is ' +
      'just one comparison wearing a plural. Three is where it starts discriminating',
    ).toBe(3);
    expect(
      PROVIDERS.map(p => p.name).sort(),
      'and the columns must be the registered providers, not a hand-listed set beside them',
    ).toEqual(['github', 'jira', 'linear']);
    for (const provider of PROVIDERS) {
      expect(provider.source.length, `${provider.name}: empty module source`).toBeGreaterThan(0);
    }
    expect(
      PAIRS.length,
      'the ordered-pair set must cover every direction between every pair (3 × 2 = 6)',
    ).toBe(PROVIDERS.length * (PROVIDERS.length - 1));
  });

  it('every define of every provider has a same-named define in every other (both directions)', () => {
    // One loop over ORDERED pairs replaces the two hand-written directions: with
    // three providers there are six directions, and writing them out would be six
    // places a message could drift. A define missing from one provider is an op
    // whose reference for that provider is a heading with no mechanics — which
    // reads downstream as `tracker mechanics unavailable` shipped as the normal
    // path — and a define only one provider declares is either a section marker
    // nobody emits or an operation one provider invented.
    const asymmetries: string[] = [];
    for (const [from, to] of PAIRS) {
      // Scoped to the OPERATION defines. A registered module define is compared
      // against its own row below instead, because `comment_cap` is owned by the
      // two tool-call providers on purpose and comparing it here would read that
      // deliberate ownership as an asymmetry.
      const toNames = new Set(collectOpDefineNames(to.source));
      for (const name of collectOpDefineNames(from.source)) {
        if (!toNames.has(name)) asymmetries.push(`${from.name} declares ${name}; ${to.name} does not`);
      }
    }
    expect(
      asymmetries,
      `define-set asymmetr(ies) between providers. Every provider row emits the same file set by ` +
      `construction, so a define one of them lacks is a file that ships with a heading and no ` +
      `body:\n  ${asymmetries.join('\n  ')}`,
    ).toEqual([]);
  });

  it('the define roster matches the op roster, so parity is over the real subject', () => {
    // Without this, every direction above is satisfiable by modules that agree
    // on a define set unrelated to the ops they are registered for.
    for (const provider of PROVIDERS) {
      const names = collectOpDefineNames(provider.source);
      expect(
        names.length,
        `${provider.name}: ${names.length} op define(s) for ${TRACKER_OPS.length} op(s)`,
      ).toBe(TRACKER_OPS.length);
      // The build's own mapping: `setup-task` ⇒ `setup_task()`. Asserted rather than
      // assumed, because the section markers and the defines are matched by the author.
      const expected = TRACKER_OPS.map(op => op.replace(/-/g, '_'));
      expect(
        [...names].sort(),
        `${provider.name}: the define names must be the op roster with hyphens as underscores`,
      ).toEqual([...expected].sort());
    }
  });

  it('every registered module define is declared by exactly the providers that own it', () => {
    // The other half of the partition. Without it the roster arm above would
    // silently admit any define whose name happens to be in MODULE_DEFINE_NAMES,
    // for any provider — the registry has to bind in both directions or it is a
    // hole with a comment beside it.
    expect(MODULE_DEFINES.length, 'an empty registry makes the partition a no-op (PF-018)')
      .toBeGreaterThan(0);
    const problems: string[] = [];
    for (const entry of MODULE_DEFINES) {
      expect(entry.why.trim().length, `${entry.name}: a row without a reason is a grep`)
        .toBeGreaterThan(0);
      expect(
        entry.providers.every(name => PROVIDERS.some(p => p.name === name)),
        `${entry.name} names a provider the registry does not carry`,
      ).toBe(true);
      for (const provider of PROVIDERS) {
        const declares = collectModuleDefineNames(provider.source).includes(entry.name);
        const owns = entry.providers.includes(provider.name);
        if (declares !== owns) {
          problems.push(`${provider.name}: ${declares ? 'declares' : 'does not declare'} ` +
            `${entry.name}, but the registry says it ${owns ? 'owns' : 'does not own'} it`);
        }
      }
      for (const provider of PROVIDERS.filter(p => entry.providers.includes(p.name))) {
        const body = (collectDefineBodies(provider.source).get(entry.name) ?? '').trim();
        if (!entry.bodyShape.test(body)) {
          problems.push(`${provider.name}/${entry.name}: body ${JSON.stringify(body)} does not ` +
            `match ${entry.bodyShape}`);
        }
      }
    }
    expect(
      problems,
      `module-define registry problem(s):\n  ${problems.join('\n  ')}`,
    ).toEqual([]);
  });

  it('every define in every module has a non-empty body', () => {
    const thin: string[] = [];
    for (const provider of PROVIDERS) {
      const bodies = collectDefineBodies(provider.source);
      // Operation defines only: the floor's subject is a section that kept its
      // heading and lost its body. A registered value define is held to its
      // declared shape by the arm above instead.
      for (const name of collectOpDefineNames(provider.source)) {
        const body = bodies.get(name) ?? '';
        if (body.trim().length < MIN_DEFINE_CHARS) {
          thin.push(`${provider.name}/${name}: ${body.trim().length} ch, floor ${MIN_DEFINE_CHARS}`);
        }
      }
    }
    expect(
      thin,
      `define(s) below the body floor. AC-3.8 pairs parity with non-emptiness for one reason: ` +
      `three modules can agree perfectly on a set of empty defines:\n  ${thin.join('\n  ')}`,
    ).toEqual([]);
  });

  it('every §14.4 matrix cell is filled — stated mechanics or the named DEGRADED, no blanks', () => {
    // AC-3.8's third clause. The matrix's ROWS are the ops (file-set parity,
    // structural) and its COLUMNS are the providers (define-set parity, asserted
    // above); what neither covers is the CELL — a define that exists, is long
    // enough, and still leaves the reader without an answer for its capability.
    // What each cell owes is DECLARED, in `KNOWN_UNDEFINED_CELLS`: a `supported`
    // cell owes a mechanics sentence and the steps behind it, and a known-undefined
    // cell owes `DEGRADED (unsupported by {provider})` by name.
    const blanks = PROVIDERS.flatMap(p => collectBlankMatrixCells(p.name, p.source));
    expect(
      blanks,
      `matrix cell(s) that neither state what the operation does on this provider nor name why ` +
      `it cannot. A blank cell is indistinguishable from an unasked question:\n  ` +
      blanks.join('\n  '),
    ).toEqual([]);
    // The declared cells must name a live column, or the DEGRADED arm grades nothing.
    const registered = new Set(PROVIDERS.map(p => p.name));
    expect(
      KNOWN_UNDEFINED_CELLS.filter(c => !registered.has(c.provider)),
      'a known-undefined cell naming an unregistered provider is an arm over no module',
    ).toEqual([]);
    expect(
      KNOWN_UNDEFINED_CELLS.filter(c => !TRACKER_OPS.some(op => op === c.op)),
      'and one naming an op outside the roster is an arm over no define',
    ).toEqual([]);
  });

  it('known-bad probe: the matrix collector reports a blanked claim, a stepless cell and a dropped DEGRADED', () => {
    // One seed per arm, each built inside this `it` from the shipped bytes, so no
    // committed file is touched to show red. Every arm above needs a seed of its
    // own: `**Mechanics held here:**` is a header every define carries, so a cell
    // predicate that merely looks for it is satisfied by boilerplate and decides no
    // cell at all, and nothing but a seeded module shows which arms still decide
    // something (PF-018, PF-064).
    const jira = requireProvider(PROVIDERS, 'jira');
    expect(
      collectBlankMatrixCells('jira', jira.source),
      'the collector must be silent on the shipped module, or the seeds prove nothing',
    ).toEqual([]);

    const blankClaim = jira.source.replace(MECHANICS_CLAIM_RE, '**Mechanics held here:**');
    expect(blankClaim, 'the claim-blanking seed must change the source').not.toBe(jira.source);
    expect(
      collectBlankMatrixCells('jira', blankClaim).filter(b => b.includes('behind the mechanics header')),
      'a header with nothing behind it must be reported',
    ).not.toEqual([]);

    const stepless = jira.source.replace(
      /^@define fetch_issue\(\):[\s\S]*?^@end$/m,
      define => define.replace(/^\s*(?:\d+[a-z]?\.|[-*])\s.*$/gm, ''),
    );
    expect(stepless, 'the step-stripping seed must change the source').not.toBe(jira.source);
    expect(
      collectBlankMatrixCells('jira', stepless).filter(b => b.startsWith('jira/fetch-issue:')),
      'a `### Process` heading with no step under it must be reported',
    ).not.toEqual([]);

    const supportClaimed = jira.source
      .split('DEGRADED (unsupported by jira)')
      .join('DEGRADED (a reason that is not the capability gap)');
    expect(supportClaimed, 'the DEGRADED-dropping seed must change the source').not.toBe(jira.source);
    expect(
      collectBlankMatrixCells('jira', supportClaimed)
        .filter(b => b.startsWith('jira/gather-release-evidence:')),
      'a known-undefined cell that stops naming its DEGRADED must be reported — this is the cell ' +
      'a module claiming support it does not have would leave behind',
    ).not.toEqual([]);
  });

  it('known-bad probe: the same collectors report a dropped and an emptied define', () => {
    // Drives both collectors over seeded modules. Without it, the empty-difference
    // assertions above are equally green for collectors that return nothing (PF-018).
    const jiraSource = requireProvider(PROVIDERS, 'jira').source;
    const githubSource = requireProvider(PROVIDERS, 'github').source;
    const dropped = jiraSource.replace(/^@define fetch_issue\(\):/m, '@define fetch_issue_renamed():');
    expect(dropped, 'the seed must actually change the source').not.toBe(jiraSource);
    const githubNames = new Set(collectOpDefineNames(githubSource));
    expect(
      collectOpDefineNames(dropped).filter(n => !githubNames.has(n)),
      'a renamed define must be reported in the jira→github direction',
    ).toEqual(['fetch_issue_renamed']);
    expect(
      collectOpDefineNames(githubSource).filter(n => !new Set(collectOpDefineNames(dropped)).has(n)),
      'and in the github→jira direction',
    ).toEqual(['fetch_issue']);

    // …and the partition itself is driven by a seed: a module define renamed out
    // of the registry must land in the OPERATION partition, where the roster arm
    // reports it, rather than disappearing between the two.
    const unregistered = jiraSource.replace('@define comment_cap():', '@define smuggled_cap():');
    expect(unregistered, 'the smuggling seed must change the source').not.toBe(jiraSource);
    expect(
      collectOpDefineNames(unregistered).filter(n => !TRACKER_OPS.map(o => o.replace(/-/g, '_')).includes(n)),
      'an unregistered non-op define must fall into the op partition, where the roster arm sees it',
    ).toEqual(['smuggled_cap']);

    const emptied = jiraSource.replace(
      /^@define manage_debt\(\):[\s\S]*?^@end$/m,
      '@define manage_debt():\n## Operation: manage-debt\n@end',
    );
    expect(emptied, 'the emptying seed must change the source').not.toBe(jiraSource);
    const body = collectDefineBodies(emptied).get('manage_debt') ?? '';
    expect(
      body.trim().length,
      'an emptied define must fall below the body floor, or the non-emptiness arm is inert',
    ).toBeLessThan(MIN_DEFINE_CHARS);
    expect(
      collectBlankMatrixCells('jira', emptied).filter(b => b.startsWith('jira/manage-debt:')),
      'and it must fall foul of the matrix-cell rule too — an emptied define answers nothing',
    ).not.toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 3. Generated-file shape — one file per op, anchored on line 1
// ---------------------------------------------------------------------------

describe('jira module: the generated per-op references', () => {
  it('every op has a generated Jira reference opening with its own anchor on line 1', () => {
    // The anchor is what `extractOpSectionFromCorpus` keys on. A Jira reference
    // titled anything else is invisible to every union-mode sink guard the moment
    // its mechanics matter.
    for (const op of TRACKER_OPS) {
      const content = readGenerated(jiraRel(op));
      expect(
        content.split('\n')[0],
        `${jiraRel(op)}: line 1 must be this op's anchor`,
      ).toBe(`## Operation: ${op}`);
      expect(content.length, `${jiraRel(op)} is thin`).toBeGreaterThanOrEqual(MIN_DEFINE_CHARS);
    }
  });

  it('every generated Jira reference says which provider and op it is loaded for', () => {
    // The GitHub references carry this sentence and the Git agent relies on it: the
    // single load instruction composes a path, and the file it lands on has to
    // confirm it is the right one before its steps interleave with the agent's.
    for (const op of TRACKER_OPS) {
      expect(
        readGenerated(jiraRel(op)),
        `${jiraRel(op)}: no load-condition sentence`,
      ).toContain(`the resolved tracker provider is \`jira\` and the operation is \`${op}\``);
    }
  });
});

// ---------------------------------------------------------------------------
// 4. Provider literals (AC-3.13)
// ---------------------------------------------------------------------------

/**
 * One pinned provider literal, with the reason it is a provider fact.
 *
 * `present: false` entries are the interesting half: they are GitHub's signals,
 * and a Jira module naming one has copied a backpressure model the provider does
 * not implement. Jira publishes no remaining-request count, so a pre-emptive rung
 * keyed on one would never fire and the reactive rung would look redundant.
 */
interface ProviderLiteral {
  readonly literal: string;
  readonly present: boolean;
  readonly why: string;
}

const JIRA_LITERALS: readonly ProviderLiteral[] = [
  {
    literal: '32767',
    present: true,
    why: 'Jira\'s comment body cap. The truncation floor derives from it, so an absent cap means ' +
      'the preservation order has no bound to preserve against',
  },
  {
    literal: 'Retry-After',
    present: true,
    why: 'Jira\'s only backpressure signal, and it is reactive: honoured verbatim, never ' +
      'shortened, STOP on 429',
  },
  {
    literal: '60000',
    present: false,
    why: 'GitHub\'s cap. §14.2 resolves GAP-13 by rendering the 60k sentence VERBATIM on the ' +
      'GitHub path and each other provider\'s own cap elsewhere — one number per provider',
  },
  {
    literal: 'X-RateLimit-Remaining',
    present: false,
    why: 'a pre-emptive remaining count Jira does not publish. A module naming it states a rung ' +
      'that can never engage, which reads as coverage and is none',
  },
];

/** Named collector: pinned literals whose presence in a text is wrong. */
export function collectLiteralViolations(
  label: string,
  text: string,
  literals: readonly ProviderLiteral[],
): string[] {
  return literals
    .filter(entry => text.includes(entry.literal) !== entry.present)
    .map(entry => `${label}: ${entry.present ? 'missing' : 'forbidden'} "${entry.literal}" — ${entry.why}`);
}

describe('jira module: provider literals (AC-3.13)', () => {
  const jiraSource = readSource(JIRA_MODULE);

  it('32767 and Retry-After are present; 60000 and X-RateLimit-Remaining are absent', () => {
    expect(
      collectLiteralViolations(JIRA_MODULE, jiraSource, JIRA_LITERALS),
      'provider literal violation(s) in the Jira module source',
    ).toEqual([]);
  });

  it('the same pins hold on the generated tree, not only on the source', () => {
    // A source-only pin is satisfied by a literal inside module-level prose, which
    // is emitted nowhere. The generated files are what a spawn reads.
    const generated = TRACKER_OPS.map(op => readGenerated(jiraRel(op))).join('\n');
    expect(
      collectLiteralViolations('tracker/jira/**', generated, JIRA_LITERALS),
      'provider literal violation(s) across the generated Jira references',
    ).toEqual([]);
  });

  it('known-bad probe: the same collector reports a swapped literal in both directions', () => {
    expect(
      collectLiteralViolations('seed', 'cap 60000 and Retry-After honoured', JIRA_LITERALS)
        .map(v => v.split(' — ')[0]),
      'a GitHub cap smuggled in, and the Jira cap dropped, must both be reported',
    ).toEqual([
      'seed: missing "32767" — Jira\'s comment body cap. The truncation floor derives from it, so an absent cap means the preservation order has no bound to preserve against',
      'seed: forbidden "60000"',
    ].map(v => v.split(' — ')[0]));
    expect(
      collectLiteralViolations('seed', 'cap 32767; X-RateLimit-Remaining < 10 stops the fan-out', JIRA_LITERALS)
        .map(v => v.split(': ')[1].split(' — ')[0]),
    ).toEqual(['missing "Retry-After"', 'forbidden "X-RateLimit-Remaining"']);
  });
});

// ---------------------------------------------------------------------------
// 5. [DR-08] The batch is ONE query — no per-item fetch verb
// ---------------------------------------------------------------------------

// The shape table and its collector live in tests/helpers.ts: the same claim is
// made per provider here and across every provider in
// tests/provider-literals.test.ts, and two copies of the table would be two
// authorities on what a per-item fetch looks like. The rationale for each shape
// travels with the table.

describe('jira module: fetch-issues-batch is one query [DR-08]', () => {
  const batch = readGenerated(jiraRel('fetch-issues-batch'));

  it('states the single filtered query, its bound, and the truncation report', () => {
    expect(batch, 'the batch must be ONE filtered query keyed on the resolved list')
      .toContain('key in (');
    expect(batch, 'a query with no result bound is an unbounded read').toContain('maxResults');
    expect(batch, 'the ≤50 bound §14.4 fixes for every provider').toContain('≤50');
    expect(batch, 'over the bound the remainder is reported, never silently dropped')
      .toContain('TRUNCATED ({n} not processed)');
  });

  it('names no per-item fetch verb and no single-key fetch capability', () => {
    expect(
      collectPerItemFetchVerbs(batch),
      'a per-item fetch inside the batch reference re-grows on Jira the exact N+1 Phase 2 removed ' +
      'from GitHub. AC-3.8\'s parity scan cannot see the difference between one query and fifty — ' +
      'it asserts the file exists and is non-empty — which is why this negative exists [DR-08]',
    ).toEqual([]);
  });

  it('known-bad probe: the same collector reports a seeded per-item batch', () => {
    // Mechanic (b): the seeded fixture §8.12 row 25 asks for, driven through the
    // collector the live assertion uses. Both classes are seeded, because a
    // collector covering one would pass this probe while inert against the other.
    const seededToolName = [
      '## Operation: fetch-issues-batch',
      '2. For each key in the resolved list, call getJiraIssue(issueKey) and collect the result.',
    ].join('\n');
    expect(
      collectPerItemFetchVerbs(seededToolName).map(v => v.split(': ')[1]),
      'a tool-name per-item fetch must be reported',
    ).toContain('getJiraIssue');

    const seededCapability = [
      '## Operation: fetch-issues-batch',
      '2. Resolve each entry through the *fetch by key* capability, one call per issue.',
    ].join('\n');
    expect(
      collectPerItemFetchVerbs(seededCapability).length,
      'a capability-phrased per-item fetch must be reported too — it is the shape this repo\'s ' +
      'own capability-first doctrine steers an author towards',
    ).toBeGreaterThan(0);

    expect(PER_ITEM_FETCH_SHAPES.length, 'the shape table is empty (PF-018)').toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 6. [DR-09] The per-op aggregate call budget, as a tested literal
// ---------------------------------------------------------------------------

/**
 * The per-op aggregate marker-call budget, pinned as a PRODUCT rather than as a
 * number [DR-09].
 *
 * Under GitHub one issue's marker check is one call. Under Jira it is a paged
 * comment listing filtered client-side, and rung 3 is the default landing rung —
 * so `backlink-shipped-issues`' ≤50 loop multiplies by the page bound and the
 * op-level cost is the product. Pinning only the total would let the page bound
 * double while the factors silently absorbed it; pinning only the factors would
 * let the product go unstated, which is the figure a reviewer needs.
 */
const AGGREGATE_BUDGET = {
  items: '≤50',
  pages: '≤2',
  product: '≤100',
} as const;

describe('jira module: the per-op aggregate call budget [DR-09]', () => {
  const backlink = readGenerated(jiraRel('backlink-shipped-issues'));

  it('backlink-shipped-issues states both factors AND the product', () => {
    expect(backlink, 'the per-op item bound').toContain(AGGREGATE_BUDGET.items);
    expect(backlink, 'the page bound on a paged marker scan').toContain(AGGREGATE_BUDGET.pages);
    expect(
      backlink,
      `the PRODUCT must be stated. ${AGGREGATE_BUDGET.items} items × ${AGGREGATE_BUDGET.pages} ` +
      `pages is an aggregate cost no per-call bound expresses, and it is the number that decides ` +
      `whether the op fits inside a provider's rate budget at all`,
    ).toContain(AGGREGATE_BUDGET.product);
    expect(
      backlink,
      'exceeding the budget is reported, never silently truncated',
    ).toContain('TRUNCATED ({n} not processed)');
  });

  it('the product is arithmetically what the factors say', () => {
    // The pin is only worth having while the three literals agree. A page bound
    // raised from ≤2 to ≤4 with the product left at ≤100 is the drift this catches.
    const num = (s: string): number => Number(s.replace('≤', ''));
    expect(
      num(AGGREGATE_BUDGET.items) * num(AGGREGATE_BUDGET.pages),
      'the stated product must equal the product of the stated factors',
    ).toBe(num(AGGREGATE_BUDGET.product));
  });

  it('prefers the hoisted single-pass shape over the per-item ladder', () => {
    // [DR-09]'s structural half: where the provider allows it, one bounded filtered
    // read over the resolved keys replaces the per-item marker scan entirely. The
    // budget is the ceiling for the path that cannot be hoisted, not a licence.
    expect(
      backlink,
      'the reference must state the hoisted alternative — a budget with no cheaper path beside ' +
      'it reads as an endorsement of the expensive one',
    ).toContain('hoist');
  });
});

// ---------------------------------------------------------------------------
// 7. (AC-3.14) find_marker: identity capability, first-line predicate, namespaces
// ---------------------------------------------------------------------------

/**
 * The three comment kinds and their marker namespaces (§14.4 `marker_format`).
 *
 * Namespaced per kind because a single global marker makes the three kinds
 * MUTUALLY SUPPRESS: a shipped-version back-link would satisfy the wave report's
 * dedup predicate and the wave report would never post (GAP-20).
 */
const MARKER_NAMESPACES: ReadonlyArray<{ readonly kind: string; readonly op: string }> = [
  { kind: 'devflow:shipped', op: 'backlink-shipped-issues' },
  { kind: 'devflow:wave', op: 'post-wave-report' },
  { kind: 'devflow:traceability', op: 'ensure-traceable-issue' },
];

describe('jira module: marker dedup (AC-3.14, GAP-20)', () => {
  it('each comment kind carries its own namespace, in the op that posts it', () => {
    for (const { kind, op } of MARKER_NAMESPACES) {
      expect(
        readGenerated(jiraRel(op)),
        `${jiraRel(op)}: must own the ${kind} marker namespace`,
      ).toContain(kind);
    }
    expect(MARKER_NAMESPACES.length, 'the namespace table is empty (PF-018)').toBe(3);
  });

  it('no marker namespace leaks into an op that does not own it', () => {
    // The mutual-suppression failure, stated as a negative: if two ops name one
    // namespace, one of them is deduplicating against the other's comments.
    const leaks: string[] = [];
    for (const { kind, op } of MARKER_NAMESPACES) {
      for (const other of TRACKER_OPS) {
        if (other === op) continue;
        if (readGenerated(jiraRel(other)).includes(kind)) leaks.push(`${jiraRel(other)}: ${kind}`);
      }
    }
    expect(
      leaks,
      `a marker namespace named outside its owning operation. The operation owns the marker and ` +
      `callers pass inputs only; a second namer is the caller-restated literal that already ` +
      `diverged once and produced duplicate comments:\n  ${leaks.join('\n  ')}`,
    ).toEqual([]);
  });

  it('the marker predicate names the identity capability AND binds to the first line', () => {
    const backlink = readGenerated(jiraRel('backlink-shipped-issues'));
    expect(
      backlink,
      'the dedup predicate must name the capability it filters authors by — an unfiltered marker ' +
      'scan lets a third party suppress the post by quoting the marker',
    ).toContain('identify current user');
    expect(
      backlink,
      'and it must bind the marker to the comment\'s FIRST line: a marker at line 5 of a ' +
      'third-party comment is quoted prose, not a devflow post',
    ).toMatch(/first[- ]line/i);
  });

  it('a marker below the first line does not suppress — stated, not implied', () => {
    // AC-3.14's own wording. The rule has to be written down: an author reading
    // "check for the marker" writes a substring search, and a substring search is
    // exactly what makes a quoted marker suppressive.
    const backlink = readGenerated(jiraRel('backlink-shipped-issues'));
    expect(
      backlink,
      'the reference must state that a marker anywhere but line 1 does NOT suppress',
    ).toMatch(/does not suppress|never suppress/i);
  });
});

// ---------------------------------------------------------------------------
// 8. (AC-3.4) SHIPPED_ISSUES under jira never yields COMPLETE
// ---------------------------------------------------------------------------

describe('jira module: a dropped or unresolvable ref never reports COMPLETE (AC-3.4)', () => {
  it('backlink-shipped-issues instantiates the ref pre-flight with the anchored grammar', () => {
    const backlink = readGenerated(jiraRel('backlink-shipped-issues'));
    expect(
      backlink,
      'the anchored per-provider grammar, never an alternation without anchors (§14.1)',
    ).toContain('^[A-Z][A-Z0-9_]{1,9}-[1-9][0-9]{0,8}$');
    // The anchor's READING, not just its presence. This grammar ships into a
    // prompt and is applied through `grep -E`, Python or by eye, and in those
    // contexts `$` matches before a trailing newline — so a ref carrying one
    // satisfies the gate and reaches a query. The Linear suite drives the payload
    // table that proves the divergence; this pins the clause on the Jira side.
    expect(
      backlink,
      'the anchor must be stated as binding the whole STRING, or a ref with a trailing newline ' +
      'passes the pre-flight under the reading the agent actually applies',
    ).toContain('anchored at both ends of the STRING (a newline fails it)');
    expect(
      backlink,
      'every ref dropped by the pre-flight ⇒ the aggregate reason [DR-04(c)]',
    ).toContain('TRACEABILITY: DEGRADED (no parseable refs for provider {p})');
    expect(
      backlink,
      'AC-3.4: the always-loaded entry gate defers to the resolved provider\'s anchored reference ' +
      'grammar, and `PROJ-1 PROJ-2` satisfies the github grammar under no reading — so under jira ' +
      'the pre-flight either resolves them here or drops them, and a run that dropped every entry ' +
      'must never report COMPLETE. A green COMPLETE over zero processed issues is the report a ' +
      'release believes',
    ).toContain('never report the status as `COMPLETE`');
  });

  it('gather-release-evidence cannot report COMPLETE either — closing refs are unsupported', () => {
    const evidence = readGenerated(jiraRel('gather-release-evidence'));
    expect(
      evidence,
      '§14.4 fixes closing_refs_for_commit as unsupported on Jira; the cell is DEGRADED, not blank',
    ).toContain('TRACEABILITY: DEGRADED (unsupported by jira)');
    expect(
      evidence,
      'an enrichment that could not resolve its closing refs is PARTIAL, never COMPLETE',
    ).toContain('never report the status as `COMPLETE`');
  });
});

// ---------------------------------------------------------------------------
// 9. (AC-3.18, §14.9-2) No HTTP fallback anywhere in the Jira mechanics
// ---------------------------------------------------------------------------

/**
 * The transports a Jira mechanics file may never reach for.
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
  /\$\{?(?:JIRA|ATLASSIAN)_[A-Z_]*(?:TOKEN|KEY|SECRET|PASSWORD)/,
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

describe('jira module: tool calls only — no HTTP, no CLI, no credential read (AC-3.18)', () => {
  it('no generated Jira reference constructs a request or names a credential', () => {
    const offenders: string[] = [];
    for (const op of TRACKER_OPS) {
      for (const site of collectForbiddenTransports(readGenerated(jiraRel(op)))) {
        offenders.push(`${jiraRel(op)}:${site}`);
      }
    }
    expect(
      offenders,
      `a Jira mechanics file reaches the tracker other than through a tool call. §14.9-2 is ` +
      `absolute: never construct an HTTP request, never run a command-line client, never read a ` +
      `tracker credential from the environment:\n  ${offenders.join('\n  ')}`,
    ).toEqual([]);
  });

  it('known-bad probe: the same collector reports each forbidden transport', () => {
    for (const seeded of [
      'curl -H "Authorization: Bearer $JIRA_API_TOKEN" https://site/rest/api/3/issue',
      'wget -qO- https://site/rest/api/3/search',
      'gh issue comment 12 --body-file "$DEVFLOW_BODY"',
      'export TOKEN=$JIRA_API_TOKEN',
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
// 10. JQL safety, the rendering rules, and the contract invocation
// ---------------------------------------------------------------------------

describe('jira module: query safety and the cross-cutting rules it invokes', () => {
  // REPOINTED, per-literal, when `### Query safety` moved into the shared
  // authoring module `_mcp.mds` (ADR-025): the rule is no longer text this
  // module's source spells, so the source is no longer where it can be read. It
  // is read where it is GUARANTEED to appear instead — the one operation that
  // composes a query, in this provider's emitted mechanics — which is also the
  // side a spawn reads, and the side the sibling arm below already reads.
  const querySafety = unescapeMds(readGenerated(jiraRel('ensure-traceable-issue')));

  it('structured filter arguments are preferred and a built query is value-quoted only', () => {
    expect(querySafety, 'structured filter arguments first (§14.9-10)')
      .toContain('structured filter argument');
    expect(
      querySafety,
      'a value may only ever reach a query as a quoted string literal — never in field, ' +
      'operator or ordering position, which is where a quote break becomes a different query',
    ).toContain('quoted string literal');
    expect(querySafety, 'escape order is part of the rule: backslash first, then quote')
      .toContain('Escape `\\` first and then `"`');
    expect(
      querySafety,
      'and anything still carrying a metacharacter after escaping is DROPPED, never repaired',
    ).toMatch(/drop|reject/i);
  });

  it('render_collapsed_block degrades to a pointer sentence, with the preservation order', () => {
    const traceable = readGenerated(jiraRel('ensure-traceable-issue'));
    expect(
      traceable,
      'the document format has no comment node and no collapsed-block analogue, so the collapsed ' +
      'artifact comment becomes a pointer sentence rather than a silently flattened dump',
    ).toContain('pointer sentence');
    expect(
      traceable,
      'and the preservation order says WHICH bytes survive a truncation: the marker, then the ' +
      'status lines, then the pointer — the untrusted middle is what gets cut',
    ).toContain('32767');
  });

  it('every posting mechanic invokes the tool-call contract by name, never restates it', () => {
    // The load chain is one-directional: a per-op file may INVOKE a rule in the
    // contract and never restate its substance. Naming the file is the invocation.
    const namers: string[] = [];
    for (const op of TRACKER_OPS) {
      const content = readGenerated(jiraRel(op));
      if (!content.includes('{SCRUBBED_BODY}')) continue;
      namers.push(jiraRel(op));
      expect(
        content,
        `${jiraRel(op)}: a posting mechanic must name the contract that governs it`,
      ).toContain('references/tracker/_mcp.md');
    }
    expect(
      namers.length,
      'no Jira reference spells the gated body placeholder — either no op posts (and AC-3.5\'s ' +
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
// renders a `key`, so its branch token is `KEY` (§14.1).
//
// All three AC-3.3 clauses shipped as prose in this module with no test
// containing any of the three strings, so the criterion rested on nobody
// condensing the paragraph away. AC-3.11's branch shape is here for the opposite
// reason: the always-loaded agent deliberately does NOT restate it, so this file
// is its only statement and its only possible pin.

const JIRA_VOCABULARY: ProviderRefVocabulary = {
  refToken: 'KEY',
  refNoun: 'key',
};

/** Every generated op file of this provider, concatenated. */
function jiraTree(): string {
  return TRACKER_OPS.map(op => readGenerated(jiraRel(op))).join('\n');
}

/** The shipped Jira corpus, read through this file's own fail-loud reader. */
const JIRA_CORPUS: ProviderCorpus = {
  label: JIRA_SUBDIR,
  vocab: JIRA_VOCABULARY,
  read: op => readGenerated(jiraRel(op)),
  tree: jiraTree,
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
      `${JIRA_SUBDIR}: no pre-read reference for op \`${op}\` — this probe's corpus is keyed by ` +
      `TRACKER_OPS, so a claim naming an op outside the roster reaches nothing`,
    );
  }
  return text;
}

describe('jira module: the clauses AC-3.3, AC-3.11 and §14.3 fix here', () => {
  for (const criterion of ['AC-3.3', 'AC-3.11', '\u00a714.3']) {
    it(`states every ${criterion} clause its mechanics own`, () => {
      const claims = TOOL_CALL_MECHANICS_CLAIMS.filter(c => c.criterion === criterion);
      expect(
        claims.length,
        `no claim carries criterion ${criterion} — the arm ranges over nothing (PF-018)`,
      ).toBeGreaterThan(0);
      const missing = collectMissingMechanicsClaims(JIRA_CORPUS, claims);
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
      TRACKER_OPS.map(op => [op, readGenerated(jiraRel(op))]),
    );
    const tree = (): string => [...pristine.values()].join('\n');
    expect(
      collectMissingMechanicsClaims(
        { label: 'pristine', vocab: JIRA_VOCABULARY, read: op => readFromCorpus(pristine, op), tree },
        TOOL_CALL_MECHANICS_CLAIMS,
      ),
      'the collector must be silent on the shipped mechanics, or the probe proves nothing',
    ).toEqual([]);

    for (const claim of TOOL_CALL_MECHANICS_CLAIMS) {
      const pattern = claim.pattern(JIRA_VOCABULARY);
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
          vocab: JIRA_VOCABULARY,
          read: op => readFromCorpus(wounded, op),
          tree: () => [...wounded.values()].join('\n'),
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
