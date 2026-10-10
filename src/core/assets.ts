import { join } from 'path';
import { getPackageRoot } from './paths.js';
import { SKILL_REFS_OUTPUT_DIR } from './mds-variants.js';
import { LEARNING_OFF_OUTPUT_DIR, type LearningVariantKind } from './learning-variants.js';

/**
 * Flat skills source directory: src/assets/skills/{name}/
 * All plugins' skills live here directly (no per-plugin subdirectory).
 *
 * @param root - Package root to resolve against. Injectable so a caller working
 *   on a temp tree (the learning converge) reads the skill source from the same
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
 * command host in src/assets/commands/. A host that carries a learning arm also
 * has a learning-off variant (see learningOffDir).
 */
export function commandsDir(): string {
  return join(getPackageRoot(), 'dist', 'commands');
}

/** Command source directories, most-preferred first and never empty. */
export type CommandSourceDirs = readonly [string, ...string[]];

/**
 * Learning-off variant directory: dist/learning-off/{commands,agents}/
 *
 * Holds the learning-off variant of each prompt that carries a learning arm
 * (D-LEARNING-VARIANTS), and only those. Absent until the build has run, so every
 * reader tolerates its absence.
 *
 * The spelling comes from LEARNING_OFF_OUTPUT_DIR in learning-variants.ts, the
 * build's own destination, rather than being retyped here.
 *
 * @param kind - Which prompt kind's variants.
 * @param root - Package root to resolve against (see agentsDir).
 */
export function learningOffDir(kind: LearningVariantKind, root: string = getPackageRoot()): string {
  return join(root, ...LEARNING_OFF_OUTPUT_DIR.split('/'), kind);
}

/**
 * Command source directories, MOST-PREFERRED FIRST.
 *
 * D-LEARNING-VARIANT-INSTALL: with learning off the learning-off variant comes
 * first, so a host with an arm installs its off variant and a host with none falls
 * through to the one compiled file; with learning on the order is the normal
 * single-directory lookup.
 *
 * @param learning - The machine's settled learning switch.
 * @param root - Package root to resolve against (see agentsDir).
 */
export function commandSourceDirs(learning: boolean, root: string = getPackageRoot()): CommandSourceDirs {
  const normal = join(root, 'dist', 'commands');
  return learning ? [normal] : [learningOffDir('commands', root), normal];
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
 * D-LEARNING-VARIANT-INSTALL: `learning: false` puts dist/learning-off/agents first,
 * for the installer and the converge only. The default (learning on) is the order
 * every other reader wants: the shipped defaults (model, effort) are the same in
 * both variants, so loadShippedAgentDefaults and the test harness keep reading the
 * learning-on tree.
 *
 * @param root - Package root to resolve against (see agentsDir).
 * @param learning - The machine's settled learning switch; on by default.
 */
export function agentSourceDirs(root: string = getPackageRoot(), learning: boolean = true): AgentSourceDirs {
  const normal = [compiledAgentsDir(root), agentsDir(root)] as const;
  return learning ? normal : [learningOffDir('agents', root), ...normal];
}

/** Agent source directories, most-preferred first and never empty. */
export type AgentSourceDirs = readonly [string, ...string[]];
