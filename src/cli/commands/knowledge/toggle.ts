import * as path from 'path';
import { promises as fs } from 'fs';
import * as p from '@clack/prompts';
import color from 'picocolors';
import { getDevFlowDirectory } from '../../utils/paths.js';
import { readManifest, writeManifest } from '../../utils/manifest.js';
import { getFeatureKnowledge, getWorktreePath } from './shared.js';
import { updateFeature, isFeatureEnabled } from '../../utils/sidecar-config.js';

/**
 * Handle the enable/disable/status toggle actions for `devflow knowledge`.
 */
export async function handleToggle(options: { enable?: boolean; disable?: boolean; status?: boolean }): Promise<void> {
  if (!options.enable && !options.disable && !options.status) return;

  const worktreePath = await getWorktreePath();
  const devflowDir = getDevFlowDirectory();

  if (options.enable) {
    p.intro(color.cyan('Enable Feature Knowledge Bases'));

    // Create .features/index.json if missing
    const featuresDir = path.join(worktreePath, '.features');
    await fs.mkdir(featuresDir, { recursive: true });
    const indexPath = path.join(featuresDir, 'index.json');
    try {
      await fs.access(indexPath);
    } catch {
      await fs.writeFile(indexPath, JSON.stringify({ version: 1, features: {} }, null, 2) + '\n');
    }

    // Remove .disabled sentinel
    try { await fs.unlink(path.join(featuresDir, '.disabled')); } catch { /* doesn't exist */ }

    // Update sidecar config
    await updateFeature(worktreePath, 'knowledge', true);

    // Update manifest
    const manifest = await readManifest(devflowDir);
    if (manifest) {
      manifest.features.knowledge = true;
      manifest.updatedAt = new Date().toISOString();
      await writeManifest(devflowDir, manifest);
    }

    p.log.success('Feature knowledge bases enabled');
    p.outro(`Run ${color.cyan('devflow knowledge create <slug>')} to create a knowledge base.`);

  } else if (options.disable) {
    p.intro(color.cyan('Disable Feature Knowledge Bases'));

    // Create .disabled sentinel
    const featuresDir = path.join(worktreePath, '.features');
    await fs.mkdir(featuresDir, { recursive: true });
    await fs.writeFile(path.join(featuresDir, '.disabled'), '', 'utf-8');

    // Update sidecar config
    await updateFeature(worktreePath, 'knowledge', false);

    // Update manifest
    const manifest = await readManifest(devflowDir);
    if (manifest) {
      manifest.features.knowledge = false;
      manifest.updatedAt = new Date().toISOString();
      await writeManifest(devflowDir, manifest);
    }

    p.log.success('Feature knowledge bases disabled');
    p.log.info('Existing knowledge bases preserved. Manual commands (create/refresh) still work.');
    p.outro('');

  } else {
    // options.status
    p.intro(color.cyan('Feature Knowledge Status'));

    // Check sidecar config enabled state
    const enabled = await isFeatureEnabled(worktreePath, 'knowledge');

    // Check sentinel
    let disabled = false;
    try {
      await fs.access(path.join(worktreePath, '.features', '.disabled'));
      disabled = true;
    } catch { /* not disabled */ }

    // Count knowledge bases
    const kbs = getFeatureKnowledge().listEntries(worktreePath);

    p.log.info(`Status: ${(enabled && !disabled) ? color.green('enabled') : color.yellow('disabled')}`);
    p.log.info(`Sidecar: ${enabled ? color.green('enabled') : color.dim('disabled')}`);
    p.log.info(`Knowledge bases: ${kbs.length}`);
    if (disabled) {
      p.log.info(`Sentinel: ${color.yellow('.features/.disabled present')}`);
    }
    p.outro('');
  }
}
