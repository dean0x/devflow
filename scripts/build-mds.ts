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
 * Four host kinds. The destination allowlist in src/core/mds-variants.ts tags each
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
 *     Each section is then split on its compliance arms (splitSectionArms), so an
 *     arm must open and close inside one operation's section. The section with the
 *     on arms kept is the reference at its own path; the one with the off arms kept
 *     is the compliance-off reference, written under
 *     dist/compliance-off/skills/git/references/ at the same relative path.
 *
 *     The compliance-off references tree is COMPLETE, not a patch: it holds a file
 *     for every reference a compliance-off install carries
 *     (installedReferenceManifest({ compliance: false })), and a file of a module or
 *     operation with no compliance arm is a byte copy of its compliance-on file. The
 *     installer reads this one root and must never fall through to the compliance-on
 *     tree (AC-50), and a root that held only the armed files would force it to merge
 *     two. The price is a second copy of every unarmed reference in dist/, which is
 *     small text. A reference a compliance-off install omits (the posting operations
 *     and the publication gate, complianceOffOmittedRelPaths) gets no copy at all.
 *     Both trees are fixed by the manifest, so no per-file record is kept: the
 *     variant manifest below lists prompts only.
 *
 *   - Workflow skill hosts (`output-dir: dist/workflows`, variant `workflow-skill`) are
 *     the files of a skill FOLDER: one core host that becomes `SKILL.md`, beside
 *     reference hosts. D-WORKFLOW-FOLDER-BUILD: the folder registry WORKFLOW_FOLDERS in
 *     src/core/mds-variants.ts says which folder a host belongs to and which file it
 *     becomes, so a host declares only the root, `output-name:` is refused, and a host the
 *     registry does not list is refused. The core host keeps its real frontmatter
 *     (name and description are required) minus the build keys; a reference host sheds
 *     its steering block and ships with none. A folder is built as a UNIT, because its
 *     build id (D-BUILD-ID) is made from all of its files: every host is compiled, then
 *     each variant key gets a COMPLETE folder for its own file list
 *     (workflowFolderFiles), and a key that lacks a file of its list fails the build.
 *     A file a compliance-off key omits has no destination for that key (the same
 *     absent-destination pattern as a reference module's compliance-off copy). The
 *     stamp goes into the first heading of every file outside references/. The
 *     registry is empty in the shipped tree, so no folder is built and every file
 *     the other host kinds write is unchanged. The variant manifest lists prompts
 *     only and does not list a folder.
 *
 * All four strips run AFTER compileFile: the compiler emits a frontmatter block at
 * byte offset 0 verbatim (it is never interpolated), so block 1 survives
 * compilation unchanged and is removed from the compiled bytes.
 *
 * Prompt variants (D-LEARNING-VARIANTS, src/core/curation-variants.ts): after the
 * strip, a command or agent body is split on its curation and compliance markers.
 * The all-on variant is written to the host's own path. A host with a curation arm
 * also gets dist/curation-off/{commands,agents}/{name}.md, a host with a compliance
 * arm dist/compliance-off/..., and a host with both arms dist/curation-compliance-off/...
 * too. The split runs on the compiled text, so it costs no compileFile call and
 * nothing against the per-module compile-time guard. A reference module may carry
 * compliance markers, which select between its compliance-on and compliance-off
 * references (see the reference modules above), and no curation marker: that axis has
 * nothing to select there, so a curation marker is refused. None of the variant
 * trees is an output-dir a host may declare: the allowlist stays the four shipped
 * directories.
 *
 * Variant manifest: after a clean build, dist/variant-axes.json records for every
 * compiled command and agent whether it carries a curation arm and whether it
 * carries a compliance arm. It is written on every successful build, even when no
 * host has a compliance arm. It is removed before the first host is written and
 * written last, after the prunes, so a refused, crashed or interrupted build leaves none.
 *
 * Dest safety: `output-dir` must resolve to one of the four allowlisted
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
 * Prune: after a clean build, every `.md` in dist/commands/ and dist/agents/ that
 * no host emitted is deleted (pruneOrphanCommands, pruneOrphanAgents), and the same
 * sweep runs recursively over dist/skills/git/references/ (pruneOrphanReferences)
 * and each of the three variant trees (pruneOrphanVariantTree). The workflow
 * trees, one per variant key, lose every folder no registered folder names
 * (pruneOrphanWorkflowFolders) and every nested `.md` the build did not write
 * (pruneOrphanWorkflowFiles). Every sweep is keyed
 * on the files this build actually wrote. The compliance-off references sit inside
 * the compliance-off tree, so every one the build wrote is recorded as written and
 * kept, and one the build no longer writes (a reference that became a posting
 * operation, a retired operation) is pruned like any other stale file there.
 * The retired off tree (LEGACY_OFF_OUTPUT_DIR)
 * is removed whole (pruneLegacyOffTree), because no host writes there.
 * dist/agents/ is gitignored and outranks src/assets/agents/ in both the
 * installer's resolve and loadShippedAgentDefaults's merge, so a file left there is
 * installed in preference to the audited source on every `devflow init`; the
 * commands tree is installed wholesale, so a file left there installs as a command
 * no source declares; the references tree is gitignored too and is overlaid
 * wholesale onto the installed skill, so a file left there installs as if the build
 * still produced it. The parity check in build.test.ts catches the same orphan in
 * CI, a commit later; this removes it on the machine that ran the build.
 *
 * Usage: npm run build:mds
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { init, compileFile, isMdsError } from "@mdscript/mds";
import {
  validateOutputName,
  validateSkillOutputName,
  resolveOutputDir,
  expandVariants,
  splitVariantSections,
  AGENTS_OUTPUT_DIR,
  COMMANDS_OUTPUT_DIR,
  SKILL_REFS_OUTPUT_DIR,
  COMPLIANCE_OFF_SKILL_REFS_OUTPUT_DIR,
  WORKFLOW_FOLDERS,
  WORKFLOW_FOLDERS_OUTPUT_DIR,
  WORKFLOW_SKILL_ENTRY_NAME,
  WORKFLOW_SKILL_FILE,
  resolveVariantModules,
  deferredReferenceModuleSources,
  complianceOffOmittedRelPaths,
  describePostingOpsError,
  splitSectionArms,
  checkFolderBuildIds,
  checkWorkflowFolders,
  describeBuildIdCheckError,
  describeBuildStampError,
  describeWorkflowFolderError,
  findWorkflowFolderHost,
  isStampedWorkflowFile,
  parseWorkflowFolders,
  stampBuildId,
  workflowBuildId,
  workflowFolderFiles,
  workflowFolderHosts,
  workflowFolderRelPath,
  workflowFoldersRootRelPath,
  type CompiledFolderFile,
  type HostVariant,
  type OutputDirError,
  type OutputNameError,
  type SectionArmError,
  type VariantModule,
  type VariantPair,
  type WorkflowFolder,
} from "../src/core/mds-variants.js";
import { MAX_REFERENCE_SWEEP_DEPTH } from "../src/core/reference-sweep.js";
import {
  LEGACY_OFF_OUTPUT_DIR,
  OFF_OUTPUT_DIRS,
  OFF_VARIANT_KEYS,
  VARIANT_KEYS,
  VARIANT_MANIFEST_REL_PATH,
  containsCurationMarker,
  containsVariantMarker,
  describeVariantManifestError,
  describeVariantSplitError,
  emittedVariantKeys,
  renderVariantManifest,
  splitVariants,
  variantOffRelPath,
  type OffVariantKey,
  type VariantAxis,
  type VariantKey,
  type VariantManifestHost,
  type VariantSplitError,
} from "../src/core/curation-variants.js";

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
  /** Absolute path of every file this host wrote, every variant included. */
  written: string[];
  /** The prompt this host emitted and its axes, for the variant manifest; null for a reference module. */
  prompt: VariantManifestHost | null;
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
 * between "not there" and "never looked". Exceeding the bound
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
 * both:
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

/**
 * Strip the build keys from a compiled workflow skill CORE host and verify what is
 * left is a skill header.
 *
 * The core host's frontmatter is the skill's own: `SKILL.md` ships with a real
 * block, so only the build-owned keys go (stripBuildKeys, the command-host strip), and
 * every other byte of the block stays. What the strip must leave is checked, because a
 * skill with no `name:` or `description:` is not found by the loader that reads those
 * two keys, and nothing downstream of the build would say so:
 *   - PRE: a leading block must exist, or the compiler moved bytes it emits verbatim.
 *   - POST: `name:` and `description:` must each carry a value, on the key's line or
 *     on an indented line after it.
 */
function stripWorkflowCoreFrontmatter(compiled: string, sourcePath: string): string {
  const rel = path.relative(ROOT, sourcePath);
  if (!LEADING_BLOCK_RE.test(compiled)) {
    throw new Error(
      `${rel}: workflow skill core output has no leading frontmatter block — the core host ` +
      `declares ONE block holding output-dir: and the skill's own name: and description:.`,
    );
  }
  const stripped = stripBuildKeys(compiled);
  const block = frontmatterBlock(stripped) ?? "";
  for (const key of ["name", "description"]) {
    if (!new RegExp(`^${key}:[ \\t]*(\\S|\\r?\\n[ \\t]+\\S)`, "m").test(block)) {
      throw new Error(
        `${rel}: workflow skill core has no '${key}:' value in its frontmatter — SKILL.md keeps its ` +
        `real frontmatter, and a skill without name: and description: is not found by its loader.`,
      );
    }
  }
  return stripped;
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
 * Apply the frontmatter strip the host's plan calls for.
 *
 * The variant travels with the resolved destination (resolveOutputDir), so the
 * allowlist in src/core/mds-variants.ts remains the only place that knows which
 * directory means which treatment. The `never` default means a fifth variant
 * cannot silently inherit the command-host strip. A workflow skill host is stripped
 * by its role in the folder: the core keeps a real header, a reference sheds its block.
 */
function stripFrontmatterFor(plan: HostPlan, compiled: string, sourcePath: string): string {
  switch (plan.variant) {
    case "agents":
      return stripGeneratorFrontmatter(compiled, sourcePath);
    case "skill-refs":
      return stripReferenceFrontmatter(compiled, sourcePath);
    case "commands":
      return stripBuildKeys(compiled);
    case "workflow-skill":
      return plan.role === "core"
        ? stripWorkflowCoreFrontmatter(compiled, sourcePath)
        : stripReferenceFrontmatter(compiled, sourcePath);
    default: {
      const unhandled: never = plan;
      throw new Error(
        `${path.relative(ROOT, sourcePath)}: unhandled host plan ${JSON.stringify(unhandled)}`,
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
  /**
   * Where the compliance-off copy of this reference lands, resolved absolute, or null
   * for a reference a compliance-off install omits (complianceOffOmittedRelPaths).
   * Planned for every reference but NOT claimed in destsOf, for the reason a prompt's
   * offDests are not: it is written only after the split, it sits in a tree of its
   * own, and it is the path of `dest` under another root, so two modules can collide
   * on it only by colliding on `dest` first.
   */
  readonly offDest: string | null;
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
 *
 * A `workflow-skill` host is one file of a folder, so its arm is one file too: where
 * that file lands under each variant key, or null for a key whose folder omits it.
 * The folder is only complete once every host of it is compiled, so this arm is
 * built by a separate pipeline (compileWorkflowHost, settleWorkflowFolder), and the
 * two aliases below say which pipeline takes which arm.
 */
type HostPlan =
  | {
      readonly variant: Exclude<HostVariant, "skill-refs" | "workflow-skill">;
      /** Resolved absolute destination directory. */
      readonly outAbs: string;
      /** The single file this host emits, resolved absolute. */
      readonly dest: string;
      /** The validated output name, without `.md`: the host's key in the variant manifest. */
      readonly name: string;
      /**
       * Where each off variant of this host lands if the body carries an arm on the
       * axis it turns off, resolved absolute. Planned for every one-file host but NOT
       * claimed in destsOf: each is written only after the split, and each sits in a
       * tree of its own, so two hosts can collide on one only by colliding on `dest`
       * first.
       */
      readonly offDests: Readonly<Record<OffVariantKey, string>>;
    }
  | {
      readonly variant: "skill-refs";
      /** Resolved absolute destination directory. */
      readonly outAbs: string;
      /** One entry per registered operation, in registry order. */
      readonly outputs: readonly PlannedReference[];
    }
  | {
      readonly variant: "workflow-skill";
      /** Resolved absolute root of the workflow folders (dist/workflows). */
      readonly outAbs: string;
      /** The registered folder this host belongs to. */
      readonly folder: string;
      /** The compiled file inside the folder, POSIX: `SKILL.md`, `<name>.md` or `references/<name>.md`. */
      readonly file: string;
      readonly role: "core" | "reference";
      /**
       * Where this file lands under each variant key, resolved absolute, or null for a key
       * whose folder omits it (workflowFolderFiles). Planned for every key, and claimed in
       * destsOf for every key that holds the file, so two hosts naming one file of one
       * folder are caught while dist/ is still untouched.
       */
      readonly dests: Readonly<Record<VariantKey, string | null>>;
    };

/** The plans a host compiles and writes alone: a prompt (one file) or a reference module (one file per operation). */
type StandalonePlan = Exclude<HostPlan, { readonly variant: "workflow-skill" }>;

/** The plan of a host that is one file of a folder, written only once its whole folder is compiled. */
type WorkflowSkillPlan = Extract<HostPlan, { readonly variant: "workflow-skill" }>;

/**
 * Every file a plan claims, whichever arm it is.
 *
 * The plan pass's contested-destination check is the one place that must see all
 * four variants alike: a fanned-out file left outside it is a file two hosts
 * could claim with nothing to notice. Deriving the uniform view here — rather
 * than storing it on every arm — keeps the fan-out destinations inseparable from
 * the pairs that fill them. A workflow skill host claims the file it becomes under
 * every variant key that holds it, so the folder's files are covered host by host.
 */
function destsOf(plan: HostPlan): readonly string[] {
  switch (plan.variant) {
    case "skill-refs":
      return plan.outputs.map(o => o.dest);
    case "workflow-skill":
      return VARIANT_KEYS.flatMap(key => {
        const dest = plan.dests[key];
        return dest === null ? [] : [dest];
      });
    case "commands":
    case "agents":
      return [plan.dest];
    default: {
      const unhandled: never = plan;
      throw new Error(`unhandled host plan ${JSON.stringify(unhandled)}`);
    }
  }
}

/**
 * The registry this build resolves reference modules against: the shipped
 * registry plus whatever the generation gate opens, from the one owner that
 * answers that question (src/core/mds-variants.ts).
 *
 * Resolved once at module load, because the gate is a predicate over a module
 * constant: every lookup in a single build run is measured against the same
 * roster, and the plan pass reads one shared registry rather than a fresh copy
 * per walked host. discoverHosts() computes its gated-shut set once for the
 * same reason.
 */
const RESOLVED_MODULES = resolveVariantModules();

/** The reference module registered for this host's source path, or null. */
function referenceModuleFor(host: HostEntry): VariantModule | null {
  const rel = path.relative(ROOT, host.file).split(path.sep).join("/");
  return RESOLVED_MODULES.find(m => m.source === rel) ?? null;
}

/**
 * The variable a test sets to hand the build a workflow folder registry, as JSON.
 *
 * D-WORKFLOW-FOLDER-FIXTURE-REGISTRY: the shipped registry (WORKFLOW_FOLDERS) is empty
 * in the PR that adds this layer, so the layer is proved by fixture hosts in a
 * throwaway root, and the build needs a way to be told which folders those hosts form.
 * The variable is honoured ONLY when DEVFLOW_MDS_ROOT is also set, the condition under
 * which the build is already running against a fixture root, so a stray variable can
 * never change a build of the real tree. The value is untrusted data from outside the
 * process: it is parsed and checked by the core module (parseWorkflowFolders) before
 * any host is planned, and a refusal exits before dist/ is touched, as a malformed
 * build key does.
 */
const WORKFLOW_FOLDERS_ENV = "DEVFLOW_MDS_WORKFLOW_FOLDERS";

function refuseWorkflowRegistry(message: string): never {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

/** The folder registry this build compiles against: the shipped one, or the fixture one a test injected. */
function resolveWorkflowFolders(): readonly WorkflowFolder[] {
  const injected = process.env["DEVFLOW_MDS_ROOT"] ? process.env[WORKFLOW_FOLDERS_ENV] : undefined;
  if (injected === undefined || injected === "") {
    const shipped = checkWorkflowFolders(WORKFLOW_FOLDERS);
    if (!shipped.ok) {
      return refuseWorkflowRegistry(`WORKFLOW_FOLDERS: ${describeWorkflowFolderError(shipped.error)}`);
    }
    return shipped.value;
  }
  let data: unknown;
  try {
    data = JSON.parse(injected);
  } catch {
    return refuseWorkflowRegistry(`${WORKFLOW_FOLDERS_ENV} is not valid JSON`);
  }
  const parsed = parseWorkflowFolders(data);
  if (!parsed.ok) {
    return refuseWorkflowRegistry(`${WORKFLOW_FOLDERS_ENV}: ${describeWorkflowFolderError(parsed.error)}`);
  }
  return parsed.value;
}

const RESOLVED_WORKFLOW_FOLDERS = resolveWorkflowFolders();

/**
 * Plan a one-file host: the `commands` and `agents` variants, which emit exactly
 * one artifact named after the source (or after its `output-name:`).
 */
function planSingleFile(
  host: HostEntry,
  rel: string,
  variant: Exclude<HostVariant, "skill-refs" | "workflow-skill">,
  outAbs: string,
): HostPlan {
  // Filename safety: the name that will be emitted is validated before it is
  // joined onto the destination, so no host can write outside outAbs.
  const declaredName = host.outputName ?? host.basename;
  const nameResult = validateOutputName(declaredName);
  if (!nameResult.ok) {
    throw outputNameRefusal(rel, declaredName, nameResult.error);
  }

  const fileName = `${nameResult.value}.md`;
  const offDest = (key: OffVariantKey): string =>
    path.resolve(ROOT, ...variantOffRelPath(key, variant, fileName).split("/"));
  return {
    variant,
    outAbs,
    dest: path.join(outAbs, fileName),
    name: nameResult.value,
    offDests: {
      "curation-off": offDest("curation-off"),
      "compliance-off": offDest("compliance-off"),
      "both-off": offDest("both-off"),
    },
  };
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

  // The omission is decided against the WHOLE registry, not this module: a posting
  // operation is named once and omitted from the files of every module that writes it.
  const omitted = complianceOffOmittedRelPaths(RESOLVED_MODULES);
  if (!omitted.ok) {
    throw new Error(
      `${rel}: the compliance-off reference set is refused — ${describePostingOpsError(omitted.error)}. ` +
      `POSTING_OPS and VARIANT_MODULES in src/core/mds-variants.ts must agree.`,
    );
  }

  const offAbs = path.resolve(ROOT, ...COMPLIANCE_OFF_SKILL_REFS_OUTPUT_DIR.split("/"));
  const outputs = expansion.value.map((pair): PlannedReference => ({
    dest: path.resolve(outAbs, ...pair.relPath.split("/")),
    pair,
    offDest: omitted.value.has(pair.relPath) ? null : path.resolve(offAbs, ...pair.relPath.split("/")),
  }));
  // Belt-and-braces containment: every segment was validated by
  // validateOutputName, so this cannot fire — which is why it is an assertion
  // rather than a diagnosis. A path that escapes its root must never be written.
  for (const { dest, offDest } of outputs) {
    if (!dest.startsWith(outAbs + path.sep)) {
      throw new Error(`${rel}: expanded destination '${dest}' escapes '${outAbs}'`);
    }
    if (offDest !== null && !offDest.startsWith(offAbs + path.sep)) {
      throw new Error(`${rel}: expanded destination '${offDest}' escapes '${offAbs}'`);
    }
  }

  return { variant: "skill-refs", outAbs, outputs };
}

/**
 * Plan a workflow skill host: the `workflow-skill` variant, one file of a skill folder.
 *
 * D-WORKFLOW-FOLDER-BUILD: a separate strategy, not a branch of planSingleFile, for the
 * reason planReferenceModule is. The file's name and folder come from the registry, so
 * `output-name:` has nothing to name and is refused; a host the registry does not list
 * is refused rather than guessed at. The core host's basename must be the literal
 * `SKILL` (validateSkillOutputName, the third name rule), the one name the ordinary
 * rule cannot spell.
 *
 * Where the file lands under EACH variant key is decided here, from the one per-key
 * file list (workflowFolderFiles): a key whose folder omits the file gets no destination,
 * which is how the build leaves a compliance-gated reference out of the compliance-off
 * folders without a second list.
 */
function planWorkflowFolder(host: HostEntry, rel: string, outAbs: string): HostPlan {
  if (host.outputName !== null) {
    throw new Error(
      `${rel}: output-name: is not valid on a workflow skill host — the file name comes from the ` +
      `folder registry in src/core/mds-variants.ts. Remove the key.`,
    );
  }

  const source = path.relative(ROOT, host.file).split(path.sep).join("/");
  const found = findWorkflowFolderHost(RESOLVED_WORKFLOW_FOLDERS, source);
  if (found === null) {
    throw new Error(
      `${rel}: declares output-dir '${WORKFLOW_FOLDERS_OUTPUT_DIR}' but is not registered in ` +
      `WORKFLOW_FOLDERS (src/core/mds-variants.ts). A workflow skill host's folder and file come ` +
      `from that registry; there is no basename fallback. Add the folder, or change its output-dir.`,
    );
  }
  const { folder, host: entry } = found;

  if (entry.role === "core" && !validateSkillOutputName(host.basename).ok) {
    throw new Error(
      `${rel}: the core host of the workflow skill folder '${folder.name}' must be named ` +
      `${WORKFLOW_SKILL_ENTRY_NAME}.mds — it compiles to ${WORKFLOW_SKILL_FILE}, and that literal is the ` +
      `only name the core may have.`,
    );
  }

  const destFor = (key: VariantKey): string | null => {
    if (!workflowFolderFiles(folder, key).includes(entry.file)) return null;
    const dest = path.resolve(ROOT, ...workflowFolderRelPath(key, folder.name, entry.file).split("/"));
    // Belt-and-braces containment, as planReferenceModule asserts: the names were
    // validated by the registry check, so this cannot fire.
    const treeAbs = path.resolve(ROOT, ...workflowFoldersRootRelPath(key).split("/"));
    if (!dest.startsWith(treeAbs + path.sep)) {
      throw new Error(`${rel}: workflow destination '${dest}' escapes '${treeAbs}'`);
    }
    return dest;
  };
  return {
    variant: "workflow-skill",
    outAbs,
    folder: folder.name,
    file: entry.file,
    role: entry.role,
    dests: {
      on: destFor("on"),
      "curation-off": destFor("curation-off"),
      "compliance-off": destFor("compliance-off"),
      "both-off": destFor("both-off"),
    },
  };
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
 * default is the same friction stripFrontmatterFor imposes — a fifth variant
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
    case "workflow-skill":
      return planWorkflowFolder(host, rel, outAbs);
    case "commands":
    case "agents":
      return planSingleFile(host, rel, variant, outAbs);
    default: {
      const unhandled: never = variant;
      throw new Error(`${rel}: unhandled host variant '${String(unhandled)}'`);
    }
  }
}

/**
 * The text a variant-split refusal can be located by: the nearest content line
 * above the marker it names.
 *
 * The line numbers in a VariantSplitError count the COMPILED body, because the
 * split runs after the compile, and a marker that came from a partial has no line
 * in the host at all. A quoted neighbour is what lets an author find the spot in
 * either. Marker lines of either axis and blank lines are skipped, and the scan is
 * bounded by the body's own length.
 */
function variantSplitNeighbour(body: string, error: VariantSplitError): string | null {
  const at = "line" in error ? error.line : error.openedAt;
  const lines = body.split("\n");
  for (let i = Math.min(at, lines.length) - 2; i >= 0; i--) {
    const text = lines[i].trim();
    if (text !== "" && !containsVariantMarker(text)) return text.slice(0, 80);
  }
  return null;
}

/**
 * Render a variant-split refusal as the error the build throws.
 *
 * The wording lives in describeVariantSplitError so the build and its tests share
 * one text; this adds the host, the axis the refusal is about (the retired spelling
 * has none and counts as curation) and a quoted neighbour (see
 * variantSplitNeighbour), and returns the Error so main()'s aggregation keeps the
 * single exit.
 */
function variantSplitRefusal(rel: string, error: VariantSplitError, body: string): Error {
  const axis: VariantAxis = "axis" in error ? error.axis : "curation";
  const neighbour = variantSplitNeighbour(body, error);
  const where = neighbour === null ? "" : ` (below "${neighbour}")`;
  return new Error(
    `${rel}: ${axis}-variant split refused — ${describeVariantSplitError(error)}${where}. ` +
    `Line numbers count the compiled output, not the source.`,
  );
}

/** One file the build is about to write: where it goes and what it holds. */
interface PlannedOutput {
  dest: string;
  content: string;
}

/** The axes a compiled body carries an arm on. */
type HostAxes = Readonly<Record<VariantAxis, boolean>>;

/**
 * The axes a reference module reports: none. Its compliance arms are not recorded in
 * the variant manifest, which lists prompts only; the compliance-off references tree
 * is complete by construction (see the header), so a reader needs no record of which
 * file was armed.
 */
const NO_ARMS: HostAxes = { curation: false, compliance: false };

/** What a host's compiled body becomes: the files to write, and the axes it carries an arm on. */
interface MaterializedHost {
  outputs: PlannedOutput[];
  axes: HostAxes;
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
function materializeOutputs(host: HostEntry, plan: StandalonePlan, body: string): MaterializedHost {
  const rel = path.relative(ROOT, host.file);

  if (plan.variant !== "skill-refs") {
    // D-LEARNING-VARIANTS: the all-on variant is the artifact at the host's own path,
    // so every existing reader of dist/ keeps working; an off variant exists only for
    // a host that has an arm on each axis it turns off (emittedVariantKeys).
    const split = splitVariants(body);
    if (!split.ok) throw variantSplitRefusal(rel, split.error, body);
    const { bodies, hasArms } = split.value;
    const outputs = emittedVariantKeys(hasArms).map(
      (key): PlannedOutput => ({ dest: key === "on" ? plan.dest : plan.offDests[key], content: bodies[key] }),
    );
    return { outputs, axes: hasArms };
  }

  // A reference module has one axis to select on, compliance. A curation marker in one
  // has nothing to select: its sections ship as written on that axis, so the marker
  // would reach the installed reference as text.
  if (containsCurationMarker(body)) {
    throw new Error(
      `${rel}: a reference module may not carry curation-variant markers — its sections ship as ` +
      `written, so a marker would reach the installed reference as text. Curation arms belong in a ` +
      `command or agent host.`,
    );
  }
  // Split into operation sections FIRST, then each section on its compliance arms: an
  // arm that runs across two operations is then a refusal naming the operation it is
  // in, not a pair of files that quietly share half an arm.
  const split = splitVariantSections(
    body,
    plan.outputs.map(({ dest, offDest, pair }) => ({ dest, offDest, op: pair.op })),
  );
  if (!split.ok) {
    throw new Error(
      `${rel}: section split refused — ${JSON.stringify(split.error)}. Each operation's section ` +
      `is introduced by a '<!-- op: NAME -->' line and must carry a non-empty body.`,
    );
  }

  const outputs: PlannedOutput[] = [];
  for (const { dest, offDest, op, content } of split.value) {
    const arms = splitSectionArms(op, content, { complianceOffWritten: offDest !== null });
    if (!arms.ok) throw sectionArmRefusal(rel, arms.error, content);
    outputs.push({ dest, content: arms.value.on });
    if (offDest !== null) outputs.push({ dest: offDest, content: arms.value.complianceOff });
  }
  return { outputs, axes: NO_ARMS };
}

/**
 * Render a refusal of the compliance arms of one reference section as the error the
 * build throws.
 *
 * A split refusal carries the operation and the section's own line numbers, and the
 * quoted neighbour is looked up in the section, so the author can find the spot
 * without counting compiled lines. The wording of the split itself lives in
 * describeVariantSplitError, shared with the tests.
 */
function sectionArmRefusal(rel: string, error: SectionArmError, content: string): Error {
  switch (error.kind) {
    case "arm-split": {
      const axis: VariantAxis = "axis" in error.error ? error.error.axis : "curation";
      const neighbour = variantSplitNeighbour(content, error.error);
      const where = neighbour === null ? "" : ` (below "${neighbour}")`;
      return new Error(
        `${rel}: ${axis}-variant split refused in the '${error.op}' section — ` +
        `${describeVariantSplitError(error.error)}${where}. ` +
        `Line numbers count that section, not the source. An arm must open and close inside one ` +
        `'<!-- op: NAME -->' section.`,
      );
    }
    case "empty-variant":
      return new Error(
        `${rel}: the '${error.op}' section is empty in the ${error.variant} reference — its arms leave ` +
        `no text for a file the build writes. Keep a line outside the arms, or omit the operation.`,
      );
    default: {
      const unhandled: never = error;
      return new Error(`${rel}: unhandled section refusal ${JSON.stringify(unhandled)}`);
    }
  }
}

/**
 * Write one file atomically: to a PID-scoped temp file, then renamed into place, so a
 * concurrent reader (e.g. a parallel vitest worker) never observes a missing file
 * between the old and the new content. The temp file is removed when the rename fails,
 * so no orphan is left behind.
 */
function writeFileAtomic(dest: string, content: string): void {
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

/** Absolute path of the variant manifest under ROOT. */
function variantManifestPath(): string {
  return path.resolve(ROOT, ...VARIANT_MANIFEST_REL_PATH.split("/"));
}

/**
 * Compile one host to Markdown, or throw.
 *
 * Every devflow asset is Markdown. A `@message` host compiles to a chat-messages
 * result with no `output` at all, so it is refused by name here and aggregated
 * with the other failures rather than written, crashed on, or skipped.
 */
async function compileMarkdown(host: HostEntry): Promise<{ output: string; warnings: string[] }> {
  const result = await compileFile(host.file);
  if (result.kind !== "markdown") {
    throw new Error(
      `${path.relative(ROOT, host.file)}: compiled to a "${result.kind}" result, not Markdown. ` +
      `Devflow assets are Markdown only — remove the @message block(s).`,
    );
  }
  return { output: result.output, warnings: result.warnings };
}

async function compileHost(host: HostEntry, plan: StandalonePlan): Promise<CompileOutcome> {
  const { outAbs } = plan;

  // Auto-create only the final destination leaf.
  fs.mkdirSync(outAbs, { recursive: true });

  const result = await compileMarkdown(host);
  // Generator hosts shed their whole steering block; reference modules shed it
  // too and must expose no second block; command hosts shed only the build-owned
  // keys so every other byte of their frontmatter is preserved.
  const cleaned = stripFrontmatterFor(plan, result.output, host.file);
  const { outputs, axes } = materializeOutputs(host, plan, cleaned);

  for (const { dest, content } of outputs) writeFileAtomic(dest, content);

  // A reference module's label names the files of the compliance-on tree, one per
  // operation; its compliance-off copies are the same operations under another root.
  const shown = plan.variant === "skill-refs" ? plan.outputs.map(o => o.dest) : outputs.map(o => o.dest);
  const destLabel = plan.variant === "skill-refs" && shown.length > 1
    ? `${path.relative(ROOT, outAbs)}/ (${shown.length} file(s))`
    : shown.map(dest => path.relative(ROOT, dest)).join(" + ");

  return {
    source: path.relative(ROOT, host.file),
    dest: destLabel,
    warnings: result.warnings,
    written: outputs.map(o => o.dest),
    prompt: plan.variant === "skill-refs" ? null : { kind: plan.variant, name: plan.name, axes },
  };
}

/** One host of a workflow folder, compiled and split on its arms, not yet stamped or written. */
interface CompiledWorkflowHost {
  readonly host: HostEntry;
  readonly plan: WorkflowSkillPlan;
  /** The compiled body under each variant key, before the build id is stamped into it. */
  readonly bodies: Readonly<Record<VariantKey, string>>;
  readonly warnings: string[];
}

/**
 * Compile one host of a workflow folder and split it on its arms. Writes nothing.
 *
 * D-WORKFLOW-FOLDER-BUILD: the write waits for the whole folder, because the build id is
 * made from every file of the folder, so no file can be final before the last host is
 * compiled. The split is the prompts' own (D-LEARNING-VARIANTS): a file carries curation
 * and compliance arms like a command does, and a file with no arm on an axis has one
 * body there, which is why every key gets its file.
 */
async function compileWorkflowHost(host: HostEntry, plan: WorkflowSkillPlan): Promise<CompiledWorkflowHost> {
  const result = await compileMarkdown(host);
  const cleaned = stripFrontmatterFor(plan, result.output, host.file);
  const split = splitVariants(cleaned);
  if (!split.ok) throw variantSplitRefusal(path.relative(ROOT, host.file), split.error, cleaned);
  return { host, plan, bodies: split.value.bodies, warnings: result.warnings };
}

/** The files of one compiled host, as the folder pass settled them: where each goes and what it holds. */
interface SettledWorkflowHost {
  readonly compiled: CompiledWorkflowHost;
  /** One output per variant key whose folder holds this host's file, in variant-key order. */
  readonly outputs: PlannedOutput[];
}

/**
 * Settle one workflow folder once all of its hosts are compiled: check every variant key
 * against its own file list, stamp the build id, and return what to write. Writes nothing.
 *
 * For each variant key (VARIANT_KEYS):
 *  1. Completeness. The key's folder must hold every file of its own list
 *     (workflowFolderFiles), so a registered host that was not found or not compiled
 *     fails the build, and a file the key's list omits is never required. Every key
 *     missing a file is reported, in one error, before anything is written.
 *  2. The build id (D-BUILD-ID): workflowBuildId over the key's compiled bodies before
 *     the stamp, then the same id stamped into the first heading of every file outside
 *     references/. Same sources, same id; the reference files stay byte-equal.
 *  3. A post-condition: the stamped files of the key read back one id, and it is the
 *     id that was stamped.
 */
function settleWorkflowFolder(
  folder: WorkflowFolder,
  compiled: readonly CompiledWorkflowHost[],
): SettledWorkflowHost[] {
  const settled = compiled.map((c): SettledWorkflowHost => ({ compiled: c, outputs: [] }));
  const hosts = new Map(compiled.map(c => [c.plan.file, c.host]));
  const missing: string[] = [];
  const lackingFiles = new Set<string>();

  for (const key of VARIANT_KEYS) {
    const members = settled.flatMap(s => {
      const dest = s.compiled.plan.dests[key];
      return dest === null ? [] : [{ s, dest, file: s.compiled.plan.file, body: s.compiled.bodies[key] }];
    });
    const held = new Set(members.map(m => m.file));
    const lacking = workflowFolderFiles(folder, key).filter(file => !held.has(file));
    if (lacking.length > 0) {
      missing.push(`variant key '${key}' lacks ${lacking.map(file => `'${file}'`).join(", ")}`);
      for (const file of lacking) lackingFiles.add(file);
      continue;
    }

    const id = workflowBuildId(members.map(({ file, body }): CompiledFolderFile => ({ file, body })));
    const written: CompiledFolderFile[] = [];
    for (const { s, dest, file, body } of members) {
      let content = body;
      if (isStampedWorkflowFile(file)) {
        const stamped = stampBuildId(body, id);
        if (!stamped.ok) {
          const where = path.relative(ROOT, hosts.get(file)?.file ?? file);
          throw new Error(
            `${where}: the '${key}' variant of ${file} cannot carry the build id — ${describeBuildStampError(stamped.error)}`,
          );
        }
        content = stamped.value;
      }
      s.outputs.push({ dest, content });
      written.push({ file, body: content });
    }

    const checked = checkFolderBuildIds(written);
    if (!checked.ok || checked.value !== id) {
      throw new Error(
        `workflow skill folder '${folder.name}', variant key '${key}': the stamped files do not read back build id ` +
        `${id} (${checked.ok ? checked.value : describeBuildIdCheckError(checked.error)})`,
      );
    }
  }

  if (missing.length > 0) {
    const sources = workflowFolderHosts(folder)
      .filter(host => lackingFiles.has(host.file))
      .map(host => host.source);
    throw new Error(
      `workflow skill folder '${folder.name}': ${missing.join("; ")}. A variant key's folder must hold every file ` +
      `of its own list; check that each registered host exists, declares output-dir '${WORKFLOW_FOLDERS_OUTPUT_DIR}' ` +
      `and compiles. Not found: ${sources.join(", ")}.`,
    );
  }
  return settled;
}

/** The outcome of one settled workflow host, for the printed line, the written set and the prune. */
function workflowOutcome({ compiled, outputs }: SettledWorkflowHost): CompileOutcome {
  return {
    source: path.relative(ROOT, compiled.host.file),
    dest: outputs.map(o => path.relative(ROOT, o.dest)).join(" + "),
    warnings: compiled.warnings,
    written: outputs.map(o => o.dest),
    prompt: null,
  };
}

/**
 * Delete every `.md` in dist/agents/ that no host in this build emits.
 *
 * dist/agents/ is gitignored and outranks src/assets/agents/ in both the
 * installer's resolve and loadShippedAgentDefaults's merge, so a file left behind
 * there — a renamed host's old output, a hand-dropped one — is installed in
 * preference to the audited source on every `devflow init`, with nothing in the
 * install path to notice. The build owns the directory, so it also owns removing
 * what it no longer produces; the CI parity guard catches the same orphan a
 * commit later, which is too late for a machine that only ever runs the build.
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
 * Delete every `.md` in dist/commands/ that no host in this build emits.
 *
 * D-RELEASE-MDS: every command is a compiled host, with no hand-authored file
 * copied beside them, so "no host claims it" means orphan: a renamed host's old
 * output, or a command dropped from the roster, would otherwise stay in dist/ and
 * be installed as a command no source declares. Same hazard and same `.md`-only
 * scope as pruneOrphanAgents.
 *
 * @param claimed - Absolute destination paths this build wrote.
 * @returns Repo-relative paths removed.
 */
function pruneOrphanCommands(claimed: ReadonlySet<string>): string[] {
  return pruneOrphans(path.resolve(ROOT, COMMANDS_OUTPUT_DIR), claimed, false);
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
 * The reason printed beside a file the prune removes from the tree of each off
 * variant. Total over OffVariantKey, so a new key cannot go without a reason.
 */
const PRUNE_REASONS: Readonly<Record<OffVariantKey, string>> = {
  "curation-off": "no curation arm",
  "compliance-off": "no compliance arm",
  "both-off": "no host with arms on both axes",
};

/**
 * The trees the off variants of a prompt are written under, one per off key, and
 * the reason printed beside a file the prune removes from each.
 *
 * Siblings under dist/, none inside another, so the prune of one tree cannot reach
 * the files of another.
 */
const VARIANT_TREES: ReadonlyArray<{ readonly dir: string; readonly reason: string }> =
  OFF_VARIANT_KEYS.map(key => ({ dir: OFF_OUTPUT_DIRS[key], reason: PRUNE_REASONS[key] }));

/**
 * Delete every `.md` under one variant tree that this build did not write.
 *
 * An off variant of a host exists only while the host carries an arm on each axis it
 * turns off, so the set of files that should be here is known only from what the
 * build wrote: a host that loses its last arm leaves its old variant behind, and a
 * variant left there would be installed on a machine with that axis off in place of
 * the real prompt. Recursive, so a file parked under any other subdirectory of the
 * tree goes too. A tree no host wrote to is pruned whole, which is also what removes
 * the variants of a host that lost every arm.
 */
function pruneOrphanVariantTree(dir: string, written: ReadonlySet<string>): string[] {
  return pruneOrphans(path.resolve(ROOT, dir), written, true);
}

/**
 * The root of the workflow folders under every variant key, repo-relative: dist/workflows
 * and the workflows folder of each variant tree. Siblings of the prompts' folders, so the
 * prune of one cannot reach another.
 */
const WORKFLOW_TREES: readonly string[] = VARIANT_KEYS.map(key => workflowFoldersRootRelPath(key));

/**
 * Delete every folder under a workflow tree that no registered folder names.
 *
 * A folder that leaves the registry (renamed, dropped) would otherwise stay in dist/ whole,
 * and the file prune below removes only files, leaving the empty directories of an orphan
 * folder behind. Only a real directory is considered: a link in its place is not followed
 * and not removed. The sweep is keyed on the registry rather than on the written files, so
 * it also removes a folder whose files the build no longer writes.
 *
 * @param registered - The names of the registered folders.
 * @returns Repo-relative paths removed.
 */
function pruneOrphanWorkflowFolders(registered: ReadonlySet<string>): string[] {
  const pruned: string[] = [];
  for (const tree of WORKFLOW_TREES) {
    const treeAbs = path.resolve(ROOT, tree);
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(treeAbs, { withFileTypes: true });
    } catch (err) {
      // Absent until the first folder exists, which is always the case while none is registered.
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "ENOTDIR") continue;
      throw err;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || registered.has(entry.name)) continue;
      const full = path.join(treeAbs, entry.name);
      fs.rmSync(full, { recursive: true, force: true });
      pruned.push(path.relative(ROOT, full));
    }
  }
  return pruned;
}

/**
 * Delete every `.md` under a workflow tree that this build did not write, nested files
 * of a registered folder included (a reference file that left the registry, a file parked
 * under another subfolder).
 *
 * @param written - Absolute paths this build wrote.
 * @returns Repo-relative paths removed.
 */
function pruneOrphanWorkflowFiles(written: ReadonlySet<string>): string[] {
  return WORKFLOW_TREES.flatMap(tree => pruneOrphans(path.resolve(ROOT, tree), written, true));
}

/**
 * Remove the retired off tree (LEGACY_OFF_OUTPUT_DIR) whole, when it exists.
 *
 * No build writes there any more and no installer reads it, so every file in it is
 * stale. It is gitignored, but a checkout that built before the rename still holds
 * it, and a package packed from that checkout would ship it. The sweep is not keyed
 * on written files: the folder belongs to no host. A link in its place is removed as
 * a link, and its target is left alone.
 *
 * @returns The repo-relative path removed, or an empty list when it was absent.
 */
function pruneLegacyOffTree(): string[] {
  const dirAbs = path.resolve(ROOT, LEGACY_OFF_OUTPUT_DIR);
  try {
    fs.lstatSync(dirAbs);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return [];
    throw err;
  }
  fs.rmSync(dirAbs, { recursive: true, force: true });
  return [path.relative(ROOT, dirAbs)];
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

/**
 * Run every sweep over dist/ and print one `pruned:` line per file removed, with the
 * reason for its tree. A file the build wrote is never removed.
 */
function pruneStaleOutputs(writtenDests: ReadonlySet<string>, workflowFolders: ReadonlySet<string>): void {
  // The workflow trees go first, so an orphan folder is reported once as a folder and the
  // variant-tree sweep below finds nothing of it left to report under another reason.
  for (const rel of pruneOrphanWorkflowFolders(workflowFolders)) {
    console.log(`  pruned:   ${rel} (no workflow skill folder)`);
  }
  for (const rel of pruneOrphanWorkflowFiles(writtenDests)) {
    console.log(`  pruned:   ${rel} (no workflow skill host)`);
  }
  for (const rel of pruneOrphanCommands(writtenDests)) {
    console.log(`  pruned:   ${rel} (no command host)`);
  }
  for (const rel of pruneOrphanAgents(writtenDests)) {
    console.log(`  pruned:   ${rel} (no generator host)`);
  }
  for (const rel of pruneOrphanReferences(writtenDests)) {
    console.log(`  pruned:   ${rel} (no reference module)`);
  }
  for (const { dir, reason } of VARIANT_TREES) {
    for (const rel of pruneOrphanVariantTree(dir, writtenDests)) {
      console.log(`  pruned:   ${rel} (${reason})`);
    }
  }
  for (const rel of pruneLegacyOffTree()) {
    console.log(`  pruned:   ${rel} (retired off tree)`);
  }
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

  // The manifest describes a finished build. It goes before the first file is written
  // and returns as the last step of a clean run, so a refused, crashed or interrupted
  // build leaves none, and a compliance-off install refuses with the build remedy.
  fs.rmSync(variantManifestPath(), { force: true });

  const reportCompiled = (outcome: CompileOutcome): void => {
    outcomes.push(outcome);

    const warnNote =
      outcome.warnings.length > 0
        ? ` (${outcome.warnings.length} warning(s))`
        : "";
    console.log(`  compiled: ${outcome.source} → ${outcome.dest}${warnNote}`);

    for (const w of outcome.warnings) {
      console.warn(`    WARNING: ${w}`);
    }
  };

  // A workflow skill host is compiled here and written later, once its whole folder is
  // compiled (settleWorkflowFolder). A folder with a host that was refused or failed is
  // broken: its failure is already recorded, and settling it would only report that
  // host again as a missing file.
  const workflowHosts = new Map<string, CompiledWorkflowHost[]>();
  const brokenFolders = new Set<string>();

  for (const { host, plan } of planned) {
    if (destsOf(plan).some(dest => contested.has(dest))) {
      if (plan.variant === "workflow-skill") brokenFolders.add(plan.folder);
      continue;
    }
    try {
      if (plan.variant === "workflow-skill") {
        const compiled = await compileWorkflowHost(host, plan);
        workflowHosts.set(plan.folder, [...(workflowHosts.get(plan.folder) ?? []), compiled]);
      } else {
        reportCompiled(await compileHost(host, plan));
      }
    } catch (err) {
      if (plan.variant === "workflow-skill") brokenFolders.add(plan.folder);
      recordFailure(path.relative(ROOT, host.file), formatMdsError(err, host.file));
    }
  }

  // Every registered folder is settled, not only the folders that compiled a host: a
  // registered folder none of whose hosts was found has every file missing, and
  // that is a build failure rather than a folder that silently does not exist.
  for (const folder of RESOLVED_WORKFLOW_FOLDERS) {
    if (brokenFolders.has(folder.name)) continue;
    try {
      const settled = settleWorkflowFolder(folder, workflowHosts.get(folder.name) ?? []);
      for (const { outputs } of settled) {
        for (const { dest, content } of outputs) writeFileAtomic(dest, content);
      }
      for (const host of settled) reportCompiled(workflowOutcome(host));
    } catch (err) {
      recordFailure(
        `${WORKFLOW_FOLDERS_OUTPUT_DIR}/${folder.name}`,
        formatMdsError(err, path.resolve(ROOT, ...folder.core.split("/"))),
      );
    }
  }

  // The manifest is rendered here, before the summary, so a refusal of it is counted
  // with the others and nothing has been pruned yet when it stops the build.
  const manifest = renderVariantManifest(
    outcomes.flatMap(o => (o.prompt === null ? [] : [o.prompt])),
  );
  if (!manifest.ok) {
    recordFailure(
      VARIANT_MANIFEST_REL_PATH,
      `${VARIANT_MANIFEST_REL_PATH}: ${describeVariantManifestError(manifest.error)}`,
    );
  }

  const totalWarnings = outcomes.reduce((n, o) => n + o.warnings.length, 0);
  console.log(
    `\nMDS: ${outcomes.length} compiled, ${errors.length} error(s), ${totalWarnings} warning(s)`,
  );

  // `!manifest.ok` is already counted in `errors`; testing it here as well is what
  // narrows `manifest` to its value for the write below.
  if (errors.length > 0 || !manifest.ok) {
    console.error(
      `\n${errors.length} compile error(s) — build FAILED. Fix the mds::* errors above before shipping.`,
    );
    process.exit(1);
  }

  // Every planned host was written (a refusal would have exited above), so the
  // written set is complete and anything else in these trees is stale. Keyed on
  // what was WRITTEN rather than what was planned: a curation-off variant is
  // planned for every one-file host and written only for one with an arm.
  pruneStaleOutputs(
    new Set(outcomes.flatMap(o => o.written)),
    new Set(RESOLVED_WORKFLOW_FOLDERS.map(folder => folder.name)),
  );
  writeFileAtomic(variantManifestPath(), manifest.value);
  const curationOffCount = outcomes.filter(o => o.prompt?.axes.curation === true).length;
  console.log(`  ${curationOffCount} curation-off variant(s) written`);

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
