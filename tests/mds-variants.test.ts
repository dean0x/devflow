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

  it('rejects a parent-directory traversal name (name-template: ../x)', () => {
    // The exact hostile value the build must refuse. Traversal is reported as
    // its own kind so the build message can say why, not just "invalid".
    expect(errorOf(validateOutputName('../x')).kind).toBe('dot-segment');
  });

  it('rejects a bare `..`', () => {
    expect(errorOf(validateOutputName('..')).kind).toBe('dot-segment');
  });

  it('rejects a nested path name (name-template: a/b)', () => {
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
    const err = errorOf(validateOutputName('a/b'));
    expect(err.kind === 'empty' ? undefined : err.name).toBe('a/b');
  });
});

// ---------------------------------------------------------------------------
// 2. resolveOutputDir — containment + resolved-path allowlist
// ---------------------------------------------------------------------------

describe('resolveOutputDir (containment)', () => {
  it('accepts dist/commands and returns the resolved absolute directory', () => {
    expect(valueOf(resolveOutputDir(ROOT, 'dist/commands')))
      .toBe(path.join(ROOT, 'dist', 'commands'));
  });

  it('accepts dist/agents and returns the resolved absolute directory', () => {
    expect(valueOf(resolveOutputDir(ROOT, 'dist/agents')))
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

  it('resolves against the supplied root, not the process cwd (pure, injectable)', () => {
    const fakeRoot = path.join(path.sep, 'nonexistent-root-for-purity-check');
    expect(valueOf(resolveOutputDir(fakeRoot, 'dist/agents')))
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
// 3. Result error-union completeness
// ---------------------------------------------------------------------------
//
// A union member that no input can produce is dead code (ADR-003 clause iii).
// These two tests are the non-vacuity proof: each declared kind is reached by a
// concrete input, and no input reaches a kind outside the declared set.

describe('Result error-union completeness', () => {
  const NAME_KINDS: ReadonlyArray<OutputNameError['kind']> = [
    'empty', 'dot-segment', 'path-separator', 'invalid-charset',
  ];
  const DIR_KINDS: ReadonlyArray<OutputDirError['kind']> = [
    'escapes-root', 'non-canonical', 'not-allowlisted',
  ];

  /** Named collector: every OutputNameError kind produced by the hostile corpus. */
  function collectNameKinds(): Set<string> {
    const corpus = ['', '..', '../x', 'a/b', 'a\\b', 'Git', 'a b', '-lead', 'a'.repeat(65)];
    const kinds = new Set<string>();
    for (const input of corpus) {
      const result = validateOutputName(input);
      if (!result.ok) kinds.add(result.error.kind);
    }
    expect(corpus.length, 'name corpus must be non-empty (PF-018)').toBeGreaterThan(0);
    return kinds;
  }

  /** Named collector: every OutputDirError kind produced by the hostile corpus. */
  function collectDirKinds(): Set<string> {
    const corpus = [
      'dist/wrong-dir', 'dist', 'dist/skills',
      'dist/../..', '/tmp/elsewhere',
      'dist/commands/', './dist/agents', 'dist/skills/../commands',
    ];
    const kinds = new Set<string>();
    for (const input of corpus) {
      const result = resolveOutputDir(ROOT, input);
      if (!result.ok) kinds.add(result.error.kind);
    }
    expect(corpus.length, 'dir corpus must be non-empty (PF-018)').toBeGreaterThan(0);
    return kinds;
  }

  it('every OutputNameError kind is reachable from a real input', () => {
    expect([...collectNameKinds()].sort()).toEqual([...NAME_KINDS].sort());
  });

  it('every OutputDirError kind is reachable from a real input', () => {
    expect([...collectDirKinds()].sort()).toEqual([...DIR_KINDS].sort());
  });

  it('no input produces a kind outside the declared unions (known-bad probe)', () => {
    // Known-bad sample: an undeclared kind added to the expected set must fail
    // the completeness assertion above, proving it is not vacuous.
    const withPhantom = new Set([...collectNameKinds(), 'phantom-kind']);
    expect([...withPhantom].sort()).not.toEqual([...NAME_KINDS].sort());

    for (const kind of collectNameKinds()) {
      expect(NAME_KINDS as readonly string[]).toContain(kind);
    }
    for (const kind of collectDirKinds()) {
      expect(DIR_KINDS as readonly string[]).toContain(kind);
    }
  });

  it('succeeding calls never carry an error and failing calls never carry a value', () => {
    const good = validateOutputName('git');
    expect(good.ok && 'error' in good).toBe(false);
    const bad = resolveOutputDir(ROOT, 'dist/wrong-dir');
    expect(!bad.ok && 'value' in bad).toBe(false);
  });
});
