/**
 * MDS host output validation.
 *
 * Pure module — zero I/O. All functions take plain strings and return Result
 * values; callers own every filesystem call and every process exit.
 *
 * applies ADR-013: pure core-layer module, no build-script or adapter concerns.
 * avoids PF-014: no process.exit(); all fallible paths return Result. The
 * exiting shell is scripts/build-mds.ts, which renders these errors into its
 * pre-existing messages.
 *
 * Scope guarantee: this module answers exactly two questions for an MDS host —
 *   1. Is the filename it will emit safe? (validateOutputName)
 *   2. Is the directory it declares one the build may write into, and which host
 *      variant does that directory select? (resolveOutputDir)
 * It performs no templating, no expansion, and no iteration over hosts.
 *
 * The `-variants` in the filename is a reservation, not a description of today's
 * contents: Phase 2's variant-expansion entry point lands in this module, so it
 * is named for the home it will grow into rather than renamed twice (DR-16, PR
 * #334). Until then the only variant notion here is HostVariant below — which
 * output directory a host declares, and therefore how the build treats its
 * compiled bytes.
 */

import * as path from 'path';
import { isContainedIn } from './paths.js';

// ---------------------------------------------------------------------------
// Result type (local; matches codebase per-module pattern)
// ---------------------------------------------------------------------------

export type Result<T, E> =
  | { ok: true; value: T }
  | { ok: false; error: E };

function Ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

function Err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

// ---------------------------------------------------------------------------
// Output filename validation
// ---------------------------------------------------------------------------

/**
 * Charset an emitted output basename must satisfy before it is joined onto a
 * build destination directory.
 *
 * Rules (same anchored, bounded, alternation-free shape as MODEL_NAME_RE in
 * agent-frontmatter.ts):
 *  - Start with a lowercase alphanumeric character.
 *  - Remaining characters: lowercase alphanumeric, dot, underscore, hyphen.
 *  - Total length: 1–64 characters.
 *
 * Accepts every basename the repo ships (`implement`, `code-review`,
 * `dynamic-build`, `git`, …) and refuses uppercase, whitespace, and shell
 * metacharacters outright.
 */
const OUTPUT_NAME_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;

export type OutputNameError =
  | { kind: 'empty' }
  | { kind: 'dot-segment'; name: string }
  | { kind: 'path-separator'; name: string }
  | { kind: 'invalid-charset'; name: string };

/**
 * Validate the basename an MDS host will emit (before `.md` is appended).
 *
 * Traversal is reported ahead of the separator check so `../x` is diagnosed as
 * traversal rather than as a generic slash, and `a/b` is diagnosed as nesting.
 * Both are refused; the distinction only shapes the build's error message.
 */
export function validateOutputName(name: string): Result<string, OutputNameError> {
  if (name === '') return Err({ kind: 'empty' });

  const segments = name.split(/[\\/]/);
  if (segments.some(segment => segment === '..' || segment === '.')) {
    return Err({ kind: 'dot-segment', name });
  }
  if (segments.length > 1) {
    return Err({ kind: 'path-separator', name });
  }
  if (!OUTPUT_NAME_RE.test(name)) {
    return Err({ kind: 'invalid-charset', name });
  }
  return Ok(name);
}

// ---------------------------------------------------------------------------
// Output directory allowlist
// ---------------------------------------------------------------------------

/**
 * The kinds of artifact the MDS build emits — one per allowlisted output
 * directory.
 *
 * The directory a host declares is what selects its treatment downstream: a
 * `commands` host keeps its frontmatter minus the build-owned key, an `agents`
 * host sheds its whole steering block. Callers dispatch on this discriminant
 * rather than re-deriving the answer from the resolved path, so the allowlist
 * below stays the single place that knows which directory means what.
 *
 * Widening this union is the deliberate act that adds a build destination with
 * new semantics: every exhaustive dispatch over it stops compiling until the new
 * variant is handled.
 */
export type HostVariant = 'commands' | 'agents';

interface AllowedOutputDir {
  readonly dir: string;
  readonly variant: HostVariant;
}

/**
 * The only directories the MDS build may write into, each tagged with the host
 * variant it selects.
 *
 * `dist/commands` holds compiled slash commands; `dist/agents` holds agents
 * compiled from generator hosts. Adding an entry here is the single place a new
 * build destination becomes legal — and `satisfies` forces that entry to declare
 * a HostVariant, so no destination can arrive without saying how it is treated.
 */
const ALLOWED_OUTPUT_DIRS = [
  { dir: 'dist/commands', variant: 'commands' },
  { dir: 'dist/agents', variant: 'agents' },
] as const satisfies readonly AllowedOutputDir[];

/** The allowlisted directory names, in declaration order, for error rendering. */
const ALLOWED_OUTPUT_DIR_NAMES: readonly string[] = ALLOWED_OUTPUT_DIRS.map(entry => entry.dir);

/**
 * Compile-time proof that the table above covers every declared variant.
 *
 * `satisfies` proves each entry names a real HostVariant; this proves the
 * reverse — a variant nothing maps to would be unreachable and dead. Adding a
 * member to HostVariant without a directory turns the conditional `false`, which
 * is not assignable to `true`.
 */
type Assert<T extends true> = T;
type MappedVariants = (typeof ALLOWED_OUTPUT_DIRS)[number]['variant'];
type _EveryVariantHasADirectory = Assert<[HostVariant] extends [MappedVariants] ? true : false>;

export type OutputDirError =
  | { kind: 'escapes-root'; declared: string }
  | { kind: 'backslash-separator'; declared: string; allowed: readonly string[] }
  | { kind: 'non-canonical'; declared: string; canonical: string; allowed: readonly string[] }
  | { kind: 'not-allowlisted'; declared: string; allowed: readonly string[] };

/** A declaration that passed every check: where to write, and what kind of host it is. */
export interface ResolvedOutputDir {
  /** Which artifact kind this destination selects. */
  readonly variant: HostVariant;
  /** The resolved absolute directory, so callers never re-derive it. */
  readonly abs: string;
}

/**
 * Resolve a host's declared `output-dir:` against `root` and check it against
 * the allowlist.
 *
 * Four refusals, in order:
 *  1. `escapes-root`        — the declaration resolves outside `root`
 *     (`dist/../..`, an absolute path elsewhere). Containment is decided by
 *     isContainedIn, which compares resolved paths rather than string prefixes.
 *  2. `backslash-separator` — the declaration contains a backslash. Declarations
 *     are POSIX-spelled by contract; the canonical check below normalises as
 *     POSIX, where a backslash is an ordinary character, so a win32-style
 *     spelling would otherwise slip through as canonical on win32 only.
 *  3. `non-canonical`       — the declaration resolves onto an allowlisted target
 *     but is not spelled canonically (`dist/commands/`, `./dist/agents`,
 *     `dist/skills/../commands`). One target must have exactly one spelling.
 *  4. `not-allowlisted`     — the resolved target is not an allowlisted directory.
 *
 * On success the resolved absolute directory is returned together with the host
 * variant the matching allowlist entry declares, so callers dispatch on a value
 * they were handed rather than one they re-derive.
 */
export function resolveOutputDir(
  root: string,
  declared: string,
): Result<ResolvedOutputDir, OutputDirError> {
  if (!isContainedIn(root, declared)) {
    return Err({ kind: 'escapes-root', declared });
  }

  if (declared.includes('\\')) {
    return Err({ kind: 'backslash-separator', declared, allowed: ALLOWED_OUTPUT_DIR_NAMES });
  }

  // Canonical spelling: POSIX-normalised, no trailing separator. The frontmatter
  // value is always written with forward slashes, so normalise as POSIX and
  // resolve with the platform resolver.
  const canonical = path.posix.normalize(declared).replace(/\/+$/, '');
  if (canonical !== declared) {
    return Err({ kind: 'non-canonical', declared, canonical, allowed: ALLOWED_OUTPUT_DIR_NAMES });
  }

  const abs = path.resolve(root, declared);
  const match = ALLOWED_OUTPUT_DIRS.find(entry => path.resolve(root, entry.dir) === abs);
  if (match === undefined) {
    return Err({ kind: 'not-allowlisted', declared, allowed: ALLOWED_OUTPUT_DIR_NAMES });
  }

  return Ok({ variant: match.variant, abs });
}
