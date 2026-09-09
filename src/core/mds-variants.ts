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
 *   2. Is the directory it declares one the build may write into? (resolveOutputDir)
 * It performs no templating, no expansion, and no iteration over hosts.
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
 * The only directories the MDS build may write into.
 *
 * `dist/commands` holds compiled slash commands; `dist/agents` holds agents
 * compiled from generator hosts. Adding an entry here is the single place a new
 * build destination becomes legal.
 */
const ALLOWED_OUTPUT_DIRS = ['dist/commands', 'dist/agents'] as const;

export type OutputDirError =
  | { kind: 'escapes-root'; declared: string }
  | { kind: 'non-canonical'; declared: string; canonical: string; allowed: readonly string[] }
  | { kind: 'not-allowlisted'; declared: string; allowed: readonly string[] };

/**
 * Resolve a host's declared `output-dir:` against `root` and check it against
 * the allowlist.
 *
 * Three refusals, in order:
 *  1. `escapes-root`    — the declaration resolves outside `root` (`dist/../..`,
 *     an absolute path elsewhere). Containment is decided by isContainedIn,
 *     which compares resolved paths rather than string prefixes.
 *  2. `non-canonical`   — the declaration resolves onto an allowlisted target
 *     but is not spelled canonically (`dist/commands/`, `./dist/agents`,
 *     `dist/skills/../commands`). One target must have exactly one spelling.
 *  3. `not-allowlisted` — the resolved target is not an allowlisted directory.
 *
 * On success the resolved absolute directory is returned, so callers never
 * re-derive it.
 */
export function resolveOutputDir(root: string, declared: string): Result<string, OutputDirError> {
  if (!isContainedIn(root, declared)) {
    return Err({ kind: 'escapes-root', declared });
  }

  // Canonical spelling: POSIX-normalised, no trailing separator. The frontmatter
  // value is always written with forward slashes, so normalise as POSIX and
  // resolve with the platform resolver.
  const canonical = path.posix.normalize(declared).replace(/\/+$/, '');
  if (canonical !== declared) {
    return Err({ kind: 'non-canonical', declared, canonical, allowed: ALLOWED_OUTPUT_DIRS });
  }

  const abs = path.resolve(root, declared);
  const match = ALLOWED_OUTPUT_DIRS.find(dir => path.resolve(root, dir) === abs);
  if (match === undefined) {
    return Err({ kind: 'not-allowlisted', declared, allowed: ALLOWED_OUTPUT_DIRS });
  }

  return Ok(abs);
}
