/**
 * Unit tests for src/core/mds-variants.ts
 *
 * The module is the pure validation core behind the MDS generator-host
 * convention: it decides whether a host's emitted filename is safe and whether
 * its declared `output-dir:` is one of the two directories the build is allowed
 * to write into. scripts/build-mds.ts is the imperative shell around it (it owns
 * every process.exit and every filesystem call).
 *
 * Scenario coverage:
 *   1. validateOutputName — accepts real host basenames, rejects traversal,
 *      separators, charset violations, over-length names.
 *   2. resolveOutputDir (containment) — resolved-path allowlist, escape guard,
 *      canonical-declaration requirement.
 *   3. Result error-union completeness — every declared error kind is reachable
 *      from a test input, and no input produces a kind outside the union.
 *
 * Hostile inputs pinned here are the same ones scripts/build-mds.ts must reject
 * at build time (see tests/build-mds-generator-hosts.test.ts for the subprocess
 * proof that they exit 1).
 */

import { describe, it, expect } from 'vitest';
import * as path from 'path';

import {
  validateOutputName,
  resolveOutputDir,
  type OutputNameError,
  type OutputDirError,
  type HostVariant,
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

  it('carries the full allowlist on rejections so the caller can render the message', () => {
    const err = errorOf(resolveOutputDir(ROOT, 'dist/wrong-dir'));
    if (err.kind === 'escapes-root') throw new Error('unexpected kind');
    expect([...err.allowed]).toEqual(['dist/commands', 'dist/agents']);
    // The build's message renders the allowlist into the pre-existing template:
    //   output-dir '<declared>' is not the expected '<expected>' — typo?
    expect(err.allowed.join("' or '")).toBe("dist/commands' or 'dist/agents");
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

  it('tags dist/commands as the commands variant and dist/agents as the agents variant', () => {
    const variants = collectVariants(['dist/commands', 'dist/agents']);
    expect(variants.get('dist/commands')).toBe('commands');
    expect(variants.get('dist/agents')).toBe('agents');
  });

  it('every allowlisted directory carries a distinct variant (no two share a strip)', () => {
    const variants = collectVariants(['dist/commands', 'dist/agents']);
    expect(variants.size).toBe(2);
    expect(new Set(variants.values()).size).toBe(2);
  });

  it('known-bad probe: a phantom variant is not what the allowlist produces', () => {
    // If resolveOutputDir returned a bare string (or a constant variant), the
    // assertions above would hold for the wrong reason. Seeding the expected
    // value with a variant no allowlist entry declares must fail.
    const variants = collectVariants(['dist/commands', 'dist/agents']);
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
// corpus that stopped reaching one (PF-018, ADR-024).

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
    const good = validateOutputName('git');
    expect(good.ok && 'error' in good).toBe(false);
    const bad = resolveOutputDir(ROOT, 'dist/wrong-dir');
    expect(!bad.ok && 'value' in bad).toBe(false);
  });
});
