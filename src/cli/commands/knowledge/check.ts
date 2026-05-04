import * as p from '@clack/prompts';
import color from 'picocolors';
import { getFeatureKnowledge, getWorktreePath } from './shared.js';

export async function handleCheck(): Promise<void> {
  p.intro(color.cyan('Knowledge Base Staleness Check'));

  const worktreePath = await getWorktreePath();
  // Load index once and pass to both functions to avoid double file reads
  const index = getFeatureKnowledge().loadIndex(worktreePath);
  const kbs = getFeatureKnowledge().listKBs(worktreePath, index);
  const staleness = getFeatureKnowledge().checkAllStaleness(worktreePath, index);

  if (kbs.length === 0) {
    p.log.info('No feature knowledge bases found.');
    p.outro('');
    return;
  }

  let staleCount = 0;

  for (const kb of kbs) {
    const staleInfo = staleness[kb.slug];
    const isStale = staleInfo?.stale ?? false;
    if (isStale) {
      staleCount++;
      p.log.warn(`${kb.name} (${kb.slug}) is stale`);
      for (const f of staleInfo.changedFiles.slice(0, 5)) {
        console.log(`    ${color.yellow('•')} ${f}`);
      }
      if (staleInfo.changedFiles.length > 5) {
        console.log(`    ${color.yellow('•')} ...and ${staleInfo.changedFiles.length - 5} more`);
      }
    } else {
      p.log.success(`${kb.name} (${kb.slug}) is current`);
    }
  }

  if (staleCount > 0) {
    p.outro(`${staleCount} knowledge base${staleCount === 1 ? '' : 's'} need refresh. Run: ${color.cyan('devflow knowledge refresh')}`);
  } else {
    p.outro('All knowledge bases are current');
  }
}
