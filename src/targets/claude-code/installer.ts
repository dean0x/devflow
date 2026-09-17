import { promises as fs } from 'fs';
import { existsSync } from 'fs';
import * as path from 'path';
import type { PluginDefinition } from '../../core/plugins.js';
import { DEVFLOW_PLUGINS, SKILL_NAMESPACE, prefixSkillName, unprefixSkillName, getAllSkillNames, getAllAgentNames, getAllCommandNames, FEATURE_OWNED_SKILLS } from '../../core/plugins.js';
import { skillsDir, agentSourceDirs, rulesDir, commandsDir, scriptsDir, compiledSkillRefsDir, type AgentSourceDirs } from '../../core/assets.js';
import { getPackageRoot, isContainedIn } from '../../core/paths.js';
import { sweepOrphanedAssets, mdFileName, mdEntryName, type SweepResult } from '../../core/orphan-sweep.js';
import { generatedReferenceManifest, SKILL_REFS_SKILL_NAME } from '../../core/mds-variants.js';
import { sweepOrphanedReferences, MAX_REFERENCE_SWEEP_DEPTH } from '../../core/reference-sweep.js';

// ---------------------------------------------------------------------------
// Shadow override reporting types
// ---------------------------------------------------------------------------

export type ShadowSkipReason = 'missing-skill-md' | 'empty-shadow-file' | 'not-a-file';

export interface ShadowSkip {
  kind: 'skill' | 'rule';
  name: string;
  reason: ShadowSkipReason;
}

/**
 * Asset namespaces a registry-diff sweep can prune.
 *
 * `reference` names an entry of the generated `devflow:git` reference tree, whose
 * registry key is a relative path (`tracker/github/setup-task.md`) rather than a bare
 * asset name — see src/core/reference-sweep.ts.
 */
export type SweptAssetKind = 'skill' | 'command' | 'agent' | 'reference';

export interface SweepFailure {
  kind: SweptAssetKind;
  name: string;
  error: unknown;
}

/** A single entry in the swept-orphan list — name plus the asset kind for disambiguation.
 * Carrying the kind allows formatSweepSummary to emit "agent git" rather than the bare
 * name when an asset exists in multiple namespaces (e.g. both a command and an agent
 * named "git"). (F15) */
export interface SweptOrphan {
  kind: SweptAssetKind;
  name: string;
}

export interface InstallReport {
  shadowedSkills: string[];
  shadowedRules: string[];
  skippedShadows: ShadowSkip[];
  /** Registry names removed by orphan sweeps (skills, commands, agents, references). */
  sweptOrphans: SweptOrphan[];
  /** Per-item removal failures from orphan sweeps — isolates failures per PF-009. */
  sweepFailures: SweepFailure[];
  /**
   * Manifest-relative paths of the generated `devflow:git` references installed by the
   * reference overlay, e.g. `tracker/github/setup-task.md`.
   */
  overlaidRefs: string[];
  /**
   * Overlay units this run did not refresh, each carrying the state it was left in —
   * see {@link OverlayFailureState}. The install still succeeds (PF-009); what a unit
   * named here is now running on differs per state, which is exactly what the summary
   * has to say out loud.
   */
  overlayFailures: OverlayFailure[];
}

/** Discriminated outcome for a single rule installation. */
export type RuleInstallOutcome =
  | 'shadow'
  | 'source'
  | 'source-invalid-shadow:empty-shadow-file'
  | 'source-invalid-shadow:not-a-file'
  | 'skipped';

// ---------------------------------------------------------------------------
// Shadow state named types (Issue 4)
// ---------------------------------------------------------------------------

/** Return states for validateSkillShadow. */
export type SkillShadowState = 'valid' | 'missing-skill-md' | 'none';

/** Return states for validateRuleShadow. */
export type RuleShadowState = 'valid' | 'empty-shadow-file' | 'not-a-file' | 'none';

// ---------------------------------------------------------------------------
// Shadow validation helpers (exported — reused by Step 4 list commands)
// ---------------------------------------------------------------------------

/**
 * Validate a skill shadow directory at `~/.devflow/skills/{name}/`.
 *
 * Returns:
 *   'none'            — shadow dir is absent (no override configured)
 *   'valid'           — dir exists and contains a non-empty SKILL.md file
 *   'missing-skill-md'— dir exists but SKILL.md is absent, empty, or not a file
 */
export async function validateSkillShadow(shadowDir: string): Promise<SkillShadowState> {
  try {
    const dirStat = await fs.stat(shadowDir);
    if (!dirStat.isDirectory()) return 'missing-skill-md';
  } catch {
    return 'none';
  }

  try {
    const skillMd = path.join(shadowDir, 'SKILL.md');
    const stat = await fs.stat(skillMd);
    if (stat.isFile() && stat.size > 0) return 'valid';
    return 'missing-skill-md';
  } catch {
    return 'missing-skill-md';
  }
}

/**
 * Validate a rule shadow file at `~/.devflow/rules/{name}.md`.
 *
 * Returns:
 *   'none'               — shadow file is absent
 *   'valid'              — shadow file exists, is a regular file, and is non-empty
 *   'empty-shadow-file'  — shadow file exists and is a file but has size 0
 *   'not-a-file'         — path exists but is not a file (e.g. a directory)
 *
 * D: The isFile() guard is load-bearing. Without it, a directory at the shadow
 * path passes the size > 0 check but copyFile throws EISDIR inside the rules
 * Promise.all (installer.ts rules block — no per-call catch), aborting init.
 * fs.stat follows symlinks: symlink → regular file = valid; symlink → dir = not-a-file.
 */
export async function validateRuleShadow(shadowFile: string): Promise<RuleShadowState> {
  try {
    const stat = await fs.stat(shadowFile);
    if (!stat.isFile()) return 'not-a-file';
    if (stat.size === 0) return 'empty-shadow-file';
    return 'valid';
  } catch {
    return 'none';
  }
}

// ---------------------------------------------------------------------------
// Rule installer
// ---------------------------------------------------------------------------

/**
 * Install a single rule file, respecting the shadow override at
 * ~/.devflow/rules/{name}.md over the built plugin source.
 *
 * Returns the installation outcome so callers can aggregate reporting.
 *
 * D: Missing declared source is a build/packaging failure — throws rather than
 * silently returning 'skipped' (mirrors command hard-error pattern). Per-item
 * copy failures (EACCES, ENOSPC, etc.) are still isolated (avoids PF-009
 * blast-radius: one bad copy does not abort the whole batch).
 * Invalid shadows still warn-and-install-source (applies ADR-010).
 */
export async function installRuleFile(
  ruleName: string,
  devflowDir: string,
  rulesTarget: string,
): Promise<RuleInstallOutcome> {
  const shadowFile = path.join(devflowDir, 'rules', mdFileName(ruleName));
  const targetFile = path.join(rulesTarget, mdFileName(ruleName));
  const ruleSource = path.join(rulesDir(), mdFileName(ruleName));

  const shadowState = await validateRuleShadow(shadowFile);

  if (shadowState === 'valid') {
    try {
      await fs.copyFile(shadowFile, targetFile);
      return 'shadow';
    } catch {
      // Shadow is valid but the copy failed (e.g. EACCES, EISDIR on target).
      // Fall through to install the Devflow source so init never hard-fails.
    }
  }

  // Shadow is invalid (empty or not-a-file), or valid-shadow copy failed.
  // Install the Devflow source and report the specific invalid-shadow reason.
  let invalidShadowOutcome: RuleInstallOutcome | null = null;
  if (shadowState === 'not-a-file') {
    invalidShadowOutcome = 'source-invalid-shadow:not-a-file';
  } else if (shadowState === 'empty-shadow-file') {
    invalidShadowOutcome = 'source-invalid-shadow:empty-shadow-file';
  }

  // Hard-error on missing declared source: a build/packaging failure, not a
  // per-item degradation. Matches command install behavior.
  try {
    await fs.access(ruleSource);
  } catch {
    throw new Error(
      `Rule source not found for declared rule "${ruleName}": ${ruleSource}. ` +
      `Ensure the rule file exists in src/assets/rules/.`,
    );
  }

  // Copy is isolated per PF-009: a copy failure degrades to 'skipped' so one
  // bad rule does not abort the entire installAllRules Promise.all batch.
  try {
    await fs.copyFile(ruleSource, targetFile);
    return invalidShadowOutcome ?? 'source';
  } catch {
    return 'skipped'; /* copy failed (EACCES, ENOSPC, etc.) — degrade gracefully */
  }
}

// ---------------------------------------------------------------------------
// Shared rule-install loop (Issue 3)
// ---------------------------------------------------------------------------

/**
 * Install all rules in rulesMap, returning one outcome per rule.
 * Called by installViaFileCopy (rolls up into InstallReport) and
 * `rules --enable` (renders per-rule log lines). One place computes;
 * callers present.
 */
export async function installAllRules(
  rulesMap: Map<string, string>,
  devflowDir: string,
  rulesTarget: string,
): Promise<{ ruleName: string; outcome: RuleInstallOutcome }[]> {
  return Promise.all(
    [...rulesMap.keys()].map(async (ruleName) => {
      const outcome = await installRuleFile(ruleName, devflowDir, rulesTarget);
      return { ruleName, outcome };
    }),
  );
}

// ---------------------------------------------------------------------------
// Spinner interface
// ---------------------------------------------------------------------------

/**
 * Minimal spinner interface matching @clack/prompts spinner().
 */
export interface Spinner {
  start(msg?: string): void;
  stop(msg?: string, code?: number): void;
  message(msg?: string): void;
}

// ---------------------------------------------------------------------------
// Directory utilities
// ---------------------------------------------------------------------------

/**
 * Recursively copy a directory tree.
 */
export async function copyDirectory(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      await copyDirectory(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

/**
 * Recursively chmod all files in a directory tree, bounded by the shared descent bound.
 *
 * `_depth` counts the walked root as 0 and a breach is `_depth > MAX_REFERENCE_SWEEP_DEPTH`
 * — the same comparison every other walk over this same tree already makes
 * (`sweepOrphanedReferences`, the build's `pruneOrphans`, the harness's `walkFiles`). The
 * constant is imported, never re-spelled: one tree, one bound — two walkers each
 * carrying their own literal is how a pair of them comes to disagree.
 *
 * The bound is CONSISTENCY, not an exploit closure. `Dirent.isDirectory()` is lstat-based,
 * so a symlink-to-directory is a leaf to this walk and a symlink loop — the hazard the
 * shared constant's own rationale cites — cannot be entered here in the first place. What
 * the bound buys is that the one walk over `references/` holding no explicit upper bound
 * stops holding the opposite position on a hazard its siblings document, in a codebase
 * whose standing rule is that every loop has one.
 *
 * A breach THROWS rather than returning quietly. A walk that stopped early would leave an
 * unnamed part of the tree on its source modes while the caller believed the whole tree
 * was normalised — the same "converged over ground it never covered" claim the sweep's
 * `failed` channel exists to prevent. The reference overlay — the walk this bound is for,
 * and the only one that crosses a tree the installer does not own — turns the throw into a
 * `warn(...)` line carrying the directory and the bound, through the channel it already
 * has for mode normalisation (see {@link overlayGeneratedReferences}). The other caller,
 * {@link composeScripts}, swallows it with the rest of its copy-and-chmod step; that tree
 * is three levels of shipped assets, so a breach there means the package itself grew a
 * shape no walk in this repo expects, and neither call site aborts an install over it.
 */
export async function chmodRecursive(dir: string, mode: number, _depth = 0): Promise<void> {
  if (_depth > MAX_REFERENCE_SWEEP_DEPTH) {
    throw new Error(
      `chmodRecursive: descent into ${dir} exceeds the bound of ` +
      `${MAX_REFERENCE_SWEEP_DEPTH} levels — that subtree keeps the modes it arrived with.`,
    );
  }

  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await chmodRecursive(fullPath, mode, _depth + 1);
    } else if (entry.isFile()) {
      await fs.chmod(fullPath, mode);
    }
  }
}

// ---------------------------------------------------------------------------
// Generated skill-reference overlay (P2-S14)
// ---------------------------------------------------------------------------

/** Sub-path under the references root that the prune converges to the manifest. */
const TRACKER_SUBTREE = 'tracker';

/**
 * Which document set an overlay unit covers.
 *
 * A discriminated union rather than a name string carrying a `'(cross-cutting)'`
 * sentinel: a sentinel is a value a provider directory could in principle hold, and
 * every reader would have to re-derive "is this the flat set?" by comparing against a literal.
 *
 * The provider arm carries the module's `subdir` exactly as the registry
 * (`VARIANT_MODULES` in src/core/mds-variants.ts) declares it — `tracker/github`, not
 * its trailing segment. The trailing segment is not an identity: two modules whose
 * subdirs end in the same segment are two units and would report under one name, which
 * is a live concern the moment a second provider lands beside `tracker/github`.
 */
export type OverlayUnitRef =
  | { readonly kind: 'provider'; readonly subdir: string }
  | { readonly kind: 'cross-cutting'; readonly dir: string };

/**
 * What a failed overlay unit left on disk.
 *
 * Populated from what the run actually did, because a failure does not imply a no-op.
 * One rendered sentence per arm (see `formatOverlaySummary` in src/cli/commands/init.ts):
 * a single shared sentence — "the previously installed files were left unchanged" — is
 * true of exactly one arm below. A flat set caught mid-promotion is part new and part
 * old, a unit whose displaced copy could not be put back has no live copy at all, and a
 * unit that was never installed is absent rather than stale; the worse the state, the
 * more a shared sentence would understate it.
 */
export type OverlayFailureState =
  /** Nothing was modified, and the unit's previously installed files are still in place. */
  | { readonly kind: 'installed-unchanged' }
  /**
   * Nothing was modified because there was nothing to modify: no copy of this unit is
   * installed, so the references it carries are absent from the skill the agent loads.
   */
  | { readonly kind: 'not-installed'; readonly absent: readonly string[] }
  /**
   * The flat set was caught mid-promotion — the gap `D-OVERLAY-FLAT-UNIT` documents.
   * `refreshed` documents carry this run's bytes, `stale` still carry the previous
   * install's; there is no directory to swap back.
   */
  | {
      readonly kind: 'partially-refreshed';
      readonly refreshed: readonly string[];
      readonly stale: readonly string[];
    }
  /**
   * A provider directory was displaced to its `.old` sibling and could not be put back.
   * Nothing lives at the installed path; `recoveryPath` holds the only copy, which is
   * why this run's prune is skipped rather than converging over it.
   */
  | {
      readonly kind: 'restore-failed';
      readonly recoveryPath: string;
      readonly restoreError: string;
    };

/** One overlay unit this run did not refresh — which unit, what it left, and why. */
export interface OverlayFailure {
  /** The unit that was not refreshed. */
  readonly unit: OverlayUnitRef;
  /** The state the unit's files were left in — the only claim a render site may make. */
  readonly state: OverlayFailureState;
  /** Rendered cause, already stringified so the report is serialisable. */
  readonly error: string;
}

/**
 * One spelling of a unit's name, for every message about it.
 *
 * Pure function — the installer owns the unit types, so it owns how they are named,
 * rather than leaving each render site to invent its own wording (avoids PF-013).
 */
export function overlayUnitLabel(unit: OverlayUnitRef): string {
  if (unit.kind === 'provider') return `provider directory "${unit.subdir}"`;
  return unit.dir === ''
    ? 'the cross-cutting document set'
    : `the cross-cutting document set in "${unit.dir}"`;
}

export interface ReferenceOverlayResult {
  /** Manifest-relative paths successfully installed by this run. */
  overlaidRefs: string[];
  /** Units this run did not refresh, each carrying the state it was left in. */
  overlayFailures: OverlayFailure[];
  /** Result of converging `references/tracker/**` to the manifest. */
  pruned: SweepResult;
}

/**
 * One atomically-swapped overlay unit.
 *
 * D-OVERLAY-FLAT-UNIT: the isolation unit is a DIRECTORY for the nested provider trees
 * (`tracker/{provider}/`) and the WHOLE FLAT SET for the provider-independent documents
 * — not one unit per flat file.
 *
 * A flat set's documents land beside entries the overlay must never replace or delete —
 * the references root holds hand-authored files (`github-api.md`, `violations.md`, …) and
 * `tracker/` holds the provider directories — so there is no directory to rename and no
 * `.tmp` sibling that could stand in for one. Which directory a flat set lands in is
 * therefore part of the unit (`dir`, `''` for the references root), because it is the one
 * thing that differs between them. What the flat set gets is the same DECISION rule as a
 * provider directory — build every
 * document under a staging tree first, and on any per-file failure abort the whole unit,
 * leaving all previously installed flat documents exactly as they were — promoted by one
 * `rename` per document. The promotion loop is the one place where a mid-flight I/O
 * error could leave the flat set partly refreshed; that is a property of the shared
 * directory, not a choice, and the report says so rather than glossing it —
 * {@link OverlayFailureState}'s `partially-refreshed` arm names which documents carry
 * this run's bytes and which still carry the previous install's.
 *
 * Treating each flat file as its own unit was the alternative. It was rejected because
 * documents that are always generated together and always read together would then report
 * independent outcomes, and a reader of `overlayFailures` could not tell a broken build
 * from a single unlucky file. Grouping by DIRECTORY keeps that property while giving each
 * shared directory its own outcome: the cross-cutting glossary failing says nothing about
 * the tool-call contract, and neither says anything about a provider.
 */
export type OverlayUnit = OverlayUnitRef & {
  /** Manifest-relative paths this unit owns. */
  readonly files: readonly string[];
};

/** The provider-directory arm of {@link OverlayUnit}, for the code that swaps one whole. */
type ProviderOverlayUnit = Extract<OverlayUnit, { kind: 'provider' }>;

/** The flat cross-cutting arm of {@link OverlayUnit}, for the code that renames it document by document. */
type CrossCuttingOverlayUnit = Extract<OverlayUnit, { kind: 'cross-cutting' }>;

/** The identity half of a unit, as the failure report carries it. */
function unitRef(unit: OverlayUnit): OverlayUnitRef {
  return unit.kind === 'provider'
    ? { kind: 'provider', subdir: unit.subdir }
    : { kind: 'cross-cutting', dir: unit.dir };
}

/** POSIX sub-path a unit's files land in under a root — `''` for the references root. */
function unitSubdir(unit: OverlayUnit): string {
  return unit.kind === 'provider' ? unit.subdir : unit.dir;
}

/**
 * Is this directory part a PROVIDER directory — a swappable directory of its own?
 *
 * `D-OVERLAY-PROVIDER-SHAPE`. Exactly `tracker/{provider}`, which is the only shape the
 * reference-module registry emits a directory for, and the only shape whose whole
 * directory may be renamed into place.
 *
 * The distinction is load-bearing rather than cosmetic, and it is what the previous
 * "any non-empty directory part is a provider" rule got wrong the first time the
 * manifest carried a file directly under `tracker/`. That entry bucketed to the
 * directory part `tracker`, which was then treated as a provider directory — so the
 * unit's atomic swap was a rename of `tracker/` ITSELF, over a directory whose other
 * entries are every provider's mechanics. Its staging sibling (`tracker.{token}.tmp`)
 * also sat OUTSIDE the subtree the prune converges, which is what
 * {@link stagingDirFor}'s second property exists to guarantee.
 */
function isProviderSubdir(subdir: string): boolean {
  const segments = subdir.split('/');
  return segments.length === 2 && segments[0] === TRACKER_SUBTREE && segments[1] !== '';
}

/**
 * Group a manifest into overlay units by the directory each entry lands in.
 *
 * Deterministic order — sorted by directory part — so a failure report and a loud throw
 * are reproducible run to run.
 *
 * Two kinds, decided by the SHAPE of the directory part ({@link isProviderSubdir}):
 * a `tracker/{provider}` directory is a provider unit and is swapped whole, and every
 * other directory holds a FLAT SET — documents that land beside entries this overlay
 * must never replace or delete, promoted one rename at a time. The references root is
 * one such directory (beside the hand-authored references) and `tracker/` is another
 * (beside the provider directories); both take the flat arm, which is why that arm
 * carries the directory it lands in rather than assuming the root.
 *
 * Exported for the one property no arm reading the INSTALLED tree can discriminate:
 * which KIND a directory becomes. The directory parts sort `'' < tracker <
 * tracker/{provider}`, so a `tracker/` entry mis-bucketed as a provider renames the
 * whole subtree into place BEFORE the provider units promote back into it, and the
 * installed tree ends up complete under either rule. The classification itself is the
 * observation that separates them (avoids PF-018).
 */
export function planOverlayUnits(manifest: readonly string[]): OverlayUnit[] {
  const bySubdir = new Map<string, string[]>();
  for (const relPath of manifest) {
    const segments = relPath.split('/');
    const subdir = segments.slice(0, -1).join('/');
    const bucket = bySubdir.get(subdir);
    if (bucket === undefined) bySubdir.set(subdir, [relPath]);
    else bucket.push(relPath);
  }
  return [...bySubdir.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([subdir, files]): OverlayUnit =>
      isProviderSubdir(subdir)
        ? { kind: 'provider', subdir, files }
        : { kind: 'cross-cutting', dir: subdir, files });
}

/** Resolve a POSIX manifest sub-path against a root, spelled for this filesystem. */
function underRoot(root: string, posixSubPath: string): string {
  return posixSubPath === '' ? root : path.join(root, ...posixSubPath.split('/'));
}

/**
 * Process-unique token every staging directory this run creates carries.
 *
 * `scripts/build-mds.ts` scopes its own staging path to the writing process for the same
 * reason and in the same idiom (`tempPathFor`: `${dest}.${process.pid}.tmp`). A FIXED
 * staging name was the one thing standing between two concurrent `devflow init` runs and a
 * PARTIAL unit promoted into an installed skill: the first thing
 * {@link buildUnitStagingTree} does to its staging path is
 * `fs.rm(stagingDir, { recursive: true, force: true })`, so under one shared name each run
 * deletes the other's half-built tree, and whichever reaches promotion second renames
 * whatever happened to survive into place — defeating the per-unit atomic swap outright.
 *
 * The pid is what makes two live runs disjoint. The timestamp is what makes a REUSED pid
 * disjoint from the run that crashed before it, so a tree stranded by that earlier run is
 * never mistaken for this one's own and adopted mid-build.
 *
 * Fixed for the life of the process so {@link stagingDirFor} stays a pure function of the
 * unit it is asked about: one path per unit, computed once and threaded from the build to
 * whichever promotion half consumes it.
 */
const STAGING_TOKEN = `${process.pid}-${Date.now().toString(36)}`;

/**
 * Staging directory for a unit — process-unique, under the subtree the prune converges.
 *
 * Both properties are about a run that is not this one:
 *
 * 1. The basename carries {@link STAGING_TOKEN}, so a concurrent run's staging tree is
 *    never the tree this one pre-cleans, builds into, or promotes.
 * 2. Both names resolve under `tracker/`, the subtree
 *    {@link prunePreservingRecoveryCopies} converges, so a staging tree stranded by a crash
 *    between `mkdir` and promotion is removed by the next run's prune. It HAS to be the
 *    prune that removes it, because (1) means no later run's pre-clean will ever look at
 *    that name again. A staging directory at the references root instead (say
 *    `references/.cross-cutting.tmp`) would sit outside that subtree and outside every
 *    other convergence this module performs, so a stranded partial copy of the
 *    cross-cutting documents would sit inside the installed skill indefinitely — and be
 *    mode-normalised by {@link chmodRecursive} on every later install, that being the one
 *    part of the overlay which does reach the whole references root.
 *
 * The provider arm inherits the property from its unit: the path is the unit's own
 * installed location plus a suffix, so it is converged exactly when the unit is, and every
 * provider subdir the reference-module registry declares is `tracker/{provider}`. A flat
 * arm has no installed location to hang a suffix on — its documents ARE the directory —
 * so it is placed under the converged subtree explicitly, under a name carrying its own
 * directory slug so two flat sets cannot share one staging path. The cost is that a
 * manifest carrying flat entries alone would create an empty `tracker/` on its way
 * through; the registry never produces one, and an empty directory is not a partial
 * install.
 *
 * No staging name can collide with a manifest entry, and the prune reaches them all for
 * the same reason it reaches the `.old` backups: it converges the `tracker/` subtree
 * against the manifest BY PATH, so anything under it the manifest does not name is
 * removed and no staging name has to be recognised as one. Not by spelling — a provider
 * arm's basename is `{provider}.{token}.tmp`, which is not dot-prefixed, so a rule keyed
 * on the name would reach the flat arm only.
 */
function stagingDirFor(referencesTarget: string, unit: OverlayUnit): string {
  if (unit.kind === 'provider') {
    return `${underRoot(referencesTarget, unit.subdir)}.${STAGING_TOKEN}.tmp`;
  }
  // One staging name per flat DIRECTORY. A name keyed only on the kind was unique
  // while exactly one flat set existed; with a second (the tool-call contract, which
  // lands in `tracker/` beside the provider directories) both units would pre-clean,
  // build into and promote from the SAME path — each deleting the other's half-built
  // tree, which is precisely the collision STAGING_TOKEN exists to prevent between
  // runs, reproduced within one.
  const slug = unit.dir === '' ? 'root' : unit.dir.split('/').join('-');
  return path.join(referencesTarget, TRACKER_SUBTREE, `.cross-cutting.${slug}.${STAGING_TOKEN}.tmp`);
}

/**
 * Build one unit's complete replacement tree under a `.tmp` sibling.
 *
 * Returns the staging directory on success, or the rendered cause when the unit must be
 * abandoned. Throws — and only throws — when a manifest entry is ABSENT from the
 * generated tree: that is a build artifact that was never produced, not an I/O
 * degradation, and shipping an installer that silently omits the mechanics the agent is
 * told to load would move the failure to every user's first spawn.
 *
 * Applies PF-011 (build under a `.tmp` sibling, pre-cleaning an orphan from a prior
 * crashed run). Applies PF-009 for everything else: a copy that fails aborts this unit
 * and no other.
 */
async function buildUnitStagingTree(
  unit: OverlayUnit,
  sourceRoot: string,
  referencesTarget: string,
  warn: (msg: string) => void,
): Promise<{ ok: true; stagingDir: string } | { ok: false; error: string }> {
  const stagingDir = stagingDirFor(referencesTarget, unit);
  const subdir = unitSubdir(unit);
  const sourceDir = underRoot(sourceRoot, subdir);
  const wanted = new Map(unit.files.map(relPath => [relPath.split('/').slice(-1)[0], relPath]));
  const landed = new Set<string>();

  const discard = async (): Promise<void> => {
    await fs.rm(stagingDir, { recursive: true, force: true }).catch(() => undefined);
  };

  try {
    await fs.rm(stagingDir, { recursive: true, force: true });
    await fs.mkdir(stagingDir, { recursive: true });
  } catch (err) {
    return { ok: false, error: String(err) };
  }

  let entries;
  try {
    entries = await fs.readdir(sourceDir, { withFileTypes: true });
  } catch (err) {
    await discard();
    return { ok: false, error: String(err) };
  }

  for (const entry of entries) {
    const relPath = subdir === '' ? entry.name : `${subdir}/${entry.name}`;

    // Symlinks are skipped, never followed. copyDirectory follows them and preserves
    // source modes, which is why the overlay does its own copying: a link planted in the
    // generated tree would otherwise pull arbitrary bytes into an installed skill.
    if (entry.isSymbolicLink()) {
      warn(`reference overlay: skipping symlink entry "${relPath}" — symlinks are never followed`);
      continue;
    }
    // A nested directory is another unit's business, and a source file the manifest does
    // not name is not installed at all: the overlay converges to the manifest, it does
    // not merge whatever happens to be lying in the generated tree.
    if (!entry.isFile()) continue;
    if (!wanted.has(entry.name)) continue;

    try {
      await fs.copyFile(path.join(sourceDir, entry.name), path.join(stagingDir, entry.name));
      landed.add(entry.name);
    } catch (err) {
      await discard();
      return { ok: false, error: String(err) };
    }
  }

  for (const [basename, relPath] of wanted) {
    if (landed.has(basename)) continue;
    await discard();
    throw new Error(
      `Generated skill reference not found for declared reference "${relPath}": ` +
      `${underRoot(sourceRoot, relPath)}. ` +
      `Run \`npm run build:mds\` to regenerate dist/skills/git/references/ before install.`,
    );
  }

  return { ok: true, stagingDir };
}

/** Outcome of promoting one unit — a failure carries the state it left on disk. */
export type UnitPromotion =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: string; readonly state: OverlayFailureState };

/**
 * Put a displaced unit back, and say whether it actually went back.
 *
 * A swallowed rename error would make a failed recovery indistinguishable from a
 * successful one: the install would report the previously installed files as unchanged
 * over a provider directory that no longer exists, and the prune would then delete the
 * backup holding the only copy. What this returns is what the failure state is built
 * from.
 */
async function restoreDisplacedUnit(
  backup: string,
  target: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await fs.rename(backup, target);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/**
 * How a promotion half records what its last completed step left on disk.
 *
 * Called as the promotion passes each point of no return, never reconstructed afterwards
 * — see {@link promoteUnitStagingTree}, which owns the recorded value and reports it.
 */
type RecordPromotionState = (state: OverlayFailureState) => void;

/**
 * Promote the flat cross-cutting set — one `rename` per document.
 *
 * There is no directory to swap. These documents land directly in `references/`, beside
 * hand-authored files the overlay must never replace or delete, so the unit is promoted one
 * `rename` per document and a mid-flight failure leaves it part new and part old
 * (D-OVERLAY-FLAT-UNIT, recorded on {@link OverlayUnit}). That is a weaker guarantee than
 * {@link promoteProviderUnit}'s whole-directory swap, which is why the recorded state
 * names which documents carry this run's bytes rather than claiming the set is untouched.
 *
 * Throws on the first failing rename; the caller reports the state recorded by then.
 */
async function promoteCrossCuttingUnit(
  unit: CrossCuttingOverlayUnit,
  referencesTarget: string,
  stagingDir: string,
  record: RecordPromotionState,
): Promise<void> {
  const destDir = underRoot(referencesTarget, unit.dir);
  // The directory this set lands in, created rather than assumed — {@link promoteProviderUnit}
  // does the same for its target's parent. The two flat directories the registry emits today
  // exist by the time promotion runs for reasons that have nothing to do with the unit landing
  // in them: the references root is created by {@link overlayGeneratedReferences}, and
  // `tracker/` as a side effect of this arm's own staging path. A flat set landing anywhere
  // else takes ENOENT on its first rename — a unit reported as failed for where it was asked
  // to land rather than for anything wrong with the documents it carries.
  await fs.mkdir(destDir, { recursive: true });
  for (const [index, relPath] of unit.files.entries()) {
    const basename = relPath.split('/').slice(-1)[0];
    await fs.rename(path.join(stagingDir, basename), path.join(destDir, basename));
    // Past the first rename the set is mixed, and there is no directory to swap back
    // (D-OVERLAY-FLAT-UNIT). The documents renamed so far carry this run's bytes; the
    // rest still carry the previous install's. Recorded after each rename so a failure
    // on the next one names both halves instead of claiming the set is untouched.
    record({
      kind: 'partially-refreshed',
      refreshed: unit.files.slice(0, index + 1),
      stale: unit.files.slice(index + 1),
    });
  }
  await fs.rm(stagingDir, { recursive: true, force: true });
}

/**
 * Promote a provider directory — swapped whole, or not at all.
 *
 * Displace the installed unit to a `.old` sibling, rename the staging tree into its
 * place, then drop the backup — so the installed directory is either entirely the
 * previous install or entirely the new one (DR-05, risk P2-g), and a rename that fails
 * half-way restores the previous one rather than leaving the provider empty.
 *
 * Throws once the state it left has been recorded; the caller reports it.
 */
async function promoteProviderUnit(
  unit: ProviderOverlayUnit,
  referencesTarget: string,
  stagingDir: string,
  record: RecordPromotionState,
): Promise<void> {
  const target = underRoot(referencesTarget, unit.subdir);
  await fs.mkdir(path.dirname(target), { recursive: true });

  // Move the installed unit ASIDE, never delete it, before the staging tree takes
  // its place. `rm(target)` then `rename(staging, target)` destroys the only copy
  // first: a rename that then fails leaves the provider with NO mechanics at all,
  // while the report — and the summary line init.ts renders from it — still claims
  // the previously installed files were left unchanged. The backup is what makes
  // that claim true, so a failed promotion is recoverable rather than a silent
  // deletion (avoids PF-009: a reported failure must describe the state it left).
  //
  // The `.old` sibling is pre-cleaned like the `.tmp` one. A crash that strands
  // either is converged away by a later run's tracker-subtree prune (both names end
  // in neither `/` nor `.md`, so no manifest entry can collide with them) — but the
  // backup this run is still relying on is exempt from this run's prune, which is
  // what `restore-failed` carries the recovery path for.
  const backup = `${target}.old`;
  await fs.rm(backup, { recursive: true, force: true });

  let displaced = false;
  try {
    await fs.rename(target, backup);
    displaced = true;
  } catch (err) {
    // Nothing installed yet — a first install has no unit to displace, so a failure
    // from here on leaves the unit ABSENT rather than stale.
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    record({ kind: 'not-installed', absent: unit.files });
  }

  try {
    await fs.rename(stagingDir, target);
  } catch (err) {
    if (displaced) {
      const restored = await restoreDisplacedUnit(backup, target);
      if (!restored.ok) {
        record({ kind: 'restore-failed', recoveryPath: backup, restoreError: restored.error });
      }
    }
    throw err;
  }

  await fs.rm(backup, { recursive: true, force: true }).catch(() => undefined);
}

/**
 * Promote a fully built staging tree into place, dispatched on what kind of unit it is.
 *
 * The two kinds are promoted by two different strategies with two different guarantees,
 * and each half states its own: {@link promoteProviderUnit} swaps a directory whole,
 * {@link promoteCrossCuttingUnit} renames the flat set document by document.
 *
 * What they share is the failure shape. A failure reports the state it left rather than a
 * state a failure is assumed to imply: `state` is advanced as the running half passes each
 * point of no return, so the catch describes the filesystem as it now is. That is the whole
 * difference between a report a user can act on and one that names a recovery copy the same
 * run went on to delete. Discarding the staging tree is shared for the same reason — an
 * abandoned unit leaves no `.tmp` residue, whichever half abandoned it.
 *
 * Exported for the sake of ONE property that cannot be driven through
 * {@link overlayGeneratedReferences}: a promotion that fails AFTER the installed unit has
 * been displaced. The overlay builds and promotes in the same breath, so there is no seam
 * at which a real filesystem failure can be injected between the two — and the behaviour
 * that failure selects (previous unit restored, not deleted) is exactly the one worth
 * pinning.
 */
export async function promoteUnitStagingTree(
  unit: OverlayUnit,
  referencesTarget: string,
  stagingDir: string,
): Promise<UnitPromotion> {
  let state: OverlayFailureState = { kind: 'installed-unchanged' };
  const record: RecordPromotionState = next => { state = next; };
  try {
    switch (unit.kind) {
      case 'cross-cutting':
        await promoteCrossCuttingUnit(unit, referencesTarget, stagingDir, record);
        break;
      case 'provider':
        await promoteProviderUnit(unit, referencesTarget, stagingDir, record);
        break;
      default: {
        const _exhaustive: never = unit;
        void _exhaustive;
        throw new Error('Unknown overlay unit kind');
      }
    }
    return { ok: true };
  } catch (err) {
    await fs.rm(stagingDir, { recursive: true, force: true }).catch(() => undefined);
    return { ok: false, error: String(err), state };
  }
}

/**
 * Which "nothing was modified" sentence is true for a unit whose build failed.
 *
 * A build failure touches nothing under the references root, so the unit is left in
 * whatever state it was already in — and those are two different states with two
 * different consequences. Falling back on a working previous install is a deferred
 * refresh; having no copy at all ships an agent whose mechanics pointers resolve to
 * nothing, which is the worse outcome and the one a shared sentence would describe
 * most quietly.
 *
 * One `access` per file, on the failure path only; the loop is bounded by the unit's
 * own manifest slice.
 */
async function classifyUntouchedUnit(
  unit: OverlayUnit,
  referencesTarget: string,
): Promise<OverlayFailureState> {
  const absent: string[] = [];
  for (const relPath of unit.files) {
    try {
      await fs.access(underRoot(referencesTarget, relPath));
    } catch {
      absent.push(relPath);
    }
  }
  return absent.length === unit.files.length
    ? { kind: 'not-installed', absent }
    : { kind: 'installed-unchanged' };
}

/**
 * Refuse the whole overlay when the generated tree was never produced.
 *
 * The per-entry throw in {@link buildUnitStagingTree} cannot reach this case. It is
 * raised after a successful `readdir` of a unit's source directory, so when the ROOT is
 * absent — `npm run build:cli` alone, or a build interrupted before it emitted anything —
 * no unit ever gets that far: each one degrades to a reported failure and the install
 * returns success carrying an agent whose mechanics pointers resolve to nothing. That is
 * the outcome the per-entry throw exists to prevent, arriving by the one route it does
 * not cover — and the same root cause the agent resolver in `installViaFileCopy` already
 * throws for, so the two build artifacts are guarded at the same strength.
 *
 * Deliberately ONE `stat` before the unit loop rather than a check inside it (PF-009):
 * the fan-out has no per-item failure isolation, so a per-unit refusal would let one
 * unbuilt provider abort every other unit's install. A unit directory that is absent
 * under a root that exists stays a per-unit report, exactly as today.
 *
 * Only ENOENT refuses. A root that cannot be stat'd for any other reason (EACCES on a
 * parent, a filesystem in a bad way) is an I/O degradation, not a missing build
 * artifact, and belongs to the per-unit reporting path like every other one.
 */
async function requireGeneratedTree(sourceRoot: string, manifest: readonly string[]): Promise<void> {
  try {
    await fs.stat(sourceRoot);
    return;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') return;
  }
  throw new Error(
    `Generated skill references not found: ${sourceRoot}. ` +
    `The whole generated tree is absent, so none of the ${manifest.length} references the ` +
    `devflow:git agent is instructed to load would be installed. ` +
    `Run \`npm run build:mds\` to regenerate dist/skills/git/references/ before install ` +
    `(\`npm run build:cli\` alone does not produce it).`,
  );
}

/**
 * Converge the tracker subtree to the manifest — unless that would delete a recovery
 * copy this same run just created.
 *
 * A promotion whose restore failed leaves the unit's ONLY surviving copy in its `.old`
 * sibling, which sits inside the subtree this prune converges and which the manifest
 * (rightly) does not name. Pruning it destroys the backup in the same run that reported
 * it as the way back, so the path the warning names is gone before the user reads it.
 *
 * Of the three ways to stop that, this is the one that leaves the SUCCESSFUL path
 * byte-identical — the same call, the same arguments, the same position in the run.
 * Moving the prune ahead of the unit loop would also spare the backup, but it converges
 * a tree the loop has not rebuilt yet: it reports removals the promotion would have made
 * anyway, and it mutates the install before the one throw path that aborts it. Excluding
 * `.old`/`.tmp` names from the walk would mean a new exclusion option on
 * sweepOrphanedReferences, i.e. changing the shape of a module this concern does not own.
 *
 * The skip is not silent. The unswept subtree is reported through `failed` — the same
 * channel that module uses for its own depth-bound breach — so nothing claims
 * convergence over ground it did not cover (avoids PF-009, PF-015). Orphans under
 * `tracker/` survive this install and the next one converges them.
 */
async function prunePreservingRecoveryCopies(
  trackerRoot: string,
  manifest: readonly string[],
  overlayFailures: readonly OverlayFailure[],
): Promise<SweepResult> {
  const stranded: string[] = [];
  for (const failure of overlayFailures) {
    if (failure.state.kind !== 'restore-failed') continue;
    if (!isContainedIn(trackerRoot, failure.state.recoveryPath)) continue;
    stranded.push(failure.state.recoveryPath);
  }

  if (stranded.length > 0) {
    return {
      scanned: 0,
      removed: [],
      failed: [{
        name: TRACKER_SUBTREE,
        error: new Error(
          `${TRACKER_SUBTREE}: the stale-reference prune was skipped — a promotion that ` +
          `could not be rolled back left the only surviving copy of its references in ` +
          `${stranded.join(', ')}, which this prune would delete in the same run that ` +
          `named it as the way back. Orphaned references under ${TRACKER_SUBTREE}/ ` +
          `survive this install; the next one converges them.`,
        ),
      }],
    };
  }

  // Keyed by relative path, because `tracker/{provider}/{op}.md` is what distinguishes
  // two providers' identically named files — the reason mdEntryName cannot serve here.
  const prefix = `${TRACKER_SUBTREE}/`;
  return sweepOrphanedReferences(
    trackerRoot,
    new Set(manifest.filter(p => p.startsWith(prefix)).map(p => p.slice(prefix.length))),
  );
}

/**
 * Converge an installed `devflow:git` references directory onto the generated tree.
 *
 * Converge, not merge — for the `tracker/` subtree, which is the whole of what converges.
 * Every unit is rebuilt from the generated sources and swapped in atomically, and anything
 * under `references/tracker/**` that the manifest does not name is then removed: a shadow
 * that supplies its own file under that subtree does not keep it (AC-2.4c), and a provider
 * directory the manifest stops listing is gone rather than left to rot (GAP-24).
 *
 * The references ROOT is overlaid but never pruned, and that is where the guarantee stops.
 * The flat cross-cutting documents land beside hand-authored references with no manifest of
 * which names are hand-authored to prune against (D-OVERLAY-FLAT-UNIT), so a document
 * retired from `GIT_CROSS_CUTTING_DOCS` keeps its installed copy until the skill directory
 * is replaced — the one convergence this module does not deliver, and the scope
 * CHANGELOG.md states for the shipped claim. A prunable flat root needs an allowlist of the
 * hand-authored names, which is a Phase-3 candidate rather than a Phase-2 omission.
 *
 * Runs for a shadowed and a canonical install alike: a user who overrides the git skill
 * must still receive the canonical GitHub mechanics the agent is told to load
 * (AC-2.4a / UAC-28).
 *
 * The prune runs last and yields to one thing only — a recovery copy this run itself
 * created and is still relying on (see {@link prunePreservingRecoveryCopies}). Every
 * unit this run did not refresh reaches `overlayFailures` carrying the state it was
 * actually left in, never a blanket claim that nothing changed.
 *
 * @param opts.referencesTarget - `{claudeDir}/skills/devflow:git/references`.
 * @param opts.sourceRoot - Generated tree; defaults to `compiledSkillRefsDir()`.
 * @param opts.manifest - Manifest to converge to; defaults to the build registries.
 *   Injectable so a provider set the GitHub-only build does not produce can be exercised.
 * @param opts.warn - Receives non-fatal notices (skipped symlinks, mode normalisation).
 *
 * @throws on three conditions, each of them a build artifact that was never produced
 *   rather than an I/O degradation. Every other failure is reported, never thrown
 *   (PF-009), and the three are ordered here as the function reaches them:
 *   1. `opts.manifest` omitted AND the reference-module registry does not expand —
 *      raised by {@link generatedReferenceManifest} while resolving the default. A
 *      caller that passes its own manifest cannot reach this one.
 *   2. `opts.sourceRoot` (default {@link compiledSkillRefsDir}) does not exist at all —
 *      see {@link requireGeneratedTree}. Nothing is installed and nothing is reported;
 *      the refusal is the whole outcome.
 *   3. A manifest entry is absent from a source directory that does exist — see
 *      {@link buildUnitStagingTree}. Raised mid-loop, so units planned before the
 *      failing one may already have been promoted.
 */
export async function overlayGeneratedReferences(opts: {
  referencesTarget: string;
  sourceRoot?: string;
  manifest?: readonly string[];
  warn?: (msg: string) => void;
}): Promise<ReferenceOverlayResult> {
  const sourceRoot = opts.sourceRoot ?? compiledSkillRefsDir();
  const manifest = opts.manifest ?? generatedReferenceManifest();
  const warn = opts.warn ?? (() => { /* notices are optional for callers with no logger */ });

  const overlaidRefs: string[] = [];
  const overlayFailures: OverlayFailure[] = [];

  // Before the target is touched, so a refused overlay leaves the install exactly as it
  // found it rather than a references directory it went on to abandon.
  await requireGeneratedTree(sourceRoot, manifest);

  await fs.mkdir(opts.referencesTarget, { recursive: true });

  for (const unit of planOverlayUnits(manifest)) {
    const built = await buildUnitStagingTree(unit, sourceRoot, opts.referencesTarget, warn);
    if (!built.ok) {
      overlayFailures.push({
        unit: unitRef(unit),
        state: await classifyUntouchedUnit(unit, opts.referencesTarget),
        error: built.error,
      });
      continue;
    }
    const promoted = await promoteUnitStagingTree(unit, opts.referencesTarget, built.stagingDir);
    if (!promoted.ok) {
      overlayFailures.push({ unit: unitRef(unit), state: promoted.state, error: promoted.error });
      continue;
    }
    overlaidRefs.push(...unit.files);
  }

  const pruned = await prunePreservingRecoveryCopies(
    path.join(opts.referencesTarget, TRACKER_SUBTREE),
    manifest,
    overlayFailures,
  );

  // D-OVERLAY-MODE-SCOPE: normalise the WHOLE references directory, not only the files
  // this run installed. copyDirectory preserves source modes, so a hand-authored
  // reference checked in with an odd mode installs with it; a reference is read-only
  // instruction text and 0644 is what every one of them should be. Best-effort: a
  // filesystem that does not honour mode bits must not fail an install (PF-009).
  //
  // This is the one step that reaches a file the overlay does not own, and it is why the
  // boundary is stated as "never replace or delete" rather than "never touch": the MODE of
  // a hand-authored reference — and of whatever a shadowed skill supplied outside
  // `tracker/` — is normalised here. ADR-024 corollary (b) permits exactly that: the
  // ownership guard protects deletion, not overwrite.
  //
  // It is also the one walk that can breach chmodRecursive's descent bound. The catch is
  // that breach's reporting channel, not just an I/O guard (see {@link chmodRecursive}).
  try {
    await chmodRecursive(opts.referencesTarget, 0o644);
  } catch (err) {
    warn(`reference overlay: could not normalise reference file modes — ${String(err)}`);
  }

  return { overlaidRefs, overlayFailures, pruned };
}

// ---------------------------------------------------------------------------
// Script composer
// ---------------------------------------------------------------------------

/** Matches relative ES import/export specifiers and dynamic import() calls. */
const IMPORT_RE = /(?:import|export)[\s\S]*?from\s*['"](\.[^'"]+)['"]|import\(\s*['"](\.[^'"]+)['"]\s*\)/g;

/** Extract all relative module specifiers from compiled JS source. */
function collectRelativeImports(source: string): string[] {
  const specs: string[] = [];
  for (const match of source.matchAll(IMPORT_RE)) {
    const spec = match[1] ?? match[2];
    if (spec) specs.push(spec);
  }
  return specs;
}

/**
 * Compose the ~/.devflow/scripts/ directory from:
 *   (a) src/assets/scripts/ verbatim (hooks/ + hud.sh) with executable bits preserved
 *   (b) Transitive closure of dist/hud/index.js compiled imports, mirrored
 *       under ~/.devflow/scripts/ at the same relative-to-dist/ paths
 *   (c) ~/.devflow/scripts/package.json → {"type":"module"}
 *
 * Frozen externally-referenced paths:
 *   ~/.devflow/scripts/hooks/run-hook   (hook bootstrap entry)
 *   ~/.devflow/scripts/hud.sh           (HUD entry script)
 */
export async function composeScripts(scriptsTarget: string): Promise<void> {
  await fs.mkdir(scriptsTarget, { recursive: true });

  // (a) src/assets/scripts/ verbatim
  const srcScripts = scriptsDir();
  try {
    await copyDirectory(srcScripts, scriptsTarget);
    if (process.platform !== 'win32') {
      await chmodRecursive(scriptsTarget, 0o755);
    }
  } catch { /* scripts dir may not exist yet during development */ }

  // (b) Walk dist/hud/ import graph and copy transitive deps
  const distRoot = path.join(getPackageRoot(), 'dist');
  const hudEntry = path.join(distRoot, 'hud', 'index.js');

  if (existsSync(hudEntry)) {
    const visited = new Set<string>();
    const queue: string[] = [hudEntry];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);

      // Copy file to target, preserving relative path from distRoot
      const rel = path.relative(distRoot, current);
      const destPath = path.join(scriptsTarget, rel);
      await fs.mkdir(path.dirname(destPath), { recursive: true });
      try {
        await fs.copyFile(current, destPath);
      } catch { /* file inaccessible — skip */ }

      // Collect imports for further walking
      let source: string;
      try {
        source = await fs.readFile(current, 'utf-8');
      } catch { continue; }

      const currentDir = path.dirname(current);
      for (const spec of collectRelativeImports(source)) {
        const resolved = path.resolve(currentDir, spec);
        if (!resolved.startsWith(distRoot + path.sep)) continue;
        if (!resolved.endsWith('.js')) continue;
        if (visited.has(resolved)) continue;
        const exists = await fs.access(resolved).then(() => true).catch(() => false);
        if (!exists) continue;
        queue.push(resolved);
      }
    }
  }

  // (c) package.json for ESM resolution
  const pkgJsonPath = path.join(scriptsTarget, 'package.json');
  try {
    await fs.writeFile(pkgJsonPath, '{"type":"module"}\n', { encoding: 'utf-8', flag: 'wx' });
  } catch { /* already exists from prior install — leave as-is */ }
}

// ---------------------------------------------------------------------------
// File copy installer
// ---------------------------------------------------------------------------

export interface FileCopyOptions {
  plugins: PluginDefinition[];
  claudeDir: string;
  devflowDir: string;
  skillsMap: Map<string, string>;
  agentsMap: Map<string, string>;
  /** Rules to install from selected plugins. Defaults to empty map (no rules). */
  rulesMap?: Map<string, string>;
  isPartialInstall: boolean;
  spinner: Spinner;
  /**
   * Agent source directories, most-preferred first — see agentSourceDirs(),
   * which owns the ordering convention and supplies the default. Injectable so
   * tests can prove the preference order against a temp tree instead of the
   * live build state.
   */
  agentSourceDirs?: AgentSourceDirs;
  /**
   * Receives non-fatal install notices that have no other reporting channel — today the
   * reference overlay's skipped symlinks and mode-normalisation failures. Defaults to a
   * no-op so callers with no logger are unaffected; `devflow init` passes its own.
   */
  warn?: (msg: string) => void;
}

/**
 * First path in `candidates` that exists on disk, or undefined when none do.
 * Bounded by candidates.length. The fs.access rejection is the existence probe,
 * not a failure: callers decide what an exhausted candidate list means.
 */
async function firstExisting(candidates: readonly string[]): Promise<string | undefined> {
  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch { /* not here — try the next directory in preference order */ }
  }
  return undefined;
}

/**
 * Records the result of a single orphan-sweep run into the install report.
 * Shared by every sweep-recording call site so each stays a one-liner and
 * the kind tag is always populated. (F14)
 */
function recordSweep(
  report: InstallReport,
  kind: SweptOrphan['kind'],
  sweep: SweepResult,
): void {
  report.sweptOrphans.push(...sweep.removed.map(name => ({ kind, name })));
  report.sweepFailures.push(...sweep.failed.map(f => ({ kind, name: f.name, error: f.error })));
}

/**
 * Install plugins via manual file copy.
 * Handles cleanup of old monolithic structure, deduplication of shared assets,
 * and script installation with executable permissions.
 *
 * Returns an InstallReport describing which shadows were applied and which were skipped.
 */
export async function installViaFileCopy(options: FileCopyOptions): Promise<InstallReport> {
  const {
    plugins,
    claudeDir,
    devflowDir,
    skillsMap,
    agentsMap,
    rulesMap = new Map<string, string>(),
    isPartialInstall,
    spinner,
    warn = () => { /* no-op: callers without a logger still get the full InstallReport */ },
  } = options;

  const report: InstallReport = {
    shadowedSkills: [],
    shadowedRules: [],
    skippedShadows: [],
    sweptOrphans: [],
    sweepFailures: [],
    overlaidRefs: [],
    overlayFailures: [],
  };

  // Clean old Devflow files before installing
  spinner.message('Cleaning old files...');
  if (!isPartialInstall) {
    // Commands and agents are plugin-scoped — only wipe on full install.
    // On partial installs the registry-diff sweeps below handle stale entries
    // without discarding assets from plugins not included in this run.
    const oldDirs = [
      path.join(claudeDir, 'commands', 'devflow'),
      path.join(claudeDir, 'agents', 'devflow'),
      path.join(claudeDir, 'rules', 'devflow'),
    ];
    for (const dir of oldDirs) {
      try {
        await fs.rm(dir, { recursive: true, force: true });
      } catch { /* ignore */ }
    }
  }

  // Sweep stale devflow:* skill dirs — ungated: runs on every install shape,
  // including partial installs, so renamed/deleted skills are pruned promptly.
  // knownNames spans ALL plugins (getAllSkillNames) so skills from uninstalled
  // plugins survive a partial run. Bare (pre-namespace) dirs are intentionally
  // untouched — they are handled by the frozen LEGACY_SKILLS_* lists in legacy.ts
  // (avoids PF-012: those lists are deletion manifests for pre-namespace paths and
  // must not be modified). Shadow dirs (~/.devflow/skills/) are keyed by bare
  // registry name and are unaffected by this sweep.
  // knownNames unions FEATURE_OWNED_SKILLS so feature-owned skills (e.g. devflow:compliance)
  // are never swept here. Their lifecycle is managed by convergeComplianceArtifacts, which
  // runs after installViaFileCopy in init.ts. Before I09 the compliance skill was swept and
  // then re-materialized by converge, creating a false-orphan report on every install.
  recordSweep(report, 'skill', await sweepOrphanedAssets(
    path.join(claudeDir, 'skills'),
    new Set([...getAllSkillNames(), ...FEATURE_OWNED_SKILLS]),
    (entry) => entry.startsWith(SKILL_NAMESPACE) ? unprefixSkillName(entry) : null,
  ));

  // Pre-clean the prefixed install targets before re-copying so stale content
  // never bleeds into a fresh install. Bare pre-namespace dirs at
  // ~/.claude/skills/{name} are owned solely by the frozen LEGACY_SKILL_NAMES
  // pass in init.ts (runs immediately after this call, init.ts:1149). A bare
  // dir whose name matches a current registry skill is by construction foreign
  // to Devflow and must not be touched here (avoids PF-012).
  const allSkills = new Set<string>();
  for (const plugin of DEVFLOW_PLUGINS) {
    for (const skill of plugin.skills) {
      allSkills.add(skill);
    }
  }
  for (const skill of allSkills) {
    // Remove prefixed directory (will be re-created during install phase)
    try {
      await fs.rm(path.join(claudeDir, 'skills', prefixSkillName(skill)), { recursive: true, force: true });
    } catch { /* ignore */ }
  }

  // Install commands from selected plugins using registry-driven lookup.
  // Source: dist/commands/{name}.md (single lookup directory for all commands).
  // A declared command with no compiled source file is a hard error, not a skip.
  spinner.message('Installing commands and agents...');
  const commandsTarget = path.join(claudeDir, 'commands', 'devflow');
  const cDir = commandsDir();
  const commandsSourceNames = new Set<string>();
  for (const plugin of plugins) {
    for (const cmd of plugin.commands) {
      const name = cmd.startsWith('/') ? cmd.slice(1) : cmd;
      commandsSourceNames.add(name);
    }
  }
  if (commandsSourceNames.size > 0) {
    await fs.mkdir(commandsTarget, { recursive: true });
    for (const name of commandsSourceNames) {
      const srcFile = path.join(cDir, mdFileName(name));
      try {
        await fs.access(srcFile);
      } catch {
        throw new Error(
          `Command source not found for declared command "${name}": ${srcFile}. ` +
          `Ensure build:mds ran successfully before install.`,
        );
      }
      await fs.copyFile(srcFile, path.join(commandsTarget, mdFileName(name)));
    }
  }

  // Sweep stale command files — ungated: runs on every install shape.
  // knownNames spans ALL plugins (getAllCommandNames) so commands from uninstalled
  // plugins survive a partial run. Only names absent from the full registry are removed.
  recordSweep(report, 'command', await sweepOrphanedAssets(
    commandsTarget,
    new Set(getAllCommandNames()),
    mdEntryName,
  ));

  // Install agents (deduplicated), resolved dist-first with a src fallback:
  // dist/agents/{name}.md (compiled from an .mds generator host) wins over
  // src/assets/agents/{name}.md. A declared agent absent from BOTH is a
  // build/packaging failure and throws rather than silently skipping (matches
  // command pattern); the message names the build step as well as the tree.
  const agentsTarget = path.join(claudeDir, 'agents', 'devflow');
  const agentDirs = options.agentSourceDirs ?? agentSourceDirs();
  const allAgentNames = new Set<string>();
  for (const plugin of plugins) {
    for (const agent of plugin.agents) {
      if (!allAgentNames.has(agent) && agentsMap.get(agent) === plugin.name) {
        allAgentNames.add(agent);
      }
    }
  }
  if (allAgentNames.size > 0) {
    await fs.mkdir(agentsTarget, { recursive: true });
    for (const agentName of allAgentNames) {
      const candidates = agentDirs.map(dir => path.join(dir, mdFileName(agentName)));
      const srcFile = await firstExisting(candidates);
      if (srcFile === undefined) {
        throw new Error(
          `Agent source not found for declared agent "${agentName}": ${candidates[0]}. ` +
          `Run \`npm run build:mds\` if it is compiled from an .mds generator host, otherwise ` +
          `ensure the agent file exists in src/assets/agents/ (searched: ${candidates.join(', ')}).`,
        );
      }
      await fs.copyFile(srcFile, path.join(agentsTarget, mdFileName(agentName)));
    }
  }

  // Sweep stale agent files — ungated: runs on every install shape.
  // knownNames spans ALL plugins (getAllAgentNames) so agents from uninstalled
  // plugins survive a partial run. Only names absent from the full registry are removed.
  recordSweep(report, 'agent', await sweepOrphanedAssets(
    agentsTarget,
    new Set(getAllAgentNames()),
    mdEntryName,
  ));

  // Install skills from ALL plugins (skillsMap covers all plugins, not just selected).
  // Resolved from flat src/assets/skills/{name}/ (no per-plugin subdirectory).
  // A declared skill whose source directory is absent is a build/packaging failure
  // and throws rather than silently skipping (matches command pattern).
  spinner.message('Installing skills...');
  for (const [skillName] of skillsMap) {
    const skillSource = path.join(skillsDir(), skillName);
    let isDir = false;
    try {
      const stat = await fs.stat(skillSource);
      isDir = stat.isDirectory();
    } catch { /* stat failed — source absent */ }
    if (!isDir) {
      throw new Error(
        `Skill source not found for declared skill "${skillName}": ${skillSource}. ` +
        `Ensure the skill directory exists in src/assets/skills/.`,
      );
    }

    const shadowDir = path.join(devflowDir, 'skills', skillName);
    const prefixedName = prefixSkillName(skillName);
    const skillTarget = path.join(claudeDir, 'skills', prefixedName);

    const shadowState = await validateSkillShadow(shadowDir);

    if (shadowState === 'valid') {
      await copyDirectory(shadowDir, skillTarget);
      report.shadowedSkills.push(skillName);
    } else if (shadowState === 'missing-skill-md') {
      report.skippedShadows.push({ kind: 'skill', name: skillName, reason: 'missing-skill-md' });
      await copyDirectory(skillSource, skillTarget);
    } else {
      await copyDirectory(skillSource, skillTarget);
    }

    // Converge the generated references onto the skill that was just installed. One call
    // site downstream of all three branches above, so a shadowed devflow:git receives the
    // canonical GitHub mechanics exactly as a canonical install does — AC-2.4a / UAC-28,
    // which is a release blocker, not merely an acceptance criterion.
    if (skillName === SKILL_REFS_SKILL_NAME) {
      const overlay = await overlayGeneratedReferences({
        referencesTarget: path.join(skillTarget, 'references'),
        warn,
      });
      report.overlaidRefs.push(...overlay.overlaidRefs);
      report.overlayFailures.push(...overlay.overlayFailures);
      recordSweep(report, 'reference', overlay.pruned);
    }
  }

  // Install rules from selected plugins (rulesMap covers selected plugins only).
  // Rules are flat .md files resolved from src/assets/rules/{name}.md (no per-plugin subdir).
  spinner.message('Installing rules...');
  const rulesTarget = path.join(claudeDir, 'rules', 'devflow');
  if (rulesMap.size > 0) {
    await fs.mkdir(rulesTarget, { recursive: true });
    const outcomes = await installAllRules(rulesMap, devflowDir, rulesTarget);
    for (const { ruleName, outcome } of outcomes) {
      if (outcome === 'shadow') {
        report.shadowedRules.push(ruleName);
      } else if (outcome === 'source-invalid-shadow:empty-shadow-file') {
        report.skippedShadows.push({ kind: 'rule', name: ruleName, reason: 'empty-shadow-file' });
      } else if (outcome === 'source-invalid-shadow:not-a-file') {
        report.skippedShadows.push({ kind: 'rule', name: ruleName, reason: 'not-a-file' });
      }
    }
  }

  // Install scripts via composer — keeps only what is needed at runtime
  // (no dev tooling, no raw TypeScript).
  spinner.message('Installing scripts...');
  const scriptsTarget = path.join(devflowDir, 'scripts');
  await composeScripts(scriptsTarget);

  spinner.stop('Components installed via file copy');
  return report;
}
