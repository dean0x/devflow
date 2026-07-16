/**
 * Handle the enable/disable/status toggle actions for `devflow knowledge`.
 *
 * The sole opt-out mechanism is the feature config `knowledge` field (config-only gate per ADR-001).
 */
import { promises as fs } from 'fs';
import * as path from 'path';
import * as p from '@clack/prompts';
import color from 'picocolors';
import { getGitRoot } from '../../utils/git.js';
import { getDevFlowDirectory } from '../../utils/paths.js';
import { readManifest, writeManifest } from '../../utils/manifest.js';
import { updateFeature, isFeatureEnabled } from '../../utils/feature-config.js';
import { getFeaturesDir } from '../../utils/project-paths.js';

async function getWorktreePath(): Promise<string> {
  return (await getGitRoot()) ?? process.cwd();
}

/** Count KNOWLEDGE.md files present in features/ */
async function countKnowledgeBases(worktreePath: string): Promise<number> {
  const featuresDir = getFeaturesDir(worktreePath);
  try {
    const entries = await fs.readdir(featuresDir, { withFileTypes: true });
    let count = 0;
    for (const dirent of entries) {
      if (!dirent.isDirectory() || dirent.name.startsWith('.')) continue;
      try {
        await fs.access(path.join(featuresDir, dirent.name, 'KNOWLEDGE.md'));
        count++;
      } catch { /* KNOWLEDGE.md absent */ }
    }
    return count;
  } catch {
    return 0;
  }
}

export async function handleToggle(options: { enable?: boolean; disable?: boolean; status?: boolean }): Promise<void> {
  if (!options.enable && !options.disable && !options.status) return;

  const worktreePath = await getWorktreePath();
  const devflowDir = getDevFlowDirectory();

  if (options.enable) {
    p.intro(color.cyan('Enable Feature Knowledge Bases'));

    // Update feature config (the sole gate — config-only per ADR-001)
    await updateFeature(worktreePath, 'knowledge', true);

    // Update manifest
    const manifest = await readManifest(devflowDir);
    if (manifest) {
      manifest.features.knowledge = true;
      manifest.updatedAt = new Date().toISOString();
      await writeManifest(devflowDir, manifest);
    }

    p.log.success('Feature knowledge bases enabled');
    p.log.info('Knowledge bases are created automatically when workflows detect documented area changes.');
    p.outro('');

  } else if (options.disable) {
    p.intro(color.cyan('Disable Feature Knowledge Bases'));

    // Update feature config (the sole gate — config-only per ADR-001)
    await updateFeature(worktreePath, 'knowledge', false);

    // Update manifest
    const manifest = await readManifest(devflowDir);
    if (manifest) {
      manifest.features.knowledge = false;
      manifest.updatedAt = new Date().toISOString();
      await writeManifest(devflowDir, manifest);
    }

    p.log.success('Feature knowledge bases disabled');
    p.log.info('Existing knowledge bases preserved. Write-back skipped while disabled.');
    p.outro('');

  } else {
    // options.status
    p.intro(color.cyan('Feature Knowledge Status'));

    const enabled = await isFeatureEnabled(worktreePath, 'knowledge');
    const kbCount = await countKnowledgeBases(worktreePath);

    p.log.info(`Status: ${enabled ? color.green('enabled') : color.yellow('disabled')}`);
    p.log.info(`Knowledge bases: ${kbCount}`);
    p.outro('');
  }
}
