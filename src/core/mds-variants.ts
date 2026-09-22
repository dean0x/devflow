/**
 * MDS host output validation and variant expansion.
 *
 * Pure module — zero I/O. Every question a caller asks about a HOST is answered
 * with a Result; callers own every filesystem call and every process exit.
 *
 * applies ADR-013: pure core-layer module, no build-script or adapter concerns.
 * The registries below are agent-neutral, so what is DERIVED from them is derived
 * here rather than inside an install target — a target adapter computing a build
 * fact, with tests importing that adapter to learn it, is the seam inverting.
 * avoids PF-014: no process.exit(); every fallible path returns Result. The
 * exiting shell is scripts/build-mds.ts, which renders these errors into its
 * pre-existing messages.
 *
 * Scope guarantee: this module answers exactly five questions —
 *   1. Is the filename a host will emit safe? (validateOutputName)
 *   2. Is the directory it declares one the build may write into, and which host
 *      variant does that directory select? (resolveOutputDir)
 *   3. Which files does a reference module fan out into? (expandVariants)
 *   4. Which slice of its compiled body belongs to each? (splitVariantSections)
 *   5. Which files does the shipped registry produce, flattened into the manifest
 *      an installer converges to? (generatedReferenceManifest — the one answer
 *      that asserts instead of returning a Result; see the function for why.)
 * It still performs no I/O and no iteration over the filesystem.
 *
 * The `-variants` in the filename names the variant-expansion entry point below
 * (DR-16), which lives next to the validation it depends on.
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

/**
 * Validate the emitted basename of a CONTRACT document: one leading underscore,
 * then the ordinary name rule.
 *
 * A SECOND function rather than a relaxed OUTPUT_NAME_RE, and the distinction is
 * not stylistic. The underscore is MANDATORY here and FORBIDDEN there, because it
 * is what tells a reader of the references tree which entries are providers:
 * `tracker/_mcp.md` sits beside the provider DIRECTORIES `tracker/github/` and
 * `tracker/jira/`, and `tracker/mcp.md` would read as a third provider.
 * Relaxing the shared rule instead would have admitted `_anything.md`
 * as a command or an agent basename too — a widening across all three build
 * destinations to buy a property only this one needs (ADR-025: classify the case,
 * never blanket-widen).
 *
 * Every other guarantee is inherited by delegation, so the dot-segment,
 * separator, charset and length refusals cannot drift apart from their originals.
 * The refusal reports the name AS WRITTEN — a reader of the build's error needs
 * the string they typed, not its underscore-stripped remainder.
 */
export function validateContractOutputName(name: string): Result<string, OutputNameError> {
  if (!name.startsWith('_')) return Err({ kind: 'invalid-charset', name });
  const inner = validateOutputName(name.slice(1));
  if (inner.ok) return Ok(name);
  return Err(inner.error.kind === 'empty' ? { kind: 'empty' } : { ...inner.error, name });
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
 * The bare (unprefixed) skill that OWNS the generated references.
 *
 * One fact, three derivations: SKILL_REFS_OUTPUT_DIR below is composed from it,
 * the installer decides which skill install triggers the reference overlay from
 * it, and the init summary renders `prefixSkillName()` of it. Retyped at each of
 * those three sites, moving the references to another skill would mean finding
 * all three spellings with nothing failing if only two were found — the PF-013
 * shape, a hardcoded spelling that still resolves.
 *
 * Bare, not `devflow:`-prefixed: the build writes to `dist/skills/git/…` while
 * the install target is `skills/devflow:git/`. prefixSkillName is what spans that
 * gap, and it is applied at the install sites rather than baked in here.
 */
export const SKILL_REFS_SKILL_NAME = 'git';

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
export const SKILL_REFS_OUTPUT_DIR = `dist/skills/${SKILL_REFS_SKILL_NAME}/references`;

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
 * the message and its assertion from one edit (PF-018 — the expectation must
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
export const TRACKER_OPS = [
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

/**
 * The GitHub provider's operation set — the SAME list, under the name that reads
 * correctly at a GitHub-scoped call site.
 *
 * An alias, not a copy, and both names are load-bearing:
 *
 *   - {@link TRACKER_OPS} is the ROSTER. Every provider row in VARIANT_MODULES
 *     reads it, which is what makes AC-3.8's file-set parity a compile-time
 *     property instead of an assertion two hand-listed arrays have to keep
 *     agreeing on.
 *   - `TRACKER_GITHUB_OPS` is a PROVIDER SCOPE. Several guards genuinely mean
 *     "the ops of the GitHub path" rather than "the roster" — the byte budget's
 *     GitHub-scoped loaded-set row (D-LOADED-SET-SCOPE), the re-scoped AC-2.7
 *     arm that proves no github op file names the tool-call contract, and the
 *     containment oracle's github corpus. Reading the roster's name at those
 *     sites would say something subtly different from what they check.
 *
 * The two sets are identical today and identity is asserted by `toBe` at the
 * registration sites, so this is one list with two readings rather than a
 * synonym nobody maintains. If a provider ever needs an op the others do not,
 * this alias is where that divergence becomes visible.
 */
export const TRACKER_GITHUB_OPS = TRACKER_OPS;

/**
 * The 8 PR/review operations whose mechanics are generated once, for every
 * provider, under `pr/`.
 *
 * A PR-HOST roster, not a tracker roster, and the distinction is the whole
 * reason this list exists separately from {@link TRACKER_OPS}: pull requests, PR
 * reviews and PR checks stay on GitHub under every issue-tracker provider, so
 * these steps are the SAME file whatever `TRACKER_PROVIDER` resolves to. Filing
 * them under `tracker/github/` would make a jira user's PR mechanics read as
 * their tracker's, and fanning them across the three provider directories would
 * ship three identical trees.
 *
 * `ensure-pr-ready` is a member of BOTH rosters by design, and the two halves do
 * not overlap: the PR skeleton (branch/commit/push, create, retitle) is a PR-host
 * fact and lives here; the issue-number lookup and the link line it renders are
 * tracker facts and live in `tracker/{provider}/ensure-pr-ready.md`. The
 * operation carries one pointer to each.
 *
 * Exactly 8 entries, which is {@link MIN_VARIANT_PAIRS} exactly. That is a
 * property, not a coincidence: the module cannot be grown an operation at a time,
 * because a shorter roster makes every parity assertion over it vacuous (GAP-42,
 * the PF-018 trap) and `expandVariants` refuses the build. Dropping an op from
 * this list therefore fails the build on purpose rather than silently shrinking
 * the guard surface.
 */
export const PR_HOST_OPS = [
  'ensure-pr-ready',
  'validate-branch',
  'post-review-summary',
  'check-ci-status',
  'fetch-review-threads',
  'resolve-review-threads',
  'post-resolution-summary',
  'check-merge-readiness',
] as const;

/**
 * The destination directory the PR-host module lands under.
 *
 * Stated, exactly as {@link TRACKER_DESTINATION_ROOT} is, rather than derived
 * from the module that writes there: it is a fact about where PR mechanics live
 * in the reference tree, not something the registry can work out.
 *
 * Not to be confused with {@link PR_HOST_TRACKER_SUBDIR} (`tracker/github`),
 * which is the TRACKER directory every install carries because PR hosting is on
 * GitHub. This one is the provider-independent `pr/` directory itself — it is
 * under no provider, and every install carries it for the same reason: a jira or
 * linear user still opens pull requests.
 */
export const PR_HOST_DESTINATION_ROOT = 'pr';

/**
 * How a module's emitted filenames are decided — and therefore whether the
 * MIN_VARIANT_PAIRS floor applies to it.
 *
 * 'fanout' — one file per entry of a ROSTER (the tracker operation list). Parity
 *   assertions range over that roster, which is exactly where GAP-42 bites: a
 *   roster short enough to enumerate by hand is satisfied by any implementation
 *   that returns something, so the floor is what stops a short one being
 *   introduced.
 * 'named' — a fixed set of cross-cutting documents, each named individually at
 *   exactly one site in the agent (`references/decision-markers.md` and, later,
 *   `learn-conventions.md` / `publication-gate.md`). Nothing ranges over the set,
 *   so a floor over it would not make any assertion sharper — it would only
 *   forbid the first such document from existing. What proves these correct is
 *   splitVariantSections' bidirectional check plus the byte-budget's
 *   formula ↔ nameable-set comparison, neither of which depends on a count.
 * 'contract' — a single cross-cutting CONTRACT document whose emitted basename
 *   carries a leading underscore, marking it as not-a-provider in a directory
 *   whose other entries are providers (validateContractOutputName). Like 'named'
 *   it is exempt from the pair floor, and for the same reason: nothing ranges over
 *   it. It is a third kind rather than a flag on 'named' because the NAME RULE
 *   differs, and a kind is what makes the compiler demand the answer at the
 *   declaration site.
 */
export type VariantModuleKind = 'fanout' | 'named' | 'contract';

/** One `.mds` module that fans out into one reference file per registered name. */
export interface VariantModule {
  /** Repo-relative, POSIX-spelled source path of the module host. */
  readonly source: string;
  /**
   * POSIX sub-path under SKILL_REFS_OUTPUT_DIR that this module's files land in,
   * or `''` for files that land directly in it.
   * Every segment is validated by the same rule as an output filename, so a
   * module can no more escape the destination than a host can.
   */
  readonly subdir: string;
  /**
   * Which floor and which naming discipline this module is held to.
   * Required, not defaulted: `as const satisfies readonly VariantModule[]` on the
   * registry below makes the compiler demand the answer at the declaration site,
   * which is strictly stronger than defaulting an omission to the strict value —
   * a module lands in the 'fanout' bucket because it says so, not because a
   * field was forgotten.
   */
  readonly kind: VariantModuleKind;
  /** The names this module emits, one file each. */
  readonly ops: readonly string[];
}

/**
 * The cross-cutting `devflow:git` reference documents — provider-independent, so
 * they land at the root of the references directory rather than under
 * `tracker/{provider}/`.
 *
 * `decision-markers` holds the D1–D3 / D5–D10 rows of the agent's Decision Marker
 * Legend. The D4 and D11 rows are the ONLY definitions of labels whose controls
 * are always-loaded, so they stay inline in the agent (E10 / AC-2.13); the rest
 * are glossary entries a reader consults, not rules a spawn must have.
 *
 * `learn-conventions` holds that operation's bounded scan and its untrusted-string
 * discipline. It is GENERATED rather than hand-authored on purpose [DR-15]: the
 * Phase-3 Tracker agent NAMES this file instead of copying the block, so the
 * bounded-scan literals and the post-composition verbatim-match check never exist
 * in a second, independently maintained copy outside the single-authority corpus.
 *
 * `publication-gate` holds the D10 step order. It is named from the two summary
 * operations and from nowhere else, which is the scope property [DR-20] asserts:
 * an operation that can load the gate is an operation that probes repo visibility.
 */
export const GIT_CROSS_CUTTING_DOCS = [
  'decision-markers',
  'learn-conventions',
  'publication-gate',
] as const;

/**
 * Every reference module the build knows about — a closed registry, read the
 * same way ALLOWED_OUTPUT_DIRS is read.
 *
 * A `skill-refs` host whose source path is absent from this table is refused by
 * the build rather than guessed at: the emitted filenames come from the op list,
 * not from the module's own basename, so there is nothing to fall back to.
 *
 * Every provider row reads the ONE shared {@link TRACKER_OPS} roster, so the three
 * providers below emit the same file set by construction — file-set parity is a
 * compile-time property rather than an assertion two hand-listed arrays have to
 * keep agreeing on.
 *
 * Registering a provider whose `subdir` is one of MCP_BACKED_PROVIDER_SUBDIRS is
 * also what opens the generation gate on the tool-call contract; see
 * {@link mcpContractIsGenerated}. There is no second edit and no flag.
 */
export const VARIANT_MODULES = [
  {
    source: 'src/assets/mds/tracker/_github.mds',
    subdir: 'tracker/github',
    kind: 'fanout',
    ops: TRACKER_GITHUB_OPS,
  },
  {
    source: 'src/assets/mds/tracker/_jira.mds',
    subdir: 'tracker/jira',
    kind: 'fanout',
    ops: TRACKER_OPS,
  },
  {
    source: 'src/assets/mds/tracker/_linear.mds',
    subdir: 'tracker/linear',
    kind: 'fanout',
    ops: TRACKER_OPS,
  },
  {
    source: 'src/assets/mds/git/_pr.mds',
    subdir: PR_HOST_DESTINATION_ROOT,
    kind: 'fanout',
    ops: PR_HOST_OPS,
  },
  {
    source: 'src/assets/mds/git/_references.mds',
    subdir: '',
    kind: 'named',
    ops: GIT_CROSS_CUTTING_DOCS,
  },
] as const satisfies readonly VariantModule[];

// ---------------------------------------------------------------------------
// The tool-call contract module, and the gate on its generation
// (hazard H7, conflict C5)
// ---------------------------------------------------------------------------

/**
 * The tracker provider destinations whose mechanics reach the tracker through a
 * TOOL CALL rather than through a CLI — the condition the contract document's
 * generation is keyed on.
 *
 * `tracker/github` is deliberately absent: GitHub's mechanics are `gh` commands,
 * and a gate keyed on "any tracker module is registered" would already be open.
 *
 * Spelled as DESTINATIONS rather than provider names so the gate is a fact about
 * the registry: a provider module is registered with the subdir its files land
 * in, so opening the gate and shipping the provider are the same edit. A boolean
 * field on VariantModule would have been a flag someone has to remember to flip,
 * which is the same class of defect as a floor nobody raises.
 */
export const MCP_BACKED_PROVIDER_SUBDIRS = ['tracker/jira', 'tracker/linear'] as const;

/** The destination directory every tracker provider module lands under. */
export const TRACKER_DESTINATION_ROOT = 'tracker';

/**
 * The tracker destination every install carries, whatever the user selected.
 *
 * Not a default and not a fallback: PR hosting stays on GitHub under every
 * issue-tracker provider, so a jira or linear user still runs `gh pr` mechanics
 * and still needs the GitHub tree reachable. It is the FLOOR of
 * {@link installedReferenceManifest}'s union.
 *
 * Stated rather than derived, because the fact is about where pull requests
 * live, not about anything the registry knows. A derivation from "the one
 * CLI-backed module" would read as a rule and silently promote the next
 * CLI-backed provider into everyone's install.
 */
export const PR_HOST_TRACKER_SUBDIR = `${TRACKER_DESTINATION_ROOT}/github`;

/**
 * The provider-independent tool-call contract document.
 *
 * GENERATED only while {@link mcpContractIsGenerated} is true — that is, only
 * while a provider that reaches its tracker through a tool call is registered.
 * The gate is not a phase marker; it is the answer to "does anyone load this?",
 * and it stays answerable in both directions:
 *
 *   - Open, as it is whenever a tool-call provider is registered: every such
 *     provider's per-operation mechanics NAME this document, so it must exist or
 *     those references point at a file the install does not carry.
 *   - Shut, as it is for a registry with GitHub alone: no reachable consumer
 *     exists, and generating it anyway would bill every GitHub user for a
 *     reference nothing they can reach ever loads (GAP-02). The byte-budget
 *     formula carries it as a term that is 0 on the GitHub path for exactly that
 *     reason, and the re-scoped AC-2.7 arm proves no github op file names it.
 *
 * It lands at the `tracker/` ROOT rather than inside a provider directory: it is
 * provider-independent, and a copy per provider is the duplication it exists to
 * remove. The `_` prefix is what distinguishes it from the provider directories
 * beside it (validateContractOutputName).
 */
export const MCP_CONTRACT_MODULE = {
  source: 'src/assets/mds/tracker/_mcp.mds',
  subdir: 'tracker',
  kind: 'contract',
  ops: ['_mcp'],
} as const satisfies VariantModule;

/**
 * Does this registry contain a provider that needs the tool-call contract?
 *
 * The whole gate, in one derived predicate: registering a provider module in an
 * MCP-backed sub-directory is what starts the contract being generated, with no
 * second edit anywhere and no declaration to keep in step.
 */
export function mcpContractIsGenerated(
  modules: readonly VariantModule[] = VARIANT_MODULES,
): boolean {
  const gated: readonly string[] = MCP_BACKED_PROVIDER_SUBDIRS;
  return modules.some(mod => gated.includes(mod.subdir));
}

/** A conditionally-generated reference module, paired with the gate that opens it. */
export interface GatedReferenceModule {
  /** The module appended to the registry while its gate is open. */
  readonly module: VariantModule;
  /** Does this registry contain something that needs {@link GatedReferenceModule.module}? */
  readonly isGenerated: (modules: readonly VariantModule[]) => boolean;
}

/**
 * Every reference module whose GENERATION is conditional, each beside the
 * predicate that answers for it.
 *
 * ONE table, read by both halves of the mechanism: {@link resolveVariantModules}
 * appends the modules whose predicate says yes, and
 * {@link GATED_REFERENCE_MODULE_SOURCES} is this table's source column. A module
 * added here therefore reaches the resolver and the gated roster in the same
 * edit. Naming the module inline in the resolver and again in the roster is how
 * a roster and the code that produces it come to disagree the first time a
 * second one is added — the same defect {@link deferredReferenceModuleSources}
 * exists to keep out of its two callers.
 */
export const GATED_REFERENCE_MODULES: readonly GatedReferenceModule[] = [
  { module: MCP_CONTRACT_MODULE, isGenerated: mcpContractIsGenerated },
];

/**
 * The registry the build actually expands: {@link VARIANT_MODULES} plus every
 * gated module whose own gate is open.
 *
 * Idempotent — resolving an already-resolved list appends nothing. Without that,
 * a caller that resolved twice would hand expandVariants two rows for one source
 * and get a `duplicate-output` refusal describing a bug it could not locate.
 *
 * Each predicate is asked about the registry AS PASSED, never about the list the
 * loop is building, so a gate can never be opened by a module an earlier gate
 * appended.
 *
 * @param modules - Registry to resolve (defaults to VARIANT_MODULES). Injectable
 *   so both sides of every gate are provable against a registry that never has to
 *   exist on disk.
 */
export function resolveVariantModules(
  modules: readonly VariantModule[] = VARIANT_MODULES,
): readonly VariantModule[] {
  let resolved: readonly VariantModule[] = modules;
  for (const gated of GATED_REFERENCE_MODULES) {
    if (!gated.isGenerated(modules)) continue;
    if (resolved.some(mod => mod.source === gated.module.source)) continue;
    resolved = [...resolved, gated.module];
  }
  return resolved;
}

/**
 * Every reference-module source whose GENERATION is conditional — the sources
 * {@link resolveVariantModules} may or may not include.
 *
 * The build reads this to tell the two reasons a module is absent from the
 * resolved registry apart: an UNREGISTERED reference module is an authoring
 * mistake and is refused with a message naming the registry, while one listed
 * here is authored-but-gated and is reported as deferred. Without the
 * distinction the gated case would take the refusal path and no gated module
 * could ever exist.
 *
 * Derived from {@link GATED_REFERENCE_MODULES} — the same table
 * {@link resolveVariantModules} loops over — rather than hand-listed beside it: a
 * second module added to that table is on this roster by construction, and there
 * is no second place to remember.
 */
export const GATED_REFERENCE_MODULE_SOURCES: readonly string[] =
  GATED_REFERENCE_MODULES.map(gated => gated.module.source);

/**
 * The gated reference modules this registry does NOT generate — the build's
 * "deferred" bucket, as a derived set.
 *
 * ONE authority for a question two callers ask. `scripts/build-mds.ts` asks it
 * per walked file to decide whether to defer or compile; the packaging and
 * printed-count guards ask it for the whole registry to know what the build must
 * have reported. Both spelled the predicate inline while there was exactly one
 * gated module and exactly one answer, which is how a roster and the code that
 * produces it come to disagree the first time the answer changes.
 *
 * With a tool-call provider registered the set is EMPTY, and that is the honest
 * reading rather than a missing roster: the one gated module has a consumer, so
 * nothing is held back. The guards therefore assert the build printed zero
 * deferred modules, and prove the predicate still has teeth by asking it about a
 * registry with every such provider removed.
 *
 * @param modules - Registry to measure (defaults to VARIANT_MODULES). Injectable
 *   so the non-empty arm is provable without unregistering a shipped provider.
 */
export function deferredReferenceModuleSources(
  modules: readonly VariantModule[] = VARIANT_MODULES,
): readonly string[] {
  const active = new Set(resolveVariantModules(modules).map(mod => mod.source));
  return GATED_REFERENCE_MODULE_SOURCES.filter(source => !active.has(source));
}

/**
 * The floor a FAN-OUT module's pair list must clear.
 *
 * 8 is not a tuning knob: below it the "every op has a file and every file has
 * an op" parity assertions stop discriminating, because a list short enough to
 * be enumerated by hand is satisfied by any implementation that returns
 * something (GAP-42). Raising it is allowed; lowering it is the exact evasion
 * §14.5's no-threshold-lowered rule exists to prevent.
 *
 * It applies per module, and only to `kind: 'fanout'` modules — see
 * VariantModuleKind for why a count proves nothing about a named document set.
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
  | { kind: 'too-few-pairs'; module: string; count: number; minimum: number }
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
  modules: readonly VariantModule[] = resolveVariantModules(),
): Result<VariantPair[], VariantExpansionError> {
  if (modules.length === 0) return Err({ kind: 'no-modules' });

  const pairs: VariantPair[] = [];
  const claimedBy = new Map<string, string[]>();

  for (const mod of modules) {
    if (mod.ops.length === 0) return Err({ kind: 'empty-module', module: mod.source });

    // `''` means "land in the destination directory itself" — there is no segment
    // to validate, and splitting it would produce one empty segment that every
    // name rule rejects. Any other value is validated segment by segment.
    if (mod.subdir !== '') {
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
    }

    if (mod.kind === 'fanout' && mod.ops.length < MIN_VARIANT_PAIRS) {
      // `module` like every sibling arm: the floor is PER MODULE, so a bare count
      // leaves a reader of the refusal with no way to tell which registry entry is
      // short — the omission typescript-02 names.
      return Err({
        kind: 'too-few-pairs',
        module: mod.source,
        count: mod.ops.length,
        minimum: MIN_VARIANT_PAIRS,
      });
    }

    for (const op of mod.ops) {
      // A 'contract' module's basename carries a mandatory leading underscore;
      // every other kind's is refused one. Dispatching on the kind keeps ONE name
      // rule per kind, rather than one relaxed rule that both kinds share and
      // neither is fully described by.
      const nameResult = mod.kind === 'contract'
        ? validateContractOutputName(op)
        : validateOutputName(op);
      if (!nameResult.ok) {
        return Err({ kind: 'invalid-op-name', module: mod.source, op, cause: nameResult.error });
      }
      const relPath = mod.subdir === '' ? `${op}.md` : `${mod.subdir}/${op}.md`;
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

  return Ok(pairs);
}

/**
 * Every reference file the build generates, as POSIX paths relative to
 * {@link SKILL_REFS_OUTPUT_DIR} — the manifest an installer converges to.
 *
 * Derived from the resolved registry above (VARIANT_MODULES plus the gated
 * contract module, carrying TRACKER_OPS once per provider and
 * GIT_CROSS_CUTTING_DOCS) through the same expandVariants the build plan uses.
 * Hand-listing the operations here would create a second
 * roster that drifts silently the moment one is added — the bidirectional-registry
 * rule compliance-compose.ts states for its token tables.
 *
 * Lives beside the registry it reads rather than in the Claude Code installer that
 * consumes it: nothing about the answer is Claude-Code-specific, and the packaging
 * and containment tests that read it are asking the BUILD what it emits, not
 * asking an install target (applies ADR-013).
 *
 * Asserts where its siblings return a Result. The registry is a compile-time
 * constant, so a refusal is a programming error rather than an install-time
 * degradation: no caller could sensibly continue, and every caller would otherwise
 * carry the same impossible branch. The full refusal is rendered and not just its
 * `kind` — the payload is what names the offending module and op, and a payload
 * nothing reads is a payload nothing maintains (avoids PF-041). Same rendering the
 * build's own refusal sinks use (scripts/build-mds.ts).
 */
export function generatedReferenceManifest(): readonly string[] {
  const expanded = expandVariants();
  if (!expanded.ok) {
    throw new Error(
      `Reference module registry does not expand — ${JSON.stringify(expanded.error)}. ` +
      `VARIANT_MODULES in src/core/mds-variants.ts is invalid.`,
    );
  }
  return expanded.value.map(pair => pair.relPath);
}

/**
 * The references ONE install carries, for one resolved tracker provider — the
 * narrower manifest the overlay converges to.
 *
 * D-INSTALL-SET: the BUILD emits every provider ({@link generatedReferenceManifest},
 * 34 files) because the tarball must be able to serve any selection without a
 * rebuild. An INSTALL carries `{github} ∪ {selected provider}`:
 *
 *   - the GitHub tree is the FLOOR under every provider, not an optional extra.
 *     PR hosting stays on GitHub whatever the issue tracker is, so those
 *     mechanics stay reachable for a jira or linear user;
 *   - the cross-cutting documents (`subdir: ''`) are provider-independent and
 *     always land;
 *   - the PR-host tree ({@link PR_HOST_DESTINATION_ROOT}) is provider-independent
 *     for the same reason the GitHub tree is a floor — pull requests, PR reviews
 *     and PR checks stay on GitHub under every issue tracker — but it sits under
 *     no provider directory, so it is named here rather than reached through the
 *     provider union;
 *   - a provider directory the user did not select is 11 files nothing they can
 *     reach ever loads (applies ADR-003 — ship the end state, not every state).
 *
 * `tracker/_mcp.md` rides the same gate its GENERATION does
 * ({@link MCP_BACKED_PROVIDER_SUBDIRS}): it is the transport contract for
 * providers reached by tool call, and GitHub's mechanics are `gh` commands. One
 * predicate, asked of the selection here and of the registry in
 * {@link mcpContractIsGenerated}, so opening the gate and shipping the provider
 * stay the same edit.
 *
 * Derived from the registry rather than a provider table: a provider registered
 * with a `tracker/{id}` subdir is installable by construction, and a literal
 * here would be a second roster to keep in step with VARIANT_MODULES.
 *
 * Asserts rather than degrades on a registry that does not expand, exactly as
 * its sibling does (design review M3): the registry is a compile-time constant,
 * so a refusal is a programming error rather than an install-time degradation —
 * no caller could sensibly continue, and every caller would otherwise carry the
 * same impossible branch.
 *
 * @param opts.provider - The resolved tracker provider id, used as the
 *   `tracker/{id}` sub-directory key.
 * @param opts.modules - Registry to expand (defaults to the shipped one).
 *   Injectable so both the refusal arm and a provider set this build does not
 *   produce are provable without editing the registry.
 */
export function installedReferenceManifest(opts: {
  readonly provider: string;
  readonly modules?: readonly VariantModule[];
}): readonly string[] {
  const modules = opts.modules ?? resolveVariantModules();
  const expanded = expandVariants(modules);
  if (!expanded.ok) {
    throw new Error(
      `Reference module registry does not expand — ${JSON.stringify(expanded.error)}. ` +
      `VARIANT_MODULES in src/core/mds-variants.ts is invalid.`,
    );
  }

  const providerSubdir = `${TRACKER_DESTINATION_ROOT}/${opts.provider}`;
  const wanted = new Set(['', PR_HOST_DESTINATION_ROOT, PR_HOST_TRACKER_SUBDIR, providerSubdir]);

  const installed = expanded.value
    .filter(pair => wanted.has(subdirOfRelPath(pair.relPath)))
    .map(pair => pair.relPath);

  const gated: readonly string[] = MCP_BACKED_PROVIDER_SUBDIRS;
  if (gated.includes(providerSubdir)) {
    const contract = contractRelPath(expanded.value);
    if (contract !== undefined) installed.push(contract);
  }

  return installed;
}

/** The directory part of a manifest-relative path; `''` for a file at the root. */
function subdirOfRelPath(relPath: string): string {
  const cut = relPath.lastIndexOf('/');
  return cut < 0 ? '' : relPath.slice(0, cut);
}

/**
 * The tool-call contract's emitted path, as this registry expands it — read from
 * the expansion rather than composed from the module's fields, so the name can
 * only ever be the one the build actually writes.
 *
 * Takes the already-expanded pairs rather than re-expanding: the caller has
 * already validated the same registry expands cleanly, so a second call would
 * only duplicate that work and reintroduce a refusal branch that can never fire.
 */
function contractRelPath(pairs: readonly VariantPair[]): string | undefined {
  return pairs.find(pair => pair.module === MCP_CONTRACT_MODULE.source)?.relPath;
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
 *
 * The optional leading `_` mirrors validateContractOutputName, and widening the
 * capture here costs nothing: this regex is NOT a containment gate. It recognises
 * a plumbing comment inside a source file, and the name it captures is then
 * checked against the caller's own registry (`unknown-section`), so a marker
 * naming something unregistered is refused whatever its spelling. The gate on
 * what may become a PATH is validateOutputName / validateContractOutputName,
 * which run over the registry, not over the file.
 */
export const VARIANT_SECTION_MARKER_RE = /^<!-- op: (_?[a-z0-9][a-z0-9._-]{0,63}) -->[ \t]*$/;

export type SectionSplitError =
  | { kind: 'no-sections'; expected: readonly string[] }
  | { kind: 'unknown-section'; op: string; expected: readonly string[] }
  | { kind: 'duplicate-section'; op: string }
  | { kind: 'missing-section'; ops: readonly string[] }
  | { kind: 'empty-section'; op: string };

/** The minimum a caller's record must say for a section to be found for it. */
export interface OperationNamed {
  /** The operation whose section this record wants. */
  readonly op: string;
}

/**
 * A caller's own record, handed back with the section that belongs to it.
 *
 * The content travels WITH the record rather than in a lookup structure beside
 * it, and that is what puts the splitter's post-condition in the type instead of
 * in a comment: on success there is exactly one of these per record the caller
 * passed in, in the caller's own order, and every one of them carries a
 * `content`. A caller never has to ask "is there a section for this op?" — it
 * reads a field off the record it already had. A `Map<string, string>` could not
 * say that: it is both mutable and partial, so a call site would have to spend a
 * non-null assertion claiming a guarantee that lives nowhere in the type.
 */
export type VariantSection<T extends OperationNamed> = T & { readonly content: string };

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
 * Total on success, and immutable: the caller gets back a readonly array of its
 * OWN records, in its own order, each carrying its section. Nothing is looked up
 * afterwards, so no consumer can be handed `undefined` for an operation the
 * registry declared, and no consumer holds a handle it could write through.
 *
 * @param body - The module's compiled output, steering block already stripped.
 * @param entries - The caller's records, one per operation the registry says this
 *   module emits, each naming its operation in `op`. Taking the caller's records
 *   rather than a bare op list is what lets the result carry each operation's
 *   destination back to it structurally, with no index correspondence to trust.
 */
export function splitVariantSections<T extends OperationNamed>(
  body: string,
  entries: readonly T[],
): Result<readonly VariantSection<T>[], SectionSplitError> {
  const ops = entries.map(entry => entry.op);
  const lines = body.split('\n');
  const sections = new Map<string, string[]>();
  const expected = new Set(ops);
  let current: string[] | null = null;

  for (const line of lines) {
    const match = VARIANT_SECTION_MARKER_RE.exec(line);
    if (match !== null) {
      const op = match[1];
      if (!expected.has(op)) return Err({ kind: 'unknown-section', op, expected: ops });
      if (sections.has(op)) return Err({ kind: 'duplicate-section', op });
      // The buffer itself is what the scan carries forward, not the op name it is
      // filed under, so appending a line is never a second partial lookup.
      current = [];
      sections.set(op, current);
      continue;
    }
    // Text before the first marker is module-level preamble and is dropped: it
    // belongs to no operation, so shipping it would duplicate it into every file.
    if (current === null) continue;
    current.push(line);
  }

  if (sections.size === 0) return Err({ kind: 'no-sections', expected: ops });

  // Pair every entry with its collected section, recording the entries the body
  // never covered. Parity is decided in full before any content is judged, so a
  // body that is both short and empty-in-places still reports missing-section —
  // the omission, which is the larger fact.
  const paired: Array<{ readonly entry: T; readonly collected: readonly string[] }> = [];
  const missing: string[] = [];
  for (const entry of entries) {
    const collected = sections.get(entry.op);
    if (collected === undefined) missing.push(entry.op);
    else paired.push({ entry, collected });
  }
  if (missing.length > 0) return Err({ kind: 'missing-section', ops: missing });

  const out: VariantSection<T>[] = [];
  for (const { entry, collected } of paired) {
    const trimmed = collected.join('\n').trim();
    if (trimmed.length === 0) return Err({ kind: 'empty-section', op: entry.op });
    out.push({ ...entry, content: `${trimmed}\n` });
  }
  return Ok(out);
}
