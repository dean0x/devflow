/**
 * Cross-provider literal pins (AC-3.13, GAP-13, [DR-08]) — P3c-S5.
 *
 * WHY A CROSS-PROVIDER FILE AND NOT THREE PER-PROVIDER ONES
 * ---------------------------------------------------------
 * Every claim here is a claim about the DIFFERENCE between providers, and a
 * difference cannot be asserted from inside one of its sides. `32767` present in
 * the Jira module is a weak fact; `32767` present in Jira and Linear and ABSENT
 * from GitHub is the fact §14.2 actually resolves — GAP-13's `60k`→`{cap}`
 * conflict is settled by "the GitHub path renders the 60k sentence VERBATIM and
 * every other provider renders its own cap", which is one table with three
 * columns and no blanks.
 *
 * The absence half is the interesting half. A provider module that names another
 * provider's signal has copied a backpressure MODEL across a boundary where the
 * model does not hold: `X-RateLimit-Remaining` is a pre-emptive remaining count
 * that neither tool-call provider publishes, so a rung keyed on it can never
 * engage and reads as coverage while providing none. Absence is therefore pinned
 * as hard as presence, per (provider, literal) pair, with a swapped-literal probe
 * driving the same collector in both directions.
 *
 * BOTH SIDES ARE READ, AND THEY ARE NOT INTERCHANGEABLE
 * ----------------------------------------------------
 * A source-only pin is satisfied by a literal sitting in module-level prose, which
 * the build emits nowhere — `_linear.mds`'s `## Known Unknowns` section is exactly
 * such prose, and it names `32767` — so the generated tree is asserted separately.
 * A generated-only pin would go quiet the moment a module stopped compiling. Every
 * assertion below names the side it reads, and every dist read is fail-loud with a
 * build hint (R3).
 *
 * The [DR-08] batch negative ranges over all three providers for the same reason:
 * it is the direct cross-provider analogue of Phase 2's GitHub batch assertion,
 * and the shape table it drives lives in tests/helpers.ts so the per-provider
 * suites and this one cannot disagree about what a per-item fetch looks like.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import * as path from 'path';

import { compiledSkillRefsDir } from '../src/core/assets.js';
import {
  MCP_BACKED_PROVIDER_SUBDIRS,
  MIN_VARIANT_PAIRS,
  TRACKER_OPS,
  VARIANT_MODULES,
} from '../src/core/mds-variants.js';
import {
  PER_ITEM_FETCH_SHAPES,
  ROOT,
  collectPerItemFetchVerbs,
  extractOpSectionFromCorpus,
  resolveAgentSource,
} from './helpers.js';

// ---------------------------------------------------------------------------
// The providers, read from the registry rather than listed
// ---------------------------------------------------------------------------

/** One registered tracker provider: its token, its source module, its sub-directory. */
interface Provider {
  readonly token: string;
  readonly source: string;
  readonly subdir: string;
}

/**
 * Every registered tracker provider.
 *
 * Derived from VARIANT_MODULES' provider rows, so a provider registered later
 * joins this scan by construction and the non-vacuity arm below reports one whose
 * literals nobody declared.
 */
const PROVIDERS: readonly Provider[] = VARIANT_MODULES
  .filter(mod => mod.kind === 'fanout' && mod.subdir.startsWith('tracker/'))
  .map(mod => ({
    token: mod.subdir.slice('tracker/'.length),
    source: mod.source,
    subdir: mod.subdir,
  }));

function readSource(relPath: string): string {
  const abs = path.join(ROOT, relPath);
  if (!existsSync(abs)) {
    throw new Error(
      `${relPath} is absent — a provider module named by the registry is not on disk, so every ` +
      `literal pin for that provider would compare against nothing (PF-018)`,
    );
  }
  return readFileSync(abs, 'utf-8');
}

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

/** The whole generated tree of one provider, concatenated. */
function providerTree(provider: Provider): string {
  return TRACKER_OPS.map(op => readGenerated(`${provider.subdir}/${op}.md`)).join('\n');
}

// ---------------------------------------------------------------------------
// The matrix: one row per literal, one cell per provider
// ---------------------------------------------------------------------------

/**
 * A literal that is a PROVIDER FACT, and which providers state it.
 *
 * `present` lists the provider tokens whose module must carry the literal; every
 * other registered provider must NOT. Expressing it that way rather than as a
 * per-provider list is what makes the matrix complete by construction: a provider
 * registered later is automatically in the absent set of every row until somebody
 * puts it in a `present` list on purpose.
 */
interface ProviderLiteral {
  readonly literal: string;
  readonly present: readonly string[];
  readonly why: string;
}

const PROVIDER_LITERALS: readonly ProviderLiteral[] = [
  {
    literal: '60000',
    present: ['github'],
    why:
      'GitHub\'s comment-body cap, and the number inside the sentence §14.2 fixes as rendering ' +
      'VERBATIM on the GitHub path (`NOTE: body exceeded 60k after redaction — truncated/stub ' +
      'posted`). GAP-13\'s conflict is resolved by one cap per provider, so this number appearing ' +
      'anywhere else is a provider quoting a cap that is not its own',
  },
  {
    literal: '32767',
    present: ['jira', 'linear'],
    why:
      'the tool-call providers\' comment-body cap. The truncation floor derives from it, so an ' +
      'absent cap leaves the preservation order with no bound to preserve against. On Linear it ' +
      'is BORROWED rather than measured, which is why that module carries `## Known Unknowns` and ' +
      'a filed probe issue — the number is pinned either way, because a borrowed bound still has ' +
      'to be the same bound everywhere it is stated',
  },
  {
    literal: 'X-RateLimit-Remaining',
    present: ['github'],
    why:
      'a PRE-EMPTIVE remaining-request count. It is the signal D4\'s backpressure rung is keyed ' +
      'on, and neither tool-call provider publishes one: a module naming it states a rung that ' +
      'can never engage, which reads as coverage and is none',
  },
  {
    literal: 'Retry-After',
    present: ['jira'],
    why:
      'Jira\'s only backpressure signal, and it is reactive: honoured verbatim, never shortened, ' +
      'STOP on 429. GitHub has the pre-emptive count instead and Linear signals through an error ' +
      'body, so a second provider naming this header would be honouring a value it never receives',
  },
  {
    literal: 'RATELIMITED',
    present: ['linear'],
    why:
      'Linear\'s rate-limit signal, which arrives as an HTTP 400 carrying this token rather than ' +
      'as a 429. D4\'s status-shaped rule answers a generic 4xx with "degrade this item and ' +
      'continue", so without this literal the fan-out runs straight into the penalty window',
  },
];

/** Named collector: (provider, literal) pairs whose presence is wrong. */
export function collectLiteralViolations(
  label: string,
  text: string,
  token: string,
  literals: readonly ProviderLiteral[],
): string[] {
  return literals
    .filter(entry => text.includes(entry.literal) !== entry.present.includes(token))
    .map(entry =>
      `${label}: ${entry.present.includes(token) ? 'missing' : 'forbidden'} ` +
      `"${entry.literal}" — ${entry.why}`);
}

describe('provider literals: the cross-provider matrix (AC-3.13, GAP-13)', () => {
  it('the scan holds every registered provider and a non-empty matrix', () => {
    expect(
      PROVIDERS.length,
      'fewer than three providers — the matrix\'s absence half is what makes it a matrix, and ' +
      'with one column there is nothing for a literal to be absent from (GAP-42)',
    ).toBeGreaterThanOrEqual(3);
    expect(
      PROVIDERS.map(p => p.token).sort(),
      'the provider set must come from the registry, so a provider cannot be silently omitted',
    ).toEqual(['github', 'jira', 'linear']);
    expect(PROVIDER_LITERALS.length, 'the literal matrix is empty (PF-018)').toBeGreaterThan(0);
    for (const entry of PROVIDER_LITERALS) {
      expect(
        entry.present.length,
        `"${entry.literal}" is present for no provider — a row nothing states is a row that ` +
        `forbids a literal nobody wrote`,
      ).toBeGreaterThan(0);
      expect(
        entry.present.every(token => PROVIDERS.some(p => p.token === token)),
        `"${entry.literal}" names a provider the registry does not carry`,
      ).toBe(true);
      expect(entry.why.trim().length, 'a row without a reason is a grep').toBeGreaterThan(0);
    }
  });

  it('every provider module source states exactly its own literals', () => {
    const violations: string[] = [];
    for (const provider of PROVIDERS) {
      violations.push(...collectLiteralViolations(
        provider.source, readSource(provider.source), provider.token, PROVIDER_LITERALS,
      ));
    }
    expect(
      violations,
      `provider literal violation(s) in a module source:\n  ${violations.join('\n  ')}`,
    ).toEqual([]);
  });

  it('and so does every provider\'s GENERATED tree, which is what a spawn reads', () => {
    // Not the same claim as the one above. A literal can sit in module-level prose
    // — `_linear.mds`'s `## Known Unknowns` names the borrowed cap there — and prose
    // above the first section marker is emitted nowhere, so a source-side pin alone
    // would be satisfied by a number no spawn ever sees.
    const violations: string[] = [];
    for (const provider of PROVIDERS) {
      violations.push(...collectLiteralViolations(
        `${provider.subdir}/**`, providerTree(provider), provider.token, PROVIDER_LITERALS,
      ));
    }
    expect(
      violations,
      `provider literal violation(s) across a generated tree:\n  ${violations.join('\n  ')}`,
    ).toEqual([]);
  });

  it('known-bad probe: a swapped literal is reported in both directions', () => {
    // Drives the SAME collector the two arms above use, over seeded text, so a
    // collector that had stopped reporting anything takes this probe red with them.
    const smuggled = collectLiteralViolations('seed', 'cap 60000 and Retry-After honoured', 'linear', PROVIDER_LITERALS)
      .map(v => v.split(' — ')[0]);
    expect(
      smuggled,
      'a GitHub cap smuggled into a Linear module, Jira\'s header with it, and Linear\'s own cap ' +
      'and signal dropped — all four must be reported',
    ).toEqual([
      'seed: forbidden "60000"',
      'seed: missing "32767"',
      'seed: forbidden "Retry-After"',
      'seed: missing "RATELIMITED"',
    ]);

    // …and the mirror: a GitHub module carrying a tool-call provider's cap.
    expect(
      collectLiteralViolations('seed', 'cap 32767; X-RateLimit-Remaining < 10 stops the fan-out; 60000', 'github', PROVIDER_LITERALS)
        .map(v => v.split(' — ')[0]),
      'the GitHub column must reject the borrowed cap while accepting its own two signals',
    ).toEqual(['seed: forbidden "32767"']);

    // …and a fully correct row reports nothing, so the collector is not a blanket refusal.
    expect(
      collectLiteralViolations('seed', 'cap 32767; a 400 RATELIMITED stops the fan-out', 'linear', PROVIDER_LITERALS),
      'a correct Linear row must be silent',
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// [DR-08] — no per-item fetch verb in any provider's batch reference
// ---------------------------------------------------------------------------

describe('provider literals: fetch-issues-batch is one query on every provider [DR-08]', () => {
  it('no provider\'s batch reference names a per-item fetch verb or capability', () => {
    const offenders: string[] = [];
    for (const provider of PROVIDERS) {
      const rel = `${provider.subdir}/fetch-issues-batch.md`;
      for (const site of collectPerItemFetchVerbs(readGenerated(rel))) {
        offenders.push(`${rel}:${site}`);
      }
    }
    expect(
      offenders,
      `a per-item fetch inside a batch reference re-grows the N+1 Phase 2 removed from GitHub, on ` +
      `whichever provider it appears. §14.4 fixes fetch_batch as a SINGLE-QUERY capability for ` +
      `every provider, and AC-3.8's parity scan cannot see the difference between one query and ` +
      `fifty — it asserts the file exists and is non-empty [DR-08]:\n  ${offenders.join('\n  ')}`,
    ).toEqual([]);
  });

  it('every tool-call provider carries the bound ON ITS QUERY, with the truncation report', () => {
    // The positive half, and it is deliberately NOT asserted on the GitHub column.
    // §14.4 fixes `≤50` with `TRUNCATED` for every provider, but WHERE the bound is
    // stated differs with the sink: GitHub's lives in the always-loaded agent step
    // (`**Input:** … process at most 50`), because a `gh` invocation takes the list
    // the agent already trimmed. A tool-call provider's query is composed inside the
    // mechanics, so a bound stated only in the agent is a bound the composed query
    // does not carry — which is the unbounded read this arm exists to forbid. The
    // asymmetry is a property of the two sinks, not a gap in the table.
    const toolCall = PROVIDERS.filter(p => (MCP_BACKED_PROVIDER_SUBDIRS as readonly string[]).includes(p.subdir));
    expect(
      toolCall.length,
      'no tool-call provider is registered, so this arm ranges over nothing',
    ).toBeGreaterThan(0);
    for (const provider of toolCall) {
      const rel = `${provider.subdir}/fetch-issues-batch.md`;
      const content = readGenerated(rel);
      expect(content, `${rel}: the ≤50 bound §14.4 fixes for every provider`).toContain('≤50');
      expect(
        content,
        `${rel}: over the bound the remainder must be reported, never silently dropped`,
      ).toContain('TRUNCATED ({n} not processed)');
    }
  });

  it('known-bad probe: both per-item shape classes are reported by the same collector', () => {
    // Mechanic (b) — §8.12 row 25's seeded fixture, driven through the shared
    // collector. Both classes are seeded, because a table covering one would pass a
    // probe for that one while inert against the other.
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

    // …and the shape the plural op anchor is NOT: `fetch-issues-batch` must not be
    // read as `fetch-issue`, or every batch reference reports itself and the arm is
    // unfixable.
    expect(
      collectPerItemFetchVerbs('## Operation: fetch-issues-batch'),
      'the op anchor line must not be reported — the plural is not the singular',
    ).toEqual([]);
    expect(PER_ITEM_FETCH_SHAPES.length, 'the shape table is empty (PF-018)').toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// backlink-shipped-issues, read as a FILE (GAP-18, M1/M4)
// ---------------------------------------------------------------------------
//
// WHY A PER-FILE ARM WHEN THE MATRIX ABOVE ALREADY SCANS THE TREE. The matrix
// concatenates each provider's ten op files, which is the right corpus for "does
// this provider state its own signal and no other provider's". It cannot say
// WHICH file states it, and for this one operation the file is the claim:
//
//   - `X-RateLimit-Remaining` is the D4 full-STOP signal for the only tracker
//     fan-out on the GitHub path. It used to be restated on this operation's
//     `**Degradation (D4):**` line in the always-loaded agent, where every spawn
//     read a GitHub header whatever provider it had resolved — and neither
//     tool-call provider publishes a pre-emptive remaining count, so the rung
//     could not engage for two of three providers. That line now defers to the
//     always-loaded contract, which names "the resolved provider's reference" as
//     the place the signal lives. THIS is that reference, so the threshold
//     drifting into a sibling op file would leave the contract pointing at a file
//     that does not carry it — and the tree-level pin would stay green.
//   - the `#` strip is a shell-injection control, not a style note (GAP-18). The
//     pre-flight admits `^#?[1-9][0-9]{0,8}$`, so `#42` is an ADMITTED entry, and
//     this file is the one that interpolates the entry into `gh issue view
//     {number}` and `gh issue comment {number}`. A `#` at word start opens a shell
//     comment, so the un-normalised spelling truncates the command at the
//     reference — the op would stop back-linking silently rather than fail. On
//     main the digits-only gate in the agent made this unreachable; moving the
//     grammar here widened the admitted set by one normalised form, and the
//     normalisation is what the wider grammar owes.
//
// Every claim is a row with its reason, and the probe below removes each row's own
// token from a copy of the file and drives the same collector over it — so a row
// whose pattern has stopped matching the shipped wording cannot pass quietly.
//
// EVERY ROW PINS A TOKEN, NEVER A SENTENCE. These generated references are priced
// against the per-provider loaded-set ceilings in tests/tracker/byte-budget.test.ts,
// so a condensing pass over this prose is an expected event rather than a
// hypothetical — and a row that pins a whole sentence makes the ceiling and the
// guard contradict each other. The guard then loses in the only way that matters: it
// goes RED naming a clause that is still present, because the rewrite moved a comma
// or split one sentence into two. That is PF-057's mistake one level down, pinning
// where a sentence happens to break.
//
// So each row's shape is the shortest phrase that carries its claim, and a claim
// with two halves is TWO rows rather than one ordered regex with a bridge between
// them: a bridge of hand-picked width has no contract behind it, and it silently
// encodes the punctuation the halves are separated by today. Two constraints on the
// token itself, both load-bearing here: it must be UNIQUE in the file, or the probe
// below deletes one occurrence and the row stays green over the other; and it must
// not be a phrase the file uses elsewhere in another sense — `before the loop` reads
// as the normalisation rule and again in the `**Setup (once, before the loop)**`
// heading, so pinning it would let the rule be deleted while the heading kept the
// row green.

/** One token a generated reference owes, and the shape that recognises it. */
interface FileClaim {
  readonly label: string;
  readonly pattern: RegExp;
  readonly why: string;
}

const GITHUB_BACKLINK_FILE = 'tracker/github/backlink-shipped-issues.md';

const GITHUB_BACKLINK_CLAIMS: readonly FileClaim[] = [
  {
    label: 'the normalisation happens once',
    pattern: /[Nn]ormalise once/,
    why:
      'a strip performed per-command is a strip an author can forget on one of the two commands; ' +
      'the pre-flight is the single place every entry passes through',
  },
  {
    label: 'and never inside the per-issue loop',
    pattern: /[Nn]ever inside it/,
    why:
      'the placement half of the same rule, and the half a reader can get wrong while still ' +
      'normalising "once" per iteration. Pinned separately because a condensing pass may keep ' +
      'either clause and drop the other',
  },
  {
    label: 'exactly one leading `#` is stripped',
    pattern: /[Ee]xactly one\*{0,2} leading `#`/,
    why:
      'GAP-18: the pre-flight IS the shell-injection guard for an interpolated ref, and "exactly ' +
      'one" is its bound — a greedy strip would silently accept `##42`. The emphasis markers are ' +
      'optional in the shape because bolding is presentation and the bound is the claim',
  },
  {
    label: 'only the stripped digits reach a command',
    pattern: /[Ii]nterpolate only the stripped digits/,
    why:
      'the bound above governs nothing unless the stripped form is named as the only one that is ' +
      'interpolated — that is what makes the gate cover the commands rather than just the parse',
  },
  {
    label: 'the shell-comment reason the strip exists for',
    pattern: /opens a shell comment/,
    why:
      'without the reason the sentence reads as cosmetic normalisation and the next condensing ' +
      'pass deletes it. The failure it prevents is silent: a truncated `gh` command back-links ' +
      'nothing and reports no error',
  },
  {
    label: 'the anchored github reference grammar the strip normalises for',
    pattern: /\^#\?\[1-9]\[0-9]\{0,8}\$/,
    why:
      '§14.1 fixes this provider\'s grammar, anchored at both ends. The `#?` is why a ' +
      'normalisation is owed at all: an anchored digits-only grammar would need none',
  },
  {
    label: "GitHub's full-STOP rate-limit threshold",
    pattern: /`X-RateLimit-Remaining` header < 10/,
    why:
      'D4 says STOP rather than wait, and the always-loaded contract defers the signal to this ' +
      'reference. Stated anywhere else, the contract points at a file that does not carry it',
  },
];

/** Named collector: claims the text does not make. */
export function collectMissingFileClaims(
  label: string,
  text: string,
  claims: readonly FileClaim[],
): string[] {
  return claims
    .filter(claim => !claim.pattern.test(text))
    .map(claim => `${label}: missing ${claim.label} — ${claim.why}`);
}

describe('provider literals: the github backlink reference, per file (GAP-18)', () => {
  it('states the strip-one-`#` normalisation before it interpolates, and its own STOP threshold', () => {
    const violations = collectMissingFileClaims(
      GITHUB_BACKLINK_FILE,
      readGenerated(GITHUB_BACKLINK_FILE),
      GITHUB_BACKLINK_CLAIMS,
    );
    expect(
      violations,
      `the github backlink reference is missing sentence(s) it owes:\n  ${violations.join('\n  ')}`,
    ).toEqual([]);
  });

  it('known-bad probe: each claim, deleted from a copy, is reported by the same collector', () => {
    // Mechanic (b): the bad shape is built inside this `it` from the shipped bytes,
    // so no committed file is touched to show red. Per ROW rather than once, because
    // a table is only as good as the shapes it can be SHOWN to express (PF-018) —
    // and a row whose pattern drifted off the shipped wording would otherwise sit
    // here matching nothing while the main arm passed on the other four.
    const pristine = readGenerated(GITHUB_BACKLINK_FILE);
    expect(
      collectMissingFileClaims('pristine', pristine, GITHUB_BACKLINK_CLAIMS),
      'the collector must be silent on the shipped file, or the probe below proves nothing',
    ).toEqual([]);

    for (const claim of GITHUB_BACKLINK_CLAIMS) {
      const wounded = pristine.replace(claim.pattern, '');
      expect(
        wounded,
        `the pattern for "${claim.label}" matched nothing in the shipped file, so deleting it was ` +
        `a no-op and the row cannot be shown live`,
      ).not.toBe(pristine);
      expect(
        collectMissingFileClaims('wounded', wounded, GITHUB_BACKLINK_CLAIMS)
          .map(v => v.split(' — ')[0]),
        `removing "${claim.label}" must be reported by the same collector`,
      ).toContain(`wounded: missing ${claim.label}`);
    }
    expect(GITHUB_BACKLINK_CLAIMS.length, 'the claim table is empty (PF-018)').toBeGreaterThan(0);
  });

  it('the STOP threshold is stated on the github path ONLY, per file and in the agent', () => {
    // The absence half, narrowed from the tree to the file — and extended to the
    // always-loaded agent's own section for this op, which is where the misalignment
    // actually lived. `resolve-review-threads` keeps both thresholds in git.md: PR
    // review threads are hosted on GitHub under every provider, so that clause is a
    // GitHub fact stated in the right place. Scoping to the op section is what lets
    // this arm forbid the literal for THIS op without forbidding it for that one.
    const toolCall = PROVIDERS.filter(
      p => (MCP_BACKED_PROVIDER_SUBDIRS as readonly string[]).includes(p.subdir),
    );
    expect(toolCall.length, 'no tool-call provider is registered').toBeGreaterThan(0);
    for (const provider of toolCall) {
      const rel = `${provider.subdir}/backlink-shipped-issues.md`;
      expect(
        readGenerated(rel),
        `${rel} names a pre-emptive remaining count this provider never sends — a rung keyed on ` +
        `it can never engage, which reads as coverage and is none`,
      ).not.toContain('X-RateLimit-Remaining');
    }

    const git = resolveAgentSource('git');
    const { content: section } = extractOpSectionFromCorpus(
      [{ path: git.path, content: git.content }],
      'backlink-shipped-issues',
      { mode: 'sole' },
    );
    expect(
      section.length,
      'the op section measured 0 characters — the absence assertion below would pass by reading ' +
      'nothing',
    ).toBeGreaterThan(0);
    expect(
      section,
      `${git.path}: this operation's always-loaded section names GitHub's rate-limit header. ` +
      `Every spawn loads it whatever provider it resolved, and two of three providers publish no ` +
      `such count — the signal belongs in ${GITHUB_BACKLINK_FILE}, which the always-loaded D4 ` +
      `contract already defers to`,
    ).not.toContain('X-RateLimit-Remaining');
    // …and the control: the literal IS still in the agent, on the op whose GitHub
    // hosting is unconditional. An absence arm that would also pass on an agent
    // scrubbed of the threshold entirely is not measuring a relocation.
    expect(
      git.content,
      'resolve-review-threads must keep both thresholds — deleting them everywhere would satisfy ' +
      'the arm above while disabling backpressure',
    ).toContain('`X-RateLimit-Remaining` < 10');
  });
});

// ---------------------------------------------------------------------------
// Non-vacuity: the corpus this file measures is the real one
// ---------------------------------------------------------------------------

describe('provider literals: the corpus is real (PF-018)', () => {
  it('every provider contributes a full op roster to the scan', () => {
    expect(TRACKER_OPS.length, 'empty op roster').toBeGreaterThanOrEqual(MIN_VARIANT_PAIRS);
    for (const provider of PROVIDERS) {
      const tree = providerTree(provider);
      expect(
        tree.length,
        `${provider.subdir}: the generated tree measured 0 characters — every absence assertion ` +
        `above would pass by reading nothing`,
      ).toBeGreaterThan(0);
      for (const op of TRACKER_OPS) {
        expect(
          readGenerated(`${provider.subdir}/${op}.md`).split('\n')[0],
          `${provider.subdir}/${op}.md: line 1 must be this op's anchor`,
        ).toBe(`## Operation: ${op}`);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Shared provider-independent rules: ONE authoring owner
// ---------------------------------------------------------------------------
//
// The rows above pin what DIFFERS between providers. This block pins the
// opposite half: a rule that is the same for every tool-call provider is
// AUTHORED once and expanded into each of them, so the two copies a reader sees
// in the generated tree cannot drift from each other.
//
// WHY THE RULES ARE EXPANDED AND NOT HOISTED INTO THE CONTRACT. `tracker/_mcp.md`
// is read once per SPAWN and a per-operation mechanics file once per OPERATION,
// and two things forbid the hoist that would otherwise be the tidier answer:
//
//   - the D11 clauses are MANDATED per posting mechanic by
//     tests/guards/mcp-sink-bypass.test.ts. A tool-call sink has no shell
//     operator between the scrub and the post, so each file has to spell the gate
//     it is using; a contract that owned those sentences alone would make that
//     guard unsatisfiable.
//   - `### Query safety` governs the single operation that composes a query, so
//     stated in the contract it would be charged to every spawn that never runs
//     that operation.
//
// So the rule is emitted per provider ON PURPOSE, and what this block asserts is
// that there is still exactly one place it is WRITTEN. `emitted` is a byte-exact
// fragment of the expansion, deliberately shorter than the rule: these files are
// priced against the per-provider ceilings in tests/tracker/byte-budget.test.ts,
// so pinning a whole paragraph would make the ceiling and the guard contradict
// each other on the next condensing pass.

/** One rule authored once and expanded into every tool-call provider. */
interface SharedRule {
  /** The `@define` that owns it, declared in SHARED_AUTHORING_MODULE and nowhere else. */
  readonly define: string;
  /** A byte-exact fragment of the expansion, as a GENERATED file spells it. */
  readonly emitted: string;
  readonly why: string;
}

/** The module that owns every rule below. */
const SHARED_AUTHORING_MODULE = 'src/assets/mds/tracker/_mcp.mds';

const SHARED_RULES: readonly SharedRule[] = [
  {
    define: 'posting_gate_head',
    emitted: '; this operation names its steps and restates none of its rules.',
    why:
      'the D11 posting sequence. It is restated per mechanic because the sink-bypass guard ' +
      'requires every file to name the clauses that make the placeholder a gate — so the one ' +
      'thing that can still be centralised is the AUTHORING, and a second author is a second ' +
      'reading of which field of the framing line is the byte count',
  },
  {
    define: 'query_safety',
    emitted:
      'Caller-supplied prose reaches the tracker as a QUERY here and nowhere else in this ' +
      "provider's mechanics, so the rule is stated here once.",
    why:
      'the query-composition rules, whose own first sentence says the rule is stated ONCE. Two ' +
      'authors make that sentence false in the only file a reader can check it against, and the ' +
      'escape-order clause is a quoting control: one copy edited is one provider that escapes ' +
      'the quote before the backslash',
  },
  {
    define: 'shipped_marker_rule',
    emitted: "**The marker is the comment's FIRST LINE and nothing else.**",
    why:
      'the dedup predicate. A copy that relaxed to a substring search over the whole comment ' +
      'would hand any quoter the power to suppress a release back-link on that provider alone',
  },
  {
    define: 'marker_namespace',
    emitted: 'The namespace is **per comment kind**: this operation owns `devflow:shipped` and no other.',
    why:
      'the namespace rule that keeps the three comment kinds from suppressing one another. It ' +
      'is a property of the marker vocabulary, not of any provider',
  },
  {
    define: 'aggregate_call_budget',
    emitted: "**Aggregate call budget [DR-09] — the fallback's ceiling.**",
    why:
      "[DR-09]'s product bound. The rung that lands differs per provider and is passed in; the " +
      'bound and the truncation report do not, and a second copy is a second ceiling',
  },
  {
    define: 'ref_preflight_tail',
    emitted: '— a `COMPLETE` over zero processed issues is the report a release believes.',
    why:
      'the never-COMPLETE clause on an empty admitted set. It is the sentence that stops a ' +
      'release reporting success over zero processed issues, and it is the same sentence ' +
      'whatever grammar dropped the entries',
  },
];

/**
 * Collapse MDS prose brace escapes so a source and a generated file spell one
 * literal one way. Only the brace pair — a general unescape would rewrite
 * backslashes that appear in no artifact.
 */
function unescapeMds(source: string): string {
  return source.replace(/\\\{/g, '{').replace(/\\\}/g, '}');
}

/** The tool-call providers — the ones that import the shared authoring module. */
const TOOL_CALL_PROVIDERS = PROVIDERS.filter(
  p => (MCP_BACKED_PROVIDER_SUBDIRS as readonly string[]).includes(p.subdir),
);

/** Named collector: corpus entries that spell a shared rule themselves. */
export function collectSecondAuthors(
  emitted: string,
  corpus: readonly { readonly label: string; readonly text: string }[],
): string[] {
  return corpus.filter(e => unescapeMds(e.text).includes(emitted)).map(e => e.label);
}

describe('shared provider-independent rules have exactly one author', () => {
  const authoring = unescapeMds(readSource(SHARED_AUTHORING_MODULE));
  const providerSources = TOOL_CALL_PROVIDERS.map(p => ({ label: p.source, text: readSource(p.source) }));

  it('the registry and the corpus it ranges over are both real (PF-018)', () => {
    expect(SHARED_RULES.length, 'an empty registry asserts nothing').toBeGreaterThan(0);
    for (const rule of SHARED_RULES) {
      expect(rule.why.trim().length, `${rule.define}: a row without a reason is a grep`)
        .toBeGreaterThan(0);
      expect(rule.emitted.length, `${rule.define}: an empty fragment matches everything`)
        .toBeGreaterThan(0);
    }
    expect(
      TOOL_CALL_PROVIDERS.map(p => p.token).sort(),
      'the shared rules are shared BETWEEN providers, and with one column there is nothing to ' +
      'share with — the arms below would all pass over a single module',
    ).toEqual(['jira', 'linear']);
  });

  it('every shared rule is declared in the authoring module and in no provider module', () => {
    const problems: string[] = [];
    for (const rule of SHARED_RULES) {
      const declaration = `@define ${rule.define}(`;
      const declared = authoring.split(declaration).length - 1;
      if (declared !== 1) {
        problems.push(`${SHARED_AUTHORING_MODULE}: declares ${rule.define} ${declared} time(s), want 1`);
      }
      for (const entry of providerSources) {
        if (entry.text.includes(declaration)) {
          problems.push(`${entry.label}: re-declares ${rule.define}`);
        }
      }
    }
    expect(
      problems,
      `shared-rule declaration problem(s). One author means one \`@define\`:\n  ${problems.join('\n  ')}`,
    ).toEqual([]);
  });

  it('no provider module re-inlines a rule it is supposed to invoke', () => {
    const second: string[] = [];
    for (const rule of SHARED_RULES) {
      for (const label of collectSecondAuthors(rule.emitted, providerSources)) {
        second.push(`${label}: spells ${rule.define} itself — ${rule.why}`);
      }
    }
    expect(
      second,
      `a provider module writes a shared rule out instead of invoking it. That is the state this ` +
      `registry exists to leave: the text is identical on the day it is pasted and diverges on ` +
      `the first edit, and nothing downstream can tell you which copy is the ` +
      `intended one:\n  ${second.join('\n  ')}`,
    ).toEqual([]);
  });

  it('every tool-call provider imports the authoring module and invokes every rule', () => {
    const missing: string[] = [];
    for (const entry of providerSources) {
      if (!entry.text.includes('from "./_mcp.mds"')) {
        missing.push(`${entry.label}: imports nothing from the authoring module`);
      }
      for (const rule of SHARED_RULES) {
        if (!entry.text.includes(`{${rule.define}(`)) {
          missing.push(`${entry.label}: never invokes ${rule.define}`);
        }
      }
    }
    expect(
      missing,
      `a tool-call provider is not using the shared author. A rule nobody invokes is a rule that ` +
      `will be written out again:\n  ${missing.join('\n  ')}`,
    ).toEqual([]);
  });

  it('and the rule reaches every tool-call provider\'s GENERATED tree', () => {
    // The half the source arms cannot see: an import that compiled to nothing
    // would satisfy every assertion above while shipping a mechanics file with the
    // rule missing.
    const absent: string[] = [];
    for (const provider of TOOL_CALL_PROVIDERS) {
      const tree = providerTree(provider);
      for (const rule of SHARED_RULES) {
        if (!tree.includes(rule.emitted)) absent.push(`${provider.subdir}/**: no ${rule.define}`);
      }
    }
    expect(
      absent,
      `a shared rule never reached a provider's emitted mechanics:\n  ${absent.join('\n  ')}`,
    ).toEqual([]);
  });

  it('known-bad probe: the same collector reports a re-inlined copy', () => {
    // Driven over the REAL provider sources plus one seeded entry, so a collector
    // that had stopped reporting takes this red with the arm above.
    for (const rule of SHARED_RULES) {
      expect(
        collectSecondAuthors(rule.emitted, [
          ...providerSources,
          { label: 'seed/_probe.mds', text: `prelude\n${rule.emitted}\ntail\n` },
        ]),
        `a seeded second author of ${rule.define} must be reported`,
      ).toEqual(['seed/_probe.mds']);
      // …and the escaped spelling is the same literal: a module writes `\{` in
      // prose where the generated file writes `{`, so a collector reading only one
      // of the two is inert against exactly the corpus it scans.
      expect(
        collectSecondAuthors(rule.emitted, [
          { label: 'seed/_escaped.mds', text: rule.emitted.replace(/\{/g, '\\{').replace(/\}/g, '\\}') },
        ]),
        `the escaped spelling of ${rule.define} must be reported too`,
      ).toEqual(['seed/_escaped.mds']);
    }
  });
});
