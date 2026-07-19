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
 */
export function agentsDir(): string {
  return join(getPackageRoot(), 'src', 'assets', 'agents');
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
