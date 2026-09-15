import { promises as fs } from 'fs';
import { existsSync } from 'fs';
import * as path from 'path';
import type { PluginDefinition } from '../../core/plugins.js';
import { DEVFLOW_PLUGINS, SKILL_NAMESPACE, prefixSkillName, unprefixSkillName, getAllSkillNames, getAllAgentNames, getAllCommandNames, FEATURE_OWNED_SKILLS } from '../../core/plugins.js';
import { skillsDir, agentSourceDirs, rulesDir, commandsDir, scriptsDir, compiledSkillRefsDir, type AgentSourceDirs } from '../../core/assets.js';
import { getPackageRoot } from '../../core/paths.js';
import { sweepOrphanedAssets, mdFileName, mdEntryName, type SweepResult } from '../../core/orphan-sweep.js';
import { generatedReferenceManifest, SKILL_REFS_SKILL_NAME } from '../../core/mds-variants.js';
import { sweepOrphanedReferences } from '../../core/reference-sweep.js';

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
   * Overlay units left byte-unchanged because their replacement could not be built.
   * The install still succeeds (PF-009); a unit named here is running on the files the
   * previous install left, which is exactly what the summary has to say out loud.
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
 * Recursively chmod all files in a directory tree.
 */
export async function chmodRecursive(dir: string, mode: number): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await chmodRecursive(fullPath, mode);
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

/** Unit id reported for the flat, provider-independent document set. */
const CROSS_CUTTING_UNIT_ID = '(cross-cutting)';

/** One failed overlay unit — the unit's id and why it was left alone. */
export interface OverlayFailure {
  /**
   * The unit that was not refreshed: a provider directory name (`github`) or
   * {@link CROSS_CUTTING_UNIT_ID} for the flat document set.
   */
  provider: string;
  /** Rendered cause, already stringified so the report is serialisable. */
  error: string;
}

export interface ReferenceOverlayResult {
  /** Manifest-relative paths successfully installed by this run. */
  overlaidRefs: string[];
  /** Units left byte-unchanged because building their replacement failed. */
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
 * The flat documents land directly in `references/`, beside hand-authored files the
 * overlay must never touch (`github-api.md`, `violations.md`, …), so there is no
 * directory to rename and no `.tmp` sibling that could stand in for one. What the flat
 * set therefore gets is the same DECISION rule as a provider directory — build every
 * document under a staging tree first, and on any per-file failure abort the whole unit,
 * leaving all previously installed flat documents exactly as they were — promoted by one
 * `rename` per document. The promotion loop is the one place where a mid-flight I/O
 * error could leave the flat set partly refreshed; that is a property of the shared
 * directory, not a choice, and such a failure is reported like any other.
 *
 * Treating each flat file as its own unit was the alternative. It was rejected because
 * three documents that are always generated together and always read together would
 * then report three independent outcomes, and a reader of `overlayFailures` could not
 * tell a broken build from a single unlucky file.
 */
export interface OverlayUnit {
  /** Reported on {@link OverlayFailure.provider}. */
  id: string;
  /** POSIX sub-path under the references root, or `''` for the flat set. */
  subdir: string;
  /** Manifest-relative paths this unit owns. */
  files: string[];
}

/**
 * Group a manifest into overlay units by the directory each entry lands in.
 *
 * Deterministic order — flat set first, then provider directories sorted by path — so a
 * failure report and a loud throw are reproducible run to run.
 */
function planOverlayUnits(manifest: readonly string[]): OverlayUnit[] {
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
    .map(([subdir, files]) => ({
      id: subdir === '' ? CROSS_CUTTING_UNIT_ID : subdir.split('/').slice(-1)[0],
      subdir,
      files,
    }));
}

/** Resolve a POSIX manifest sub-path against a root, spelled for this filesystem. */
function underRoot(root: string, posixSubPath: string): string {
  return posixSubPath === '' ? root : path.join(root, ...posixSubPath.split('/'));
}

/** Staging sibling for a unit — a `.tmp` name that can never collide with a manifest entry. */
function stagingDirFor(referencesTarget: string, unit: OverlayUnit): string {
  return unit.subdir === ''
    ? path.join(referencesTarget, '.cross-cutting.tmp')
    : `${underRoot(referencesTarget, unit.subdir)}.tmp`;
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
  const sourceDir = underRoot(sourceRoot, unit.subdir);
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
    const relPath = unit.subdir === '' ? entry.name : `${unit.subdir}/${entry.name}`;

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

/**
 * Promote a fully built staging tree into place.
 *
 * A provider directory is swapped whole — displace the installed unit to a `.old`
 * sibling, rename the staging tree into its place, then drop the backup — so the
 * installed directory is either entirely the previous install or entirely the new one
 * (DR-05, risk P2-g), and a rename that fails half-way restores the previous one rather
 * than leaving the provider empty. The flat set is promoted one `rename` per document
 * because its directory is shared with hand-authored references (D-OVERLAY-FLAT-UNIT).
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
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    if (unit.subdir === '') {
      for (const relPath of unit.files) {
        const basename = relPath.split('/').slice(-1)[0];
        await fs.rename(path.join(stagingDir, basename), path.join(referencesTarget, basename));
      }
      await fs.rm(stagingDir, { recursive: true, force: true });
      return { ok: true };
    }

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
    // The `.old` sibling is pre-cleaned like the `.tmp` one, and a crash that strands
    // either is converged away by the tracker-subtree prune below (both names end in
    // neither `/` nor `.md`, so no manifest entry can collide with them).
    const backup = `${target}.old`;
    await fs.rm(backup, { recursive: true, force: true });

    let displaced = false;
    try {
      await fs.rename(target, backup);
      displaced = true;
    } catch (err) {
      // Nothing installed yet — a first install has no unit to displace.
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }

    try {
      await fs.rename(stagingDir, target);
    } catch (err) {
      if (displaced) await fs.rename(backup, target).catch(() => undefined);
      throw err;
    }

    await fs.rm(backup, { recursive: true, force: true }).catch(() => undefined);
    return { ok: true };
  } catch (err) {
    await fs.rm(stagingDir, { recursive: true, force: true }).catch(() => undefined);
    return { ok: false, error: String(err) };
  }
}

/**
 * Converge an installed `devflow:git` references directory onto the generated tree.
 *
 * Converge, not merge: every unit is rebuilt from the generated sources and swapped in
 * atomically, and anything under `references/tracker/**` that the manifest does not name
 * is then removed. A shadow that supplies its own file under that subtree therefore does
 * not keep it (AC-2.4c), and a provider directory the manifest stops listing is
 * gone rather than left to rot (GAP-24). Hand-authored references outside the generated
 * set are never pruned — they arrive with the skill copy and the prune is scoped to the
 * `tracker/` subtree.
 *
 * Runs for a shadowed and a canonical install alike: a user who overrides the git skill
 * must still receive the canonical GitHub mechanics the agent is told to load
 * (AC-2.4a / UAC-28).
 *
 * @param opts.referencesTarget - `{claudeDir}/skills/devflow:git/references`.
 * @param opts.sourceRoot - Generated tree; defaults to `compiledSkillRefsDir()`.
 * @param opts.manifest - Manifest to converge to; defaults to the build registries.
 *   Injectable so a provider set the GitHub-only build does not produce can be exercised.
 * @param opts.warn - Receives non-fatal notices (skipped symlinks, mode normalisation).
 *
 * @throws when a manifest entry is absent from the generated tree — see
 *   {@link buildUnitStagingTree}. Every other failure is reported, never thrown (PF-009).
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

  await fs.mkdir(opts.referencesTarget, { recursive: true });

  for (const unit of planOverlayUnits(manifest)) {
    const built = await buildUnitStagingTree(unit, sourceRoot, opts.referencesTarget, warn);
    if (!built.ok) {
      overlayFailures.push({ provider: unit.id, error: built.error });
      continue;
    }
    const promoted = await promoteUnitStagingTree(unit, opts.referencesTarget, built.stagingDir);
    if (!promoted.ok) {
      overlayFailures.push({ provider: unit.id, error: promoted.error });
      continue;
    }
    overlaidRefs.push(...unit.files);
  }

  // Converge the tracker subtree to the manifest. Keyed by relative path, because
  // `tracker/{provider}/{op}.md` is what distinguishes two providers' identically named
  // files — the reason mdEntryName cannot serve here.
  const prefix = `${TRACKER_SUBTREE}/`;
  const pruned = await sweepOrphanedReferences(
    path.join(opts.referencesTarget, TRACKER_SUBTREE),
    new Set(manifest.filter(p => p.startsWith(prefix)).map(p => p.slice(prefix.length))),
  );

  // D-OVERLAY-MODE-SCOPE: normalise the WHOLE references directory, not only the files
  // this run installed. copyDirectory preserves source modes, so a hand-authored
  // reference checked in with an odd mode installs with it; a reference is read-only
  // instruction text and 0644 is what every one of them should be. Best-effort: a
  // filesystem that does not honour mode bits must not fail an install (PF-009).
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
 * Extracted from the thrice-repeated inline block to keep each call-site a
 * one-liner and ensure the kind tag is always populated. (F14)
 */
function recordSweep(
  report: InstallReport,
  kind: SweptOrphan['kind'],
  sweep: Awaited<ReturnType<typeof sweepOrphanedAssets>>,
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
