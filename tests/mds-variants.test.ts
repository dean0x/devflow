/**
 * Unit tests for src/core/mds-variants.ts
 *
 * The module is the pure core behind the MDS host conventions: it decides
 * whether a host's emitted filename is safe, whether its declared `output-dir:`
 * is one of the directories the build is allowed to write into, and — for a
 * reference module — which files it fans out into and which slice of its body
 * each one carries. scripts/build-mds.ts is the imperative shell around it (it
 * owns every process.exit and every filesystem call).
 *
 * Scenario coverage:
 *   1. validateOutputName — accepts real host basenames, rejects traversal,
 *      separators, charset violations, over-length names.
 *   2. resolveOutputDir (containment) — resolved-path allowlist, escape guard,
 *      canonical-declaration requirement.
 *   3. Result error-union completeness — every declared error kind is reachable
 *      from a test input, and no input produces a kind outside the union.
 *   4. expandVariants — the flat (module, op) pair list, its minimum length, and
 *      the refusals that keep a hostile op name or subdir out of the destination.
 *   5. splitVariantSections — bidirectional op-set parity plus the empty-section
 *      arm neither direction of that parity can see.
 *   6. The shipped registry — GitHub-only, pointing at a real source path.
 *
 * Hostile inputs pinned here are the same ones scripts/build-mds.ts must reject
 * at build time (see tests/build-mds-generator-hosts.test.ts for the subprocess
 * proof that they exit 1).
 */

import { describe, it, expect } from 'vitest';
import { existsSync } from 'fs';
import * as path from 'path';

import {
  validateOutputName,
  resolveOutputDir,
  expandVariants,
  splitVariantSections,
  ALLOWED_OUTPUT_DIR_NAMES,
  SKILL_REFS_OUTPUT_DIR,
  VARIANT_MODULES,
  TRACKER_GITHUB_OPS,
  GIT_CROSS_CUTTING_DOCS,
  MIN_VARIANT_PAIRS,
  MCP_BACKED_PROVIDER_SUBDIRS,
  MCP_CONTRACT_MODULE,
  mcpContractIsGenerated,
  resolveVariantModules,
  generatedReferenceManifest,
  validateContractOutputName,
  type VariantModule,
  type OutputNameError,
  type OutputDirError,
  type HostVariant,
  type VariantModule,
} from '../src/core/mds-variants.js';
import { ALL_MDS_HOSTS } from './fixtures/mds-manifest.js';

const ROOT = path.resolve(import.meta.dirname, '..');

/** Helper: the error of a call that must have failed (throws if it succeeded). */
function errorOf<T, E>(result: { ok: true; value: T } | { ok: false; error: E }): E {
  if (result.ok) {
    throw new Error(`Expected failure but got success: ${JSON.stringify(result.value)}`);
  }
  return result.error;
}

/** Helper: the value of a call that must have succeeded. */
function valueOf<T, E>(result: { ok: true; value: T } | { ok: false; error: E }): T {
  if (!result.ok) {
    throw new Error(`Expected success but got error: ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

// ---------------------------------------------------------------------------
// Hostile corpora — one definition each, shared by the rejection tests and by
// the error-union completeness proofs in section 3.
// ---------------------------------------------------------------------------
//
// Naming them here rather than inlining them is what makes the completeness
// probes possible: a probe can narrow a corpus and show the assertion goes red,
// which is the only evidence that the corpus (not the expectation list) is
// carrying the load (PF-018).

/** Every name validateOutputName must reject, the empty name included. */
const NAME_CORPUS: readonly string[] = [
  '', '..', '../x', 'a/b', 'a\\b', 'Git', 'a b', '-lead', 'a'.repeat(65),
];

/** Every output-dir declaration resolveOutputDir must reject. */
const DIR_CORPUS: readonly string[] = [
  'dist/wrong-dir', 'dist', 'dist/skills',
  'dist/../..', '/tmp/elsewhere',
  'dist/commands/', './dist/agents', 'dist/skills/../commands',
  'dist\\commands',
];

// ---------------------------------------------------------------------------
// 1. validateOutputName
// ---------------------------------------------------------------------------

describe('validateOutputName', () => {
  it('accepts every basename the repo ships today', () => {
    // ALL_MDS_HOSTS (tests/fixtures/mds-manifest.ts) is the single definition of
    // every basename the build owns, command hosts and the Phase 1 generator
    // host alike. A rule that rejected any of these would break the build.
    for (const name of ALL_MDS_HOSTS) {
      const result = validateOutputName(name);
      expect(result.ok, `expected '${name}' to be accepted, got ${JSON.stringify(result)}`).toBe(true);
      expect(valueOf(result)).toBe(name);
    }
  });

  it('accepts dots and underscores inside the name', () => {
    expect(validateOutputName('a.b_c-d').ok).toBe(true);
    expect(validateOutputName('v2.1').ok).toBe(true);
  });

  it('rejects the empty name', () => {
    expect(errorOf(validateOutputName('')).kind).toBe('empty');
  });

  it('rejects a parent-directory traversal name (output-name: ../x)', () => {
    // The exact hostile value the build must refuse. Traversal is reported as
    // its own kind so the build message can say why, not just "invalid".
    expect(errorOf(validateOutputName('../x')).kind).toBe('dot-segment');
  });

  it('rejects a bare `..`', () => {
    expect(errorOf(validateOutputName('..')).kind).toBe('dot-segment');
  });

  it('rejects a nested path name (output-name: a/b)', () => {
    expect(errorOf(validateOutputName('a/b')).kind).toBe('path-separator');
  });

  it('rejects a backslash-separated name', () => {
    expect(errorOf(validateOutputName('a\\b')).kind).toBe('path-separator');
  });

  it('rejects an absolute path name', () => {
    expect(errorOf(validateOutputName('/etc/passwd')).kind).toBe('path-separator');
  });

  it('rejects uppercase, spaces, and shell metacharacters', () => {
    for (const bad of ['Git', 'my name', 'a;b', 'a$b', 'a|b', 'a\nb', '.hidden', '-lead']) {
      expect(
        errorOf(validateOutputName(bad)).kind,
        `expected '${bad}' to be rejected as invalid-charset`,
      ).toBe('invalid-charset');
    }
  });

  it('rejects a name longer than 64 characters (bounded, no unbounded repetition)', () => {
    expect(validateOutputName('a'.repeat(64)).ok).toBe(true);
    expect(errorOf(validateOutputName('a'.repeat(65))).kind).toBe('invalid-charset');
  });

  it('carries the offending name on every non-empty rejection', () => {
    // "every" means the whole rejection corpus, not one sample: the build quotes
    // err.name back to the author, so a kind that forgot to carry it produces a
    // message naming nothing. 'empty' is the one kind with no name to carry and
    // is excluded by the test's own name.
    const nonEmpty = NAME_CORPUS.filter(input => input !== '');
    expect(nonEmpty.length, 'non-empty rejection corpus must not be empty (PF-018)').toBeGreaterThan(0);

    for (const input of nonEmpty) {
      const err = errorOf(validateOutputName(input));
      expect(err.kind, `'${input}' must not be rejected as the empty kind`).not.toBe('empty');
      expect(
        err.kind === 'empty' ? undefined : err.name,
        `the rejection of '${input}' must carry the offending name`,
      ).toBe(input);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. resolveOutputDir — containment + resolved-path allowlist
// ---------------------------------------------------------------------------

describe('resolveOutputDir (containment)', () => {
  it('accepts dist/commands and returns the resolved absolute directory', () => {
    expect(valueOf(resolveOutputDir(ROOT, 'dist/commands')).abs)
      .toBe(path.join(ROOT, 'dist', 'commands'));
  });

  it('accepts dist/agents and returns the resolved absolute directory', () => {
    expect(valueOf(resolveOutputDir(ROOT, 'dist/agents')).abs)
      .toBe(path.join(ROOT, 'dist', 'agents'));
  });

  it('rejects a directory that is not on the allowlist (dist/wrong-dir)', () => {
    const err = errorOf(resolveOutputDir(ROOT, 'dist/wrong-dir'));
    expect(err.kind).toBe('not-allowlisted');
  });

  it('rejects dist/ itself and dist/skills', () => {
    expect(errorOf(resolveOutputDir(ROOT, 'dist')).kind).toBe('not-allowlisted');
    expect(errorOf(resolveOutputDir(ROOT, 'dist/skills')).kind).toBe('not-allowlisted');
  });

  it('rejects a traversal that escapes the repo root (dist/../..)', () => {
    const err = errorOf(resolveOutputDir(ROOT, 'dist/../..'));
    expect(err.kind).toBe('escapes-root');
  });

  it('rejects an absolute path outside the root', () => {
    expect(errorOf(resolveOutputDir(ROOT, '/tmp/elsewhere')).kind).toBe('escapes-root');
  });

  it('rejects a trailing-slash declaration (dist/commands/) as non-canonical', () => {
    // Resolved-path equality alone would accept this. The declaration itself
    // must be canonical so the build never has two spellings for one target.
    const err = errorOf(resolveOutputDir(ROOT, 'dist/commands/'));
    expect(err.kind).toBe('non-canonical');
  });

  it('rejects a ./-prefixed declaration as non-canonical', () => {
    expect(errorOf(resolveOutputDir(ROOT, './dist/agents')).kind).toBe('non-canonical');
  });

  it('rejects a redundant-traversal declaration that still lands on the allowlist', () => {
    // dist/skills/../commands resolves INTO dist/commands. Resolved-path
    // equality accepts it; the canonical-declaration rule refuses it.
    expect(errorOf(resolveOutputDir(ROOT, 'dist/skills/../commands')).kind).toBe('non-canonical');
  });

  it('rejects a backslash-spelled declaration (dist\\commands) on every platform', () => {
    // path.posix.normalize() leaves a backslash untouched, so on win32 this
    // spelling would resolve onto dist/commands and pass the canonical check.
    // The declaration charset is POSIX by contract, so the backslash is refused
    // outright and the module behaves identically on darwin, linux, and win32.
    expect(errorOf(resolveOutputDir(ROOT, 'dist\\commands')).kind).toBe('backslash-separator');
    expect(errorOf(resolveOutputDir(ROOT, 'dist\\agents')).kind).toBe('backslash-separator');
  });

  it('resolves against the supplied root, not the process cwd (pure, injectable)', () => {
    const fakeRoot = path.join(path.sep, 'nonexistent-root-for-purity-check');
    expect(valueOf(resolveOutputDir(fakeRoot, 'dist/agents')).abs)
      .toBe(path.join(fakeRoot, 'dist', 'agents'));
  });

  it('accepts dist/skills/git/references and returns the resolved absolute directory', () => {
    expect(valueOf(resolveOutputDir(ROOT, SKILL_REFS_OUTPUT_DIR)).abs)
      .toBe(path.join(ROOT, 'dist', 'skills', 'git', 'references'));
  });

  it('carries the full allowlist on rejections so the caller can render the message', () => {
    const err = errorOf(resolveOutputDir(ROOT, 'dist/wrong-dir'));
    if (err.kind === 'escapes-root') throw new Error('unexpected kind');
    // The expectation is the exported table, not a retyped copy of it: a new
    // destination must not be able to pass this test by being typed twice.
    expect([...err.allowed]).toEqual([...ALLOWED_OUTPUT_DIR_NAMES]);
    expect(err.allowed.length, 'allowlist must be non-empty (PF-018)').toBeGreaterThanOrEqual(3);
    // The build's message renders the allowlist into the pre-existing template:
    //   output-dir '<declared>' is not the expected '<expected>' — typo?
    expect(err.allowed.join("' or '")).toBe(ALLOWED_OUTPUT_DIR_NAMES.join("' or '"));
  });
});

// ---------------------------------------------------------------------------
// 2b. resolveOutputDir — the host variant travels with the resolved directory
// ---------------------------------------------------------------------------
//
// The allowlist entry that matched is the only thing that knows which strip
// strategy a host needs. Returning it means scripts/build-mds.ts dispatches on a
// discriminant it was handed, never on absolute-path string equality it derived
// for itself — one source of truth, per the allowlist's extension-point contract.

describe('resolveOutputDir (host variant)', () => {
  /** Named collector: the variant every allowlisted declaration resolves to. */
  function collectVariants(declarations: readonly string[]): Map<string, HostVariant> {
    const variants = new Map<string, HostVariant>();
    for (const declared of declarations) {
      const result = resolveOutputDir(ROOT, declared);
      if (result.ok) variants.set(declared, result.value.variant);
    }
    expect(declarations.length, 'declaration corpus must be non-empty (PF-018)').toBeGreaterThan(0);
    return variants;
  }

  it('tags each allowlisted directory with the variant that selects its strip', () => {
    const variants = collectVariants(ALLOWED_OUTPUT_DIR_NAMES);
    expect(variants.get('dist/commands')).toBe('commands');
    expect(variants.get('dist/agents')).toBe('agents');
    expect(variants.get(SKILL_REFS_OUTPUT_DIR)).toBe('skill-refs');
  });

  it('every allowlisted directory carries a distinct variant (no two share a strip)', () => {
    const variants = collectVariants(ALLOWED_OUTPUT_DIR_NAMES);
    expect(variants.size).toBe(ALLOWED_OUTPUT_DIR_NAMES.length);
    expect(new Set(variants.values()).size).toBe(ALLOWED_OUTPUT_DIR_NAMES.length);
  });

  it('known-bad probe: a phantom variant is not what the allowlist produces', () => {
    // If resolveOutputDir returned a bare string (or a constant variant), the
    // assertions above would hold for the wrong reason. Seeding the expected
    // value with a variant no allowlist entry declares must fail.
    const variants = collectVariants(ALLOWED_OUTPUT_DIR_NAMES);
    expect(variants.get('dist/agents')).not.toBe('commands');
    expect([...variants.values()]).not.toContain('skills');
  });

  it('a rejected declaration carries no variant at all', () => {
    const rejected = resolveOutputDir(ROOT, 'dist/wrong-dir');
    expect(rejected.ok).toBe(false);
    expect(!rejected.ok && 'value' in rejected).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. Result error-union completeness
// ---------------------------------------------------------------------------
//
// A union member that no input can produce is dead code (ADR-003 clause iii).
// The two assertions here are the non-vacuity proof — each declared kind is
// reached by a concrete input, and no input reaches a kind outside the declared
// set — and the two probes below prove those assertions can actually go red, in
// both of the directions that matter: a declared kind nothing reaches, and a
// corpus that stopped reaching one (PF-018).

describe('Result error-union completeness', () => {
  const NAME_KINDS: ReadonlyArray<OutputNameError['kind']> = [
    'empty', 'dot-segment', 'path-separator', 'invalid-charset',
  ];
  const DIR_KINDS: ReadonlyArray<OutputDirError['kind']> = [
    'escapes-root', 'backslash-separator', 'non-canonical', 'not-allowlisted',
  ];

  /** Named collector: every OutputNameError kind the given corpus produces. */
  function collectNameKinds(corpus: readonly string[] = NAME_CORPUS): Set<string> {
    expect(corpus.length, 'name corpus must be non-empty (PF-018)').toBeGreaterThan(0);
    const kinds = new Set<string>();
    for (const input of corpus) {
      const result = validateOutputName(input);
      if (!result.ok) kinds.add(result.error.kind);
    }
    return kinds;
  }

  /** Named collector: every OutputDirError kind the given corpus produces. */
  function collectDirKinds(corpus: readonly string[] = DIR_CORPUS): Set<string> {
    expect(corpus.length, 'dir corpus must be non-empty (PF-018)').toBeGreaterThan(0);
    const kinds = new Set<string>();
    for (const input of corpus) {
      const result = resolveOutputDir(ROOT, input);
      if (!result.ok) kinds.add(result.error.kind);
    }
    return kinds;
  }

  interface CompletenessVerdict {
    /** Declared kinds the corpus never reached — a dead member, or lost coverage. */
    missing: string[];
    /** Kinds the corpus reached that the declared union does not list. */
    unexpected: string[];
  }

  /** The single verdict both the assertions and the probes below read. */
  function completeness(
    reached: ReadonlySet<string>,
    declared: readonly string[],
  ): CompletenessVerdict {
    return {
      missing: declared.filter(kind => !reached.has(kind)),
      unexpected: [...reached].filter(kind => !declared.includes(kind)),
    };
  }

  it('every OutputNameError kind is reachable from a real input', () => {
    const verdict = completeness(collectNameKinds(), NAME_KINDS);
    expect(verdict.missing, 'declared OutputNameError kind(s) no corpus input reaches').toEqual([]);
    expect(verdict.unexpected, 'OutputNameError kind(s) outside the declared union').toEqual([]);
  });

  it('every OutputDirError kind is reachable from a real input', () => {
    const verdict = completeness(collectDirKinds(), DIR_KINDS);
    expect(verdict.missing, 'declared OutputDirError kind(s) no corpus input reaches').toEqual([]);
    expect(verdict.unexpected, 'OutputDirError kind(s) outside the declared union').toEqual([]);
  });

  it('known-bad probe: a declared kind nothing reaches turns the verdict red', () => {
    // The direction that has teeth. Adding a phantom to the REACHED set would be
    // different from the declared set by construction — true of any
    // implementation, and therefore proof of nothing. Seeding it into the
    // DECLARED set runs the real collector over the real corpus and asks whether
    // the verdict the assertions above read notices that nothing produces it.
    expect(completeness(collectNameKinds(), [...NAME_KINDS, 'phantom-kind']).missing)
      .toEqual(['phantom-kind']);
    expect(completeness(collectDirKinds(), [...DIR_KINDS, 'phantom-kind']).missing)
      .toEqual(['phantom-kind']);
  });

  it('known-bad probe: narrowing the corpus turns the verdict red for exactly the dropped kind', () => {
    // Proves the corpus carries the load rather than the expectation list: for
    // every declared kind, dropping the inputs that produce it must make the
    // completeness assertion fail, naming that kind and nothing else. A kind
    // whose inputs can all be removed with the check still green was never
    // being proved reachable in the first place.
    for (const kind of NAME_KINDS) {
      const narrowed = NAME_CORPUS.filter(input => {
        const result = validateOutputName(input);
        return result.ok || result.error.kind !== kind;
      });
      expect(narrowed.length, `narrowed name corpus for '${kind}' must stay non-empty`).toBeGreaterThan(0);
      expect(
        completeness(collectNameKinds(narrowed), NAME_KINDS).missing,
        `dropping every NAME_CORPUS input that produces '${kind}' left the check green`,
      ).toEqual([kind]);
    }

    for (const kind of DIR_KINDS) {
      const narrowed = DIR_CORPUS.filter(input => {
        const result = resolveOutputDir(ROOT, input);
        return result.ok || result.error.kind !== kind;
      });
      expect(narrowed.length, `narrowed dir corpus for '${kind}' must stay non-empty`).toBeGreaterThan(0);
      expect(
        completeness(collectDirKinds(narrowed), DIR_KINDS).missing,
        `dropping every DIR_CORPUS input that produces '${kind}' left the check green`,
      ).toEqual([kind]);
    }
  });

  it('succeeding calls never carry an error and failing calls never carry a value', () => {
    // The discriminant is asserted FIRST, on its own line. Folding it into the
    // same expression (`good.ok && 'error' in good`) makes the assertion pass by
    // short-circuit under exactly the failure it claims to catch: a `good` that
    // came back `{ok: false}` yields `false`, which is the expected value.
    const good = validateOutputName('git');
    expect(good.ok, 'validateOutputName("git") must succeed for this check to mean anything').toBe(true);
    expect('error' in good, 'a successful Result must not carry an error arm').toBe(false);

    const bad = resolveOutputDir(ROOT, 'dist/wrong-dir');
    expect(bad.ok, 'resolveOutputDir must refuse a non-allowlisted directory').toBe(false);
    expect('value' in bad, 'a refused Result must not carry a value arm').toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4. expandVariants — one reference module fans out into many op files
// ---------------------------------------------------------------------------
//
// Moved here from Phase 1 (DR-16): in Phase 1 the only consumer of an expander
// would have been its own unit test, which is the structural defect the
// prefix-shippability clause (iii) forbids. It arrives with the registry that
// makes it load-bearing, and the registry is long enough from its first commit
// that parity over it discriminates (GAP-42).

describe('expandVariants', () => {
  it('expands the RESOLVED registry into one pair per (module, op)', () => {
    // expandVariants defaults to resolveVariantModules(), so the shipped expansion
    // is the declared registry PLUS whatever the gates open. Counting only
    // VARIANT_MODULES was right while every gate was shut and understates the
    // expansion by exactly the gated module the moment one opens — the shape of an
    // assertion that describes a phase rather than a mechanism.
    const pairs = valueOf(expandVariants());
    const resolved = resolveVariantModules();
    const expected = resolved.reduce((n, m) => n + m.ops.length, 0);
    expect(pairs).toHaveLength(expected);
    expect(
      pairs.map(p => p.op),
      'the op sequence is the resolved registry read in order — every provider contributes the ' +
      'whole shared roster, and the gated contract contributes its single basename last',
    ).toEqual(resolved.flatMap(m => [...m.ops]));
  });

  it('every FAN-OUT module clears the minimum — a short roster makes parity vacuous', () => {
    // GAP-42 / AC-1.2: a one- or two-element roster is structurally identical to a
    // single-arm conditional, and every "every op has a file" assertion over it
    // passes for any implementation that returns something. The floor applies per
    // module and to fan-out modules only — a `named` module's correctness comes from
    // splitVariantSections' bidirectional check, not from a count, and a floor there
    // would forbid the first cross-cutting document rather than prove anything.
    const fanout = VARIANT_MODULES.filter(m => m.kind === 'fanout');
    expect(fanout.length, 'there must be at least one fan-out module').toBeGreaterThan(0);
    for (const mod of fanout) {
      expect(mod.ops.length, `${mod.source} is below the fan-out floor`)
        .toBeGreaterThanOrEqual(MIN_VARIANT_PAIRS);
    }
    expect(MIN_VARIANT_PAIRS).toBeGreaterThanOrEqual(8);
  });

  it('every module under tracker/ is a fan-out module — `named` is not a floor escape', () => {
    // The only way to dodge the floor is to declare `kind: 'named'`. This pins that
    // a provider mechanics module can never do so.
    for (const mod of VARIANT_MODULES.filter(m => m.subdir.startsWith('tracker/'))) {
      expect(mod.kind, `${mod.source} must be a fan-out module`).toBe('fanout');
    }
  });

  it('emits a POSIX-spelled relative path per pair — nested or flat per its module', () => {
    // Keyed off the RESOLVED registry: expandVariants expands what the gates
    // leave standing, so a lookup built from the declared list alone reports the
    // gated module as "unregistered" the moment its gate opens.
    const bySource = new Map(resolveVariantModules().map(m => [m.source as string, m]));
    const pairs = valueOf(expandVariants());
    for (const pair of pairs) {
      const mod = bySource.get(pair.module);
      expect(mod, `pair names an unregistered module: ${pair.module}`).toBeDefined();
      const expected = mod!.subdir === '' ? `${pair.op}.md` : `${mod!.subdir}/${pair.op}.md`;
      expect(pair.relPath).toBe(expected);
    }
    expect(
      pairs.some(p => p.relPath.includes('/')),
      'no nested path emitted — the subdir arm is untested',
    ).toBe(true);
    expect(
      pairs.some(p => !p.relPath.includes('/')),
      'no flat path emitted — the empty-subdir arm is untested',
    ).toBe(true);
  });

  it('every emitted relative path is unique', () => {
    const pairs = valueOf(expandVariants());
    expect(new Set(pairs.map(p => p.relPath)).size).toBe(pairs.length);
  });

  it('known-bad probe: a one-element pair list is REFUSED, not returned', () => {
    // The probe that matters most. Without it the function would happily return
    // a list whose parity assertions can never fail.
    const oneOp: VariantModule[] = [
      { source: 'src/assets/mds/tracker/_solo.mds', subdir: 'tracker/solo', kind: 'fanout', ops: ['setup-task'] },
    ];
    const err = errorOf(expandVariants(oneOp));
    expect(err.kind).toBe('too-few-pairs');
    if (err.kind !== 'too-few-pairs') throw new Error('unexpected kind');
    expect(err.count).toBe(1);
    expect(err.minimum).toBe(MIN_VARIANT_PAIRS);
  });

  it('known-bad probe: an empty registry and an op-less module are both refused', () => {
    expect(errorOf(expandVariants([])).kind).toBe('no-modules');
    expect(
      errorOf(expandVariants([{ source: 'a.mds', subdir: 'tracker/x', kind: 'fanout', ops: [] }])).kind,
    ).toBe('empty-module');
  });

  it('known-bad probe: a traversal in an op name or a subdir cannot reach the destination', () => {
    const base = { source: 'a.mds', subdir: 'tracker/github', kind: 'fanout' as const };
    const hostileOps = [...TRACKER_GITHUB_OPS.slice(0, 9), '../../../etc/passwd'];
    const opErr = errorOf(expandVariants([{ ...base, ops: hostileOps }]));
    expect(opErr.kind).toBe('invalid-op-name');

    const dirErr = errorOf(
      expandVariants([{ source: 'a.mds', subdir: 'tracker/../../..', kind: 'fanout', ops: TRACKER_GITHUB_OPS }]),
    );
    expect(dirErr.kind).toBe('invalid-subdir-segment');
  });

  it('known-bad probe: two modules claiming one output file are refused', () => {
    const clashing: VariantModule[] = [
      { source: 'a.mds', subdir: 'tracker/github', kind: 'fanout', ops: TRACKER_GITHUB_OPS },
      { source: 'b.mds', subdir: 'tracker/github', kind: 'fanout', ops: TRACKER_GITHUB_OPS },
    ];
    const err = errorOf(expandVariants(clashing));
    expect(err.kind).toBe('duplicate-output');
    if (err.kind !== 'duplicate-output') throw new Error('unexpected kind');
    expect(err.modules).toEqual(['a.mds', 'b.mds']);
  });

  it('is pure — the shipped registry is not mutated by expansion', () => {
    const before = JSON.stringify(VARIANT_MODULES);
    expandVariants();
    expandVariants();
    expect(JSON.stringify(VARIANT_MODULES)).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// 5. splitVariantSections — which slice of a module's body belongs to which op
// ---------------------------------------------------------------------------

describe('splitVariantSections', () => {
  /** A minimal module body carrying one marked section per named op. */
  function body(ops: readonly string[], bodyFor: (op: string) => string = op => `mechanics for ${op}`): string {
    return ['module prose, emitted nowhere', ...ops.map(op => `<!-- op: ${op} -->\n${bodyFor(op)}`)].join('\n');
  }

  /**
   * The caller's records, as the splitter takes them: one per operation. The
   * build passes its planned destinations this way, which is what lets each
   * destination come back with its content already attached.
   */
  function entries(ops: readonly string[]): ReadonlyArray<{ readonly op: string }> {
    return ops.map(op => ({ op }));
  }

  it('returns one document per entry, in caller order, and drops the module-level prose', () => {
    // The caller's own records come back carrying their section — the
    // post-condition the old keyed return could only state in a comment.
    const planned = TRACKER_GITHUB_OPS.map(op => ({ op, dest: `tracker/github/${op}.md` }));
    const sections = valueOf(splitVariantSections(body(TRACKER_GITHUB_OPS), planned));
    expect(sections.map(section => section.op)).toEqual([...TRACKER_GITHUB_OPS]);
    for (const { op, dest, content } of sections) {
      expect(dest, 'each entry keeps the fields its caller passed in').toBe(`tracker/github/${op}.md`);
      expect(content).toBe(`mechanics for ${op}\n`);
      expect(content, 'module-level prose must not be duplicated into every file').not.toContain('emitted nowhere');
      expect(content, 'the marker line is consumed, never shipped').not.toContain('<!-- op:');
    }
  });

  it('known-bad probe: a section for an unregistered op is refused (forward direction)', () => {
    const withStray = `${body(TRACKER_GITHUB_OPS)}\n<!-- op: stray-op -->\nbody`;
    const err = errorOf(splitVariantSections(withStray, entries(TRACKER_GITHUB_OPS)));
    expect(err.kind).toBe('unknown-section');
  });

  it('known-bad probe: a registered op with no section is refused (reverse direction)', () => {
    const short = body(TRACKER_GITHUB_OPS.slice(0, 9));
    const err = errorOf(splitVariantSections(short, entries(TRACKER_GITHUB_OPS)));
    expect(err.kind).toBe('missing-section');
    if (err.kind !== 'missing-section') throw new Error('unexpected kind');
    expect(err.ops).toEqual(['ensure-pr-ready']);
  });

  it('known-bad probe: a marked section with an empty body is refused (GAP-44)', () => {
    // The arm neither direction above can see: omission is caught by parity,
    // emptiness compiles cleanly and emits a zero-byte reference.
    const withEmpty = body(TRACKER_GITHUB_OPS, op => (op === 'manage-debt' ? '   \n' : `mechanics for ${op}`));
    const err = errorOf(splitVariantSections(withEmpty, entries(TRACKER_GITHUB_OPS)));
    expect(err.kind).toBe('empty-section');
    if (err.kind !== 'empty-section') throw new Error('unexpected kind');
    expect(err.op).toBe('manage-debt');
  });

  it('known-bad probe: a repeated marker and a body with no markers are both refused', () => {
    const duplicated = `${body(TRACKER_GITHUB_OPS)}\n<!-- op: setup-task -->\nsecond copy`;
    expect(errorOf(splitVariantSections(duplicated, entries(TRACKER_GITHUB_OPS))).kind).toBe('duplicate-section');
    expect(errorOf(splitVariantSections('no markers here', entries(TRACKER_GITHUB_OPS))).kind).toBe('no-sections');
  });

  it('an indented or trailing-text marker is not a marker', () => {
    // The delimiter is anchored so prose that merely mentions it cannot split a
    // module — the same anchoring rule the Phase-2 construct guard follows.
    const sneaky = body(TRACKER_GITHUB_OPS).replace(
      '<!-- op: manage-debt -->',
      '  <!-- op: manage-debt --> see below',
    );
    const err = errorOf(splitVariantSections(sneaky, entries(TRACKER_GITHUB_OPS)));
    expect(err.kind).toBe('missing-section');
  });
});

// ---------------------------------------------------------------------------
// 6. The shipped module registry matches what the build writes
// ---------------------------------------------------------------------------

describe('VARIANT_MODULES (shipped registry)', () => {
  it('names a real source path and a destination under the skill-refs directory', () => {
    expect(VARIANT_MODULES.length, 'registry must be non-empty (PF-018)').toBeGreaterThan(0);
    for (const mod of VARIANT_MODULES) {
      expect(mod.source.endsWith('.mds'), `${mod.source} must be an .mds source`).toBe(true);
      expect(mod.source.startsWith('src/assets/mds/')).toBe(true);
      expect(valueOf(resolveOutputDir(ROOT, SKILL_REFS_OUTPUT_DIR)).variant).toBe('skill-refs');
    }
  });

  it('carries exactly the provider directories whose modules exist', () => {
    // ADR-003 clause (iii): a registry entry with no module on disk would be an
    // artifact with no reachable consumer, and the converse — a module on disk with
    // no row — is a file the build refuses. Asserted as a set equality over the
    // provider subdirectories, both directions, rather than as a count: a provider
    // renamed and another added in one commit stays green against a count.
    //
    // Scoped to the provider subdirectories; the cross-cutting module is
    // provider-independent and lands flat.
    const providerSubdirs = VARIANT_MODULES
      .map(m => m.subdir as string)
      .filter(subdir => subdir.startsWith('tracker/'));
    expect(providerSubdirs).toEqual(['tracker/github', 'tracker/jira', 'tracker/linear']);
    for (const subdir of providerSubdirs) {
      const mod = VARIANT_MODULES.find(m => m.subdir === subdir)!;
      expect(
        existsSync(path.join(ROOT, mod.source)),
        `${mod.source} is registered for ${subdir} but is not on disk`,
      ).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 7. The tool-call contract module's generation gate (P3a-S12, hazard H7, C5)
// ---------------------------------------------------------------------------
//
// `src/assets/mds/tracker/_mcp.mds` is AUTHORED in Phase 3a and GENERATED only
// once a provider whose mechanics need it is registered. The two are separate
// events on purpose:
//
//   - Authoring it in 3a is required: its first runtime consumer is a Jira per-op
//     mechanics file that lands in 3b, and prefix-shippability clause (iii) is
//     read PER PHASE (decision D-D), so a contract with no consumer until later
//     in the same phase is fine.
//   - Generating it in 3a is NOT: Phase 2's own AC-2.7 guard asserts the file's
//     absence after a GitHub-only build, and every GitHub user would otherwise be
//     billed for a reference nothing they can reach ever loads (GAP-02).
//
// So the gate has to be DERIVED, not declared: a boolean on the module would be a
// flag someone flips, while "is a provider that needs it registered?" is a fact
// about the registry that 3b makes true by adding its own module and nothing else.
// A registry-derived gate also means the arm is provable NOW, against an injected
// registry, rather than discovered when 3b turns it on.

describe('the tool-call contract module is gated on a provider that needs it', () => {
  /** A synthetic provider module shaped exactly like the one 3b will register. */
  const SYNTHETIC_MCP_PROVIDER: VariantModule = {
    source: 'src/assets/mds/tracker/_synthetic.mds',
    subdir: MCP_BACKED_PROVIDER_SUBDIRS[0],
    kind: 'fanout',
    ops: TRACKER_GITHUB_OPS,
  };

  /** The shipped registry with every tool-call provider removed — the shut arm. */
  const CLI_ONLY_REGISTRY: readonly VariantModule[] = VARIANT_MODULES.filter(
    mod => !(MCP_BACKED_PROVIDER_SUBDIRS as readonly string[]).includes(mod.subdir),
  );

  it('the gate is OPEN for the shipped registry — a provider that needs it is registered', () => {
    expect(
      mcpContractIsGenerated(VARIANT_MODULES),
      'a registered provider reaches its tracker through a tool call and its mechanics NAME the ' +
      'contract, so the contract must be generated or ten references point at a file the install ' +
      'does not carry',
    ).toBe(true);
  });

  it('the gate is SHUT for a registry with no such provider — the arm that keeps it a gate', () => {
    // Both arms are asserted against INJECTED registries rather than against a
    // phase: the shut arm is what stops the gate becoming a constant `true`, and
    // without it a GitHub-only install would silently start carrying a reference
    // nothing it can reach ever loads (GAP-02, AC-2.7 re-scoped).
    expect(
      CLI_ONLY_REGISTRY.length,
      'the CLI-only probe registry must still hold a provider, or it proves nothing',
    ).toBeGreaterThan(0);
    expect(
      CLI_ONLY_REGISTRY.length,
      'and it must actually differ from the shipped registry',
    ).toBeLessThan(VARIANT_MODULES.length);
    expect(mcpContractIsGenerated(CLI_ONLY_REGISTRY)).toBe(false);
    expect(
      mcpContractIsGenerated([...CLI_ONLY_REGISTRY, SYNTHETIC_MCP_PROVIDER]),
      'this is the whole mechanism: registering the provider module starts the contract being ' +
      'generated, with no second edit anywhere',
    ).toBe(true);
  });

  it('every subdir in the gate list is a tracker provider directory, and github is NOT one', () => {
    // A gate keyed on "any tracker module exists" would already be open, since
    // _github.mds is registered. Naming the subdirs that NEED the contract is what
    // keeps it closed today and makes it open for the right reason later.
    expect(MCP_BACKED_PROVIDER_SUBDIRS.length, 'the gate list must be non-empty').toBeGreaterThan(0);
    for (const subdir of MCP_BACKED_PROVIDER_SUBDIRS) {
      expect(subdir, `"${subdir}" must be a tracker provider subdir`).toMatch(/^tracker\/[a-z]+$/);
    }
    expect(
      MCP_BACKED_PROVIDER_SUBDIRS as readonly string[],
      'github reaches its tracker through a CLI, so it must never open this gate',
    ).not.toContain('tracker/github');
  });

  it('resolveVariantModules appends the contract module only when the gate is open', () => {
    expect(
      resolveVariantModules(CLI_ONLY_REGISTRY),
      'a shut gate appends nothing at all',
    ).toEqual([...CLI_ONLY_REGISTRY]);
    const opened = resolveVariantModules([...CLI_ONLY_REGISTRY, SYNTHETIC_MCP_PROVIDER]);
    expect(opened).toContain(MCP_CONTRACT_MODULE);
    expect(
      opened.length,
      'exactly one module is appended — a duplicated append would make two hosts claim one file',
    ).toBe(CLI_ONLY_REGISTRY.length + 2);
    // And on the shipped registry, which already opens the gate: appended once.
    expect(
      resolveVariantModules(VARIANT_MODULES).filter(m => m.source === MCP_CONTRACT_MODULE.source),
    ).toHaveLength(1);
  });

  it('the appended module is idempotent: resolving twice appends once', () => {
    const once = resolveVariantModules([...VARIANT_MODULES, SYNTHETIC_MCP_PROVIDER]);
    const twice = resolveVariantModules(once);
    expect(
      twice.filter(m => m.source === MCP_CONTRACT_MODULE.source),
      'two rows for one source is expandVariants\' duplicate-output refusal, at build time',
    ).toHaveLength(1);
  });

  it('the manifest carries the contract file exactly while the gate is open', () => {
    expect(
      generatedReferenceManifest(),
      'the contract lands at the tracker/ ROOT, beside the provider directories rather than inside ' +
      'one: it is provider-independent, and a copy per provider is the duplication it removes',
    ).toContain('tracker/_mcp.md');

    const shut = expandVariants(resolveVariantModules(CLI_ONLY_REGISTRY));
    expect(shut.ok, `expansion must succeed: ${JSON.stringify(shut)}`).toBe(true);
    expect(
      shut.ok && shut.value.map(p => p.relPath),
      'and a registry with no tool-call provider must NOT name it — the installer converges to ' +
      'this list, so a name here is a file installed for everyone',
    ).not.toContain('tracker/_mcp.md');
  });

  it('★ the emitted filename is provable NOW, not discovered in 3b', () => {
    // The landmine this arm exists to defuse: `_mcp` fails validateOutputName's
    // leading-character rule, so a registry row alone would have expanded fine
    // today (the row is absent) and refused with `invalid-op-name` the moment 3b
    // opened the gate — a build break planted one subtask ahead.
    expect(validateOutputName('_mcp').ok, 'the general name rule still refuses a leading underscore')
      .toBe(false);
    const expansion = expandVariants([MCP_CONTRACT_MODULE]);
    expect(
      expansion.ok,
      `the contract module must expand: ${JSON.stringify(expansion.ok ? null : expansion.error)}`,
    ).toBe(true);
  });
});

describe('validateContractOutputName — the narrow underscore allowance', () => {
  it('accepts exactly one leading underscore over an otherwise valid name', () => {
    expect(validateContractOutputName('_mcp')).toEqual({ ok: true, value: '_mcp' });
    expect(validateContractOutputName('_resolution')).toEqual({ ok: true, value: '_resolution' });
  });

  it('requires the underscore — a bare name is refused by the CONTRACT rule', () => {
    // The two rules are not one rule with a relaxed charset: a contract document
    // must be distinguishable at a glance from the provider DIRECTORIES beside it
    // (`tracker/github/`, and later `tracker/jira/`), or `tracker/mcp.md` reads as
    // a fourth provider. So the prefix is mandatory here and forbidden there.
    expect(validateContractOutputName('mcp').ok).toBe(false);
  });

  it('inherits every other refusal from validateOutputName', () => {
    const REFUSED: ReadonlyArray<readonly [string, OutputNameError['kind']]> = [
      ['_', 'empty'],
      ['_..', 'dot-segment'],
      ['_a/b', 'path-separator'],
      ['_A', 'invalid-charset'],
      ['__double', 'invalid-charset'],
      ['_' + 'a'.repeat(200), 'invalid-charset'],
    ];
    expect(REFUSED.length, 'the refusal corpus must be non-empty (PF-018)').toBeGreaterThan(0);
    for (const [name, kind] of REFUSED) {
      const result = validateContractOutputName(name);
      expect(result.ok, `"${name}" must be refused`).toBe(false);
      expect(!result.ok && result.error.kind, `"${name}" must be refused as ${kind}`).toBe(kind);
      // `empty` is the one variant of OutputNameError that carries no `name` —
      // there is nothing to name. Every other refusal must report the value AS
      // WRITTEN, not the underscore-stripped remainder a reader never typed.
      if (kind !== 'empty') {
        expect(
          !result.ok && (result.error as { name: string }).name,
          'the refusal must name the value AS WRITTEN, not the underscore-stripped remainder',
        ).toBe(name);
      }
    }
  });

  it('a traversal cannot be smuggled in behind the allowance', () => {
    for (const hostile of ['_../etc/passwd', '_./x', '_a\\b']) {
      expect(validateContractOutputName(hostile).ok, `"${hostile}" must be refused`).toBe(false);
    }
  });
});
