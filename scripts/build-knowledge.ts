#!/usr/bin/env npx tsx
/**
 * Build-time knowledge command compilation script
 *
 * Compiles `.mds` command files from shared/knowledge/ into Markdown command files
 * in the appropriate plugin commands/ directories. Uses an explicit source→plugin map
 * (not a glob) — a missing source file or unknown/missing plugin destination exits
 * non-zero with a clear message.
 *
 * Partials (basename starts with `_`) are never outputs; they are imported by host files.
 *
 * Per-file clean: before compiling each file, removes only the mapped destination .md —
 * never wipes a whole directory.
 *
 * Hard-fails the entire build on any compile error, ensuring a broken or stale command
 * never ships. Errors are reported with the mds::* code, message, and source span.
 *
 * Usage: npm run build:knowledge
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { init, compileFile, isMdsError } from "@mdscript/mds";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const KNOWLEDGE_DIR = path.join(ROOT, "shared", "knowledge");

/**
 * Explicit source→plugin destination map.
 * Key: basename of .mds file in shared/knowledge/ (without extension)
 * Value: relative path from ROOT to the destination plugin commands/ directory
 */
const SOURCE_TO_PLUGIN_MAP: Record<string, string> = {
  "implement": "plugins/devflow-implement/commands",
  "plan": "plugins/devflow-plan/commands",
  "resolve": "plugins/devflow-resolve/commands",
  "code-review": "plugins/devflow-code-review/commands",
  "self-review": "plugins/devflow-self-review/commands",
  "research": "plugins/devflow-research/commands",
  "bug-analysis": "plugins/devflow-bug-analysis/commands",
  "explore": "plugins/devflow-explore/commands",
  "debug": "plugins/devflow-debug/commands",
};

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

async function compileKnowledgeFile(
  sourcePath: string,
  destDir: string
): Promise<CompileOutcome> {
  const basename = path.basename(sourcePath, ".mds");
  const dest = path.join(destDir, `${basename}.md`);

  // Per-file clean: remove only the mapped destination — never wipe the whole directory
  if (fs.existsSync(dest)) {
    fs.rmSync(dest);
  }

  const result = await compileFile(sourcePath);
  fs.writeFileSync(dest, result.output, "utf-8");

  return {
    source: path.relative(ROOT, sourcePath),
    dest: path.relative(ROOT, dest),
    warnings: result.warnings,
  };
}

async function main(): Promise<void> {
  console.log("Building knowledge commands...\n");

  // Validate shared/knowledge/ exists
  if (!fs.existsSync(KNOWLEDGE_DIR)) {
    console.error(`ERROR: shared/knowledge/ directory not found at ${KNOWLEDGE_DIR}`);
    process.exit(1);
  }

  // Initialize the MDS compiler (required before any compile/check call)
  await init();

  // Validate each source file exists and each destination directory exists
  const validationErrors: string[] = [];

  for (const [basename, destRelDir] of Object.entries(SOURCE_TO_PLUGIN_MAP)) {
    const sourcePath = path.join(KNOWLEDGE_DIR, `${basename}.mds`);
    if (!fs.existsSync(sourcePath)) {
      validationErrors.push(
        `Missing source file: shared/knowledge/${basename}.mds`
      );
    }

    const destDir = path.join(ROOT, destRelDir);
    if (!fs.existsSync(destDir)) {
      validationErrors.push(
        `Missing plugin destination directory: ${destRelDir} (plugin not installed or commands/ dir absent)`
      );
    }
  }

  if (validationErrors.length > 0) {
    for (const err of validationErrors) {
      console.error(`  ERROR: ${err}`);
    }
    console.error(
      `\n${validationErrors.length} validation error(s) — build FAILED. Ensure all source files exist and plugin directories are present.`
    );
    process.exit(1);
  }

  const entries = Object.entries(SOURCE_TO_PLUGIN_MAP);
  console.log(`  ${entries.length} command(s) to compile:\n`);

  // Compile each command — hard-fail on any error
  const outcomes: CompileOutcome[] = [];
  const errors: string[] = [];

  for (const [basename, destRelDir] of entries) {
    const sourcePath = path.join(KNOWLEDGE_DIR, `${basename}.mds`);
    const destDir = path.join(ROOT, destRelDir);

    try {
      const outcome = await compileKnowledgeFile(sourcePath, destDir);
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
      const formatted = formatMdsError(err, sourcePath);
      errors.push(formatted);
      console.error(`  FAILED:   ${basename}.mds`);
      console.error(`    ${formatted}`);
    }
  }

  const totalWarnings = outcomes.reduce((n, o) => n + o.warnings.length, 0);
  console.log(
    `\nKnowledge: ${outcomes.length} compiled, ${errors.length} error(s), ${totalWarnings} warning(s)`
  );

  if (errors.length > 0) {
    console.error(
      `\n${errors.length} compile error(s) — build FAILED. Fix the mds::* errors above before shipping.`
    );
    process.exit(1);
  }

  console.log("\nKnowledge commands build complete!");
}

main().catch((err) => {
  // Hard-fail on any error escaping main() (e.g. init() or readdir failure) —
  // a broken or stale command must never ship.
  console.error(
    `\nFATAL: knowledge build aborted — ${err instanceof Error ? err.message : String(err)}`
  );
  process.exit(1);
});
