import { join } from 'path';
import { getPackageRoot } from './paths.js';
import {
  COMPLIANCE_OFF_SKILL_REFS_OUTPUT_DIR,
  SKILL_REFS_OUTPUT_DIR,
  workflowFolderKey,
  workflowFoldersRootRelPath,
} from './mds-variants.js';
import {
  ALL_SWITCHES_ON,
  BOTH_OFF_OUTPUT_DIR,
  COMPLIANCE_OFF_OUTPUT_DIR,
  CURATION_OFF_OUTPUT_DIR,
  type VariantKey,
  type VariantKind,
  type VariantSwitches,
} from './curation-variants.js';

/**
 * Flat skills source directory: src/assets/skills/{name}/
 * All plugins' skills live here directly (no per-plugin subdirectory).
 *
 * @param root - Package root to resolve against. Injectable so a caller working
 *   on a temp tree (the curation converge) reads the skill source from the same
 *   root as the rest of its sources.
 */
export function skillsDir(root: string = getPackageRoot()): string {
  return join(root, 'src', 'assets', 'skills');
}

/**
 * Flat agents source directory: src/assets/agents/{name}.md, or {name}.mds for a
 * generator host. All plugins' agents live here directly.
 *
 * @param root - Package root to resolve against. Injectable so a caller working
 *   on a temp tree (the test harness) reads the layout from here rather than
 *   spelling the path itself.
 */
export function agentsDir(root: string = getPackageRoot()): string {
  return join(root, 'src', 'assets', 'agents');
}

/**
 * Flat rules source directory: src/assets/rules/{name}.md
 * All plugins' rules live here directly (no per-plugin subdirectory).
 */
export function rulesDir(): string {
  return join(getPackageRoot(), 'src', 'assets', 'rules');
}

/**
 * Scripts source directory: src/assets/scripts/
 * Contains hooks/ and hud.sh shipped with devflow.
 */
export function scriptsDir(): string {
  return join(getPackageRoot(), 'src', 'assets', 'scripts');
}

/**
 * Compiled commands directory: dist/commands/
 * Single lookup directory for installed commands: one compiled file per `.mds`
 * command host in src/assets/commands/. A host that carries a curation arm also
 * has a curation-off variant (see curationOffDir).
 */
export function commandsDir(): string {
  return join(getPackageRoot(), 'dist', 'commands');
}

/** Command source directories, most-preferred first and never empty. */
export type CommandSourceDirs = readonly [string, ...string[]];

/**
 * Curation-off variant directory: dist/curation-off/{commands,agents}/
 *
 * Holds the curation-off variant of each prompt that carries a curation arm
 * (D-LEARNING-VARIANTS), and only those. Absent until the build has run, so every
 * reader tolerates its absence.
 *
 * The spelling comes from CURATION_OFF_OUTPUT_DIR in curation-variants.ts, the
 * build's own destination, rather than being retyped here.
 *
 * @param kind - Which prompt kind's variants.
 * @param root - Package root to resolve against (see agentsDir).
 */
export function curationOffDir(kind: VariantKind, root: string = getPackageRoot()): string {
  return join(root, ...CURATION_OFF_OUTPUT_DIR.split('/'), kind);
}

/**
 * Compliance-off variant directory: dist/compliance-off/{commands,agents}/
 *
 * Holds the variant of each prompt that carries a compliance arm, and only those. A
 * machine with compliance off reads it. On a both-off machine it holds the file of a
 * host that has a compliance arm and no curation arm. Absent until the build has run,
 * so every reader tolerates its absence.
 *
 * @param kind - Which prompt kind's variants.
 * @param root - Package root to resolve against (see agentsDir).
 */
export function complianceOffDir(kind: VariantKind, root: string = getPackageRoot()): string {
  return join(root, ...COMPLIANCE_OFF_OUTPUT_DIR.split('/'), kind);
}

/**
 * Both-off variant directory: dist/curation-compliance-off/{commands,agents}/
 *
 * Holds the variant of each prompt that carries both arms, for a machine with curation
 * off and compliance off, and only those. Absent until the build has run.
 *
 * @param kind - Which prompt kind's variants.
 * @param root - Package root to resolve against (see agentsDir).
 */
export function bothOffDir(kind: VariantKind, root: string = getPackageRoot()): string {
  return join(root, ...BOTH_OFF_OUTPUT_DIR.split('/'), kind);
}

/**
 * The off-variant directories of one kind that a machine with these switches consults,
 * MOST-PREFERRED FIRST. Empty when both switches are on.
 *
 * The one place the two-axis order is spelled; commandSourceDirs and agentSourceDirs
 * both take it from here. A both-off machine consults the both-off tree first, then the
 * two single-axis trees. This order does not decide which file a compliance-armed host
 * must have. The installer requires the file built for the machine's exact switches, so
 * on a both-off machine a host with both arms needs its both-off file and never its
 * curation-off file.
 */
function offVariantDirs(
  kind: VariantKind,
  { curation, compliance }: VariantSwitches,
  root: string,
): readonly string[] {
  if (!curation && !compliance) {
    return [bothOffDir(kind, root), curationOffDir(kind, root), complianceOffDir(kind, root)];
  }
  if (!compliance) return [complianceOffDir(kind, root)];
  if (!curation) return [curationOffDir(kind, root)];
  return [];
}

/**
 * Prepend the off-variant directories to the normal lookup, keeping the list non-empty
 * in the type.
 */
function preferOff(
  off: readonly string[],
  normal: readonly [string, ...string[]],
): readonly [string, ...string[]] {
  return off.length === 0 ? normal : [off[0], ...off.slice(1), ...normal];
}

/**
 * Command source directories, MOST-PREFERRED FIRST.
 *
 * D-LEARNING-VARIANT-INSTALL: with an axis off, the off-variant directories come
 * first, so a host with an arm installs its off variant and a host with none falls
 * through to the one compiled file. With both axes on the order is the normal
 * single-directory lookup.
 *
 * @param switches - The machine's settled curation and compliance switches.
 * @param root - Package root to resolve against (see agentsDir).
 */
export function commandSourceDirs(
  switches: VariantSwitches,
  root: string = getPackageRoot(),
): CommandSourceDirs {
  return preferOff(offVariantDirs('commands', switches, root), [join(root, 'dist', 'commands')]);
}

/**
 * Compiled agents directory: dist/agents/{name}.md
 *
 * Output of the .mds generator hosts. The directory is absent until the build has
 * run, so every reader must tolerate its absence.
 *
 * @param root - Package root to resolve against (see agentsDir).
 */
export function compiledAgentsDir(root: string = getPackageRoot()): string {
  return join(root, 'dist', 'agents');
}

/**
 * Compiled skill-reference directory: dist/skills/git/references/
 *
 * Output of the `.mds` reference modules — the generated `devflow:git` mechanics
 * files, one per (provider, operation) pair under `tracker/{provider}/`. Like
 * compiledAgentsDir(), the directory is absent until the build has run, so every
 * reader must tolerate its absence.
 *
 * The spelling comes from SKILL_REFS_OUTPUT_DIR in src/core/mds-variants.ts —
 * the build's own allowlist table — rather than being retyped here, so the
 * destination has exactly one definition.
 *
 * @param root - Package root to resolve against (see agentsDir).
 */
export function compiledSkillRefsDir(root: string = getPackageRoot()): string {
  return join(root, ...SKILL_REFS_OUTPUT_DIR.split('/'));
}

/**
 * Compiled compliance-off skill-reference directory:
 * dist/compliance-off/skills/git/references/
 *
 * The ONE source root a compliance-off install and the compliance converge overlay the
 * references from (AC-50). The tree is complete: it holds every file of the compliance-off
 * manifest, so the reader never falls back to {@link compiledSkillRefsDir}. Absent until
 * the build has run, so every reader must tolerate its absence.
 *
 * @param root - Package root to resolve against (see agentsDir).
 */
export function compiledComplianceOffSkillRefsDir(root: string = getPackageRoot()): string {
  return join(root, ...COMPLIANCE_OFF_SKILL_REFS_OUTPUT_DIR.split('/'));
}

/**
 * The reference source root for a machine's compliance switch: the compliance-off tree with
 * compliance off, else the compliance-on one. One function, so the install, the converge and
 * the status read cannot pick different roots for one switch.
 *
 * @param compliance - The machine's settled compliance switch.
 * @param root - Package root to resolve against (see agentsDir).
 */
export function skillRefsSourceDir(compliance: boolean, root: string = getPackageRoot()): string {
  return compliance ? compiledSkillRefsDir(root) : compiledComplianceOffSkillRefsDir(root);
}

/**
 * Compiled workflow skill folders directory of one variant key: dist/workflows/ for the
 * `on` key, else <variant tree>/workflows/. Each holds one folder per registered
 * workflow skill, complete for that key.
 *
 * The spelling comes from workflowFoldersRootRelPath in src/core/mds-variants.ts, the
 * build's own destination, rather than being retyped here. Absent until the build has
 * run, and empty of folders while no folder is registered, so every reader must
 * tolerate both.
 *
 * @param key - The variant key whose folders to read.
 * @param root - Package root to resolve against (see agentsDir).
 */
export function compiledWorkflowFoldersDir(key: VariantKey, root: string = getPackageRoot()): string {
  return join(root, ...workflowFoldersRootRelPath(key).split('/'));
}

/**
 * The workflow folders source root for a machine's switches: the tree built for exactly
 * those switches. One function, so the install, the converge and the status read cannot
 * pick different roots for one pair of switches.
 *
 * D-WORKFLOW-FOLDER-BUILD: a SINGLE root, never a preference list. A folder is complete
 * under every key, so no reader merges two trees, and a both-off machine never falls
 * through to a tree that still carries the text of an axis it switched off (the failure
 * commandSourceDirs' consumers guard against with an exact-key check).
 *
 * @param switches - The machine's settled curation and compliance switches.
 * @param root - Package root to resolve against (see agentsDir).
 */
export function workflowFoldersSourceDir(switches: VariantSwitches, root: string = getPackageRoot()): string {
  return compiledWorkflowFoldersDir(workflowFolderKey(switches), root);
}

/**
 * Agent source directories, MOST-PREFERRED FIRST.
 *
 * The single owner of the dist-first agent-resolution policy: a generator
 * host's compiled artifact in dist/agents/ supersedes a hand-authored file of
 * the same name in src/assets/agents/. Every consumer reads the order from
 * here — the installer's first-hit-wins resolve, loadShippedAgentDefaults's
 * first-wins merge, and the test harness's resolveAgentSource — so the
 * convention is stated once and cannot drift apart between call sites.
 *
 * Order is invisible to the type system: a list spelled least-preferred-first
 * still typechecks and silently inverts the answer. Consumers therefore take
 * this list as-is and never re-spell it; tests/guards/agent-source-precedence
 * pins that they agree.
 *
 * The non-empty tuple makes an empty list a compile error at every call site:
 * an empty list would survive a `??` default and resolve to nothing.
 *
 * D-LEARNING-VARIANT-INSTALL: an axis that is off puts its off-variant directories
 * first (see commandSourceDirs), for the installer and the converge only. The default
 * (both on) is the order every other reader wants: the shipped defaults (model, effort)
 * are the same in every variant, so loadShippedAgentDefaults and the test harness keep
 * reading the both-on tree.
 *
 * @param root - Package root to resolve against (see agentsDir).
 * @param switches - The machine's settled curation and compliance switches; every switch on by default.
 */
export function agentSourceDirs(
  root: string = getPackageRoot(),
  switches: VariantSwitches = ALL_SWITCHES_ON,
): AgentSourceDirs {
  return preferOff(
    offVariantDirs('agents', switches, root),
    [compiledAgentsDir(root), agentsDir(root)],
  );
}

/** Agent source directories, most-preferred first and never empty. */
export type AgentSourceDirs = readonly [string, ...string[]];
