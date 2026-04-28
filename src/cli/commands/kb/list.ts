import * as p from '@clack/prompts';
import color from 'picocolors';
import { featureKb, getWorktreePath } from './shared.js';

export async function handleList(): Promise<void> {
  p.intro(color.cyan('Feature Knowledge Bases'));

  const worktreePath = await getWorktreePath();
  const kbs = featureKb.listKBs(worktreePath);
  const staleness = featureKb.checkAllStaleness(worktreePath);

  if (kbs.length === 0) {
    p.log.info(
      'No feature KBs found. KBs are created automatically during planning, or manually via ' +
      color.cyan('devflow kb create <slug>') + '.'
    );
    p.outro('');
    return;
  }

  p.log.info(`Found ${kbs.length} feature KB${kbs.length === 1 ? '' : 's'} in ${color.dim(worktreePath)}`);
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

  p.outro(`Run ${color.cyan('devflow kb check')} to see staleness details`);
}
