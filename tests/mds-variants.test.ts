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
 *   2c. The variant trees (dist/curation-off, dist/compliance-off,
 *      dist/curation-compliance-off) are never an output dir: the allowlist stays the
 *      four shipped directories and no host declares another.
 *   3. Result error-union completeness — every declared error kind is reachable
 *      from a test input, and no input produces a kind outside the union.
 *   4. expandVariants — the flat (module, op) pair list, its minimum length, and
 *      the refusals that keep a hostile op name or subdir out of the destination.
 *   5. splitVariantSections — bidirectional op-set parity plus the empty-section
 *      arm neither direction of that parity can see.
 *   6. The shipped registry — every provider directory it names has a module on
 *      disk and every module on disk has a row, each pointing at a real source
 *      path under src/assets/mds/.
 *   7. Workflow skill folders (#675 PR A; TP-63) — the `workflow-skill` host variant,
 *      the third name rule (the literal SKILL), the folder registry and its
 *      refusals, the files each variant key holds, and the build id (workflowBuildId,
 *      stampBuildId, readBuildId, checkFolderBuildIds). The build side, on a fixture,
 *      is tests/build-mds-workflow-folder.test.ts.
 *
 * Hostile inputs pinned here are the same ones scripts/build-mds.ts must reject
 * at build time (see tests/build-mds-generator-hosts.test.ts for the subprocess
 * proof that they exit 1).
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
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
  installedReferenceManifest,
  validateContractOutputName,
  GATED_REFERENCE_MODULES,
  GATED_REFERENCE_MODULE_SOURCES,
  POSTING_OPS,
  PR_HOST_OPS,
  TRACKER_OPS,
  COMPLIANCE_OFF_OMITTED_DOCS,
  COMPLIANCE_OFF_SKILL_REFS_OUTPUT_DIR,
  checkPostingOps,
  complianceOffOmittedRelPaths,
  describePostingOpsError,
  splitSectionArms,
  BUILD_ID_LENGTH,
  WORKFLOW_FOLDERS,
  WORKFLOW_FOLDERS_OUTPUT_DIR,
  WORKFLOW_SKILL_ENTRY_NAME,
  WORKFLOW_SKILL_FILE,
  checkFolderBuildIds,
  checkWorkflowFolders,
  describeBuildIdCheckError,
  describeBuildStampError,
  describeWorkflowFolderError,
  findWorkflowFolderHost,
  isStampedWorkflowFile,
  parseWorkflowFolders,
  readBuildId,
  stampBuildId,
  unstampBuildId,
  validateSkillOutputName,
  verifyFolderBuildId,
  workflowBuildId,
  workflowFolderFiles,
  workflowFolderHosts,
  workflowFolderKey,
  workflowFolderRelPath,
  workflowFoldersRootRelPath,
  type OutputNameError,
  type OutputDirError,
  type HostVariant,
  type VariantModule,
  type WorkflowFolder,
} from '../src/core/mds-variants.js';
import { compiledWorkflowFoldersDir, workflowFoldersSourceDir } from '../src/core/assets.js';
import { ALL_MDS_HOSTS, POSTING_OPERATIONS } from './fixtures/mds-manifest.js';
import { walkFiles } from './helpers.js';
import {
  BOTH_OFF_OUTPUT_DIR,
  COMPLIANCE_OFF_OUTPUT_DIR,
  CURATION_OFF_OUTPUT_DIR,
  LEGACY_OFF_OUTPUT_DIR,
  VARIANT_KEYS,
} from '../src/core/curation-variants.js';

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
// carrying the load.

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
    expect(nonEmpty.length, 'non-empty rejection corpus must not be empty').toBeGreaterThan(0);

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
    expect(err.allowed.length, 'allowlist must be non-empty').toBeGreaterThanOrEqual(3);
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
    expect(declarations.length, 'declaration corpus must be non-empty').toBeGreaterThan(0);
    return variants;
  }

  it('tags each allowlisted directory with the variant that selects its strip', () => {
    const variants = collectVariants(ALLOWED_OUTPUT_DIR_NAMES);
    expect(variants.get('dist/commands')).toBe('commands');
    expect(variants.get('dist/agents')).toBe('agents');
    expect(variants.get(SKILL_REFS_OUTPUT_DIR)).toBe('skill-refs');
    expect(variants.get(WORKFLOW_FOLDERS_OUTPUT_DIR)).toBe('workflow-skill');
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
// 2c. The variant trees are never an output dir (TP-7)
// ---------------------------------------------------------------------------
//
// The off variants of a prompt (dist/curation-off, dist/compliance-off,
// dist/curation-compliance-off) are written by the build next to the prompt they
// vary, never declared by a host. The allowlist stays the three shipped
// directories, so resolveOutputDir remains the one gate on where a host may write,
// and no source can name a variant tree as its destination.

describe('the variant trees are not output dirs (TP-7)', () => {
  const VARIANT_TREES = [
    CURATION_OFF_OUTPUT_DIR,
    COMPLIANCE_OFF_OUTPUT_DIR,
    BOTH_OFF_OUTPUT_DIR,
    LEGACY_OFF_OUTPUT_DIR,
  ] as const;

  /** Named collector: the `.mds` files under src/assets, with their text. */
  function collectMdsSources(): Array<{ name: string; content: string }> {
    const base = path.join(ROOT, 'src', 'assets');
    return walkFiles(base, f => f.endsWith('.mds')).map(f => ({
      name: path.relative(ROOT, f).split(path.sep).join('/'),
      content: readFileSync(f, 'utf-8'),
    }));
  }

  /** Named collector: every `output-dir:` a source declares, as the directory it names. */
  function collectDeclaredDirs(sources: ReadonlyArray<{ name: string; content: string }>): Array<{ name: string; dir: string }> {
    const found: Array<{ name: string; dir: string }> = [];
    for (const { name, content } of sources) {
      const match = /^output-dir:[ \t]*(\S.*?)[ \t]*$/m.exec(content);
      if (match) found.push({ name, dir: match[1] });
    }
    return found;
  }

  it('the allowlist is the four shipped directories, in order, and nothing else', () => {
    expect([...ALLOWED_OUTPUT_DIR_NAMES]).toEqual([
      'dist/commands',
      'dist/agents',
      'dist/skills/git/references',
      'dist/workflows',
    ]);
  });

  it('no variant tree, and no kind folder inside one, is on the allowlist', () => {
    for (const tree of VARIANT_TREES) {
      expect(ALLOWED_OUTPUT_DIR_NAMES, `${tree} must not be an allowlisted directory`).not.toContain(tree);
      for (const declared of [tree, `${tree}/commands`, `${tree}/agents`]) {
        expect(errorOf(resolveOutputDir(ROOT, declared)).kind, `${declared} must be refused`).toBe('not-allowlisted');
      }
    }
  });

  it('every output-dir a host declares is on the allowlist, and every allowlisted directory has a host', () => {
    const declared = collectDeclaredDirs(collectMdsSources());
    expect(declared.length, 'the scan found no host: it is not reading src/assets').toBeGreaterThan(0);
    const outside = declared.filter(d => !ALLOWED_OUTPUT_DIR_NAMES.includes(d.dir));
    expect(outside, 'a host declares an output-dir the allowlist does not name').toEqual([]);
    // The workflow root has a host only once a folder is registered: PR A ships the build
    // layer with an empty registry, so no shipped host declares it yet.
    const needsHost = ALLOWED_OUTPUT_DIR_NAMES.filter(
      dir => dir !== WORKFLOW_FOLDERS_OUTPUT_DIR || WORKFLOW_FOLDERS.length > 0,
    );
    expect(needsHost.length, 'every allowlisted directory but the workflow root needs a host').toBeGreaterThanOrEqual(3);
    for (const dir of needsHost) {
      expect(declared.some(d => d.dir === dir), `no host declares ${dir}`).toBe(true);
    }
    expect(
      declared.some(d => d.dir === WORKFLOW_FOLDERS_OUTPUT_DIR),
      'a host declares the workflow root while the registry is empty: the build would refuse it',
    ).toBe(WORKFLOW_FOLDERS.length > 0);
  });

  it('known-bad probe: a host that declares a variant tree is reported, a host that declares a shipped one is not', () => {
    const seeded = [
      { name: 'a.mds', content: '---\ndescription: a\noutput-dir: dist/compliance-off\n---\n' },
      { name: 'b.mds', content: '---\noutput-dir: dist/curation-compliance-off/commands\n---\n' },
      { name: 'c.mds', content: '---\noutput-dir: dist/commands\n---\n' },
      { name: 'd.mds', content: 'a partial with no output-dir\n' },
    ];
    const declared = collectDeclaredDirs(seeded);
    expect(declared.map(d => d.name)).toEqual(['a.mds', 'b.mds', 'c.mds']);
    expect(declared.filter(d => !ALLOWED_OUTPUT_DIR_NAMES.includes(d.dir)).map(d => d.name)).toEqual(['a.mds', 'b.mds']);
  });
});

// ---------------------------------------------------------------------------
// 3. Result error-union completeness
// ---------------------------------------------------------------------------
//
// A union member that no input can produce is dead code.
// The two assertions here are the non-vacuity proof — each declared kind is
// reached by a concrete input, and no input reaches a kind outside the declared
// set — and the two probes below prove those assertions can actually go red, in
// both of the directions that matter: a declared kind nothing reaches, and a
// corpus that stopped reaching one.

describe('Result error-union completeness', () => {
  const NAME_KINDS: ReadonlyArray<OutputNameError['kind']> = [
    'empty', 'dot-segment', 'path-separator', 'invalid-charset',
  ];
  const DIR_KINDS: ReadonlyArray<OutputDirError['kind']> = [
    'escapes-root', 'backslash-separator', 'non-canonical', 'not-allowlisted',
  ];

  /** Named collector: every OutputNameError kind the given corpus produces. */
  function collectNameKinds(corpus: readonly string[] = NAME_CORPUS): Set<string> {
    expect(corpus.length, 'name corpus must be non-empty').toBeGreaterThan(0);
    const kinds = new Set<string>();
    for (const input of corpus) {
      const result = validateOutputName(input);
      if (!result.ok) kinds.add(result.error.kind);
    }
    return kinds;
  }

  /** Named collector: every OutputDirError kind the given corpus produces. */
  function collectDirKinds(corpus: readonly string[] = DIR_CORPUS): Set<string> {
    expect(corpus.length, 'dir corpus must be non-empty').toBeGreaterThan(0);
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
    const short = body(TRACKER_GITHUB_OPS.slice(0, -1));
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
    expect(VARIANT_MODULES.length, 'registry must be non-empty').toBeGreaterThan(0);
    for (const mod of VARIANT_MODULES) {
      expect(mod.source.endsWith('.mds'), `${mod.source} must be an .mds source`).toBe(true);
      expect(mod.source.startsWith('src/assets/mds/')).toBe(true);
      expect(valueOf(resolveOutputDir(ROOT, SKILL_REFS_OUTPUT_DIR)).variant).toBe('skill-refs');
    }
  });

  it('carries exactly the provider directories whose modules exist', () => {
    // A registry entry with no module on disk would be an
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
      const mod = VARIANT_MODULES.find(m => m.subdir === subdir);
      if (mod === undefined) {
        throw new Error(
          `no VARIANT_MODULES row for ${subdir}, which the list above was derived from — a ` +
          `lookup that cannot fail has failed, so this arm has no subject`,
        );
      }
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
// `src/assets/mds/tracker/_mcp.mds` is AUTHORED unconditionally and GENERATED only
// while a provider whose mechanics need it is registered. The two are separate
// events on purpose: authoring costs nobody anything, while generating for a
// registry of CLI-only providers bills every one of their users for a reference
// nothing they can reach ever loads (GAP-02, AC-2.7 re-scoped).
//
// So the gate is DERIVED, not declared: a boolean on the module would be a flag
// someone flips out of step with the registry, while "is a provider that needs it
// registered?" is a fact about the registry that registering a provider module
// makes true, with no second edit anywhere.
//
// Being registry-derived is also what makes both arms provable from one place:
// each is asserted against an INJECTED registry — the shut arm over a registry
// with every tool-call provider removed, the open arm over one synthetic provider
// per gated sub-directory — so neither depends on which providers happen to ship.

describe('the tool-call contract module is gated on a provider that needs it', () => {
  /**
   * A synthetic provider module landing in `subdir`, shaped exactly like a
   * registered tool-call provider.
   *
   * Built PER gated sub-directory below rather than once for
   * MCP_BACKED_PROVIDER_SUBDIRS[0]: a probe that names ONE member of the set the
   * gate ranges over proves the gate opens for that member and says nothing about
   * the rest, so it stops discriminating the moment the set grows. The sibling
   * probe in tests/build-mds-generator-hosts.test.ts reads the gate's own subject
   * for the same reason.
   */
  const syntheticProviderIn = (subdir: string): VariantModule => ({
    source: `src/assets/mds/${subdir}/_synthetic.mds`,
    subdir,
    kind: 'fanout',
    ops: TRACKER_GITHUB_OPS,
  });

  /** One synthetic provider per gated sub-directory — the whole set, never a member of it. */
  const SYNTHETIC_MCP_PROVIDERS: readonly VariantModule[] =
    MCP_BACKED_PROVIDER_SUBDIRS.map(syntheticProviderIn);

  /** The shipped registry with every tool-call provider removed — the shut arm. */
  const CLI_ONLY_REGISTRY: readonly VariantModule[] = VARIANT_MODULES.filter(
    mod => !(MCP_BACKED_PROVIDER_SUBDIRS as readonly string[]).includes(mod.subdir),
  );

  it('the gate is OPEN for the shipped registry — a provider that needs it is registered', () => {
    expect(
      mcpContractIsGenerated(VARIANT_MODULES),
      'a registered provider reaches its tracker through a tool call and its mechanics NAME the ' +
      'contract, so the contract must be generated or those references point at a file the ' +
      'install does not carry',
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
      SYNTHETIC_MCP_PROVIDERS.length,
      'an empty probe set asserts nothing about the open arm',
    ).toBeGreaterThan(0);
    for (const provider of SYNTHETIC_MCP_PROVIDERS) {
      expect(
        mcpContractIsGenerated([...CLI_ONLY_REGISTRY, provider]),
        `this is the whole mechanism: registering a provider module in ${provider.subdir} starts ` +
        'the contract being generated, with no second edit anywhere — and it must hold for EVERY ' +
        'gated sub-directory, or the gate list carries an entry that opens nothing',
      ).toBe(true);
    }
    // Known-bad probe: the gate is keyed on the gate list, not on "some tracker
    // module exists". A provider outside the list must leave it shut, or the loop
    // above would pass against an implementation that answers true unconditionally.
    for (const subdir of ['tracker/github', 'tracker/unlisted']) {
      expect(
        mcpContractIsGenerated([...CLI_ONLY_REGISTRY, syntheticProviderIn(subdir)]),
        `"${subdir}" is not in the gate list, so it must not open the gate`,
      ).toBe(false);
    }
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

  it('the gate list covers every registered tool-call provider — a shrunk list is a silent hole', () => {
    // Anchored on the REGISTRY, because every other arm in this section ranges
    // over MCP_BACKED_PROVIDER_SUBDIRS and therefore stays green when a
    // sub-directory LEAVES the list while its provider module stays registered.
    // That drift costs nothing on the day it happens — the remaining entries hold
    // the gate open — and becomes a contract withheld from a provider whose
    // mechanics name it the next time the registry changes.
    //
    // Whether a provider's mechanics are tool calls or `gh` commands is not
    // derivable from the registry; it is the fact MCP_BACKED_PROVIDER_SUBDIRS
    // exists to record. So the CLI-backed ones are named here, and registering a
    // second one means naming it here in the same edit.
    const CLI_BACKED_PROVIDER_SUBDIRS: readonly string[] = ['tracker/github'];
    const registeredProviders = VARIANT_MODULES
      .map(mod => mod.subdir as string)
      .filter(subdir => subdir.startsWith('tracker/'))
      .filter(subdir => !CLI_BACKED_PROVIDER_SUBDIRS.includes(subdir));
    expect(
      registeredProviders.length,
      'the probe must see registered tool-call providers, or it asserts nothing',
    ).toBeGreaterThan(0);
    expect(
      [...registeredProviders].sort(),
      'every registered provider that is not CLI-backed must be in the gate list, or its mechanics ' +
      'name a contract the build is free to stop generating',
    ).toEqual([...MCP_BACKED_PROVIDER_SUBDIRS].sort());
  });

  it('the gated roster and the resolver read ONE table — there is no second place to remember', () => {
    // GATED_REFERENCE_MODULE_SOURCES is the source column of the same table
    // resolveVariantModules loops over. What makes that checkable rather than
    // asserted is the round trip: every roster entry must be a module the resolver
    // appends exactly when its own predicate is open, and none may be in the
    // unconditional registry — a roster entry no resolver appends is a module the
    // build defers forever, and an unconditional module on the roster is one it
    // reports as deferred while it ships.
    expect(
      GATED_REFERENCE_MODULES.length,
      'an empty gate table asserts nothing about the resolver',
    ).toBeGreaterThan(0);
    expect(
      GATED_REFERENCE_MODULE_SOURCES,
      'the roster is the table read out, not a second list beside it',
    ).toEqual(GATED_REFERENCE_MODULES.map(gated => gated.module.source));

    const unconditional = VARIANT_MODULES.map(mod => mod.source as string);
    const REGISTRIES: readonly (readonly VariantModule[])[] = [
      VARIANT_MODULES,
      CLI_ONLY_REGISTRY,
      [...CLI_ONLY_REGISTRY, ...SYNTHETIC_MCP_PROVIDERS],
    ];
    for (const gated of GATED_REFERENCE_MODULES) {
      expect(
        unconditional,
        `${gated.module.source} is gated, so the registry must not also carry it unconditionally`,
      ).not.toContain(gated.module.source);
      for (const registry of REGISTRIES) {
        expect(
          resolveVariantModules(registry).some(mod => mod.source === gated.module.source),
          `the resolver must append ${gated.module.source} exactly when its own gate is open`,
        ).toBe(gated.isGenerated(registry));
      }
    }
  });

  it('resolveVariantModules appends the contract module only when the gate is open', () => {
    expect(
      resolveVariantModules(CLI_ONLY_REGISTRY),
      'a shut gate appends nothing at all',
    ).toEqual([...CLI_ONLY_REGISTRY]);
    for (const provider of SYNTHETIC_MCP_PROVIDERS) {
      const opened = resolveVariantModules([...CLI_ONLY_REGISTRY, provider]);
      expect(opened, `a provider in ${provider.subdir} must open the gate`)
        .toContain(MCP_CONTRACT_MODULE);
      expect(
        opened.length,
        'exactly one module is appended — a duplicated append would make two hosts claim one file',
      ).toBe(CLI_ONLY_REGISTRY.length + 2);
    }
    // And on the shipped registry, which already opens the gate: appended once.
    expect(
      resolveVariantModules(VARIANT_MODULES).filter(m => m.source === MCP_CONTRACT_MODULE.source),
    ).toHaveLength(1);
  });

  it('the appended module is idempotent: resolving twice appends once', () => {
    const once = resolveVariantModules([...VARIANT_MODULES, ...SYNTHETIC_MCP_PROVIDERS]);
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

  it('★ the emitted filename is proven against the module, not against the gate state', () => {
    // The landmine this arm exists to defuse: `_mcp` fails validateOutputName's
    // leading-character rule, so a registry row alone expands fine while the gate
    // is shut and refuses with `invalid-op-name` the moment a registered provider
    // opens it — a build break that surfaces one registry edit away from its
    // cause. Asserted against the module directly, so the gate's state is not
    // what decides whether the name rule was ever exercised.
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
    expect(REFUSED.length, 'the refusal corpus must be non-empty').toBeGreaterThan(0);
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

// ---------------------------------------------------------------------------
// 7. Workflow skill folders (#675 PR A; TP-63)
// ---------------------------------------------------------------------------
//
// The build side of these (a fixture folder compiled end to end) is
// tests/build-mds-workflow-folder.test.ts; this section holds the pure core.

describe('the workflow-skill host variant (TP-63)', () => {
  it('dist/workflows is allowlisted and selects a variant of its own', () => {
    expect(ALLOWED_OUTPUT_DIR_NAMES).toContain(WORKFLOW_FOLDERS_OUTPUT_DIR);
    const resolved = valueOf(resolveOutputDir(ROOT, WORKFLOW_FOLDERS_OUTPUT_DIR));
    expect(resolved.variant).toBe('workflow-skill');
    expect(resolved.abs).toBe(path.join(ROOT, 'dist', 'workflows'));
  });

  it('only the root is a destination: a folder under it, a variant tree and a trailing slash are refused', () => {
    const REFUSED: ReadonlyArray<readonly [string, OutputDirError['kind']]> = [
      ['dist/workflows/implement', 'not-allowlisted'],
      ['dist/curation-off/workflows', 'not-allowlisted'],
      ['dist/compliance-off/workflows', 'not-allowlisted'],
      ['dist/curation-compliance-off/workflows', 'not-allowlisted'],
      ['dist/workflows/', 'non-canonical'],
    ];
    for (const [declared, kind] of REFUSED) {
      expect(errorOf(resolveOutputDir(ROOT, declared)).kind, declared).toBe(kind);
    }
  });

  it('OUTPUT_NAME_RE is unchanged: the ordinary rule still refuses the literal SKILL and any uppercase', () => {
    expect(errorOf(validateOutputName(WORKFLOW_SKILL_ENTRY_NAME))).toEqual({ kind: 'invalid-charset', name: 'SKILL' });
    expect(errorOf(validateOutputName('Skill')).kind).toBe('invalid-charset');
    expect(validateOutputName('implement')).toEqual({ ok: true, value: 'implement' });
    expect(errorOf(validateContractOutputName('_SKILL')).kind).toBe('invalid-charset');
  });
});

describe('validateSkillOutputName — the one literal (D-WORKFLOW-SKILL-NAME)', () => {
  it('accepts exactly SKILL', () => {
    expect(validateSkillOutputName('SKILL')).toEqual({ ok: true, value: 'SKILL' });
    expect(WORKFLOW_SKILL_FILE).toBe('SKILL.md');
  });

  it('refuses every other name, with the ordinary rule diagnosis where it has one and the name as written', () => {
    const REFUSED: ReadonlyArray<readonly [string, OutputNameError['kind']]> = [
      ['', 'empty'],
      ['..', 'dot-segment'],
      ['../SKILL', 'dot-segment'],
      ['a/SKILL', 'path-separator'],
      ['a\\SKILL', 'path-separator'],
      ['skill', 'invalid-charset'],
      ['Skill', 'invalid-charset'],
      ['SKILL.md', 'invalid-charset'],
      ['SKILL ', 'invalid-charset'],
      ['SKILLS', 'invalid-charset'],
      ['implement', 'invalid-charset'],
    ];
    expect(REFUSED.length, 'the refusal corpus must be non-empty').toBeGreaterThan(0);
    for (const [name, kind] of REFUSED) {
      const error = errorOf(validateSkillOutputName(name));
      expect(error.kind, `"${name}" must be refused as ${kind}`).toBe(kind);
      if (error.kind !== 'empty') expect(error.name, 'the refusal names the value as written').toBe(name);
    }
  });
});

describe('the workflow folder registry (D-WORKFLOW-FOLDER-BUILD)', () => {
  const FOLDER: WorkflowFolder = {
    name: 'flow',
    core: 'src/assets/commands/flow/SKILL.mds',
    references: [
      { source: 'src/assets/commands/flow/base-note.mds', file: 'base-note.md' },
      { source: 'src/assets/commands/flow/references/levels.mds', file: 'references/levels.md' },
      {
        source: 'src/assets/commands/flow/references/asks.mds',
        file: 'references/asks.md',
        omittedWhenComplianceOff: true,
      },
    ],
  };

  it('ships with an empty real set in PR A, and the shipped set is valid', () => {
    expect(WORKFLOW_FOLDERS).toEqual([]);
    expect(checkWorkflowFolders(WORKFLOW_FOLDERS).ok).toBe(true);
  });

  it('lists a folder as a host list: the core first, then the references in registry order', () => {
    expect(workflowFolderHosts(FOLDER).map(h => [h.role, h.file])).toEqual([
      ['core', 'SKILL.md'],
      ['reference', 'base-note.md'],
      ['reference', 'references/levels.md'],
      ['reference', 'references/asks.md'],
    ]);
    expect(workflowFolderHosts(FOLDER).map(h => h.omittedWhenComplianceOff)).toEqual([false, false, false, true]);
  });

  it('accepts a well-formed registry, and the empty registry', () => {
    expect(checkWorkflowFolders([FOLDER])).toEqual({ ok: true, value: [FOLDER] });
    expect(checkWorkflowFolders([])).toEqual({ ok: true, value: [] });
  });

  it('finds the folder and host a source is registered as, and nothing for another source', () => {
    const found = findWorkflowFolderHost([FOLDER], 'src/assets/commands/flow/references/levels.mds');
    expect(found?.folder.name).toBe('flow');
    expect(found?.host).toMatchObject({ role: 'reference', file: 'references/levels.md' });
    expect(findWorkflowFolderHost([FOLDER], 'src/assets/commands/flow/SKILL.mds')?.host.role).toBe('core');
    expect(findWorkflowFolderHost([FOLDER], 'src/assets/commands/other.mds')).toBeNull();
  });

  it('refuses a registry that could write outside its tree or two files to one place', () => {
    const REFUSED: ReadonlyArray<readonly [string, readonly WorkflowFolder[], string]> = [
      ['an uppercase folder name', [{ ...FOLDER, name: 'Flow' }], 'bad-folder-name'],
      ['an empty folder name', [{ ...FOLDER, name: '' }], 'bad-folder-name'],
      ['a nested folder name', [{ ...FOLDER, name: 'a/b' }], 'bad-folder-name'],
      ['a folder registered twice', [FOLDER, { ...FOLDER, core: 'src/x/SKILL.mds', references: [] }], 'duplicate-folder'],
      ['a core that is not an .mds file', [{ ...FOLDER, core: 'src/assets/commands/flow/SKILL.md' }], 'bad-source'],
      ['an absolute source', [{ ...FOLDER, core: '/etc/SKILL.mds' }], 'bad-source'],
      ['a source that leaves the repo', [{ ...FOLDER, core: '../SKILL.mds' }], 'bad-source'],
      ['a backslash source', [{ ...FOLDER, core: 'src\\SKILL.mds' }], 'bad-source'],
      ['a non-canonical source', [{ ...FOLDER, core: 'src/./SKILL.mds' }], 'bad-source'],
      [
        'a reference that lists the core source',
        [{ ...FOLDER, references: [{ source: FOLDER.core, file: 'x.md' }] }],
        'duplicate-source',
      ],
      [
        'one source in two folders',
        [FOLDER, { name: 'other', core: FOLDER.references[0].source, references: [] }],
        'duplicate-source',
      ],
      [
        'a reference named SKILL.md',
        [{ ...FOLDER, references: [{ source: 'src/a.mds', file: 'SKILL.md' }] }],
        'bad-file',
      ],
      ['a reference that is not .md', [{ ...FOLDER, references: [{ source: 'src/a.mds', file: 'a.txt' }] }], 'bad-file'],
      ['a reference that climbs', [{ ...FOLDER, references: [{ source: 'src/a.mds', file: '../a.md' }] }], 'bad-file'],
      [
        'a reference that climbs inside references/',
        [{ ...FOLDER, references: [{ source: 'src/a.mds', file: 'references/../a.md' }] }],
        'bad-file',
      ],
      ['a reference nested two deep', [{ ...FOLDER, references: [{ source: 'src/a.mds', file: 'a/b/c.md' }] }], 'bad-file'],
      [
        'a reference nested under references/',
        [{ ...FOLDER, references: [{ source: 'src/a.mds', file: 'references/a/b.md' }] }],
        'bad-file',
      ],
      ['an uppercase reference', [{ ...FOLDER, references: [{ source: 'src/a.mds', file: 'Upper.md' }] }], 'bad-file'],
      [
        'one file named twice',
        [{ ...FOLDER, references: [
          { source: 'src/a.mds', file: 'same.md' },
          { source: 'src/b.mds', file: 'same.md' },
        ] }],
        'duplicate-file',
      ],
    ];
    expect(REFUSED.length, 'the refusal corpus must be non-empty').toBeGreaterThan(0);
    for (const [what, folders, kind] of REFUSED) {
      expect(errorOf(checkWorkflowFolders(folders)).kind, what).toBe(kind);
    }
  });

  it('every refusal renders as a line that names what was refused', () => {
    const lines = [
      describeWorkflowFolderError({ kind: 'malformed', at: '$[0].name' }),
      describeWorkflowFolderError({ kind: 'bad-folder-name', folder: 'Flow', error: { kind: 'invalid-charset', name: 'Flow' } }),
      describeWorkflowFolderError({ kind: 'duplicate-folder', folder: 'flow' }),
      describeWorkflowFolderError({ kind: 'bad-source', folder: 'flow', source: 'x' }),
      describeWorkflowFolderError({ kind: 'duplicate-source', source: 'x.mds' }),
      describeWorkflowFolderError({ kind: 'bad-file', folder: 'flow', file: 'x.txt', error: { kind: 'invalid-charset', name: 'x.txt' } }),
      describeWorkflowFolderError({ kind: 'duplicate-file', folder: 'flow', file: 'x.md' }),
    ];
    expect(new Set(lines).size).toBe(lines.length);
    expect(lines[0]).toContain('$[0].name');
    expect(lines[4]).toContain('x.mds');
  });

  describe('parseWorkflowFolders — the registry as untrusted JSON', () => {
    it('round-trips a registry through JSON', () => {
      expect(parseWorkflowFolders(JSON.parse(JSON.stringify([FOLDER])))).toEqual({ ok: true, value: [FOLDER] });
    });

    it('names the path of the first malformed field', () => {
      const MALFORMED: ReadonlyArray<readonly [unknown, string]> = [
        [{}, '$'],
        ['flow', '$'],
        [[null], '$[0]'],
        [[{ core: 'a.mds', references: [] }], '$[0].name'],
        [[{ name: 'flow', references: [] }], '$[0].core'],
        [[{ name: 'flow', core: 'a.mds' }], '$[0].references'],
        [[{ name: 'flow', core: 'a.mds', references: ['x'] }], '$[0].references[0]'],
        [[{ name: 'flow', core: 'a.mds', references: [{ file: 'x.md' }] }], '$[0].references[0].source'],
        [[{ name: 'flow', core: 'a.mds', references: [{ source: 'x.mds' }] }], '$[0].references[0].file'],
        [
          [{ name: 'flow', core: 'a.mds', references: [{ source: 'x.mds', file: 'x.md', omittedWhenComplianceOff: 'yes' }] }],
          '$[0].references[0].omittedWhenComplianceOff',
        ],
      ];
      for (const [value, at] of MALFORMED) {
        expect(errorOf(parseWorkflowFolders(value)), JSON.stringify(value)).toEqual({ kind: 'malformed', at });
      }
    });

    it('runs the registry check after the shape check', () => {
      expect(errorOf(parseWorkflowFolders([{ name: 'Flow', core: 'a.mds', references: [] }])).kind).toBe('bad-folder-name');
    });
  });
});

describe('the files each variant key holds', () => {
  const FOLDER: WorkflowFolder = {
    name: 'flow',
    core: 'src/assets/commands/flow/SKILL.mds',
    references: [
      { source: 'src/assets/commands/flow/note.mds', file: 'note.md' },
      { source: 'src/assets/commands/flow/references/asks.mds', file: 'references/asks.md', omittedWhenComplianceOff: true },
    ],
  };

  it('keys follow the machine switches alone', () => {
    expect(workflowFolderKey({ curation: true, compliance: true })).toBe('on');
    expect(workflowFolderKey({ curation: false, compliance: true })).toBe('curation-off');
    expect(workflowFolderKey({ curation: true, compliance: false })).toBe('compliance-off');
    expect(workflowFolderKey({ curation: false, compliance: false })).toBe('both-off');
  });

  it('a file flagged for compliance off is held by the keys that keep compliance on, and by no other', () => {
    expect(workflowFolderFiles(FOLDER, 'on')).toEqual(['SKILL.md', 'note.md', 'references/asks.md']);
    expect(workflowFolderFiles(FOLDER, 'curation-off')).toEqual(['SKILL.md', 'note.md', 'references/asks.md']);
    expect(workflowFolderFiles(FOLDER, 'compliance-off')).toEqual(['SKILL.md', 'note.md']);
    expect(workflowFolderFiles(FOLDER, 'both-off')).toEqual(['SKILL.md', 'note.md']);
  });

  it('a folder with no flagged file holds the same files under every key', () => {
    const plain: WorkflowFolder = { ...FOLDER, references: FOLDER.references.map(r => ({ source: r.source, file: r.file })) };
    for (const key of VARIANT_KEYS) {
      expect(workflowFolderFiles(plain, key), key).toEqual(['SKILL.md', 'note.md', 'references/asks.md']);
    }
  });

  it('places the folders of the on key in dist/workflows and of every other key in its variant tree', () => {
    expect(workflowFoldersRootRelPath('on')).toBe('dist/workflows');
    expect(workflowFoldersRootRelPath('curation-off')).toBe(`${CURATION_OFF_OUTPUT_DIR}/workflows`);
    expect(workflowFoldersRootRelPath('compliance-off')).toBe(`${COMPLIANCE_OFF_OUTPUT_DIR}/workflows`);
    expect(workflowFoldersRootRelPath('both-off')).toBe(`${BOTH_OFF_OUTPUT_DIR}/workflows`);
    expect(workflowFolderRelPath('both-off', 'flow', 'references/asks.md'))
      .toBe('dist/curation-compliance-off/workflows/flow/references/asks.md');
    expect(new Set(VARIANT_KEYS.map(workflowFoldersRootRelPath)).size, 'two keys share a tree').toBe(VARIANT_KEYS.length);
  });

  it('only the files outside references/ carry the build id', () => {
    expect(isStampedWorkflowFile('SKILL.md')).toBe(true);
    expect(isStampedWorkflowFile('note.md')).toBe(true);
    expect(isStampedWorkflowFile('references/asks.md')).toBe(false);
    expect(isStampedWorkflowFile('references-note.md')).toBe(true);
  });
});

describe('the source root of the folders a machine reads', () => {
  const PKG = path.join(path.sep, 'pkg');

  it('is the one tree built for exactly the machine switches, never a list to fall through', () => {
    expect(workflowFoldersSourceDir({ curation: true, compliance: true }, PKG)).toBe(path.join(PKG, 'dist', 'workflows'));
    expect(workflowFoldersSourceDir({ curation: false, compliance: true }, PKG))
      .toBe(path.join(PKG, 'dist', 'curation-off', 'workflows'));
    expect(workflowFoldersSourceDir({ curation: true, compliance: false }, PKG))
      .toBe(path.join(PKG, 'dist', 'compliance-off', 'workflows'));
    expect(workflowFoldersSourceDir({ curation: false, compliance: false }, PKG))
      .toBe(path.join(PKG, 'dist', 'curation-compliance-off', 'workflows'));
  });

  it('takes its spelling from the build destination of each key', () => {
    for (const key of VARIANT_KEYS) {
      expect(compiledWorkflowFoldersDir(key, PKG), key).toBe(path.join(PKG, ...workflowFoldersRootRelPath(key).split('/')));
    }
  });
});

describe('the build id (D-BUILD-ID)', () => {
  const FILES = [
    { file: 'SKILL.md', body: '---\nname: x\n---\n# Flow\n\nText.\n' },
    { file: 'note.md', body: '# Note\n\nText.\n' },
    { file: 'references/asks.md', body: '# Asks\n\nText.\n' },
  ];

  describe('workflowBuildId', () => {
    it('is twelve hex digits', () => {
      expect(workflowBuildId(FILES)).toMatch(new RegExp(`^[0-9a-f]{${BUILD_ID_LENGTH}}$`));
      expect(BUILD_ID_LENGTH).toBe(12);
    });

    it('depends on the sources alone: the same files give the same id, whatever their order', () => {
      expect(workflowBuildId([...FILES].reverse())).toBe(workflowBuildId(FILES));
      expect(workflowBuildId(FILES.map(f => ({ ...f })))).toBe(workflowBuildId(FILES));
    });

    it('moves when any body, any name, or the set of files changes', () => {
      const base = workflowBuildId(FILES);
      const ids = new Set([
        base,
        workflowBuildId(FILES.map((f, i) => (i === 0 ? { ...f, body: `${f.body}x` } : f))),
        workflowBuildId(FILES.map((f, i) => (i === 2 ? { ...f, body: `${f.body}x` } : f))),
        workflowBuildId(FILES.map((f, i) => (i === 1 ? { ...f, file: 'other.md' } : f))),
        workflowBuildId(FILES.slice(0, 2)),
      ]);
      expect(ids.size, 'a change that left the id alone').toBe(5);
    });

    it('frames each file, so text moved across a file boundary is a different id', () => {
      const joined = workflowBuildId([{ file: 'a.md', body: '1\nb.md\n1\n2' }]);
      const split = workflowBuildId([{ file: 'a.md', body: '1' }, { file: 'b.md', body: '2' }]);
      expect(joined).not.toBe(split);
    });
  });

  describe('stampBuildId and readBuildId', () => {
    const ID = '0123456789ab';

    it('writes the id as a suffix of the first heading line and changes nothing else', () => {
      const stamped = valueOf(stampBuildId('# Flow\n\nText.\n\n## Step\n', ID));
      expect(stamped).toBe(`# Flow [build ${ID}]\n\nText.\n\n## Step\n`);
      expect(valueOf(readBuildId(stamped))).toBe(ID);
    });

    it('skips a leading frontmatter block, so a YAML comment is never the heading', () => {
      const body = '---\nname: x\n# a comment\ndescription: y\n---\n# Flow\n';
      expect(valueOf(stampBuildId(body, ID))).toBe(`---\nname: x\n# a comment\ndescription: y\n---\n# Flow [build ${ID}]\n`);
    });

    it('skips fenced code, so a shell comment is never the heading', () => {
      const body = 'Intro.\n\n```bash\n# not a heading\n```\n\n~~~\n# nor this\n~~~\n\n# Real\n';
      expect(valueOf(stampBuildId(body, ID))).toContain(`# Real [build ${ID}]`);
      expect(valueOf(stampBuildId(body, ID))).toContain('# not a heading\n');
      expect(valueOf(stampBuildId(body, ID))).not.toContain(`# not a heading [build`);
    });

    it('takes the first heading of any depth, and trims the whitespace the heading ended with', () => {
      expect(valueOf(stampBuildId('Intro.\n\n### Deep  \n# Later\n', ID))).toBe(`Intro.\n\n### Deep [build ${ID}]\n# Later\n`);
    });

    it('keeps a CRLF line ending after the stamp', () => {
      expect(valueOf(stampBuildId('# Flow\r\nText.\r\n', ID))).toBe(`# Flow [build ${ID}]\r\nText.\r\n`);
      expect(valueOf(readBuildId(`# Flow [build ${ID}]\r\nText.\r\n`))).toBe(ID);
    });

    it('does not take a hash, a seven-hash line or a heading inside an unclosed fence for a heading', () => {
      for (const body of ['#hash\n', '####### seven\n', '```\n# open\n', '---\n# only frontmatter\n---\n', '']) {
        expect(errorOf(stampBuildId(body, ID)), JSON.stringify(body)).toEqual({ kind: 'no-heading' });
      }
    });

    it('refuses a heading that already carries a stamp, so a stale id is never hidden behind a new one', () => {
      expect(errorOf(stampBuildId(`# Flow [build ${ID}]\n`, 'fedcba987654'))).toEqual({ kind: 'already-stamped', id: ID });
    });

    it('reads no id from an unstamped file or a file with no heading', () => {
      expect(errorOf(readBuildId('# Flow\n'))).toEqual({ kind: 'no-stamp' });
      expect(errorOf(readBuildId('Text only.\n'))).toEqual({ kind: 'no-heading' });
      expect(errorOf(readBuildId('# Flow [build 0123]\n'))).toEqual({ kind: 'no-stamp' });
      expect(errorOf(readBuildId('# Flow\n\nLater [build 0123456789ab]\n'))).toEqual({ kind: 'no-stamp' });
    });

    it('renders both refusals', () => {
      expect(describeBuildStampError({ kind: 'no-heading' })).toContain('no heading');
      expect(describeBuildStampError({ kind: 'already-stamped', id: ID })).toContain(ID);
    });
  });

  describe('checkFolderBuildIds', () => {
    const stampAll = (id: string, files = FILES): Array<{ file: string; body: string }> =>
      files.map(f => (isStampedWorkflowFile(f.file) ? { file: f.file, body: valueOf(stampBuildId(f.body, id)) } : f));

    it('returns the one id the stamped files share, and ignores the reference files', () => {
      expect(valueOf(checkFolderBuildIds(stampAll('0123456789ab')))).toBe('0123456789ab');
    });

    it('stops on a folder that mixes two builds, and lists every file with its id', () => {
      const files = stampAll('0123456789ab');
      files[1] = { file: 'note.md', body: valueOf(stampBuildId(FILES[1].body, 'fedcba987654')) };
      const refused = errorOf(checkFolderBuildIds(files));
      expect(refused).toEqual({
        kind: 'mixed-ids',
        ids: [{ file: 'SKILL.md', id: '0123456789ab' }, { file: 'note.md', id: 'fedcba987654' }],
      });
      expect(describeBuildIdCheckError(refused)).toBe(
        'the folder mixes build ids: SKILL.md 0123456789ab, note.md fedcba987654',
      );
    });

    it('stops on a stamped file with no stamp, by name, and on a folder with nothing to check', () => {
      const files = stampAll('0123456789ab');
      files[1] = FILES[1];
      expect(errorOf(checkFolderBuildIds(files))).toEqual({ kind: 'unstamped', file: 'note.md', reason: 'no-stamp' });
      expect(errorOf(checkFolderBuildIds([FILES[2]]))).toEqual({ kind: 'no-stamped-file' });
      expect(errorOf(checkFolderBuildIds([]))).toEqual({ kind: 'no-stamped-file' });
      expect(describeBuildIdCheckError({ kind: 'no-stamped-file' })).toContain('no file');
      expect(describeBuildIdCheckError({ kind: 'unstamped', file: 'note.md', reason: 'no-stamp' })).toContain('note.md');
    });

    it('does not read a stamp in a reference file', () => {
      const files = stampAll('0123456789ab');
      files[2] = { file: 'references/asks.md', body: '# Asks [build fedcba987654]\n' };
      expect(valueOf(checkFolderBuildIds(files))).toBe('0123456789ab');
    });
  });

  describe('unstampBuildId', () => {
    const ID = '0123456789ab';

    it('undoes the stamp: the body as it was, and the id the stamp carried', () => {
      const bodies = [
        FILES[0].body,
        '# Flow\r\nText.\r\n',
        '---\nname: x\n# a comment\n---\n# Flow\n',
        '```\n# not a heading\n```\n# Real\n\nText.\n',
        'Intro.\n\n### Deep\n# Later\n',
      ];
      for (const body of bodies) {
        const unstamped = valueOf(unstampBuildId(valueOf(stampBuildId(body, ID))));
        expect(unstamped, JSON.stringify(body)).toEqual({ body, id: ID });
      }
    });

    it('returns the body without the blanks the stamp dropped from the end of the heading line', () => {
      const stamped = valueOf(stampBuildId('Intro.\n\n### Deep \t \n# Later\n', ID));
      expect(valueOf(unstampBuildId(stamped))).toEqual({ body: 'Intro.\n\n### Deep\n# Later\n', id: ID });
    });

    it('removes the stamp of the first heading only', () => {
      const text = `# Flow [build ${ID}]\n\n## Step [build fedcba987654]\n`;
      expect(valueOf(unstampBuildId(text))).toEqual({ body: '# Flow\n\n## Step [build fedcba987654]\n', id: ID });
    });

    it('refuses a text whose first heading has no stamp, and a text with no heading', () => {
      expect(errorOf(unstampBuildId('# Flow\n'))).toEqual({ kind: 'no-stamp' });
      expect(errorOf(unstampBuildId('Text only.\n'))).toEqual({ kind: 'no-heading' });
      expect(errorOf(unstampBuildId('# Flow\n\nLater [build 0123456789ab]\n'))).toEqual({ kind: 'no-stamp' });
    });
  });

  describe('workflowBuildId and the stamp', () => {
    const stampAll = (id: string, files: ReadonlyArray<{ file: string; body: string }>): Array<{ file: string; body: string }> =>
      files.map(f => (isStampedWorkflowFile(f.file) ? { file: f.file, body: valueOf(stampBuildId(f.body, id)) } : { ...f }));
    const unstampAll = (files: ReadonlyArray<{ file: string; body: string }>): Array<{ file: string; body: string }> =>
      files.map(f => (isStampedWorkflowFile(f.file) ? { file: f.file, body: valueOf(unstampBuildId(f.body)).body } : { ...f }));
    const withHeading = (index: number, from: string, to: string) =>
      FILES.map((f, i) => (i === index ? { ...f, body: f.body.replace(from, to) } : f));

    it('does not move when the first heading of a stamped file ends in blanks, because the stamp drops them', () => {
      expect(workflowBuildId(withHeading(0, '# Flow', '# Flow \t '))).toBe(workflowBuildId(FILES));
      expect(workflowBuildId(withHeading(1, '# Note', '# Note  '))).toBe(workflowBuildId(FILES));
    });

    it('moves when a blank changes a reference file, which the stamp does not touch', () => {
      expect(workflowBuildId(withHeading(2, '# Asks', '# Asks  '))).not.toBe(workflowBuildId(FILES));
    });

    it('moves when a blank changes anything but the end of the first heading line of a stamped file', () => {
      expect(workflowBuildId(withHeading(0, 'Text.', 'Text. '))).not.toBe(workflowBuildId(FILES));
      expect(workflowBuildId(withHeading(0, '# Flow', '#  Flow'))).not.toBe(workflowBuildId(FILES));
    });

    it('is the id recomputed from the unstamped files of the folder it stamped', () => {
      for (const files of [FILES, withHeading(0, '# Flow', '# Flow  '), withHeading(1, '# Note', '# Note\t')]) {
        const id = workflowBuildId(files);
        expect(workflowBuildId(unstampAll(stampAll(id, files)))).toBe(id);
      }
    });
  });

  describe('verifyFolderBuildId', () => {
    const stampAll = (id: string, files: ReadonlyArray<{ file: string; body: string }>): Array<{ file: string; body: string }> =>
      files.map(f => (isStampedWorkflowFile(f.file) ? { file: f.file, body: valueOf(stampBuildId(f.body, id)) } : { ...f }));
    const stampedBuild = (files: ReadonlyArray<{ file: string; body: string }> = FILES) =>
      stampAll(workflowBuildId(files), files);

    it('returns the id of a folder whose stamp is the id of its own files', () => {
      const id = workflowBuildId(FILES);
      expect(valueOf(verifyFolderBuildId(stampedBuild()))).toBe(id);
    });

    it('accepts a folder whose only stamped file is the core, with the references of its own build', () => {
      const files = [FILES[0], FILES[2]];
      expect(valueOf(verifyFolderBuildId(stampedBuild(files)))).toBe(workflowBuildId(files));
    });

    it('accepts a folder whose first heading ended in blanks before the stamp', () => {
      const files = FILES.map((f, i) => (i === 0 ? { ...f, body: f.body.replace('# Flow', '# Flow  ') } : f));
      expect(valueOf(verifyFolderBuildId(stampedBuild(files)))).toBe(workflowBuildId(files));
    });

    it('refuses a reference file of another build, and names the stamp and the id of the files', () => {
      const id = workflowBuildId(FILES);
      const swapped = stampedBuild().map(f => (f.file === 'references/asks.md' ? { ...f, body: '# Asks\n\nText of another build.\n' } : f));
      const refused = errorOf(verifyFolderBuildId(swapped));
      expect(refused.kind).toBe('id-mismatch');
      if (refused.kind !== 'id-mismatch') throw new Error(JSON.stringify(refused));
      expect(refused.stamped).toBe(id);
      expect(refused.recomputed).toMatch(new RegExp(`^[0-9a-f]{${BUILD_ID_LENGTH}}$`));
      expect(refused.recomputed).not.toBe(id);
      expect(describeBuildIdCheckError(refused)).toContain(id);
      expect(describeBuildIdCheckError(refused)).toContain(refused.recomputed);
    });

    it('refuses the same swap in a folder whose only stamped file is the core', () => {
      const files = [FILES[0], FILES[2]];
      const swapped = stampedBuild(files).map(f => (f.file === 'references/asks.md' ? { ...f, body: '# Asks\n\nOther.\n' } : f));
      expect(errorOf(verifyFolderBuildId(swapped)).kind).toBe('id-mismatch');
    });

    it('refuses a stamped file edited after the build, a file left out, and a stamp that is the hash of nothing', () => {
      const edited = stampedBuild().map(f => (f.file === 'note.md' ? { ...f, body: `${f.body}Edited.\n` } : f));
      expect(errorOf(verifyFolderBuildId(edited)).kind).toBe('id-mismatch');
      expect(errorOf(verifyFolderBuildId(stampedBuild().slice(0, 2))).kind).toBe('id-mismatch');
      expect(errorOf(verifyFolderBuildId(stampAll('0123456789ab', FILES))).kind).toBe('id-mismatch');
    });

    it('keeps the refusals of the shared-id check: mixed ids, an unstamped file, nothing stamped', () => {
      const mixed = stampedBuild();
      mixed[1] = { file: 'note.md', body: valueOf(stampBuildId(FILES[1].body, 'fedcba987654')) };
      expect(errorOf(verifyFolderBuildId(mixed)).kind).toBe('mixed-ids');
      const unstamped = stampedBuild();
      unstamped[1] = FILES[1];
      expect(errorOf(verifyFolderBuildId(unstamped))).toEqual({ kind: 'unstamped', file: 'note.md', reason: 'no-stamp' });
      expect(errorOf(verifyFolderBuildId([FILES[2]]))).toEqual({ kind: 'no-stamped-file' });
    });
  });
});

// ---------------------------------------------------------------------------
// installedReferenceManifest — what one INSTALL carries: everything the BUILD emits
// ---------------------------------------------------------------------------

/**
 * Files one install carries — every provider's tree, the PR-host tree, the
 * cross-cutting documents and the tool-call contract (D-INSTALL-ALL-PROVIDERS).
 * A floor, not an equality: a new reference raises it. ONE constant, because the
 * github and jira/linear installs are now the same install; registered in
 * tests/fixtures/numeric-floors.json under both of the ids that used to pin them
 * apart (installed-reference-count-github, installed-reference-count-provider),
 * which rose from 24 and 36 to meet here. This is the compliance-ON install; the
 * compliance-off install has its own floor, INSTALLED_REFS_COMPLIANCE_OFF.
 */
const INSTALLED_REFS = 47;

/**
 * Files a compliance-OFF install carries: the compliance-on manifest less the sixteen
 * posting operation files and the publication-gate document (47 - 17). Registered in
 * tests/fixtures/numeric-floors.json as installed-reference-count-compliance-off.
 * A floor, not an equality: a new kept reference raises it, and it never lowers.
 */
const INSTALLED_REFS_COMPLIANCE_OFF = 30;

describe('installedReferenceManifest — every provider, whatever the machine selected', () => {
  const generated = generatedReferenceManifest();
  const installed = installedReferenceManifest();

  it('an install carries exactly the manifest the build emits', () => {
    expect(installed.length).toBeGreaterThanOrEqual(INSTALLED_REFS);
    expect([...installed].sort()).toEqual([...generated].sort());
  });

  it('carries every provider tree, the PR-host tree and the tool-call contract', () => {
    for (const provider of ['github', 'jira', 'linear'] as const) {
      expect(
        installed.some(r => r.startsWith(`tracker/${provider}/`)),
        `an install must carry the ${provider} mechanics — a repository can select it`,
      ).toBe(true);
    }
    expect(installed.some(r => r.startsWith('pr/'))).toBe(true);
    expect(installed).toContain('tracker/_mcp.md');
  });

  it('takes no provider — the install is not a function of the selection', () => {
    // A provider parameter here would be the selection-scoped install coming back
    // one argument at a time; the body names no provider literal either.
    expect(installedReferenceManifest.length, 'a declared parameter beyond the options bag').toBeLessThanOrEqual(1);
    const source = readFileSync(path.join(ROOT, 'src', 'core', 'mds-variants.ts'), 'utf-8');
    const body = source.slice(source.indexOf('export function installedReferenceManifest'));
    const fn = body.slice(0, body.indexOf('\n}\n') + 3);
    expect(fn.length, 'the function body must be locatable').toBeGreaterThan(0);
    expect(fn).not.toContain('provider');
    for (const literal of ['jira', 'linear', 'github']) {
      expect(fn, `installedReferenceManifest must not name "${literal}"`).not.toContain(`'${literal}'`);
    }
  });

  it('asserts rather than degrades on a registry that does not expand (M3)', () => {
    // Same posture as its sibling generatedReferenceManifest: the registry is a
    // compile-time constant, so a refusal is a programming error no caller could
    // sensibly continue past.
    expect(() => installedReferenceManifest({ modules: [] })).toThrow(/does not expand/);
  });
});

// ---------------------------------------------------------------------------
// The compliance-off reference set (AC-39, AC-40; TP-56)
// ---------------------------------------------------------------------------
//
// A compliance-off install carries no reference that describes a posting step. The
// set it omits is POSTING_OPS (the eight posting operations, whichever directory a
// file of one sits in) plus the publication-gate document. The oracle below finds
// the same files by PATH, not by calling the function under test, so a registry
// that moved an op would turn the comparison red rather than agree with itself.

describe('POSTING_OPS and the compliance-off reference manifest (TP-56)', () => {
  const on = installedReferenceManifest();
  const off = installedReferenceManifest({ compliance: false });
  const posting: readonly string[] = POSTING_OPS;

  /** The reference files of the posting operations, found by path: `pr/{op}.md` and `tracker/{provider}/{op}.md`. */
  function postingOpFiles(manifest: readonly string[]): string[] {
    return manifest.filter(rel => {
      const segments = rel.split('/');
      const name = (segments[segments.length - 1] ?? '').replace(/\.md$/, '');
      return (segments[0] === 'pr' || segments[0] === 'tracker') && posting.includes(name);
    });
  }

  /** A fan-out module with eight operations and none of them a posting operation. */
  const NO_POSTING_MODULES: readonly VariantModule[] = [
    {
      source: 'src/assets/mds/git/_pr.mds',
      subdir: 'pr',
      kind: 'fanout',
      ops: ['op-a', 'op-b', 'op-c', 'op-d', 'op-e', 'op-f', 'op-g', 'op-h'],
    },
  ];

  it('is the one roster: the test fixture takes it from production and does not retype it', () => {
    expect(POSTING_OPERATIONS).toBe(POSTING_OPS);
  });

  it('holds eight distinct operations, each one a PR-host or a tracker operation', () => {
    expect(POSTING_OPS).toHaveLength(8);
    expect(new Set(POSTING_OPS).size).toBe(8);
    const registered: readonly string[] = [...PR_HOST_OPS, ...TRACKER_OPS];
    for (const op of POSTING_OPS) expect(registered, `${op} is not a registered operation`).toContain(op);
  });

  it('checks every name against the registry and accepts the shipped roster', () => {
    const checked = checkPostingOps(POSTING_OPS, resolveVariantModules());
    expect(checked.ok).toBe(true);
  });

  it('refuses a name that no fan-out module registers', () => {
    const refused = errorOf(checkPostingOps([...POSTING_OPS, 'not-an-op'], resolveVariantModules()));
    expect(refused).toEqual({ kind: 'unregistered-posting-op', op: 'not-an-op' });
    expect(describePostingOpsError(refused)).toContain('not-an-op');
  });

  it('refuses a document name: a named document is not an operation', () => {
    const refused = errorOf(checkPostingOps(['publication-gate'], resolveVariantModules()));
    expect(refused).toEqual({ kind: 'unregistered-posting-op', op: 'publication-gate' });
  });

  it('refuses a name listed twice', () => {
    const refused = errorOf(checkPostingOps(['manage-debt', 'manage-debt'], resolveVariantModules()));
    expect(refused).toEqual({ kind: 'duplicate-posting-op', op: 'manage-debt' });
    expect(describePostingOpsError(refused)).toContain('manage-debt');
  });

  it('omits the 16 operation files and the publication-gate document, and nothing else', () => {
    const omitted = on.filter(rel => !off.includes(rel)).sort();
    const expected = [...postingOpFiles(on), ...COMPLIANCE_OFF_OMITTED_DOCS.map(doc => `${doc}.md`)].sort();
    expect(omitted).toEqual(expected);
    expect(postingOpFiles(on).filter(rel => rel.startsWith('pr/'))).toHaveLength(4);
    expect(postingOpFiles(on).filter(rel => rel.startsWith('tracker/'))).toHaveLength(12);
    expect(omitted).toContain('publication-gate.md');
    expect(off).toHaveLength(on.length - 17);
    expect(off.length).toBeGreaterThanOrEqual(INSTALLED_REFS_COMPLIANCE_OFF);
  });

  it('keeps check-merge-readiness and every other document the posting steps do not own', () => {
    expect(off).toContain('pr/check-merge-readiness.md');
    for (const keep of ['trust-rule.md', 'decision-markers.md', 'learn-conventions.md', 'tracker/_mcp.md']) {
      expect(off, `${keep} is not a posting reference`).toContain(keep);
    }
    expect(off).not.toContain('publication-gate.md');
    for (const provider of ['github', 'jira', 'linear']) {
      expect(off).toContain(`tracker/${provider}/ensure-pr-ready.md`);
      expect(off).not.toContain(`tracker/${provider}/manage-debt.md`);
    }
  });

  it('is the on manifest minus the omitted files, in the on order', () => {
    expect(off).toEqual(on.filter(rel => off.includes(rel)));
    expect(new Set(off).size, 'a duplicate entry').toBe(off.length);
  });

  it('returns exactly today\'s manifest by default and with compliance true', () => {
    expect(installedReferenceManifest()).toEqual(generatedReferenceManifest());
    expect(installedReferenceManifest({ compliance: true })).toEqual(generatedReferenceManifest());
  });

  it('asserts rather than degrades when the registry does not register a posting operation', () => {
    expect(() => installedReferenceManifest({ modules: NO_POSTING_MODULES, compliance: false }))
      .toThrow(/posting operation/);
  });

  it('returns the omitted set as paths, and the error for a bogus roster', () => {
    const omitted = complianceOffOmittedRelPaths(resolveVariantModules());
    expect([...valueOf(omitted)].sort()).toEqual(on.filter(rel => !off.includes(rel)).sort());
    expect(errorOf(complianceOffOmittedRelPaths(resolveVariantModules(), ['not-an-op'])))
      .toEqual({ kind: 'unregistered-posting-op', op: 'not-an-op' });
  });

  it('names a tree inside the compliance-off tree that no host may declare as its output dir', () => {
    expect(COMPLIANCE_OFF_SKILL_REFS_OUTPUT_DIR).toBe('dist/compliance-off/skills/git/references');
    expect(COMPLIANCE_OFF_SKILL_REFS_OUTPUT_DIR.startsWith(`${COMPLIANCE_OFF_OUTPUT_DIR}/`)).toBe(true);
    expect(ALLOWED_OUTPUT_DIR_NAMES).not.toContain(COMPLIANCE_OFF_SKILL_REFS_OUTPUT_DIR);
  });
});

// ---------------------------------------------------------------------------
// splitSectionArms — one operation section, then its compliance arms (AC-39; TP-54)
// ---------------------------------------------------------------------------

describe('splitSectionArms', () => {
  const CON = '<!-- compliance:on -->';
  const COFF = '<!-- compliance:off -->';
  const CEND = '<!-- compliance:end -->';
  const WRITES_OFF = { complianceOffWritten: true } as const;

  it('gives a section with no arm to both variants unchanged', () => {
    const content = 'Step one.\n\nStep two.\n';
    const bodies = valueOf(splitSectionArms('op', content, WRITES_OFF));
    expect(bodies.on).toBe(content);
    expect(bodies.complianceOff).toBe(content);
  });

  it('keeps an on arm for the on variant and its off arm for the compliance-off variant', () => {
    const content = `Intro.\n${CON}\nPost the comment.\n${COFF}\nKeep the result local.\n${CEND}\nOutro.\n`;
    const bodies = valueOf(splitSectionArms('op', content, WRITES_OFF));
    expect(bodies.on).toBe('Intro.\nPost the comment.\nOutro.\n');
    expect(bodies.complianceOff).toBe('Intro.\nKeep the result local.\nOutro.\n');
  });

  it('drops an on-only arm from the compliance-off variant and leaves the text around it', () => {
    const content = `Intro.\n${CON}\nPost the comment.\n${CEND}\nOutro.\n`;
    const bodies = valueOf(splitSectionArms('op', content, WRITES_OFF));
    expect(bodies.on).toBe('Intro.\nPost the comment.\nOutro.\n');
    expect(bodies.complianceOff).toBe('Intro.\nOutro.\n');
  });

  it('ends each variant with one newline when an arm opens or closes the section', () => {
    const content = `${CON}\nPost the comment.\n${CEND}\nKept line.\n`;
    const bodies = valueOf(splitSectionArms('op', content, WRITES_OFF));
    expect(bodies.on).toBe('Post the comment.\nKept line.\n');
    expect(bodies.complianceOff).toBe('Kept line.\n');
  });

  it('refuses a section whose written compliance-off variant would be empty, and names the variant', () => {
    const content = `${CON}\nPost the comment.\n${CEND}\n`;
    expect(errorOf(splitSectionArms('post-it', content, WRITES_OFF)))
      .toEqual({ kind: 'empty-variant', op: 'post-it', variant: 'compliance-off' });
  });

  it('accepts the same section when the compliance-off variant is not written', () => {
    const content = `${CON}\nPost the comment.\n${CEND}\n`;
    const bodies = valueOf(splitSectionArms('post-it', content, { complianceOffWritten: false }));
    expect(bodies.on).toBe('Post the comment.\n');
  });

  it('refuses a section whose on variant would be empty, whether or not the compliance-off one is written', () => {
    const content = `${COFF}\nKeep it local.\n${CEND}\n`;
    for (const complianceOffWritten of [true, false]) {
      expect(errorOf(splitSectionArms('local-only', content, { complianceOffWritten })))
        .toEqual({ kind: 'empty-variant', op: 'local-only', variant: 'on' });
    }
  });

  it('reports an arm left open at the end of the section as a split refusal of that operation', () => {
    const refused = errorOf(splitSectionArms('op', `${CON}\nPost the comment.\n`, WRITES_OFF));
    expect(refused).toMatchObject({ kind: 'arm-split', op: 'op', error: { kind: 'unclosed-arm', axis: 'compliance' } });
  });

  it('reports a marker spelled inside a line as a stray marker', () => {
    const refused = errorOf(splitSectionArms('op', `Text ${CON} more.\n`, WRITES_OFF));
    expect(refused).toMatchObject({ kind: 'arm-split', error: { kind: 'stray-marker', axis: 'compliance' } });
  });
});
