import * as p from '@clack/prompts';
import color from 'picocolors';
import { getFeatureKnowledge, exitOnInvalidSlug, getWorktreePath } from './shared.js';

export async function handleRemove(slug: string): Promise<void> {
  exitOnInvalidSlug(slug);
  p.intro(color.cyan(`Remove Knowledge Base: ${slug}`));

  const confirmed = await p.confirm({
    message: `Remove knowledge base '${slug}' and its KNOWLEDGE.md? This cannot be undone.`,
    initialValue: false,
  });
  if (p.isCancel(confirmed) || !confirmed) {
    p.cancel('Removal cancelled.');
    return;
  }

  const worktreePath = await getWorktreePath();

  try {
    getFeatureKnowledge().removeEntry(worktreePath, slug);
    p.log.success(`Knowledge base '${slug}' removed`);
  } catch (err) {
    p.log.error(`Failed to remove knowledge base: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  p.outro('Done');
}
