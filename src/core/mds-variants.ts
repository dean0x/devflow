/**
 * MDS host output validation and variant expansion.
 *
 * Pure module — zero I/O. All functions take plain strings and return Result
 * values; callers own every filesystem call and every process exit.
 *
 * applies ADR-013: pure core-layer module, no build-script or adapter concerns.
 * avoids PF-014: no process.exit(); all fallible paths return Result. The
 * exiting shell is scripts/build-mds.ts, which renders these errors into its
 * pre-existing messages.
 *
 * Scope guarantee: this module answers exactly four questions for an MDS host —
 *   1. Is the filename it will emit safe? (validateOutputName)
 *   2. Is the directory it declares one the build may write into, and which host
 *      variant does that directory select? (resolveOutputDir)
 *   3. Which files does a reference module fan out into? (expandVariants)
 *   4. Which slice of its compiled body belongs to each? (splitVariantSections)
 * It still performs no I/O and no iteration over the filesystem.
 *
 * The `-variants` in the filename stopped being a reservation in Phase 2: the
 * variant-expansion entry point promised by DR-16 (PR #334) now lives here, next
 * to the validation it depends on.
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
 * host sheds its whole steering block, and a `skill-refs` host sheds its whole
 * steering block AND fans its body out into one file per operation. Callers
 * dispatch on this discriminant
 * rather than re-deriving the answer from the resolved path, so the allowlist
 * below stays the single place that knows which directory means what.
 *
 * Widening this union is the deliberate act that adds a build destination with
 * new semantics: every exhaustive dispatch over it stops compiling until the new
 * variant is handled.
 */
export type HostVariant = 'commands' | 'agents' | 'skill-refs';

interface AllowedOutputDir {
  readonly dir: string;
  readonly variant: HostVariant;
}

/**
 * The only directories the MDS build may write into, each tagged with the host
 * variant it selects.
 *
 * `dist/commands` holds compiled slash commands; `dist/agents` holds agents
 * compiled from generator hosts; `dist/skills/git/references` holds the generated
 * `devflow:git` skill references. Adding an entry here is the single place a new
 * build destination becomes legal — and `satisfies` forces that entry to declare
 * a HostVariant, so no destination can arrive without saying how it is treated.
 */
/**
 * Repo-relative destination for `agents` hosts.
 *
 * Exported because the build's orphan prune must name this directory even when
 * no generator host is planned — which is exactly the case where every file in
 * it is an orphan, so the directory cannot be derived from the plan. Reading it
 * from here keeps the table below the only place a destination is spelled.
 */
export const AGENTS_OUTPUT_DIR = 'dist/agents';

/**
 * Repo-relative destination for `skill-refs` hosts — the generated `devflow:git`
 * skill references.
 *
 * D-SKILLREFS-ALLOWLIST: the third allowlist entry is deliberate, not incidental.
 * The alternative was to let the build write these files through a path composed
 * outside resolveOutputDir, which would have made the allowlist a partial gate —
 * true for two destinations and bypassed for the third. Routing them through the
 * same table keeps ONE answer to "where may the build write", so a future
 * destination is added in one place and inherits containment, the backslash and
 * canonical-spelling checks, and the exhaustive-dispatch friction that
 * HostVariant imposes on every consumer.
 *
 * Exported because the build's orphan prune must name this directory even when
 * no reference module is planned — the same reason AGENTS_OUTPUT_DIR is exported.
 */
export const SKILL_REFS_OUTPUT_DIR = 'dist/skills/git/references';

const ALLOWED_OUTPUT_DIRS = [
  { dir: 'dist/commands', variant: 'commands' },
  { dir: AGENTS_OUTPUT_DIR, variant: 'agents' },
  { dir: SKILL_REFS_OUTPUT_DIR, variant: 'skill-refs' },
] as const satisfies readonly AllowedOutputDir[];

/**
 * The allowlisted directory names, in declaration order, for error rendering.
 *
 * Exported so guards assert the build's refusal text against the table itself
 * rather than against a retyped literal: adding a destination then rewrites both
 * the message and its assertion from one edit (ADR-024 — the expectation must
 * come from the thing under test, not a copy of it).
 */
export const ALLOWED_OUTPUT_DIR_NAMES: readonly string[] = ALLOWED_OUTPUT_DIRS.map(entry => entry.dir);

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

// ---------------------------------------------------------------------------
// Variant expansion — one reference module fans out into many op files
// ---------------------------------------------------------------------------

/**
 * The 10 tracker operations whose provider mechanics are generated as separate
 * skill reference files.
 *
 * Bidirectional parity, the COMPLIANCE_SKILL_TOKENS model
 * (src/core/compliance-compose.ts): every op named here must have a section in
 * the module that declares it, and every section in that module must be named
 * here. splitVariantSections enforces both directions; neither alone is enough —
 * the forward direction alone lets a stray section ship unreferenced, and the
 * reverse alone lets a listed op silently emit nothing.
 *
 * The list is long from its first commit on purpose. A one- or two-element list
 * makes every parity assertion over it vacuous (GAP-42, the PF-018 trap) and is
 * structurally identical to the single-arm conditional AC-1.2 forbids, so
 * expandVariants refuses a pair list below MIN_VARIANT_PAIRS.
 */
export const TRACKER_GITHUB_OPS = [
  'setup-task',
  'fetch-issue',
  'fetch-issues-batch',
  'manage-debt',
  'create-release',
  'gather-release-evidence',
  'backlink-shipped-issues',
  'ensure-traceable-issue',
  'post-wave-report',
  'ensure-pr-ready',
] as const;

/** One `.mds` module that fans out into a directory of per-op reference files. */
export interface VariantModule {
  /** Repo-relative, POSIX-spelled source path of the module host. */
  readonly source: string;
  /**
   * POSIX sub-path under SKILL_REFS_OUTPUT_DIR that this module's files land in.
   * Every segment is validated by the same rule as an output filename, so a
   * module can no more escape the destination than a host can.
   */
  readonly subdir: string;
  /** The operations this module emits, one file each. */
  readonly ops: readonly string[];
}

/**
 * Every reference module the build knows about — a closed registry, read the
 * same way ALLOWED_OUTPUT_DIRS is read.
 *
 * A `skill-refs` host whose source path is absent from this table is refused by
 * the build rather than guessed at: the emitted filenames come from the op list,
 * not from the module's own basename, so there is nothing to fall back to.
 *
 * Phase 2 is GitHub-only. `_jira.mds` / `_linear.mds` and the MCP module are
 * Phase 3 and are deliberately absent — an entry here with no module on disk
 * would be an artifact with no reachable consumer (ADR-003).
 */
export const VARIANT_MODULES = [
  {
    source: 'src/assets/mds/tracker/_github.mds',
    subdir: 'tracker/github',
    ops: TRACKER_GITHUB_OPS,
  },
] as const satisfies readonly VariantModule[];

/**
 * The floor a fanned-out pair list must clear.
 *
 * 8 is not a tuning knob: below it the "every op has a file and every file has
 * an op" parity assertions stop discriminating, because a list short enough to
 * be enumerated by hand is satisfied by any implementation that returns
 * something (GAP-42). Raising it is allowed; lowering it is the exact evasion
 * §14.5's no-threshold-lowered rule exists to prevent.
 */
export const MIN_VARIANT_PAIRS = 8;

/** One emitted reference file: which module produced it, for which operation. */
export interface VariantPair {
  /** The producing module's repo-relative source path. */
  readonly module: string;
  /** The operation this file carries mechanics for. */
  readonly op: string;
  /** POSIX path relative to SKILL_REFS_OUTPUT_DIR, including the `.md` suffix. */
  readonly relPath: string;
}

export type VariantExpansionError =
  | { kind: 'no-modules' }
  | { kind: 'too-few-pairs'; count: number; minimum: number }
  | { kind: 'empty-module'; module: string }
  | { kind: 'invalid-subdir-segment'; module: string; subdir: string; segment: string }
  | { kind: 'invalid-op-name'; module: string; op: string; cause: OutputNameError }
  | { kind: 'duplicate-output'; relPath: string; modules: readonly string[] };

/**
 * Expand reference modules into the flat `(module, op)` pair list the build
 * writes.
 *
 * Pure and total: every refusal is a Result, so the build shell keeps its single
 * exit (avoids PF-014). The expansion is deliberately flat rather than nested —
 * one list of destinations is what the plan pass needs to detect two hosts
 * claiming one file, and a nested shape would have to be flattened there anyway.
 *
 * Every segment of every emitted path goes through validateOutputName, so the
 * destination cannot be escaped by a subdir or an op name, only by editing the
 * registry above.
 *
 * @param modules - Registry to expand (defaults to VARIANT_MODULES). Injectable
 *   so the refusal branches are provable without inventing a module on disk.
 */
export function expandVariants(
  modules: readonly VariantModule[] = VARIANT_MODULES,
): Result<VariantPair[], VariantExpansionError> {
  if (modules.length === 0) return Err({ kind: 'no-modules' });

  const pairs: VariantPair[] = [];
  const claimedBy = new Map<string, string[]>();

  for (const mod of modules) {
    if (mod.ops.length === 0) return Err({ kind: 'empty-module', module: mod.source });

    for (const segment of mod.subdir.split('/')) {
      if (!validateOutputName(segment).ok) {
        return Err({
          kind: 'invalid-subdir-segment',
          module: mod.source,
          subdir: mod.subdir,
          segment,
        });
      }
    }

    for (const op of mod.ops) {
      const nameResult = validateOutputName(op);
      if (!nameResult.ok) {
        return Err({ kind: 'invalid-op-name', module: mod.source, op, cause: nameResult.error });
      }
      const relPath = `${mod.subdir}/${op}.md`;
      const claimants = claimedBy.get(relPath);
      if (claimants === undefined) {
        claimedBy.set(relPath, [mod.source]);
      } else {
        claimants.push(mod.source);
        return Err({ kind: 'duplicate-output', relPath, modules: [...claimants] });
      }
      pairs.push({ module: mod.source, op, relPath });
    }
  }

  if (pairs.length < MIN_VARIANT_PAIRS) {
    return Err({ kind: 'too-few-pairs', count: pairs.length, minimum: MIN_VARIANT_PAIRS });
  }

  return Ok(pairs);
}

// ---------------------------------------------------------------------------
// Section splitting — which slice of a module's compiled body belongs to which op
// ---------------------------------------------------------------------------

/**
 * The delimiter a reference module writes before each operation's section.
 *
 * An HTML comment rather than a heading: the splitter CONSUMES these lines, so
 * the emitted reference starts with its own content and carries no build
 * plumbing. A heading would have to survive into the file and would then be
 * load-bearing for two unrelated readers at once.
 *
 * No `g`/`y` flag on the shared object — callers construct their own scanner
 * rather than inherit a lastIndex (the same rule LEADING_BLOCK_RE follows in
 * scripts/build-mds.ts).
 */
export const VARIANT_SECTION_MARKER_RE = /^<!-- op: ([a-z0-9][a-z0-9._-]{0,63}) -->[ \t]*$/;

export type SectionSplitError =
  | { kind: 'no-sections'; expected: readonly string[] }
  | { kind: 'unknown-section'; op: string; expected: readonly string[] }
  | { kind: 'duplicate-section'; op: string }
  | { kind: 'missing-section'; ops: readonly string[] }
  | { kind: 'empty-section'; op: string };

/**
 * Split a reference module's compiled body into one document per operation.
 *
 * Bidirectional, and both directions are load-bearing:
 *   - unknown-section — the body carries a section for an op the registry does
 *     not name, so a file would ship that nothing loads (ADR-003);
 *   - missing-section — the registry names an op the body does not cover, so the
 *     preamble's load instruction resolves to nothing at runtime.
 * A forward-only check passes on either half of that pair.
 *
 * empty-section is the third arm, and it exists because the other two cannot see
 * it: an op with a marker and no body compiles cleanly and emits a zero-byte
 * reference, which reads downstream as "mechanics unavailable" with no build
 * signal at all (the GAP-44 shape — omission is caught, emptiness is not).
 *
 * @param body - The module's compiled output, steering block already stripped.
 * @param ops - The operations the registry says this module emits.
 */
export function splitVariantSections(
  body: string,
  ops: readonly string[],
): Result<Map<string, string>, SectionSplitError> {
  const lines = body.split('\n');
  const sections = new Map<string, string[]>();
  const expected = new Set(ops);
  let current: string | null = null;

  for (const line of lines) {
    const match = VARIANT_SECTION_MARKER_RE.exec(line);
    if (match !== null) {
      const op = match[1];
      if (!expected.has(op)) return Err({ kind: 'unknown-section', op, expected: ops });
      if (sections.has(op)) return Err({ kind: 'duplicate-section', op });
      sections.set(op, []);
      current = op;
      continue;
    }
    // Text before the first marker is module-level preamble and is dropped: it
    // belongs to no operation, so shipping it would duplicate it into every file.
    if (current === null) continue;
    sections.get(current)!.push(line);
  }

  if (sections.size === 0) return Err({ kind: 'no-sections', expected: ops });

  const missing = ops.filter(op => !sections.has(op));
  if (missing.length > 0) return Err({ kind: 'missing-section', ops: missing });

  const out = new Map<string, string>();
  for (const op of ops) {
    const content = `${sections.get(op)!.join('\n').trim()}\n`;
    if (content.trim().length === 0) return Err({ kind: 'empty-section', op });
    out.set(op, content);
  }
  return Ok(out);
}
