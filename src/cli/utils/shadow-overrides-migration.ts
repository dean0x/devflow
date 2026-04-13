import { promises as fs } from 'fs';
import * as path from 'path';
import { SHADOW_RENAMES } from '../plugins.js';

/**
 * @file shadow-overrides-migration.ts
 *
 * Extracted from migrateShadowOverrides in src/cli/commands/init.ts to enable
 * the migration registry (migrations.ts) to reference it without importing the
 * full init command module. All behaviour is preserved verbatim.
 */

async function shadowExists(shadowPath: string): Promise<boolean> {
  return fs.access(shadowPath).then(() => true, () => false);
}

/**
 * Migrate shadow skill overrides from old V2 skill names to new names.
 *
 * Groups SHADOW_RENAMES entries by their target name so that multiple old names
 * mapping to the same target (e.g. git-safety, git-workflow, github-patterns → git)
 * are processed sequentially within the group. Distinct-target groups run in
 * parallel via Promise.all, preserving throughput while eliminating the TOCTOU
 * race on shared targets.
 *
 * @param devflowDir - absolute path to the `~/.devflow` (or local `.devflow`) dir
 */
export async function migrateShadowOverridesRegistry(
  devflowDir: string,
): Promise<{ migrated: number; warnings: string[] }> {
  const shadowsRoot = path.join(devflowDir, 'skills');

  // Group entries by target name so many-to-one mappings are serialized.
  const groups = new Map<string, [string, string][]>();
  for (const entry of SHADOW_RENAMES) {
    const [, newName] = entry;
    const group = groups.get(newName) ?? [];
    group.push(entry);
    groups.set(newName, group);
  }

  // Process distinct-target groups in parallel; entries within each group run
  // sequentially so check-then-rename is effectively atomic per target.
  const groupResults = await Promise.all(
    [...groups.values()].map(async (entries) => {
      let migrated = 0;
      const warnings: string[] = [];

      for (const [oldName, newName] of entries) {
        const oldShadow = path.join(shadowsRoot, oldName);
        const newShadow = path.join(shadowsRoot, newName);

        if (!(await shadowExists(oldShadow))) continue;

        if (await shadowExists(newShadow)) {
          // Target already exists (from a previous entry in this group or a
          // pre-existing user shadow) — warn, don't overwrite
          warnings.push(
            `Shadow '${oldName}' found alongside '${newName}' — keeping '${newName}', old shadow at ${oldShadow}`,
          );
          continue;
        }

        // Target doesn't exist yet — rename
        await fs.rename(oldShadow, newShadow);
        migrated++;
      }

      return { migrated, warnings };
    }),
  );

  return {
    migrated: groupResults.reduce((sum, r) => sum + r.migrated, 0),
    warnings: groupResults.flatMap(r => r.warnings),
  };
}
