/**
 * The generated reference tree is complete, reachable, and carries the mechanics
 * it claims.
 *
 * `dist/skills/git/references/` is emitted by the build, installed on every
 * machine and read by the Git agent at spawn time. Three properties make that
 * tree trustworthy, and each fails in a way the other two cannot see:
 *
 *   PARITY — every registered op has a file and every emitted file has an op, and
 *     each file opens with its own `## Operation:` anchor. The anchor is not
 *     decoration: the D11 forward/reverse guards find moved mechanics through
 *     `extractOpSectionFromCorpus(..., { mode: 'union' })`, which keys on exactly
 *     that heading, so a reference titled anything else is invisible to every
 *     sink-class guard the moment its mechanics arrive.
 *
 *   MECHANICS — the one operation whose text was REWRITTEN rather than relocated,
 *     `gather-release-evidence`, still carries the batch-first form. Its known-bad
 *     is the fan-out shape it replaced, driven through the same collector.
 *
 *   REACHABILITY — every emitted file can be named by something the agent
 *     actually reads. Both directions, because either alone is satisfiable by an
 *     accident: a file nothing can name is dead weight installed on every user's
 *     machine, and an op the instruction can name with no file behind it
 *     is a reference the agent is told to load that the install does not carry —
 *     a build defect every spawn running that op would hit.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';

import { compiledSkillRefsDir } from '../../src/core/assets.js';
import { COMPLIANCE_OFF_REMOVED_SKILL_FILES } from '../../src/core/compliance-off-files.js';
import {
  BOTH_OFF_OUTPUT_DIR,
  COMPLIANCE_OFF_OUTPUT_DIR,
  VARIANT_MANIFEST_REL_PATH,
  machineVariantKey,
  parseVariantManifest,
  variantOffRelPath,
  type VariantKind,
  type VariantManifestHost,
  type VariantSwitches,
} from '../../src/core/curation-variants.js';
import {
  TRACKER_GITHUB_OPS,
  GIT_CROSS_CUTTING_DOCS,
  GIT_OPERATIONS,
  MIN_VARIANT_PAIRS,
  PR_HOST_DESTINATION_ROOT,
  PR_HOST_OPS,
  VARIANT_MODULES,
  expandVariants,
  generatedReferenceManifest,
  installedReferenceManifest,
  operationReferenceRel,
} from '../../src/core/mds-variants.js';
import {
  ROOT,
  collectTrackerNamingLines,
  extractOpSectionFromCorpus,
  gitOperationReferenceCorpus,
  prHostRel,
  resolveAgentSource,
  walkFiles,
} from '../helpers.js';
import { POSTING_OPERATIONS } from '../fixtures/mds-manifest.js';
import { MODEL_TRANSITIVE_REFS } from './budget-model.js';
import { MIN_REFERENCE_CHARS } from './reference-floor.js';

// ---------------------------------------------------------------------------
// Fail-loud reads
// ---------------------------------------------------------------------------

/**
 * Read a file that MUST exist. Throws with a build hint rather than returning an
 * empty string: a reachability scan over an absent tree reports nothing and
 * passes.
 */
function requireFile(label: string, filePath: string): string {
  try {
    return readFileSync(filePath, 'utf-8');
  } catch {
    throw new Error(
      `${label}: ${filePath} is absent — run \`npm run build\` first\n` +
      '  (these guards read built artifacts; they cannot be skipped)',
    );
  }
}

const REFS_DIR = compiledSkillRefsDir();

// ---------------------------------------------------------------------------
// 1. Structural parity and per-file non-emptiness
// ---------------------------------------------------------------------------

/** The generated GitHub mechanics files, keyed by op. */
function generatedTrackerFiles(): Map<string, string> {
  const found = new Map<string, string>();
  for (const file of walkFiles(path.join(REFS_DIR, 'tracker', 'github'), f => f.endsWith('.md'), 1)) {
    found.set(path.basename(file, '.md'), requireFile('generated reference', file));
  }
  return found;
}

describe('generated references: structural parity — every op has a file and every file has an op', () => {
  const files = generatedTrackerFiles();

  it('the registry and the emitted tree agree in both directions', () => {
    expect([...files.keys()].sort()).toEqual([...TRACKER_GITHUB_OPS].sort());
  });

  it('the parity check is non-vacuous: enough pairs to discriminate', () => {
    const expansion = expandVariants();
    expect(expansion.ok, 'the variant registry must expand').toBe(true);
    if (!expansion.ok) return;
    expect(
      expansion.value.length,
      `only ${expansion.value.length} (module, op) pair(s) — a list short enough to enumerate ` +
      `by hand satisfies any implementation that returns something (GAP-42)`,
    ).toBeGreaterThanOrEqual(MIN_VARIANT_PAIRS);
    expect(VARIANT_MODULES.length, 'at least one reference module must be registered').toBeGreaterThan(0);
    expect(files.size, 'no generated reference was found at all').toBeGreaterThan(0);
  });

  it('every generated reference is non-empty and opens with its own `## Operation:` anchor', () => {
    const problems: string[] = [];
    for (const op of TRACKER_GITHUB_OPS) {
      const content = files.get(op);
      if (content === undefined) {
        problems.push(`${op}: no generated file`);
        continue;
      }
      if (content.length < MIN_REFERENCE_CHARS) {
        problems.push(`${op}: ${content.length} ch, floor ${MIN_REFERENCE_CHARS}`);
      }
      if (!content.startsWith(`## Operation: ${op}\n`)) {
        problems.push(
          `${op}: must begin with "## Operation: ${op}" — got ${JSON.stringify(content.split('\n')[0])}`,
        );
      }
    }
    expect(problems, `generated reference problems:\n  ${problems.join('\n  ')}`).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 2. gather-release-evidence — batch-first, never one call per commit [DR-17]
// ---------------------------------------------------------------------------
//
// Resolving a 100-commit range with up to 100 `gh api` calls is the N+1 exposure
// GAP-26 names. The mechanics state a batch-first resolution with a bounded
// sequential fallback instead, and the prohibition is structural: no line may pair
// a per-commit phrase with a `gh api` call.

/** Named collector: per-commit fan-out lines in a release-evidence mechanics text. */
function collectPerCommitFanout(text: string): string[] {
  return text.split('\n').filter(line => /each commit/i.test(line) && /gh api/i.test(line));
}

/**
 * The fan-out form the batch-first mechanics replaced, byte-exact.
 *
 * A KNOWN-BAD sample, not a specimen of anything shipped: it is quoted here so the
 * collector is proven to recognise the shape it forbids, without the fix ever being
 * un-landed to show red and without keeping a whole pre-rewrite document on disk to
 * hold one line. A collector that stopped matching would make the prohibition above
 * pass by recognising nothing.
 */
const PER_COMMIT_FANOUT_SAMPLE =
  '4. If `gh` is authenticated and remote is reachable: for each commit in the range, fetch ' +
  'merged PRs that include that commit and collect their `closingIssuesReferences` via `gh api`; ' +
  'merge with the commit-message set.';

describe('gather-release-evidence: batch-first, never one call per commit [DR-17]', () => {
  const RELEASE_EVIDENCE = path.join(REFS_DIR, 'tracker', 'github', 'gather-release-evidence.md');

  it('the mechanics state the ≤25 sequential sub-bound', () => {
    const text = requireFile('generated reference', RELEASE_EVIDENCE);
    expect(
      text,
      'the bounded sequential fallback must name its own limit — an unbounded fallback is the ' +
      'N+1 fan-out with an extra step in front of it',
    ).toContain('≤25');
  });

  it('the mechanics carry no per-commit `gh api` loop', () => {
    const text = requireFile('generated reference', RELEASE_EVIDENCE);
    expect(
      collectPerCommitFanout(text),
      'a per-commit `gh api` loop resolves a 100-commit range with 100 remote calls, which is ' +
      'the exposure GAP-26 names and what the batch-first rewrite replaced',
    ).toEqual([]);
  });

  it('known-bad probe: the fan-out form is reported by the same collector', () => {
    expect(
      collectPerCommitFanout(`## Operation: gather-release-evidence\n${PER_COMMIT_FANOUT_SAMPLE}\ntail\n`),
      'the collector must see the fan-out shape — otherwise the assertion above is satisfied by ' +
      'a scan that recognises nothing',
    ).toEqual([PER_COMMIT_FANOUT_SAMPLE]);
    // …and the shipped mechanics are not matched by an over-broad collector: a
    // collector reporting every line would pass the probe above and fail nothing.
    expect(
      collectPerCommitFanout('Batch-resolve the whole range in one call, then fall back to ≤25 lookups.'),
      'a batch-first line must not be reported — the collector has to discriminate',
    ).toEqual([]);
  });

  it('the D4 item-degradation clause is in the operation\'s contract block, ahead of its steps', () => {
    // The batch-first form introduces new remote failure modes (a batch call that
    // 4xx's where 100 individual calls previously item-degraded per D4), so the
    // clause that says "degrade the item, continue" must be readable from the one
    // reference the operation loads, and in its contract block rather than among
    // the steps it governs (D-OP-MOVABLE).
    const section = extractOpSectionFromCorpus(gitOperationReferenceCorpus(), 'gather-release-evidence', { mode: 'sole' }).content;
    const clause = section.indexOf('**Degradation (D4):**');
    expect(clause, 'gather-release-evidence: **Degradation (D4):** clause missing').toBeGreaterThan(-1);
    expect(
      section,
      'gather-release-evidence: the per-item degrade rule must stay in its contract block',
    ).toContain('for any GitHub signal that could not be fetched');
    expect(clause, 'the clause precedes the steps').toBeLessThan(section.indexOf('\n### Process'));
  });
});

// ---------------------------------------------------------------------------
// 3. Every generated reference is reachable (AC-2.7)
// ---------------------------------------------------------------------------
//
// "Reachable" is defined structurally so the check is mechanical rather than a
// reading of the preamble:
//
//   a generated file is reachable ⇔ instantiating the preamble's SINGLE load
//   instruction with a registered provider and one of its ops yields that file's
//   path, OR the compiled agent spells the path out literally, OR a shipped
//   consumer names it.
//
// The instruction is read out of the compiled agent rather than restated here —
// restating it would let the two drift and still pass.

/** The `{provider}` / `{op}` template the preamble's one load instruction composes. */
const LOAD_INSTRUCTION_TEMPLATE = 'references/tracker/{provider}/{op}.md';

/**
 * Named collector: the relative paths the load instruction can reach for a
 * provider, given a roster of ops. Derived from the template, never hand-listed.
 */
function reachablePaths(template: string, provider: string, ops: readonly string[]): string[] {
  return ops.map(op => template.replace('{provider}', provider).replace('{op}', op)
    .replace('references/', ''));
}

/**
 * Every path the ONE templated load instruction can reach, across every provider
 * the registry carries.
 *
 * The provider tokens come from the module registry — the same place the emitted
 * directories come from — so the two halves of the both-directions check below
 * cannot disagree about which providers exist. What keeps that from being a
 * tautology is the OTHER half: the instruction itself is read out of the compiled
 * agent (the arm below asserts there is exactly one such line and that it carries
 * both placeholders), so a preamble that dropped a provider from its map, or
 * hard-coded one, still fails.
 */
function providerReachablePaths(template: string): string[] {
  return VARIANT_MODULES
    .filter(mod => mod.subdir.startsWith('tracker/'))
    .flatMap(mod => reachablePaths(template, mod.subdir.slice('tracker/'.length), mod.ops));
}

/**
 * The two CONTRACT documents — `kind: 'contract'` modules, each a single
 * cross-cutting file at the `tracker/` root that every tracker spawn reads once.
 *
 * D-TRACKER-CONTRACT-ON-DEMAND. `tracker/_contract.md` is the provider resolution and
 * the tracker input contract, moved out of the always-loaded agent so a PR-only spawn
 * never pays for them; `tracker/_mcp.md` is the tool-call contract of the MCP-backed
 * providers. Both are named by the agent's retained `## Loading the mechanics`
 * section — and by nothing else. The section also keeps the two rules a PR-only spawn
 * needs and a contract cannot load for it: the PR-mechanics load rule and the merged
 * step order (see {@link collectLoadingPlacementDefects}).
 */
const TRACKER_CONTRACT_REL = 'tracker/_contract.md';
const TOOL_CALL_CONTRACT_REL = 'tracker/_mcp.md';
const CONTRACT_RELS = [TRACKER_CONTRACT_REL, TOOL_CALL_CONTRACT_REL] as const;

/**
 * The CONTRACT documents' own reachability rule — a third kind, matching their third
 * module kind.
 *
 * A `fanout` file is reachable by instantiating the template; a `named` document is
 * reachable because the agent spells its path; and so is a contract — the agent
 * names it, as a fixed literal, on the SAME physical line that composes the
 * per-operation mechanics path.
 *
 * IT USED TO BE THE CONSUMERS THAT NAMED THE TOOL-CALL CONTRACT, and that is the
 * defect this rule replaces. The contract carries the transport prohibition and the
 * trust discipline for every tracker call a non-github spawn makes, but only five of
 * the ten per-operation files happened to name it: the other five ran tracker calls
 * with neither. An extraction that turns a universal obligation into per-consumer
 * opt-in drops it wherever a consumer forgets to opt in, and "some shipped file
 * names it" could never have caught it — five namers satisfy it as completely as
 * ten do. The tracker contract is held to the same rule for the same reason, and the
 * rule gains a second half with it (D-TRACKER-CONTRACT-ON-DEMAND): the naming line
 * puts the tracker contract FIRST, because the settings line it defines yields the
 * provider token the composed mechanics path needs.
 *
 * They are named from the loading section WITHOUT becoming a second convergence
 * point, because they share the one existing naming line and are fixed literals
 * composed from nothing: the validated provider token selects the mechanics
 * directory and never reaches these names. The inverse — no generated op file may
 * name either — is a live arm below, not a comment.
 */
function contractsNamedByTheLoadingSection(content: string): string[] {
  const naming = collectTrackerNamingLines(content);
  if (naming.length !== 1) return [];
  const manifest = generatedReferenceManifest();
  return CONTRACT_RELS.filter(rel => manifest.includes(rel) && naming[0].includes(`references/${rel}`));
}

/** Named collector: generated op files that name a contract — must always be empty. */
function collectContractNamers(): string[] {
  return walkFiles(path.join(REFS_DIR, 'tracker'), f => f.endsWith('.md'))
    .filter(file => !CONTRACT_RELS.some(rel => path.basename(file) === path.basename(rel)))
    .filter(file => {
      const body = requireFile('generated reference', file);
      return CONTRACT_RELS.some(rel => body.includes(rel));
    })
    .map(file => path.relative(REFS_DIR, file).split(path.sep).join('/'));
}

/**
 * The loading section's rules that a PR-only spawn needs and the contract cannot load for it:
 * the one-reference rule, and the table that names the reference of every operation whose
 * reference is not a provider file (D-OP-ONE-REF).
 */
const PLACED_IN_THE_AGENT = [
  { label: 'the one-reference rule', marker: 'Each operation has ONE reference' },
  { label: 'the reference table', marker: '| Operation | Reference |' },
] as const;

/** The agent's `## Loading the mechanics` section, up to the next heading; empty when absent. */
function loadingSectionOf(agentContent: string): string {
  const heading = agentContent.indexOf('## Loading the mechanics');
  const end = heading === -1 ? -1 : agentContent.indexOf('\n## ', heading + 1);
  return heading === -1 ? '' : agentContent.slice(heading, end === -1 ? undefined : end);
}

/**
 * The hop rule (D-BODY-HOP-CLOSURE in tests/tracker/budget-model.ts).
 *
 * A step may run another operation (setup-task step 1c runs ensure-traceable-issue) or follow
 * a section of another operation's reference (backlink-shipped-issues' provider signals), and
 * the budget model prices those loads as part of the spawn. The always-loaded rule must allow
 * them: a flat "read no other operation's reference" sets the loading rule against the step,
 * and a spawn that obeys the rule runs the hopped-to operation without its template, dedup or
 * scrub.
 */
const HOP_RULE =
  "Read another operation's reference only when a step tells you to run that operation or to follow its reference.";

/** Named collector: hop-rule defects in the agent's always-loaded Loading section. */
function collectHopRuleDefects(agentContent: string): string[] {
  const section = loadingSectionOf(agentContent);
  const defects: string[] = [];
  if (!section.includes(HOP_RULE)) defects.push("the Loading section does not allow a step's hop to another operation's reference");
  if (/\bno other operation's reference\b/i.test(section)) defects.push("the Loading section forbids every other operation's reference");
  return defects;
}

/**
 * Named collector: where the two always-loaded loading rules sit.
 *
 * AC-524. A PR-only spawn never reads the tracker contract, and the contract cannot
 * instruct a spawn to load itself, so a rule moved into it would reach tracker spawns
 * only: a PR-host operation would lose its load rule and its path. Each rule must
 * therefore be in the agent's `## Loading the mechanics` section — the always-loaded
 * part, ahead of the next heading — and in the contract not at all.
 */
function collectLoadingPlacementDefects(agentContent: string, contractContent: string): string[] {
  const section = loadingSectionOf(agentContent);
  const defects: string[] = [];
  for (const { label, marker } of PLACED_IN_THE_AGENT) {
    if (!section.includes(marker)) defects.push(`${label} is not in the agent's always-loaded Loading section`);
    if (contractContent.includes(marker)) defects.push(`${label} appears in the tracker contract`);
  }
  return defects;
}

/**
 * Named collector: lines that name a contract file and say what to do when it is
 * absent — a stop, a DEGRADED reason or an abort.
 *
 * AC-519. A missing contract can only come from a corrupted install, which the
 * installer already reports; a prompt rule for it is prompt bloat on every spawn, and
 * no rule is written for a failure only install corruption can cause.
 */
function collectMissingContractRules(text: string): string[] {
  return text.split('\n').filter(line =>
    /_contract(?:\.md)?/.test(line)
    && /\b(?:DEGRADED|stop|abort|missing|absent|unavailable|not found|cannot be read|fails? to load)\b/i.test(line));
}

/**
 * Named collector: every literal `references/<name>.md` the compiled agent spells
 * out, as a manifest-relative path.
 *
 * The templated tracker instruction is skipped — it is handled by reachablePaths
 * above, and a `{provider}`/`{op}` path is not a name any one file answers to.
 * This is the OTHER half of reachability: the cross-cutting documents are not
 * reached by instantiating a template, they are named individually at exactly
 * one site each [GIT_CROSS_CUTTING_DOCS, 'named' module kind].
 */
function collectLiteralReferenceNames(content: string): Set<string> {
  const names = new Set<string>();
  for (const match of content.matchAll(/references\/([A-Za-z0-9._/{}-]+\.md)/g)) {
    if (match[1].includes('{')) continue;
    names.add(match[1]);
  }
  return names;
}

/** Named collector: the `pr/…` paths the agent spells out literally. */
function collectPrHostNames(content: string): string[] {
  return [...collectLiteralReferenceNames(content)]
    .filter(rel => rel.startsWith(`${PR_HOST_DESTINATION_ROOT}/`))
    .sort();
}

/**
 * Named predicate: does a per-op reference open with its OWN anchor on line 1?
 *
 * A function rather than an inline `startsWith` at each site, because the live arm
 * and its known-bad probe must read the SAME rule. Restated inline, the probe
 * asserts only that one hand-written string fails one hand-written check — it stays
 * green after the live arm is weakened (say to `includes`), which is a vacuous
 * pass.
 */
function anchorsOnLineOne(body: string, op: string): boolean {
  return body.startsWith(`## Operation: ${op}\n`);
}

/** Read an emitted `pr/…` body for the named arm's one hop; null when it is absent. */
function readEmittedPrBody(rel: string): string | null {
  const file = path.join(REFS_DIR, ...rel.split('/'));
  return existsSync(file) ? readFileSync(file, 'utf-8') : null;
}

/**
 * Named collector: every manifest path a spawn reading `content` could name.
 *
 * FOUR arms, one per module kind the registry carries, and the live check and
 * every known-bad probe drive this one function — a probe that rebuilt the union
 * inline would stay green after an arm was dropped from the real check.
 *
 *   fanout / tracker    instantiate the preamble's ONE templated instruction;
 *   named               the agent spells the document's path out, once each —
 *                       or, ONE hop out, a `pr/` body the agent names spells it
 *                       (`trust-rule.md`, named by the one PR-host op that
 *                       applies it, #363). The hop admits cross-cutting documents
 *                       only and never recurses: a `pr/` path spelled inside a
 *                       body is NOT reachable through it, which is what keeps the
 *                       check-ci-status pointer probe below meaningful — its file
 *                       is also named from check-merge-readiness' body;
 *   fanout / PR-host    the agent spells each file's path out, once per op. Not
 *                       templated on purpose: the file is the same under every
 *                       provider, so there is nothing to instantiate — and a
 *                       second templated instruction would be a second path
 *                       composed from the provider token, breaking the single
 *                       convergence point that token's validation relies on;
 *   contract            the loading section names each, as a fixed literal.
 *
 * `readPrBody` is injectable so the hop's probe can take it away.
 */
function reachableSetFrom(
  content: string,
  readPrBody: (rel: string) => string | null = readEmittedPrBody,
): Set<string> {
  const prNames = collectPrHostNames(content);
  const hopNames = prNames.flatMap(rel => {
    const body = readPrBody(rel);
    return body === null ? [] : [...collectLiteralReferenceNames(body)];
  });
  return new Set([
    ...providerReachablePaths(LOAD_INSTRUCTION_TEMPLATE),
    ...[...collectLiteralReferenceNames(content), ...hopNames].filter(rel =>
      (GIT_CROSS_CUTTING_DOCS as readonly string[]).includes(path.basename(rel, '.md')),
    ),
    ...prNames,
    ...contractsNamedByTheLoadingSection(content),
  ]);
}

describe('generated references: every reference is reachable from the agent (AC-2.7)', () => {
  const agent = resolveAgentSource('git');

  it('the loading section states exactly one load instruction, and it is the template', () => {
    const naming = collectTrackerNamingLines(agent.content);
    expect(
      naming.length,
      `expected exactly one line naming a references/tracker/ path, found ${naming.length}:\n  ` +
      naming.join('\n  '),
    ).toBe(1);
    expect(
      naming[0],
      'the single load instruction must compose the path from BOTH placeholders — an instruction ' +
      'that hard-codes either one cannot reach the tree the registry emits',
    ).toContain(LOAD_INSTRUCTION_TEMPLATE);
  });

  it('every op in the registry is reachable, and every emitted file is reachable (both directions)', () => {
    // Scope: the WHOLE manifest, not the tracker/ subtree. Walking only
    // tracker/ excludes the four GIT_CROSS_CUTTING_DOCS from BOTH directions —
    // decision-markers.md, learn-conventions.md, publication-gate.md and
    // trust-rule.md are generated, installed on every machine and shipped in the
    // tarball, and a cross-cutting document that lost its one naming line is
    // exactly as invisible as an orphan file.
    const reachable = reachableSetFrom(agent.content);

    const emitted = walkFiles(REFS_DIR, f => f.endsWith('.md'))
      .map(f => path.relative(REFS_DIR, f).split(path.sep).join('/'));

    // The walk must see the whole manifest — a narrowed walk is how this check
    // can lose the cross-cutting docs.
    expect(
      [...emitted].sort(),
      'the emitted tree and the install manifest must be the same set — a file in one and not ' +
      'the other is either shipped unreachable or named and absent',
    ).toEqual([...generatedReferenceManifest()].sort());

    const unreachable = emitted.filter(rel => !reachable.has(rel));
    expect(
      unreachable,
      'generated reference file(s) no load instruction can name — installed on every machine and ' +
      'read by nothing:\n  ' + unreachable.join('\n  '),
    ).toEqual([]);

    const missing = [...reachable].filter(rel => !emitted.includes(rel));
    expect(
      missing,
      'the agent can name file(s) the build does not emit — every spawn that runs those ops loads ' +
      'a reference the install does not carry:\n  ' +
      missing.join('\n  '),
    ).toEqual([]);
  });

  it('the reachability check is non-vacuous on both sides', () => {
    expect(TRACKER_GITHUB_OPS.length, 'empty op roster').toBeGreaterThanOrEqual(MIN_VARIANT_PAIRS);
    expect(GIT_CROSS_CUTTING_DOCS.length, 'empty cross-cutting roster').toBeGreaterThan(0);
    const providers = VARIANT_MODULES.filter(mod => mod.subdir.startsWith('tracker/'));
    expect(providers.length, 'no provider module registered').toBeGreaterThan(0);
    expect(
      providerReachablePaths(LOAD_INSTRUCTION_TEMPLATE).length,
      'the template reached no provider path — the per-provider arm is inert',
    ).toBe(providers.reduce((n, mod) => n + mod.ops.length, 0));
    expect(
      walkFiles(REFS_DIR, f => f.endsWith('.md')).length,
      'no generated reference files at all — run `npm run build`',
    ).toBeGreaterThanOrEqual(
      providers.reduce((n, mod) => n + mod.ops.length, 0) + GIT_CROSS_CUTTING_DOCS.length,
    );
    // The contracts' own rule, asserted rather than assumed: each is in the manifest
    // AND the loading section names it. Either half alone would let an unreachable
    // contract ship or a named one go missing.
    expect(
      contractsNamedByTheLoadingSection(agent.content),
      'a contract is in the manifest but the loading section does not name it — it would be ' +
      'installed on every machine and read by nothing',
    ).toEqual(CONTRACT_RELS.filter(rel => generatedReferenceManifest().includes(rel)));
    expect(
      CONTRACT_RELS.filter(rel => generatedReferenceManifest().includes(rel)),
      'both contracts are generated on this tree: the tracker contract ungated, the tool-call ' +
      'contract because a tool-call provider is registered',
    ).toEqual([...CONTRACT_RELS]);
  });

  it('the contracts are FIXED per-spawn loads: no generated op file names either', () => {
    // The inverse of the rule above, and the half that makes it a fix rather than a
    // relocation. While the per-operation files were the namers, five of ten named
    // it and five did not, and every guard in the tree was satisfied by the five.
    // An op file that names it again re-opens exactly that door, so the
    // prohibition is absolute rather than a floor on the count.
    expect(
      collectContractNamers(),
      'generated op file(s) name a contract. Each is loaded once per SPAWN from the agent\'s ' +
      'loading section (the tracker contract under every provider, the tool-call contract under ' +
      'every non-github one); a per-operation naming line makes the ' +
      'load look conditional on which operation ran, which is how half the operations lost it:\n  ' +
      collectContractNamers().join('\n  '),
    ).toEqual([]);
  });

  it('AC-524: the one-reference rule and the reference table sit in the agent, never in the tracker contract', () => {
    const contract = requireFile('tracker contract', path.join(REFS_DIR, ...TRACKER_CONTRACT_REL.split('/')));
    expect(
      collectLoadingPlacementDefects(agent.content, contract),
      'a PR-only spawn reads the agent and never the tracker contract, which cannot load itself: ' +
      'each rule must be in the agent\'s always-loaded Loading section and absent from the contract',
    ).toEqual([]);
  });

  it('known-bad probe: a loading rule moved into the tracker contract, or below the Loading section, is reported', () => {
    const contract = requireFile('tracker contract', path.join(REFS_DIR, ...TRACKER_CONTRACT_REL.split('/')));
    for (const { label, marker } of PLACED_IN_THE_AGENT) {
      const line = agent.content.split('\n').find(l => l.startsWith(marker));
      expect(line, `${label} must be a line of the shipped agent for this probe to seed`).toBeDefined();
      const withoutRule = agent.content.replace(`${line}\n`, '');
      expect(withoutRule, 'the strip must change the agent copy').not.toBe(agent.content);

      // Moved into the contract: reported in both halves.
      expect(
        collectLoadingPlacementDefects(withoutRule, `${contract}\n${line}\n`),
        `${label} moved into the contract must be reported in both halves`,
      ).toEqual([
        `${label} is not in the agent's always-loaded Loading section`,
        `${label} appears in the tracker contract`,
      ]);

      // Moved below the Loading section: a line further down is not in the section a spawn reads for loading.
      expect(
        collectLoadingPlacementDefects(`${withoutRule}\n${line}\n`, contract),
        `${label} appended after the Loading section is not in the loading rules`,
      ).toEqual([`${label} is not in the agent's always-loaded Loading section`]);

      // Left where it is, with the contract untouched: silent.
      expect(collectLoadingPlacementDefects(agent.content, contract)).toEqual([]);
    }
  });

  it('the hop rule: the Loading section allows the in-spawn hops the budget model prices', () => {
    const hops = Object.values(MODEL_TRANSITIVE_REFS).flatMap(rows => Object.values(rows).flat());
    expect(hops.length, 'MODEL_TRANSITIVE_REFS lists no hop, so the rule would guard nothing').toBeGreaterThan(0);
    expect(collectHopRuleDefects(agent.content)).toEqual([]);
  });

  it('known-bad probe: a Loading section that forbids every other reference is reported', () => {
    const forbidding = agent.content.replace(HOP_RULE, "Read no other operation's reference.");
    expect(forbidding, 'the probe must change the agent copy').not.toBe(agent.content);
    expect(collectHopRuleDefects(forbidding)).toEqual([
      "the Loading section does not allow a step's hop to another operation's reference",
      "the Loading section forbids every other operation's reference",
    ]);
  });

  it('AC-519: neither the agent nor the tracker contract carries a stop or DEGRADED rule for a missing contract', () => {
    const contract = requireFile('tracker contract', path.join(REFS_DIR, ...TRACKER_CONTRACT_REL.split('/')));
    expect(collectMissingContractRules(agent.content), 'git.md').toEqual([]);
    expect(collectMissingContractRules(contract), '_contract.md').toEqual([]);
    expect(
      agent.content.split('\n').filter(l => /_contract\.md/.test(l)).length,
      'the agent names the contract on exactly one line, so the absence above is not vacuous',
    ).toBe(1);
  });

  it('known-bad probe: a rule for a missing contract is reported by the same collector', () => {
    expect(collectMissingContractRules('If `references/tracker/_contract.md` is missing, stop.')).toHaveLength(1);
    expect(collectMissingContractRules('- DEGRADED when _contract.md cannot be read')).toHaveLength(1);
    expect(collectMissingContractRules('read `references/tracker/_contract.md` once per spawn')).toEqual([]);
  });

  it('known-bad probe: a seeded op-file naming line is reported by the same collector', () => {
    // The collector reads the built tree, so the probe re-runs its predicate over a
    // seeded body rather than writing into dist/ (a non-vacuity check without a
    // side effect).
    const namesContract = (body: string): boolean => CONTRACT_RELS.some(rel => body.includes(rel));
    expect(
      namesContract('## Operation: setup-task\n\nRead `references/tracker/_mcp.md` first.\n'),
      'the predicate must see a seeded naming line — otherwise the prohibition above is inert',
    ).toBe(true);
    expect(
      namesContract('## Operation: setup-task\n\nRead `references/tracker/_contract.md` first.\n'),
      'and the tracker contract is held to the same prohibition',
    ).toBe(true);
    expect(
      namesContract('## Operation: setup-task\n\nRead the tool-call contract first.\n'),
      'the predicate must NOT fire on the contract named in prose — the rule is about composing ' +
      'a second load path, not about mentioning the document',
    ).toBe(false);
  });

  it('known-bad probe: an emitted file outside the registry is reported as unreachable', () => {
    const reachable = new Set(reachablePaths(LOAD_INSTRUCTION_TEMPLATE, 'github', TRACKER_GITHUB_OPS));
    const emitted = ['tracker/github/setup-task.md', 'tracker/github/smuggled.md'];
    expect(emitted.filter(rel => !reachable.has(rel))).toEqual(['tracker/github/smuggled.md']);
  });

  it('known-bad probe: a cross-cutting doc whose naming line is removed is reported', () => {
    // The direction a tracker-only walk cannot express. Strip one document's
    // single naming line from a COPY of the agent and drive the SAME collector:
    // the file is still emitted, still installed, and now reachable by nothing.
    const target = 'decision-markers.md';
    const stripped = agent.content
      .split('\n')
      .filter(line => !line.includes(`references/${target}`))
      .join('\n');
    expect(stripped, 'the strip must actually change the agent copy').not.toBe(agent.content);

    const namedInReal = collectLiteralReferenceNames(agent.content);
    const namedInStripped = collectLiteralReferenceNames(stripped);
    expect(
      namedInReal.has(target),
      `${target} must be named in the real agent — otherwise this probe proves nothing`,
    ).toBe(true);
    expect(
      namedInStripped.has(target),
      'the collector must stop seeing the name once its line is gone — otherwise the reachability ' +
      'direction is green for a document nothing can load',
    ).toBe(false);

    // …and the same set difference the live check computes now reports it.
    const reachable = reachableSetFrom(stripped);
    expect(generatedReferenceManifest().filter(rel => !reachable.has(rel))).toEqual([target]);
  });

  it('known-bad probe: the cross-cutting documents a pr/ reference names are reachable only through the pr/ hop', () => {
    // publication-gate.md is named from the two summary operations' references and trust-rule.md from
    // fetch-review-threads' step 2, never from the agent (D10's scope property keeps the gate out of the
    // always-loaded body). Take the hop's reader away and the SAME collector must lose exactly those two —
    // or the named arm reaches them some other way and the hop is declared and never taken.
    for (const doc of ['publication-gate.md', 'trust-rule.md']) {
      expect(collectLiteralReferenceNames(agent.content).has(doc), `the agent must not name ${doc}`).toBe(false);
    }
    const unhopped = reachableSetFrom(agent.content, () => null);
    expect(generatedReferenceManifest().filter(rel => !unhopped.has(rel))).toEqual(['publication-gate.md', 'trust-rule.md']);
  });

  // ── The PR-host tree: parity, and its own reachability direction (#326) ────

  it('PR-host parity: every PR_HOST_OPS entry has a non-trivial file, and every pr/ file has an op', () => {
    // The same claim the provider trees carry, for the tree that belongs to no
    // provider. Both directions, because the forward one alone lets a stray file
    // ship unreferenced and the reverse one alone lets a listed op emit nothing —
    // and a per-file size floor, because a reference that kept its heading and
    // lost its body hands the agent an operation with no instructions while the
    // install reports success (GAP-44).
    const emitted = walkFiles(path.join(REFS_DIR, PR_HOST_DESTINATION_ROOT), f => f.endsWith('.md'))
      .map(f => path.relative(REFS_DIR, f).split(path.sep).join('/'))
      .sort();
    expect(
      emitted,
      'the pr/ tree and PR_HOST_OPS must be the same set in both directions',
    ).toEqual([...PR_HOST_OPS].map(prHostRel).sort());
    expect(
      PR_HOST_OPS.length,
      'the PR-host roster is below the fan-out floor — every parity assertion over it is vacuous',
    ).toBeGreaterThanOrEqual(MIN_VARIANT_PAIRS);

    for (const op of PR_HOST_OPS) {
      const body = requireFile('PR-host reference', path.join(REFS_DIR, PR_HOST_DESTINATION_ROOT, `${op}.md`));
      expect(
        body.length,
        `${prHostRel(op)} is ${body.length} ch — below MIN_REFERENCE_CHARS (${MIN_REFERENCE_CHARS})`,
      ).toBeGreaterThanOrEqual(MIN_REFERENCE_CHARS);
      expect(
        anchorsOnLineOne(body, op),
        `${prHostRel(op)} must OPEN with its own "## Operation: ${op}" anchor on line 1 — every ` +
        'union-mode extraction starts there, and an anchor further down silently truncates the ' +
        'section to whatever precedes it',
      ).toBe(true);
    }
  });

  it('PR-host parity known-bad probe: an anchor that is not on line 1 is reported', () => {
    // The anchor rule is a prefix check, so on live inputs it is green whether or
    // not the predicate is live. Drive `anchorsOnLineOne` — the SAME
    // function the live arm calls — over two seeded bodies instead, both
    // directions, so the probe fails on a predicate that has been weakened to
    // accept a displaced anchor AND on one that has gone constant-false.
    const op = PR_HOST_OPS[0];
    const displaced = `Load this first.\n\n## Operation: ${op}\n\nSteps.\n`;
    expect(
      anchorsOnLineOne(displaced, op),
      'a body whose anchor is preceded by prose must NOT satisfy the line-1 rule',
    ).toBe(false);

    const wellFormed = `## Operation: ${op}\n\nSteps.\n`;
    expect(
      anchorsOnLineOne(wellFormed, op),
      'a body that DOES open with its anchor must satisfy the rule — otherwise the live arm ' +
      'passes only because nothing it asks can ever be true',
    ).toBe(true);
  });

  it('pr/ reachability: the agent names exactly the PR-host roster, both directions', () => {
    expect(
      collectPrHostNames(agent.content),
      'the pr/ paths the agent spells out and the PR_HOST_OPS roster must be the same set — a ' +
      'pointer with no file degrades every spawn of that op, and a file with no pointer is ' +
      'installed on every machine and read by nothing',
    ).toEqual([...PR_HOST_OPS].map(prHostRel).sort());
  });

  it('pr/ reachability known-bad probe: deleting one pointer line makes its file unreachable', () => {
    // The direction the parity arm above cannot see: the files stay emitted and
    // the roster stays intact, and only the AGENT changed. Strips one op's pointer
    // from a COPY and drives the SAME reachability collector the live check uses.
    const target = prHostRel('check-ci-status');
    const stripped = agent.content
      .split('\n')
      .filter(line => !line.includes(`references/${target}`))
      .join('\n');
    expect(stripped, 'the strip must actually change the agent copy').not.toBe(agent.content);
    expect(
      generatedReferenceManifest().filter(rel => !reachableSetFrom(stripped).has(rel)),
      'an emitted pr/ file whose pointer line is gone must be reported as unreachable',
    ).toEqual([target]);
  });

  it('known-bad probe: a seeded extra manifest entry is reported against the emitted tree', () => {
    const emitted = walkFiles(REFS_DIR, f => f.endsWith('.md'))
      .map(f => path.relative(REFS_DIR, f).split(path.sep).join('/'));
    const seededManifest = [...generatedReferenceManifest(), 'tracker/github/smuggled.md'];
    expect(
      seededManifest.filter(rel => !emitted.includes(rel)),
      'a manifest entry with no emitted file must be reported — the install would copy nothing ' +
      'and the agent would name a path that does not exist',
    ).toEqual(['tracker/github/smuggled.md']);
  });
});

// ---------------------------------------------------------------------------
// 3. The merged step list across files: deferrals are loadable, labels have one owner
// ---------------------------------------------------------------------------

/** Every emitted `pr/…` reference, keyed by op. */
function prHostFiles(): Map<string, string> {
  return new Map(PR_HOST_OPS.map(op => [
    op,
    requireFile('PR-host reference', path.join(REFS_DIR, PR_HOST_DESTINATION_ROOT, `${op}.md`)),
  ]));
}

/**
 * Named collector: the ops a PR-host reference defers to ("same logic as `{op}`")
 * without telling the spawn to load the file that holds those steps.
 *
 * The load rule reads only the file an op's own pointer names, so a deferral to a
 * sibling op's steps reaches nothing unless the deferring file names the sibling's
 * `pr/` path itself. Before #326 the sibling's steps sat in the always-loaded agent
 * and the phrase alone was enough; after the split it points at a file no spawn of
 * the deferring op reads.
 */
function collectUnloadedDeferrals(body: string): string[] {
  const named = collectLiteralReferenceNames(body);
  return [...body.matchAll(/same logic as `([a-z-]+)`/g)]
    .map(m => m[1])
    .filter(op => !((PR_HOST_OPS as readonly string[]).includes(op) && named.has(prHostRel(op))));
}

const PROVIDER_SUBDIRS = VARIANT_MODULES
  .map(mod => mod.subdir)
  .filter(subdir => subdir.startsWith('tracker/'));

describe('PR-host references: the merged step list is executable from what one spawn loads', () => {
  const agent = resolveAgentSource('git');

  it('every "same logic as `{op}`" in a pr/ file names that op\'s pr/ file for loading', () => {
    const offenders = [...prHostFiles()].flatMap(([op, body]) =>
      collectUnloadedDeferrals(body).map(target => `${prHostRel(op)} defers to ${target}`));
    expect(
      offenders,
      'a PR-host reference defers to a sibling op\'s steps without naming the file that holds them — ' +
      'the spawn is told to load only its own pointer\'s file, so it improvises the steps:\n  ' +
      offenders.join('\n  '),
    ).toEqual([]);
  });

  it('the deferral rule is non-vacuous: the live pr/ corpus carries at least one deferral', () => {
    const deferrals = [...prHostFiles().values()]
      .flatMap(body => [...body.matchAll(/same logic as `([a-z-]+)`/g)]);
    expect(deferrals.length, 'no deferral in the pr/ corpus — the rule above ranges over nothing').toBeGreaterThan(0);
  });

  it('known-bad probe: a deferral with no load name is reported, and the named form is not', () => {
    const bare = '3. Fetch CI status (same logic as `check-ci-status`)\n';
    expect(collectUnloadedDeferrals(bare)).toEqual(['check-ci-status']);
    const loaded = `${bare}   Load \`references/${prHostRel('check-ci-status')}\` for those steps.\n`;
    expect(collectUnloadedDeferrals(loaded)).toEqual([]);
  });

  it('AC-102: every operation loads exactly one operation reference, under any provider', () => {
    // The agent routes by a table (PR-host and doc-backed operations, each a literal path) and by one
    // templated line (tracker operations, whose file is selected by the resolved provider). The path
    // the agent's own text yields for an operation must be the registry's single reference for it.
    const named = new Map<string, string>();
    for (const line of agent.content.split('\n')) {
      const row = /^\| `([a-z][a-z0-9-]*)` \| `references\/([A-Za-z0-9._/-]+\.md)` \|$/.exec(line);
      if (row !== null) named.set(row[1], row[2]);
    }
    const offenders: string[] = [];
    for (const op of GIT_OPERATIONS) {
      for (const subdir of PROVIDER_SUBDIRS) {
        const provider = subdir.slice('tracker/'.length);
        const expected = operationReferenceRel(op, provider);
        const viaTable = named.get(op);
        const viaTemplate = (TRACKER_GITHUB_OPS as readonly string[]).includes(op)
          ? LOAD_INSTRUCTION_TEMPLATE.replace('{provider}', provider).replace('{op}', op).replace('references/', '')
          : undefined;
        const routed = [viaTable, viaTemplate].filter((rel): rel is string => rel !== undefined);
        if (routed.length !== 1) offenders.push(`${op} (${provider}): routed ${routed.length} way(s), expected exactly one`);
        else if (routed[0] !== expected) offenders.push(`${op} (${provider}): the agent routes to ${routed[0]}, the registry says ${expected}`);
        else if (!existsSync(path.join(REFS_DIR, ...routed[0].split('/')))) offenders.push(`${op} (${provider}): ${routed[0]} is not emitted`);
      }
    }
    expect(
      offenders,
      'an operation reaches no reference, two references, or a reference other than the registry\'s:\n  ' + offenders.join('\n  '),
    ).toEqual([]);
    expect(named.size, 'the table names one reference per non-tracker operation').toBe(
      GIT_OPERATIONS.length - TRACKER_GITHUB_OPS.length,
    );
  });

  it('AC-102: each operation reference declares its own operation once and no other', () => {
    // ensure-pr-ready is the case that had two references (a PR half and a provider half): it is now one
    // file per provider, so neither a pr/ copy nor a second anchor may exist.
    expect(
      (PR_HOST_OPS as readonly string[]).includes('ensure-pr-ready'),
      'ensure-pr-ready is a tracker operation; a PR-host entry for it would be a second reference',
    ).toBe(false);
    const offenders: string[] = [];
    for (const op of GIT_OPERATIONS) {
      for (const subdir of PROVIDER_SUBDIRS) {
        const rel = operationReferenceRel(op, subdir.slice('tracker/'.length)) ?? '';
        const body = requireFile('operation reference', path.join(REFS_DIR, ...rel.split('/')));
        const anchors = [...body.matchAll(/^## Operation: (\S+)$/gm)].map(m => m[1]);
        if (anchors.length !== 1 || anchors[0] !== op) offenders.push(`${rel}: anchors [${anchors.join(', ')}], expected [${op}]`);
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });

  it('AC-101: the agent body carries routing and shared rules only — no operation Input, Output template or section', () => {
    const lines = agent.content.split('\n');
    const stray = lines
      .map((line, i) => ({ line, i }))
      .filter(({ line }) => /^## Operation: /.test(line) || line.startsWith('**Input:**') || line.startsWith('**Output:**'))
      .map(({ line, i }) => `${i + 1}: ${line.slice(0, 60)}`);
    expect(stray, 'operation text in the agent body — it belongs in the operation\'s one reference').toEqual([]);
  });

  it('known-bad probe: an agent that routes an operation two ways, or to a file the registry does not name, is reported', () => {
    const op = 'check-ci-status';
    const row = agent.content.split('\n').find(l => l.startsWith(`| \`${op}\` | \`references/`)) ?? '';
    expect(row, 'the shipped table has a row for the probe operation').not.toBe('');
    const misrouted = row.replace(`${PR_HOST_DESTINATION_ROOT}/${op}.md`, `${PR_HOST_DESTINATION_ROOT}/validate-branch.md`);
    expect(misrouted, 'the seed must land').not.toBe(row);
    // The same extraction the live arm uses, over the seeded row.
    const parsed = /^\| `([a-z][a-z0-9-]*)` \| `references\/([A-Za-z0-9._/-]+\.md)` \|$/.exec(misrouted);
    expect(parsed?.[2], 'the extraction reads the seeded path').toBe(`${PR_HOST_DESTINATION_ROOT}/validate-branch.md`);
    expect(parsed?.[2]).not.toBe(operationReferenceRel(op, 'github'));
  });
});

// ---------------------------------------------------------------------------
// 6. The compliance-off prompts name only what a compliance-off install carries (AC-48)
//
// A compliance-off machine installs the compliance-off Git agent and the compliance-off
// commands, and it installs `installedReferenceManifest({ compliance: false })` as the
// references. The prompts and the references are cut by two separate mechanisms (the arms
// of a host, and the omit set of the install), so each can drift from the other:
//
//   - an off prompt that still names a posting operation sends the agent to a reference
//     the install does not carry;
//   - an off Git agent that was never built leaves every compliance-off machine with no
//     Git agent to read, and a scan over the files that exist would pass on nothing.
//
// The guard fails on both. The prompts are the files a compliance-off machine installs for
// each host with a compliance arm, taken from the build's variant manifest and from
// `machineVariantKey`, the function the installer chooses with. The Git agent has no
// curation arm, so a machine with curation also off installs the same compliance-off file.
// ---------------------------------------------------------------------------

/** The two machine states that install compliance-off prompts: curation on and curation off, compliance off in both. */
const OFF_MACHINES: readonly VariantSwitches[] = [
  { curation: true, compliance: false },
  { curation: false, compliance: false },
];

/** A built compliance-off prompt: its repo-relative path and its text. */
interface OffPrompt {
  readonly path: string;
  readonly text: string;
}

/** Named reader: the hosts of the build's variant manifest under `root`; a build hint when it is absent or unreadable. */
function readVariantHosts(root: string = ROOT): readonly VariantManifestHost[] {
  const parsed = parseVariantManifest(requireFile('variant manifest', path.join(root, ...VARIANT_MANIFEST_REL_PATH.split('/'))));
  if (!parsed.ok) {
    throw new Error(`${VARIANT_MANIFEST_REL_PATH} does not parse — run \`npm run build:mds\` first`);
  }
  return parsed.value;
}

/**
 * Named collector: the repo-relative files a compliance-off machine installs for the hosts of one kind that carry
 * a compliance arm, sorted and without repeats. A host with no compliance arm installs its compliance-on text and is
 * not listed. The variant comes from `machineVariantKey`, never from the host roster.
 */
export function offPromptPaths(hosts: readonly VariantManifestHost[], kind: VariantKind): string[] {
  const paths = new Set<string>();
  for (const host of hosts) {
    if (host.kind !== kind || !host.axes.compliance) continue;
    for (const machine of OFF_MACHINES) {
      const key = machineVariantKey(machine, host.axes);
      if (key === 'on' || key === 'curation-off') {
        throw new Error(`${host.kind}/${host.name} has a compliance arm, so a compliance-off machine cannot install its '${key}' file`);
      }
      paths.add(variantOffRelPath(key, kind, `${host.name}.md`));
    }
  }
  return [...paths].sort();
}

/** Named reader: the text of each path under `root`. A missing file throws and names the build step; it is never skipped. */
export function readOffPrompts(root: string, paths: readonly string[]): OffPrompt[] {
  return paths.map(rel => ({ path: rel, text: requireFile('compliance-off prompt', path.join(root, ...rel.split('/'))) }));
}

/** The reference paths a compliance-off install does not carry, as a prompt spells them (`references/...`). */
function omittedReferencePaths(): string[] {
  const offManifest = new Set(installedReferenceManifest({ compliance: false }));
  const generated = generatedReferenceManifest().filter(rel => !offManifest.has(rel)).map(rel => `references/${rel}`);
  const removed = COMPLIANCE_OFF_REMOVED_SKILL_FILES.map(file => file.slice(file.indexOf('/') + 1));
  return [...new Set([...generated, ...removed])].sort();
}

/** True when `text` names the operation `op` as a whole token, so `fetch-issue` does not match `fetch-issues-batch`. */
function namesOperation(text: string, op: string): boolean {
  return new RegExp(`(?<![\\w-])${op}(?![\\w-])`).test(text);
}

/**
 * Named collector: what a set of compliance-off prompts names that the compliance-off manifest does not carry,
 * one entry per prompt and item, in scan order. Two kinds of item:
 *   - an operation (any `GIT_OPERATIONS` entry) whose reference, under any provider, is not in the manifest;
 *   - a literal `references/...` path of a file the install omits or removes.
 */
export function collectOffReachabilityDefects(files: readonly OffPrompt[], offManifest: ReadonlySet<string>): string[] {
  const providers = VARIANT_MODULES.filter(mod => mod.subdir.startsWith('tracker/')).map(mod => mod.subdir.slice('tracker/'.length));
  const omittedPaths = omittedReferencePaths();
  const defects: string[] = [];
  for (const file of files) {
    for (const op of GIT_OPERATIONS) {
      if (!namesOperation(file.text, op)) continue;
      const rels = [...new Set(providers.map(provider => operationReferenceRel(op, provider)))];
      for (const rel of rels) {
        if (rel === null || !offManifest.has(rel)) {
          defects.push(`${file.path}: names ${op}, whose reference ${rel ?? '(none)'} is not in the compliance-off manifest`);
        }
      }
    }
    for (const omitted of omittedPaths.filter(candidate => file.text.includes(candidate))) {
      defects.push(`${file.path}: names ${omitted}, which a compliance-off install does not carry`);
    }
  }
  return defects;
}

describe('compliance-off prompts: every operation and reference they name is in the compliance-off install (AC-48)', () => {
  const hosts = readVariantHosts();
  const offManifest = new Set(installedReferenceManifest({ compliance: false }));
  const agentPaths = offPromptPaths(hosts, 'agents');
  const commandPaths = offPromptPaths(hosts, 'commands');
  const gitAgentPath = variantOffRelPath('compliance-off', 'agents', 'git.md');

  it('reads the compliance-off Git agent, and fails when that file is missing', () => {
    expect(agentPaths, 'the Git agent is a compliance-armed host, so the off prompts include its file').toContain(gitAgentPath);
    const agents = readOffPrompts(ROOT, agentPaths);
    expect(agents.find(file => file.path === gitAgentPath)?.text ?? '', 'the off Git agent is read and is not empty').toContain('## Loading the mechanics');
    const empty = mkdtempSync(path.join(tmpdir(), 'devflow-off-prompts-'));
    try {
      expect(() => readOffPrompts(empty, [gitAgentPath])).toThrow(`${gitAgentPath} is absent`);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it('serves a machine with curation also off from the same Git agent file, and lists the both-off command files', () => {
    expect(agentPaths.filter(rel => rel.endsWith('/git.md')), 'the Git agent has no curation arm, so no both-off Git agent exists').toEqual([gitAgentPath]);
    expect(commandPaths.some(rel => rel.startsWith(`${BOTH_OFF_OUTPUT_DIR}/commands/`)), 'a command with both arms has a both-off file').toBe(true);
    expect(commandPaths.some(rel => rel.startsWith(`${COMPLIANCE_OFF_OUTPUT_DIR}/commands/`))).toBe(true);
  });

  it('the off Git agent and every off command name only operations and references the compliance-off manifest carries', () => {
    const files = readOffPrompts(ROOT, [...agentPaths, ...commandPaths]);
    expect(files.length, 'the scan reads the off agents and the off commands').toBeGreaterThan(1);
    expect(collectOffReachabilityDefects(files, offManifest)).toEqual([]);
  });

  it('non-vacuity: the compliance-on Git agent names all eight posting operations and the compliance-on commands name an omitted reference, and the same collector reports both', () => {
    const agent = collectOffReachabilityDefects(readOffPrompts(ROOT, ['dist/agents/git.md']), offManifest);
    for (const op of POSTING_OPERATIONS) {
      expect(agent.some(defect => defect.includes(` names ${op},`)), `the on Git agent names ${op}, so the collector must report it`).toBe(true);
    }
    const commandsDir = path.join(ROOT, 'dist', 'commands');
    const commands = readOffPrompts(ROOT, walkFiles(commandsDir, f => f.endsWith('.md')).map(f => path.relative(ROOT, f).split(path.sep).join('/')));
    expect(commands.length, 'the on commands are read').toBeGreaterThan(0);
    expect(collectOffReachabilityDefects(commands, offManifest).some(defect => defect.includes('names references/publication-gate.md,')), 'the on commands name the publication gate').toBe(true);
  });

  it('known-bad probes: a seeded posting operation, in any off prompt, is reported', () => {
    const files = readOffPrompts(ROOT, [...agentPaths, ...commandPaths]);
    for (const op of POSTING_OPERATIONS) {
      const seeded = files.map((file): OffPrompt => ({ ...file, text: `${file.text}\nOPERATION: ${op}\n` }));
      const defects = collectOffReachabilityDefects(seeded, offManifest);
      expect(defects.length, `${op} seeded into ${files.length} prompts`).toBeGreaterThanOrEqual(files.length);
      expect(defects.every(defect => defect.includes(` names ${op},`)), `${op}: only the seeded name is reported`).toBe(true);
    }
  });

  it('known-bad probes: a seeded omitted reference path is reported, and a kept operation the manifest lost is reported', () => {
    const agent = readOffPrompts(ROOT, [gitAgentPath]);
    for (const omitted of omittedReferencePaths()) {
      const seeded = agent.map((file): OffPrompt => ({ ...file, text: `${file.text}\nRead \`${omitted}\`.\n` }));
      expect(collectOffReachabilityDefects(seeded, offManifest), omitted).toContain(`${gitAgentPath}: names ${omitted}, which a compliance-off install does not carry`);
    }
    const lost = new Set([...offManifest].filter(rel => !rel.endsWith('/check-merge-readiness.md')));
    expect(collectOffReachabilityDefects(agent, lost).some(defect => defect.includes('names check-merge-readiness,')), 'the off agent names a kept operation').toBe(true);
    expect(collectOffReachabilityDefects([{ path: 'seeded.md', text: 'fetch-issues-batch and fetch-issue' }], offManifest)).toEqual([]);
  });
});
