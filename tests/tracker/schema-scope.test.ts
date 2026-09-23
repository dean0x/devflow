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
 * SIX CLAIMS, each able to fail on its own (PF-064):
 *   1. SCHEMA TABLE — every section has a scope and an absent⇒default, no blank
 *      cells, read out of the agent's own table.
 *   2. HEADINGS, BOTH DIRECTIONS [DR-21] — writer ↔ reader set equality with a
 *      distinct why-message per direction, over a floor counted in DISTINCT
 *      headings so neither direction is vacuous and neither is satisfied by a
 *      repeat standing in for a dropped section.
 *   3. ADR-007 THREE-WAY SWEEP (AC-3.16) — the configuration file is read in
 *      exactly ONE place. No op section, no generated reference, no command
 *      source and no `dist/commands/*.md` reads it.
 *   4. NO CREDENTIAL, NO HTTP (AC-3.18) — no `curl`, `wget`, `Authorization:` or
 *      token-env read anywhere in `git.md ∪ generated references`.
 *   5. THE DEGRADED LITERAL REGISTRY, BOTH DIRECTIONS [DR-04] — §14.2's table
 *      pinned as a literal array, every live row emitted by a named site, no
 *      un-registered `DEGRADED (` anywhere in the sink class (the always-loaded
 *      agent included, behind a named exemption registry rather than a corpus
 *      filter), and every retired synonym absent.
 *   6. THE READER'S RENDERING RULE (AC-3.11, §14.1) — the always-loaded contract
 *      block states that a rendered ref is never `#`-prefixed under a non-github
 *      provider, and names the Output templates' `#` as github's rendering. The
 *      templates themselves are frozen by AC-3.1, so the rule is the only place
 *      that distinction can live.
 *
 * Both halves of claim 2 bind to `TRACKER_SCHEMA_SECTIONS` in tests/helpers.ts
 * rather than to each other. A two-sided equality test cannot catch drift in its
 * own oracle: if the reader and the writer both lost a heading, they would agree.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import * as path from 'path';

import { commandsDir, compiledSkillRefsDir, skillsDir } from '../../src/core/assets.js';
import {
  MCP_BACKED_PROVIDER_SUBDIRS,
  PR_HOST_DESTINATION_ROOT,
  TRACKER_GITHUB_OPS,
  VARIANT_MODULES,
} from '../../src/core/mds-variants.js';
import {
  ROOT,
  TRACKER_SCHEMA_SECTIONS,
  collectTrackerSchemaRows,
  collectTrackerTemplate,
  collectTrackerTemplateHeadings,
  gitAgentSinkCorpus,
  isPrHostEntryPath,
  prHostRel,
  resolveAgentSource,
  walkFiles,
  type CorpusEntry,
} from '../helpers.js';

// ---------------------------------------------------------------------------
// Corpora
// ---------------------------------------------------------------------------

const GIT_AGENT = resolveAgentSource('git');
const GIT_MD = GIT_AGENT.content;

/**
 * The Tracker agent — the WRITER side. Fail-loud; never a skip.
 *
 * Resolved through `resolveAgentSource`, the one owner of the dist-first policy,
 * exactly as the reader half above is. A hand-built `agentsDir()` path reads the
 * `src/` copy unconditionally: the day `tracker` becomes an MDS generator host,
 * this WRITER half would assert the UNCOMPILED file while tests/tracker-agent.test.ts
 * asserts the compiled one, and the two-sided seam would be comparing two
 * different artifacts while staying green. The resolver also owns the fail-loud
 * message, which names both candidate paths and the build step.
 */
const TRACKER_MD = resolveAgentSource('tracker').content;

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
  const rows = collectTrackerSchemaRows(TRACKER_MD);

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
      'a blank cell reads as "whatever the agent decides", which is precisely the silent-authority ' +
      `failure the sentinel rule exists to prevent:\n  ${blanks.join('\n  ')}`,
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
    const template = collectTrackerTemplate(TRACKER_MD);
    expect(
      template,
      'the Tracker agent\'s tagged template fence was not found — addressed by its info string, ' +
      'so a renamed fence tag fails here rather than silently matching another fence',
    ).not.toBeNull();
    return collectTrackerTemplateHeadings(template!);
  })();
  const readerHeadings = collectContractHeadings(preambleContractBlock());

  it('non-vacuity: both sides carry at least as many DISTINCT sections as the oracle', () => {
    // The floor is what makes the two directions below discriminating: two empty
    // sets are equal, and a collector that returned nothing would agree with
    // another collector that returned nothing.
    //
    // Counted DISTINCT, because a raw count carries slack: the reader block
    // legitimately spells `## Reference Rendering` twice, so a list that dropped
    // one heading and repeated another would clear a raw floor while describing a
    // schema one section short. The oracle's own size needs no floor here — it is
    // fixed at exactly TRACKER_SCHEMA_SECTION_COUNT distinct headings at the
    // oracle's construction, and tests/tracker/schema-oracle.test.ts is what makes
    // that check falsifiable.
    const writerDistinct = new Set(writerHeadings).size;
    const readerDistinct = new Set(readerHeadings).size;
    expect(
      writerDistinct,
      `the WRITER template lists ${writerDistinct} distinct heading(s); at least ` +
      `${TRACKER_SCHEMA_SECTIONS.length} are required`,
    ).toBeGreaterThanOrEqual(TRACKER_SCHEMA_SECTIONS.length);
    expect(
      readerDistinct,
      `the READER contract block names ${readerDistinct} distinct heading(s); at least ` +
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
  // SPLIT BY CAUSE. One spelling covered two different mistakes with two different
  // remedies — a per-repo `tracker` key that narrows to a provider the manifest does
  // not carry, and a tracker configuration file whose frontmatter provider disagrees
  // with the resolved one. A user who reads the unsplit reason cannot tell which file
  // to edit, which is the whole point of naming a reason.
  'tracker configuration mismatch (repository override)',
  'tracker configuration mismatch (conventions file)',
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
  // The plan artifact is posted as CONTENT, so there is a body that can exceed the
  // provider's field limit. Over the cap the operation posts none of the plan and
  // says so: a truncated plan is worse than a pointer, because the reader cannot
  // tell which half is missing. No {provider} token — the cap is the provider's,
  // the failure is not.
  'plan artifact exceeds comment cap',
  // Two connected servers is the one configuration in which a write lands in the
  // WRONG tracker and nothing downstream can tell. `{n}` is how many servers
  // qualified: runtime data with no closed domain, so it is emitted verbatim and
  // NEVER instantiated, exactly like `{ref}` and `{p}`. `{capability}` IS
  // instantiated, because the contract's own table is its closed domain — the
  // ambiguity is per capability, so the reason has to name which one.
  'ambiguous tracker server — {n} servers offer {capability}',
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
 * DELIBERATELY EXCLUDED from the `{ISSUE_REF}` template rewrite, and the exclusion
 * is recorded here because it looks like an oversight. `#${old_issue}` is a SHELL
 * expansion inside an executable `||` chain in a file that only ever runs under
 * github, where `#N` IS the correct rendering. `{ISSUE_REF}` is a rendering token
 * the agent substitutes into an Output template; substituting it into a shell
 * recipe would replace a live variable with a literal brace pair and break the
 * command. The rewrite's subject is the agent's templates, and this is neither.
 */
const GITHUB_ONLY_REASONS: readonly string[] = [
  'tech-debt archive failed for #${old_issue}',
];

/**
 * DEGRADED reasons the always-loaded agent emits for its pre-Phase-3 GitHub
 * operations, which §14.2's table does not range over.
 *
 * WHY THIS LIST EXISTS AT ALL. The reverse arm below used to drop `git.md` from
 * its corpus outright — `.filter(e => e.path !== GIT_AGENT.path)` — which exempted
 * the single largest emitter of DEGRADED reasons in the tree from the "every
 * emitted reason is registered" sweep. The retired-reason arm beside it reads
 * git.md, so the two directions disagreed about their own subject, and the four
 * DEGRADED reasons this phase added to git.md were registered by review alone.
 *
 * Written in the same register as GITHUB_ONLY_REASONS and for the same reason: a
 * prohibition and its exemption registry are ONE authority (PF-067). An exemption
 * that lives in a `.filter` predicate is invisible to anyone reading the rule, and
 * a reader who greps only the rule finds a violation the arm silently permits.
 *
 * Each entry is a github-op status literal that predates §14.2 and whose scope the
 * canonical table does not claim: the rate-limit backoff, the no-PR branch of the
 * review-comment ops, and the release version parse. The two summary operations'
 * 5xx retry ceilings are emitted from the PR-host references and live in
 * PR_HOST_LEGACY_REASONS below.
 * The arm below asserts every entry is genuinely emitted, so this cannot become a
 * dumping ground — an entry parked here that nothing emits goes red, exactly as it
 * does for GITHUB_ONLY_REASONS.
 *
 * ACTION FOR THE PHASE: these rows belong in §14.2 or in a github-scoped table of
 * their own. Either is an appendix decision, not this subtask's.
 */
const GIT_AGENT_LEGACY_REASONS: readonly string[] = [
  'rate limited',
  'no PR',
  'malformed version',
];

/**
 * The same class of pre-§14.2 literal, in the PR-HOST references instead of the
 * agent — a second scoped registry, not a widening of the first.
 *
 * #326 moved the two summary operations' step 7 (the 5xx retry ceiling) out of
 * `git.md` and into `references/pr/{op}.md`. The literals are byte-identical and
 * owe §14.2 exactly what they owed before; what changed is the file that emits
 * them, and the scope is the whole point of both registries. Folding these two
 * rows back into `GIT_AGENT_LEGACY_REASONS` would exempt the wording ANYWHERE the
 * agent file appears, and vice versa — the shipped property is narrower: each
 * legacy literal is excused in the one tree that emits it and reported everywhere
 * else (applies ADR-025; the classification is per literal, per site).
 *
 * Scoped by PATH PREFIX rather than by basename, because `ensure-pr-ready.md`
 * exists under `pr/` and under every provider: a basename scope would quietly
 * excuse a provider file too.
 *
 * ACTION FOR THE PHASE, unchanged by the move: these rows belong in §14.2 or in a
 * scoped table of their own. Relocating them did not decide that.
 */
const PR_HOST_LEGACY_REASONS: readonly string[] = [
  '5xx on post-review-summary',
  '5xx on post-resolution-summary',
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
  // One level of nesting, balanced. The previous alternation was written for the
  // same purpose and could never fire: its leading `[^)]*` admits `(`, so it
  // swallowed the opening parenthesis of a nested group and the closing `\)` then
  // matched the INNER close. A split reason came back as
  // `tracker configuration mismatch (repository override` — an unregistered
  // spelling of a registered row, reported against the very agent that emits it
  // correctly. Excluding `(` from the outer class is what makes the alternation
  // reachable (STRENGTHENED, applies ADR-025).
  return [...text.matchAll(/DEGRADED \(((?:[^()]|\([^()]*\))*)\)/g)]
    .map(m => m[1].replace(/\s+/g, ' ').trim());
}

/** The D4 contract's own placeholder, in both MDS spellings. Not a reason. */
const REASON_PLACEHOLDERS: readonly string[] = ['{reason}', '\\{reason\\}'];

/**
 * Named collector: every `DEGRADED (…)` reason in a corpus that no registry
 * admits.
 *
 * The three exemption registries are consulted HERE, beside the prohibition, so
 * the rule and its exceptions are one authority (PF-067) instead of a rule in an
 * `it` and an exception buried in a corpus `.filter`.
 *
 * `GIT_AGENT_LEGACY_REASONS` is scoped to the agent file itself rather than
 * applied corpus-wide: those literals are github-op wording that predates §14.2,
 * and a generated provider reference reaching for one of them is a new reason in
 * an old spelling — which is exactly what the arm exists to report.
 */
export function collectUnregisteredReasons(corpus: readonly CorpusEntry[]): string[] {
  const unregistered: string[] = [];
  for (const entry of corpus) {
    // The parser's blind spot is SILENCE, not a false pass: a reason whose
    // parentheses are unbalanced, or nested two deep, matches nothing and is
    // dropped rather than reported, so the registry arm goes quiet about exactly
    // the spelling it exists to catch (avoids PF-064 — an absence-based guard
    // has to know it looked). Every `DEGRADED (` in the corpus must therefore
    // yield a parse.
    const opened = entry.content.match(/DEGRADED \(/g)?.length ?? 0;
    const parsed = collectDegradedReasons(entry.content);
    if (parsed.length !== opened) {
      unregistered.push(
        `${entry.path}: ${opened} "DEGRADED (" site(s) but ${parsed.length} parsed — a reason ` +
        `with unbalanced or doubly-nested parentheses is invisible to this registry, not clean`,
      );
    }
    for (const reason of parsed) {
      if (REASON_PLACEHOLDERS.includes(reason)) continue;
      if (CANONICAL_REASONS.some(canonical => reasonSpellings(canonical).includes(reason))) continue;
      if (GITHUB_ONLY_REASONS.includes(reason)) continue;
      if (entry.path === GIT_AGENT.path && GIT_AGENT_LEGACY_REASONS.includes(reason)) continue;
      if (isPrHostEntryPath(entry.path) && PR_HOST_LEGACY_REASONS.includes(reason)) continue;
      unregistered.push(`${entry.path}: "${reason}"`);
    }
  }
  return unregistered;
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
      // 18 at the tracker wave, 21 now: the mismatch reason split by cause (+2 -1),
      // the plan artifact's cap (+1) and the two-server ambiguity (+1). A floor
      // rises with the table and never falls — a shorter table is a narrowed
      // registry, whatever the reason given.
      '§14.2 fixes 21 non-`(none)` reasons; a shorter table is a narrowed registry',
    ).toBeGreaterThanOrEqual(21);
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
    // A reason may carry BOTH an instantiable placeholder and a non-instantiable
    // one. `{capability}` is drawn from the contract's closed table; `{n}` is a
    // count known only at runtime, so every spelling must still carry it verbatim.
    // A registry that instantiated `{n}` would admit an unbounded family of
    // spellings and stop being a closed vocabulary — GAP-13 by the back door.
    const ambiguitySpellings = reasonSpellings('ambiguous tracker server — {n} servers offer {capability}');
    expect(
      ambiguitySpellings,
      'the capability half must instantiate against the contract table, as it does elsewhere',
    ).toContain('ambiguous tracker server — {n} servers offer fetch by key');
    expect(
      ambiguitySpellings.filter(spelling => !spelling.includes('{n}')),
      '`{n}` has no closed domain and must survive verbatim in EVERY spelling — a spelling ' +
      'without it is one no site can emit and no reader can grep for',
    ).toEqual([]);
    expect(
      ambiguitySpellings,
      'and a capability the contract does not define is refused here too',
    ).not.toContain('ambiguous tracker server — {n} servers offer frobnicate');
    expect(
      GITHUB_ONLY_REASONS.length,
      'the github-only list is empty — the reverse arm would then be silently stricter than the ' +
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
  it('no file in the sink class emits a reason outside the canonical table', () => {
    // The WHOLE sink class, git.md included. The agent file is the largest emitter
    // of DEGRADED reasons in the tree and is always loaded, so exempting it left
    // this direction blind to the one file most likely to grow a new reason — and
    // it gained four in this phase. Its pre-§14.2 github-op literals are carried by
    // the named registry instead, where they are visible and falsifiable.
    const corpus = gitAgentSinkCorpus();
    expect(corpus.length, 'the sink-class corpus is empty — run `npm run build`').toBeGreaterThan(0);
    expect(
      corpus.some(e => e.path === GIT_AGENT.path),
      'the always-loaded agent is not in the corpus — this direction would again skip the file ' +
      'carrying the most reasons',
    ).toBe(true);
    expect(
      corpus.some(e => e.path !== GIT_AGENT.path),
      'no generated reference is in the corpus — run `npm run build`',
    ).toBe(true);

    const unregistered = collectUnregisteredReasons(corpus);
    expect(
      unregistered,
      `file(s) in the sink class emit a DEGRADED reason that is not in §14.2's table. Three ` +
      `spellings of one condition is what GAP-13 recorded: an agent emitting one and a guard ` +
      `pinning another is a degradation nobody can grep for:\n  ${unregistered.join('\n  ')}`,
    ).toEqual([]);
  });

  it('every legacy exemption is really emitted, and is really scoped to the agent file', () => {
    // The exemption half of the same authority. An entry nothing emits is a
    // permanently-open hole that reads as documentation, and an exemption that
    // applied corpus-wide would let a generated reference adopt a legacy spelling
    // silently — so both properties are asserted, not assumed.
    const gitOnly = gitAgentSinkCorpus().filter(e => e.path === GIT_AGENT.path);
    const emitted = new Set(gitOnly.flatMap(e => collectDegradedReasons(e.content)));
    const unemitted = GIT_AGENT_LEGACY_REASONS.filter(reason => !emitted.has(reason));
    expect(
      unemitted,
      `legacy exemption(s) the agent no longer emits. Delete the entry — an exemption for a reason ` +
      `nothing writes is a hole held open for nothing:\n  ${unemitted.join('\n  ')}`,
    ).toEqual([]);
    expect(
      GIT_AGENT_LEGACY_REASONS.length,
      'the legacy list is empty — then the exemption branch below is dead and the probe proves ' +
      'nothing (PF-018)',
    ).toBeGreaterThan(0);

    // Scope probe: the same literal, in a generated reference, IS reported.
    const seeded: CorpusEntry = {
      path: 'dist/skills/git/references/tracker/jira/comment.md',
      content: `On failure emit \`TRACEABILITY: DEGRADED (${GIT_AGENT_LEGACY_REASONS[0]})\`.`,
    };
    expect(
      collectUnregisteredReasons([seeded]),
      'the legacy exemption is scoped to the agent file; a provider reference reaching for the ' +
      'same wording is a new reason in an old spelling',
    ).toEqual([`${seeded.path}: "${GIT_AGENT_LEGACY_REASONS[0]}"`]);
  });

  it('every PR-host exemption is really emitted, and is really scoped to the pr/ tree', () => {
    // The mirror of the arm above for the second scoped registry (#326). Same two
    // properties, asserted the same way: nothing parked, nothing excused outside
    // the tree that emits it.
    const prOnly = gitAgentSinkCorpus().filter(e => isPrHostEntryPath(e.path));
    expect(
      prOnly.length,
      'no PR-host reference is in the corpus — run `npm run build`; without it this whole arm is ' +
      'a comparison against nothing (PF-018)',
    ).toBeGreaterThan(0);

    const emitted = new Set(prOnly.flatMap(e => collectDegradedReasons(e.content)));
    const unemitted = PR_HOST_LEGACY_REASONS.filter(reason => !emitted.has(reason));
    expect(
      unemitted,
      `PR-host exemption(s) nothing in references/${PR_HOST_DESTINATION_ROOT}/ emits. Delete the ` +
      `entry — an exemption for a reason nothing writes is a hole held open for nothing:\n  ` +
      unemitted.join('\n  '),
    ).toEqual([]);
    expect(
      PR_HOST_LEGACY_REASONS.length,
      'the PR-host legacy list is empty — then its exemption branch is dead and this probe proves ' +
      'nothing (PF-018)',
    ).toBeGreaterThan(0);

    // Scope probe, both directions of the scoping. A provider reference reaching
    // for a PR-host legacy spelling IS reported…
    const foreign: CorpusEntry = {
      path: 'dist/skills/git/references/tracker/jira/comment.md',
      content: `On failure emit \`TRACEABILITY: DEGRADED (${PR_HOST_LEGACY_REASONS[0]})\`.`,
    };
    expect(
      collectUnregisteredReasons([foreign]),
      'the PR-host exemption must not excuse a provider reference — that is a new reason in an ' +
      'old spelling',
    ).toEqual([`${foreign.path}: "${PR_HOST_LEGACY_REASONS[0]}"`]);

    // …and a pr/ reference reaching for an AGENT legacy spelling is reported too,
    // which is what keeps the two registries two rather than one with a longer list.
    // Named by value, and required to be agent-only: a literal on both lists would
    // be excused in pr/ by the PR-host exemption and prove nothing about this one.
    const AGENT_ONLY_REASON = 'malformed version';
    expect(GIT_AGENT_LEGACY_REASONS).toContain(AGENT_ONLY_REASON);
    expect(PR_HOST_LEGACY_REASONS).not.toContain(AGENT_ONLY_REASON);
    const crossed: CorpusEntry = {
      path: `dist/skills/git/references/${prHostRel('check-ci-status')}`,
      content: `On failure emit \`TRACEABILITY: DEGRADED (${AGENT_ONLY_REASON})\`.`,
    };
    expect(
      collectUnregisteredReasons([crossed]),
      'the agent-scoped exemption must not leak into the PR-host tree',
    ).toEqual([`${crossed.path}: "${AGENT_ONLY_REASON}"`]);
  });

  it('known-bad probe: a new unregistered reason in the agent file is reported', () => {
    // Drives collectUnregisteredReasons over a COPY of the shipped agent with one
    // reason appended — the mutation the live arm exists to catch, and the one that
    // passed silently while git.md was filtered out of the corpus. Built from the
    // shipped bytes so a collector that had stopped reading the agent is reported
    // here rather than staying green over a corpus it never entered.
    const seededReason = 'a reason no table registers — seeded probe';
    const wounded: CorpusEntry = {
      path: GIT_AGENT.path,
      content: `${GIT_MD}\n\nOn failure emit \`TRACEABILITY: DEGRADED (${seededReason})\`.\n`,
    };
    expect(
      collectUnregisteredReasons([wounded]),
      'appending an unregistered reason to the agent must be reported — otherwise the reverse ' +
      'direction is green about a file it never reads',
    ).toEqual([`${GIT_AGENT.path}: "${seededReason}"`]);
    expect(
      collectUnregisteredReasons([{ path: GIT_AGENT.path, content: GIT_MD }]),
      'and the shipped agent, unmodified, must be silent — or the probe above proves only that ' +
      'the collector reports everything',
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
    expect(
      collectDegradedReasons('DEGRADED (tracker configuration mismatch (repository override))'),
      'one level of nesting is what the shipped split reasons carry, and it must come back whole',
    ).toEqual(['tracker configuration mismatch (repository override)']);
  });

  it('known-bad probe: a reason the parser cannot read is REPORTED, not dropped', () => {
    // The parser bounds nesting at one level and requires balance, and both
    // limits fail SILENTLY — the site matches nothing and the registry arm has
    // nothing to object to. A guard that certifies by finding nothing has to
    // know it actually looked (avoids PF-064).
    for (const [label, body] of [
      ['unbalanced', 'emit `TRACEABILITY: DEGRADED (tracker configuration mismatch (repository override)`'],
      ['doubly nested', 'emit `TRACEABILITY: DEGRADED (outer (middle (inner)))`'],
    ] as const) {
      expect(
        collectDegradedReasons(body),
        `${label}: the parser genuinely cannot read this — that is the premise of the arm below`,
      ).toEqual([]);
      expect(
        collectUnregisteredReasons([{ path: 'probe.md', content: body }]),
        `${label}: an unparseable reason must be reported as unparseable, never as clean`,
      ).toHaveLength(1);
    }

    expect(
      collectUnregisteredReasons([{
        path: 'probe.md',
        content: 'DEGRADED (tracker configuration mismatch (repository override))',
      }]),
      'and a reason the parser CAN read is not reported by the count check — or the arm above ' +
      'proves only that the check reports everything',
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 6. The reader's rendering rule — the `#` is github's, not a literal (AC-3.11)
// ---------------------------------------------------------------------------
//
// THE TENSION THIS CLAIM RESOLVES, recorded because it is not obvious and a later
// reader will otherwise try to fix it the other way round.
//
// AC-3.1 freezes tests/fixtures/golden/github-status-lines.txt — the Phase-0
// capture — as the proof that the GitHub path gains no prompt, no new file and no
// altered byte. Line 48 of that fixture is `- **Issue**: #{number}`, so the
// Output templates in git.md are UNEDITABLE for the life of this phase.
//
// AC-3.11 wants `- **Issue**: PROJ-123` under jira. Those two ACs meet on the
// same bytes, and §14.1 is the arbiter: `#`-prefixing is a property of the GITHUB
// rendering of ISSUE_REF, not of the field. So the resolution is a RULE in the
// always-loaded reader block that reclassifies the templates' `#` as github's
// rendering — zero template bytes changed, both ACs satisfied.
//
// It has to live in the always-loaded block and nowhere else. The templates are
// always loaded, so a rule that only appears in a per-provider mechanics file
// would be a rule a spawn might not have when it renders the template (PF-058).
// That is also why this arm reads the CONTRACT BLOCK rather than the whole file:
// the clause appearing somewhere in git.md is not the claim.

/** One clause the reader block owes, and the shape that recognises it. */
interface ContractClause {
  readonly label: string;
  readonly pattern: RegExp;
  readonly why: string;
}

const RENDERING_CLAUSES: readonly ContractClause[] = [
  {
    label: 'the non-github rendering takes `## Reference Rendering`\'s form',
    pattern: /`## Reference Rendering`'s form/,
    why:
      'the section is already listed as one the contract reads; this is the clause that says what ' +
      'the reader DOES with it, which is the half AC-3.11 needs',
  },
  {
    // RE-POINTED, not deleted. The old spelling was a PROHIBITION on the rendered
    // output ("never `#`-prefixed"), which is the shape the rule had to take while
    // the Output templates were frozen byte-for-byte and still spelled `#{number}`.
    // The templates now carry `{ISSUE_REF}`, so the rule states the POSITIVE github
    // rendering instead — the half a github spawn needs, and the half a prohibition
    // could never supply.
    label: 'the github rendering of an issue ref is named',
    pattern: /`#\{number\}` under github/,
    why:
      '§14.1 fixes ISSUE_REF as `#`-prefixed under github ONLY. Without this the token is ' +
      'unresolved on the github path, and the one provider whose exact bytes the golden fixture ' +
      'pins is the one with no instruction for rendering its own references',
  },
];

// The third clause is RETIRED with the template freeze it existed to work around.
// It required the always-loaded block to say the templates' `#` "is github's
// rendering, not a literal" — a reclassification, chosen because AC-3.1 froze the
// template bytes and the `#` could not be edited out. The bytes are editable now
// and the `#` is gone from every issue slot, so a rule reclassifying a character
// that is no longer there would be a rule about nothing.

/** Named collector: rendering clauses the reader block does not state. */
export function collectMissingRenderingClauses(
  label: string,
  block: string,
  clauses: readonly ContractClause[],
): string[] {
  return clauses
    .filter(clause => !clause.pattern.test(block))
    .map(clause => `${label}: missing ${clause.label} — ${clause.why}`);
}

describe('the reader block states the non-github rendering rule (AC-3.11, §14.1)', () => {
  it('names the unprefixed provider-canonical form and reclassifies the templates\' `#`', () => {
    const violations = collectMissingRenderingClauses(
      PREAMBLE_CONTRACT_HEADING,
      preambleContractBlock(),
      RENDERING_CLAUSES,
    );
    expect(
      violations,
      `the always-loaded reader block is missing clause(s) AC-3.11 depends on:\n  ` +
      violations.join('\n  '),
    ).toEqual([]);
  });

  it('every issue slot renders through the token, and the PR slots keep their `#`', () => {
    // The successor to the "templates still carry the `#`" arm, which asserted the
    // exact opposite: it existed to hold the frozen bytes in place while the rule
    // above reclassified them. The claim it becomes is the one that was always
    // wanted — every ISSUE slot renders through the provider-neutral token — plus
    // the discrimination the sweep needed: the PR slots are correct as `#` under
    // every provider, because pull requests stay on the PR host, and a rewrite that
    // swept them along would render a PR reference no host resolves.
    for (const slot of ['- **Issue**: {ISSUE_REF}', '- **Number**: {ISSUE_REF}', '## Issue {ISSUE_REF']) {
      expect(GIT_MD, `the Output templates must carry ${JSON.stringify(slot)}`).toContain(slot);
    }
    expect(
      GIT_MD,
      'the PR slots keep their `#` — sweeping them into the issue-token rule would render a pull ' +
      'request reference no host resolves',
    ).toContain('- **PR**: #{number}');
    expect(
      GIT_MD.includes('- **Issue**: #{number}'),
      'no issue slot may still spell the bare `#` rendering — that is the defect the token replaces',
    ).toBe(false);
  });

  it('known-bad probe: each clause, deleted from a copy, is reported by the same collector', () => {
    // Mechanic (b) — built from the shipped bytes inside this `it`, per ROW, so a
    // pattern that has drifted off the shipped wording cannot sit here matching
    // nothing while the arm above passes on the other two (PF-018).
    const pristine = preambleContractBlock();
    expect(
      collectMissingRenderingClauses('pristine', pristine, RENDERING_CLAUSES),
      'the collector must be silent on the shipped block, or the probe proves nothing',
    ).toEqual([]);

    for (const clause of RENDERING_CLAUSES) {
      const wounded = pristine.replace(clause.pattern, '');
      expect(
        wounded,
        `the pattern for "${clause.label}" matched nothing in the shipped block, so deleting it ` +
        `was a no-op and the row cannot be shown live`,
      ).not.toBe(pristine);
      expect(
        collectMissingRenderingClauses('wounded', wounded, RENDERING_CLAUSES)
          .map(v => v.split(' — ')[0]),
        `removing "${clause.label}" must be reported by the same collector`,
      ).toContain(`wounded: missing ${clause.label}`);
    }
    expect(RENDERING_CLAUSES.length, 'the clause table is empty (PF-018)').toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 7. The read-site shape gate for `## Reference Rendering` (security-02)
// ---------------------------------------------------------------------------
//
// `## Reference Rendering`'s token is not a display preference: it is
// interpolated into a branch name and into a PR body. `~/.devflow/tracker.md` is
// hand-editable, machine-wide and written by an LLM, so a token that violates the
// writer's own schema row is a NORMAL outcome rather than an attack — prose is not
// prevention (PF-060) — and the gate therefore has to exist on the side that does
// the interpolating. A mechanics file naming "the read-site shape gate" while the
// shape is stated only in the Tracker agent, which the Git agent never loads, is a
// control asserted and not implemented (PF-058/PF-023).
//
// The oracle is declared HERE and each side is compared to it, never to the other:
// two sides that had both lost the denylist would agree with each other perfectly.
// The two sides spell the same denylist differently — the writer's table column
// names the characters in words, the reader's prose shows them — so each member
// carries both spellings and neither can be satisfied by the other's.

/** The anchored shape both sides owe, byte-for-byte. */
const RENDER_TOKEN_SHAPE = '^[A-Za-z0-9 #{}/_.-]{1,60}$';

/** One denied metacharacter, in the spelling each side uses for it. */
interface DeniedMetachar {
  readonly label: string;
  readonly writer: RegExp;
  readonly reader: RegExp;
}

const RENDER_TOKEN_DENYLIST: readonly DeniedMetachar[] = [
  { label: 'backtick', writer: /backtick/, reader: /backtick/ },
  { label: 'dollar', writer: /dollar/, reader: /`\$`/ },
  { label: 'double quote', writer: /double-quote/, reader: /`"`/ },
  { label: 'backslash', writer: /backslash/, reader: /`\\`/ },
  { label: 'semicolon', writer: /semicolon/, reader: /`;`/ },
  { label: 'newline', writer: /newline/, reader: /newline/ },
];

/**
 * The generated references that RENDER a `## Reference Rendering` token.
 *
 * Identified by the discard record they owe — a `### Substitutions` row — rather
 * than by a list of filenames or by the gate's own wording. A filename list rots
 * silently when an operation is added; keying on the gate's wording would make the
 * arm circular, green whenever the sentence is present and blind whenever it is
 * rephrased. `setup-task` names the section but substitutes no token, so it is
 * correctly not in this set.
 */
function renderSiteReferences(): CorpusEntry[] {
  const refs = compiledSkillRefsDir();
  return walkFiles(path.join(refs, 'tracker'), f => f.endsWith('.md'))
    .map(file => ({ path: path.relative(refs, file), content: readFileSync(file, 'utf-8') }))
    .filter(entry => entry.content.includes('### Substitutions'));
}

/** Named collector: parts of the gate a READ SITE does not state. */
export function collectMissingReadSiteGate(label: string, text: string): string[] {
  const missing: string[] = [];
  if (!text.includes(RENDER_TOKEN_SHAPE)) {
    missing.push(`${label}: the anchored shape ${RENDER_TOKEN_SHAPE}`);
  }
  for (const m of RENDER_TOKEN_DENYLIST) {
    if (!m.reader.test(text)) missing.push(`${label}: the denied ${m.label}`);
  }
  if (!/[Dd]iscard, never repair/.test(text)) {
    missing.push(`${label}: discard-never-repair — a repaired token is unpredictable`);
  }
  if (!text.includes('### Substitutions')) {
    missing.push(`${label}: the \`### Substitutions\` record a discard owes`);
  }
  return missing;
}

/** Named collector: parts of the gate the WRITER's schema row does not state. */
export function collectMissingWriterGate(validator: string): string[] {
  const missing: string[] = [];
  if (!validator.includes(RENDER_TOKEN_SHAPE)) {
    missing.push(`the anchored shape ${RENDER_TOKEN_SHAPE}`);
  }
  for (const m of RENDER_TOKEN_DENYLIST) {
    if (!m.writer.test(validator)) missing.push(`the denied ${m.label}`);
  }
  return missing;
}

describe('the read site carries the `## Reference Rendering` gate it names (security-02)', () => {
  const RENDERING_SECTION = '`## Reference Rendering`';

  it('non-vacuity: the render sites are the two token-substituting ops, per tool-call provider', () => {
    const sites = renderSiteReferences().map(e => e.path).sort();
    // Named, not counted: a count is satisfied by any four files, and the claim is
    // about WHICH operations interpolate the token. Derived from the registry's
    // provider list so a provider registered later joins by construction.
    const expected = (MCP_BACKED_PROVIDER_SUBDIRS as readonly string[])
      .flatMap(subdir => [`${subdir}/create-release.md`, `${subdir}/ensure-pr-ready.md`])
      .map(rel => rel.split('/').join(path.sep))
      .sort();
    expect(expected.length, 'no tool-call provider is registered (PF-018)').toBeGreaterThan(0);
    expect(
      sites,
      'the set of references that record a `### Substitutions` discard changed. An operation ' +
      'that renders the token without recording a discard is the silent half of this gate; one ' +
      'that dropped out of the set is a render site nothing below reads',
    ).toEqual(expected);
  });

  it('every render site states the shape, the denylist, the discard rule and the record', () => {
    const violations = renderSiteReferences()
      .flatMap(entry => collectMissingReadSiteGate(entry.path, entry.content));
    expect(
      violations,
      'a read site names the gate without stating it, so the token reaches a branch name and a ' +
      `PR body ungated:\n  ${violations.join('\n  ')}`,
    ).toEqual([]);
  });

  it('the WRITER states the same shape and the same denylist — compared to the oracle, not to the reader', () => {
    const row = collectTrackerSchemaRows(TRACKER_MD).find(r => r.section === RENDERING_SECTION);
    expect(
      row,
      `the Tracker agent's schema table has no ${RENDERING_SECTION} row, so the writer half of ` +
      'this seam would pass by comparing nothing',
    ).toBeDefined();
    const missing = collectMissingWriterGate(row?.validator ?? '');
    expect(
      missing,
      `the writer's ${RENDERING_SECTION} shape gate is missing:\n  ${missing.join('\n  ')}`,
    ).toEqual([]);
  });

  it('known-bad probe: each part, removed from a copy, is reported by the same collector', () => {
    // Built from the shipped bytes inside this `it`, per PART, so a predicate that
    // drifted off the shipped wording cannot sit here matching nothing (PF-018).
    const site = renderSiteReferences()[0];
    expect(site, 'no render site to probe').toBeDefined();
    const pristine = site.content;
    expect(
      collectMissingReadSiteGate('pristine', pristine),
      'the collector must be silent on a shipped render site, or the probe proves nothing',
    ).toEqual([]);

    const wounds: ReadonlyArray<{ fragment: string; reports: string }> = [
      { fragment: RENDER_TOKEN_SHAPE, reports: `the anchored shape ${RENDER_TOKEN_SHAPE}` },
      { fragment: 'backtick', reports: 'the denied backtick' },
      { fragment: '`$`', reports: 'the denied dollar' },
      { fragment: '`"`', reports: 'the denied double quote' },
      { fragment: '`\\`', reports: 'the denied backslash' },
      { fragment: '`;`', reports: 'the denied semicolon' },
      { fragment: 'newline', reports: 'the denied newline' },
      { fragment: 'Discard, never repair', reports: 'discard-never-repair' },
      { fragment: '### Substitutions', reports: '`### Substitutions`' },
    ];
    for (const { fragment, reports } of wounds) {
      const wounded = pristine.split(fragment).join('');
      expect(wounded, `removing ${JSON.stringify(fragment)} changed nothing — the probe is inert`)
        .not.toBe(pristine);
      expect(
        collectMissingReadSiteGate('wounded', wounded).join('\n'),
        `removing ${JSON.stringify(fragment)} must be reported by the same collector`,
      ).toContain(reports);
    }

    // …and the writer side, driven through its own collector for the same reason.
    const row = collectTrackerSchemaRows(TRACKER_MD).find(r => r.section === RENDERING_SECTION);
    const validator = row?.validator ?? '';
    expect(collectMissingWriterGate(validator), 'the shipped row must be clean').toEqual([]);
    expect(
      collectMissingWriterGate(validator.split(RENDER_TOKEN_SHAPE).join('')),
      'a writer row that lost the anchored shape must be reported',
    ).toContain(`the anchored shape ${RENDER_TOKEN_SHAPE}`);
    expect(
      collectMissingWriterGate(validator.split('semicolon').join('')),
      'a writer row that lost a denylist member must be reported',
    ).toContain('the denied semicolon');
  });
});

// ---------------------------------------------------------------------------
// 8. Two-server scoping: a unique qualifying server, or no call (AC-13)
// ---------------------------------------------------------------------------
//
// Two connected servers that both offer tracker capabilities is the one
// configuration in which a write can land in somebody else's tracker and nothing
// downstream can tell. The contract answers it with SIX clauses, and this is a
// clause table rather than one substring for the reason PF-018 gives: a rule that
// kept its DEGRADED literal and lost its affinity clause would satisfy any
// single-fragment assertion while routing the second half of one operation to the
// other server.
//
// Each clause carries its own detector and its own known-bad probe below, so a
// clause removed from the contract takes exactly one named assertion red with it
// — never zero, and never the whole file.

interface ScopingClause {
  readonly name: string;
  /** Detector over the emitted subsection. */
  readonly detector: RegExp;
  /** A byte-exact fragment whose removal must make `detector` fail (the probe). */
  readonly wound: string;
  readonly why: string;
}

/** The heading that opens the subsection, byte-exact as the contract spells it. */
const SCOPING_HEADING = '### Which server, when more than one is connected';

const TWO_SERVER_CLAUSES: readonly ScopingClause[] = [
  {
    name: 'partition by server',
    detector: /partition/i,
    wound: 'Partition',
    why:
      'without a partition there is no "server" to be ambiguous between, and every rule below ' +
      'degenerates into "pick a tool", which is the state that lets one operation straddle two ' +
      'servers. The transport acronym cannot be spelled here (provider-scope forbids it in every ' +
      'loadable file), so the partition is stated by the tool name\'s leading namespace segment',
  },
  {
    name: 'per-capability qualification',
    detector: /per CAPABILITY, never per server/,
    wound: 'per CAPABILITY, never per server',
    why:
      'qualification per SERVER is the defect: a server that can create an issue would be ' +
      'promoted to receive the comment too, and the second call is the one that lands in the ' +
      'wrong place. The capability is the unit because the capability is what the mechanics ask for',
  },
  {
    name: 'unique winner needs no further evidence',
    detector: /[Ee]xactly one qualifying server/,
    wound: 'Exactly one qualifying server',
    why:
      'a single terse server — one whose descriptions never name the tracker — is still the only ' +
      'thing that can serve the capability. Requiring vocabulary evidence of it would degrade on ' +
      'terseness, which is a property of the server\'s documentation and not of the routing',
  },
  {
    name: 'two or more is DEGRADED and no call',
    detector: /DEGRADED \(ambiguous tracker server — \{n\} servers offer \{capability\}\)/,
    wound: 'ambiguous tracker server',
    why:
      'the registered reason and the refusal it names. Without the refusal the reason is advice: ' +
      'an agent that reports the ambiguity and then calls anyway has written into a tracker it ' +
      'could not identify, and the DEGRADED line makes that look handled',
  },
  {
    name: 'affinity pinned for the spawn',
    detector: /pinned for the whole spawn/,
    wound: 'pinned for the whole spawn',
    why:
      're-deciding per call is how the read and the write of one operation land on two servers. ' +
      'The decision is made once because the operation is one operation',
  },
  {
    name: 'corroborating read, once per spawn',
    detector: /once per spawn\*\* — never per item/,
    wound: 'never per item',
    why:
      'the write scope check, and its bound. A corroborating read per ITEM turns a fifty-issue ' +
      'backlink into a hundred calls (design review H2); a corroborating read per SPAWN is one ' +
      'fetch of the project by key, which is all the evidence the routing needs',
  },
];

/** The emitted tool-call contract, read fail-loud. */
function toolCallContract(): string {
  const file = path.join(compiledSkillRefsDir(), 'tracker', '_mcp.md');
  const content = readFileSync(file, 'utf-8');
  if (content.trim() === '') throw new Error(`${file} is empty — this section has no subject`);
  return content;
}

/**
 * Named collector: the two-server subsection of a contract text, or `''`.
 *
 * Sliced heading-to-next-heading so the negative arm below cannot be satisfied by
 * a `no tracker tool for` that lives in a different subsection of the same file.
 */
export function sliceScopingSection(text: string): string {
  const start = text.indexOf(SCOPING_HEADING);
  if (start === -1) return '';
  const rest = text.slice(start + SCOPING_HEADING.length);
  const end = rest.indexOf('\n### ');
  return end === -1 ? rest : rest.slice(0, end);
}

/** Named collector: clauses the two-server rule does not state. */
export function collectMissingScopingClauses(section: string): string[] {
  return TWO_SERVER_CLAUSES
    .filter(clause => !clause.detector.test(section))
    .map(clause => `${clause.name} — ${clause.why}`);
}

describe('the two-server scoping rule states every clause (AC-13)', () => {
  it('the registry and the corpus it ranges over are both real (PF-018)', () => {
    expect(TWO_SERVER_CLAUSES.length, 'an empty clause table asserts nothing').toBeGreaterThan(0);
    for (const clause of TWO_SERVER_CLAUSES) {
      expect(clause.why.trim().length, `${clause.name}: a clause without a reason is a grep`)
        .toBeGreaterThan(40);
      expect(clause.wound.length, `${clause.name}: an empty wound makes its probe inert`)
        .toBeGreaterThan(0);
    }
    expect(
      new Set(TWO_SERVER_CLAUSES.map(c => c.name)).size,
      'two clauses sharing a name have no per-clause accounting',
    ).toBe(TWO_SERVER_CLAUSES.length);
  });

  it('the shipped contract states all six clauses', () => {
    const section = sliceScopingSection(toolCallContract());
    expect(
      section,
      `the contract has no ${SCOPING_HEADING} subsection — two connected servers is the ` +
      'configuration AC-13 exists for, and without the subsection nothing scopes a write',
    ).not.toBe('');
    const missing = collectMissingScopingClauses(section);
    expect(
      missing,
      `clause(s) the two-server rule does not state:\n  ${missing.join('\n  ')}`,
    ).toEqual([]);
  });

  it('the plural case does NOT reuse the singular capability reason', () => {
    // `no tracker tool for {capability}` means "nothing offers it". The plural case
    // is the opposite — SEVERAL things offer it — and answering both with one
    // literal is the GAP-13 shape: a user reading the status cannot tell whether to
    // connect a server or disconnect one, and a grep cannot separate the two.
    const section = sliceScopingSection(toolCallContract());
    expect(section, 'no subsection to check').not.toBe('');
    expect(
      section,
      'the ambiguity case must carry its own registered reason, not the unavailability one',
    ).not.toContain('no tracker tool for');
    expect(
      section,
      'and it must carry the registered spelling, on one line, so the registry\'s forward arm ' +
      'has a site to find',
    ).toContain('DEGRADED (ambiguous tracker server — {n} servers offer {capability})');
  });

  it('known-bad probe: each clause, removed from a copy, is reported by the same collector', () => {
    const pristine = sliceScopingSection(toolCallContract());
    expect(
      collectMissingScopingClauses(pristine),
      'the collector must be silent on the shipped subsection, or every probe below proves nothing',
    ).toEqual([]);
    for (const clause of TWO_SERVER_CLAUSES) {
      const wounded = pristine.split(clause.wound).join('');
      expect(wounded, `removing ${JSON.stringify(clause.wound)} changed nothing — probe is inert`)
        .not.toBe(pristine);
      expect(
        collectMissingScopingClauses(wounded).join('\n'),
        `removing ${JSON.stringify(clause.wound)} must be reported as "${clause.name}"`,
      ).toContain(clause.name);
    }
  });
});
