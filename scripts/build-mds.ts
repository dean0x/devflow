#!/usr/bin/env npx tsx
/**
 * Unified MDS command compilation script
 *
 * Discovers every `.mds` file in the repo that declares a non-empty `output-dir:`
 * frontmatter key and compiles it to `{output-dir}/{name}.md`. Files without
 * `output-dir:` are treated as partials and skipped (they are imported by hosts).
 * The emitted name is the source basename unless the host declares
 * `name-template:`, in which case that value is used.
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
 *     `output-dir:` inside their single, real frontmatter block. Only that key is
 *     stripped, so every other key keeps its bytes exactly (stripOutputDirKey).
 *
 *   - Generator hosts (`output-dir: dist/agents`, variant `agents`) carry TWO
 *     leading frontmatter blocks: block 1 exists only to steer the build, block 2
 *     is the artifact's real frontmatter. The whole of block 1 is stripped after compilation
 *     (stripGeneratorFrontmatter), leaving block 2 — which the MDS compiler
 *     treats as ordinary body text — as the artifact's frontmatter, with the
 *     blank line that follows it preserved.
 *
 * Both strips run AFTER compileFile: the compiler emits a frontmatter block at
 * byte offset 0 verbatim (it is never interpolated), so block 1 survives
 * compilation unchanged and is removed from the compiled bytes.
 *
 * Dest safety: `output-dir` must resolve to one of the two allowlisted
 * directories (src/core/mds-variants.ts). A typo, a backslash spelling, a
 * non-canonical spelling, or a path that escapes the repo root is refused rather
 * than silently writing to an unexpected location. The emitted filename is
 * validated by the same module before it is joined onto the destination.
 *
 * One exit: every refusal — dest, filename, or compile error — is thrown and
 * aggregated by main(), which reports all of them and exits 1 once, after the
 * loop. No refusal abandons the hosts that follow it, so dist/ is never left
 * half-updated with a mix of fresh and stale artifacts.
 *
 * Atomic write: each output is written to a temp file then renamed into place, so
 * concurrent readers (e.g. parallel vitest workers) never observe a missing file.
 * A deleted source whose stale compiled output was previously gitignored will be
 * caught by the build.test.ts parity check.
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
 * `tests` and `coverage` are ignored because the build's own test suite plants
 * .mds fixtures that declare `output-dir:`. Without the ignore they would be
 * discovered by the whole-repo walk and compiled into the real dist/ tree.
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
  /** Source basename, used as the output name when no name-template: is declared. */
  basename: string;
  /** Declared `name-template:` value, or null when the key is absent. */
  nameTemplate: string | null;
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

/** Yield every *.mds file under dir, skipping IGNORE_DIRS. */
function* walkMds(dir: string): Generator<string> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (IGNORE_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkMds(full);
    } else if (entry.isFile() && entry.name.endsWith(".mds")) {
      yield full;
    }
  }
}

/** Extract the raw `---…---` frontmatter block, or null if absent. */
function frontmatterBlock(text: string): string | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text);
  return match ? match[1] : null;
}

/** Frontmatter keys the build itself consumes. Both are literal `[a-z-]` names. */
type BuildKey = "output-dir" | "name-template";

/**
 * Read a build-owned scalar key from a frontmatter block.
 *
 * Deliberately a scalar regex, not a YAML parse: the build must not gain a YAML
 * dependency, and every key it reads is a plain single-line string.
 *
 * Returns the raw (untrimmed) value when the key is present — including an empty
 * string when the key is present but has no value (`output-dir:` with nothing
 * after the colon). Returns null only when the key is genuinely absent, which is
 * how a partial is distinguished from a host. For `output-dir:` the empty-value
 * case is a host with a malformed key and is hard-failed by the caller, per the
 * discovery contract.
 */
function readFrontmatterKey(block: string, key: BuildKey): string | null {
  const match = new RegExp(`^${key}:[ \\t]*(.*?)[ \\t]*$`, "m").exec(block);
  return match ? match[1] : null;
}

/**
 * Strip `output-dir:` from compiled output.
 *
 * Operates on the FIRST `---…---` block only. Removes the single `output-dir:`
 * line using a block-scoped regex and cleans up any resulting double blank line.
 * Leaves `description:`, `argument-hint:`, and all other keys byte-untouched
 * (no YAML round-trip, so `|`, `[]`, em-dashes are preserved exactly).
 */
function stripOutputDirKey(compiled: string): string {
  return compiled.replace(
    /^(---\r?\n)([\s\S]*?)(^---\r?\n)/m,
    (_match, open, body, close) => {
      const stripped = body.replace(/^output-dir:[ \t]*.*(\r?\n|$)/m, "");
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
 * Throws when no leading block is present. That cannot happen for a discovered
 * host — discovery found `output-dir:` in exactly this block — so its absence
 * means the compiler moved bytes it was expected to emit verbatim, which must
 * fail the build rather than ship a headerless artifact.
 */
function stripGeneratorFrontmatter(compiled: string, sourcePath: string): string {
  const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n/.exec(compiled);
  if (!match) {
    throw new Error(
      `${path.relative(ROOT, sourcePath)}: generator host output has no leading frontmatter block to strip`,
    );
  }
  return compiled.slice(match[0].length);
}

interface DiscoveryResult {
  hosts: HostEntry[];
  /** Total .mds files seen, including partials (files without output-dir:). */
  totalCount: number;
}

/** Walk the repo and return all host entries (files declaring output-dir:) plus the total .mds count. */
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
    const nameTemplate = readFrontmatterKey(block, "name-template");
    hosts.push({
      file,
      outputDir: outputDir.trim(),
      basename: path.basename(file, ".mds"),
      nameTemplate: nameTemplate === null ? null : nameTemplate.trim(),
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
      return new Error(`${rel}: output filename is empty (empty) — a host must emit a non-empty name`);
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
      return stripOutputDirKey(compiled);
    default: {
      const unhandled: never = variant;
      throw new Error(
        `${path.relative(ROOT, sourcePath)}: unhandled host variant '${String(unhandled)}'`,
      );
    }
  }
}

async function compileHost(host: HostEntry): Promise<CompileOutcome> {
  const rel = path.relative(ROOT, host.file);

  // Dest safety: output-dir must resolve to an allowlisted directory under ROOT.
  // The decision is made by the pure core module; this shell renders the errors.
  // Every refusal is thrown so main() aggregates them and exits once.
  const dirResult = resolveOutputDir(ROOT, host.outputDir);
  if (!dirResult.ok) {
    throw outputDirRefusal(rel, host.outputDir, dirResult.error);
  }
  const { variant, abs: outAbs } = dirResult.value;

  // Filename safety: the name that will be emitted is validated before it is
  // joined onto the destination, so no host can write outside outAbs.
  const declaredName = host.nameTemplate ?? host.basename;
  const nameResult = validateOutputName(declaredName);
  if (!nameResult.ok) {
    throw outputNameRefusal(rel, declaredName, nameResult.error);
  }

  // Auto-create only the final destination leaf.
  fs.mkdirSync(outAbs, { recursive: true });

  const dest = path.join(outAbs, `${nameResult.value}.md`);

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

async function main(): Promise<void> {
  console.log("Building MDS commands...\n");

  // Initialize the MDS compiler (required before any compile/check call).
  await init();

  const { hosts, totalCount } = discoverHosts();

  if (hosts.length === 0) {
    console.error(
      "ERROR: No MDS host files discovered. " +
      "Ensure src/assets/commands/*.mds files declare output-dir: in their frontmatter.",
    );
    process.exit(1);
  }

  const partialCount = totalCount - hosts.length;
  console.log(`  ${partialCount} partial(s) skipped (no output-dir:)`);
  console.log(`  ${hosts.length} host(s) to compile:\n`);

  const outcomes: CompileOutcome[] = [];
  const errors: string[] = [];

  for (const host of hosts) {
    try {
      const outcome = await compileHost(host);
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
      const formatted = formatMdsError(err, host.file);
      errors.push(formatted);
      console.error(`  FAILED:   ${host.basename}.mds`);
      console.error(`    ${formatted}`);
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
