/**
 * Single-authority registries — one owner per normative sentence [DR-19].
 *
 * A rule that governs every provider is stated ONCE, in a document the mechanics
 * NAME rather than copy. Two kinds of owner exist, and each has its own registry
 * here because each has its own gate:
 *
 *   GIT_CROSS_CUTTING_DOCS — publication-gate.md, learn-conventions.md and
 *     decision-markers.md. Always generated, always installed.
 *   tracker/_mcp.md — the provider-independent tool-call contract. Generated only
 *     while a provider that reaches its tracker through a tool call is registered.
 *
 * The failure both registries exist to catch is a provider mechanics file
 * RESTATING one of those sentences: the rule then has two authorities, and the
 * second one varies per provider. Twenty per-op files authored against a document
 * they are told to "name, not restate" will restate it.
 *
 * Each registry carries both arms [DR-19]:
 *   positive — every registry sentence appears in exactly one document, the one
 *              the registry names;
 *   negative — no registry sentence appears in any
 *              references/tracker/{provider}/{op}.md.
 *
 * The two registries are SEPARATE rather than one table with an `owner` column,
 * and the separation is not tidiness: the cross-cutting arm asserts its owners are
 * exactly GIT_CROSS_CUTTING_DOCS, and the contract is a different module KIND
 * behind a different generation gate. Folding it in would have meant relaxing that
 * arm to admit a fourth owner — the blanket widening ADR-025 forbids — instead of
 * classifying the case.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import * as path from 'path';

import {
  GIT_CROSS_CUTTING_DOCS,
  TRACKER_GITHUB_OPS,
  VARIANT_MODULES,
  generatedReferenceManifest,
} from '../../src/core/mds-variants.js';
import { compiledSkillRefsDir } from '../../src/core/assets.js';
import { walkFiles } from '../helpers.js';

// ---------------------------------------------------------------------------
// Fail-loud reads
// ---------------------------------------------------------------------------

/**
 * Read a file that MUST exist. Throws with a build hint rather than returning an
 * empty string: both arms below scan for a sentence, and a scan over an absent or
 * empty corpus reports nothing and passes (PF-018).
 */
function requireFile(label: string, filePath: string): string {
  try {
    return readFileSync(filePath, 'utf-8');
  } catch {
    throw new Error(
      `${label}: ${filePath} is absent — run \`npm run build\` first\n` +
      '  (these guards read generated references; they cannot be skipped)',
    );
  }
}

const REFS_DIR = compiledSkillRefsDir();

// ---------------------------------------------------------------------------
// The justification floor
// ---------------------------------------------------------------------------

/**
 * Minimum characters a registry justification must carry.
 *
 * An emptiness-only check is cleared by `justification: 'x'`, which records that
 * someone typed something — not why a sentence has exactly one authority. 40
 * characters is roughly one clause: enough to name what the sentence decides and
 * what a second copy of it would cost, which is the sentence [DR-19] asks for. It
 * is a floor on effort, not on prose quality; every entry below clears it by a
 * wide margin.
 *
 * One owner for both registries. Spelled at each site it is a number that can
 * drift at one of them while the other and a presence-only check stay green.
 */
export const MIN_RATIONALE_CHARS = 40;

/**
 * Named collector: registry entries whose justification is below the floor.
 *
 * Parameterised on the entries so the known-bad probe drives the SAME predicate
 * both live arms do — a probe that re-implements the length test proves only that
 * the probe works (PF-018).
 */
function collectUnderJustified(
  entries: ReadonlyArray<{ readonly sentence: string; readonly justification: string }>,
): string[] {
  return entries
    .filter(entry => entry.justification.trim().length < MIN_RATIONALE_CHARS)
    .map(entry => entry.sentence);
}

// ---------------------------------------------------------------------------
// Shared corpora
// ---------------------------------------------------------------------------

/** The generated cross-cutting reference files, keyed by basename. */
function crossCuttingFiles(): Map<string, string> {
  const found = new Map<string, string>();
  for (const doc of GIT_CROSS_CUTTING_DOCS) {
    const file = path.join(REFS_DIR, `${doc}.md`);
    found.set(`${doc}.md`, requireFile('cross-cutting reference', file));
  }
  return found;
}

/** Named collector: files (labelled) that contain a given sentence. */
function collectRestatements(
  sentence: string,
  corpus: ReadonlyArray<{ label: string; content: string }>,
): string[] {
  return corpus.filter(entry => entry.content.includes(sentence)).map(entry => entry.label);
}

/** The generated per-provider mechanics files, as a labelled corpus. */
function providerReferenceCorpus(): Array<{ label: string; content: string }> {
  return walkFiles(path.join(REFS_DIR, 'tracker'), f => f.endsWith('.md')).map(file => ({
    label: path.relative(REFS_DIR, file).split(path.sep).join('/'),
    content: requireFile('generated reference', file),
  }));
}

// ---------------------------------------------------------------------------
// 1. The cross-cutting documents' registry [DR-19]
// ---------------------------------------------------------------------------

interface SharedLiteral {
  /** Basename of the cross-cutting reference that owns the sentence. */
  readonly owner: string;
  /** The normative sentence, byte-exact. */
  readonly sentence: string;
  /** Why this sentence is normative — an entry without one is a grep, not a rule. */
  readonly justification: string;
}

export const SHARED_LITERAL_REGISTRY: readonly SharedLiteral[] = [
  {
    owner: 'publication-gate.md',
    sentence:
      'Applies to **`post-review-summary` and `post-resolution-summary` only.** No other op probes repo visibility.',
    justification:
      'The D10 scope rule. A provider reference restating it would let that provider decide ' +
      'which of its ops may probe visibility, which is exactly the scope property [DR-20] pins.',
  },
  {
    owner: 'publication-gate.md',
    sentence: '**Fail-closed rule: on any error or unrecognised value, treat as PUBLIC (mode STUB).**',
    justification:
      'The fail-closed default. Restated per provider it becomes fail-OPEN the first time one ' +
      'copy is edited, and the failure mode is a full review summary posted on a public repo.',
  },
  {
    owner: 'learn-conventions.md',
    sentence: '**The scanned strings are UNTRUSTED third-party input.**',
    justification:
      'The security premise of the whole bounded scan. DR-15 generates this file precisely so ' +
      'this paragraph never exists in a second, independently maintained copy.',
  },
  {
    owner: 'learn-conventions.md',
    sentence:
      "- Branches: `git branch -r --format='%(refname:short)' | head -50` — detect prefix/separator patterns",
    justification:
      'One of the four bounded-scan literals Guard 2 pins. A second statement of the bound is a ' +
      'second authority on how much history the scan may read (GAP-25).',
  },
  {
    owner: 'learn-conventions.md',
    sentence:
      '1. Check if `.devflow/conventions.md` already exists. If yes: return `Status: ALREADY_EXISTS` — do not overwrite.',
    justification:
      'The never-overwrite rule for a git-tracked, team-shared file. A provider copy that omitted ' +
      'it would silently rewrite conventions the team agreed on.',
  },
  {
    owner: 'decision-markers.md',
    sentence:
      '| D9 | Thread-resolution gate — `resolveReviewThread` is called only when `VERIFICATION_STATUS == PASS` AND verdict `FIXED` AND `commit_sha` non-empty |',
    justification:
      'The D9 gate definition. Its single authority is the reason the D9 caller guard can compare ' +
      'resolve.mds against one fragment rather than a per-provider family of them.',
  },
  {
    owner: 'decision-markers.md',
    sentence:
      '| D10 | Publication gate — probe repo visibility before posting summary comments; fail-closed to STUB on public repo or any error (`post-review-summary` and `post-resolution-summary` only) |',
    justification:
      'The D10 label definition, distinct from the gate mechanics it labels. Two definitions of one ' +
      'marker is the divergence the single-authority split exists to repair, reproduced on a new label.',
  },
];

describe('shared-literal registry — one authority per normative sentence [DR-19]', () => {
  it('is non-empty, covers every cross-cutting document, and justifies every entry', () => {
    expect(
      SHARED_LITERAL_REGISTRY.length,
      'an empty registry makes both arms below pass by checking nothing (PF-018)',
    ).toBeGreaterThan(0);
    expect(
      [...new Set(SHARED_LITERAL_REGISTRY.map(e => e.owner))].sort(),
      'every cross-cutting document must contribute at least one normative sentence — a document ' +
      'with none is a document the negative arm cannot protect',
    ).toEqual(GIT_CROSS_CUTTING_DOCS.map(d => `${d}.md`).sort());
    expect(
      collectUnderJustified(SHARED_LITERAL_REGISTRY),
      `a registry entry justified in under ${MIN_RATIONALE_CHARS} characters is a grep, not a rule`,
    ).toEqual([]);
  });

  it('positive arm: every registry sentence lives in exactly one cross-cutting document, the one named', () => {
    const corpus = [...crossCuttingFiles()].map(([label, content]) => ({ label, content }));
    const problems: string[] = [];
    for (const entry of SHARED_LITERAL_REGISTRY) {
      const owners = collectRestatements(entry.sentence, corpus);
      if (owners.length !== 1 || owners[0] !== entry.owner) {
        problems.push(
          `${JSON.stringify(entry.sentence.slice(0, 60))} → expected [${entry.owner}], found [${owners.join(', ')}]`,
        );
      }
    }
    expect(problems, `shared-literal ownership problems:\n  ${problems.join('\n  ')}`).toEqual([]);
  });

  it('negative arm: no registry sentence is restated in any provider mechanics file', () => {
    const providers = providerReferenceCorpus();
    expect(
      providers.length,
      'no provider reference was read — the negative arm would be vacuous',
    ).toBeGreaterThanOrEqual(TRACKER_GITHUB_OPS.length);
    // Provenance, not just a count: the corpus walks `tracker/`, so it must reach
    // EVERY registered provider's directory and the contract beside them. A count
    // alone is met by one provider's files twice over.
    for (const mod of VARIANT_MODULES.filter(m => m.subdir.startsWith('tracker/'))) {
      expect(
        providers.some(entry => entry.label.startsWith(`${mod.subdir}/`)),
        `the shared-literal negative arm never read ${mod.subdir}/ — a provider mechanics tree ` +
        `outside this corpus is a tree that may restate a single-authority sentence freely`,
      ).toBe(true);
    }

    const restatements: string[] = [];
    for (const entry of SHARED_LITERAL_REGISTRY) {
      for (const file of collectRestatements(entry.sentence, providers)) {
        restatements.push(`${file}: ${JSON.stringify(entry.sentence.slice(0, 60))}`);
      }
    }
    expect(
      restatements,
      'a provider mechanics file restates a sentence that has a single authority — the rule now ' +
      'has two homes and the second one varies per provider:\n  ' + restatements.join('\n  '),
    ).toEqual([]);
  });

  it('known-bad probe: a seeded restatement in a provider file is reported by the same collector', () => {
    const seeded = [
      ...providerReferenceCorpus(),
      { label: 'tracker/github/probe.md', content: `prelude\n${SHARED_LITERAL_REGISTRY[0].sentence}\ntail\n` },
    ];
    expect(
      collectRestatements(SHARED_LITERAL_REGISTRY[0].sentence, seeded),
      'the collector must see a restatement in a provider file — otherwise the negative arm is inert',
    ).toEqual(['tracker/github/probe.md']);
  });
});

// ---------------------------------------------------------------------------
// 2. The tool-call contract's OWN registry [DR-19]
// ---------------------------------------------------------------------------
//
// WHAT IS AND IS NOT A REGISTRY ENTRY, because the distinction is the whole design.
// The contract mandates literals every posting mechanic MUST name: `D11-OK`,
// `<bytes>`, `SCRUB: N […]`, `SECRET-EXPOSED (…)`. Those are not restatements —
// tests/guards/mcp-sink-bypass.test.ts REQUIRES them per provider, and a registry
// that forbade them would fight that guard. What may not be restated is the
// contract's own statement of a RULE: where the gated bytes come from, what the
// framing line consists of, which transformations are forbidden, the capability
// table's rows, and how a tool is selected. A provider file reproducing one of
// those has acquired a second authority on it, and the second one varies per
// provider — which is exactly the defect the three cross-cutting documents were
// built to remove, one level down.

interface McpSharedLiteral {
  /** The normative sentence, byte-exact as the generated contract spells it. */
  readonly sentence: string;
  /** Why this sentence is the contract's to state — an entry without one is a grep. */
  readonly justification: string;
}

export const MCP_SHARED_LITERAL_REGISTRY: readonly McpSharedLiteral[] = [
  {
    sentence: 'D11-OK <nonce> <sha256> <bytes> <n> [type:count,…]',
    justification:
      'The framing line\'s COMPOSITION [DR-01]. A provider restating the field order would fix ' +
      'its own reading of which field is the byte count, and [DR-06]\'s check reads that field ' +
      'by position — a mechanic verifying the wrong field passes a truncated body.',
  },
  {
    sentence: 'Everything after line 1 is `{SCRUBBED_BODY}`.',
    justification:
      'The definition of where the gated bytes come from. It is the sentence that makes the ' +
      'placeholder mean anything, and a provider restating it is a provider that could redefine ' +
      'it — the bytes behind the placeholder are obtainable only from behind a framing line the ' +
      'scrubber alone can produce.',
  },
  {
    sentence: '**NO re-encoding. NO base64. NO chunking. NO summarisation. NO reflowing.**',
    justification:
      'The transformation prohibition. Restated per provider it becomes negotiable the first time ' +
      'one copy is edited to admit the wrapper that provider happens to need, and a body scrubbed ' +
      'and then re-encoded is a body whose scrub no longer holds.',
  },
  {
    sentence: '**Select by capability DESCRIPTION, never by tool name.**',
    justification:
      'The selection rule the whole capability vocabulary rests on. A provider restating it is a ' +
      'provider one edit away from naming tool names instead, which binds the mechanics to one ' +
      'server and one version — and the DEGRADED reason vocabulary is derived from the capability ' +
      'table, so a provider selecting by tool name degrades on names nobody can grep for.',
  },
  {
    sentence: '| fetch by key | `no tracker tool for fetch by key` |',
    justification:
      'A capability-table ROW. The prose form (`DEGRADED (no tracker tool for fetch by key)`) is ' +
      'what a provider emits and is required of it; the TABLE is the contract\'s, and a provider ' +
      'reproducing it would be a second definition of the closed capability vocabulary — the ' +
      'triplication GAP-37 forbids.',
  },
];

/**
 * One registry entry, addressed by its sentence and raised by name when absent.
 *
 * `find(...)!` would hand the probe below an `undefined` that surfaces as "cannot
 * read properties of undefined" one line later, naming neither the registry nor
 * the sentence that left it — and the sentence leaving the registry is exactly the
 * change this probe exists to notice.
 */
function requireRegistryEntry(sentence: string): McpSharedLiteral {
  const found = MCP_SHARED_LITERAL_REGISTRY.find(e => e.sentence === sentence);
  if (found === undefined) {
    throw new Error(
      `MCP_SHARED_LITERAL_REGISTRY holds no entry for ${JSON.stringify(sentence)} (registered: ` +
      `${MCP_SHARED_LITERAL_REGISTRY.map(e => JSON.stringify(e.sentence)).join(', ')}) — ` +
      `this arm has no subject`,
    );
  }
  return found;
}

/** The generated tool-call contract, read fail-loud. */
function contractFile(): string {
  return requireFile('tool-call contract', path.join(REFS_DIR, 'tracker', '_mcp.md'));
}

describe('tool-call contract: one authority per normative sentence [DR-19]', () => {
  it('the gate is open, so this arm has a subject in both halves', () => {
    // The contract is generated only while a provider that needs it is registered,
    // and so is the provider tree the negative arm walks. Both halves vanish
    // together, so asserting the gate is open is what distinguishes "no
    // restatements" from "nothing to restate" (PF-018).
    expect(
      generatedReferenceManifest(),
      'the contract must be in the manifest — with the gate shut there is no contract to protect ' +
      'and no provider tree to protect it from',
    ).toContain('tracker/_mcp.md');
    expect(
      MCP_SHARED_LITERAL_REGISTRY.length,
      'an empty registry makes both arms below pass by checking nothing (PF-018)',
    ).toBeGreaterThan(0);
    expect(
      collectUnderJustified(MCP_SHARED_LITERAL_REGISTRY),
      `a registry entry justified in under ${MIN_RATIONALE_CHARS} characters is a grep, not a rule`,
    ).toEqual([]);
  });

  it('positive arm: every registry sentence is in the contract, and in nothing else', () => {
    // Scoped over the contract PLUS the three cross-cutting documents: a sentence
    // that had migrated into one of those would have two homes just as surely as
    // one that migrated into a provider file, and the sibling registry above would
    // not see it because it only knows its own sentences.
    const corpus = [
      { label: 'tracker/_mcp.md', content: contractFile() },
      ...[...crossCuttingFiles()].map(([label, content]) => ({ label, content })),
    ];
    const problems: string[] = [];
    for (const entry of MCP_SHARED_LITERAL_REGISTRY) {
      const owners = collectRestatements(entry.sentence, corpus);
      if (owners.length !== 1 || owners[0] !== 'tracker/_mcp.md') {
        problems.push(
          `${JSON.stringify(entry.sentence.slice(0, 60))} → expected [tracker/_mcp.md], found ` +
          `[${owners.join(', ')}]`,
        );
      }
    }
    expect(
      problems,
      `tool-call contract ownership problems:\n  ${problems.join('\n  ')}`,
    ).toEqual([]);
  });

  it('negative arm: no registry sentence is restated in any provider mechanics file', () => {
    // The corpus walks `tracker/` and then EXCLUDES the contract itself: it is the
    // owner, so including it would report every entry as a restatement of itself.
    const providers = providerReferenceCorpus().filter(e => e.label !== 'tracker/_mcp.md');
    expect(
      providers.length,
      'no provider reference was read — the negative arm would be vacuous',
    ).toBeGreaterThanOrEqual(TRACKER_GITHUB_OPS.length);
    // Provenance, not a count: the arm must reach every registered provider's
    // directory, including the ones whose mechanics actually name the contract.
    for (const mod of VARIANT_MODULES.filter(m => m.subdir.startsWith('tracker/'))) {
      expect(
        providers.some(entry => entry.label.startsWith(`${mod.subdir}/`)),
        `the contract's negative arm never read ${mod.subdir}/ — a provider mechanics tree outside ` +
        `this corpus is a tree that may restate the contract freely`,
      ).toBe(true);
    }

    const restatements: string[] = [];
    for (const entry of MCP_SHARED_LITERAL_REGISTRY) {
      for (const file of collectRestatements(entry.sentence, providers)) {
        restatements.push(`${file}: ${JSON.stringify(entry.sentence.slice(0, 60))}`);
      }
    }
    expect(
      restatements,
      'a provider mechanics file restates a sentence the tool-call contract owns. The load chain ' +
      'is one-directional — a per-operation file may INVOKE a rule and never restate its ' +
      'substance — and on any conflict the contract wins, which only means anything while there ' +
      `is one copy to conflict with:\n  ${restatements.join('\n  ')}`,
    ).toEqual([]);
  });

  it('the arm does NOT forbid the literals every posting mechanic must name', () => {
    // The other direction of the same rule, and the one that keeps this registry
    // from fighting tests/guards/mcp-sink-bypass.test.ts. Those literals are
    // MANDATED per provider; a registry that swept them up would make the two
    // guards unsatisfiable together, and the one that would be "fixed" is this one.
    const mandated = ['D11-OK', '<bytes>', 'SCRUB: N', 'SECRET-EXPOSED'];
    for (const literal of mandated) {
      expect(
        MCP_SHARED_LITERAL_REGISTRY.some(e => e.sentence === literal),
        `"${literal}" must NOT be a registry entry — every posting mechanic is required to name it`,
      ).toBe(false);
    }
    const posting = providerReferenceCorpus().filter(
      e => e.label !== 'tracker/_mcp.md' && e.content.includes('{SCRUBBED_BODY}'),
    );
    expect(
      posting.length,
      'no posting mechanic was read, so this arm proves nothing about the mandated literals',
    ).toBeGreaterThan(0);
    for (const entry of posting) {
      for (const literal of mandated) {
        expect(entry.content, `${entry.label} must still name ${literal}`).toContain(literal);
      }
    }
  });

  it('known-bad probe: a seeded restatement of the {SCRUBBED_BODY} rule is reported', () => {
    // [DR-19]'s named known-bad, verbatim in intent. Driven through the SAME
    // collector the negative arm uses, over the real provider corpus plus one
    // seeded file, so a collector that had stopped reporting takes this red too.
    const rule = requireRegistryEntry('Everything after line 1 is `{SCRUBBED_BODY}`.');
    const seeded = [
      ...providerReferenceCorpus().filter(e => e.label !== 'tracker/_mcp.md'),
      {
        label: 'tracker/linear/probe.md',
        content: [
          '## Operation: probe',
          'Run the scrubber with `--emit` and read the framing line.',
          rule.sentence,
          'Post through the *add comment* capability.',
        ].join('\n'),
      },
    ];
    expect(
      collectRestatements(rule.sentence, seeded),
      'the collector must see the contract\'s own rule restated inside a provider file — ' +
      'otherwise the negative arm is inert against the one shape [DR-19] names',
    ).toEqual(['tracker/linear/probe.md']);
    // …and every other registry entry stays unreported over the same seeded corpus,
    // so the probe proves the collector discriminates rather than matching anything.
    for (const entry of MCP_SHARED_LITERAL_REGISTRY) {
      if (entry.sentence === rule.sentence) continue;
      expect(
        collectRestatements(entry.sentence, seeded),
        `"${entry.sentence.slice(0, 40)}" was not seeded and must not be reported`,
      ).toEqual([]);
    }
  });

  it('known-bad probe: a token justification is reported by the same length rule', () => {
    // The floor is proven live rather than asserted about (PF-018): the probe drives
    // collectUnderJustified — the SAME predicate both registries' first arm reads —
    // over seeded entries, so a floor that stopped rejecting takes this red too.
    const seeded = [
      { sentence: 'empty', justification: '' },
      { sentence: 'keystroke', justification: 'x' },
      { sentence: 'too short', justification: 'moved on purpose' },
      { sentence: 'at the floor', justification: 'a'.repeat(MIN_RATIONALE_CHARS) },
    ];
    expect(
      collectUnderJustified(seeded),
      'the length rule must reject the empty, the single-character and the 16-character ' +
      'justifications and accept only the one that clears the floor',
    ).toEqual(['empty', 'keystroke', 'too short']);
  });
});
