/**
 * The `~/.devflow/tracker.md` schema, read from BOTH sides (P3a-S14, GAP-17).
 *
 * The schema has a WRITER — the Tracker agent's embedded template (3a-2) — and a
 * READER — the Git-agent preamble's `## Tracker input contract` block (3a-4).
 * They were authored by two sequential Code agents in two different commits, and
 * a prose handoff between two agents is exactly the mechanism a seam test exists
 * to replace. Twelve section names across two prompt files is a drift surface,
 * and the failure is silent in the worst possible direction: a heading the reader
 * does not know about degrades to that section's NEUTRAL DEFAULT rather than to
 * DEGRADED, so the agent proceeds confidently on a value nobody wrote.
 *
 * FIVE CLAIMS, each able to fail on its own (PF-064):
 *   1. SCHEMA TABLE — every section has a scope and an absent⇒default, no blank
 *      cells, read out of the agent's own table.
 *   2. HEADINGS, BOTH DIRECTIONS [DR-21] — writer ↔ reader set equality with a
 *      distinct why-message per direction, and `>= 11` sections so neither
 *      direction is vacuous.
 *   3. ADR-007 THREE-WAY SWEEP (AC-3.16) — the configuration file is read in
 *      exactly ONE place. No op section, no generated reference, no command
 *      source and no `dist/commands/*.md` reads it.
 *   4. NO CREDENTIAL, NO HTTP (AC-3.18) — no `curl`, `wget`, `Authorization:` or
 *      token-env read anywhere in `git.md ∪ generated references`.
 *   5. THE DEGRADED LITERAL REGISTRY, BOTH DIRECTIONS [DR-04] — §14.2's table
 *      pinned as a literal array, every live row emitted by a named site, no
 *      un-registered `DEGRADED (` in a generated reference, and every retired
 *      synonym absent.
 *
 * Both halves of claim 2 bind to `TRACKER_SCHEMA_SECTIONS` in tests/helpers.ts
 * rather than to each other. A two-sided equality test cannot catch drift in its
 * own oracle: if the reader and the writer both lost a heading, they would agree.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import * as path from 'path';

import { agentsDir, commandsDir, compiledSkillRefsDir, skillsDir } from '../../src/core/assets.js';
import { TRACKER_GITHUB_OPS, VARIANT_MODULES } from '../../src/core/mds-variants.js';
import {
  ROOT,
  TRACKER_SCHEMA_SECTIONS,
  collectTrackerSchemaRows,
  collectTrackerTemplate,
  collectTrackerTemplateHeadings,
  gitAgentSinkCorpus,
  resolveAgentSource,
  walkFiles,
  type CorpusEntry,
} from '../helpers.js';

// ---------------------------------------------------------------------------
// Corpora
// ---------------------------------------------------------------------------

const GIT_AGENT = resolveAgentSource('git');
const GIT_MD = GIT_AGENT.content;

/** The Tracker agent — the WRITER side. Fail-loud; never a skip. */
function trackerAgent(): string {
  const p = path.join(agentsDir(ROOT), 'tracker.md');
  if (!existsSync(p)) {
    throw new Error(
      `${p} is absent — the writer half of the schema is the Tracker agent's template (3a-2). ` +
      `Without it this file asserts one side of a two-sided contract.`,
    );
  }
  return readFileSync(p, 'utf-8');
}

const PREAMBLE_CONTRACT_HEADING = '## Tracker input contract';

/**
 * The READER side: the `## Tracker input contract` block of the compiled agent.
 *
 * Sliced to the next column-0 `## `, which is the same boundary rule every
 * union-mode guard uses. Throws rather than returning '' — an empty reader block
 * would make direction 1 of the heading test report every section as missing and
 * direction 2 report none, which reads as a writer problem.
 */
function preambleContractBlock(content: string = GIT_MD): string {
  const start = content.indexOf(PREAMBLE_CONTRACT_HEADING);
  if (start === -1) {
    throw new Error(
      `'${PREAMBLE_CONTRACT_HEADING}' not found in ${GIT_AGENT.path} — the reader half of the ` +
      `schema is missing or was renamed (P3a-S14).`,
    );
  }
  const rest = content.slice(start + PREAMBLE_CONTRACT_HEADING.length);
  const next = rest.search(/^## /m);
  return next === -1 ? rest : rest.slice(0, next);
}

/** Command sources (`.mds` + the hand-authored `.md`) and their compiled artifacts. */
function commandCorpus(): CorpusEntry[] {
  const corpus: CorpusEntry[] = [];
  for (const [label, dir] of [
    ['src/assets/commands', commandsDir()],
    ['dist/commands', path.join(ROOT, 'dist', 'commands')],
  ] as const) {
    for (const file of walkFiles(dir, f => f.endsWith('.md') || f.endsWith('.mds'))) {
      corpus.push({ path: `${label}/${path.relative(dir, file)}`, content: readFileSync(file, 'utf-8') });
    }
  }
  return corpus;
}

// ---------------------------------------------------------------------------
// 1. The schema table — no blank cells, one row per value-bearing field
// ---------------------------------------------------------------------------

describe('schema table: every section has a scope and a documented absent⇒default', () => {
  const rows = collectTrackerSchemaRows(trackerAgent());

  it('the table is parsed and covers every schema section (non-vacuity first)', () => {
    expect(
      rows.length,
      'the agent\'s schema table parsed to zero rows — every assertion below would be vacuous. ' +
      'The row shape is `| `## Section` | scope | absent ⇒ | shape gate |` (PF-018).',
    ).toBeGreaterThanOrEqual(TRACKER_SCHEMA_SECTIONS.length);

    // `## Project` carries TWO values (site and key), so the table has one row per
    // value-bearing FIELD while TRACKER_SCHEMA_SECTIONS has one entry per HEADING:
    // the agent spells those two rows `## Project → site` and `## Project → key`.
    // Both the `→` and the `—` field suffix are stripped, so the comparison is
    // heading-to-heading and a renamed FIELD does not read as a missing SECTION.
    const sectioned = rows.map(r => r.section.replace(/`/g, '').replace(/\s*[—→].*$/, '').trim());
    for (const heading of TRACKER_SCHEMA_SECTIONS) {
      if (heading === '### Substitutions') continue; // report-only; written, never read
      expect(sectioned, `${heading} has no row in the schema table`).toContain(heading);
    }
  });

  it('no cell is blank — a blank scope or default is an unanswered question, not a default', () => {
    const blanks: string[] = [];
    for (const row of rows) {
      for (const [cell, value] of Object.entries(row)) {
        if (value.trim() === '' || value.trim() === '—') blanks.push(`${row.section}: ${cell}`);
      }
    }
    expect(
      blanks,
      'GAP-17: four sections originally had no stated default. A blank cell reads as "whatever the ' +
      'agent decides", which is precisely the silent-authority failure the sentinel rule exists ' +
      `to prevent:\n  ${blanks.join('\n  ')}`,
    ).toEqual([]);
  });

  it('every scope cell commits to global-safe or repo-derived', () => {
    // The scope decides whether a value may be reused across repositories at all.
    // A row that does not say is a row whose value could leak a Jira project key
    // from one repo into another's issue creation.
    const unscoped = rows
      .filter(r => !/global[- ]safe|repo[- ]derived|report only/i.test(r.scope))
      .map(r => `${r.section}: "${r.scope}"`);
    expect(
      unscoped,
      `scope cell(s) that commit to neither global-safe nor repo-derived:\n  ${unscoped.join('\n  ')}`,
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 2. [DR-21] The two-sided heading test
// ---------------------------------------------------------------------------

/**
 * Named collector: the schema headings the READER block names.
 *
 * Backticked `## `/`### ` tokens only. The block also spells `**Mechanics:**`,
 * DEGRADED reasons and a shape gate in backticks, so matching every code span
 * would report those as headings and the test would fail for a reason that is not
 * a drift.
 */
export function collectContractHeadings(block: string): string[] {
  return [...block.matchAll(/`(#{2,3} [^`]+?)`/g)].map(m => m[1].trim());
}

describe('[DR-21] writer ↔ reader heading equality, both directions', () => {
  const writerHeadings = (() => {
    const template = collectTrackerTemplate(trackerAgent());
    expect(
      template,
      'the Tracker agent\'s tagged template fence was not found — addressed by its info string, ' +
      'so a renamed fence tag fails here rather than silently matching another fence',
    ).not.toBeNull();
    return collectTrackerTemplateHeadings(template!);
  })();
  const readerHeadings = collectContractHeadings(preambleContractBlock());

  it('non-vacuity: both sides carry at least 11 sections', () => {
    // The floor is what makes the two directions below discriminating: two empty
    // sets are equal, and a collector that returned nothing would agree with
    // another collector that returned nothing.
    expect(
      TRACKER_SCHEMA_SECTIONS.length,
      'the shared oracle lists fewer than 11 sections — §14.3 fixes eleven',
    ).toBeGreaterThanOrEqual(11);
    expect(
      writerHeadings.length,
      `the WRITER template lists ${writerHeadings.length} heading(s); at least ` +
      `${TRACKER_SCHEMA_SECTIONS.length} are required`,
    ).toBeGreaterThanOrEqual(TRACKER_SCHEMA_SECTIONS.length);
    expect(
      readerHeadings.length,
      `the READER contract block names ${readerHeadings.length} heading(s); at least ` +
      `${TRACKER_SCHEMA_SECTIONS.length} are required`,
    ).toBeGreaterThanOrEqual(TRACKER_SCHEMA_SECTIONS.length);
  });

  it('direction 1: every heading the WRITER emits is named by the READER', () => {
    const unread = writerHeadings.filter(h => !readerHeadings.includes(h));
    expect(
      unread,
      `the Tracker agent writes section(s) the Git-agent preamble never names, so nothing reads ` +
      `them. This is the SILENT direction: an unnamed section degrades to its neutral default ` +
      `instead of to DEGRADED, and the agent proceeds on a value no reader ever consulted:\n  ` +
      unread.join('\n  '),
    ).toEqual([]);
  });

  it('direction 2: every heading the READER names is emitted by the WRITER', () => {
    const unwritten = readerHeadings.filter(h => !writerHeadings.includes(h));
    expect(
      unwritten,
      `the Git-agent preamble names section(s) the Tracker agent never writes, so the reader's ` +
      `absent⇒default arm fires on every run for a section that CANNOT exist. A default taken ` +
      `unconditionally is not a default, it is a hardcoded value with a comment:\n  ` +
      unwritten.join('\n  '),
    ).toEqual([]);
  });

  it('both sides agree with the SHARED oracle, not merely with each other', () => {
    // The arm the two directions above cannot provide. If a heading were dropped
    // from both files in one commit they would still be set-equal, and the schema
    // would have silently shrunk. TRACKER_SCHEMA_SECTIONS is the third party.
    expect(new Set(writerHeadings)).toEqual(expect.objectContaining({}));
    for (const heading of TRACKER_SCHEMA_SECTIONS) {
      expect(writerHeadings, `the writer template must emit ${heading}`).toContain(heading);
      expect(readerHeadings, `the reader contract must name ${heading}`).toContain(heading);
    }
  });

  it('the reader states the absent⇒default rule AND the sentinel rule as different outcomes', () => {
    const block = preambleContractBlock();
    expect(
      block,
      'an absent section must take its documented neutral default',
    ).toMatch(/absent ⇒|absent\b[^.]*default/);
    expect(
      block,
      'a consumed section holding the sentinel must DEGRADE. Absent and sentinel are different ' +
      'outcomes: a default is safe exactly where the field was never needed, and unsafe where the ' +
      'writer looked and could not tell (EC-79)',
    ).toContain('# UNRESOLVED:');
    expect(
      block,
      'and the sentinel must never be shape-validated as though it were a value',
    ).toMatch(/never\s+\*\*shape-validated|never shape-validated/);
  });

  it('known-bad probe: each collector reports a heading renamed on its own side', () => {
    // Drives BOTH collectors over seeded text, so a collector that stopped
    // returning headings fails here rather than making the two directions above
    // agree about nothing.
    const seededWriter = collectTrackerTemplateHeadings('## Project\n## Renamed Types\n');
    expect(seededWriter).toEqual(['## Project', '## Renamed Types']);
    const seededReader = collectContractHeadings('reads `## Project` and `## Renamed Types` only');
    expect(seededReader).toEqual(['## Project', '## Renamed Types']);
    // …and neither mistakes an ordinary code span for a heading.
    expect(collectContractHeadings('the `**Mechanics:**` pointer and `$ARGUMENTS`')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 3. AC-3.16 — the three-way ADR-007 sweep: ONE reader, enumerated by name
// ---------------------------------------------------------------------------

/**
 * Named collector: sites that name the tracker configuration file.
 *
 * `tracker\.md(?![a-z])` is not fussiness — `_tracker.mds` (the command partial,
 * imported by five command hosts) CONTAINS the substring `tracker.md`, so a bare
 * match reports every one of those imports and the guard would be permanently red
 * for a reason that has nothing to do with reading the file.
 */
export function collectTrackerFileReaders(corpus: readonly CorpusEntry[]): string[] {
  const sites: string[] = [];
  for (const entry of corpus) {
    for (const [i, line] of entry.content.split('\n').entries()) {
      if (/tracker\.md(?![a-z])/.test(line)) {
        sites.push(`${entry.path}:${i + 1}: ${line.trim().slice(0, 100)}`);
      }
    }
  }
  return sites;
}

describe('AC-3.16: the tracker configuration file has exactly ONE reader', () => {
  it('positive arm: the Git-agent preamble names it, with an absolute-path Read', () => {
    // The sweep below is an absence. Without this arm it would be satisfied by a
    // tree in which nothing reads the file at all — which is also the state in
    // which the whole feature is inert (PF-064).
    const block = preambleContractBlock();
    expect(block, 'the reader must name the Read tool').toContain('Read tool');
    expect(block, 'and require an absolute path').toContain('absolute path');
    expect(
      block,
      'and forbid `~`: the Read tool does not expand it, only Bash does, so a `~` path resolves ' +
      'to a literal directory name (PF-035)',
    ).toMatch(/never `~`/);
    expect(
      block,
      'and forbid cat/head/tail: a shell rewrite can substitute a truncated structural view for ' +
      'the real bytes, and a partial read is indistinguishable from a missing section',
    ).toMatch(/cat`\/`head`\/`tail`|`cat`, `head`|cat`\/`head/);
  });

  it('no operation section of the agent reads it — enumerated over all 10 tracker ops', () => {
    // Enumerated by NAME, not scanned as one blob: the claim is per-op, and a
    // whole-file scan would be satisfied by the preamble's own legitimate mention.
    const opStarts = [...GIT_MD.matchAll(/^## Operation: (\S+)$/gm)].map(m => ({
      op: m[1], index: m.index!,
    }));
    expect(
      opStarts.length,
      'no `## Operation:` headings found — the per-op enumeration below is vacuous',
    ).toBeGreaterThanOrEqual(TRACKER_GITHUB_OPS.length);

    const offenders: string[] = [];
    for (const [i, start] of opStarts.entries()) {
      const end = i + 1 < opStarts.length ? opStarts[i + 1].index : GIT_MD.length;
      const section = GIT_MD.slice(start.index, end);
      offenders.push(...collectTrackerFileReaders([{ path: `git.md#${start.op}`, content: section }]));
    }
    expect(
      offenders,
      `an operation section reads the tracker configuration file. It is resolved ONCE per spawn in ` +
      `the preamble and passed down; a second read is a second authority on the same values, and ` +
      `they can disagree within one run (§14.3, PF-023):\n  ${offenders.join('\n  ')}`,
    ).toEqual([]);
    for (const op of TRACKER_GITHUB_OPS) {
      expect(
        opStarts.map(s => s.op),
        `${op} must be an enumerated section, or the sweep silently skipped it`,
      ).toContain(op);
    }
  });

  it('no generated reference reads it', () => {
    const refs = gitAgentSinkCorpus().filter(e => e.path !== GIT_AGENT.path);
    expect(refs.length, 'the generated reference corpus is empty — run `npm run build`')
      .toBeGreaterThan(0);
    expect(collectTrackerFileReaders(refs)).toEqual([]);
  });

  it('no command source and no dist/commands/*.md reads it — release.md included by name', () => {
    // `release.md:85` already reads `.devflow/conventions.md`, so the claim
    // "learned files are read only inside the Git agent" is ALREADY false for
    // conventions. This guard is what stops it getting worse (GAP-38): it is the
    // named precedent, so the hand-authored command is asserted present in the
    // corpus rather than assumed to be scanned.
    const corpus = commandCorpus();
    expect(corpus.length, 'the command corpus is empty — run `npm run build`').toBeGreaterThan(0);
    expect(
      corpus.map(e => e.path),
      'release.md is hand-authored and copied verbatim into dist/, so it is the one command that ' +
      'no MDS guard covers — it must be in this corpus by name',
    ).toContain('dist/commands/release.md');
    expect(
      collectTrackerFileReaders(corpus),
      'a command reads the tracker configuration file. Commands are orchestrators: they pass ' +
      'inputs to agents; the tracker configuration file has exactly one reader (AC-3.18)',
    ).toEqual([]);
  });

  it('known-bad probe: the collector reports a read and ignores the partial import', () => {
    expect(
      collectTrackerFileReaders([{ path: 'seed.md', content: 'Read ~/.devflow/tracker.md first.' }]),
    ).toEqual(['seed.md:1: Read ~/.devflow/tracker.md first.']);
    expect(
      collectTrackerFileReaders([{
        path: 'seed.mds',
        content: '@import { issue_ref_grammar } from "./_partials/_tracker.mds"',
      }]),
      'the `.mds` partial import must NOT be reported — it contains the substring and reads nothing',
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 4. AC-3.18 — no HTTP fallback, no credential read
// ---------------------------------------------------------------------------

interface ForbiddenIo {
  readonly label: string;
  readonly pattern: RegExp;
}

const FORBIDDEN_IO: readonly ForbiddenIo[] = [
  { label: 'curl', pattern: /\bcurl\b/ },
  { label: 'wget', pattern: /\bwget\b/ },
  // The optional quote before the colon is not pedantry: a header set through a
  // JSON/object literal is spelled `"Authorization": "Bearer …"`, and a bare
  // `Authorization:` pattern misses exactly the shape a fabricated HTTP call
  // would most naturally be written in.
  { label: 'Authorization header', pattern: /\bAuthorization"?\s*:/ },
  { label: 'token env read', pattern: /\$\{?[A-Z_]*(?:_TOKEN|_API_KEY)\b/ },
];

/** Named collector: forbidden transport or credential reads in loadable text. */
export function collectForbiddenIo(corpus: readonly CorpusEntry[]): string[] {
  const sites: string[] = [];
  for (const entry of corpus) {
    for (const [i, line] of entry.content.split('\n').entries()) {
      for (const rule of FORBIDDEN_IO) {
        if (rule.pattern.test(line)) {
          sites.push(`${entry.path}:${i + 1}: ${rule.label} — ${line.trim().slice(0, 90)}`);
        }
      }
    }
  }
  return sites;
}

/**
 * D-AC318-CONTRACT-SCOPE — the ONE generated file that NAMES a forbidden transport,
 * because naming it is how it forbids it.
 *
 * `tracker/_mcp.md`'s no-HTTP-fallback clause is the single statement of GAP-19's
 * control: *"NEVER construct an HTTP request, NEVER run `curl` or `wget`, NEVER
 * read a tracker credential from the environment."* The words are the prohibition.
 * Scanning for the words alone therefore makes the rule its own first violation —
 * the same trap `capability-hoist`'s LOOP_MARKERS records, where an unanchored
 * `per commit` marker reported the batch-first fix as an unhoisted probe.
 *
 * Why an exclusion and not a cleverer pattern. A line-scoped "a NEVER on this line
 * means it is a prohibition" predicate breaks on wrapping — the clause's `NEVER`
 * and its `curl` sit on different physical lines already — and pinning where a
 * sentence happens to wrap is PF-057's class of mistake. So the case is classified
 * instead (ADR-025), and the exclusion pays for itself three ways:
 *
 *   1. It is named by PATH, not by pattern, so no other file is admitted.
 *   2. Only the two RULES that appear in the prohibition are admitted, so an
 *      `Authorization:` header or a token-env read inside that same file is still
 *      reported — a real fabricated call cannot hide behind the exclusion.
 *   3. It is asserted in BOTH directions: the excluded file must produce exactly
 *      these rules and no others, so an exclusion that outlives its subject goes
 *      red rather than silently widening. `tests/guards/mcp-sink-bypass.test.ts`
 *      independently REQUIRES those literals to be present, which is the strongest
 *      justification an exclusion can have: deleting the text fails another guard.
 */
const CONTRACT_IO_EXCLUSION = {
  /** Suffix of the generated contract's path, as gitAgentSinkCorpus labels it. */
  pathSuffix: `${path.sep}tracker${path.sep}_mcp.md`,
  /** The only rules this file may trip — the two transports its clause forbids. */
  rules: ['curl', 'wget'] as const,
} as const;

/** Is this reported site the contract document tripping one of its own prohibitions? */
function isContractProhibition(site: string): boolean {
  if (!site.includes(CONTRACT_IO_EXCLUSION.pathSuffix)) return false;
  return CONTRACT_IO_EXCLUSION.rules.some(rule => site.includes(`: ${rule} — `));
}

describe('AC-3.18: no HTTP fallback and no credential read in the Git spawn surface', () => {
  it('git.md ∪ generated references carry none of the four', () => {
    // The highest-value bypass of BOTH controls at once (GAP-19): a tool that is
    // absent must degrade, never fall through to a transport that skips the D11
    // scrub gate and reads a credential on the way.
    const corpus = gitAgentSinkCorpus();
    expect(corpus.length, 'empty corpus — run `npm run build`').toBeGreaterThan(1);
    const sites = collectForbiddenIo(corpus);
    expect(
      sites.filter(site => !isContractProhibition(site)),
      'forbidden transport or credential read in always-loadable text (§14.9-2)',
    ).toEqual([]);
  });

  it('the generated exclusion is exactly the contract\'s own prohibition — both directions', () => {
    // What D-AC318-CONTRACT-SCOPE owes in return. Forward: every site the
    // exclusion swallows comes from that one file and one of those two rules.
    // Reverse: that file really does trip both, so the exclusion has a live
    // subject and cannot outlive the clause it was written for.
    const sites = collectForbiddenIo(gitAgentSinkCorpus());
    const excluded = sites.filter(isContractProhibition);
    expect(
      excluded.length,
      'the contract document trips none of its own prohibitions — either the no-HTTP-fallback ' +
      'clause was reworded away (tests/guards/mcp-sink-bypass.test.ts owns that claim and will ' +
      'say so) or the generated file is absent. Either way this exclusion now describes nothing ' +
      'and must be deleted rather than carried',
    ).toBeGreaterThan(0);
    expect(
      [...new Set(excluded.map(site => site.split(': ')[1].split(' — ')[0]))].sort(),
      'the exclusion admits exactly the two transports the clause names; anything else in that ' +
      'file is a fabricated call hiding behind a prohibition',
    ).toEqual([...CONTRACT_IO_EXCLUSION.rules].sort());
    expect(
      [...new Set(excluded.map(site => site.split(':')[0]))],
      'the exclusion is scoped to ONE file, by path',
    ).toHaveLength(1);
  });

  it('known-bad probe: the exclusion does not admit a real call in the same file', () => {
    // The half that makes the exclusion narrow rather than a file-level pass.
    const seeded = [
      `/x/tracker/_mcp.md:9: curl — \`curl\` or \`wget\` are forbidden`,
      `/x/tracker/_mcp.md:40: Authorization header — headers: { "Authorization": "Bearer $T" }`,
      `/x/tracker/_mcp.md:41: token env read — export H="Bearer $TRACKER_API_TOKEN"`,
      `/x/tracker/jira/comment.md:12: curl — curl -X POST https://site/rest/api/3/issue`,
    ].map(site => site.replace(/\//g, path.sep));
    expect(
      seeded.filter(site => !isContractProhibition(site)).map(site => site.split(': ')[1].split(' — ')[0]),
      'only the two named transports, and only in the contract file, may be excluded',
    ).toEqual(['Authorization header', 'token env read', 'curl']);
  });

  it('the one hand-authored exclusion is named, and is the ONLY one', () => {
    // D-AC318-SCOPE. `src/assets/skills/git/references/github-api.md` carries a
    // documentation EXAMPLE of an `Authorization:` header (`gh api -H "…"`), which
    // predates this phase and is not a tracker path. It is excluded from the gate
    // above — and what the exclusion owes in return (ADR-025's amendment) is this:
    // the excluded term is asserted to be exactly one file and exactly one rule,
    // so it cannot quietly grow into a second offender or a second file.
    const dir = path.join(skillsDir(), 'git', 'references');
    const handAuthored: CorpusEntry[] = walkFiles(dir, f => f.endsWith('.md')).map(f => ({
      path: `references/${path.relative(dir, f)}`,
      content: readFileSync(f, 'utf-8'),
    }));
    expect(handAuthored.length, 'the hand-authored reference set is empty').toBeGreaterThan(0);
    const found = collectForbiddenIo(handAuthored);
    expect(
      found.map(s => s.split(':')[0]),
      'a hand-authored reference other than github-api.md carries forbidden I/O, or github-api.md ' +
      'grew a second site. Either way the exclusion no longer describes the tree and must be ' +
      're-derived rather than widened',
    ).toEqual(['references/github-api.md']);
  });

  it('known-bad probe: every rule fires on its own shape', () => {
    const SHAPES: ReadonlyArray<readonly [string, string]> = [
      ['curl', 'curl -X POST https://example.atlassian.net/rest/api/3/issue'],
      ['wget', 'wget -qO- "$URL"'],
      ['Authorization header', 'headers: { "Authorization": "Bearer $T" }'],
      ['token env read', 'export H="Bearer $TRACKER_API_TOKEN"'],
    ];
    expect(SHAPES.length, 'one shape per rule').toBe(FORBIDDEN_IO.length);
    for (const [label, line] of SHAPES) {
      const found = collectForbiddenIo([{ path: 'seed.md', content: line }]);
      expect(found.join('|'), `"${line}" must be reported as ${label}`).toContain(label);
    }
    // …and does not fire on the legitimate neighbours it sits beside.
    expect(collectForbiddenIo([{
      path: 'seed.md',
      content: 'gh issue comment 5 --body-file "$DEVFLOW_BODY"\nSet DEVFLOW_DIR before the call.',
    }])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 5. [DR-04] The DEGRADED literal registry — BOTH directions
// ---------------------------------------------------------------------------
//
// A one-directional literal registry is the same shape as the defect Phase 0
// exists to repair: a caller and an agent disagreed about a literal and no test
// caught it. So the table is pinned twice — once as "nothing outside this list"
// and once as "nothing in this list is unemitted".
//
// The FORWARD arm is scoped by SUBTASK, and the scoping is asserted rather than
// implied. Roughly half of §14.2's rows are emitted by per-provider mechanics
// that land in 3b/3c, so a forward arm over the whole table would be red here for
// rows nobody has written yet — and "expected red" is indistinguishable from a
// regression. DEFERRED_REASONS is that half, and the test asserts the two sets
// partition the table exactly, so a row cannot be dropped from the forward arm by
// being quietly left out of both.

/** §14.2 rows whose emitting site exists at THIS boundary. */
const LIVE_REASONS: readonly string[] = [
  'unknown tracker provider',
  'tracker configuration unreadable',
  'tracker.md exceeds size bound',
  'tracker configuration mismatch',
  'tracker mechanics unavailable',
  'tracker not configured',
  'tracker.md required fields incomplete — edit ~/.devflow/tracker.md',
  'ambiguous issue reference',
  'redaction unavailable',
  // Both of these were listed as deferred on first draft and the mirror arm below
  // caught them: they already have emitting sites at this boundary. `no tracking
  // issue for this run` is §14.2's "existing, byte-pinned" row, and the
  // `Depends on:` foreign-shape row landed with the ref grammar in an earlier
  // phase. A deferral that is not real hides a row from BOTH arms.
  'foreign issue reference {ref}',
  'no tracking issue for this run',
  // ── Live from Phase 3b: the tool-call contract and the first provider
  // mechanics tree. Each row moved here in the commit that authored its emitting
  // site, which is the discipline DEFERRED_REASONS' comment describes.
  //
  // `no tracker tool for {capability}` is emitted by the contract document itself
  // — the one file that states the capability-unavailable rule, so the reason
  // belongs to it rather than to any provider. The other five are provider
  // mechanics: the dedup ladder's bottom rung, the ref pre-flight's per-ref and
  // aggregate arms, the site shape gate, and the transition exact-match rule.
  'no tracker tool for {capability}',
  'unsupported by {provider}',
  'dedup unavailable — duplicate possible',
  'issue reference "{ref}" does not match {provider} reference grammar',
  'no parseable refs for provider {p}',
  'unusable site',
  'unsupported transition',
];

/**
 * The provider tokens a `{provider}` placeholder may be instantiated with —
 * derived from the registry's own provider rows, never listed.
 *
 * §14.2 states the canonical reason as a TEMPLATE (`unsupported by {provider}`)
 * and §14.4 fixes the per-provider CELL as the instantiated form (`unsupported by
 * jira`). Both spellings are correct and they are different strings, so a registry
 * that admitted only one of them would either report every shipped provider file
 * as unregistered or force a provider's own mechanics to name a placeholder
 * instead of itself.
 *
 * Deriving the token list from VARIANT_MODULES rather than listing it is what
 * makes 3c's provider free: registering `tracker/linear` admits
 * `unsupported by linear` with no registry edit, and a provider that is NOT
 * registered is still refused.
 */
function registeredProviderTokens(): string[] {
  return VARIANT_MODULES
    .map(mod => mod.subdir)
    .filter(subdir => subdir.startsWith('tracker/'))
    .map(subdir => subdir.slice('tracker/'.length));
}

/**
 * The capability names a `{capability}` placeholder may be instantiated with —
 * read out of the tool-call contract's own table, never listed here.
 *
 * `no tracker tool for {capability}` is stated as a template by the contract and
 * emitted INSTANTIATED by a provider's mechanics (`no tracker tool for fetch by
 * key`), for the same reason the provider placeholder is: a mechanics file that
 * degraded on a named capability and then reported a placeholder would tell the
 * user nothing they can act on.
 *
 * The contract's capability table is the authority for that vocabulary — it is
 * where the rows are defined, and where the "select by capability DESCRIPTION,
 * never by tool name" rule lives — so the admitted set is parsed from it. That
 * keeps the vocabulary CLOSED: a provider degrading on a capability the contract
 * does not define is reported, which is exactly the GAP-13 shape (a reason nobody
 * can grep for) one level down.
 *
 * Read from the SOURCE module rather than the generated copy: the generated file
 * exists only while the gate is open, and a guard about the reason vocabulary must
 * not go quiet in the other gate state.
 */
function contractCapabilityNames(): string[] {
  const source = path.join(ROOT, 'src', 'assets', 'mds', 'tracker', '_mcp.mds');
  const rows = readFileSync(source, 'utf-8')
    .split('\n')
    .filter(line => /^\| /.test(line))
    .map(line => line.split('|')[1]?.trim() ?? '')
    .filter(cell => cell !== '' && cell !== 'Capability' && !/^-+$/.test(cell));
  if (rows.length === 0) {
    throw new Error(
      `no capability rows parsed from ${source} — the contract's capability table is the ` +
      `authority for the {capability} vocabulary, and an empty set would admit every spelling`,
    );
  }
  return rows;
}

/**
 * Named collector: a canonical reason and every instantiation of it this tree
 * admits.
 *
 * Two placeholders, two closed token sets, both DERIVED: `{provider}` from the
 * module registry's provider rows, `{capability}` from the contract's capability
 * table. A reason with neither placeholder instantiates to itself, so callers need
 * no branch. Both registry arms and the deferral mirror go through this one
 * function, so a template rule cannot hold in one direction and not the other.
 *
 * `{ref}` and `{p}` are deliberately NOT instantiated: those placeholders are
 * emitted verbatim by the mechanics — the value is runtime data with no closed
 * domain, so a template is the only spelling that can be pinned.
 */
export function reasonSpellings(reason: string): string[] {
  let spellings = [reason];
  if (reason.includes('{provider}')) {
    spellings = spellings.flatMap(text => [
      text,
      ...registeredProviderTokens().map(token => text.replace('{provider}', token)),
    ]);
  }
  if (reason.includes('{capability}')) {
    spellings = spellings.flatMap(text => [
      text,
      ...contractCapabilityNames().map(name => text.replace('{capability}', name)),
    ]);
  }
  return [...new Set(spellings)];
}

/**
 * DEGRADED reasons the shipped tree emits that §14.2's table does not list.
 *
 * ⚠ THIS IS A TABLE GAP, recorded rather than papered over.
 * `references/tracker/github/manage-debt.md` emits
 * `TRACEABILITY: DEGRADED (tech-debt archive failed for #…)`, which predates the
 * canonical table and appears nowhere in it. The reverse arm is "no reason
 * outside the registry", so the choice was between changing a Phase-2 literal
 * that manage-debt's own guards pin (out of scope, and a behaviour change in a
 * subtask that must not carry one) and registering the reason with its provenance.
 *
 * It is a SEPARATE list, not an addition to CANONICAL_REASONS, so it cannot
 * become a dumping ground: the forward arm below asserts every entry here is
 * actually emitted, so an unregistered NEW reason parked here goes red.
 *
 * ACTION FOR THE PHASE: §14.2 needs this row, or the literal needs retiring. Both
 * are appendix decisions, not this subtask's.
 */
const PRE_PHASE3_REASONS: readonly string[] = [
  'tech-debt archive failed for #${old_issue}',
];

/**
 * §14.2 rows with no emitting site yet.
 *
 * EMPTY from Phase 3b: the tool-call contract and the first provider mechanics
 * tree between them gave every remaining row an emitter, so each one moved into
 * LIVE_REASONS in the commit that authored its site — which is the discipline this
 * list exists to enforce rather than a state it has to stay in.
 *
 * Kept as a declared half rather than deleted, because the partition assertion
 * below is what makes this the ONLY way a row may sit outside the forward arm: a
 * row deleted from both halves shrinks the registry silently. An empty half makes
 * the mirror arm range over nothing, so that arm carries its own known-bad probe.
 *
 * 3c adds no row here. Linear's reasons are the same canonical rows, and its
 * `unsupported by linear` spelling is admitted by `reasonSpellings` the moment its
 * provider is registered.
 */
const DEFERRED_REASONS: readonly string[] = [];

/** §14.2's canonical table: every non-`(none)` reason, live or deferred. */
const CANONICAL_REASONS: readonly string[] = [...LIVE_REASONS, ...DEFERRED_REASONS];

/**
 * Reasons §14.2 RETIRES. Absent everywhere, in every phase.
 *
 * Three synonyms for one condition is what GAP-13 recorded: an agent emitting one
 * spelling and a guard pinning another is a DEGRADED nobody can grep for.
 */
const RETIRED_REASONS: readonly string[] = [
  'provider mechanics unavailable',
  'provider {x} not installed',
  'no MCP tool for {capability}',
  'no tool available for {capability}',
  'tracker not reachable',
  'interactive setup required — run /plan in an interactive session',
  'tracker.md required fields incomplete — delete .devflow/tracker.md and re-learn',
];

/** Phase-3 status-line literals that share the registry [DR-01]. */
const PHASE3_STATUS_LINES: readonly string[] = [
  'SECRET-EXPOSED (rotate {type} credential — the source file still holds it)',
  'SCRUB: N [type:count,…]',
];

/**
 * Named collector: every `DEGRADED (…)` reason spelled in a text.
 *
 * Whitespace runs are collapsed to one space, because a reason is a ONE-LINE
 * status string and the prose that states it is hard-wrapped. `_mcp.md`'s
 * capability clause wraps mid-reason, so the raw capture was
 * `"no\ntracker tool for {capability}"` — a string matching no registry entry and
 * describing no defect. Normalising here rather than reflowing the source is the
 * choice PF-057 argues for: the alternative pins where a sentence happens to
 * break, and the next reflow re-breaks it somewhere else.
 *
 * Deliberately NOT a general unescape or trim-only: the collapse is what makes a
 * wrapped reason and an inline one the same string, which is the property both
 * registry arms compare on.
 */
export function collectDegradedReasons(text: string): string[] {
  return [...text.matchAll(/DEGRADED \(([^)]*(?:\([^)]*\)[^)]*)*)\)/g)]
    .map(m => m[1].replace(/\s+/g, ' ').trim());
}

describe('[DR-04] DEGRADED literal registry: forward direction', () => {
  it('the table partitions exactly into live and deferred rows (no row unaccounted for)', () => {
    // Without this, a row could be removed from the forward arm simply by deleting
    // it from both lists, and the registry would shrink silently.
    expect(
      new Set([...LIVE_REASONS, ...DEFERRED_REASONS]).size,
      'live and deferred must be disjoint — a row in both is a row neither arm owns',
    ).toBe(CANONICAL_REASONS.length);
    expect(
      CANONICAL_REASONS.length,
      '§14.2 fixes eighteen non-`(none)` reasons; a shorter table is a narrowed registry',
    ).toBeGreaterThanOrEqual(18);
    // The instantiation rule is a NARROWING, not a wildcard: only `{provider}` is
    // instantiated, only with tokens the registry carries, and a reason without the
    // placeholder still matches itself and nothing else.
    expect(
      reasonSpellings('unsupported by {provider}'),
      'the template and each registered provider\'s cell, and nothing else',
    ).toEqual([
      'unsupported by {provider}',
      'unsupported by github',
      'unsupported by jira',
      'unsupported by linear',
    ]);
    expect(
      reasonSpellings('redaction unavailable'),
      'a reason with no provider placeholder must instantiate to itself alone',
    ).toEqual(['redaction unavailable']);
    expect(
      reasonSpellings('unsupported by {provider}'),
      'an unregistered provider must NOT be admitted — that is the point of deriving the tokens',
    ).not.toContain('unsupported by asana');
    // The capability vocabulary is closed the same way, against the contract's own
    // table. Both a real row and a fabricated one are checked, so the derivation is
    // proven to discriminate rather than merely to return something.
    const capabilitySpellings = reasonSpellings('no tracker tool for {capability}');
    expect(
      capabilitySpellings,
      'the contract defines this capability, so a provider may degrade on it by name',
    ).toContain('no tracker tool for fetch by key');
    expect(
      capabilitySpellings,
      'a capability the contract does not define must NOT be admitted — an ungreppable reason is ' +
      'GAP-13 one level down',
    ).not.toContain('no tracker tool for frobnicate');
    expect(capabilitySpellings[0], 'the template itself is always the first spelling')
      .toBe('no tracker tool for {capability}');
    expect(
      PRE_PHASE3_REASONS.length,
      'the pre-Phase-3 list is empty — the reverse arm would then be silently stricter than the ' +
      'tree it scans, and the table gap it records would be lost',
    ).toBeGreaterThan(0);
    expect(
      LIVE_REASONS.length,
      'the live half is empty — the forward arm below would assert nothing (PF-018)',
    ).toBeGreaterThan(0);
  });

  it('every LIVE reason is emitted by at least one named site', () => {
    const corpus = [...gitAgentSinkCorpus(), ...commandCorpus()];
    const haystack = corpus.map(e => e.content).join('\n');
    const unemitted = LIVE_REASONS.filter(
      reason => !reasonSpellings(reason).some(spelling => haystack.includes(`DEGRADED (${spelling})`)),
    );
    expect(
      unemitted,
      `reason(s) in the canonical table that NO site emits. A registry entry with no emitter is a ` +
      `literal a guard pins and a user never sees — the exact shape of the Phase-0 defect where a ` +
      `caller and an agent disagreed and nothing caught it:\n  ${unemitted.join('\n  ')}`,
    ).toEqual([]);
  });

  it('every DEFERRED reason is NOT yet emitted — the deferral is real, not a label', () => {
    // The mirror. A "deferred" row that IS already emitted means the list is stale
    // and the forward arm is narrower than the tree can support.
    const haystack = [...gitAgentSinkCorpus(), ...commandCorpus()].map(e => e.content).join('\n');
    /** The mirror predicate, named so the probe below drives the live one. */
    const alreadyEmitted = (reasons: readonly string[]): string[] => reasons.filter(
      reason => reasonSpellings(reason).some(spelling => haystack.includes(`DEGRADED (${spelling})`)),
    );

    const alreadyLive = alreadyEmitted(DEFERRED_REASONS);
    expect(
      alreadyLive,
      `reason(s) listed as deferred that already have an emitting site. Move them to ` +
      `LIVE_REASONS in this commit — a deferral that is not real hides the row from both arms:\n  ` +
      alreadyLive.join('\n  '),
    ).toEqual([]);

    // The deferred half is empty on this tree, so the assertion above ranges over
    // nothing. Drive the SAME predicate over a seeded deferred row that IS emitted:
    // without this, a mirror arm that had stopped working would read identically.
    const seededStale = LIVE_REASONS[0];
    expect(
      alreadyEmitted([seededStale]),
      'the mirror predicate must report a reason that is genuinely emitted — otherwise an empty ' +
      'deferred half and a broken predicate are the same green (PF-064)',
    ).toEqual([seededStale]);
    expect(
      alreadyEmitted(['a reason no site emits — seeded probe']),
      'and must not report one that is not',
    ).toEqual([]);
  });

  it('the Phase-3 status-line literals are emitted too [DR-01]', () => {
    const haystack = gitAgentSinkCorpus().map(e => e.content).join('\n');
    for (const literal of PHASE3_STATUS_LINES) {
      expect(
        haystack,
        `${literal} is registered but unemitted. The rotation warning in particular is the only ` +
        `thing that turns a scrub into remediation: the credential is still live in the source ` +
        `file, so a redacted comment without it leaves the user believing they are safe`,
      ).toContain(literal);
    }
    expect(PHASE3_STATUS_LINES.length, 'the Phase-3 literal set is empty').toBeGreaterThan(0);
  });
});

describe('[DR-04] DEGRADED literal registry: reverse direction', () => {
  it('no generated reference emits a reason outside the canonical table', () => {
    const refs = gitAgentSinkCorpus().filter(e => e.path !== GIT_AGENT.path);
    expect(refs.length, 'the generated reference corpus is empty — run `npm run build`')
      .toBeGreaterThan(0);
    const unregistered: string[] = [];
    for (const entry of refs) {
      for (const reason of collectDegradedReasons(entry.content)) {
        // `{reason}` is the D4 contract's own placeholder, not a reason.
        if (reason === '{reason}' || reason === '\\{reason\\}') continue;
        if (CANONICAL_REASONS.some(canonical => reasonSpellings(canonical).includes(reason))) continue;
        if (PRE_PHASE3_REASONS.includes(reason)) continue;
        unregistered.push(`${entry.path}: "${reason}"`);
      }
    }
    expect(
      unregistered,
      `generated reference(s) emit a DEGRADED reason that is not in §14.2's table. Three ` +
      `spellings of one condition is what GAP-13 recorded: an agent emitting one and a guard ` +
      `pinning another is a degradation nobody can grep for:\n  ${unregistered.join('\n  ')}`,
    ).toEqual([]);
  });

  it('every retired reason is absent from the whole surface', () => {
    const corpus = [...gitAgentSinkCorpus(), ...commandCorpus()];
    const survivors: string[] = [];
    for (const entry of corpus) {
      for (const retired of RETIRED_REASONS) {
        if (entry.content.includes(retired)) survivors.push(`${entry.path}: "${retired}"`);
      }
    }
    expect(survivors, `retired reason(s) still present:\n  ${survivors.join('\n  ')}`).toEqual([]);
    expect(RETIRED_REASONS.length, 'the retired list is empty (PF-018)').toBeGreaterThanOrEqual(7);
  });

  it('known-bad probe: the reason collector reads real and nested parentheses', () => {
    // Drives collectDegradedReasons — the collector the reverse arm depends on.
    expect(collectDegradedReasons('emit `TRACEABILITY: DEGRADED (unusable site)` and continue'))
      .toEqual(['unusable site']);
    expect(collectDegradedReasons('DEGRADED (unsupported by jira) then DEGRADED (rate limited)'))
      .toEqual(['unsupported by jira', 'rate limited']);
    expect(
      collectDegradedReasons('DEGRADED (tracker.md required fields incomplete — edit ~/.devflow/tracker.md)'),
      'a reason containing a path and an em-dash must come back whole',
    ).toEqual(['tracker.md required fields incomplete — edit ~/.devflow/tracker.md']);
    expect(collectDegradedReasons('no degradation here')).toEqual([]);
  });
});
