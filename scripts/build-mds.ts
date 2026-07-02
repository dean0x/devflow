#!/usr/bin/env npx tsx
/**
 * Unified MDS command compilation script
 *
 * Discovers every `.mds` file in the repo that declares a non-empty `output-dir:`
 * frontmatter key and compiles it to `{output-dir}/{basename}.md`. Files without
 * `output-dir:` are treated as partials and skipped (they are imported by hosts).
 *
 * Hard-fails the entire build on any compile error, ensuring a broken or stale
 * command never ships. Errors are reported with the mds::* code, message, and
 * source span for quick diagnosis.
 *
 * Dest safety: the parent directory of `output-dir` (the plugin directory) must
 * already exist — if it does not, the build exits 1 with a "typo?" message. Only
 * the final `commands/` leaf is auto-created. This catches `output-dir` typos
 * before they silently write to unexpected locations.
 *
 * Per-file clean: before writing each output, removes only the specific dest file —
 * never wipes a whole directory. A deleted source whose stale compiled output was
 * previously gitignored will be caught by the build.test.ts parity check.
 *
 * Usage: npm run build:mds
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { init, compileFile, isMdsError } from "@mdscript/mds";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Directories skipped during the whole-repo walk. */
const IGNORE_DIRS = new Set([
  "node_modules",
  "dist",
  ".git",
  ".devflow",
  ".claude",
  ".release",
  "tmp",
]);

interface HostEntry {
  file: string;
  outputDir: string;
  basename: string;
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

/**
 * Read the `output-dir:` value from a frontmatter block.
 *
 * Returns the raw (untrimmed) value when the key is present — including an empty
 * string when the key is present but has no value (`output-dir:` with nothing
 * after the colon). Returns null only when the key is genuinely absent, which is
 * how a partial is distinguished from a host. The empty-value case is a host with
 * a malformed key and is hard-failed by the caller, per the discovery contract.
 */
function readOutputDir(block: string): string | null {
  const match = /^output-dir:[ \t]*(.*?)[ \t]*$/m.exec(block);
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
    const outputDir = readOutputDir(block);
    if (outputDir === null) continue;
    if (outputDir.trim() === "") {
      console.error(`ERROR: ${path.relative(ROOT, file)}: output-dir: is empty — must be a non-empty path`);
      process.exit(1);
    }
    hosts.push({
      file,
      outputDir: outputDir.trim(),
      basename: path.basename(file, ".mds"),
    });
  }
  return { hosts, totalCount };
}

async function compileHost(host: HostEntry): Promise<CompileOutcome> {
  const outAbs = path.resolve(ROOT, host.outputDir);

  // Path-escape guard: output-dir must resolve under ROOT.
  if (!outAbs.startsWith(ROOT + path.sep) && outAbs !== ROOT) {
    throw new Error(
      `${path.relative(ROOT, host.file)}: output-dir '${host.outputDir}' escapes the repo root`,
    );
  }

  // Dest safety: the PARENT of output-dir (the plugin dir) must already exist.
  const pluginDir = path.dirname(outAbs);
  if (!fs.existsSync(pluginDir)) {
    console.error(
      `ERROR: ${path.relative(ROOT, host.file)}: output-dir parent '${path.relative(ROOT, pluginDir)}' does not exist — typo?`,
    );
    process.exit(1);
  }

  // Auto-create only the final commands/ leaf.
  fs.mkdirSync(outAbs, { recursive: true });

  const dest = path.join(outAbs, `${host.basename}.md`);

  // Per-file clean: remove only the specific dest — never wipe the directory.
  if (fs.existsSync(dest)) {
    fs.rmSync(dest);
  }

  const result = await compileFile(host.file);
  const cleaned = stripOutputDirKey(result.output);
  fs.writeFileSync(dest, cleaned, "utf-8");

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
      "ERROR: No MDS host files discovered — expected 14 hosts. " +
      "Ensure commands/*.mds files declare output-dir: in their frontmatter.",
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
