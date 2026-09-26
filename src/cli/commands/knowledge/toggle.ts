/**
 * Handle the enable/disable/status toggle actions for `devflow knowledge`.
 *
 * Knowledge write-back runs in a repo only when BOTH switches allow it
 * (D-KNOWLEDGE-MASTER-SWITCH, src/core/feature-switch.ts): the machine-wide
 * `features.knowledge` in ~/.devflow/manifest.json, owned by `devflow init`, and
 * this repo's `knowledge` field in .devflow/config.json, owned by this command.
 * `--enable`/`--disable` are per-repo and never write the manifest.
 */
import { promises as fs } from 'fs';
import * as path from 'path';
import * as p from '@clack/prompts';
import color from 'picocolors';
import { getGitRoot } from '../../../core/git.js';
import { getDevFlowDirectory } from '../../../targets/claude-code/claude-paths.js';
import { updateFeature } from '../../../core/feature-config.js';
import { readFeatureSwitchState, readMachineSwitch, formatFeatureSwitchLines } from '../../../core/feature-switch.js';
import { getFeaturesDir } from '../../../core/project-paths.js';

/** Who owns each of the knowledge switches, for status output. */
const KNOWLEDGE_SWITCH_OWNERS = {
  machineWide: 'devflow init --knowledge / --no-knowledge',
  repo: 'devflow knowledge --enable / --disable',
} as const;

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

    // Per-repo only: never a hidden machine-wide write. Keeps every unmanaged
    // config key (D-CONFIG-PRESERVE-UNMANAGED).
    await updateFeature(worktreePath, 'knowledge', true);
    p.log.success('Feature knowledge bases enabled for this project');

    if (!(await readMachineSwitch(devflowDir, 'knowledge'))) {
      p.log.warn(
        'Knowledge bases are disabled machine-wide, so write-back stays off here until you turn it back on with ' +
        `${color.cyan('devflow init --knowledge')}`,
      );
    } else {
      p.log.info('Knowledge bases are created automatically when workflows detect documented area changes.');
    }
    p.outro('');

  } else if (options.disable) {
    p.intro(color.cyan('Disable Feature Knowledge Bases'));

    // Per-repo only: the manifest is the machine-wide switch, owned by
    // `devflow init`. Keeps every unmanaged config key (D-CONFIG-PRESERVE-UNMANAGED).
    await updateFeature(worktreePath, 'knowledge', false);

    p.log.success('Feature knowledge bases disabled for this project');
    p.log.info('Existing knowledge bases preserved. Write-back skipped while disabled.');
    p.log.info(`To turn it off in every project: ${color.cyan('devflow init --no-knowledge')}`);
    p.outro('');

  } else {
    // options.status
    p.intro(color.cyan('Feature Knowledge Status'));

    const state = await readFeatureSwitchState(devflowDir, worktreePath, 'knowledge');
    const kbCount = await countKnowledgeBases(worktreePath);

    p.log.info(formatFeatureSwitchLines('Status', state, KNOWLEDGE_SWITCH_OWNERS).join('\n'));
    p.log.info(`Knowledge bases: ${kbCount}`);
    p.outro('');
  }
}
