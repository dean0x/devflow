#!/usr/bin/env npx tsx
/**
 * Unified MDS command compilation script
 *
 * Discovers every `.mds` file in the repo (walked to a bounded depth — see
 * MAX_WALK_DEPTH) that declares a non-empty `output-dir:`
 * frontmatter key and compiles it to `{output-dir}/{name}.md`. Files without
 * `output-dir:` are treated as partials and skipped (they are imported by hosts).
 * The emitted name is the source basename unless the host declares
 * `output-name:`, in which case that value is used. The key says what it does:
 * it names one output file. It performs no templating and no expansion, which is
 * what `name-template:` would promise and what src/core/mds-variants.ts
 * explicitly disclaims — that spelling stays free for Phase 2.
 *
 * Hard-fails the entire build on any compile error, ensuring a broken or stale
 * command never ships. Errors are reported with the mds::* code, message, and
 * source span for quick diagnosis.
 *
 * Three host kinds. The destination allowlist in src/core/mds-variants.ts tags each
 * directory with the host variant it selects, and resolveOutputDir hands that tag
 * back with the resolved path — so this script dispatches on a discriminant it
 * was given, never on a destination it re-derived:
 *
 *   - Command hosts (`output-dir: dist/commands`, variant `commands`) declare
 *     their build keys inside their single, real frontmatter block. Only the
 *     build-owned keys are stripped (stripBuildKeys), so every other key keeps
 *     its bytes exactly. BUILD_KEYS is the one list of keys the build both reads
 *     and strips: a key the build consumes is a build directive, never part of
 *     the shipped artifact, and deriving the strip from the same list means a
 *     newly-read key cannot leak into dist/.
 *
 *   - Generator hosts (`output-dir: dist/agents`, variant `agents`) carry TWO
 *     leading frontmatter blocks: block 1 exists only to steer the build, block 2
 *     is the artifact's real frontmatter. The whole of block 1 is stripped after compilation
 *     (stripGeneratorFrontmatter), leaving block 2 — which the MDS compiler
 *     treats as ordinary body text — as the artifact's frontmatter, with the
 *     blank line that follows it preserved. The two-block shape is checked on
 *     BOTH ends: a leading block must be present before the slice, and a second
 *     block must be present after it. Without the post-condition a single-block
 *     host — the shape every hand-authored agent has — silently loses its whole
 *     frontmatter and ships headerless with the build reporting success.
 *
 *   - Reference modules (`output-dir: dist/skills/git/references`, variant
 *     `skill-refs`) carry ONE leading steering block and fan out: the stripped
 *     body is a concatenation of per-operation sections, each introduced by a
 *     `<!-- op: NAME -->` line, and the build writes one file per section to
 *     `{output-dir}/{subdir}/{op}.md`. The op roster and the subdir come from the
 *     VARIANT_MODULES registry in src/core/mds-variants.ts, never from the
 *     module's basename — so `output-name:` is refused here, and a module absent
 *     from the registry is refused rather than guessed at. The split is
 *     bidirectional: a section for an unregistered op and a registered op with no
 *     section both fail the build, as does a section with an empty body.
 *
 * All three strips run AFTER compileFile: the compiler emits a frontmatter block at
 * byte offset 0 verbatim (it is never interpolated), so block 1 survives
 * compilation unchanged and is removed from the compiled bytes.
 *
 * Dest safety: `output-dir` must resolve to one of the three allowlisted
 * directories (src/core/mds-variants.ts). A typo, a backslash spelling, a
 * non-canonical spelling, or a path that escapes the repo root is refused rather
 * than silently writing to an unexpected location. The emitted filename is
 * validated by the same module before it is joined onto the destination, and
 * every host's destination is resolved in a plan pass that runs to completion
 * before the first byte is written — so two hosts claiming one destination are
 * caught while dist/ is still untouched, instead of the later one silently
 * overwriting the earlier one's artifact.
 *
 * One exit: every refusal — dest, filename, destination collision, or compile
 * error — is thrown and aggregated by main(), which reports all of them and
 * exits 1 once, after the loop. No refusal abandons the hosts that follow it, so
 * dist/ is never left half-updated with a mix of fresh and stale artifacts. The
 * exception is a malformed build key (an `output-dir:` or `output-name:` with no
 * value), which is refused during discovery — before any host is planned or
 * written, so an immediate exit leaves dist/ wholly untouched.
 *
 * Atomic write: each output is written to a temp file then renamed into place, so
 * concurrent readers (e.g. parallel vitest workers) never observe a missing file.
 *
 * Prune: after a clean build, every `.md` in dist/agents/ that no host emitted is
 * deleted (pruneOrphanAgents), and the same sweep runs recursively over
 * dist/skills/git/references/ (pruneOrphanReferences). dist/agents/ is gitignored
 * and outranks src/assets/agents/ in both the installer's resolve and
 * loadShippedDefaults's merge, so a file left there is installed in preference to
 * the audited source on every `devflow init`; the references tree is gitignored
 * too and is overlaid wholesale onto the installed skill, so a file left there
 * installs as if the build still produced it. The parity check in build.test.ts
 * catches the same orphan in CI, a commit later; this removes it on the machine
 * that ran the build.
 *
 * Usage: npm run build:mds
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { init, compileFile, isMdsError } from "@mdscript/mds";
import {
  validateOutputName,
  resolveOutputDir,
  expandVariants,
  splitVariantSections,
  AGENTS_OUTPUT_DIR,
  SKILL_REFS_OUTPUT_DIR,
  VARIANT_MODULES,
  resolveVariantModules,
  deferredReferenceModuleSources,
  type HostVariant,
  type OutputDirError,
  type OutputNameError,
  type VariantModule,
  type VariantPair,
} from "../src/core/mds-variants.js";
import { MAX_REFERENCE_SWEEP_DEPTH } from "../src/core/reference-sweep.js";

// DEVFLOW_MDS_ROOT overrides the repo root for tests that need to operate on a
// temporary directory instead of the real src/assets/commands/ tree.
// Tests that exercise build failure paths (wrong output-dir, empty output-dir)
// must never write into the real tree — that would race against packaging tests.
const ROOT = process.env['DEVFLOW_MDS_ROOT']
  ? path.resolve(process.env['DEVFLOW_MDS_ROOT'])
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Directories skipped during the whole-repo walk.
 *
 * `tests` and `coverage` are ignored so that a .mds file committed under either
 * can never be compiled into the real dist/ tree: a .mds there is a fixture or a
 * coverage artifact, never a shipped host, and discovery has no other way to
 * tell the two apart. The skip is by directory NAME, so it holds under
 * DEVFLOW_MDS_ROOT too — a fixture host planted at `<tmpRoot>/tests/` is
 * likewise invisible to the walk, which is the same rule and not an exception
 * to it.
 */
const IGNORE_DIRS = new Set([
  "node_modules",
  "dist",
  ".git",
  ".devflow",
  ".claude",
  ".release",
  "tmp",
  "tests",
  "coverage",
]);

interface HostEntry {
  file: string;
  outputDir: string;
  /** Source basename, used as the output name when no output-name: is declared. */
  basename: string;
  /** Declared `output-name:` value, or null when the key is absent. */
  outputName: string | null;
}

interface CompileOutcome {
  source: string;
  dest: string;
  warnings: string[];
}

function formatMdsError(err: unknown, sourcePath: string): string {
  if (isMdsError(err)) {
    const span = err.span
      ? ` [line ${err.span.line ?? "?"}:${err.span.column ?? "?"}]`
      : "";
    const help = err.help ? `\n  help: ${err.help}` : "";
    return `${err.code}${span}: ${err.message}${help}\n  file: ${path.relative(ROOT, sourcePath)}`;
  }
  return String(err);
}

/**
 * Maximum directory depth the walk descends, counting ROOT as depth 0.
 *
 * The shipped tree needs far less: the deepest .mds lives at depth 4
 * (src/assets/commands/_partials/) and the deepest directory under src/assets/
 * at all is depth 6 (src/assets/skills/compliance/frameworks/<id>/), so 12
 * leaves roughly double the headroom any plausible layout requires.
 *
 * It is a bound that fails, not a filter that truncates. A host skipped for
 * being too deep compiles nothing while the build still prints its counts and
 * exits 0 — the artifact is simply missing, and no test can see the difference
 * between "not there" and "never looked" (avoids PF-018). Exceeding the bound
 * therefore throws, naming the bound and the offending directory.
 */
const MAX_WALK_DEPTH = 12;

/**
 * Yield every *.mds file under dir, skipping IGNORE_DIRS.
 *
 * Bounded by MAX_WALK_DEPTH so the recursion has a fixed upper bound like every
 * other loop in the project — a directory cycle (symlink loop) or a runaway
 * tree fails loudly instead of spinning. ENOENT/ENOTDIR on readdir is tolerated:
 * the entry can vanish or turn out not to be a directory between the parent's
 * readdir and this call. Every other error is rethrown.
 */
function* walkMds(dir: string, depth = 0): Generator<string> {
  if (depth > MAX_WALK_DEPTH) {
    throw new Error(
      `${path.relative(ROOT, dir) || dir}: directory nesting exceeds the walk bound of ` +
      `${MAX_WALK_DEPTH} levels — a .mds host at or below this depth would never be ` +
      `discovered. Move it shallower, or raise MAX_WALK_DEPTH in scripts/build-mds.ts.`,
    );
  }

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return;
    throw err;
  }

  for (const entry of entries) {
    if (IGNORE_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkMds(full, depth + 1);
    } else if (entry.isFile() && entry.name.endsWith(".mds")) {
      yield full;
    }
  }
}

/**
 * The leading `---…---` frontmatter block: the whole block in match[0], its
 * inner text in match[1].
 *
 * One constant, two readers — frontmatterBlock takes the inner text, and
 * stripGeneratorFrontmatter takes the block's length — so the shape of a
 * frontmatter block is defined once in this file rather than drifting between
 * them. No `g`/`y` flag, so the shared RegExp object carries no lastIndex state
 * between calls.
 */
const LEADING_BLOCK_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/;

/** Extract the raw `---…---` frontmatter block, or null if absent. */
function frontmatterBlock(text: string): string | null {
  const match = LEADING_BLOCK_RE.exec(text);
  return match ? match[1] : null;
}

/**
 * Frontmatter keys the build itself consumes — all literal `[a-z-]` names.
 *
 * One list, two duties: every key here is read out of a host's frontmatter
 * (readFrontmatterKey) AND removed from a command host's compiled frontmatter
 * (stripBuildKeys). Tying the strip to the read list is what keeps a build
 * directive from shipping inside the artifact it directed — adding a key to this
 * list makes it both readable and stripped in the same edit.
 */
const BUILD_KEYS = ["output-dir", "output-name"] as const;
type BuildKey = (typeof BUILD_KEYS)[number];

/**
 * Read a build-owned scalar key from a frontmatter block.
 *
 * Deliberately a scalar regex, not a YAML parse: the build must not gain a YAML
 * dependency, and every key it reads is a plain single-line string.
 *
 * Returns the raw (untrimmed) value when the key is present — including an empty
 * string when the key is present but has no value (`output-dir:` with nothing
 * after the colon). Returns null only when the key is genuinely absent, which is
 * how a partial is distinguished from a host, and how an absent `output-name:`
 * falls back to the source basename. A present-but-empty value is a host with a
 * malformed key and is hard-failed by the caller for every build key, per the
 * discovery contract.
 */
function readFrontmatterKey(block: string, key: BuildKey): string | null {
  const match = new RegExp(`^${key}:[ \\t]*(.*?)[ \\t]*$`, "m").exec(block);
  return match ? match[1] : null;
}

/**
 * Strip every BUILD_KEYS line from compiled command-host output.
 *
 * Operates on the FIRST `---…---` block only. Removes each build-owned key line
 * using a block-scoped regex and cleans up any resulting double blank line.
 * Leaves `description:`, `argument-hint:`, and all other keys byte-untouched
 * (no YAML round-trip, so `|`, `[]`, em-dashes are preserved exactly).
 *
 * The key list is BUILD_KEYS itself rather than a second, hand-maintained list:
 * a key the build reads out of the frontmatter is a directive to the build, and
 * shipping it inside the artifact leaks build plumbing into a deployed command.
 */
function stripBuildKeys(compiled: string): string {
  return compiled.replace(
    /^(---\r?\n)([\s\S]*?)(^---\r?\n)/m,
    (_match, open, body, close) => {
      let stripped: string = body;
      for (const key of BUILD_KEYS) {
        stripped = stripped.replace(new RegExp(`^${key}:[ \\t]*.*(\\r?\\n|$)`, "m"), "");
      }
      // Remove a trailing blank line that stripping may leave inside the block.
      const cleaned = stripped.replace(/\n{2,}$/, "\n");
      return open + cleaned + close;
    },
  );
}

/**
 * Strip the entire leading `---…---` block from compiled generator-host output.
 *
 * A generator host's block 1 exists only to steer the build; block 2 is the
 * artifact's real frontmatter, which the compiler emitted as ordinary body text
 * (only a block at byte offset 0 is treated as frontmatter). Removing block 1
 * promotes block 2 into place with the blank line after it intact.
 *
 * Both ends of the transform are verified, because a delete-a-block transform
 * that checks only one end fails silently on the other:
 *
 *   - PRE: a leading block must exist. That cannot happen for a discovered host
 *     — discovery found `output-dir:` in exactly this block — so its absence
 *     means the compiler moved bytes it was expected to emit verbatim.
 *   - POST: a SECOND block must be what the slice exposes. Nothing about a host
 *     forces it to have two blocks, and a single-block host is not exotic: it is
 *     the shape every hand-authored agent has, so it is exactly what an author
 *     converting an agent into a generator host is most likely to write. Without
 *     this check that host's whole frontmatter (name:, description:, model:) is
 *     deleted, the remaining body still looks like a plausible agent file, and
 *     the build reports success.
 *
 * Either failure fails the build rather than shipping a headerless artifact.
 */
function stripGeneratorFrontmatter(compiled: string, sourcePath: string): string {
  const rel = path.relative(ROOT, sourcePath);
  const match = LEADING_BLOCK_RE.exec(compiled);
  if (!match) {
    throw new Error(
      `${rel}: generator host output has no leading frontmatter block to strip`,
    );
  }

  const promoted = compiled.slice(match[0].length);
  if (!/^---\r?\n/.test(promoted)) {
    throw new Error(
      `${rel}: generator host output has no second frontmatter block — a generator host must ` +
      `declare TWO leading frontmatter blocks: block 1 steers the build (output-dir:), block 2 ` +
      `is the artifact's own frontmatter and is all that survives the strip. Stripping the only ` +
      `block here would ship an agent with no frontmatter.`,
    );
  }
  return promoted;
}

/**
 * Strip the leading steering block from a compiled reference-module output.
 *
 * A reference module's block 1 steers the build exactly as a generator host's
 * does, but what it must leave behind is the opposite shape: a skill reference
 * ships as plain markdown with NO frontmatter, because it is read as prose by an
 * agent that already has its own header.
 *
 * Both ends are verified, for the same reason stripGeneratorFrontmatter verifies
 * both (PF-061):
 *   - PRE: a leading block must exist — discovery found `output-dir:` in exactly
 *     this block, so its absence means the compiler moved bytes it emits verbatim.
 *   - POST: a SECOND block must NOT be what the slice exposes. An author copying
 *     the generator-host shape writes two blocks out of habit; without this check
 *     the second block ships as the opening lines of every emitted reference and
 *     an agent reads `output-dir:` as content.
 */
function stripReferenceFrontmatter(compiled: string, sourcePath: string): string {
  const rel = path.relative(ROOT, sourcePath);
  const match = LEADING_BLOCK_RE.exec(compiled);
  if (!match) {
    throw new Error(
      `${rel}: reference module output has no leading frontmatter block to strip`,
    );
  }

  const body = compiled.slice(match[0].length);
  if (/^---\r?\n/.test(body)) {
    throw new Error(
      `${rel}: reference module output has a SECOND frontmatter block — a reference module ` +
      `declares exactly ONE leading block (the build's steering block), and everything after it ` +
      `ships as plain markdown. A second block would be emitted as the opening lines of every ` +
      `generated reference.`,
    );
  }
  return body;
}

interface DiscoveryResult {
  hosts: HostEntry[];
  /** Total .mds files seen, including partials (files without output-dir:). */
  totalCount: number;
  /**
   * Reference modules that declare an output directory but whose registry row is
   * GATED SHUT this build — repo-relative source paths, for the printed line.
   *
   * A third bucket rather than a silent skip and rather than a refusal. Silent
   * would make an authored-but-ungenerated contract indistinguishable from one
   * the build cannot see; a refusal is what the un-gated path already does and is
   * wrong here, because "registered as gated, gate closed" is a legitimate state
   * the plan mandates (P3a-S12) rather than an authoring mistake. Counting them
   * as PARTIALS would have been the worst of the three: a partial is a file with
   * no output-dir:, and these declare one.
   */
  deferred: string[];
}

/**
 * Walk the repo and return all host entries (files declaring output-dir:) plus
 * the total .mds count.
 *
 * A build key that is present but valueless is a malformed host, not a default:
 * readFrontmatterKey returns `''` rather than null for a bare `output-name:`, so
 * `?? basename` would not fire and the fallback would look like it had. Falling
 * back silently would hide the authoring mistake behind a plausible filename, so
 * both keys hard-fail here with the same message shape.
 *
 * Discovery precedes every plan and every write, so exiting here leaves dist/
 * wholly untouched — unlike a mid-loop exit, which is why plan- and compile-phase
 * refusals are aggregated instead.
 */
function discoverHosts(): DiscoveryResult {
  const hosts: HostEntry[] = [];
  const deferred: string[] = [];
  // The registry as it stands for THIS build, gates applied. Resolved once so
  // every host is measured against the same answer.
  // The gated modules this registry does not generate, from the one owner that
  // answers that question (src/core/mds-variants.ts). Computed once so every
  // walked file is measured against the same answer.
  const gatedShut = new Set(deferredReferenceModuleSources());
  let totalCount = 0;
  for (const file of walkMds(ROOT)) {
    totalCount++;
    const rel = path.relative(ROOT, file).split(path.sep).join("/");
    // A reference module the registry knows about but whose gate is shut this
    // build is DEFERRED at discovery, before it can become a HostEntry. Deciding
    // it here rather than in the plan pass keeps HostPlan's arms describing only
    // hosts that will be written, so no downstream dispatch grows a "planned but
    // not emitted" case it would have to carry forever.
    if (gatedShut.has(rel)) {
      deferred.push(rel);
      continue;
    }
    const text = fs.readFileSync(file, "utf-8");
    const block = frontmatterBlock(text);
    if (!block) continue;
    const outputDir = readFrontmatterKey(block, "output-dir");
    if (outputDir === null) continue;
    if (outputDir.trim() === "") {
      console.error(`ERROR: ${path.relative(ROOT, file)}: output-dir: is empty — must be a non-empty path`);
      process.exit(1);
    }
    const outputName = readFrontmatterKey(block, "output-name");
    if (outputName !== null && outputName.trim() === "") {
      console.error(
        `ERROR: ${path.relative(ROOT, file)}: output-name: is empty — must be a non-empty filename, ` +
        `or omit the key to emit the source basename`,
      );
      process.exit(1);
    }
    hosts.push({
      file,
      outputDir: outputDir.trim(),
      basename: path.basename(file, ".mds"),
      outputName: outputName === null ? null : outputName.trim(),
    });
  }
  return { hosts, totalCount, deferred };
}

/**
 * Render an `output-dir:` refusal as the error the build throws.
 *
 * One arm per OutputDirError kind, with a `never` default: a kind added to the
 * union in the core module cannot fall through into a message that does not
 * describe it. Each arm returns an Error rather than exiting, so main()'s
 * aggregation owns the single exit and a refusal never abandons the hosts that
 * follow it (which would leave dist/ half-updated).
 */
function outputDirRefusal(rel: string, declared: string, error: OutputDirError): Error {
  switch (error.kind) {
    case "escapes-root":
      return new Error(`${rel}: output-dir '${declared}' escapes the repo root`);
    case "backslash-separator":
      return new Error(
        `${rel}: output-dir '${declared}' uses a backslash separator — declare it with ` +
        `forward slashes, as '${error.allowed.join("' or '")}' — typo?`,
      );
    case "non-canonical":
      return new Error(
        `${rel}: output-dir '${declared}' is not spelled canonically — ` +
        `write '${error.canonical}' instead (expected '${error.allowed.join("' or '")}') — typo?`,
      );
    case "not-allowlisted":
      return new Error(
        `${rel}: output-dir '${declared}' is not the expected '${error.allowed.join("' or '")}' — typo?`,
      );
    default: {
      const unhandled: never = error;
      return new Error(`${rel}: unhandled output-dir refusal ${JSON.stringify(unhandled)}`);
    }
  }
}

/**
 * Render an emitted-filename refusal as the error the build throws.
 *
 * Same shape as outputDirRefusal: one arm per OutputNameError kind, a `never`
 * default, and a thrown Error so the refusal is aggregated rather than exiting
 * mid-loop. Every message names the kind, so the reason is readable without
 * cross-referencing the core module.
 */
function outputNameRefusal(rel: string, declared: string, error: OutputNameError): Error {
  const prefix = `${rel}: output filename '${declared}' is not a valid output filename`;
  switch (error.kind) {
    case "empty":
      return new Error(`${prefix} (empty) — a host must emit a non-empty name`);
    case "dot-segment":
      return new Error(`${prefix} (dot-segment) — '.' and '..' segments are refused`);
    case "path-separator":
      return new Error(`${prefix} (path-separator) — the name must not contain a path separator`);
    case "invalid-charset":
      return new Error(`${prefix} (invalid-charset) — must match [a-z0-9][a-z0-9._-]{0,63}`);
    default: {
      const unhandled: never = error;
      return new Error(`${rel}: unhandled output filename refusal ${JSON.stringify(unhandled)}`);
    }
  }
}

/**
 * The staging path a destination is written through before being renamed into
 * place.
 *
 * Scoped to the writing process: two builds running at once (the test suite
 * spawns the real build from more than one file, and vitest runs files in
 * parallel workers) would otherwise share one `<dest>.tmp`, and the first
 * rename would pull the file out from under the second, failing it with ENOENT.
 * The rename onto `dest` stays atomic either way.
 */
function tempPathFor(dest: string): string {
  return `${dest}.${process.pid}.tmp`;
}

/**
 * Apply the frontmatter strip the host's variant calls for.
 *
 * The variant travels with the resolved destination (resolveOutputDir), so the
 * allowlist in src/core/mds-variants.ts remains the only place that knows which
 * directory means which treatment. The `never` default means a third variant
 * cannot silently inherit the command-host strip.
 */
function stripFrontmatterFor(variant: HostVariant, compiled: string, sourcePath: string): string {
  switch (variant) {
    case "agents":
      return stripGeneratorFrontmatter(compiled, sourcePath);
    case "skill-refs":
      return stripReferenceFrontmatter(compiled, sourcePath);
    case "commands":
      return stripBuildKeys(compiled);
    default: {
      const unhandled: never = variant;
      throw new Error(
        `${path.relative(ROOT, sourcePath)}: unhandled host variant '${String(unhandled)}'`,
      );
    }
  }
}

/** One file a reference module will emit: where it goes, and what it carries. */
interface PlannedReference {
  /** Resolved absolute destination. */
  readonly dest: string;
  /** The (module, op) pair whose section becomes this file's content. */
  readonly pair: VariantPair;
}

/**
 * Where a host will write, and how its compiled frontmatter will be treated.
 *
 * Discriminated on `variant`, because the two planning strategies do not produce
 * the same shape: a one-file host has exactly one destination and no operation,
 * while a `skill-refs` module has one destination PER operation and each is
 * meaningless without the pair that fills it. A single flat record would have to
 * express that as an optional field and an index-alignment convention, which the
 * compiler cannot enforce — so materializeOutputs would compensate at runtime for
 * a shape that should never have typechecked.
 *
 * The pairing is structural here: `PlannedReference` carries its dest and its
 * pair in one object, so there is no parallel-array correspondence to maintain,
 * and no arm can be read for a field the other arm owns. Callers that want the
 * uniform "every file this host claims" view — the plan pass's claims loop, the
 * contested filter, the prune's claimed set — go through destsOf().
 */
type HostPlan =
  | {
      readonly variant: Exclude<HostVariant, "skill-refs">;
      /** Resolved absolute destination directory. */
      readonly outAbs: string;
      /** The single file this host emits, resolved absolute. */
      readonly dest: string;
    }
  | {
      readonly variant: "skill-refs";
      /** Resolved absolute destination directory. */
      readonly outAbs: string;
      /** One entry per registered operation, in registry order. */
      readonly outputs: readonly PlannedReference[];
    };

/**
 * Every file a plan claims, whichever arm it is.
 *
 * The plan pass's contested-destination check is the one place that must see all
 * three variants alike: a fanned-out file left outside it is a file two hosts
 * could claim with nothing to notice. Deriving the uniform view here — rather
 * than storing it on both arms — keeps the fan-out destinations inseparable from
 * the pairs that fill them.
 */
function destsOf(plan: HostPlan): readonly string[] {
  return plan.variant === "skill-refs" ? plan.outputs.map(o => o.dest) : [plan.dest];
}

/** The reference module registered for this host's source path, or null. */
function referenceModuleFor(host: HostEntry): VariantModule | null {
  const rel = path.relative(ROOT, host.file).split(path.sep).join("/");
  return resolveVariantModules().find(m => m.source === rel) ?? null;
}

/**
 * Plan a one-file host: the `commands` and `agents` variants, which emit exactly
 * one artifact named after the source (or after its `output-name:`).
 */
function planSingleFile(
  host: HostEntry,
  rel: string,
  variant: Exclude<HostVariant, "skill-refs">,
  outAbs: string,
): HostPlan {
  // Filename safety: the name that will be emitted is validated before it is
  // joined onto the destination, so no host can write outside outAbs.
  const declaredName = host.outputName ?? host.basename;
  const nameResult = validateOutputName(declaredName);
  if (!nameResult.ok) {
    throw outputNameRefusal(rel, declaredName, nameResult.error);
  }

  return { variant, outAbs, dest: path.join(outAbs, `${nameResult.value}.md`) };
}

/**
 * Plan a reference module: the `skill-refs` variant, which fans one source out
 * into one artifact per registered operation.
 *
 * A separate function from planSingleFile because it is a separate strategy, not
 * a branch of one: its names come from a registry rather than from the source,
 * it has two refusals the one-file path has no analogue for, and it produces a
 * different plan arm. Inlined beside the single-file path, one function would
 * carry two return shapes and every reader would pay for both.
 */
function planReferenceModule(host: HostEntry, rel: string, outAbs: string): HostPlan {
  // A reference module's emitted names come from the op registry, never from
  // its own basename — `_github` would not even pass validateOutputName. So
  // output-name: has nothing to name here and is refused rather than ignored:
  // a key that is read on two variants and silently dropped on the third is
  // exactly the authoring trap the empty-value refusal above exists to avoid.
  if (host.outputName !== null) {
    throw new Error(
      `${rel}: output-name: is not valid on a reference module — the emitted filenames come ` +
      `from the module's operation registry in src/core/mds-variants.ts. Remove the key.`,
    );
  }

  const mod = referenceModuleFor(host);
  if (mod === null) {
    throw new Error(
      `${rel}: declares output-dir '${SKILL_REFS_OUTPUT_DIR}' but is not registered in ` +
      `VARIANT_MODULES (src/core/mds-variants.ts). A reference module's outputs come from that ` +
      `registry; there is no basename fallback. Add the module, or change its output-dir.`,
    );
  }

  const expansion = expandVariants([mod]);
  if (!expansion.ok) {
    throw new Error(`${rel}: variant expansion refused — ${JSON.stringify(expansion.error)}`);
  }

  const outputs = expansion.value.map(pair => ({
    dest: path.resolve(outAbs, ...pair.relPath.split("/")),
    pair,
  }));
  // Belt-and-braces containment: every segment was validated by
  // validateOutputName, so this cannot fire — which is why it is an assertion
  // rather than a diagnosis. A path that escapes outAbs must never be written.
  for (const { dest } of outputs) {
    if (!dest.startsWith(outAbs + path.sep)) {
      throw new Error(`${rel}: expanded destination '${dest}' escapes '${outAbs}'`);
    }
  }

  return { variant: "skill-refs", outAbs, outputs };
}

/**
 * Resolve where a host will write — without writing anything.
 *
 * Separated from the write so every destination in the build is known before the
 * first byte lands: two hosts claiming one destination is only detectable across
 * hosts, and detecting it after a write has happened is too late to prevent the
 * overwrite it describes. Every refusal is thrown so main() aggregates it and
 * exits once.
 *
 * Dispatch only: the variant travels with the resolved destination, and each
 * variant's strategy owns its own refusals and its own plan arm. The `never`
 * default is the same friction stripFrontmatterFor imposes — a fourth variant
 * cannot silently inherit a strategy written for another.
 */
function planHost(host: HostEntry): HostPlan {
  const rel = path.relative(ROOT, host.file);

  // Dest safety: output-dir must resolve to an allowlisted directory under ROOT.
  // The decision is made by the pure core module; this shell renders the errors.
  const dirResult = resolveOutputDir(ROOT, host.outputDir);
  if (!dirResult.ok) {
    throw outputDirRefusal(rel, host.outputDir, dirResult.error);
  }
  const { variant, abs: outAbs } = dirResult.value;

  switch (variant) {
    case "skill-refs":
      return planReferenceModule(host, rel, outAbs);
    case "commands":
    case "agents":
      return planSingleFile(host, rel, variant, outAbs);
    default: {
      const unhandled: never = variant;
      throw new Error(`${rel}: unhandled host variant '${String(unhandled)}'`);
    }
  }
}

/** One file the build is about to write: where it goes and what it holds. */
interface PlannedOutput {
  dest: string;
  content: string;
}

/**
 * Turn a host's stripped compiled body into the file(s) it emits.
 *
 * For the one-file variants the body IS the artifact. For a reference module the
 * body is a concatenation of per-operation sections, split by the pure core
 * splitter — so the build never parses the module itself and the bidirectional
 * op-set check (every registered op has a section; every section is registered)
 * lives in one testable place.
 *
 * The plan's discriminant does the work, so no runtime compensation is needed:
 * the one-file arm hands over its single `dest` (no unchecked index), and the
 * fan-out arm's `outputs` carry each dest beside the pair that fills it (no
 * defaulted pair list, no index correspondence to trust).
 *
 * The split keeps that pairing rather than breaking it: each destination is
 * handed TO the splitter and comes back carrying its own content, so this
 * function performs no lookup and asserts nothing about one. The alternative —
 * a keyed result read back per op — is partial in the type however total it is
 * in fact, and would need a non-null assertion to paper over the gap.
 */
function materializeOutputs(host: HostEntry, plan: HostPlan, body: string): PlannedOutput[] {
  if (plan.variant !== "skill-refs") {
    return [{ dest: plan.dest, content: body }];
  }

  const rel = path.relative(ROOT, host.file);
  const split = splitVariantSections(
    body,
    plan.outputs.map(({ dest, pair }) => ({ dest, op: pair.op })),
  );
  if (!split.ok) {
    throw new Error(
      `${rel}: section split refused — ${JSON.stringify(split.error)}. Each operation's section ` +
      `is introduced by a '<!-- op: NAME -->' line and must carry a non-empty body.`,
    );
  }

  return split.value.map(({ dest, content }) => ({ dest, content }));
}

async function compileHost(host: HostEntry, plan: HostPlan): Promise<CompileOutcome> {
  const { variant, outAbs } = plan;

  // Auto-create only the final destination leaf.
  fs.mkdirSync(outAbs, { recursive: true });

  const result = await compileFile(host.file);
  // Generator hosts shed their whole steering block; reference modules shed it
  // too and must expose no second block; command hosts shed only the build-owned
  // keys so every other byte of their frontmatter is preserved.
  const cleaned = stripFrontmatterFor(variant, result.output, host.file);
  const outputs = materializeOutputs(host, plan, cleaned);

  // Atomic write: write to a temp file then rename into place so concurrent
  // readers (e.g. ambient.test.ts running in a parallel vitest worker) never
  // observe a missing file between the old and new content. (avoids PF-011)
  // Clean up the .tmp on rename failure so no orphan is left behind.
  for (const { dest, content } of outputs) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const tmp = tempPathFor(dest);
    fs.writeFileSync(tmp, content, "utf-8");
    try {
      fs.renameSync(tmp, dest);
    } catch (e) {
      fs.rmSync(tmp, { force: true });
      throw e;
    }
  }

  const destLabel = outputs.length === 1
    ? path.relative(ROOT, outputs[0].dest)
    : `${path.relative(ROOT, outAbs)}/ (${outputs.length} file(s))`;

  return {
    source: path.relative(ROOT, host.file),
    dest: destLabel,
    warnings: result.warnings,
  };
}

/**
 * Delete every `.md` in dist/agents/ that no host in this build emits.
 *
 * dist/agents/ is gitignored and outranks src/assets/agents/ in both the
 * installer's resolve and loadShippedDefaults's merge, so a file left behind
 * there — a renamed host's old output, a hand-dropped one — is installed in
 * preference to the audited source on every `devflow init`, with nothing in the
 * install path to notice. The build owns the directory, so it also owns removing
 * what it no longer produces; the CI parity guard catches the same orphan a
 * commit later, which is too late for a machine that only ever runs the build.
 *
 * Scoped to dist/agents/ deliberately. dist/commands/ additionally receives
 * hand-authored files copied verbatim (release.md, below), so "no host claims
 * it" does not mean "orphan" there.
 *
 * Only `.md` is considered: a concurrent build's `<dest>.<pid>.tmp` staging file
 * lives in this directory and deleting it would fail that build's rename.
 *
 * @param claimed - Absolute destination paths this build wrote.
 * @returns Repo-relative paths removed.
 */
function pruneOrphanAgents(claimed: ReadonlySet<string>): string[] {
  return pruneOrphans(path.resolve(ROOT, AGENTS_OUTPUT_DIR), claimed, false);
}

/**
 * Delete every `.md` under dist/skills/git/references/ that no reference module
 * emitted.
 *
 * Same hazard as dist/agents/, one directory over: the tree is gitignored and is
 * what the installer overlays into the user's skill directory, so a file left
 * behind — a renamed op's old output, a provider directory that left the
 * registry — is installed as if the build still produced it. Recursion is not
 * optional here: the tree is nested `tracker/{provider}/{op}.md`, and a flat
 * sweep would leave every orphan exactly where the orphans live.
 */
function pruneOrphanReferences(claimed: ReadonlySet<string>): string[] {
  return pruneOrphans(path.resolve(ROOT, SKILL_REFS_OUTPUT_DIR), claimed, true);
}

/**
 * Shared prune: remove the `.md` files under `dirAbs` that this build did not
 * write.
 *
 * Only `.md` is considered: a concurrent build's `<dest>.<pid>.tmp` staging file
 * lives in these directories and deleting it would fail that build's rename.
 * Empty directories are left in place — removing them races the same concurrent
 * build's mkdir, and an empty directory installs nothing.
 *
 * The descent is bounded like walkMds's, and for the same reason: an unbounded
 * recursion over a directory the build itself owns would spin on a symlink loop
 * instead of failing. The bound is MAX_REFERENCE_SWEEP_DEPTH, owned by
 * src/core/reference-sweep.ts and shared with the installer's sweep of the same
 * generated reference tree, so the two walkers cannot drift apart on how deep
 * the tree may be or on which `depth` is the breach. It is generous — the
 * deepest planned output sits at `tracker/{provider}/{op}.md`, two levels down.
 * Here the breach throws, because a generated tree that deep is a build bug and
 * dist/ is the build's own to fail; the installer's sweep reports it through its
 * own failure channel instead. Neither passes it over.
 */
function pruneOrphans(
  dirAbs: string,
  claimed: ReadonlySet<string>,
  recursive: boolean,
  depth = 0,
): string[] {
  if (depth > MAX_REFERENCE_SWEEP_DEPTH) {
    throw new Error(
      `${path.relative(ROOT, dirAbs) || dirAbs}: prune descent exceeds ` +
      `${MAX_REFERENCE_SWEEP_DEPTH} levels — a generated output tree should ` +
      `never be this deep.`,
    );
  }

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dirAbs, { withFileTypes: true });
  } catch (err) {
    // Absent until the first host of this kind exists — nothing to prune.
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return [];
    throw err;
  }

  const pruned: string[] = [];
  for (const entry of entries) {
    const full = path.join(dirAbs, entry.name);
    if (entry.isDirectory()) {
      if (recursive) pruned.push(...pruneOrphans(full, claimed, recursive, depth + 1));
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    if (claimed.has(full)) continue;
    fs.rmSync(full, { force: true });
    pruned.push(path.relative(ROOT, full));
  }
  return pruned;
}

async function main(): Promise<void> {
  console.log("Building MDS commands...\n");

  // Initialize the MDS compiler (required before any compile/check call).
  await init();

  const { hosts, totalCount, deferred } = discoverHosts();

  if (hosts.length === 0) {
    console.error(
      "ERROR: No MDS host files discovered. " +
      "Ensure .mds host files (src/assets/commands/, src/assets/agents/) declare " +
      "output-dir: in their frontmatter.",
    );
    process.exit(1);
  }

  // Deferred modules are subtracted explicitly: they DO declare an output-dir:,
  // so folding them into the partial count would print a number that contradicts
  // the line's own parenthetical and move a manifest-pinned count for a reason
  // that is not a roster change.
  const partialCount = totalCount - hosts.length - deferred.length;
  console.log(`  ${partialCount} partial(s) skipped (no output-dir:)`);
  console.log(`  ${deferred.length} reference module(s) deferred (generation gated)`);
  for (const rel of deferred) {
    console.log(`    deferred: ${rel} (no registered provider needs it yet)`);
  }
  console.log(`  ${hosts.length} host(s) to compile:\n`);

  const outcomes: CompileOutcome[] = [];
  const errors: string[] = [];

  /**
   * Plan pass — resolve every destination before anything is written.
   *
   * `output-name:` decouples the emitted filename from the source filename, and
   * two source directories can hold the same basename, so nothing about a host
   * guarantees its destination is unique. path.join + write is per-host and
   * knows nothing of its siblings: without this pass the later host in walk
   * order silently overwrites the earlier one's artifact, shipping one host's
   * bytes under the other's name with the build reporting success.
   */
  const claims = new Map<string, HostEntry[]>();
  const planned: Array<{ host: HostEntry; plan: HostPlan }> = [];

  const recordFailure = (label: string, message: string): void => {
    errors.push(message);
    console.error(`  FAILED:   ${label}`);
    console.error(`    ${message}`);
  };

  for (const host of hosts) {
    try {
      const plan = planHost(host);
      for (const dest of destsOf(plan)) {
        const claimants = claims.get(dest);
        if (claimants === undefined) {
          claims.set(dest, [host]);
        } else {
          claimants.push(host);
        }
      }
      planned.push({ host, plan });
    } catch (err) {
      recordFailure(path.relative(ROOT, host.file), formatMdsError(err, host.file));
    }
  }

  // A contested destination disqualifies EVERY claimant. Letting the first
  // claimant win would pick an arbitrary one of two equally-declared intents and
  // write it — the same silent overwrite, one host earlier.
  const contested = new Set<string>();
  for (const [dest, claimants] of claims) {
    if (claimants.length < 2) continue;
    contested.add(dest);
    const named = claimants.map(h => path.relative(ROOT, h.file)).join(", ");
    recordFailure(
      path.relative(ROOT, dest),
      `${path.relative(ROOT, dest)}: destination claimed by ${claimants.length} hosts — ${named}. ` +
      `Two hosts may not emit the same file; rename one, or give it a distinct output-name:. ` +
      `Neither was written.`,
    );
  }

  for (const { host, plan } of planned) {
    if (destsOf(plan).some(dest => contested.has(dest))) continue;
    try {
      const outcome = await compileHost(host, plan);
      outcomes.push(outcome);

      const warnNote =
        outcome.warnings.length > 0
          ? ` (${outcome.warnings.length} warning(s))`
          : "";
      console.log(`  compiled: ${outcome.source} → ${outcome.dest}${warnNote}`);

      for (const w of outcome.warnings) {
        console.warn(`    WARNING: ${w}`);
      }
    } catch (err) {
      recordFailure(path.relative(ROOT, host.file), formatMdsError(err, host.file));
    }
  }

  const totalWarnings = outcomes.reduce((n, o) => n + o.warnings.length, 0);
  console.log(
    `\nMDS: ${outcomes.length} compiled, ${errors.length} error(s), ${totalWarnings} warning(s)`,
  );

  if (errors.length > 0) {
    console.error(
      `\n${errors.length} compile error(s) — build FAILED. Fix the mds::* errors above before shipping.`,
    );
    process.exit(1);
  }

  // Every planned host was written (a refusal would have exited above), so the
  // claimed set is complete and anything else in these trees is stale.
  const claimedDests = new Set(planned.flatMap(p => destsOf(p.plan)));
  for (const rel of pruneOrphanAgents(claimedDests)) {
    console.log(`  pruned:   ${rel} (no generator host)`);
  }
  for (const rel of pruneOrphanReferences(claimedDests)) {
    console.log(`  pruned:   ${rel} (no reference module)`);
  }

  // Copy 1 hand-authored command file verbatim into dist/commands/
  const handAuthored = [
    path.join(ROOT, 'src', 'assets', 'commands', 'release.md'),
  ];
  const commandsDest = path.join(ROOT, 'dist', 'commands');
  fs.mkdirSync(commandsDest, { recursive: true });
  for (const src of handAuthored) {
    if (fs.existsSync(src)) {
      const dest = path.join(commandsDest, path.basename(src));
      const tmp = tempPathFor(dest);
      fs.copyFileSync(src, tmp);
      try {
        fs.renameSync(tmp, dest);
      } catch (e) {
        fs.rmSync(tmp, { force: true });
        throw e;
      }
      console.log(`  copied:  ${path.relative(ROOT, src)} → ${path.relative(ROOT, dest)}`);
    }
  }

  console.log("\nMDS commands build complete!");
}

main().catch((err) => {
  // Hard-fail on any error escaping main() (e.g. init() failure) —
  // a broken or stale command must never ship.
  console.error(
    `\nFATAL: MDS build aborted — ${err instanceof Error ? err.message : String(err)}`,
  );
  process.exit(1);
});
