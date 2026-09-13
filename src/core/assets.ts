import { join } from 'path';
import { getPackageRoot } from './paths.js';

/**
 * Flat skills source directory: src/assets/skills/{name}/
 * All plugins' skills live here directly (no per-plugin subdirectory).
 */
export function skillsDir(): string {
  return join(getPackageRoot(), 'src', 'assets', 'skills');
}

/**
 * Flat agents source directory: src/assets/agents/{name}.md
 * All plugins' agents live here directly.
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
 * Single lookup directory for installed commands — .mds compile output
 * plus verbatim hand-authored .md copies.
 */
export function commandsDir(): string {
  return join(getPackageRoot(), 'dist', 'commands');
}

/**
 * Compiled agents directory: dist/agents/{name}.md
 *
 * Output of the .mds generator hosts. The directory is absent until at least
 * one generator host exists, so every reader must tolerate its absence.
 *
 * @param root - Package root to resolve against (see agentsDir).
 */
export function compiledAgentsDir(root: string = getPackageRoot()): string {
  return join(root, 'dist', 'agents');
}

/**
 * Agent source directories, MOST-PREFERRED FIRST.
 *
 * The single owner of the dist-first agent-resolution policy: a generator
 * host's compiled artifact in dist/agents/ supersedes a hand-authored file of
 * the same name in src/assets/agents/. Every consumer reads the order from
 * here — the installer's first-hit-wins resolve, loadShippedDefaults's
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
 * @param root - Package root to resolve against (see agentsDir).
 */
export function agentSourceDirs(root: string = getPackageRoot()): AgentSourceDirs {
  return [compiledAgentsDir(root), agentsDir(root)];
}

/** Agent source directories, most-preferred first and never empty. */
export type AgentSourceDirs = readonly [string, ...string[]];
