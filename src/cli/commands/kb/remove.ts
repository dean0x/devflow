import * as p from '@clack/prompts';
import color from 'picocolors';
import { getFeatureKb, exitOnInvalidSlug, getWorktreePath } from './shared.js';

export async function handleRemove(slug: string): Promise<void> {
  exitOnInvalidSlug(slug);
  p.intro(color.cyan(`Remove KB: ${slug}`));

  const confirmed = await p.confirm({
    message: `Remove KB '${slug}' and its KNOWLEDGE.md? This cannot be undone.`,
    initialValue: false,
  });
  if (p.isCancel(confirmed) || !confirmed) {
    p.cancel('Removal cancelled.');
    return;
  }

  const worktreePath = await getWorktreePath();

  try {
    getFeatureKb().removeEntry(worktreePath, slug);
    p.log.success(`KB '${slug}' removed`);
  } catch (err) {
    p.log.error(`Failed to remove KB: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  p.outro('Done');
}
