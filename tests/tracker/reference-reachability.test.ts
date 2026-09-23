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
 *     machine (ADR-003), and an op the instruction can name with no file behind it
 *     is the `tracker mechanics unavailable` degradation shipped as the normal path.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import * as path from 'path';

import { compiledSkillRefsDir } from '../../src/core/assets.js';
import {
  TRACKER_GITHUB_OPS,
  GIT_CROSS_CUTTING_DOCS,
  MIN_VARIANT_PAIRS,
  PR_HOST_DESTINATION_ROOT,
  PR_HOST_OPS,
  VARIANT_MODULES,
  expandVariants,
  generatedReferenceManifest,
} from '../../src/core/mds-variants.js';
import {
  collectTrackerNamingLines,
  extractOpSectionFromCorpus,
  prHostRel,
  resolveAgentSource,
  walkFiles,
} from '../helpers.js';
import { MIN_REFERENCE_CHARS } from './reference-floor.js';

// ---------------------------------------------------------------------------
// Fail-loud reads
// ---------------------------------------------------------------------------

/**
 * Read a file that MUST exist. Throws with a build hint rather than returning an
 * empty string: a reachability scan over an absent tree reports nothing and
 * passes (PF-018).
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
 * pass by recognising nothing (PF-018).
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

  it('the D4 item-degradation clause stays with the operation in git.md', () => {
    // The batch-first form introduces new remote failure modes (a batch call that
    // 4xx's where 100 individual calls previously item-degraded per D4), so the
    // clause that says "degrade the item, continue" must remain in the
    // always-loaded file.
    const git = resolveAgentSource('git');
    const start = git.content.indexOf('## Operation: gather-release-evidence');
    expect(start, 'gather-release-evidence must still be an operation of the agent').toBeGreaterThan(-1);
    const next = git.content.indexOf('\n## Operation:', start + 1);
    const section = next === -1 ? git.content.slice(start) : git.content.slice(start, next);
    expect(section, 'gather-release-evidence: **Degradation (D4):** clause missing').toContain(
      '**Degradation (D4):**',
    );
    expect(
      section,
      'gather-release-evidence: the per-item degrade rule must stay in git.md',
    ).toContain('for any GitHub signal that could not be fetched');
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
// restating it would let the two drift and still pass (PF-018).

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

const CONTRACT_REL = 'tracker/_mcp.md';

/**
 * The tool-call CONTRACT document's own reachability rule — a third kind, matching
 * its third module kind.
 *
 * A `fanout` file is reachable by instantiating the template; a `named` document is
 * reachable because the agent spells its path; and so is the contract — the agent
 * names it, as a fixed literal, on the SAME physical line that composes the
 * per-operation mechanics path.
 *
 * IT USED TO BE THE CONSUMERS THAT NAMED IT, and that is the defect this rule
 * replaces. The contract carries the transport prohibition and the trust
 * discipline for every tracker call a non-github spawn makes, but only five of the
 * ten per-operation files happened to name it: the other five ran tracker calls
 * with neither. An extraction that turns a universal obligation into per-consumer
 * opt-in is PF-058 exactly, and "some shipped file names it" could never have
 * caught it — five namers satisfy it as completely as ten do.
 *
 * It is named from the preamble WITHOUT becoming a second convergence point,
 * because it shares the one existing naming line and is a fixed literal composed
 * from nothing: the validated provider token selects the mechanics directory and
 * never reaches this name. The inverse — no generated op file may name it — is a
 * live arm below, not a comment.
 */
function contractIsNamedByThePreamble(content: string): boolean {
  if (!generatedReferenceManifest().includes(CONTRACT_REL)) return false;
  const naming = collectTrackerNamingLines(content);
  return naming.length === 1 && naming[0].includes(`references/${CONTRACT_REL}`);
}

/** Named collector: generated op files that name the contract — must always be empty. */
function collectContractNamers(): string[] {
  return walkFiles(path.join(REFS_DIR, 'tracker'), f => f.endsWith('.md'))
    .filter(file => path.basename(file) !== '_mcp.md')
    .filter(file => requireFile('generated reference', file).includes(CONTRACT_REL))
    .map(file => path.relative(REFS_DIR, file).split(path.sep).join('/'));
}

/**
 * Named collector: every literal `references/<name>.md` the compiled agent spells
 * out, as a manifest-relative path.
 *
 * The templated tracker instruction is skipped — it is handled by reachablePaths
 * above, and a `{provider}`/`{op}` path is not a name any one file answers to.
 * This is the OTHER half of reachability: the three cross-cutting documents are
 * not reached by instantiating a template, they are named individually at exactly
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
 * green after the live arm is weakened (say to `includes`), which is the vacuous
 * pass PF-018 names.
 */
function anchorsOnLineOne(body: string, op: string): boolean {
  return body.startsWith(`## Operation: ${op}\n`);
}

/**
 * Named collector: every manifest path a spawn reading `content` could name.
 *
 * FOUR arms, one per module kind the registry carries, and the live check and
 * both known-bad probes drive this one function — a probe that rebuilt the union
 * inline would stay green after an arm was dropped from the real check (PF-018).
 *
 *   fanout / tracker    instantiate the preamble's ONE templated instruction;
 *   named               the agent spells the document's path out, once each;
 *   fanout / PR-host    the agent spells each file's path out, once per op. Not
 *                       templated on purpose: the file is the same under every
 *                       provider, so there is nothing to instantiate — and a
 *                       second templated instruction would be a second path
 *                       composed from the provider token, which is the single
 *                       convergence point PF-023 exists to protect;
 *   contract            the preamble names it, as a fixed literal.
 */
function reachableSetFrom(content: string): Set<string> {
  return new Set([
    ...providerReachablePaths(LOAD_INSTRUCTION_TEMPLATE),
    ...[...collectLiteralReferenceNames(content)].filter(rel =>
      (GIT_CROSS_CUTTING_DOCS as readonly string[]).includes(path.basename(rel, '.md')),
    ),
    ...collectPrHostNames(content),
    ...(contractIsNamedByThePreamble(content) ? [CONTRACT_REL] : []),
  ]);
}

describe('generated references: every reference is reachable from the agent (AC-2.7)', () => {
  const agent = resolveAgentSource('git');

  it('the preamble states exactly one load instruction, and it is the template', () => {
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
    // tracker/ excludes the three GIT_CROSS_CUTTING_DOCS from BOTH directions —
    // decision-markers.md, learn-conventions.md and publication-gate.md are
    // generated, installed on every machine and shipped in the tarball, and a
    // cross-cutting document that lost its one naming line is exactly as invisible
    // as an orphan file.
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
      'read by nothing (ADR-003):\n  ' + unreachable.join('\n  '),
    ).toEqual([]);

    const missing = [...reachable].filter(rel => !emitted.includes(rel));
    expect(
      missing,
      'the agent can name file(s) the build does not emit — every spawn that runs those ops takes ' +
      'the `tracker mechanics unavailable` degradation as its normal path:\n  ' +
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
    // The contract's own rule, asserted rather than assumed: it is in the manifest
    // AND the preamble names it. Either half alone would let an unreachable
    // contract ship (ADR-003) or a named one go missing.
    expect(
      contractIsNamedByThePreamble(agent.content),
      'the tool-call contract is in the manifest but the preamble does not name it — it would be ' +
      'installed on every machine of every user of that provider and read by nothing',
    ).toBe(generatedReferenceManifest().includes(CONTRACT_REL));
  });

  it('the contract is a FIXED per-spawn load: no generated op file names it', () => {
    // The inverse of the rule above, and the half that makes it a fix rather than a
    // relocation. While the per-operation files were the namers, five of ten named
    // it and five did not, and every guard in the tree was satisfied by the five
    // (PF-058). An op file that names it again re-opens exactly that door, so the
    // prohibition is absolute rather than a floor on the count.
    expect(
      collectContractNamers(),
      'generated op file(s) name the tool-call contract. It is loaded once per SPAWN from the ' +
      'agent preamble under every non-github provider; a per-operation naming line makes the ' +
      'load look conditional on which operation ran, which is how half the operations lost it:\n  ' +
      collectContractNamers().join('\n  '),
    ).toEqual([]);
  });

  it('known-bad probe: a seeded op-file naming line is reported by the same collector', () => {
    // The collector reads the built tree, so the probe re-runs its predicate over a
    // seeded body rather than writing into dist/ (PF-018 without a side effect).
    const namesContract = (body: string): boolean => body.includes(CONTRACT_REL);
    expect(
      namesContract('## Operation: setup-task\n\nRead `references/tracker/_mcp.md` first.\n'),
      'the predicate must see a seeded naming line — otherwise the prohibition above is inert',
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
      'direction is green for a document nothing can load (PF-018)',
    ).toBe(false);

    // …and the same set difference the live check computes now reports it.
    const reachable = reachableSetFrom(stripped);
    expect(generatedReferenceManifest().filter(rel => !reachable.has(rel))).toEqual([target]);
  });

  // ── The PR-host tree: parity, and its own reachability direction (#326) ────

  it('PR-host parity: every PR_HOST_OPS entry has a non-trivial file, and every pr/ file has an op', () => {
    // The same claim the provider trees carry, for the tree that belongs to no
    // provider. Both directions, because the forward one alone lets a stray file
    // ship unreferenced and the reverse one alone lets a listed op emit nothing —
    // and a per-file size floor, because a reference that kept its heading and
    // lost its body reads downstream as "mechanics unavailable" while the install
    // reports success (GAP-44).
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
        'section to whatever precedes it (PF-063)',
      ).toBe(true);
    }
  });

  it('PR-host parity known-bad probe: an anchor that is not on line 1 is reported', () => {
    // The anchor rule is a prefix check, so on live inputs it is green whether or
    // not the predicate is live (PF-064). Drive `anchorsOnLineOne` — the SAME
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
      'installed on every machine and read by nothing (ADR-003)',
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

/** Column-0 step labels (`1.`, `4b.`) in a body — the numbers the merged-order rule sequences. */
function stepLabels(body: string): string[] {
  return [...body.matchAll(/^(\d+[a-z]?)\.\s/gm)].map(m => m[1]);
}

/**
 * Named collector: step labels supplied by more than one file loaded for the same op.
 *
 * The agent's merge rule executes every loaded file's steps as ONE list in numeric
 * order. It interleaves; it has no rule for two files that both supply `4b.`, so a
 * shared label reads as either one step or the same step twice (a double
 * scrub-then-edit). Every label must therefore have exactly one owning file.
 */
function collectSharedStepLabels(files: ReadonlyArray<{ path: string; body: string }>): string[] {
  const owners = new Map<string, string[]>();
  for (const { path: rel, body } of files) {
    for (const label of new Set(stepLabels(body))) {
      owners.set(label, [...(owners.get(label) ?? []), rel]);
    }
  }
  return [...owners]
    .filter(([, paths]) => paths.length > 1)
    .map(([label, paths]) => `${label}. in ${paths.join(' and ')}`);
}

/** The files one spawn of a PR-host op loads under one provider, agent section included. */
function loadedStepFiles(
  agentContent: string,
  op: string,
  providerSubdir: string,
): Array<{ path: string; body: string }> {
  const files = [
    { path: 'git.md', body: extractOpSectionFromCorpus([{ path: 'git.md', content: agentContent }], op, { mode: 'sole' }).content },
    { path: prHostRel(op), body: prHostFiles().get(op) ?? '' },
  ];
  const mod = VARIANT_MODULES.find(m => m.subdir === providerSubdir);
  if (mod !== undefined && mod.ops.includes(op)) {
    const rel = `${providerSubdir}/${op}.md`;
    files.push({ path: rel, body: requireFile('provider reference', path.join(REFS_DIR, rel)) });
  }
  return files;
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

  it('no step label is supplied by two files loaded for the same op, under any provider', () => {
    const offenders = PROVIDER_SUBDIRS.flatMap(subdir =>
      PR_HOST_OPS.flatMap(op =>
        collectSharedStepLabels(loadedStepFiles(agent.content, op, subdir)).map(hit => `${op} (${subdir}): ${hit}`)));
    expect(
      offenders,
      'two loaded files supply the same step label — the merge rule has no collision clause, so the ' +
      'step reads as one step or as the same step twice:\n  ' + offenders.join('\n  '),
    ).toEqual([]);
  });

  it('the label rule is non-vacuous: some op loads three files, and the providers are all ranged', () => {
    expect(PROVIDER_SUBDIRS.length, 'no provider module registered').toBeGreaterThan(0);
    const threeFileOps = PR_HOST_OPS.filter(op => loadedStepFiles(agent.content, op, PROVIDER_SUBDIRS[0]).length === 3);
    expect(threeFileOps, 'no PR-host op is also a tracker op — the collision the rule guards cannot occur').not.toEqual([]);
  });

  it('known-bad probe: one label in two files is reported, disjoint labels are not', () => {
    const pr = { path: 'pr/x.md', body: '1. a\n4b. b\n' };
    expect(collectSharedStepLabels([pr, { path: 'tracker/github/x.md', body: '4b. c\n' }]))
      .toEqual(['4b. in pr/x.md and tracker/github/x.md']);
    expect(collectSharedStepLabels([pr, { path: 'tracker/github/x.md', body: '4c. c\n' }])).toEqual([]);
  });
});
