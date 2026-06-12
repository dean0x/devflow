#!/usr/bin/env npx tsx
/**
 * Build-time recipe compilation script
 *
 * Compiles `.mds` recipe files from shared/recipes/ into Markdown command files
 * in plugins/devflow-dynamic/commands/. Partials (basename starts with `_`) are
 * skipped — they have no command output of their own.
 *
 * Hard-fails the entire build on any compile error, ensuring a broken or stale
 * command never ships. Errors are reported with the mds::* code, message, and
 * source span for quick diagnosis.
 *
 * Usage: npm run build:recipes
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { init, compileFile, isMdsError } from "@mdscript/mds";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RECIPES_DIR = path.join(ROOT, "shared", "recipes");
const OUTPUT_DIR = path.join(ROOT, "plugins", "devflow-dynamic", "commands");

interface CompileOutcome {
  source: string;
  dest: string;
  warnings: string[];
}

function isPartial(basename: string): boolean {
  return basename.startsWith("_");
}

async function compileRecipe(sourcePath: string): Promise<CompileOutcome> {
  const result = await compileFile(sourcePath);
  const dest = path.join(OUTPUT_DIR, `${path.basename(sourcePath, ".mds")}.md`);
  fs.writeFileSync(dest, result.output, "utf-8");
  return {
    source: path.relative(ROOT, sourcePath),
    dest: path.relative(ROOT, dest),
    warnings: result.warnings,
  };
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

async function main(): Promise<void> {
  console.log("Building recipes...\n");

  // Validate shared/recipes/ exists
  if (!fs.existsSync(RECIPES_DIR)) {
    console.error(`ERROR: shared/recipes/ directory not found at ${RECIPES_DIR}`);
    process.exit(1);
  }

  // Ensure output directory exists
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // Initialize the MDS compiler (required before any compile/check call)
  await init();

  // Discover .mds files in shared/recipes/ (non-recursive — flat directory)
  const entries = fs.readdirSync(RECIPES_DIR, { withFileTypes: true });
  const recipeFiles = entries
    .filter((e) => e.isFile() && e.name.endsWith(".mds"))
    .map((e) => path.join(RECIPES_DIR, e.name));

  const commands = recipeFiles.filter((f) => !isPartial(path.basename(f)));
  const partials = recipeFiles.filter((f) => isPartial(path.basename(f)));

  console.log(`  ${partials.length} partial(s) skipped: ${partials.map((p) => path.basename(p)).join(", ") || "none"}`);
  console.log(`  ${commands.length} command(s) to compile: ${commands.map((c) => path.basename(c)).join(", ") || "none"}\n`);

  if (commands.length === 0) {
    console.log("No commands to compile.");
    console.log("\nRecipes build complete!");
    return;
  }

  // Compile each command — hard-fail on any error
  const outcomes: CompileOutcome[] = [];
  const errors: string[] = [];

  for (const sourcePath of commands) {
    try {
      const outcome = await compileRecipe(sourcePath);
      outcomes.push(outcome);

      const warnNote = outcome.warnings.length > 0 ? ` (${outcome.warnings.length} warning(s))` : "";
      console.log(`  compiled: ${outcome.source} → ${outcome.dest}${warnNote}`);

      for (const w of outcome.warnings) {
        console.warn(`    WARNING: ${w}`);
      }
    } catch (err) {
      const formatted = formatMdsError(err, sourcePath);
      errors.push(formatted);
      console.error(`  FAILED:   ${path.basename(sourcePath)}`);
      console.error(`    ${formatted}`);
    }
  }

  const totalWarnings = outcomes.reduce((n, o) => n + o.warnings.length, 0);
  console.log(
    `\nRecipes: ${outcomes.length} compiled, ${partials.length} partials skipped, ${errors.length} error(s), ${totalWarnings} warning(s)`
  );

  if (errors.length > 0) {
    console.error(
      `\n${errors.length} compile error(s) — build FAILED. Fix the mds::* errors above before shipping.`
    );
    process.exit(1);
  }

  console.log("\nRecipes build complete!");
}

main();
