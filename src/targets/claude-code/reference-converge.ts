/**
 * The references kind of the variant converge: make the installed `devflow:git` references
 * match the machine's compliance switch (AC-41, AC-50).
 *
 * `devflow init`, `devflow compliance` and `devflow curation` reach it through
 * convergeVariantAxes, so a compliance toggle needs no reinstall. It does, in order:
 *
 *   1. the overlay, with the manifest and the ONE source root of the switch
 *      (`installedReferenceManifest({ compliance })`, `skillRefsSourceDir`): it rewrites the
 *      references whose text differs between the two states and prunes the omitted
 *      operation files from `pr/` and `tracker/`. With compliance off the source root is the
 *      compliance-off tree, and an absent root is a failure that writes nothing: the converge
 *      never falls through to the compliance-on references;
 *   2. with compliance off, the removal list ({@link removeComplianceOffFiles});
 *      with compliance on, the restore of the files the skill copy puts in place
 *      ({@link restoreComplianceOffFiles}), from the source the install would copy.
 *
 * It acts on a skill that is ALREADY installed. A machine whose plugin selection holds no
 * `devflow:git` has nothing to converge, and that is a clean result. A skill directory, or a
 * `references` directory inside it, that is a link or not a directory is a failure: the overlay
 * would stage, prune and set modes through it. A full install empties the skill directory first and
 * so replaces such a link; this converge and a partial install have no such step, so each refuses
 * instead, on the same proof ({@link referencesHostState}).
 *
 * Never throws. Every failure is a warning and a `failures` entry, and the next step still
 * runs. With compliance off a caller reads `failures` and `stillPosting` and fails closed.
 */
import * as path from 'path';

import { skillRefsSourceDir } from '../../core/assets.js';
import { installedReferenceManifest, SKILL_REFS_SKILL_NAME } from '../../core/mds-variants.js';
import { getPackageRoot } from '../../core/paths.js';
import { prefixSkillName } from '../../core/plugins.js';
import { removeComplianceOffFiles, restoreComplianceOffFiles } from './compliance-off-files.js';
import type { BackupSession } from './install-backup.js';
import { overlayGeneratedReferences, overlayUnitLabel, referencesHostState, resolveSkillSource } from './installer.js';

export interface ConvergeReferencesOptions {
  /** Claude Code's config directory (e.g. ~/.claude). Must be absolute. */
  claudeDir: string;
  /** The machine root (~/.devflow), where skill shadows live. */
  devflowDir: string;
  /** The machine's settled compliance switch. */
  compliance: boolean;
  warn: (msg: string) => void;
  /** Package root the references and the skill sources are read from. Injectable for a temp tree; defaults to this package. */
  packageRoot?: string;
  /** The backup session of the run, for the removals the overlay makes in the references tree. */
  backups: BackupSession;
}

export interface ConvergeReferencesResult {
  /** True when nothing failed. */
  converged: boolean;
  /** Manifest-relative generated references this run wrote. */
  rewritten: readonly string[];
  /**
   * Files and folders this run removed below the skills folder, spelled as in
   * COMPLIANCE_OFF_REMOVED_SKILL_FILES: what the overlay's prune removed (a reference the manifest no
   * longer names), then, with compliance off, the files of that list. Retired files that the backup
   * session removed with its own list are in its record, not here.
   */
  removed: readonly string[];
  /** Skill files this run wrote back (compliance on), spelled as in COMPLIANCE_OFF_REMOVED_SKILL_FILES. */
  restored: readonly string[];
  /** Why the converge did not finish, one entry per failure. Empty when `converged`. */
  failures: readonly string[];
  /**
   * Installed files that could not be removed with compliance off, as absolute paths. A file
   * here is named and may still post. Empty with compliance on.
   */
  stillPosting: readonly string[];
  /**
   * True when a failure left the references themselves unproven (the overlay did not finish),
   * which no list of files can name. Always false with compliance on.
   */
  unproven: boolean;
}

export async function convergeReferences(opts: ConvergeReferencesOptions): Promise<ConvergeReferencesResult> {
  const { claudeDir, devflowDir, compliance, warn, backups } = opts;
  const failures: string[] = [];
  const fail = (message: string): void => {
    warn(`reference converge: ${message}`);
    failures.push(message);
  };

  // Precondition, asserted in production code: a relative claudeDir would resolve every
  // install target somewhere unexpected, the removals included.
  if (!path.isAbsolute(claudeDir)) {
    fail(`claudeDir is not an absolute path ("${claudeDir}") — skipping convergence`);
    return { converged: false, rewritten: [], removed: [], restored: [], failures, stillPosting: [], unproven: !compliance };
  }

  const root = opts.packageRoot ?? getPackageRoot();
  const skillsDir = path.join(claudeDir, 'skills');
  const gitSkillDir = path.join(skillsDir, prefixSkillName(SKILL_REFS_SKILL_NAME));
  const manifest = installedReferenceManifest({ compliance });

  let rewritten: readonly string[] = [];
  let unproven = false;
  const removed: string[] = [];

  const host = await referencesHostState(gitSkillDir);
  if (host.kind === 'refused') {
    fail(`${host.path} is not a real directory, so the references in it were not converged`);
    unproven = true;
  } else if (host.kind === 'ready') {
    try {
      const overlay = await overlayGeneratedReferences({
        referencesTarget: path.join(gitSkillDir, 'references'),
        sourceRoot: skillRefsSourceDir(compliance, root),
        manifest,
        warn,
        backups,
      });
      rewritten = overlay.overlaidRefs;
      for (const failure of overlay.overlayFailures) {
        fail(`${overlayUnitLabel(failure.unit)} was not refreshed (${failure.error})`);
        unproven = true;
      }
      for (const failed of overlay.pruned.failed) {
        fail(`could not prune ${failed.name} (${String(failed.error)})`);
        unproven = true;
      }
      // What the prune removed is named beside what the compliance-off list removes. The prune names
      // are relative to the references folder; this list spells them from the skills folder.
      removed.push(...overlay.pruned.removed.map(name => `${prefixSkillName(SKILL_REFS_SKILL_NAME)}/references/${name}`));
    } catch (err) {
      // The overlay throws for a packaging failure only: an absent source root, or a manifest entry
      // the root lacks. Nothing is written in either case, and nothing falls through to another root.
      fail(err instanceof Error ? err.message : String(err));
      unproven = true;
    }
  }

  const restored: string[] = [];
  const stillPosting: string[] = [];

  if (!compliance) {
    const removal = await removeComplianceOffFiles(skillsDir);
    removed.push(...removal.removed);
    for (const refusal of removal.refused) {
      fail(`${refusal.entry} was not removed — ${refusal.reason}`);
      stillPosting.push(path.join(skillsDir, ...refusal.entry.split('/')));
    }
  } else {
    // The overlay owns every generated reference (publication-gate.md among them), so the restore
    // writes back only the files that come from the skill source.
    const ownedByOverlay = new Set(manifest.map(rel => `${prefixSkillName(SKILL_REFS_SKILL_NAME)}/references/${rel}`));
    const restoration = await restoreComplianceOffFiles({
      skillsDir,
      sourceDirOf: async skill => (await resolveSkillSource(skill, devflowDir, opts.packageRoot)).dir,
      ownedElsewhere: ownedByOverlay,
    });
    restored.push(...restoration.restored);
    for (const refusal of restoration.refused) fail(`${refusal.entry} was not restored — ${refusal.reason}`);
  }

  return {
    converged: failures.length === 0,
    rewritten,
    removed,
    restored,
    failures,
    stillPosting: compliance ? [] : stillPosting,
    unproven: compliance ? false : unproven,
  };
}
