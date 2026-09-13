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
 * Two host kinds. The destination allowlist in src/core/mds-variants.ts tags each
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
 * Both strips run AFTER compileFile: the compiler emits a frontmatter block at
 * byte offset 0 verbatim (it is never interpolated), so block 1 survives
 * compilation unchanged and is removed from the compiled bytes.
 *
 * Dest safety: `output-dir` must resolve to one of the two allowlisted
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
 * deleted (pruneOrphanAgents). That directory is gitignored and outranks
 * src/assets/agents/ in both the installer's resolve and loadShippedDefaults's
 * merge, so a file left there is installed in preference to the audited source on
 * every `devflow init`. The parity check in build.test.ts catches the same orphan
 * in CI, a commit later; this removes it on the machine that ran the build.
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
  AGENTS_OUTPUT_DIR,
  type HostVariant,
  type OutputDirError,
  type OutputNameError,
} from "../src/core/mds-variants.js";

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

interface DiscoveryResult {
  hosts: HostEntry[];
  /** Total .mds files seen, including partials (files without output-dir:). */
  totalCount: number;
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
  let totalCount = 0;
  for (const file of walkMds(ROOT)) {
    totalCount++;
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
  return { hosts, totalCount };
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

/** Where a host will write, and how its compiled frontmatter will be treated. */
interface HostPlan {
  variant: HostVariant;
  /** Resolved absolute destination directory. */
  outAbs: string;
  /** Resolved absolute destination file. */
  dest: string;
}

/**
 * Resolve where a host will write — without writing anything.
 *
 * Separated from the write so every destination in the build is known before the
 * first byte lands: two hosts claiming one destination is only detectable across
 * hosts, and detecting it after a write has happened is too late to prevent the
 * overwrite it describes. Every refusal is thrown so main() aggregates it and
 * exits once.
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

  // Filename safety: the name that will be emitted is validated before it is
  // joined onto the destination, so no host can write outside outAbs.
  const declaredName = host.outputName ?? host.basename;
  const nameResult = validateOutputName(declaredName);
  if (!nameResult.ok) {
    throw outputNameRefusal(rel, declaredName, nameResult.error);
  }

  return { variant, outAbs, dest: path.join(outAbs, `${nameResult.value}.md`) };
}

async function compileHost(host: HostEntry, plan: HostPlan): Promise<CompileOutcome> {
  const { variant, outAbs, dest } = plan;

  // Auto-create only the final destination leaf.
  fs.mkdirSync(outAbs, { recursive: true });

  const result = await compileFile(host.file);
  // Generator hosts shed their whole steering block; command hosts shed only the
  // output-dir: key so every other byte of their frontmatter is preserved.
  const cleaned = stripFrontmatterFor(variant, result.output, host.file);

  // Atomic write: write to a temp file then rename into place so concurrent
  // readers (e.g. ambient.test.ts running in a parallel vitest worker) never
  // observe a missing file between the old and new content. (avoids PF-011)
  // Clean up the .tmp on rename failure so no orphan is left behind.
  const tmp = tempPathFor(dest);
  fs.writeFileSync(tmp, cleaned, "utf-8");
  try {
    fs.renameSync(tmp, dest);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw e;
  }

  return {
    source: path.relative(ROOT, host.file),
    dest: path.relative(ROOT, dest),
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
  const agentsAbs = path.resolve(ROOT, AGENTS_OUTPUT_DIR);

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(agentsAbs, { withFileTypes: true });
  } catch (err) {
    // Absent until a generator host exists — nothing to prune, not a failure.
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return [];
    throw err;
  }

  const pruned: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const full = path.join(agentsAbs, entry.name);
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

  const { hosts, totalCount } = discoverHosts();

  if (hosts.length === 0) {
    console.error(
      "ERROR: No MDS host files discovered. " +
      "Ensure .mds host files (src/assets/commands/, src/assets/agents/) declare " +
      "output-dir: in their frontmatter.",
    );
    process.exit(1);
  }

  const partialCount = totalCount - hosts.length;
  console.log(`  ${partialCount} partial(s) skipped (no output-dir:)`);
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
      const claimants = claims.get(plan.dest);
      if (claimants === undefined) {
        claims.set(plan.dest, [host]);
      } else {
        claimants.push(host);
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
    if (contested.has(plan.dest)) continue;
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
  // claimed set is complete and anything else in dist/agents/ is stale.
  for (const rel of pruneOrphanAgents(new Set(planned.map(p => p.plan.dest)))) {
    console.log(`  pruned:   ${rel} (no generator host)`);
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
