/**
 * `associate-release` (#364, PR5) — each shipped issue is added to the release's
 * tracker marker, and no marker an issue already holds is ever replaced.
 *
 * The contract lives in `dist/agents/git.md` and names no marker: it says "the
 * release's tracker marker". Each provider reference says what that is and how it
 * is written, and the three differ in the one way that decides the whole design:
 *
 *   - GitHub's milestone is SINGLE-valued, so "never replace" means an item that
 *     holds another milestone is left alone. The milestone is created first (one
 *     call when new), an HTTP 422 `already_exists` is the only route to a lookup,
 *     and the lookup is an explicit ≤10-page walk (D7) — `--paginate` has no page
 *     bound. One aliased read and one aliased mutation cover the ≤50 items, and
 *     every alias is parsed even when `gh` exits 1, because a partial GraphQL
 *     failure is still a partial success.
 *   - Jira's `fixVersions` and Linear's labels are MULTI-valued, but a stock
 *     field write REPLACES the set. So the add is a read-modify-write — current ∪
 *     new — and only over a field the batch read returned whole; anything else
 *     is DEGRADED with no write. The union write's own race window is written
 *     down, as GitHub's is.
 *
 * The Jira and Linear mechanics select by two capabilities — *release versions or
 * labels* and *edit issue fields* — so both must be rows of the built tool-call
 * contract, which #364 held at its pre-existing size (TP-12).
 *
 * Nothing is posted: there is no body, so D11 does not apply and no posting verb
 * may appear. The caller gates the spawn (`tests/tracker/compliance-gate.test.ts`),
 * so the evidence policy is never named here either.
 *
 * Every guard below is a NAMED collector over a named corpus, with a known-bad
 * probe driving the same collector (PF-064): a clause table that could not be
 * shown to fire would be a table that can lose a row unnoticed.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import * as path from 'path';

import { compiledSkillRefsDir } from '../../src/core/assets.js';
import { TRACKER_OPS } from '../../src/core/mds-variants.js';
import { extractOpSectionFromCorpus, resolveAgentSource } from '../helpers.js';

const OP = 'associate-release';

/** The providers whose mechanics ship — hardcoded, so one that stops generating fails here. */
const PROVIDERS = ['github', 'jira', 'linear'] as const;
type ProviderToken = (typeof PROVIDERS)[number];

function readReference(provider: ProviderToken): string {
  const rel = `tracker/${provider}/${OP}.md`;
  const abs = path.join(compiledSkillRefsDir(), ...rel.split('/'));
  if (!existsSync(abs)) {
    throw new Error(`${rel} is absent at ${abs} — run \`npm run build\` first (this guard reads compiled references)`);
  }
  return readFileSync(abs, 'utf-8');
}

function contractSection(): string {
  const git = resolveAgentSource('git');
  return extractOpSectionFromCorpus([{ path: git.path, content: git.content }], OP, { mode: 'sole' }).content;
}

/** The built tool-call contract, which every Jira and Linear spawn loads. */
const MCP_CONTRACT_REL = 'tracker/_mcp.md';

function readContract(): string {
  const abs = path.join(compiledSkillRefsDir(), ...MCP_CONTRACT_REL.split('/'));
  if (!existsSync(abs)) {
    throw new Error(`${MCP_CONTRACT_REL} is absent at ${abs} — run \`npm run build\` first (this guard reads the compiled contract)`);
  }
  return readFileSync(abs, 'utf-8');
}

// ---------------------------------------------------------------------------
// The clause table — what each provider's reference must state
// ---------------------------------------------------------------------------

/** One clause a provider reference owes, and why a reference without it is wrong. */
interface Clause {
  readonly id: string;
  readonly literal: string;
  readonly why: string;
}

const COMMON_CLAUSES: readonly Clause[] = [
  {
    id: 'entry gate',
    literal: 'Ref pre-flight (the always-loaded entry gate, instantiated for this provider).',
    why: 'every SHIPPED_ISSUES entry is shape-gated before it reaches a call',
  },
  {
    id: 'never COMPLETE over zero',
    literal: 'never report the status as `COMPLETE`',
    why: 'a COMPLETE over zero processed issues is the report a release believes',
  },
  {
    id: 'marker name',
    literal: 'v{BARE_VERSION}',
    why: 'the marker is named from BARE_VERSION, so `v1.2.3` never becomes `vv1.2.3`',
  },
  {
    id: 'backpressure pointer',
    literal: 'in this operation\'s `backlink-shipped-issues` reference',
    why: 'the provider\'s rate-limit signal has one authority, and this op points at it',
  },
];

const PROVIDER_CLAUSES: Readonly<Record<ProviderToken, readonly Clause[]>> = {
  github: [
    {
      id: 'create first',
      literal: 'gh api --method POST "repos/{owner}/{repo}/milestones" -f title="v{BARE_VERSION}"',
      why: 'create-first is one call when the milestone is new, and the title is a -f field, never interpolated into a path',
    },
    {
      id: 'raw error body',
      literal: 'never `--jq` over an error body',
      why: 'a 422 body is JSON only by convention; a jq filter over it can fail and hide the code',
    },
    {
      id: 'already_exists',
      literal: 'HTTP 422 whose `errors[].code` includes `already_exists`',
      why: 'only this code means "it exists"; any other 422 is a failure, not a lookup',
    },
    {
      id: 'bounded walk',
      literal: '-f state=all -f per_page=100 -f page=N`, N = 1…10, stopping at the first page under 100 items',
      why: 'D7: the lookup is an explicit ≤10-page walk over open AND closed milestones',
    },
    {
      id: 'closed',
      literal: '`closed` ⇒ `TRACEABILITY: DEGRADED (release marker closed)`',
      why: 'a closed milestone is not re-opened behind the user\'s back',
    },
    {
      id: 'no item call',
      literal: 'Each of these makes no item call.',
      why: 'a marker that could not be resolved must not be half-applied',
    },
    {
      id: 'aliased read',
      literal: '`iN: issue(number:N){ id milestone{ number } }`',
      why: 'one batched read answers which items already hold a milestone',
    },
    {
      id: 'read parsed on exit 1',
      literal: 'Read every alias even when `gh` exits 1: a null or absent alias ⇒ that item DEGRADED',
      why: 'one PR number or unknown ref nulls its alias and makes `gh` exit 1; the other aliases still answer',
    },
    {
      id: 'no replace',
      literal: 'another ⇒ Kept other release, left untouched',
      why: 'a milestone is single-valued; assigning over another release REPLACES it',
    },
    {
      id: 'mutation only over the empty',
      literal: 'one mutation over the items with no milestone',
      why: 'the mutation set is exactly the items step 3 found with no milestone',
    },
    {
      id: 'node-id gate',
      literal: '`^[A-Za-z0-9_=-]{1,100}$`',
      why: 'node IDs are response values interpolated into a query and are gated at that sink',
    },
    {
      id: 'per-alias parse',
      literal: 'Parse every alias even when `gh` exits 1',
      why: 'a GraphQL response with errors still carries every alias that succeeded',
    },
    {
      id: 'race documented',
      literal: 'Residual race, not closed:',
      why: 'GitHub has no conditional update, and an unclosed race is written down, not implied away',
    },
  ],
  jira: [
    {
      id: 'marker capability',
      literal: '*release versions or labels* capability',
      why: 'the version is resolved through a capability the contract table defines',
    },
    {
      id: 'archived',
      literal: 'unless archived ⇒ `TRACEABILITY: DEGRADED (release marker closed)`',
      why: 'an archived version is not assignable and is not un-archived here',
    },
    {
      id: '403',
      literal: 'a 403, a denial or any other failure ⇒ `TRACEABILITY: DEGRADED (release marker unavailable)`',
      why: 'creating a version needs project-admin rights, which the account may not hold',
    },
    {
      id: 'no item call',
      literal: 'Either DEGRADED makes no item call.',
      why: 'a marker that could not be resolved must not be half-applied',
    },
    {
      id: 'one batch read',
      literal: 'one *batch fetch* over the admitted keys, bounded `≤50`',
      why: 'the current field values come from one read, never one per item',
    },
    {
      id: 'read-modify-write',
      literal: 'current `fixVersions` ∪ the version, and only when step 2 returned that field whole',
      why: 'a stock field write replaces the set; a union over a partial read would still drop a release',
    },
    {
      id: 'edit capability',
      literal: '*edit issue fields* capability',
      why: 'the write goes through a capability the contract table defines',
    },
    {
      id: 'race documented',
      literal: '**Residual race, not closed:** the union write drops a version another writer adds between steps 2 and 3',
      why: 'a read-modify-write has the same unclosed window as GitHub\'s read-then-assign, and it is written down',
    },
  ],
  linear: [
    {
      id: 'marker capability',
      literal: '*release versions or labels* capability',
      why: 'the label is resolved through a capability the contract table defines',
    },
    {
      id: 'exact-name reuse',
      literal: 'Exactly one ⇒ reuse it, `existing`',
      why: 'a label already carrying the release name is the marker; a second one is not created',
    },
    {
      id: 'ambiguous',
      literal: 'two or more ⇒ `TRACEABILITY: DEGRADED (ambiguous release marker)`',
      why: 'choosing between two same-named labels would be a guess',
    },
    {
      id: 'no item call',
      literal: 'Either DEGRADED makes no item call.',
      why: 'a marker that could not be resolved must not be half-applied',
    },
    {
      id: 'one batch read',
      literal: 'one *batch fetch* over the admitted references, bounded `≤50`',
      why: 'the current labels come from one read, never one per item',
    },
    {
      id: 'replaces the set',
      literal: 'The stock issue update REPLACES the label set',
      why: 'the reason the add must be a read-modify-write is stated where the write is',
    },
    {
      id: 'read-modify-write',
      literal: 'current labels ∪ the release label, and only when step 2 returned them whole',
      why: 'a union over a partial read would still drop a label',
    },
    {
      id: 'race documented',
      literal: '**Residual race, not closed:** the union write drops a label another writer adds between steps 2 and 3',
      why: 'a read-modify-write has the same unclosed window as GitHub\'s read-then-assign, and it is written down',
    },
  ],
};

/** Named collector: the clause ids a reference body does not state. */
export function collectMissingClauses(body: string, clauses: readonly Clause[]): string[] {
  return clauses.filter(clause => !body.includes(clause.literal)).map(clause => clause.id);
}

// ---------------------------------------------------------------------------
// Negative collectors — what no associate-release reference may contain
// ---------------------------------------------------------------------------

/**
 * Posting shapes. There is no body to scrub, so any of these is a sink this
 * operation has no business opening — and one that would escape D11's guards,
 * which only visit ops that are SUPPOSED to post.
 */
const POSTING_SHAPES: ReadonlyArray<{ readonly name: string; readonly re: RegExp }> = [
  { name: 'body file', re: /--body-file|-F body=@|-f body=/ },
  { name: 'gh comment', re: /gh (?:issue|pr) comment/ },
  { name: 'comment capability', re: /\*add comment\*/ },
  { name: 'posting gate', re: /### Posting gate|\{SCRUBBED_BODY\}|redact-secrets/ },
  { name: 'D11 scrub', re: /Comment-sink scrub/ },
];

/** Named collector: posting shapes in a body, as `name: line`. */
export function collectPostingShapes(body: string): string[] {
  const hits: string[] = [];
  for (const line of body.split('\n')) {
    for (const shape of POSTING_SHAPES) {
      if (shape.re.test(line)) hits.push(`${shape.name}: ${line.trim().slice(0, 100)}`);
    }
  }
  return hits;
}

/** Named collector: the evidence policy named in an op file — the caller's decision, never the op's. */
export function collectPolicyNames(body: string): string[] {
  return body.split('\n').filter(line => /\bEVIDENCE_POLICY\b/.test(line)).map(line => line.trim());
}

/**
 * Named collector: unbounded page walks. `--paginate` follows `Link` headers with
 * no page count, and a `page=` walk must state its bound on the same line.
 */
export function collectUnboundedWalks(body: string): string[] {
  return body.split('\n').filter(line =>
    line.includes('--paginate') || (/\bpage=N\b/.test(line) && !/N = 1…10\b/.test(line)),
  );
}

/** Named collector: every `gh api graphql` invocation — the batched calls, counted. */
export function collectGraphqlCalls(body: string): string[] {
  return [...body.matchAll(/gh api graphql[^`]*/g)].map(m => m[0]);
}

/** The `DEGRADED (…)` reasons a text spells, one level of nesting. */
function degradedReasons(text: string): string[] {
  return [...text.matchAll(/DEGRADED \(((?:[^()]|\([^()]*\))*)\)/g)].map(m => m[1]);
}

/** The marker reasons each provider emits — and, by omission, the ones it must not. */
const MARKER_REASONS: Readonly<Record<ProviderToken, readonly string[]>> = {
  github: ['release marker unavailable', 'release marker closed'],
  jira: ['release marker closed', 'release marker unavailable'],
  linear: ['ambiguous release marker', 'release marker unavailable'],
};
const ALL_MARKER_REASONS = ['release marker unavailable', 'release marker closed', 'ambiguous release marker'];

/** Named collector: marker reasons a provider spells that it does not own, or owns and never spells. */
export function collectMarkerReasonDrift(provider: ProviderToken, body: string): string[] {
  const spelled = new Set(degradedReasons(body).filter(reason => ALL_MARKER_REASONS.includes(reason)));
  const owned = new Set(MARKER_REASONS[provider]);
  return [
    ...[...owned].filter(reason => !spelled.has(reason)).map(reason => `missing "${reason}"`),
    ...[...spelled].filter(reason => !owned.has(reason)).map(reason => `unowned "${reason}"`),
  ];
}

// ---------------------------------------------------------------------------
// The tool-call contract — the two capability rows and the size they fit in
// ---------------------------------------------------------------------------

/** The capabilities this op's Jira and Linear mechanics select by, both added to the contract by #364. */
const OP_CAPABILITIES = ['release versions or labels', 'edit issue fields'] as const;

/**
 * The tool-call contract's ceiling, in characters (`.length`, the byte-budget unit).
 *
 * #364's design holds `_mcp.md` at ≤ 7,963 — net zero: the two rows (+146 ch) were
 * funded by condensing unpinned contract prose, and no define was added. Measured
 * 7,961 after c6f3fbda. Every Jira and Linear spawn loads this file, so its growth
 * lands in both tool-call loaded sets.
 */
const MCP_CONTRACT_MAX_CHARS = 7_963;

/**
 * Named collector: the contract table's rows, capability → its `Unavailable ⇒` cell.
 * The row parse is `collectContractCapabilities`'s (tests/seams/tracker-dedup-ladder.test.ts):
 * a `| ` line, first cell, header and separator skipped — kept local so importing
 * that test file does not register its arms a second time here.
 */
export function collectContractRows(contract: string): Map<string, string> {
  const rows = new Map<string, string>();
  for (const line of contract.split('\n')) {
    if (!/^\| /.test(line)) continue;
    const [, capability = '', unavailable = ''] = line.split('|').map(cell => cell.trim());
    if (capability === '' || capability === 'Capability' || /^-+$/.test(capability)) continue;
    rows.set(capability, unavailable);
  }
  return rows;
}

/** Named collector: what the contract owes this op — each row, degrading by its own name — and its size. */
export function collectContractDefects(contract: string): string[] {
  const rows = collectContractRows(contract);
  const defects = OP_CAPABILITIES.flatMap(capability => {
    const unavailable = rows.get(capability);
    if (unavailable === undefined) return [`missing row "${capability}"`];
    const expected = `\`no tracker tool for ${capability}\``;
    return unavailable === expected ? [] : [`row "${capability}" does not degrade as ${expected}`];
  });
  if (contract.length > MCP_CONTRACT_MAX_CHARS) {
    defects.push(`${MCP_CONTRACT_REL} is ${contract.length} ch, over ${MCP_CONTRACT_MAX_CHARS}`);
  }
  return defects;
}

// ---------------------------------------------------------------------------
// The arms
// ---------------------------------------------------------------------------

describe('associate-release: registered for every provider (AC-10)', () => {
  it('is on the op roster, so every provider generates it', () => {
    expect(TRACKER_OPS).toContain(OP);
  });

  for (const provider of PROVIDERS) {
    it(`${provider}: the reference opens on its own anchor and names its provider`, () => {
      const body = readReference(provider);
      expect(body.split('\n')[0]).toBe(`## Operation: ${OP}`);
      expect(body).toContain(`Load when the resolved tracker provider is \`${provider}\` and the operation is \`${OP}\`.`);
    });
  }
});

describe('associate-release: the contract in git.md', () => {
  const section = contractSection();

  it('declares its inputs, its degradation and its mechanics pointer', () => {
    expect(section).toContain('**Input:** `SHIPPED_ISSUES`, `VERSION`, `WORKTREE_PATH` (optional)');
    expect(section).toContain('**Degradation (D4):** as `backlink-shipped-issues`');
    expect(section).toContain('**Mechanics:** load this operation\'s provider reference.');
  });

  it('resolves the marker once, bounds the items at ≤50 and never reports COMPLETE over zero', () => {
    expect(section).toContain('resolve the marker once, before the first ≤50 entries');
    expect(section).toContain('`TRUNCATED ({n} not processed)`');
    expect(section).toContain('never `COMPLETE` over zero processed');
  });

  it('its Output reports the marker, the four counts and the four-value status', () => {
    expect(section).toContain('**Marker**: v{BARE_VERSION} ({created | existing})');
    expect(section).toContain('- Added: {n} · Already set: {n} · Kept other release: {n} · DEGRADED: {n}');
    const status = section.split('\n').find(line => line.startsWith('### Status: '));
    expect(status?.slice('### Status: '.length).split(' | ').map(v => v.split(' ')[0])).toEqual([
      'COMPLETE', 'PARTIAL', 'TRUNCATED', 'DEGRADED',
    ]);
  });

  it('posts nothing, so the contract section names no posting shape', () => {
    expect(collectPostingShapes(section)).toEqual([]);
  });
});

describe('associate-release: the tool-call contract defines both capabilities within its size (TP-12, AC-12)', () => {
  it('both rows are in the built contract table, each degrading by name, and _mcp.md is ≤ 7,963 ch', () => {
    const contract = readContract();
    expect(collectContractRows(contract).size, 'the collector parsed no more rows than it checks — it reads nothing')
      .toBeGreaterThan(OP_CAPABILITIES.length);
    expect(collectContractDefects(contract)).toEqual([]);
  });

  it('known-bad probes: a dropped row, a renamed reason and a contract over its ceiling are reported', () => {
    const contract = readContract();
    const noEdit = contract.split('\n').filter(line => !line.startsWith('| edit issue fields |')).join('\n');
    expect(noEdit, 'the seed must land').not.toBe(contract);
    expect(collectContractDefects(noEdit)).toEqual(['missing row "edit issue fields"']);
    const renamed = contract.replace('`no tracker tool for release versions or labels`', '`no tracker tool for release markers`');
    expect(renamed, 'the seed must land').not.toBe(contract);
    expect(collectContractDefects(renamed))
      .toEqual(['row "release versions or labels" does not degrade as `no tracker tool for release versions or labels`']);
    const padded = contract + 'x'.repeat(Math.max(1, MCP_CONTRACT_MAX_CHARS + 1 - contract.length));
    expect(collectContractDefects(padded)).toEqual([`${MCP_CONTRACT_REL} is ${padded.length} ch, over ${MCP_CONTRACT_MAX_CHARS}`]);
  });
});

describe('associate-release: each provider states its own mechanics (AC-11, AC-12)', () => {
  for (const provider of PROVIDERS) {
    const clauses = [...COMMON_CLAUSES, ...PROVIDER_CLAUSES[provider]];

    it(`${provider}: every clause the operation owes is stated`, () => {
      const body = readReference(provider);
      const missing = collectMissingClauses(body, clauses);
      expect(
        missing,
        `${provider}/${OP}.md is missing: ${missing
          .map(id => `${id} — ${clauses.find(c => c.id === id)?.why}`)
          .join('; ')}`,
      ).toEqual([]);
    });

    it(`known-bad probe (${provider}): every clause, removed from a copy, is reported`, () => {
      const body = readReference(provider);
      expect(clauses.length, 'an empty clause table asserts nothing').toBeGreaterThan(0);
      for (const clause of clauses) {
        const stripped = body.split(clause.literal).join('');
        expect(collectMissingClauses(stripped, clauses), clause.id).toContain(clause.id);
      }
    });

    it(`${provider}: posts nothing and names no evidence policy`, () => {
      const body = readReference(provider);
      expect(collectPostingShapes(body), 'no body exists, so no sink may open').toEqual([]);
      expect(collectPolicyNames(body), 'the caller gates the spawn; the op never names the policy').toEqual([]);
    });

    it(`${provider}: spells exactly its own marker reasons`, () => {
      expect(collectMarkerReasonDrift(provider, readReference(provider))).toEqual([]);
    });
  }

  it('known-bad probes: a posting line, a policy gate and a borrowed reason are reported', () => {
    expect(collectPostingShapes('3. Post it via `gh issue comment {number} --body-file "$DEVFLOW_BODY"`.').length)
      .toBeGreaterThanOrEqual(2);
    expect(collectPostingShapes('Post through the *add comment* capability.')).toHaveLength(1);
    expect(collectPostingShapes('Add the item through *edit issue fields*.')).toEqual([]);
    expect(collectPolicyNames('Run only when `EVIDENCE_POLICY` is `required`.')).toHaveLength(1);
    expect(collectMarkerReasonDrift('github', `${readReference('github')}\nTwo ⇒ \`TRACEABILITY: DEGRADED (ambiguous release marker)\`.`))
      .toEqual(['unowned "ambiguous release marker"']);
    expect(collectMarkerReasonDrift('linear', readReference('linear').replace(/ambiguous release marker/g, 'x')))
      .toEqual(['missing "ambiguous release marker"']);
  });
});

describe('associate-release: GitHub makes a bounded number of calls (AC-11, D7)', () => {
  const body = readReference('github');

  it('creates first: the POST precedes the lookup walk, which only a 422 reaches', () => {
    const post = body.indexOf('gh api --method POST');
    const get = body.indexOf('gh api --method GET');
    expect(post, 'no create call').toBeGreaterThan(-1);
    expect(get, 'no lookup call').toBeGreaterThan(post);
    expect(body.slice(post, get)).toContain('`already_exists`');
  });

  it('walks at most ten pages and never paginates without a bound', () => {
    expect(collectUnboundedWalks(body)).toEqual([]);
  });

  it('makes exactly two GraphQL calls — one aliased read and one aliased mutation', () => {
    const calls = collectGraphqlCalls(body);
    expect(calls, calls.join('\n')).toHaveLength(2);
    expect(body).toContain('mN: updateIssue(input:{id:"<id>", milestoneId:"<node_id>"}){ issue{ number } }');
  });

  it('known-bad probes: a paginated lookup and a per-item mutation are reported', () => {
    expect(collectUnboundedWalks('`gh api --paginate "repos/{owner}/{repo}/milestones"`')).toHaveLength(1);
    expect(collectUnboundedWalks('`gh api "…/milestones" -f page=N` until empty')).toHaveLength(1);
    expect(collectGraphqlCalls(`${body}\nFor each item, run \`gh api graphql -F query=@"$F"\`.`)).toHaveLength(3);
  });
});
