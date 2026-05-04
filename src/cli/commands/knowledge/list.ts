import * as p from '@clack/prompts';
import color from 'picocolors';
import { getFeatureKnowledge, getWorktreePath } from './shared.js';

export async function handleList(): Promise<void> {
  p.intro(color.cyan('Feature Knowledge Bases'));

  const worktreePath = await getWorktreePath();
  // Load index once and pass to both functions to avoid double file reads
  const index = getFeatureKnowledge().loadIndex(worktreePath);
  const kbs = getFeatureKnowledge().listKBs(worktreePath, index);
  const staleness = getFeatureKnowledge().checkAllStaleness(worktreePath, index);

  if (kbs.length === 0) {
    p.log.info(
      'No feature knowledge bases found. Knowledge bases are created automatically during planning, or manually via ' +
      color.cyan('devflow knowledge create <slug>') + '.'
    );
    p.outro('');
    return;
  }

  p.log.info(`Found ${kbs.length} feature knowledge base${kbs.length === 1 ? '' : 's'} in ${color.dim(worktreePath)}`);
  console.log('');

  for (const kb of kbs) {
    const staleInfo = staleness[kb.slug];
    const isStale = staleInfo?.stale ?? false;
    const statusBadge = isStale ? color.yellow('[STALE]') : color.green('[current]');

    console.log(`  ${color.bold(kb.name)} ${statusBadge}`);
    console.log(`    slug:       ${color.dim(kb.slug)}`);
    console.log(`    updated:    ${color.dim(kb.lastUpdated)}`);
    console.log(`    dirs:       ${color.dim(kb.directories.join(', '))}`);
    if (isStale && staleInfo.changedFiles.length > 0) {
      const shown = staleInfo.changedFiles.slice(0, 3).join(', ');
      const overflow = staleInfo.changedFiles.length > 3 ? ` +${staleInfo.changedFiles.length - 3} more` : '';
      console.log(`    changed:    ${color.yellow(shown)}${overflow}`);
    }
    console.log('');
  }

  p.outro(`Run ${color.cyan('devflow knowledge check')} to see staleness details`);
}
