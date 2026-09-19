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
  VARIANT_MODULES,
  expandVariants,
  generatedReferenceManifest,
} from '../../src/core/mds-variants.js';
import { collectTrackerNamingLines, resolveAgentSource, walkFiles } from '../helpers.js';
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

/**
 * The tool-call CONTRACT document's own reachability rule — a third kind, matching
 * its third module kind.
 *
 * A `fanout` file is reachable by instantiating the template; a `named` document is
 * reachable because the agent spells its path; the contract is reachable because
 * its DECLARED CONSUMERS name it — the per-operation mechanics of the providers
 * that reach their tracker through a tool call. That is not a weaker rule than the
 * other two, it is the same rule applied to the file's actual naming site: the
 * contract is deliberately NOT named from the always-loaded preamble (which would
 * be a second `references/tracker/` naming line, and the single-naming-line
 * assertion below forbids exactly that) and is deliberately NOT named from any
 * github op file (AC-3.12 — a CLI provider must not load a document about a
 * transport it never uses).
 *
 * Reads the generated tree rather than a list: "some shipped mechanics file names
 * it" is the property, and a hand-listed namer would drift from the files.
 */
function contractIsNamedByAConsumer(): boolean {
  const contract = 'tracker/_mcp.md';
  if (!generatedReferenceManifest().includes(contract)) return false;
  return walkFiles(path.join(REFS_DIR, 'tracker'), f => f.endsWith('.md'))
    .filter(file => path.basename(file) !== '_mcp.md')
    .some(file => requireFile('generated reference', file).includes(contract));
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
    const reachable = new Set([
      // The 'fanout' module kind, for every registered provider: reachable ⇔
      // instantiating the preamble's single templated instruction yields the path.
      ...providerReachablePaths(LOAD_INSTRUCTION_TEMPLATE),
      // The 'named' module kind: reachable ⇔ the compiled agent spells the path
      // out literally. Read out of the agent, never restated here (PF-018).
      ...[...collectLiteralReferenceNames(agent.content)].filter(rel =>
        (GIT_CROSS_CUTTING_DOCS as readonly string[]).includes(path.basename(rel, '.md')),
      ),
      // The 'contract' module kind: reachable ⇔ a shipped consumer names it.
      ...(contractIsNamedByAConsumer() ? ['tracker/_mcp.md'] : []),
    ]);

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
    // AND some shipped mechanics file names it. Either half alone would let an
    // unreachable contract ship (ADR-003) or a named one go missing.
    expect(
      contractIsNamedByAConsumer(),
      'the tool-call contract is in the manifest but no provider mechanics file names it — it ' +
      'would be installed on every machine of every user of that provider and read by nothing',
    ).toBe(generatedReferenceManifest().includes('tracker/_mcp.md'));
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
    const reachable = new Set([
      ...providerReachablePaths(LOAD_INSTRUCTION_TEMPLATE),
      ...[...namedInStripped].filter(rel =>
        (GIT_CROSS_CUTTING_DOCS as readonly string[]).includes(path.basename(rel, '.md')),
      ),
      ...(contractIsNamedByAConsumer() ? ['tracker/_mcp.md'] : []),
    ]);
    expect(generatedReferenceManifest().filter(rel => !reachable.has(rel))).toEqual([target]);
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
