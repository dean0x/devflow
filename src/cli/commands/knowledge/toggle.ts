/**
 * Handle the enable/disable/status toggle actions for `devflow knowledge`.
 *
 * D-FEATURES-NARROW-ONLY (src/core/feature-switch.ts): knowledge write-back is
 * switched for the whole machine by `features.knowledge` in
 * ~/.devflow/manifest.json. `--enable`/`--disable` write that value — the same
 * one `devflow init --knowledge / --no-knowledge` writes — and `--status`
 * reports it, plus the repository's narrowing when a repo layer narrows it.
 */
import { promises as fs } from 'fs';
import * as path from 'path';
import * as p from '@clack/prompts';
import color from 'picocolors';
import { getGitRoot } from '../../../core/git.js';
import { getDevFlowDirectory } from '../../../targets/claude-code/claude-paths.js';
import { readMachineFeature, writeMachineFeature } from '../../../core/feature-switch.js';
import { loadSettingsModule, narrowedSwitchLabel, personalConfigTrackedWarning } from '../../../core/evidence-policy.js';
import { getFeaturesDir } from '../../../core/project-paths.js';

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

  const devflowDir = getDevFlowDirectory();

  if (options.status) {
    p.intro(color.cyan('Feature Knowledge Status'));
    const enabled = await readMachineFeature(devflowDir, 'knowledge');
    const kbCount = await countKnowledgeBases(await getWorktreePath());
    p.log.info(`Status: ${enabled ? color.green('enabled') : color.yellow('disabled')}`);
    const settingsModule = loadSettingsModule();
    const narrowed = enabled ? narrowedSwitchLabel(settingsModule, { dir: process.cwd() }, 'knowledge') : null;
    if (narrowed !== null) p.log.info(`Effective here: ${color.yellow(narrowed)}`);
    const trackedWarning = personalConfigTrackedWarning(settingsModule, { dir: process.cwd() });
    if (trackedWarning !== null) p.log.warn(trackedWarning);
    p.log.info(`Knowledge bases: ${kbCount}`);
    p.outro('');
    return;
  }

  const enabled = options.enable === true;
  p.intro(color.cyan(`${enabled ? 'Enable' : 'Disable'} Feature Knowledge Bases`));

  const recorded = await writeMachineFeature(devflowDir, 'knowledge', enabled);
  if (!recorded.ok) {
    p.log.error(`Devflow is not installed on this machine — run ${color.cyan('devflow init')} first`);
    process.exitCode = 1;
    p.outro('');
    return;
  }

  if (enabled) {
    p.log.success('Feature knowledge bases enabled in every project (a repository can opt out)');
    p.log.info('Knowledge bases are created automatically when workflows detect documented area changes.');
  } else {
    p.log.success('Feature knowledge bases disabled in every project');
    p.log.info('Existing knowledge bases preserved. Write-back skipped while disabled.');
  }
  p.outro('');
}
